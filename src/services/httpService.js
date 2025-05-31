// src/services/httpService.js
const axios = require('axios');
const config = require('../../config');
const { logWithTimestamp, retryWithBackoff } = require('../utils/helpers');
const { FetchError, TimeoutError, ErrorFactory } = require('../errors');

/**
 * HTTP Service
 * Handles all HTTP requests with proper error handling, retries, and logging
 */
class HttpService {
    constructor() {
        // Create axios instance with default configuration
        this.httpClient = axios.create({
            timeout: config.scraping.timeout,
            maxRedirects: 5,
            headers: {
                'User-Agent': config.scraping.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            // Response size limit (10MB)
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024
        });

        // Setup interceptors
        this.setupInterceptors();
    }

    /**
     * Setup axios interceptors for logging and error handling
     */
    setupInterceptors() {
        // Request interceptor
        this.httpClient.interceptors.request.use(
            (config) => {
                logWithTimestamp(`HTTP Request: ${config.method?.toUpperCase()} ${config.url}`);
                config.startTime = Date.now();
                return config;
            },
            (error) => {
                logWithTimestamp(`HTTP Request Error: ${error.message}`, 'error');
                return Promise.reject(error);
            }
        );

        // Response interceptor
        this.httpClient.interceptors.response.use(
            (response) => {
                const duration = Date.now() - response.config.startTime;
                const size = this.getResponseSize(response);

                logWithTimestamp(
                    `HTTP Response: ${response.status} ${response.config.url} - ${duration}ms - ${size} bytes`
                );

                return response;
            },
            (error) => {
                const duration = error.config?.startTime ? Date.now() - error.config.startTime : 0;

                logWithTimestamp(
                    `HTTP Error: ${error.message} - ${error.config?.url} - ${duration}ms`,
                    'error'
                );

                return Promise.reject(error);
            }
        );
    }

    /**
     * Get response size in a human-readable format
     */
    getResponseSize(response) {
        const contentLength = response.headers['content-length'];
        if (contentLength) {
            const bytes = parseInt(contentLength);
            if (bytes < 1024) return `${bytes}B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
        }
        return 'unknown';
    }

    /**
     * Fetch HTML content from URL with retries and proper error handling
     * @param {string} url - URL to fetch
     * @param {object} options - Additional options
     * @returns {Promise<string>} - HTML content
     */
    async fetchHtml(url, options = {}) {
        try {
            const response = await retryWithBackoff(async () => {
                return await this.httpClient.get(url, {
                    ...options,
                    validateStatus: (status) => status < 400, // Only retry on 4xx/5xx
                });
            }, 3, 1000);

            // Validate response
            this.validateResponse(url, response);

            return response.data;

        } catch (error) {
            // Convert to appropriate error type
            throw ErrorFactory.fromAxiosError(error, url);
        }
    }

    /**
     * Fetch with custom headers (for specific sites)
     * @param {string} url - URL to fetch
     * @param {object} customHeaders - Custom headers
     * @returns {Promise<string>} - HTML content
     */
    async fetchWithHeaders(url, customHeaders = {}) {
        const headers = {
            ...this.httpClient.defaults.headers,
            ...customHeaders
        };

        return this.fetchHtml(url, { headers });
    }

    /**
     * Fetch multiple URLs concurrently
     * @param {Array<string>} urls - Array of URLs
     * @param {number} concurrency - Max concurrent requests
     * @returns {Promise<Array>} - Array of results with {url, html, error}
     */
    async fetchMultiple(urls, concurrency = 3) {
        const results = [];
        const chunks = this.chunkArray(urls, concurrency);

        for (const chunk of chunks) {
            const promises = chunk.map(async (url) => {
                try {
                    const html = await this.fetchHtml(url);
                    return { url, html, error: null };
                } catch (error) {
                    return { url, html: null, error: error.message };
                }
            });

            const chunkResults = await Promise.all(promises);
            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * Check if URL is accessible without fetching full content
     * @param {string} url - URL to check
     * @returns {Promise<object>} - Status information
     */
    async checkUrl(url) {
        try {
            const response = await this.httpClient.head(url, {
                timeout: 5000 // Shorter timeout for head requests
            });

            return {
                accessible: true,
                statusCode: response.status,
                contentType: response.headers['content-type'],
                contentLength: response.headers['content-length'],
                lastModified: response.headers['last-modified'],
                server: response.headers['server']
            };

        } catch (error) {
            if (error.response) {
                return {
                    accessible: false,
                    statusCode: error.response.status,
                    error: `HTTP ${error.response.status}: ${error.response.statusText}`
                };
            } else {
                return {
                    accessible: false,
                    error: error.message
                };
            }
        }
    }

    /**
     * Get site metadata without full content
     * @param {string} url - URL to analyze
     * @returns {Promise<object>} - Site metadata
     */
    async getSiteMetadata(url) {
        try {
            // Fetch only first few KB for metadata
            const response = await this.httpClient.get(url, {
                headers: {
                    ...this.httpClient.defaults.headers,
                    'Range': 'bytes=0-8192' // First 8KB should contain head section
                },
                validateStatus: (status) => status === 200 || status === 206 // Accept partial content
            });

            const html = response.data;
            const cheerio = require('cheerio');
            const $ = cheerio.load(html);

            return {
                title: $('title').first().text().trim(),
                description: $('meta[name="description"]').attr('content'),
                ogTitle: $('meta[property="og:title"]').attr('content'),
                ogDescription: $('meta[property="og:description"]').attr('content'),
                contentType: response.headers['content-type'],
                charset: this.extractCharset(response.headers['content-type']),
                generator: $('meta[name="generator"]').attr('content'),
                viewport: $('meta[name="viewport"]').attr('content')
            };

        } catch (error) {
            // Fallback to regular fetch if range request fails
            if (error.response?.status === 416) {
                const html = await this.fetchHtml(url);
                const cheerio = require('cheerio');
                const $ = cheerio.load(html.substring(0, 8192)); // Limit processing

                return {
                    title: $('title').first().text().trim(),
                    description: $('meta[name="description"]').attr('content'),
                    ogTitle: $('meta[property="og:title"]').attr('content'),
                    ogDescription: $('meta[property="og:description"]').attr('content')
                };
            }

            throw ErrorFactory.fromAxiosError(error, url);
        }
    }

    /**
     * Validate HTTP response
     */
    validateResponse(url, response) {
        if (!response) {
            throw new FetchError(url, 0, 'No response received');
        }

        if (response.status < 200 || response.status >= 400) {
            throw new FetchError(url, response.status, response.statusText);
        }

        // Check content type
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xml')) {
            logWithTimestamp(
                `Warning: Unexpected content type for ${url}: ${contentType}`,
                'warn'
            );
        }

        // Check if response is too small (might be error page)
        const content = response.data;
        if (typeof content === 'string' && content.length < 500) {
            logWithTimestamp(
                `Warning: Very small response from ${url}: ${content.length} characters`,
                'warn'
            );
        }
    }

    /**
     * Extract charset from content-type header
     */
    extractCharset(contentType) {
        if (!contentType) return 'utf-8';

        const match = contentType.match(/charset=([^;,\s]+)/i);
        return match ? match[1] : 'utf-8';
    }

    /**
     * Split array into chunks
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Update user agent for specific site
     * @param {string} userAgent - New user agent
     */
    setUserAgent(userAgent) {
        this.httpClient.defaults.headers['User-Agent'] = userAgent;
    }

    /**
     * Get current HTTP client statistics
     */
    getStats() {
        return {
            timeout: this.httpClient.defaults.timeout,
            maxRedirects: this.httpClient.defaults.maxRedirects,
            userAgent: this.httpClient.defaults.headers['User-Agent'],
            maxContentLength: this.httpClient.defaults.maxContentLength
        };
    }
}

// Export singleton instance
module.exports = new HttpService();