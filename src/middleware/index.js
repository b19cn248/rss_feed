// src/middleware/index.js
const config = require('../../config');
const { logWithTimestamp, safeSetHeader } = require('../utils/helpers');
const { RateLimitError, ValidationError, AppError, ErrorUtils } = require('../errors');

/**
 * Request Logger Middleware
 * Enhanced logging with request ID and more context
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    const { method, url, ip } = req;

    // Generate unique request ID for tracking
    req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const userAgent = req.get('User-Agent') || 'Unknown';
    const referer = req.get('Referer') || 'Direct';

    logWithTimestamp(`[${req.requestId}] ${method} ${url} - IP: ${ip} - UA: ${userAgent.substring(0, 50)}`);

    // Store request context for later use
    req.startTime = start;
    req.logContext = {
        requestId: req.requestId,
        method,
        url,
        ip,
        userAgent,
        referer
    };

    next();
}

/**
 * Response Logger Middleware
 * Enhanced response logging with timing and error tracking
 */
function responseLogger(req, res, next) {
    const originalEnd = res.end;
    const originalSend = res.send;

    // Track response data
    let responseBody = null;
    let responseSize = 0;

    // Override send to capture response body (only for errors)
    res.send = function(data) {
        if (res.statusCode >= 400) {
            responseBody = data;
        }
        responseSize = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data || '', 'utf8');
        return originalSend.call(this, data);
    };

    // Override end to log response
    res.end = function(...args) {
        if (req.startTime) {
            const duration = Date.now() - req.startTime;
            const { method, url, requestId } = req.logContext || {};
            const { statusCode } = res;

            // Determine log level based on status code
            const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

            const logMessage = `[${requestId}] ${method} ${url} - ${statusCode} - ${duration}ms - ${responseSize} bytes`;

            logWithTimestamp(logMessage, level);

            // Log error details for debugging
            if (statusCode >= 400 && responseBody) {
                try {
                    const errorData = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
                    if (errorData.error && errorData.code) {
                        logWithTimestamp(`[${requestId}] Error details: ${errorData.code} - ${errorData.message}`, 'error');
                    }
                } catch (e) {
                    // Ignore JSON parse errors
                }
            }
        }

        return originalEnd.apply(this, args);
    };

    next();
}

/**
 * Enhanced Rate Limiting Middleware
 * Improved rate limiting with better error responses and tracking
 */
function rateLimiter() {
    const requests = new Map(); // IP -> { count, resetTime, violations }

    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const windowMs = config.security.rateLimitWindow;
        const maxRequests = config.security.rateLimitMax;

        // Clean expired entries
        for (const [clientIp, data] of requests.entries()) {
            if (data.resetTime < now) {
                requests.delete(clientIp);
            }
        }

        // Get or create client data
        let clientData = requests.get(ip);
        if (!clientData || clientData.resetTime < now) {
            clientData = {
                count: 0,
                resetTime: now + windowMs,
                violations: clientData?.violations || 0,
                firstRequest: now
            };
            requests.set(ip, clientData);
        }

        clientData.count++;
        const remaining = Math.max(0, maxRequests - clientData.count);
        const retryAfter = Math.ceil((clientData.resetTime - now) / 1000);

        // Set rate limit headers
        safeSetHeader(res, 'X-RateLimit-Limit', maxRequests.toString());
        safeSetHeader(res, 'X-RateLimit-Remaining', remaining.toString());
        safeSetHeader(res, 'X-RateLimit-Reset', new Date(clientData.resetTime).toISOString());

        // Check if limit exceeded
        if (clientData.count > maxRequests) {
            clientData.violations++;

            // Log rate limit violation
            logWithTimestamp(
                `[${req.requestId}] Rate limit exceeded for IP: ${ip} (${clientData.count}/${maxRequests}) - Violation #${clientData.violations}`,
                'warn'
            );

            const error = new RateLimitError(retryAfter, ip);

            safeSetHeader(res, 'Retry-After', retryAfter.toString());

            return res.status(429).json({
                ...error.toJSON(),
                retryAfter,
                requestId: req.requestId
            });
        }

        // Log if approaching limit
        if (remaining <= 5) {
            logWithTimestamp(
                `[${req.requestId}] IP ${ip} approaching rate limit: ${remaining} requests remaining`,
                'warn'
            );
        }

        next();
    };
}

/**
 * Enhanced Error Handler Middleware
 * Comprehensive error handling with proper logging and responses
 */
