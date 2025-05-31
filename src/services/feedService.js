// src/services/feedService.js
const RSS = require('rss');
const config = require('../../config');
const scraperService = require('./scraperService');
const { extractDomain, logWithTimestamp } = require('../utils/helpers');
const { FeedGenerationError, CacheError, ValidationError, NoArticlesError } = require('../errors');

/**
 * Feed Service (Enhanced)
 * Handles RSS feed generation and management with improved error handling and caching
 */
class FeedService {
    constructor() {
        // In-memory cache for feeds (use Redis in production)
        this.feedCache = new Map();
        this.cacheTimestamps = new Map();
        this.cacheHits = 0;
        this.cacheMisses = 0;

        // Cache cleanup interval (every 5 minutes)
        this.setupCacheCleanup();
    }

    /**
     * Generate RSS feed for a website
     * @param {string} websiteUrl - URL of the website
     * @param {object} options - Optional configuration
     * @returns {Promise<string>} - RSS XML content
     */
    async generateFeed(websiteUrl, options = {}) {
        try {
            // Validate and normalize URL
            const normalizedUrl = this.validateAndNormalizeUrl(websiteUrl);
            const cacheKey = this.getCacheKey(normalizedUrl, options);

            // Check cache first
            if (this.isCacheValid(cacheKey)) {
                this.cacheHits++;
                logWithTimestamp(`Serving cached feed for ${normalizedUrl}`);
                return this.feedCache.get(cacheKey);
            }

            this.cacheMisses++;
            logWithTimestamp(`Generating new feed for ${normalizedUrl}`);

            // Extract articles from website
            const articles = await this.extractArticles(normalizedUrl, options);

            if (articles.length === 0) {
                throw new NoArticlesError(normalizedUrl);
            }

            // Create RSS feed
            const rssXml = await this.createRSSFeed(normalizedUrl, articles, options);

            // Cache the result
            this.cacheResult(cacheKey, rssXml);

            logWithTimestamp(`Successfully generated feed for ${normalizedUrl} with ${articles.length} articles`);
            return rssXml;

        } catch (error) {
            if (error instanceof NoArticlesError || error instanceof ValidationError) {
                throw error;
            }

            const feedError = new FeedGenerationError(
                `Failed to generate feed: ${error.message}`,
                websiteUrl,
                0,
                error
            );

            logWithTimestamp(`Error generating feed for ${websiteUrl}: ${feedError.message}`, 'error');
            throw feedError;
        }
    }

    /**
     * Extract articles using scraper service with error handling
     * @param {string} url - Website URL
     * @param {object} options - Extraction options
     * @returns {Promise<Array>} - Array of articles
     */
    async extractArticles(url, options = {}) {
        try {
            const extractionOptions = {
                limit: options.limit || config.app.maxArticlesPerFeed,
                ...options
            };

            return await scraperService.extractArticles(url, extractionOptions);

        } catch (error) {
            // Re-throw scraper errors as they're already properly typed
            throw error;
        }
    }

