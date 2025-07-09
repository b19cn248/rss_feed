// src/services/scraperService.js (UPDATED WITH ENHANCED RSS DETECTOR)
const httpService = require('./httpService');
const contentParserService = require('./contentParserService');
const enhancedRSSDetector = require('./enhancedRSSDetector'); // 🆕 UPDATED IMPORT
const { logWithTimestamp, makeAbsoluteUrl } = require('../utils/helpers');
const { ScrapingError, ValidationError } = require('../errors');

/**
 * Scraper Service (ENHANCED) - Updated with Enhanced RSS Detection
 * Now supports comprehensive RSS detection for Vietnamese and international sites
 */
class ScraperService {
    constructor() {
        this.httpService = httpService;
        this.parserService = contentParserService;
        this.rssDetector = enhancedRSSDetector; // 🆕 ENHANCED DETECTOR

        // Enhanced statistics tracking
        this.stats = {
            totalRequests: 0,
            successfulScrapes: 0,
            failedScrapes: 0,
            rssDetected: 0,
            rssUsed: 0,
            htmlScrapeUsed: 0,
            cacheHits: 0,
            vietnameseSitesProcessed: 0, // 🆕 Track Vietnamese sites
            internationalSitesProcessed: 0, // 🆕 Track international sites
            averageResponseTime: 0,
            lastActivity: null
        };

        // 🆕 Vietnamese domains tracking for analytics
        this.vietnameseDomains = new Set([
            'vnexpress.net', 'tuoitre.vn', 'thanhnien.vn', 'dantri.com.vn',
            'laodong.vn', 'nhandan.vn', 'tienphong.vn', 'kenh14.vn',
            'zingnews.vn', 'vietnamnet.vn', 'cand.com.vn', 'baomoi.com',
            'soha.vn', 'cafef.vn', 'vietnamplus.vn', 'vov.vn'
        ]);
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

            // Track site type for analytics
            const domain = this.extractDomain(url);
            if (this.vietnameseDomains.has(domain)) {
                this.stats.vietnameseSitesProcessed++;
            } else {
                this.stats.internationalSitesProcessed++;
            }

            logWithTimestamp(`🚀 Starting article extraction from: ${url} (${this.getSiteType(domain)})`);

            // 🔍 STEP 1: Try to find existing RSS feed first (ENHANCED)
            const rssUrl = await this.findExistingRSSFeed(url);

            if (rssUrl) {
                logWithTimestamp(`✅ Using existing RSS feed: ${rssUrl}`);

                try {
                    // Parse RSS feed
                    const rssContent = await this.fetchRSSContent(rssUrl);
                    const articles = await this.parseRSSFeed(rssContent, url);

                    // Apply filters
                    const filteredArticles = this.applyFilters(articles, options);

                    this.stats.rssUsed++;
                    this.updateStats(true, Date.now() - startTime);

                    logWithTimestamp(`✅ Successfully extracted ${filteredArticles.length} articles from RSS in ${Date.now() - startTime}ms`);
                    return filteredArticles;

                } catch (rssError) {
                    // Log RSS error but continue with HTML scraping
                    logWithTimestamp(`⚠️ RSS parsing failed for ${rssUrl}: ${rssError.message}, falling back to HTML scraping`, 'warn');
                }
            }

            // 🔄 STEP 2: Fallback to HTML scraping
            logWithTimestamp(`📄 No valid RSS found, falling back to HTML scraping for: ${url}`);

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
     * 🆕 ENHANCED: Find existing RSS feed using enhanced detection
     * @param {string} url - Website URL to check for RSS
     * @returns {Promise<string|null>} - RSS URL if found, null otherwise
     */
    async findExistingRSSFeed(url) {
        try {
            const domain = this.extractDomain(url);
            logWithTimestamp(`🔍 [Enhanced] Checking for existing RSS feed at ${url} (${this.getSiteType(domain)})`);

            // Use the ENHANCED RSS detector
            const rssUrl = await this.rssDetector.findRSSFeed(url);

            if (rssUrl) {
                this.stats.rssDetected++;
                logWithTimestamp(`✅ Enhanced RSS detection success: ${rssUrl}`);
                return rssUrl;
            }

            logWithTimestamp(`❌ No RSS feed found for ${url} after enhanced detection`);
            return null;

        } catch (error) {
            logWithTimestamp(`⚠️ Enhanced RSS detection error for ${url}: ${error.message}`, 'warn');
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
            const parser = new xml2js.Parser({
                explicitArray: false,
                ignoreAttrs: false,
                mergeAttrs: true
            });

            const result = await parser.parseStringPromise(rssContent);

            // Handle both RSS and Atom feeds
            let items = [];
            let feedTitle = '';
            let feedDescription = '';

            if (result.rss && result.rss.channel) {
                // RSS 2.0 format
                const channel = result.rss.channel;
                feedTitle = channel.title || '';
                feedDescription = channel.description || '';

                if (channel.item) {
                    items = Array.isArray(channel.item) ? channel.item : [channel.item];
                }
            } else if (result.feed) {
                // Atom format
                const feed = result.feed;
                feedTitle = feed.title?.$text || feed.title || '';
                feedDescription = feed.subtitle?.$text || feed.subtitle || '';

                if (feed.entry) {
                    items = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
                }
            }

            const articles = items.map(item => this.parseRSSItem(item, baseUrl));

            // Filter out invalid articles
            const validArticles = articles.filter(article =>
                article.title && article.title.length > 5 &&
                article.url && article.description
            );

            logWithTimestamp(`📰 Parsed ${validArticles.length}/${items.length} valid articles from RSS feed "${feedTitle}"`);
            return validArticles;

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
        try {
            // Handle both RSS and Atom formats with better parsing
            const title = this.extractTextFromField(item.title);
            const description = this.extractTextFromField(item.description || item.summary || item.content);
            const link = this.extractLinkFromField(item.link || item.guid);
            const pubDate = item.pubDate || item.published || item['dc:date'] || item.updated || '';
            const author = this.extractTextFromField(item.author || item['dc:creator']);
            const category = this.extractTextFromField(item.category);

            // Extract image with enhanced logic
            let imageUrl = '';

            // Try various image sources
            if (item.enclosure && item.enclosure.type?.startsWith('image/')) {
                imageUrl = item.enclosure.url;
            } else if (item['media:content'] && item['media:content'].type?.startsWith('image/')) {
                imageUrl = item['media:content'].url;
            } else if (item['media:thumbnail']) {
                imageUrl = item['media:thumbnail'].url;
            } else if (item.image) {
                imageUrl = typeof item.image === 'string' ? item.image : item.image.url;
            }

            // Parse publication date with better handling
            let publishedDate = new Date();
            if (pubDate) {
                try {
                    publishedDate = new Date(pubDate);
                    if (isNaN(publishedDate.getTime())) {
                        publishedDate = new Date();
                    }
                } catch (dateError) {
                    publishedDate = new Date();
                }
            }

            return {
                title: title.trim(),
                description: description.trim(),
                url: makeAbsoluteUrl(link, baseUrl),
                publishedDate: publishedDate.toISOString(),
                imageUrl: imageUrl ? makeAbsoluteUrl(imageUrl, baseUrl) : '',
                author: author || '',
                category: category || '',
                source: 'RSS',
                guid: item.guid?.$text || item.guid || item.id || link
            };

        } catch (error) {
            logWithTimestamp(`⚠️ Error parsing RSS item: ${error.message}`, 'warn');
            return {
                title: 'Error parsing article',
                description: '',
                url: baseUrl,
                publishedDate: new Date().toISOString(),
                imageUrl: '',
                author: '',
                category: '',
                source: 'RSS',
                guid: Date.now().toString()
            };
        }
    }

    /**
     * 🆕 Enhanced text extraction from RSS fields
     */
    extractTextFromField(field) {
        if (!field) return '';

        if (typeof field === 'string') return field;
        if (field.$text) return field.$text;
        if (field._) return field._;
        if (field.content) return field.content;

        return String(field);
    }

    /**
     * 🆕 Enhanced link extraction from RSS fields
     */
    extractLinkFromField(field) {
        if (!field) return '';

        if (typeof field === 'string') return field;
        if (field.href) return field.href;
        if (field.$text) return field.$text;
        if (field._) return field._;

        return String(field);
    }

    /**
     * Get RSS feed content with enhanced validation
     * @param {string} rssUrl - RSS feed URL
     * @returns {Promise<string>} - RSS XML content
     */
    async fetchRSSContent(rssUrl) {
        try {
            logWithTimestamp(`📡 Fetching RSS content from ${rssUrl}`);

            const rssContent = await this.httpService.fetchHtml(rssUrl, {
                timeout: 10000, // 10 second timeout for RSS
                maxRedirects: 5,
                headers: {
                    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
                    'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader Bot/1.0; +http://example.com/bot)',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
                }
            });

            if (!rssContent || rssContent.length < 100) {
                throw new ScrapingError('RSS content is too short or empty', rssUrl);
            }

            // Enhanced RSS validation
            const content = rssContent.toLowerCase();
            const hasRSSStructure =
                content.includes('<rss') ||
                content.includes('<feed') ||
                content.includes('<channel>') ||
                content.includes('xmlns="http://www.w3.org/2005/atom"');

            if (!hasRSSStructure) {
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
            const html = await this.httpService.fetchHtml(url, {
                timeout: 8000,
                maxRedirects: 3,
                headers: {
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                    ...options.headers
                },
                ...options
            });

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
     * Get site metadata with enhanced information
     * @param {string} url - Website URL
     * @returns {Promise<object>} - Site metadata
     */
    async getSiteMetadata(url) {
        try {
            this.validateUrl(url);

            const domain = this.extractDomain(url);
            const siteType = this.getSiteType(domain);

            // Try to get metadata with minimal content first
            const metadata = await this.httpService.getSiteMetadata(url);

            if (metadata.title && metadata.description) {
                return {
                    url,
                    domain,
                    siteType,
                    title: metadata.title,
                    description: metadata.description,
                    contentType: metadata.contentType,
                    charset: metadata.charset,
                    generator: metadata.generator,
                    language: this.detectLanguage(domain),
                    lastUpdated: new Date().toISOString(),
                    isVietnamese: this.vietnameseDomains.has(domain)
                };
            }

            // Fallback: fetch full HTML and extract metadata
            const html = await this.fetchHtml(url);
            const fullMetadata = this.parserService.extractSiteMetadata(html, url);

            return {
                url,
                domain,
                siteType,
                ...fullMetadata,
                language: this.detectLanguage(domain),
                lastUpdated: new Date().toISOString(),
                isVietnamese: this.vietnameseDomains.has(domain)
            };

        } catch (error) {
            throw new ScrapingError(`Failed to get site metadata: ${error.message}`, url, error);
        }
    }

    /**
     * 🆕 ENHANCED: Check if a website is scrapeable with advanced RSS detection info
     * @param {string} url - Website URL
     * @returns {Promise<object>} - Enhanced accessibility status
     */
    async checkWebsiteAccessibility(url) {
        try {
            this.validateUrl(url);

            const domain = this.extractDomain(url);
            const siteType = this.getSiteType(domain);

            // First, check with HEAD request
            const headCheck = await this.httpService.checkUrl(url);

            if (!headCheck.accessible) {
                return {
                    accessible: false,
                    canScrape: false,
                    reason: headCheck.error,
                    domain,
                    siteType,
                    details: headCheck
                };
            }

            // 🆕 ENHANCED RSS detection with detailed info
            const rssUrl = await this.findExistingRSSFeed(url);
            const detectionStats = this.rssDetector.getStats();

            if (rssUrl) {
                // Validate the RSS feed
                let rssValid = false;
                let rssArticleCount = 0;

                try {
                    const rssContent = await this.fetchRSSContent(rssUrl);
                    const articles = await this.parseRSSFeed(rssContent, url);
                    rssValid = true;
                    rssArticleCount = articles.length;
                } catch (rssError) {
                    logWithTimestamp(`RSS validation failed: ${rssError.message}`, 'warn');
                }

                return {
                    accessible: true,
                    canScrape: true,
                    hasRSSFeed: true,
                    rssUrl: rssUrl,
                    rssValid: rssValid,
                    rssArticleCount: rssArticleCount,
                    recommendedMethod: 'Use existing RSS feed',
                    domain,
                    siteType,
                    contentType: headCheck.contentType,
                    details: headCheck,
                    enhancedDetection: {
                        detectorStats: detectionStats,
                        supportedDomains: Object.keys(this.rssDetector.domainRules || {}).length,
                        isVietnameseSite: this.vietnameseDomains.has(domain)
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
                    domain,
                    siteType,
                    contentType: headCheck.contentType,
                    details: headCheck,
                    enhancedDetection: {
                        detectorStats: detectionStats,
                        attemptedStrategies: 5,
                        isVietnameseSite: this.vietnameseDomains.has(domain)
                    }
                };

            } catch (parseError) {
                return {
                    accessible: true,
                    canScrape: false,
                    hasRSSFeed: false,
                    reason: 'Could not extract articles from this website',
                    error: parseError.message,
                    domain,
                    siteType,
                    details: headCheck,
                    enhancedDetection: {
                        detectorStats: detectionStats,
                        isVietnameseSite: this.vietnameseDomains.has(domain)
                    }
                };
            }

        } catch (error) {
            return {
                accessible: false,
                canScrape: false,
                reason: 'Failed to access website',
                error: error.message,
                domain: this.extractDomain(url),
                siteType: 'unknown'
            };
        }
    }

    /**
     * Apply filters to articles with enhanced options
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

        // Filter by category
        if (options.category) {
            const category = options.category.toLowerCase();
            filtered = filtered.filter(article =>
                article.category && article.category.toLowerCase().includes(category)
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

        // Filter by minimum content length
        if (options.minContentLength) {
            filtered = filtered.filter(article =>
                article.description.length >= options.minContentLength
            );
        }

        // Sort by date (newest first) unless specified otherwise
        if (options.sortBy !== false) {
            filtered.sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));
        }

        // Limit results
        if (options.limit && options.limit > 0) {
            filtered = filtered.slice(0, options.limit);
        }

        return filtered;
    }

    /**
     * 🆕 RSS Detection Management Methods
     */

    /**
     * Clear RSS detection cache for debugging
     * @param {string} url - Optional URL to clear, if null clears all
     */
    clearRSSCache(url = null) {
        if (this.rssDetector && this.rssDetector.clearFailedCache) {
            this.rssDetector.clearFailedCache(url);
            logWithTimestamp(`🧹 Cleared RSS detection cache${url ? ` for ${url}` : ' (all)'}`);
        }
    }

    /**
     * Add custom RSS detection rule for a domain
     * @param {string} domain - Domain name
     * @param {Array} patterns - RSS URL patterns
     */
    addRSSDetectionRule(domain, patterns) {
        if (this.rssDetector && this.rssDetector.addDomainRule) {
            this.rssDetector.addDomainRule(domain, patterns);
            logWithTimestamp(`➕ Added RSS detection rule for domain: ${domain}`);
        }
    }

    /**
     * Get RSS detection statistics
     * @returns {object} - RSS detection stats
     */
    getRSSDetectionStats() {
        if (this.rssDetector && this.rssDetector.getStats) {
            return this.rssDetector.getStats();
        }
        return null;
    }

    /**
     * Test RSS detection for a specific URL
     * @param {string} url - URL to test
     * @returns {Promise<object>} - Test results
     */
    async testRSSDetection(url) {
        try {
            const startTime = Date.now();
            const rssUrl = await this.findExistingRSSFeed(url);
            const duration = Date.now() - startTime;

            const result = {
                url,
                domain: this.extractDomain(url),
                siteType: this.getSiteType(this.extractDomain(url)),
                rssUrl,
                found: !!rssUrl,
                duration,
                detectionStats: this.getRSSDetectionStats()
            };

            if (rssUrl) {
                // Test RSS validity
                try {
                    const rssContent = await this.fetchRSSContent(rssUrl);
                    const articles = await this.parseRSSFeed(rssContent, url);
                    result.rssValid = true;
                    result.articleCount = articles.length;
                    result.sampleArticles = articles.slice(0, 3).map(a => ({
                        title: a.title,
                        url: a.url,
                        publishedDate: a.publishedDate
                    }));
                } catch (rssError) {
                    result.rssValid = false;
                    result.rssError = rssError.message;
                }
            }

            return result;

        } catch (error) {
            return {
                url,
                found: false,
                error: error.message,
                duration: 0
            };
        }
    }

    /**
     * 🆕 Helper Methods
     */

    /**
     * Extract domain from URL
     */
    extractDomain(url) {
        try {
            return new URL(url).hostname;
        } catch (error) {
            return url;
        }
    }

    /**
     * Get site type (Vietnamese/International)
     */
    getSiteType(domain) {
        return this.vietnameseDomains.has(domain) ? 'Vietnamese' : 'International';
    }

    /**
     * Detect language based on domain
     */
    detectLanguage(domain) {
        if (this.vietnameseDomains.has(domain)) {
            return 'vi';
        } else if (domain.endsWith('.vn')) {
            return 'vi';
        }
        return 'en';
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
        const detectorStats = this.getRSSDetectionStats() || {};

        return {
            ...this.stats,
            successRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.successfulScrapes / this.stats.totalRequests) * 100) : 0,
            rssDetectionRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.rssDetected / this.stats.totalRequests) * 100) : 0,
            rssUsageRate: this.stats.totalRequests > 0 ?
                Math.round((this.stats.rssUsed / this.stats.totalRequests) * 100) : 0,
            vietnameseVsInternational: {
                vietnamese: this.stats.vietnameseSitesProcessed,
                international: this.stats.internationalSitesProcessed,
                vietnamesePercentage: this.stats.totalRequests > 0 ?
                    Math.round((this.stats.vietnameseSitesProcessed / this.stats.totalRequests) * 100) : 0
            },

            // Enhanced detection stats
            enhancedDetection: {
                ...detectorStats,
                methodBreakdown: {
                    domainRules: detectorStats.domainRuleDetection || 0,
                    smartPattern: detectorStats.smartPatternDetection || 0,
                    htmlHead: detectorStats.htmlHeadDetection || 0,
                    commonPaths: detectorStats.commonPathDetection || 0,
                    urlPattern: detectorStats.urlPatternDetection || 0
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
            vietnameseSitesProcessed: 0,
            internationalSitesProcessed: 0,
            averageResponseTime: 0,
            lastActivity: null
        };

        // Reset detector stats as well
        if (this.rssDetector && this.rssDetector.resetStats) {
            this.rssDetector.resetStats();
        }
    }

    /**
     * Add custom parsing rules for a specific domain
     * @param {string} domain - Domain name
     * @param {object} rules - Parsing rules
     */
    addParsingRules(domain, rules) {
        this.parserService.addSiteRules(domain, rules);
        logWithTimestamp(`📝 Added custom parsing rules for domain: ${domain}`);
    }

    /**
     * Get current service configuration
     * @returns {object} - Configuration object
     */
    getConfig() {
        return {
            httpService: this.httpService.getStats(),
            supportedSites: Object.keys(this.parserService.siteRules || {}),
            vietnameseDomains: Array.from(this.vietnameseDomains),
            rssDetector: {
                supportedDomains: Object.keys(this.rssDetector.domainRules || {}),
                strategies: 5,
                cacheSize: this.rssDetector.rssCache ? this.rssDetector.rssCache.size : 0
            },
            stats: this.getStats()
        };
    }

    /**
     * 🆕 Bulk RSS detection test for multiple URLs
     * @param {Array} urls - Array of URLs to test
     * @returns {Promise<Array>} - Array of test results
     */
    async bulkTestRSSDetection(urls) {
        const results = [];

        for (const url of urls) {
            try {
                const result = await this.testRSSDetection(url);
                results.push(result);

                // Rate limiting between tests
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                results.push({
                    url,
                    found: false,
                    error: error.message
                });
            }
        }

        // Generate summary
        const summary = {
            totalTested: results.length,
            rssFound: results.filter(r => r.found).length,
            rssValid: results.filter(r => r.rssValid).length,
            vietnamese: results.filter(r => r.siteType === 'Vietnamese').length,
            international: results.filter(r => r.siteType === 'International').length,
            averageDuration: results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length
        };

        return {
            summary,
            results
        };
    }
}

// Export singleton instance
module.exports = new ScraperService();