// src/controllers/feedController.js
const feedService = require('../services/feedService');
const scraperService = require('../services/scraperService');
const { logWithTimestamp } = require('../utils/helpers');
const { ValidationError, AppError } = require('../errors');
const config = require('../../config');

/**
 * Feed Controller (Enhanced)
 * Handles all feed-related HTTP requests with improved error handling and validation
 */
class FeedController {

    /**
     * Generate RSS feed for a website
     * GET /feed?url=<website_url>&title=<custom_title>&description=<custom_desc>
     */
    async generateFeed(req, res, next) {
        try {
            const { url, title, description, limit } = req.validatedQuery;
            const requestId = req.requestId;

            logWithTimestamp(`[${requestId}] Generating RSS feed for: ${url}`);

            // Prepare feed options
            const feedOptions = {};
            if (title) feedOptions.title = title;
            if (description) feedOptions.description = description;
            if (limit) feedOptions.limit = limit;

            // Generate the RSS feed
            const rssXml = await feedService.generateFeed(url, feedOptions);

            // Set appropriate headers for RSS
            res.set({
                'Content-Type': 'application/rss+xml; charset=utf-8',
                'Cache-Control': `public, max-age=${config.app.cacheDuration}`,
                'Last-Modified': new Date().toUTCString(),
                'ETag': `"${this.generateETag(url, feedOptions)}"`,
                'X-Feed-Generator': 'RSS-Feed-Generator/1.0',
                'X-Request-ID': requestId
            });

            // Log successful generation
            logWithTimestamp(`[${requestId}] Successfully generated RSS feed for ${url}`);

            // Send RSS XML
            res.send(rssXml);

        } catch (error) {
            logWithTimestamp(`[${req.requestId}] Error generating feed: ${error.message}`, 'error');
            next(error);
        }
    }