    /**
     * Create RSS XML from articles with enhanced metadata
     * @param {string} websiteUrl - Source website URL
     * @param {Array} articles - Array of article objects
     * @param {object} options - Feed options
     * @returns {Promise<string>} - RSS XML string
     */
    async createRSSFeed(websiteUrl, articles, options = {}) {
        try {
            const domain = extractDomain(websiteUrl);
            const feedUrl = `${config.server.baseUrl}/feed?url=${encodeURIComponent(websiteUrl)}`;

            // Get site metadata for better feed info
            let siteMetadata = {};
            try {
                siteMetadata = await scraperService.getSiteMetadata(websiteUrl);
            } catch (error) {
                logWithTimestamp(`Could not get site metadata for ${websiteUrl}: ${error.message}`, 'warn');
            }

            // Create RSS feed instance with enhanced metadata
            const feed = new RSS({
                title: options.title || siteMetadata.title || `RSS Feed for ${domain}`,
                description: options.description || siteMetadata.description || `Auto-generated RSS feed for ${domain}`,
                feed_url: feedUrl,
                site_url: websiteUrl,
                image_url: options.imageUrl || siteMetadata.favicon,
                managingEditor: options.managingEditor,
                webMaster: options.webMaster,
                copyright: options.copyright || `© ${new Date().getFullYear()} ${domain}`,
                language: options.language || siteMetadata.language || 'en',
                categories: options.categories || this.inferCategories(articles),
                pubDate: new Date(),
                ttl: Math.floor(config.app.cacheDuration / 60), // TTL in minutes
                generator: 'RSS Feed Generator v1.0',

                // Custom namespace for additional metadata
                custom_namespaces: {
                    'content': 'http://purl.org/rss/1.0/modules/content/',
                    'dc': 'http://purl.org/dc/elements/1.1/',
                    'atom': 'http://www.w3.org/2005/Atom',
                    'media': 'http://search.yahoo.com/mrss/'
                },

                // RSS 2.0 extensions
                custom_elements: [
                    {'generator': 'RSS Feed Generator v1.0'},
                    {'docs': 'https://validator.w3.org/feed/docs/rss2.html'},
                    {'atom:link': {
                            _attr: {
                                href: feedUrl,
                                rel: 'self',
                                type: 'application/rss+xml'
                            }
                        }},
                    {'lastBuildDate': new Date().toUTCString()},
                    {'updatePeriod': 'hourly'},
                    {'updateFrequency': '1'}
                ]
            });

            // Add articles to feed with enhanced metadata
            articles.forEach((article, index) => {
                try {
                    const item = this.createFeedItem(article, domain, index);
                    feed.item(item);
                } catch (error) {
                    logWithTimestamp(`Error adding article "${article.title}" to feed: ${error.message}`, 'warn');
                }
            });

            return feed.xml({ indent: true });

        } catch (error) {
            throw new FeedGenerationError(
                `Failed to create RSS XML: ${error.message}`,
                websiteUrl,
                articles.length,
                error
            );
        }
    }

    /**
     * Create RSS feed item with enhanced metadata
     * @param {object} article - Article object
     * @param {string} domain - Source domain
     * @param {number} index - Article index for guid uniqueness
     * @returns {object} - RSS item object
     */
    createFeedItem(article, domain, index) {
        const item = {
            title: this.sanitizeTitle(article.title),
            description: this.sanitizeDescription(article.description),
            url: article.url,
            guid: article.guid || `${article.url}#${index}`,
            date: article.publishedDate || new Date(),
            author: article.author || domain,
            categories: article.category ? [article.category] : [],

            // Custom elements for enhanced metadata
            custom_elements: []
        };

        // Add image if available
        if (article.image) {
            // RSS enclosure for image
            item.enclosure = {
                url: article.image,
                type: this.getImageMimeType(article.image),
                length: 0 // RSS spec requires this but we don't know actual size
            };

            // Media RSS for better image support
            item.custom_elements.push({
                'media:content': {
                    _attr: {
                        url: article.image,
                        type: this.getImageMimeType(article.image),
                        medium: 'image'
                    }
                }
            });

            // Thumbnail for feed readers
            item.custom_elements.push({
                'media:thumbnail': {
                    _attr: {
                        url: article.image,
                        width: 150,
                        height: 150
                    }
                }
            });
        }

        // Add content:encoded for full HTML content
        if (article.content) {
            item.custom_elements.push({
                'content:encoded': {
                    _cdata: article.content
                }
            });
        }

        // Add Dublin Core metadata
        item.custom_elements.push(
            { 'dc:creator': article.author || domain },
            { 'dc:source': domain },
            { 'dc:identifier': article.url }
        );

        // Add article reading time estimate
        const readingTime = this.estimateReadingTime(article.description);
        if (readingTime > 0) {
            item.custom_elements.push({
                'dc:extent': `${readingTime} min read`
            });
        }

        return item;
    }

