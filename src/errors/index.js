// src/errors/index.js

/**
 * Custom Error Classes
 * Provides structured error handling with context and proper status codes
 */

/**
 * Base Application Error
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
        this.isOperational = true; // Distinguish from programming errors

        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: true,
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            details: this.details,
            timestamp: this.timestamp
        };
    }
}

/**
 * Validation Error - 400 Bad Request
 */
class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}

/**
 * URL Validation Error - 400 Bad Request
 */
class UrlValidationError extends ValidationError {
    constructor(url, reason = 'Invalid URL format') {
        super(`URL validation failed: ${reason}`, { url, reason });
        this.url = url;
        this.code = 'INVALID_URL';
    }
}

/**
 * Web Scraping Error - 502 Bad Gateway
 */
class ScrapingError extends AppError {
    constructor(message, url, originalError = null) {
        super(message, 502, 'SCRAPING_ERROR', {
            url,
            originalError: originalError ? {
                message: originalError.message,
                code: originalError.code,
                status: originalError.status
            } : null
        });
        this.url = url;
        this.originalError = originalError;
    }
}

/**
 * HTTP Fetch Error - 502 Bad Gateway
 */
class FetchError extends ScrapingError {
    constructor(url, statusCode, statusText, originalError = null) {
        const message = `Failed to fetch ${url}: ${statusCode} ${statusText}`;
        super(message, url, originalError);
        this.code = 'FETCH_ERROR';
        this.details.statusCode = statusCode;
        this.details.statusText = statusText;
    }
}

/**
 * Content Parsing Error - 422 Unprocessable Entity
 */
class ParsingError extends AppError {
    constructor(message, url, details = null) {
        super(message, 422, 'PARSING_ERROR', { url, ...details });
        this.url = url;
    }
}

/**
 * No Articles Found Error - 404 Not Found
 */
class NoArticlesError extends AppError {
    constructor(url, reason = 'No articles could be extracted from this website') {
        super(reason, 404, 'NO_ARTICLES_FOUND', { url });
        this.url = url;
    }
}

/**
 * Feed Generation Error - 500 Internal Server Error
 */
class FeedGenerationError extends AppError {
    constructor(message, url, articleCount = 0, originalError = null) {
        super(message, 500, 'FEED_GENERATION_ERROR', {
            url,
            articleCount,
            originalError: originalError ? originalError.message : null
        });
        this.url = url;
        this.articleCount = articleCount;
        this.originalError = originalError;
    }
}

/**
 * Cache Error - 500 Internal Server Error
 */
class CacheError extends AppError {
    constructor(message, operation, key = null, originalError = null) {
        super(message, 500, 'CACHE_ERROR', {
            operation,
            key,
            originalError: originalError ? originalError.message : null
        });
        this.operation = operation;
        this.key = key;
        this.originalError = originalError;
    }
}

/**
 * Rate Limit Error - 429 Too Many Requests
 */
class RateLimitError extends AppError {
    constructor(retryAfter, clientId = null) {
        super('Too many requests. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED', {
            retryAfter,
            clientId
        });
        this.retryAfter = retryAfter;
        this.clientId = clientId;
    }
}

/**
 * Configuration Error - 500 Internal Server Error
 */
class ConfigError extends AppError {
    constructor(message, configKey = null) {
        super(message, 500, 'CONFIG_ERROR', { configKey });
        this.configKey = configKey;
    }
}

/**
 * Timeout Error - 408 Request Timeout
 */
class TimeoutError extends AppError {
    constructor(operation, timeout, url = null) {
        const message = `Operation timed out after ${timeout}ms: ${operation}`;
        super(message, 408, 'TIMEOUT_ERROR', { operation, timeout, url });
        this.operation = operation;
        this.timeout = timeout;
        this.url = url;
    }
}

/**
 * Error Factory - Create appropriate error based on context
 */
class ErrorFactory {
    /**
     * Create error from HTTP response
     */
    static fromHttpResponse(url, response, originalError = null) {
        const { status, statusText } = response;

        if (status >= 400 && status < 500) {
            return new FetchError(url, status, statusText || 'Client Error', originalError);
        } else if (status >= 500) {
            return new FetchError(url, status, statusText || 'Server Error', originalError);
        } else {
            return new ScrapingError(`Unexpected response: ${status}`, url, originalError);
        }
    }

    /**
     * Create error from axios error
     */
    static fromAxiosError(error, url) {
        if (error.code === 'ECONNABORTED') {
            return new TimeoutError('HTTP request', error.timeout || 10000, url);
        } else if (error.response) {
            return this.fromHttpResponse(url, error.response, error);
        } else if (error.request) {
            return new ScrapingError(`Network error: Unable to reach ${url}`, url, error);
        } else {
            return new ScrapingError(`Request setup error: ${error.message}`, url, error);
        }
    }

    /**
     * Create validation error with multiple fields
     */
    static fromValidationResults(results) {
        const errors = results.filter(r => !r.isValid);
        if (errors.length === 0) return null;

        const details = errors.map(error => ({
            field: error.field,
            message: error.message,
            value: error.value
        }));

        return new ValidationError('Multiple validation errors', details);
    }
}

/**
 * Error Utils
 */
class ErrorUtils {
    /**
     * Check if error is operational (expected) vs programming error
     */
    static isOperational(error) {
        return error.isOperational === true;
    }

    /**
     * Get safe error message for client response
     */
    static getSafeMessage(error) {
        if (this.isOperational(error)) {
            return error.message;
        }

        // Don't leak internal errors to client
        return 'An unexpected error occurred';
    }

    /**
     * Get error context for logging
     */
    static getLogContext(error) {
        return {
            name: error.name,
            message: error.message,
            code: error.code,
            statusCode: error.statusCode,
            stack: error.stack,
            details: error.details,
            timestamp: error.timestamp || new Date().toISOString()
        };
    }

    /**
     * Convert any error to AppError
     */
    static normalize(error) {
        if (error instanceof AppError) {
            return error;
        }

        // Handle specific error types
        if (error.name === 'ValidationError') {
            return new ValidationError(error.message, error.details);
        }

        // Generic fallback
        return new AppError(
            error.message || 'An unexpected error occurred',
            500,
            'UNKNOWN_ERROR',
            { originalName: error.name }
        );
    }
}

module.exports = {
    AppError,
    ValidationError,
    UrlValidationError,
    ScrapingError,
    FetchError,
    ParsingError,
    NoArticlesError,
    FeedGenerationError,
    CacheError,
    RateLimitError,
    ConfigError,
    TimeoutError,
    ErrorFactory,
    ErrorUtils
};