    /**
     * Get feed metadata without generating full feed
     * GET /metadata?url=<website_url>
     */
    async getFeedMetadata(req, res, next) {
        try {
            const { url } = req.validatedQuery;
            const requestId = req.requestId;

            logWithTimestamp(`[${requestId}] Getting metadata for: ${url}`);

            const metadata = await feedService.getFeedMetadata(url);

            res.json({
                success: true,
                data: metadata,
                requestId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Preview articles from a website (for testing)
     * GET /preview?url=<website_url>&limit=<number>&page=<page_number>
     */
    async previewArticles(req, res, next) {
        try {
            const { url, limit = 5 } = req.validatedQuery;
            const { page = 1, limit: pageLimit = 20 } = req.pagination || {};
            const requestId = req.requestId;

            logWithTimestamp(`[${requestId}] Previewing articles from: ${url}`);

            // Extract articles
            const allArticles = await scraperService.extractArticles(url, { limit: limit * 2 });

            // Apply pagination
            const startIndex = (page - 1) * pageLimit;
            const endIndex = startIndex + parseInt(limit);
            const articles = allArticles.slice(startIndex, endIndex);

            // Calculate pagination info
            const totalPages = Math.ceil(allArticles.length / pageLimit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            res.json({
                success: true,
                data: {
                    url: url,
                    totalFound: allArticles.length,
                    currentPage: page,
                    totalPages,
                    hasNext,
                    hasPrev,
                    limit: parseInt(limit),
                    preview: articles,
                    feedUrl: `${config.server.baseUrl}/feed?url=${encodeURIComponent(url)}`,
                    // Sample articles for different limits
                    sampleUrls: {
                        feed: `${config.server.baseUrl}/feed?url=${encodeURIComponent(url)}`,
                        preview5: `${config.server.baseUrl}/preview?url=${encodeURIComponent(url)}&limit=5`,
                        preview10: `${config.server.baseUrl}/preview?url=${encodeURIComponent(url)}&limit=10`
                    }
                },
                requestId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Health check endpoint with detailed status
     * GET /health
     */
    async healthCheck(req, res) {
        try {
            const requestId = req.requestId;

            // Collect system information
            const memUsage = process.memoryUsage();
            const uptime = process.uptime();

            // Get service statistics
            const cacheStats = feedService.getCacheStats();
            const scraperStats = scraperService.getStats();

            const healthData = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                requestId,

                // System info
                system: {
                    uptime: Math.round(uptime),
                    uptimeHuman: this.formatUptime(uptime),
                    memory: {
                        used: Math.round(memUsage.heapUsed / 1024 / 1024),
                        total: Math.round(memUsage.heapTotal / 1024 / 1024),
                        external: Math.round(memUsage.external / 1024 / 1024),
                        unit: 'MB'
                    },
                    node: process.version,
                    platform: process.platform,
                    arch: process.arch
                },

                // Application info
                application: {
                    name: 'RSS Feed Generator',
                    version: process.env.npm_package_version || '1.0.0',
                    environment: config.server.env,
                    nodeEnv: process.env.NODE_ENV
                },

                // Service status
                services: {
                    scraper: {
                        status: 'operational',
                        stats: scraperStats
                    },
                    feedGenerator: {
                        status: 'operational',
                        cache: cacheStats
                    },
                    httpService: {
                        status: 'operational'
                    }
                },

                // Configuration
                config: {
                    cacheDuration: config.app.cacheDuration,
                    maxArticlesPerFeed: config.app.maxArticlesPerFeed,
                    requestTimeout: config.app.requestTimeout,
                    rateLimitWindow: config.security.rateLimitWindow,
                    rateLimitMax: config.security.rateLimitMax
                }
            };

            // Check if system is under stress
            const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
            if (memUsagePercent > 80) {
                healthData.warnings = healthData.warnings || [];
                healthData.warnings.push('High memory usage detected');
            }

            if (scraperStats.successRate < 80 && scraperStats.totalRequests > 10) {
                healthData.warnings = healthData.warnings || [];
                healthData.warnings.push('Low scraping success rate');
            }

            res.json(healthData);

        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
        }
    }

    /**
     * Get cache statistics with detailed information
     * GET /cache/stats
     */
    async getCacheStats(req, res, next) {
        try {
            const stats = feedService.getCacheStats();
            const scraperStats = scraperService.getStats();
            const memUsage = process.memoryUsage();

            res.json({
                success: true,
                data: {
                    cache: {
                        ...stats,
                        cacheDuration: config.app.cacheDuration,
                        maxCacheSize: 100 // Current configuration
                    },
                    scraper: scraperStats,
                    memory: {
                        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                        external: Math.round(memUsage.external / 1024 / 1024),
                        unit: 'MB'
                    },
                    recommendations: this.getCacheRecommendations(stats, memUsage)
                },
                requestId: req.requestId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Clear cache for specific URL or all cache
     * DELETE /cache?url=<website_url>
     */
    async clearCache(req, res, next) {
        try {
            const { url } = req.validatedQuery || {};
            const requestId = req.requestId;

            // Clear specific URL or all cache
            const result = feedService.clearCache(url);

            const message = url ?
                `Cache cleared for ${url}` :
                'All cache cleared';

            logWithTimestamp(`[${requestId}] ${message}`);

            res.json({
                success: true,
                message: message,
                clearedItems: result.clearedCount || 0,
                url: url || null,
                requestId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get API information and documentation
     * GET /api/info
     */
    async getApiInfo(req, res) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const apiInfo = {
            name: 'RSS Feed Generator API',
            version: '1.0.0',
            description: 'Generate RSS feeds from websites that don\'t provide them',
            documentation: `${baseUrl}/api/info`,

            // API Status
            status: 'operational',
            timestamp: new Date().toISOString(),
            requestId: req.requestId,

            // Available endpoints with detailed information
            endpoints: {
                'GET /feed': {
                    description: 'Generate RSS feed for a website',
                    parameters: {
                        url: {
                            type: 'string',
                            required: true,
                            description: 'Website URL to generate feed from',
                            example: 'https://example.com'
                        },
                        title: {
                            type: 'string',
                            required: false,
                            maxLength: 100,
                            description: 'Custom feed title',
                            example: 'My Custom Feed'
                        },
                        description: {
                            type: 'string',
                            required: false,
                            maxLength: 500,
                            description: 'Custom feed description',
                            example: 'Latest news from example.com'
                        },
                        limit: {
                            type: 'integer',
                            required: false,
                            min: 1,
                            max: 50,
                            description: 'Number of articles to include',
                            example: 10
                        }
                    },
                    responses: {
                        200: 'RSS XML feed',
                        400: 'Invalid parameters',
                        404: 'No articles found',
                        502: 'Unable to fetch content'
                    },
                    example: `${baseUrl}/feed?url=https://example.com&title=Custom Feed&limit=10`
                },

                'GET /metadata': {
                    description: 'Get feed metadata without generating full feed',
                    parameters: {
                        url: {
                            type: 'string',
                            required: true,
                            description: 'Website URL to analyze'
                        }
                    },
                    example: `${baseUrl}/metadata?url=https://example.com`
                },

                'GET /preview': {
                    description: 'Preview articles that would be included in feed',
                    parameters: {
                        url: { type: 'string', required: true, description: 'Website URL' },
                        limit: { type: 'integer', required: false, min: 1, max: 50, description: 'Number of articles' },
                        page: { type: 'integer', required: false, min: 1, description: 'Page number for pagination' }
                    },
                    example: `${baseUrl}/preview?url=https://example.com&limit=5&page=1`
                },

                'GET /health': {
                    description: 'Health check and system status',
                    parameters: {},
                    example: `${baseUrl}/health`
                },

                'GET /cache/stats': {
                    description: 'Get cache statistics and performance metrics',
                    parameters: {},
                    example: `${baseUrl}/cache/stats`
                },

                'DELETE /cache': {
                    description: 'Clear cache (all or specific URL)',
                    parameters: {
                        url: { type: 'string', required: false, description: 'Specific URL to clear' }
                    },
                    example: `${baseUrl}/cache?url=https://example.com`
                },

                'POST /validate': {
                    description: 'Validate website URL and check scrapability',
                    body: {
                        url: { type: 'string', required: true, description: 'Website URL to validate' }
                    },
                    example: 'POST with {"url": "https://example.com"}'
                }
            },

            // Features and capabilities
            features: [
                'Automatic content extraction from any website',
                'RSS 2.0 compatible feeds',
                'Intelligent article detection with site-specific rules',
                'Caching for improved performance',
                'Rate limiting for fair usage',
                'Input validation and security checks',
                'Support for multiple content formats',
                'Customizable feed metadata',
                'Pagination support for large feeds',
                'Comprehensive error handling',
                'Real-time health monitoring'
            ],

            // Known limitations
            limitations: [
                'JavaScript-heavy sites may not work perfectly',
                'Some sites may block automated requests',
                'Feed updates depend on cache duration',
                'Rate limits apply to prevent abuse',
                'Private/local URLs blocked for security',
                'Maximum 50 articles per feed',
                'Request timeout after 10 seconds'
            ],

            // Technical details
            technical: {
                cacheDuration: `${config.app.cacheDuration} seconds`,
                maxArticlesPerFeed: config.app.maxArticlesPerFeed,
                requestTimeout: `${config.app.requestTimeout}ms`,
                rateLimit: {
                    window: `${config.security.rateLimitWindow / 1000} seconds`,
                    maxRequests: config.security.rateLimitMax
                },
                supportedProtocols: ['HTTP', 'HTTPS'],
                outputFormats: ['RSS 2.0', 'Atom (via /atom endpoint)']
            },

            // Example usage
            examples: {
                basic: `curl "${baseUrl}/feed?url=https://example.com"`,
                withCustomTitle: `curl "${baseUrl}/feed?url=https://example.com&title=My Feed"`,
                preview: `curl "${baseUrl}/preview?url=https://example.com&limit=5"`,
                validate: `curl -X POST ${baseUrl}/validate -H "Content-Type: application/json" -d '{"url":"https://example.com"}'`,
                metadata: `curl "${baseUrl}/metadata?url=https://example.com"`
            }
        };

        res.json(apiInfo);
    }

    /**
     * Validate website URL and check scrapability
     * POST /validate
     */
    async validateWebsite(req, res, next) {
        try {
            const { url } = req.validatedBody;
            const requestId = req.requestId;

            logWithTimestamp(`[${requestId}] Validating website: ${url}`);

            // Check website accessibility and scrapability
            const accessibility = await scraperService.checkWebsiteAccessibility(url);

            const response = {
                valid: true,
                url: url,
                accessible: accessibility.accessible,
                canGenerateFeed: accessibility.canScrape,
                details: accessibility.details,
                requestId,
                timestamp: new Date().toISOString()
            };

            if (accessibility.canScrape) {
                response.feedUrl = `${config.server.baseUrl}/feed?url=${encodeURIComponent(url)}`;
                response.previewUrl = `${config.server.baseUrl}/preview?url=${encodeURIComponent(url)}`;
                response.message = 'Website is suitable for RSS feed generation';
            } else {
                response.message = accessibility.reason || 'Website cannot be used for feed generation';
                response.error = accessibility.error;
            }

            res.json(response);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Generate ETag for caching
     */
    generateETag(url, options) {
        const hash = require('crypto')
            .createHash('md5')
            .update(url + JSON.stringify(options))
            .digest('hex');
        return hash.substring(0, 16);
    }

    /**
     * Format uptime in human readable format
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    /**
     * Get cache recommendations based on current state
     */
    getCacheRecommendations(cacheStats, memUsage) {
        const recommendations = [];

        if (cacheStats.size > 80) {
            recommendations.push('Consider clearing old cache entries');
        }

        const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        if (memUsagePercent > 80) {
            recommendations.push('High memory usage - consider restarting or clearing cache');
        }

        if (cacheStats.size === 0) {
            recommendations.push('Cache is empty - first requests will be slower');
        }

        return recommendations;
    }
}

module.exports = new FeedController();