    /**
     * Get feed metadata without generating full content
     * @param {string} websiteUrl - Website URL
     * @returns {Promise<object>} - Feed metadata
     */
    async getFeedMetadata(websiteUrl) {
        try {
            const normalizedUrl = this.validateAndNormalizeUrl(websiteUrl);

            // Get site metadata
            const siteMetadata = await scraperService.getSiteMetadata(normalizedUrl);
            const domain = extractDomain(normalizedUrl);

            const metadata = {
                url: normalizedUrl,
                domain,
                title: siteMetadata.title || `RSS Feed for ${domain}`,
                description: siteMetadata.description || `Auto-generated RSS feed for ${domain}`,
                language: siteMetadata.language || 'en',
                generator: siteMetadata.generator,
                charset: siteMetadata.charset || 'utf-8',
                favicon: siteMetadata.favicon,
                feedUrl: `${config.server.baseUrl}/feed?url=${encodeURIComponent(normalizedUrl)}`,
                lastUpdated: new Date().toISOString(),
                articleCount: 0,
                estimatedUpdateFrequency: 'hourly'
            };

            // Try to get article count quickly (with cache check first)
            try {
                const cacheKey = this.getCacheKey(normalizedUrl, {});
                if (this.isCacheValid(cacheKey)) {
                    // Estimate from cached feed
                    const cachedFeed = this.feedCache.get(cacheKey);
                    const articleMatches = cachedFeed.match(/<item>/g);
                    metadata.articleCount = articleMatches ? articleMatches.length : 0;
                } else {
                    // Quick article count
                    const articles = await scraperService.extractArticles(normalizedUrl, { limit: 5 });
                    metadata.articleCount = articles.length;
                    metadata.sampleArticles = articles.slice(0, 3).map(a => ({
                        title: a.title,
                        url: a.url,
                        publishedDate: a.publishedDate
                    }));
                }
            } catch (error) {
                logWithTimestamp(`Could not count articles for ${normalizedUrl}: ${error.message}`, 'warn');
                metadata.articleCount = 0;
                metadata.error = 'Could not analyze articles';
            }

            return metadata;

        } catch (error) {
            throw new FeedGenerationError(`Failed to get metadata: ${error.message}`, websiteUrl, 0, error);
        }
    }

