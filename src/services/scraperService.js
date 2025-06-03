// src/services/scraperService.js (COMPLETE FIXED VERSION)
const httpService = require('./httpService');
const contentParserService = require('./contentParserService');
const advancedRSSDetector = require('./advancedRSSDetector'); // 🆕 FIXED
const { logWithTimestamp, makeAbsoluteUrl } = require('../utils/helpers');
const { ScrapingError, ValidationError } = require('../errors');

/**
 * Scraper Service (FIXED) - Proper URL handling and early exit RSS detection
 * Now correctly handles URL paths and uses fixed RSS detector
 */
class ScraperService {
    constructor() {
        this.httpService = httpService;
        this.parserService = contentParserService;
        this.rssDetector = advancedRSSDetector; // 🆕 FIXED

        // Enhanced statistics tracking
        this.stats = {
            totalRequests: 0,
            successfulScrapes: 0,
            failedScrapes: 0,
            rssDetected: 0,
            rssUsed: 0, // NEW: Track how many times RSS was actually used
            htmlScrapeUsed: 0, // NEW: Track HTML scraping usage
            cacheHits: 0,
            averageResponseTime: 0,
            lastActivity: null
        };
    }

    /**
     * Extract articles from a website
     * Main public method that orchestrates the scraping process
     * @param {string} url - Website URL to scrape (KEEP ORIGINAL PATH!)
     * @param {object} options - Scraping options
     * @returns {Promise<Array>} - Array of article objects
     */
    async extractArticles(url, options = {}) {
        const startTime = Date.now();

        try {
            // Validate URL (but keep original path!)
            this.validateUrl(url);

            logWithTimestamp(`Starting article extraction from: ${url}`);

            // 🔍 STEP 1: Try to find existing RSS feed first (FIXED)
            const rssUrl = await this.findExistingRSSFeed(url);

            if (rssUrl) {
                logWithTimestamp(`✅ Using existing RSS feed: ${rssUrl}`);

                // Parse RSS feed
                const rssContent = await this.fetchRSSContent(rssUrl);
                const articles = await this.parseRSSFeed(rssContent, url);

                // Apply filters
                const filteredArticles = this.applyFilters(articles, options);

                this.stats.rssUsed++;
                this.updateStats(true, Date.now() - startTime);

                logWithTimestamp(`✅ Successfully extracted ${filteredArticles.length} articles from RSS in ${Date.now() - startTime}ms`);
                return filteredArticles;
            }

            // 🔄 STEP 2: Fallback to HTML scraping
            logWithTimestamp(`📄 No RSS found, falling back to HTML scraping for: ${url}`);

            // Fetch HTML content
            const html = await this.fetchHtml(url, options);

            // Parse and extract articles
            const articles = await this.parseArticles(html, url, options);

            // Apply filters
            const filteredArticles = this.applyFilters(articles, options);

            this.stats.htmlScrapeUsed++;
            this.updateStats(true, Date.now() - startTime);

            logWithTimestamp(`✅ Successfully extracted ${filteredArticles.length} articles from HTML in ${Date.now() - startTime}ms`);
            return filteredArticles;

        } catch (error) {
            this.updateStats(false, Date.now() - startTime);
            logWithTimestamp(`❌ Failed to extract articles from ${url}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * 🆕 FIXED: Find existing RSS feed using advanced detection with proper URL handling
     * @param {string} url - Website URL to check for RSS (KEEP ORIGINAL PATH!)
     * @returns {Promise<string|null>} - RSS URL if found, null otherwise
     */
    async findExistingRSSFeed(url) {
        try {
            logWithTimestamp(`🔍 Checking for existing RSS feed at ${url}`);

            // Use the FIXED advanced RSS detector
            const rssUrl = await this.rssDetector.findRSSFeed(url);

            if (rssUrl) {
                this.stats.rssDetected++;
                logWithTimestamp(`✅ RSS feed found: ${rssUrl}`);
                return rssUrl;
            }

            logWithTimestamp(`❌ No RSS feed found for ${url}`);
            return null;

        } catch (error) {
            logWithTimestamp(`⚠️  RSS detection error for ${url}: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * Parse RSS feed content into articles
     * @param {string} rssContent - RSS XML content
     * @param {string} baseUrl - Base URL for resolving relative links
     * @returns {Promise<Array>} - Array of articles
     */
    async parseRSSFeed(rssContent, baseUrl) {
        try {
            const xml2js = require('xml2js');
            const parser = new xml2js.Parser({ explicitArray: false });

            const result = await parser.parseStringPromise(rssContent);

            // Handle both RSS and Atom feeds
            let items = [];

            if (result.rss && result.rss.channel && result.rss.channel.item) {
                // RSS 2.0 format
                items = Array.isArray(result.rss.channel.item) ?
                    result.rss.channel.item : [result.rss.channel.item];
            } else if (result.feed && result.feed.entry) {
                // Atom format
                items = Array.isArray(result.feed.entry) ?
                    result.feed.entry : [result.feed.entry];
            }

            const articles = items.map(item => this.parseRSSItem(item, baseUrl));

            logWithTimestamp(`📰 Parsed ${articles.length} articles from RSS feed`);
            return articles;

        } catch (error) {
            throw new ScrapingError(`Failed to parse RSS feed: ${error.message}`, baseUrl, error);
        }
    }

    /**
     * Parse individual RSS item into article format
     * @param {object} item - RSS item object
     * @param {string} baseUrl - Base URL
     * @returns {object} - Article object
     */
    parseRSSItem(item, baseUrl) {
        // Handle both RSS and Atom formats
        const title = item.title?.$text || item.title || '';
        const description = item.description?.$text || item.description ||
            item.summary?.$text || item.summary || '';
        const link = item.link?.href || item.link || item.guid?.$text || item.guid || '';
        const pubDate = item.pubDate || item.published || item['dc:date'] || '';

        // Extract image if available
        let imageUrl = '';
        if (item.enclosure && item.enclosure.$.type?.startsWith('image/')) {
            imageUrl = item.enclosure.$.url;
        } else if (item['media:content'] && item['media:content'].$.type?.startsWith('image/')) {
            imageUrl = item['media:content'].$.url;
        } else if (item['media:thumbnail']) {
            imageUrl = item['media:thumbnail'].$.url;
        }

        return {
            title: title.trim(),
            description: description.trim(),
            url: makeAbsoluteUrl(link, baseUrl),
            publishedDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            imageUrl: imageUrl ? makeAbsoluteUrl(imageUrl, baseUrl) : '',
            source: 'RSS',
            category: item.category?.$text || item.category || ''
        };
    }

    /**
     * Get RSS feed content with validation
     * @param {string} rssUrl - RSS feed URL
     * @returns {Promise<string>} - RSS XML content
     */
    async fetchRSSContent(rssUrl) {
        try {
            logWithTimestamp(`📡 Fetching RSS content from ${rssUrl}`);

            const rssContent = await this.httpService.fetchHtml(rssUrl, {
                headers: {
                    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
                }
            });

            if (!rssContent || rssContent.length < 100) {
                throw new ScrapingError('RSS content is too short or empty', rssUrl);
            }

            // Basic validation
            if (!rssContent.includes('<rss') && !rssContent.includes('<feed')) {
                throw new ScrapingError('Content does not appear to be valid RSS/Atom feed', rssUrl);
            }

            logWithTimestamp(`✅ Successfully fetched RSS content (${rssContent.length} characters)`);
            return rssContent;

        } catch (error) {
            throw new ScrapingError(`Failed to fetch RSS content: ${error.message}`, rssUrl, error);
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
     * 🆕 ENHANCED: Check if a website is scrapeable with advanced RSS detection
     * @param {string} url - Website URL
     * @returns {Promise<object>} - Enhanced accessibility status
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

            // 🆕 FIXED RSS detection
            const rssUrl = await this.findExistingRSSFeed(url);
            const detectionStats = this.rssDetector.getStats();

            if (rssUrl) {
                return {
                    accessible: true,
                    canScrape: true,
                    hasRSSFeed: true,
                    rssUrl: rssUrl,
                    recommendedMethod: 'Use existing RSS feed',
                    contentType: headCheck.contentType,
                    details: headCheck,
                    advancedDetection: {
                        detectorStats: detectionStats,
                        supportedDomains: Object.keys(this.rssDetector.domainRules || {}).length
                    }
                };
            }

            // If no RSS, try to fetch and parse a small sample
            try {
                const html = await this.fetchHtml(url);
                const articles = await this.parseArticles(html, url);

                return {
                    accessible: true,
                    canScrape: true,
                    hasRSSFeed: false,
                    articleCount: articles.length,
                    recommendedMethod: 'Scrape articles from HTML',
                    contentType: headCheck.contentType,
                    details: headCheck,
                    advancedDetection: {
                        detectorStats: detectionStats,
                        attemptedStrategies: 5 // Number of strategies tried
                    }
                };

            } catch (parseError) {
                return {
                    accessible: true,
                    canScrape: false,
                    hasRSSFeed: false,
                    reason: 'Could not extract articles from this website',
                    error: parseError.message,
                    details: headCheck,
                    advancedDetection: {
                        detectorStats: detectionStats
                    }
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
     * 🆕 ENHANCED: Get comprehensive scraping statistics
     * @returns {object} - Enhanced statistics object
     */
    getStats() {
        const detectorStats = this.rssDetector.getStats();

        return {
            ...this.stats,
            successRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.successfulScrapes / this.stats.totalRequests) * 100) : 0,
            rssDetectionRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.rssDetected / this.stats.totalRequests) * 100) : 0,
            rssUsageRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.rssUsed / this.stats.totalRequests) * 100) : 0,

            // Advanced detection stats
            advancedDetection: {
                ...detectorStats,
                methodBreakdown: {
                    htmlHead: detectorStats.htmlHeadDetection,
                    domainRules: detectorStats.domainRuleDetection,
                    urlPattern: detectorStats.urlPatternDetection,
                    commonPaths: detectorStats.commonPathDetection,
                    wordpress: detectorStats.wordpressDetection
                }
            },

            // Usage breakdown
            usageBreakdown: {
                rssUsed: this.stats.rssUsed,
                htmlScrapeUsed: this.stats.htmlScrapeUsed,
                cacheHits: this.stats.cacheHits
            }
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
            rssDetected: 0,
            rssUsed: 0,
            htmlScrapeUsed: 0,
            cacheHits: 0,
            averageResponseTime: 0,
            lastActivity: null
        };

        // Reset detector stats as well
        this.rssDetector.resetStats();
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
     * 🆕 Add custom RSS detection rule for a domain
     * @param {string} domain - Domain name
     * @param {Array} patterns - RSS URL patterns
     */
    addRSSDetectionRule(domain, patterns) {
        this.rssDetector.addDomainRule(domain, patterns);
        logWithTimestamp(`Added RSS detection rule for domain: ${domain}`);
    }

    /**
     * Get current service configuration
     * @returns {object} - Configuration object
     */
    getConfig() {
        return {
            httpService: this.httpService.getStats(),
            supportedSites: Object.keys(this.parserService.siteRules || {}),
            rssDetector: {
                supportedDomains: Object.keys(this.rssDetector.domainRules || {}),
                strategies: 5, // Number of active strategies
                cacheSize: this.rssDetector.rssCache ? this.rssDetector.rssCache.size : 0
            },
            stats: this.getStats()
        };
    }
}

// Export singleton instance
module.exports = new ScraperService();