function errorHandler(err, req, res, next) {
    // Don't send response if headers already sent
    if (res.headersSent) {
        return next(err);
    }

    // Normalize error to AppError
    const error = ErrorUtils.normalize(err);
    const requestId = req.requestId || 'unknown';

    // Log error details
    const logContext = ErrorUtils.getLogContext(error);
    logContext.requestId = requestId;
    logContext.url = req.url;
    logContext.method = req.method;
    logContext.ip = req.ip;

    // Determine log level
    const isClientError = error.statusCode >= 400 && error.statusCode < 500;
    const logLevel = isClientError ? 'warn' : 'error';

    logWithTimestamp(
        `[${requestId}] ${error.name}: ${error.message}`,
        logLevel
    );

    // Log stack trace for server errors in development
    if (!isClientError && config.server.env === 'development') {
        console.error('Stack trace:', error.stack);
    }

    // Prepare response
    const response = {
        ...error.toJSON(),
        requestId,
        timestamp: new Date().toISOString(),
        path: req.path
    };

    // Remove sensitive information in production
    if (config.server.env === 'production') {
        delete response.stack;
        if (!ErrorUtils.isOperational(error)) {
            response.message = 'An unexpected error occurred';
            delete response.details;
        }
    }

    // Send error response
    res.status(error.statusCode).json(response);
}

/**
 * 404 Not Found Handler
 * Enhanced 404 handling with helpful information
 */
function notFoundHandler(req, res) {
    if (res.headersSent) {
        return;
    }

    const requestId = req.requestId || 'unknown';
    const message = `Route ${req.method} ${req.path} not found`;

    logWithTimestamp(`[${requestId}] ${message}`, 'warn');

    const response = {
        error: true,
        message: 'Endpoint not found',
        code: 'NOT_FOUND',
        statusCode: 404,
        requestId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,

        availableEndpoints: [
            'GET /feed?url=<website_url>',
            'GET /metadata?url=<website_url>',
            'GET /preview?url=<website_url>',
            'GET /health',
            'GET /api/info',
            'POST /validate',
            'GET /cache/stats',
            'DELETE /cache?url=<website_url>'
        ],

        documentation: `${req.protocol}://${req.get('host')}/api/info`
    };

    res.status(404).json(response);
}

/**
 * Enhanced Security Headers Middleware
 */
function securityHeaders(req, res, next) {
    // Enhanced security headers
    const headers = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-DNS-Prefetch-Control': 'off',
        'X-Powered-By': 'RSS-Generator/1.0', // Custom header instead of Express
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    // Content Security Policy for RSS feeds
    const csp = [
        "default-src 'self'",
        "script-src 'none'",
        "object-src 'none'",
        "style-src 'unsafe-inline'",
        "img-src *",
        "media-src 'none'",
        "frame-src 'none'"
    ].join('; ');

    headers['Content-Security-Policy'] = csp;

    // Set all headers safely
    Object.entries(headers).forEach(([name, value]) => {
        safeSetHeader(res, name, value);
    });

    next();
}

/**
 * Enhanced CORS Configuration
 */
function corsConfig(req, res, next) {
    const origin = req.get('Origin');

    // Allow all origins for RSS feeds (they're meant to be public)
    safeSetHeader(res, 'Access-Control-Allow-Origin', '*');
    safeSetHeader(res, 'Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST, DELETE');
    safeSetHeader(res, 'Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    safeSetHeader(res, 'Access-Control-Max-Age', '86400'); // 24 hours

    // Log CORS requests for debugging
    if (origin) {
        logWithTimestamp(`[${req.requestId}] CORS request from origin: ${origin}`);
    }

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
}

/**
 * Enhanced Response Time Middleware
 */
function responseTime(req, res, next) {
    const start = process.hrtime.bigint();

    // Store start time on request
    req.responseTimeStart = start;

    // Override end method to add response time
    const originalEnd = res.end;
    res.end = function(...args) {
        if (req.responseTimeStart && !res.headersSent) {
            const diff = process.hrtime.bigint() - req.responseTimeStart;
            const timeMs = Number(diff / BigInt(1000000)); // Convert to milliseconds

            safeSetHeader(res, 'X-Response-Time', `${timeMs.toFixed(2)}ms`);

            // Log slow requests
            if (timeMs > 5000) { // 5 seconds
                logWithTimestamp(
                    `[${req.requestId}] Slow request detected: ${timeMs.toFixed(2)}ms`,
                    'warn'
                );
            }
        }

        return originalEnd.apply(this, args);
    };

    next();
}

/**
 * Request Size Limiter
 */
function requestSizeLimiter(maxSize = '1mb') {
    return (req, res, next) => {
        const contentLength = parseInt(req.get('Content-Length') || '0');
        const maxBytes = typeof maxSize === 'string' ?
            parseInt(maxSize) * (maxSize.includes('mb') ? 1024 * 1024 : 1024) :
            maxSize;

        if (contentLength > maxBytes) {
            const error = new ValidationError(
                `Request too large. Maximum size is ${maxSize}`,
                { contentLength, maxSize }
            );

            return res.status(413).json({
                ...error.toJSON(),
                requestId: req.requestId
            });
        }

        next();
    };
}

// Export all middleware functions
module.exports = {
    requestLogger,
    responseLogger,
    rateLimiter,
    errorHandler,
    notFoundHandler,
    securityHeaders,
    corsConfig,
    responseTime,
    requestSizeLimiter
};