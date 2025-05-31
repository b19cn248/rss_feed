// src/middleware/index.js
const config = require('../../config');
const { logWithTimestamp, safeSetHeader } = require('../utils/helpers');

/**
 * Request Logger Middleware
 * Logs all incoming requests with timestamp
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    const { method, url, ip } = req;

    logWithTimestamp(`${method} ${url} - ${ip}`);

    // Store start time for response logging
    req.startTime = start;

    next();
}

/**
 * Response Logger Middleware (should be placed after routes)
 * Logs response details after processing
 */
function responseLogger(req, res, next) {
    const originalEnd = res.end;

    res.end = function(...args) {
        if (req.startTime) {
            const duration = Date.now() - req.startTime;
            const { method, url } = req;
            const { statusCode } = res;
            logWithTimestamp(`${method} ${url} - ${statusCode} - ${duration}ms`);
        }

        // Call original end method
        originalEnd.apply(this, args);
    };

    next();
}

/**
 * Simple Rate Limiting Middleware
 * Implements basic rate limiting using in-memory storage
 */
function rateLimiter() {
    const requests = new Map(); // IP -> { count, resetTime }

    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();

        // Clean old entries
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
                resetTime: now + config.security.rateLimitWindow
            };
            requests.set(ip, clientData);
        }

        clientData.count++;

        // Check if limit exceeded
        if (clientData.count > config.security.rateLimitMax) {
            logWithTimestamp(`Rate limit exceeded for IP: ${ip}`, 'warn');
            return res.status(429).json({
                error: 'Too Many Requests',
                message: 'Rate limit exceeded. Please try again later.',
                retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
            });
        }

        // Add rate limit headers (safely)
        safeSetHeader(res, 'X-RateLimit-Limit', config.security.rateLimitMax.toString());
        safeSetHeader(res, 'X-RateLimit-Remaining', (config.security.rateLimitMax - clientData.count).toString());
        safeSetHeader(res, 'X-RateLimit-Reset', new Date(clientData.resetTime).toISOString());

        next();
    };
}

/**
 * Error Handler Middleware
 * Centralized error handling for the application
 */
function errorHandler(err, req, res, next) {
    // Log the error
    logWithTimestamp(`Error: ${err.message}`, 'error');

    // Don't log stack trace in production
    if (config.server.env === 'development') {
        console.error('Stack trace:', err.stack);
    }

    // Don't send response if headers already sent
    if (res.headersSent) {
        return next(err);
    }

    // Default error response
    let statusCode = 500;
    let message = 'Internal Server Error';

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Invalid input data';
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
        message = 'Unauthorized access';
    } else if (err.message.includes('Invalid URL') || err.message.includes('Invalid website URL')) {
        statusCode = 400;
        message = 'Invalid URL provided';
    } else if (err.message.includes('Failed to fetch') || err.message.includes('timeout')) {
        statusCode = 502;
        message = 'Unable to fetch content from the specified website';
    } else if (err.message.includes('No articles could be extracted')) {
        statusCode = 404;
        message = 'No articles found on this website';
    }

    // Custom error response format
    const errorResponse = {
        error: true,
        message: message,
        statusCode: statusCode,
        timestamp: new Date().toISOString(),
        path: req.path
    };

    // Include error details in development
    if (config.server.env === 'development') {
        errorResponse.details = err.message;
        errorResponse.stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found Handler
 * Handles requests to non-existent routes
 */
function notFoundHandler(req, res) {
    const message = `Route ${req.method} ${req.path} not found`;
    logWithTimestamp(message, 'warn');

    // Check if response already sent
    if (res.headersSent) {
        return;
    }

    res.status(404).json({
        error: true,
        message: 'Endpoint not found',
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: req.path,
        availableEndpoints: [
            'GET /feed?url=<website_url>',
            'GET /metadata?url=<website_url>',
            'GET /health',
            'GET /cache/stats',
            'DELETE /cache?url=<website_url>'
        ]
    });
}

/**
 * Request Validation Middleware
 * Validates common request parameters
 */
function validateRequest(req, res, next) {
    const { url } = req.query;

    // Validate URL parameter if present
    if (url) {
        try {
            new URL(url);

            // Check for supported protocols
            const urlObj = new URL(url);
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                return res.status(400).json({
                    error: true,
                    message: 'Only HTTP and HTTPS URLs are supported',
                    statusCode: 400
                });
            }

            // Add normalized URL to request
            req.normalizedUrl = url;

        } catch (error) {
            return res.status(400).json({
                error: true,
                message: 'Invalid URL format provided',
                statusCode: 400,
                example: 'https://example.com'
            });
        }
    }

    next();
}

/**
 * Security Headers Middleware
 * Adds basic security headers
 */
function securityHeaders(req, res, next) {
    // Basic security headers (set early, before any response)
    safeSetHeader(res, 'X-Content-Type-Options', 'nosniff');
    safeSetHeader(res, 'X-Frame-Options', 'DENY');
    safeSetHeader(res, 'X-XSS-Protection', '1; mode=block');
    safeSetHeader(res, 'Referrer-Policy', 'strict-origin-when-cross-origin');
    safeSetHeader(res, 'Content-Security-Policy', "default-src 'self'");
    safeSetHeader(res, 'Cache-Control', 'no-cache, no-store, must-revalidate');
    safeSetHeader(res, 'Pragma', 'no-cache');
    safeSetHeader(res, 'Expires', '0');

    next();
}

/**
 * CORS Configuration for RSS feeds
 * Custom CORS handling for feed endpoints
 */
function corsConfig(req, res, next) {
    // Allow all origins for RSS feeds (they're meant to be public)
    safeSetHeader(res, 'Access-Control-Allow-Origin', '*');
    safeSetHeader(res, 'Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    safeSetHeader(res, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
    safeSetHeader(res, 'Access-Control-Max-Age', '86400'); // 24 hours

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
}

/**
 * Response Time Middleware
 * Adds response time header (improved version)
 */
function responseTime(req, res, next) {
    const start = process.hrtime();

    // Store start time on request for later use
    req.responseTimeStart = start;

    // Override end method to add response time
    const originalEnd = res.end;
    res.end = function(...args) {
        if (req.responseTimeStart && !res.headersSent) {
            const diff = process.hrtime(req.responseTimeStart);
            const time = diff[0] * 1e3 + diff[1] * 1e-6; // Convert to milliseconds
            safeSetHeader(res, 'X-Response-Time', `${time.toFixed(2)}ms`);
        }

        // Call original end method
        originalEnd.apply(this, args);
    };

    next();
}

// Export all middleware functions
module.exports = {
    requestLogger,
    responseLogger,
    rateLimiter,
    errorHandler,
    notFoundHandler,
    validateRequest,
    securityHeaders,
    corsConfig,
    responseTime
};