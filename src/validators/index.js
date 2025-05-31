// src/validators/index.js
const { URL } = require('url');

/**
 * Input Validation Service
 * Complete fixed version with proper error handling and static method calls
 */
class ValidationService {

    /**
     * Validate feed generation request
     */
    static validateFeedRequest(req, res, next) {
        try {
            const errors = [];
            const { url, title, description, limit } = req.query;

            // Validate URL (required)
            if (!url) {
                return res.status(400).json({
                    error: true,
                    message: 'URL parameter is required',
                    code: 'MISSING_URL',
                    example: '/feed?url=https://example.com',
                    timestamp: new Date().toISOString()
                });
            }

            // Validate URL format
            const urlValidation = ValidationService.validateUrl(url);
            if (!urlValidation.isValid) {
                return res.status(400).json({
                    error: true,
                    message: urlValidation.error,
                    code: 'INVALID_URL',
                    url: url,
                    timestamp: new Date().toISOString()
                });
            }

            // Validate optional title
            if (title !== undefined) {
                if (typeof title !== 'string') {
                    errors.push({
                        field: 'title',
                        message: 'Title must be a string',
                        code: 'INVALID_TITLE_TYPE',
                        value: title
                    });
                } else if (title.length > 100) {
                    errors.push({
                        field: 'title',
                        message: 'Title must not exceed 100 characters',
                        code: 'TITLE_TOO_LONG',
                        value: title,
                        maxLength: 100,
                        currentLength: title.length
                    });
                }
            }

            // Validate optional description
            if (description !== undefined) {
                if (typeof description !== 'string') {
                    errors.push({
                        field: 'description',
                        message: 'Description must be a string',
                        code: 'INVALID_DESCRIPTION_TYPE',
                        value: description
                    });
                } else if (description.length > 500) {
                    errors.push({
                        field: 'description',
                        message: 'Description must not exceed 500 characters',
                        code: 'DESCRIPTION_TOO_LONG',
                        value: description,
                        maxLength: 500,
                        currentLength: description.length
                    });
                }
            }

            // Validate optional limit
            if (limit !== undefined) {
                const parsedLimit = parseInt(limit, 10);
                if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
                    errors.push({
                        field: 'limit',
                        message: 'Limit must be a number between 1 and 50',
                        code: 'INVALID_LIMIT',
                        value: limit,
                        min: 1,
                        max: 50
                    });
                }
            }

            // Return validation errors if any
            if (errors.length > 0) {
                return res.status(400).json({
                    error: true,
                    message: 'Validation failed',
                    code: 'VALIDATION_FAILED',
                    details: errors,
                    timestamp: new Date().toISOString()
                });
            }

            // Store validated and normalized data
            req.validatedQuery = {
                url: url.trim(),
                title: title ? title.trim() : undefined,
                description: description ? description.trim() : undefined,
                limit: limit ? parseInt(limit, 10) : undefined
            };

            next();

        } catch (error) {
            console.error('Validation error:', error);
            return res.status(500).json({
                error: true,
                message: 'Internal validation error',
                code: 'VALIDATION_INTERNAL_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Validate URL format and security
     * Fixed: Proper static method calls
     */
    static validateUrl(url) {
        try {
            // Basic type check
            if (!url || typeof url !== 'string') {
                return {
                    isValid: false,
                    error: 'URL must be a non-empty string'
                };
            }

            // Trim whitespace
            url = url.trim();

            if (url.length === 0) {
                return {
                    isValid: false,
                    error: 'URL cannot be empty'
                };
            }

            // Parse URL
            const urlObj = new URL(url);

            // Check protocol
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                return {
                    isValid: false,
                    error: 'Only HTTP and HTTPS protocols are supported',
                    protocol: urlObj.protocol
                };
            }

            // Get hostname for security checks
            const hostname = urlObj.hostname.toLowerCase();

            // Security: Block private/local networks
            const blockedPatterns = [
                'localhost',
                '127.0.0.1',
                '0.0.0.0',
                '::1',
                'local'
            ];

            for (const pattern of blockedPatterns) {
                if (hostname.includes(pattern)) {
                    return {
                        isValid: false,
                        error: 'Local/private URLs are not allowed for security reasons',
                        hostname: hostname
                    };
                }
            }

            // Check for private IP ranges - FIXED: Use ValidationService instead of this
            if (ValidationService.isPrivateIP(hostname)) {
                return {
                    isValid: false,
                    error: 'Private IP addresses are not allowed',
                    hostname: hostname
                };
            }

            // Additional security checks
            if (hostname.length === 0) {
                return {
                    isValid: false,
                    error: 'Invalid hostname'
                };
            }

            // Check for suspicious ports
            const port = urlObj.port;
            if (port && ValidationService.isSuspiciousPort(parseInt(port, 10))) {
                return {
                    isValid: false,
                    error: 'Port not allowed for security reasons',
                    port: port
                };
            }

            return {
                isValid: true,
                normalizedUrl: urlObj.toString()
            };

        } catch (error) {
            return {
                isValid: false,
                error: 'Invalid URL format: ' + error.message,
                details: error.message
            };
        }
    }

    /**
     * Check if hostname is private IP
     * Fixed: Proper static method implementation
     */
    static isPrivateIP(hostname) {
        try {
            // IPv4 private ranges
            const privateRanges = [
                /^10\./,                     // 10.0.0.0/8
                /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
                /^192\.168\./                // 192.168.0.0/16
            ];

            // IPv6 private ranges
            const ipv6PrivateRanges = [
                /^::1$/,                     // localhost
                /^fc[0-9a-f]{2}:/,          // Unique local addresses
                /^fd[0-9a-f]{2}:/,          // Unique local addresses
                /^fe80:/                     // Link-local addresses
            ];

            // Check IPv4
            for (const range of privateRanges) {
                if (range.test(hostname)) {
                    return true;
                }
            }

            // Check IPv6
            for (const range of ipv6PrivateRanges) {
                if (range.test(hostname)) {
                    return true;
                }
            }

            return false;

        } catch (error) {
            // If there's an error checking IP, be safe and consider it private
            console.warn('Error checking private IP:', error);
            return true;
        }
    }

    /**
     * Check if port is suspicious/blocked
     */
    static isSuspiciousPort(port) {
        // Block common system/dangerous ports
        const blockedPorts = [
            22,    // SSH
            23,    // Telnet
            25,    // SMTP
            53,    // DNS
            110,   // POP3
            143,   // IMAP
            993,   // IMAPS
            995,   // POP3S
            1433,  // SQL Server
            3306,  // MySQL
            5432,  // PostgreSQL
            6379,  // Redis
            27017  // MongoDB
        ];

        return blockedPorts.includes(port);
    }

    /**
     * Validate cache management request
     */
    static validateCacheRequest(req, res, next) {
        try {
            const { url } = req.query;

            if (url) {
                const urlValidation = ValidationService.validateUrl(url);
                if (!urlValidation.isValid) {
                    return res.status(400).json({
                        error: true,
                        message: urlValidation.error,
                        code: 'INVALID_URL',
                        url: url,
                        timestamp: new Date().toISOString()
                    });
                }
                req.validatedQuery = { url: url.trim() };
            } else {
                req.validatedQuery = {};
            }

            next();

        } catch (error) {
            console.error('Cache validation error:', error);
            return res.status(500).json({
                error: true,
                message: 'Internal validation error',
                code: 'CACHE_VALIDATION_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Validate website validation request
     */
    static validateWebsiteRequest(req, res, next) {
        try {
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({
                    error: true,
                    message: 'URL is required in request body',
                    code: 'MISSING_URL',
                    example: { url: 'https://example.com' },
                    timestamp: new Date().toISOString()
                });
            }

            const urlValidation = ValidationService.validateUrl(url);
            if (!urlValidation.isValid) {
                return res.status(400).json({
                    error: true,
                    message: urlValidation.error,
                    code: 'INVALID_URL',
                    url: url,
                    timestamp: new Date().toISOString()
                });
            }

            req.validatedBody = { url: url.trim() };
            next();

        } catch (error) {
            console.error('Website validation error:', error);
            return res.status(500).json({
                error: true,
                message: 'Internal validation error',
                code: 'WEBSITE_VALIDATION_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Validate pagination parameters
     */
    static validatePagination(req, res, next) {
        try {
            const { page, limit } = req.query;
            const errors = [];

            let validatedPage = 1;
            let validatedLimit = 20;

            if (page !== undefined) {
                const parsedPage = parseInt(page, 10);
                if (isNaN(parsedPage) || parsedPage < 1) {
                    errors.push({
                        field: 'page',
                        message: 'Page must be a positive integer',
                        code: 'INVALID_PAGE',
                        value: page,
                        min: 1
                    });
                } else {
                    validatedPage = parsedPage;
                }
            }

            if (limit !== undefined) {
                const parsedLimit = parseInt(limit, 10);
                if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
                    errors.push({
                        field: 'limit',
                        message: 'Limit must be between 1 and 100',
                        code: 'INVALID_LIMIT',
                        value: limit,
                        min: 1,
                        max: 100
                    });
                } else {
                    validatedLimit = parsedLimit;
                }
            }

            if (errors.length > 0) {
                return res.status(400).json({
                    error: true,
                    message: 'Pagination validation failed',
                    code: 'PAGINATION_VALIDATION_FAILED',
                    details: errors,
                    timestamp: new Date().toISOString()
                });
            }

            req.pagination = {
                page: validatedPage,
                limit: validatedLimit
            };

            next();

        } catch (error) {
            console.error('Pagination validation error:', error);
            return res.status(500).json({
                error: true,
                message: 'Internal validation error',
                code: 'PAGINATION_VALIDATION_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Sanitize text input to prevent XSS
     */
    static sanitizeText(text) {
        if (typeof text !== 'string') return text;

        return text
            .replace(/[<>]/g, '') // Remove basic HTML chars
            .replace(/javascript:/gi, '') // Remove javascript: protocol
            .replace(/on\w+\s*=/gi, '') // Remove event handlers
            .replace(/data:/gi, '') // Remove data: protocol
            .trim();
    }

    /**
     * Get validation summary for debugging
     */
    static getValidationSummary() {
        return {
            name: 'ValidationService',
            version: '1.0.0',
            methods: [
                'validateFeedRequest',
                'validateUrl',
                'validateCacheRequest',
                'validateWebsiteRequest',
                'validatePagination',
                'isPrivateIP',
                'isSuspiciousPort',
                'sanitizeText'
            ],
            features: [
                'URL format validation',
                'Security checks for private IPs',
                'Port blocking',
                'XSS prevention',
                'Comprehensive error messages'
            ]
        };
    }
}

module.exports = ValidationService;