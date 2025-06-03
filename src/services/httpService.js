// src/services/httpService.js (COMPLETE FIXED VERSION)
const axios = require('axios');
const { logWithTimestamp } = require('../utils/helpers');
const { HttpError } = require('../errors');

/**
 * HTTP Service (FIXED) - Better error handling and User-Agent spoofing
 * Handles HTTP requests with proper retry logic and error handling
 */
class HttpService {
    constructor() {
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            retriedRequests: 0,
            blockedRequests: 0, // NEW: Track 406/403 blocked requests
            averageResponseTime: 0,
            lastActivity: null
        };

        // Default config with proper browser User-Agent
        this.defaultConfig = {
            timeout: 10000, // 10 seconds
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            }
        };

        // Rate limiting
        this.lastRequestTime = 0;
        this.minDelay = 100; // Minimum delay between requests

        // Circuit breaker for problematic URLs
        this.blockedUrls = new Set();
        this.urlFailCounts = new Map();
    }

    /**
     * Fetch HTML content from URL with retry logic and proper error handling
     * @param {string} url - URL to fetch
     * @param {object} options - Request options
     * @returns {Promise<string>} - HTML content
     */
    async fetchHtml(url, options = {}) {
        const startTime = Date.now();

        try {
            // Check if URL is blocked
            if (this.isUrlBlocked(url)) {
                throw new HttpError('URL is temporarily blocked due to repeated failures', url, 429);
            }

            // Rate limiting
            await this.rateLimit();

            // Merge options with defaults
            const config = this.mergeConfig(options);

            // Log request
            logWithTimestamp(`HTTP Request: GET ${url}`);

            // Make request with retry logic
            const response = await this.makeRequestWithRetry(url, config);

            // Update stats
            this.updateStats(true, Date.now() - startTime);

            // Reset fail count on success
            this.urlFailCounts.delete(url);

            logWithTimestamp(`HTTP Response: ${response.status} ${url} - ${Date.now() - startTime}ms - ${this.getContentLength(response)} bytes`);

            return response.data;

        } catch (error) {
            // Update stats
            this.updateStats(false, Date.now() - startTime);

            // Handle specific error cases
            this.handleRequestError(url, error);

            // Log error
            logWithTimestamp(`HTTP Error: ${error.message} - ${url} - ${Date.now() - startTime}ms`, 'error');

            throw new HttpError(error.message, url, error.response?.status || 0, error);
        }
    }

    /**
     * Make HTTP request with intelligent retry logic
     * @param {string} url - URL to fetch
     * @param {object} config - Axios config
     * @returns {Promise<object>} - Axios response
     */
    async makeRequestWithRetry(url, config) {
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.stats.totalRequests++;

                const response = await axios.get(url, config);

                // Success
                return response;

            } catch (error) {
                lastError = error;
                const status = error.response?.status;

                // Don't retry for certain error codes
                if (this.shouldNotRetry(status)) {
                    logWithTimestamp(`Not retrying for status ${status}: ${url}`, 'warn');
                    throw error;
                }

                // Don't retry on last attempt
                if (attempt === maxRetries) {
                    break;
                }

                // Calculate delay with exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);

                this.stats.retriedRequests++;
                logWithTimestamp(`Retry ${attempt}/${maxRetries} failed, waiting ${delay}ms...`, 'warn');

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Check if we should not retry for this status code
     * @param {number} status - HTTP status code
     * @returns {boolean} - True if should not retry
     */
    shouldNotRetry(status) {
        const noRetryStatuses = [
            400, // Bad Request
            401, // Unauthorized
            403, // Forbidden
            404, // Not Found
            405, // Method Not Allowed
            406, // Not Acceptable - IMPORTANT: Don't retry 406
            410, // Gone
            451  // Unavailable For Legal Reasons
        ];

        return noRetryStatuses.includes(status);
    }

    /**
     * Handle request errors and implement circuit breaker
     * @param {string} url - URL that failed
     * @param {Error} error - Error object
     */
    handleRequestError(url, error) {
        const status = error.response?.status;

        // Track blocked requests (406, 403)
        if (status === 406 || status === 403) {
            this.stats.blockedRequests++;
        }

        // Increment fail count
        const failCount = (this.urlFailCounts.get(url) || 0) + 1;
        this.urlFailCounts.set(url, failCount);

        // Block URL after too many failures
        if (failCount >= 3) {
            this.blockedUrls.add(url);
            logWithTimestamp(`⚠️  URL blocked after ${failCount} failures: ${url}`, 'warn');

            // Auto-unblock after 5 minutes
            setTimeout(() => {
                this.blockedUrls.delete(url);
                this.urlFailCounts.delete(url);
                logWithTimestamp(`🔓 URL unblocked: ${url}`);
            }, 5 * 60 * 1000);
        }
    }

    /**
     * Check if URL is currently blocked
     * @param {string} url - URL to check
     * @returns {boolean} - True if blocked
     */
    isUrlBlocked(url) {
        return this.blockedUrls.has(url);
    }

    /**
     * Rate limiting to avoid overwhelming servers
     */
    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minDelay) {
            const delay = this.minDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Merge request options with defaults
     * @param {object} options - Custom options
     * @returns {object} - Merged config
     */
    mergeConfig(options) {
        return {
            ...this.defaultConfig,
            ...options,
            headers: {
                ...this.defaultConfig.headers,
                ...(options.headers || {})
            }
        };
    }

    /**
     * Get content length from response
     * @param {object} response - Axios response
     * @returns {string} - Content length or "unknown"
     */
    getContentLength(response) {
        const contentLength = response.headers['content-length'];
        if (contentLength) {
            const bytes = parseInt(contentLength);
            if (bytes > 1024) {
                return `${(bytes / 1024).toFixed(1)}KB`;
            }
            return `${bytes}B`;
        }
        return 'unknown';
    }

    /**
     * Check URL accessibility with HEAD request
     * @param {string} url - URL to check
     * @returns {Promise<object>} - Accessibility status
     */
    async checkUrl(url) {
        try {
            await this.rateLimit();

            const config = {
                ...this.mergeConfig(),
                method: 'HEAD',
                timeout: 5000
            };

            logWithTimestamp(`HTTP HEAD Request: ${url}`);

            const response = await axios(url, config);

            return {
                accessible: true,
                status: response.status,
                contentType: response.headers['content-type'],
                lastModified: response.headers['last-modified'],
                contentLength: response.headers['content-length']
            };

        } catch (error) {
            const status = error.response?.status;

            return {
                accessible: false,
                status: status || 0,
                error: error.message,
                errorType: this.getErrorType(status)
            };
        }
    }

    /**
     * Get site metadata with minimal content fetching
     * @param {string} url - URL to analyze
     * @returns {Promise<object>} - Site metadata
     */
    async getSiteMetadata(url) {
        try {
            // Try HEAD request first for basic info
            const headCheck = await this.checkUrl(url);

            if (!headCheck.accessible) {
                throw new HttpError(`Site not accessible: ${headCheck.error}`, url, headCheck.status);
            }

            // If we need more info, fetch partial content
            const config = this.mergeConfig({
                headers: {
                    ...this.defaultConfig.headers,
                    'Range': 'bytes=0-4095' // Only fetch first 4KB
                }
            });

            try {
                const response = await axios.get(url, config);
                const html = response.data;

                return this.extractBasicMetadata(html, headCheck);

            } catch (rangeError) {
                // If range requests not supported, fallback to full request
                const html = await this.fetchHtml(url);
                return this.extractBasicMetadata(html, headCheck);
            }

        } catch (error) {
            throw new HttpError(`Failed to get site metadata: ${error.message}`, url, error.status || 0, error);
        }
    }

    /**
     * Extract basic metadata from HTML head
     * @param {string} html - HTML content
     * @param {object} headCheck - HEAD request results
     * @returns {object} - Metadata object
     */
    extractBasicMetadata(html, headCheck) {
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);

        return {
            title: $('title').text()?.trim() || 'Untitled',
            description: $('meta[name="description"]').attr('content')?.trim() || '',
            contentType: headCheck.contentType || 'text/html',
            charset: this.extractCharset(html),
            generator: $('meta[name="generator"]').attr('content')?.trim() || '',
            lastModified: headCheck.lastModified
        };
    }

    /**
     * Extract charset from HTML
     * @param {string} html - HTML content
     * @returns {string} - Charset
     */
    extractCharset(html) {
        const charsetMatch = html.match(/<meta[^>]+charset=["\']?([^"\'>\s]+)/i);
        return charsetMatch ? charsetMatch[1] : 'UTF-8';
    }

    /**
     * Get error type from status code
     * @param {number} status - HTTP status code
     * @returns {string} - Error type
     */
    getErrorType(status) {
        if (status >= 400 && status < 500) {
            return 'client_error';
        } else if (status >= 500) {
            return 'server_error';
        } else if (status === 0) {
            return 'network_error';
        }
        return 'unknown_error';
    }

    /**
     * Update internal statistics
     * @param {boolean} success - Whether request was successful
     * @param {number} responseTime - Response time in milliseconds
     */
    updateStats(success, responseTime) {
        this.stats.lastActivity = new Date().toISOString();

        if (success) {
            this.stats.successfulRequests++;
        } else {
            this.stats.failedRequests++;
        }

        // Update average response time
        const totalRequests = this.stats.successfulRequests + this.stats.failedRequests;
        const totalTime = this.stats.averageResponseTime * (totalRequests - 1) + responseTime;
        this.stats.averageResponseTime = Math.round(totalTime / totalRequests);
    }

    /**
     * Get service statistics
     * @returns {object} - Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.getTotalRequests() > 0 ?
                Math.round((this.stats.successfulRequests / this.getTotalRequests()) * 100) : 0,
            retryRate: this.getTotalRequests() > 0 ?
                Math.round((this.stats.retriedRequests / this.getTotalRequests()) * 100) : 0,
            blockedUrlCount: this.blockedUrls.size,
            totalRequests: this.getTotalRequests()
        };
    }

    /**
     * Get total number of requests
     * @returns {number} - Total requests
     */
    getTotalRequests() {
        return this.stats.successfulRequests + this.stats.failedRequests;
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            retriedRequests: 0,
            blockedRequests: 0,
            averageResponseTime: 0,
            lastActivity: null
        };

        this.blockedUrls.clear();
        this.urlFailCounts.clear();
    }

    /**
     * Manually unblock a URL
     * @param {string} url - URL to unblock
     */
    unblockUrl(url) {
        this.blockedUrls.delete(url);
        this.urlFailCounts.delete(url);
        logWithTimestamp(`🔓 Manually unblocked URL: ${url}`);
    }

    /**
     * Get currently blocked URLs
     * @returns {Array} - Array of blocked URLs
     */
    getBlockedUrls() {
        return Array.from(this.blockedUrls);
    }

    /**
     * Set custom User-Agent
     * @param {string} userAgent - User-Agent string
     */
    setUserAgent(userAgent) {
        this.defaultConfig.headers['User-Agent'] = userAgent;
        logWithTimestamp(`Updated User-Agent: ${userAgent}`);
    }

    /**
     * Set rate limit delay
     * @param {number} delay - Delay in milliseconds
     */
    setRateLimit(delay) {
        this.minDelay = delay;
        logWithTimestamp(`Updated rate limit: ${delay}ms`);
    }
}

// Export singleton instance
module.exports = new HttpService();