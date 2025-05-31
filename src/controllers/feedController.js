// src/controllers/feedController.js
const feedService = require('../services/feedService');
const { logWithTimestamp } = require('../utils/helpers');
const config = require('../../config');

/**
 * Feed Controller
 * Handles all feed-related HTTP requests
 */
class FeedController {

    /**
     * Generate RSS feed for a website
     * GET /feed?url=<website_url>
     */
    async generateFeed(req, res, next) {
        try {
            const { url, title, description } = req.query;

            // Validate required parameters
            if (!url) {
                return res.status(400).json({
                    error: true,
                    message: 'URL parameter is required',
                    example: '/feed?url=https://example.com'
                });
            }

            // Optional feed customization
            const feedOptions = {};
            if (title) feedOptions.title = title;
            if (description) feedOptions.description = description;

            // Generate the RSS feed
            const rssXml = await feedService.generateFeed(url, feedOptions);

            // Set appropriate headers for RSS
            res.set({
                'Content-Type': 'application/rss+xml; charset=utf-8',
                'Cache-Control': `public, max-age=${config.app.cacheDuration}`,
                'Last-Modified': new Date().toUTCString(),
                'ETag': `"${Date.now()}"` // Simple ETag based on timestamp
            });

            // Send RSS XML
            res.send(rssXml);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get feed metadata without generating full feed
     * GET /metadata?url=<website_url>
     */
    async getFeedMetadata(req, res, next) {
        try {
            const { url } = req.query;

            if (!url) {
                return res.status(400).json({
                    error: true,
                    message: 'URL parameter is required',
                    example: '/metadata?url=https://example.com'
                });
            }

            const metadata = await feedService.getFeedMetadata(url);

            res.json({
                success: true,
                data: metadata,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Preview articles from a website (for testing)
     * GET /preview?url=<website_url>&limit=<number>
     */
    async previewArticles(req, res, next) {
        try {
            const { url, limit = 5 } = req.query;

            if (!url) {
                return res.status(400).json({
                    error: true,
                    message: 'URL parameter is required',
                    example: '/preview?url=https://example.com&limit=5'
                });
            }

            // Import scraper service here to avoid circular dependency
            const scraperService = require('../services/scraperService');

            // Extract articles
            const allArticles = await scraperService.extractArticles(url);
            const articles = allArticles.slice(0, parseInt(limit));

            res.json({
                success: true,
                data: {
                    url: url,
                    totalFound: allArticles.length,
                    preview: articles,
                    feedUrl: `${config.server.baseUrl}/feed?url=${encodeURIComponent(url)}`
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Health check endpoint
     * GET /health
     */
    async healthCheck(req, res) {
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0',
            node: process.version,
            environment: config.server.env,

            // Service status
            services: {
                scraper: 'operational',
                feedGenerator: 'operational',
                cache: 'operational'
            },

            // Cache statistics
            cache: feedService.getCacheStats()
        };

        res.json(healthData);
    }

    /**
     * Get cache statistics
     * GET /cache/stats
     */
    async getCacheStats(req, res) {
        try {
            const stats = feedService.getCacheStats();

            res.json({
                success: true,
                data: {
                    ...stats,
                    cacheDuration: config.app.cacheDuration,
                    maxCacheSize: 100, // Current max cache size
                    memoryUsage: process.memoryUsage()
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({
                error: true,
                message: 'Failed to get cache statistics'
            });
        }
    }

    /**
     * Clear cache for specific URL or all cache
     * DELETE /cache?url=<website_url>
     */
    async clearCache(req, res) {
        try {
            const { url } = req.query;

            // Clear specific URL or all cache
            feedService.clearCache(url);

            const message = url ? `Cache cleared for ${url}` : 'All cache cleared';
            logWithTimestamp(message);

            res.json({
                success: true,
                message: message,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({
                error: true,
                message: 'Failed to clear cache'
            });
        }
    }

    /**
     * List supported features and endpoints
     * GET /api/info
     */
    async getApiInfo(req, res) {
        const apiInfo = {
            name: 'RSS Feed Generator API',
            version: '1.0.0',
            description: 'Generate RSS feeds from websites that don\'t provide them',

            endpoints: {
                'GET /feed': {
                    description: 'Generate RSS feed for a website',
                    parameters: {
                        url: 'Website URL (required)',
                        title: 'Custom feed title (optional)',
                        description: 'Custom feed description (optional)'
                    },
                    example: '/feed?url=https://example.com&title=My Custom Feed'
                },

                'GET /metadata': {
                    description: 'Get feed metadata without generating full feed',
                    parameters: {
                        url: 'Website URL (required)'
                    },
                    example: '/metadata?url=https://example.com'
                },

                'GET /preview': {
                    description: 'Preview articles that would be included in feed',
                    parameters: {
                        url: 'Website URL (required)',
                        limit: 'Number of articles to preview (optional, default: 5)'
                    },
                    example: '/preview?url=https://example.com&limit=10'
                },

                'GET /health': {
                    description: 'Health check and system status',
                    parameters: {},
                    example: '/health'
                },

                'GET /cache/stats': {
                    description: 'Get cache statistics',
                    parameters: {},
                    example: '/cache/stats'
                },

                'DELETE /cache': {
                    description: 'Clear cache (all or specific URL)',
                    parameters: {
                        url: 'Website URL to clear (optional, if not provided clears all)'
                    },
                    example: '/cache?url=https://example.com'
                }
            },

            features: [
                'Automatic content extraction from any website',
                'RSS 2.0 compatible feeds',
                'Intelligent article detection',
                'Caching for improved performance',
                'Rate limiting for fair usage',
                'Support for multiple content formats',
                'Customizable feed metadata'
            ],

            limitations: [
                'JavaScript-heavy sites may not work perfectly',
                'Some sites may block automated requests',
                'Feed updates depend on cache duration',
                'Rate limits apply to prevent abuse'
            ],

            configuration: {
                maxArticlesPerFeed: config.app.maxArticlesPerFeed,
                cacheDuration: `${config.app.cacheDuration} seconds`,
                requestTimeout: `${config.app.requestTimeout} ms`,
                rateLimitWindow: `${config.security.rateLimitWindow / 1000} seconds`,
                rateLimitMax: `${config.security.rateLimitMax} requests per window`
            }
        };

        res.json(apiInfo);
    }

    /**
     * Validate website URL (utility endpoint)
     * POST /validate
     */
    async validateWebsite(req, res, next) {
        try {
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({
                    error: true,
                    message: 'URL is required in request body',
                    example: { url: 'https://example.com' }
                });
            }

            // Basic URL validation
            if (!feedService.isValidUrl(url)) {
                return res.status(400).json({
                    valid: false,
                    message: 'Invalid URL format'
                });
            }

            // Try to fetch and analyze the website
            const scraperService = require('../services/scraperService');

            try {
                const html = await scraperService.fetchHtml(url);
                const articles = await scraperService.extractArticles(url);

                res.json({
                    valid: true,
                    url: url,
                    accessible: true,
                    articlesFound: articles.length,
                    canGenerateFeed: articles.length > 0,
                    feedUrl: articles.length > 0 ?
                        `${config.server.baseUrl}/feed?url=${encodeURIComponent(url)}` : null,
                    message: articles.length > 0 ?
                        'Website is suitable for RSS feed generation' :
                        'No articles found on this website'
                });

            } catch (fetchError) {
                res.json({
                    valid: true,
                    url: url,
                    accessible: false,
                    error: fetchError.message,
                    canGenerateFeed: false,
                    message: 'Website URL is valid but not accessible'
                });
            }

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new FeedController();