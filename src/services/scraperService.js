// src/services/scraperService.js
const httpService = require('./httpService');
const contentParserService = require('./contentParserService');
const { logWithTimestamp } = require('../utils/helpers');
const { ScrapingError, ValidationError } = require('../errors');

/**
 * Scraper Service (Refactored)
 * Orchestrates HTTP fetching and content parsing with proper separation of concerns
 */
class ScraperService {
    constructor() {
        this.httpService = httpService;
        this.parserService = contentParserService;

        // Statistics tracking
        this.stats = {
            totalRequests: 0,
            successfulScrapes: 0,
            failedScrapes: 0,
            averageResponseTime: 0,
            lastActivity: null
        };
    }

    /**
     * Extract articles from a website
     * Main public method that orchestrates the scraping process
     * @param {string} url - Website URL to scrape
     * @param {object} options - Scraping options
     * @returns {Promise<Array>} - Array of article objects
     */
    async extractArticles(url, options = {}) {
        const startTime = Date.now();

        try {
            // Validate URL
            this.validateUrl(url);

            logWithTimestamp(`Starting article extraction from: ${url}`);

            // Fetch HTML content
            const html = await this.fetchHtml(url, options);

            // Parse and extract articles
            const articles = await this.parseArticles(html, url, options);

            // Update statistics
            this.updateStats(true, Date.now() - startTime);

            logWithTimestamp(`Successfully extracted ${articles.length} articles from ${url} in ${Date.now() - startTime}ms`);

            return articles;

        } catch (error) {
            this.updateStats(false, Date.now() - startTime);
            logWithTimestamp(`Failed to extract articles from ${url}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Fetch HTML content using HTTP service
     * @param {string} url - URL to fetch
     * @param {object} options - Fetch options
     * @returns {Promise<string>} - HTML content
     */
    async fetchHtml(url, options = {}) {
        try {
            const html = await this.httpService.fetchHtml(url, options);

            if (!html || html.trim().length === 0) {
                throw new ScrapingError('Empty response received', url);
            }

            return html;

        } catch (error) {
            throw new ScrapingError(`Failed to fetch HTML: ${error.message}`, url, error);
        }
    }

    /**
     * Parse HTML and extract articles using content parser
     * @param {string} html - HTML content
     * @param {string} baseUrl - Base URL for resolving relative links
     * @param {object} options - Parsing options
     * @returns {Promise<Array>} - Array of articles
     */
    async parseArticles(html, baseUrl, options = {}) {
        try {
            const articles = this.parserService.parseArticles(html, baseUrl);

            // Apply filters if specified
            return this.applyFilters(articles, options);

        } catch (error) {
            throw new ScrapingError(`Failed to parse articles: ${error.message}`, baseUrl, error);
        }
    }

    /**
     * Get site metadata
     * @param {string} url - Website URL
     * @returns {Promise<object>} - Site metadata
     */
    async getSiteMetadata(url) {
        try {
            this.validateUrl(url);

            // Try to get metadata with minimal content first
            const metadata = await this.httpService.getSiteMetadata(url);

            if (metadata.title && metadata.description) {
                return {
                    url,
                    title: metadata.title,
                    description: metadata.description,
                    contentType: metadata.contentType,
                    charset: metadata.charset,
                    generator: metadata.generator,
                    language: 'en', // Will be extracted from full HTML if needed
                    lastUpdated: new Date().toISOString()
                };
            }

            // Fallback: fetch full HTML and extract metadata
            const html = await this.fetchHtml(url);
            const fullMetadata = this.parserService.extractSiteMetadata(html, url);

            return {
                url,
                ...fullMetadata,
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            throw new ScrapingError(`Failed to get site metadata: ${error.message}`, url, error);
        }
    }

    /**
     * Check if a website is scrapeable
     * @param {string} url - Website URL
     * @returns {Promise<object>} - Accessibility status
     */
    async checkWebsiteAccessibility(url) {
        try {
            this.validateUrl(url);

            // First, check with HEAD request
            const headCheck = await this.httpService.checkUrl(url);

            if (!headCheck.accessible) {
                return {
                    accessible: false,
                    canScrape: false,
                    reason: headCheck.error,
                    details: headCheck
                };
            }

            // If accessible, try to fetch and parse a small sample
            try {
                const html = await this.fetchHtml(url);
                const articles = await this.parseArticles(html, url);

                return {
                    accessible: true,
                    canScrape: true,
                    articleCount: articles.length,
                    contentType: headCheck.contentType,
                    details: headCheck
                };

            } catch (parseError) {
                return {
                    accessible: true,
                    canScrape: false,
                    reason: 'Could not extract articles from this website',
                    error: parseError.message,
                    details: headCheck
                };
            }

        } catch (error) {
            return {
                accessible: false,
                canScrape: false,
                reason: 'Failed to access website',
                error: error.message
            };
        }
    }

    /**
     * Scrape multiple URLs concurrently
     * @param {Array<string>} urls - Array of URLs to scrape
     * @param {object} options - Scraping options
     * @returns {Promise<Array>} - Array of results
     */
    async scrapeMultiple(urls, options = {}) {
        const { concurrency = 3, continueOnError = true } = options;
        const results = [];

        logWithTimestamp(`Starting concurrent scraping of ${urls.length} URLs with concurrency ${concurrency}`);

        // Process URLs in chunks
        for (let i = 0; i < urls.length; i += concurrency) {
            const chunk = urls.slice(i, i + concurrency);

            const chunkPromises = chunk.map(async (url) => {
                try {
                    const articles = await this.extractArticles(url, options);
                    return { url, success: true, articles, error: null };
                } catch (error) {
                    if (!continueOnError) {
                        throw error;
                    }
                    return { url, success: false, articles: [], error: error.message };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        const successful = results.filter(r => r.success).length;
        logWithTimestamp(`Completed scraping: ${successful}/${urls.length} successful`);

        return results;
    }

    /**
     * Apply filters to articles
     * @param {Array} articles - Articles to filter
     * @param {object} options - Filter options
     * @returns {Array} - Filtered articles
     */
    applyFilters(articles, options) {
        let filtered = [...articles];

        // Filter by keyword
        if (options.keyword) {
            const keyword = options.keyword.toLowerCase();
            filtered = filtered.filter(article =>
                article.title.toLowerCase().includes(keyword) ||
                article.description.toLowerCase().includes(keyword)
            );
        }

        // Filter by date range
        if (options.dateFrom || options.dateTo) {
            filtered = filtered.filter(article => {
                const articleDate = new Date(article.publishedDate);

                if (options.dateFrom && articleDate < new Date(options.dateFrom)) {
                    return false;
                }

                if (options.dateTo && articleDate > new Date(options.dateTo)) {
                    return false;
                }

                return true;
            });
        }

        // Limit results
        if (options.limit && options.limit > 0) {
            filtered = filtered.slice(0, options.limit);
        }

        return filtered;
    }

    /**
     * Validate URL format and security
     * @param {string} url - URL to validate
     */
    validateUrl(url) {
        if (!url || typeof url !== 'string') {
            throw new ValidationError('URL must be a non-empty string');
        }

        try {
            const urlObj = new URL(url);

            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                throw new ValidationError('Only HTTP and HTTPS protocols are supported');
            }

        } catch (error) {
            throw new ValidationError(`Invalid URL format: ${error.message}`);
        }
    }

    /**
     * Update internal statistics
     * @param {boolean} success - Whether operation was successful
     * @param {number} responseTime - Response time in milliseconds
     */
    updateStats(success, responseTime) {
        this.stats.totalRequests++;
        this.stats.lastActivity = new Date().toISOString();

        if (success) {
            this.stats.successfulScrapes++;
        } else {
            this.stats.failedScrapes++;
        }

        // Update average response time
        const totalTime = this.stats.averageResponseTime * (this.stats.totalRequests - 1) + responseTime;
        this.stats.averageResponseTime = Math.round(totalTime / this.stats.totalRequests);
    }

    /**
     * Get scraping statistics
     * @returns {object} - Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.successfulScrapes / this.stats.totalRequests) * 100) : 0
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            successfulScrapes: 0,
            failedScrapes: 0,
            averageResponseTime: 0,
            lastActivity: null
        };
    }

    /**
     * Add custom parsing rules for a specific domain
     * @param {string} domain - Domain name
     * @param {object} rules - Parsing rules
     */
    addParsingRules(domain, rules) {
        this.parserService.addSiteRules(domain, rules);
        logWithTimestamp(`Added custom parsing rules for domain: ${domain}`);
    }

    /**
     * Get current service configuration
     * @returns {object} - Configuration object
     */
    getConfig() {
        return {
            httpService: this.httpService.getStats(),
            supportedSites: Object.keys(this.parserService.siteRules),
            stats: this.getStats()
        };
    }
}

// Export singleton instance
module.exports = new ScraperService();