    /**
     * Validate and normalize URL
     * @param {string} url - URL to validate
     * @returns {string} - Normalized URL
     */
    validateAndNormalizeUrl(url) {
        if (!url || typeof url !== 'string') {
            throw new ValidationError('URL must be a non-empty string');
        }

        try {
            const urlObj = new URL(url);

            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                throw new ValidationError('Only HTTP and HTTPS protocols are supported');
            }

            // Normalize URL
            urlObj.pathname = urlObj.pathname.replace(/\/$/, '') || '/';
            urlObj.search = ''; // Remove query parameters for caching consistency
            urlObj.hash = ''; // Remove fragment

            return urlObj.toString();

        } catch (error) {
            if (error instanceof ValidationError) {
                throw error;
            }
            throw new ValidationError(`Invalid URL format: ${error.message}`);
        }
    }

    /**
     * Check if cache is still valid
     * @param {string} cacheKey - Cache key
     * @returns {boolean} - True if cache is valid
     */
    isCacheValid(cacheKey) {
        if (!this.feedCache.has(cacheKey) || !this.cacheTimestamps.has(cacheKey)) {
            return false;
        }

        const timestamp = this.cacheTimestamps.get(cacheKey);
        const now = Date.now();
        const cacheAge = (now - timestamp) / 1000; // Convert to seconds

        return cacheAge < config.app.cacheDuration;
    }

    /**
     * Cache the feed result with error handling
     * @param {string} cacheKey - Cache key
     * @param {string} feedXml - RSS XML content
     */
    cacheResult(cacheKey, feedXml) {
        try {
            this.feedCache.set(cacheKey, feedXml);
            this.cacheTimestamps.set(cacheKey, Date.now());

            // Implement LRU cache cleanup
            if (this.feedCache.size > 100) {
                this.cleanupOldCache();
            }
        } catch (error) {
            logWithTimestamp(`Cache error: ${error.message}`, 'warn');
            // Don't throw - caching is not critical for functionality
        }
    }

    /**
     * Generate cache key with options consideration
     * @param {string} url - Website URL
     * @param {object} options - Feed options
     * @returns {string} - Cache key
     */
    getCacheKey(url, options = {}) {
        const domain = extractDomain(url);
        const optionsHash = this.hashOptions(options);
        const urlHash = Buffer.from(url).toString('base64').substring(0, 10);

        return `feed_${domain}_${urlHash}_${optionsHash}`;
    }

    /**
     * Hash options for cache key
     * @param {object} options - Options to hash
     * @returns {string} - Hash string
     */
    hashOptions(options) {
        const relevantOptions = {
            title: options.title,
            description: options.description,
            limit: options.limit
        };

        const optionsStr = JSON.stringify(relevantOptions);
        return Buffer.from(optionsStr).toString('base64').substring(0, 8);
    }

    /**
     * Clear cache for specific URL or all cache
     * @param {string} url - Optional URL to clear
     * @returns {object} - Cleanup result
     */
    clearCache(url = null) {
        try {
            let clearedCount = 0;

            if (url) {
                const normalizedUrl = this.validateAndNormalizeUrl(url);
                const domain = extractDomain(normalizedUrl);

                // Clear all cache entries for this domain
                for (const [key, value] of this.feedCache.entries()) {
                    if (key.includes(`feed_${domain}_`)) {
                        this.feedCache.delete(key);
                        this.cacheTimestamps.delete(key);
                        clearedCount++;
                    }
                }

                logWithTimestamp(`Cleared ${clearedCount} cache entries for ${url}`);
            } else {
                clearedCount = this.feedCache.size;
                this.feedCache.clear();
                this.cacheTimestamps.clear();
                this.cacheHits = 0;
                this.cacheMisses = 0;

                logWithTimestamp(`Cleared all ${clearedCount} cache entries`);
            }

            return { clearedCount };

        } catch (error) {
            throw new CacheError(`Failed to clear cache: ${error.message}`, 'clear', url, error);
        }
    }

    /**
     * Get cache statistics with detailed information
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        const now = Date.now();
        const cacheEntries = Array.from(this.cacheTimestamps.entries()).map(([key, timestamp]) => ({
            key,
            age: Math.round((now - timestamp) / 1000),
            expired: (now - timestamp) / 1000 > config.app.cacheDuration
        }));

        const expiredCount = cacheEntries.filter(entry => entry.expired).length;
        const totalRequests = this.cacheHits + this.cacheMisses;
        const hitRate = totalRequests > 0 ? Math.round((this.cacheHits / totalRequests) * 100) : 0;

        return {
            size: this.feedCache.size,
            maxSize: 100,
            expiredEntries: expiredCount,
            hitRate: `${hitRate}%`,
            totalHits: this.cacheHits,
            totalMisses: this.cacheMisses,
            totalRequests,
            entries: cacheEntries.slice(0, 10), // Show only first 10 for brevity
            oldestEntry: cacheEntries.length > 0 ? Math.max(...cacheEntries.map(e => e.age)) : 0,
            newestEntry: cacheEntries.length > 0 ? Math.min(...cacheEntries.map(e => e.age)) : 0
        };
    }

    /**
     * Setup automatic cache cleanup
     */
    setupCacheCleanup() {
        // Clean up expired entries every 5 minutes
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 5 * 60 * 1000);
    }

    /**
     * Clean up expired cache entries
     */
    cleanupExpiredCache() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, timestamp] of this.cacheTimestamps.entries()) {
            const age = (now - timestamp) / 1000;
            if (age > config.app.cacheDuration) {
                this.feedCache.delete(key);
                this.cacheTimestamps.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logWithTimestamp(`Cleaned up ${cleanedCount} expired cache entries`);
        }
    }

    /**
     * Clean up old cache entries (LRU)
     */
    cleanupOldCache() {
        const entries = Array.from(this.cacheTimestamps.entries())
            .sort((a, b) => a[1] - b[1]); // Sort by timestamp (oldest first)

        // Remove oldest 20% of entries
        const removeCount = Math.floor(entries.length * 0.2);

        for (let i = 0; i < removeCount; i++) {
            const [key] = entries[i];
            this.feedCache.delete(key);
            this.cacheTimestamps.delete(key);
        }

        logWithTimestamp(`LRU cleanup: removed ${removeCount} old cache entries`);
    }

    /**
     * Utility methods
     */

    sanitizeTitle(title) {
        return title ? title.replace(/[<>]/g, '').trim() : 'Untitled';
    }

    sanitizeDescription(description) {
        return description ? description.replace(/[<>]/g, '').trim() : '';
    }

    getImageMimeType(imageUrl) {
        const ext = imageUrl.split('.').pop().toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml'
        };
        return mimeTypes[ext] || 'image/jpeg';
    }

    estimateReadingTime(text) {
        if (!text) return 0;
        const wordsPerMinute = 200;
        const wordCount = text.split(/\s+/).length;
        return Math.max(1, Math.round(wordCount / wordsPerMinute));
    }

    inferCategories(articles) {
        const categories = ['News'];

        // Simple category inference based on common keywords
        const content = articles.map(a => (a.title + ' ' + a.description).toLowerCase()).join(' ');

        if (content.includes('tech') || content.includes('technology') || content.includes('software')) {
            categories.push('Technology');
        }
        if (content.includes('business') || content.includes('economy') || content.includes('finance')) {
            categories.push('Business');
        }
        if (content.includes('sport') || content.includes('football') || content.includes('game')) {
            categories.push('Sports');
        }

        return categories;
    }
}

module.exports = new FeedService();