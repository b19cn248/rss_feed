// src/services/feedService.js
const RSS = require('rss');
const config = require('../../config');
const scraperService = require('./scraperService');
const { extractDomain, logWithTimestamp } = require('../utils/helpers');

/**
 * Feed Service
 * Handles RSS feed generation and management
 */
class FeedService {
    constructor() {
        // In-memory cache cho feeds (trong production nên dùng Redis)
        this.feedCache = new Map();
        this.cacheTimestamps = new Map();
    }

    /**
     * Generate RSS feed for a website
     * @param {string} websiteUrl - URL of the website
     * @param {object} options - Optional configuration
     * @returns {Promise<string>} - RSS XML content
     */
    async generateFeed(websiteUrl, options = {}) {
        try {
            // Validate URL
            if (!websiteUrl || !this.isValidUrl(websiteUrl)) {
                throw new Error('Invalid website URL provided');
            }

            const normalizedUrl = this.normalizeUrl(websiteUrl);
            const cacheKey = this.getCacheKey(normalizedUrl);

            // Check cache first
            if (this.isCacheValid(cacheKey)) {
                logWithTimestamp(`Serving cached feed for ${normalizedUrl}`);
                return this.feedCache.get(cacheKey);
            }

            // Extract articles from website
            logWithTimestamp(`Generating new feed for ${normalizedUrl}`);
            const articles = await scraperService.extractArticles(normalizedUrl);

            if (articles.length === 0) {
                logWithTimestamp(`No articles found for ${normalizedUrl}`, 'warn');
                throw new Error('No articles could be extracted from this website');
            }

            // Create RSS feed
            const rssXml = this.createRSSFeed(normalizedUrl, articles, options);

            // Cache the result
            this.cacheResult(cacheKey, rssXml);

            logWithTimestamp(`Successfully generated feed for ${normalizedUrl} with ${articles.length} articles`);
            return rssXml;

        } catch (error) {
            logWithTimestamp(`Error generating feed for ${websiteUrl}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Create RSS XML from articles
     * @param {string} websiteUrl - Source website URL
     * @param {Array} articles - Array of article objects
     * @param {object} options - Feed options
     * @returns {string} - RSS XML string
     */
    createRSSFeed(websiteUrl, articles, options = {}) {
        const domain = extractDomain(websiteUrl);
        const feedUrl = `${config.server.baseUrl}/feed?url=${encodeURIComponent(websiteUrl)}`;

        // Create RSS feed instance
        const feed = new RSS({
            title: options.title || `RSS Feed for ${domain}`,
            description: options.description || `Auto-generated RSS feed for ${domain}`,
            feed_url: feedUrl,
            site_url: websiteUrl,
            image_url: options.imageUrl,
            managingEditor: options.managingEditor,
            webMaster: options.webMaster,
            copyright: options.copyright || `© ${new Date().getFullYear()} ${domain}`,
            language: options.language || 'en',
            categories: options.categories || ['News', 'Technology'],
            pubDate: new Date(),
            ttl: Math.floor(config.app.cacheDuration / 60), // TTL in minutes

            // Custom namespace for additional metadata
            custom_namespaces: {
                'content': 'http://purl.org/rss/1.0/modules/content/',
                'dc': 'http://purl.org/dc/elements/1.1/'
            },

            // RSS 2.0 extensions
            custom_elements: [
                {'generator': 'RSS Feed Generator v1.0'},
                {'docs': 'https://validator.w3.org/feed/docs/rss2.html'}
            ]
        });

        // Add articles to feed
        articles.forEach(article => {
            try {
                const item = {
                    title: article.title,
                    description: article.description,
                    url: article.url,
                    guid: article.guid || article.url,
                    date: article.publishedDate || new Date(),

                    // Additional metadata
                    custom_elements: []
                };

                // Add image if available
                if (article.image) {
                    item.enclosure = {
                        url: article.image,
                        type: 'image/jpeg' // Default type
                    };

                    // Add image in custom elements for better compatibility
                    item.custom_elements.push({
                        'media:content': {
                            _attr: {
                                url: article.image,
                                type: 'image/jpeg',
                                medium: 'image'
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
                item.custom_elements.push({
                    'dc:creator': domain
                });

                feed.item(item);
            } catch (error) {
                logWithTimestamp(`Error adding article to feed: ${error.message}`, 'warn');
            }
        });

        return feed.xml({ indent: true });
    }

    /**
     * Get feed metadata without generating full content
     * @param {string} websiteUrl - Website URL
     * @returns {Promise<object>} - Feed metadata
     */
    async getFeedMetadata(websiteUrl) {
        try {
            const normalizedUrl = this.normalizeUrl(websiteUrl);
            const domain = extractDomain(normalizedUrl);

            // Try to extract basic info from homepage
            const html = await scraperService.fetchHtml(normalizedUrl);
            const cheerio = require('cheerio');
            const $ = cheerio.load(html);

            const metadata = {
                url: normalizedUrl,
                domain,
                title: this.extractSiteTitle($),
                description: this.extractSiteDescription($),
                feedUrl: `${config.server.baseUrl}/feed?url=${encodeURIComponent(normalizedUrl)}`,
                lastUpdated: new Date(),
                articleCount: 0
            };

            // Try to get article count quickly
            try {
                const articles = await scraperService.extractArticles(normalizedUrl);
                metadata.articleCount = articles.length;
            } catch (error) {
                logWithTimestamp(`Could not count articles for ${normalizedUrl}`, 'warn');
            }

            return metadata;
        } catch (error) {
            throw new Error(`Failed to get metadata for ${websiteUrl}: ${error.message}`);
        }
    }

    /**
     * Extract site title from HTML
     * @param {object} $ - Cheerio instance
     * @returns {string} - Site title
     */
    extractSiteTitle($) {
        // Try various selectors for site title
        const titleSelectors = [
            'title',
            'meta[property="og:title"]',
            'meta[name="twitter:title"]',
            'h1',
            '.site-title',
            '.logo'
        ];

        for (const selector of titleSelectors) {
            const element = $(selector).first();
            if (element.length > 0) {
                const title = element.attr('content') || element.text();
                if (title && title.trim().length > 0) {
                    return title.trim();
                }
            }
        }

        return 'Unknown Site';
    }

    /**
     * Extract site description from HTML
     * @param {object} $ - Cheerio instance
     * @returns {string} - Site description
     */
    extractSiteDescription($) {
        const descSelectors = [
            'meta[name="description"]',
            'meta[property="og:description"]',
            'meta[name="twitter:description"]'
        ];

        for (const selector of descSelectors) {
            const content = $(selector).attr('content');
            if (content && content.trim().length > 0) {
                return content.trim();
            }
        }

        return 'Auto-generated RSS feed';
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
     * Cache the feed result
     * @param {string} cacheKey - Cache key
     * @param {string} feedXml - RSS XML content
     */
    cacheResult(cacheKey, feedXml) {
        this.feedCache.set(cacheKey, feedXml);
        this.cacheTimestamps.set(cacheKey, Date.now());

        // Clean old cache entries (simple LRU)
        if (this.feedCache.size > 100) {
            const oldestKey = this.feedCache.keys().next().value;
            this.feedCache.delete(oldestKey);
            this.cacheTimestamps.delete(oldestKey);
        }
    }

    /**
     * Generate cache key for URL
     * @param {string} url - Website URL
     * @returns {string} - Cache key
     */
    getCacheKey(url) {
        return `feed_${extractDomain(url)}_${Buffer.from(url).toString('base64').substring(0, 10)}`;
    }

    /**
     * Normalize URL for consistent caching
     * @param {string} url - Original URL
     * @returns {string} - Normalized URL
     */
    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            // Remove trailing slash and common query parameters
            urlObj.pathname = urlObj.pathname.replace(/\/$/, '') || '/';
            urlObj.search = ''; // Remove query parameters for caching
            urlObj.hash = ''; // Remove fragment
            return urlObj.toString();
        } catch (error) {
            return url;
        }
    }

    /**
     * Validate URL format
     * @param {string} url - URL to validate
     * @returns {boolean} - True if valid
     */
    isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    }

    /**
     * Clear cache for specific URL or all cache
     * @param {string} url - Optional URL to clear, if not provided clears all
     */
    clearCache(url = null) {
        if (url) {
            const cacheKey = this.getCacheKey(this.normalizeUrl(url));
            this.feedCache.delete(cacheKey);
            this.cacheTimestamps.delete(cacheKey);
            logWithTimestamp(`Cleared cache for ${url}`);
        } else {
            this.feedCache.clear();
            this.cacheTimestamps.clear();
            logWithTimestamp('Cleared all feed cache');
        }
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        return {
            size: this.feedCache.size,
            keys: Array.from(this.feedCache.keys()),
            timestamps: Array.from(this.cacheTimestamps.entries()).map(([key, timestamp]) => ({
                key,
                age: (Date.now() - timestamp) / 1000
            }))
        };
    }
}

module.exports = new FeedService();