// src/routes/index.js
const express = require('express');
const feedController = require('../controllers/feedController');
const ValidationService = require('../validators');

const router = express.Router();

/**
 * RSS Feed Generation Routes
 * FIX: Wrap tất cả method calls trong arrow function để giữ nguyên 'this' context
 */

// Main feed generation endpoint
router.get('/feed',
    ValidationService.validateFeedRequest,
    (req, res, next) => feedController.generateFeed(req, res, next)
);

// Get feed metadata
router.get('/metadata',
    ValidationService.validateFeedRequest,
    (req, res, next) => feedController.getFeedMetadata(req, res, next)
);

// Preview articles (for testing/debugging)
router.get('/preview',
    ValidationService.validateFeedRequest,
    ValidationService.validatePagination,
    (req, res, next) => feedController.previewArticles(req, res, next)
);

/**
 * System and Utility Routes
 */

// Health check (no validation needed)
router.get('/health', (req, res) => feedController.healthCheck(req, res));

// API information (no validation needed)
router.get('/api/info', (req, res) => feedController.getApiInfo(req, res));

// Website validation
router.post('/validate',
    ValidationService.validateWebsiteRequest,
    (req, res, next) => feedController.validateWebsite(req, res, next)
);

/**
 * Cache Management Routes
 */

// Get cache statistics (no validation needed)
router.get('/cache/stats', (req, res, next) => feedController.getCacheStats(req, res, next));

// Clear cache
router.delete('/cache',
    ValidationService.validateCacheRequest,
    (req, res, next) => feedController.clearCache(req, res, next)
);

/**
 * Root endpoint - API documentation
 */
router.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
        name: 'RSS Feed Generator API',
        version: '1.0.0',
        description: 'Generate RSS feeds from websites that don\'t provide them',

        status: 'operational',
        timestamp: new Date().toISOString(),

        quickStart: {
            generateFeed: {
                method: 'GET',
                endpoint: '/feed?url=<website_url>',
                example: `${baseUrl}/feed?url=https://example.com`,
                description: 'Generate RSS feed for any website'
            },

            previewArticles: {
                method: 'GET',
                endpoint: '/preview?url=<website_url>&limit=<number>',
                example: `${baseUrl}/preview?url=https://example.com&limit=5`,
                description: 'Preview articles before generating feed'
            }
        },

        endpoints: [
            {
                path: 'GET /feed',
                description: 'Generate RSS feed',
                parameters: {
                    url: 'Website URL (required)',
                    title: 'Custom feed title (optional, max 100 chars)',
                    description: 'Custom feed description (optional, max 500 chars)',
                    limit: 'Number of articles (optional, 1-50)'
                }
            },
            {
                path: 'GET /metadata',
                description: 'Get feed metadata',
                parameters: {
                    url: 'Website URL (required)'
                }
            },
            {
                path: 'GET /preview',
                description: 'Preview articles',
                parameters: {
                    url: 'Website URL (required)',
                    limit: 'Number of articles (optional, 1-50)',
                    page: 'Page number (optional, for pagination)'
                }
            },
            {
                path: 'GET /health',
                description: 'System health check',
                parameters: {}
            },
            {
                path: 'GET /api/info',
                description: 'Detailed API documentation',
                parameters: {}
            },
            {
                path: 'POST /validate',
                description: 'Validate website URL',
                body: {
                    url: 'Website URL to validate (required)'
                }
            },
            {
                path: 'GET /cache/stats',
                description: 'Cache statistics',
                parameters: {}
            },
            {
                path: 'DELETE /cache',
                description: 'Clear cache',
                parameters: {
                    url: 'Website URL to clear (optional, clears all if not provided)'
                }
            }
        ],

        features: [
            'Automatic content extraction from any website',
            'RSS 2.0 compatible feeds',
            'Intelligent article detection',
            'Caching for improved performance',
            'Rate limiting for fair usage',
            'Input validation and security checks',
            'Support for multiple content formats',
            'Customizable feed metadata'
        ],

        limitations: [
            'JavaScript-heavy sites may not work perfectly',
            'Some sites may block automated requests',
            'Feed updates depend on cache duration',
            'Rate limits apply to prevent abuse',
            'Private/local URLs blocked for security'
        ],

        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 100,
            message: 'Requests are rate limited to prevent abuse'
        },

        caching: {
            duration: '1 hour',
            note: 'Feeds are cached to improve performance and reduce load on target websites'
        },

        support: {
            documentation: `${baseUrl}/api/info`,
            healthCheck: `${baseUrl}/health`,
            examples: {
                basicFeed: `${baseUrl}/feed?url=https://example.com`,
                customTitle: `${baseUrl}/feed?url=https://example.com&title=My Custom Feed`,
                preview: `${baseUrl}/preview?url=https://example.com&limit=5`
            }
        }
    });
});

/**
 * Alternative routes for convenience
 */

// Alternative feed route (some feed readers expect /rss)
router.get('/rss',
    ValidationService.validateFeedRequest,
    (req, res, next) => feedController.generateFeed(req, res, next)
);

// Alternative feed route (some expect /feeds)
router.get('/feeds',
    ValidationService.validateFeedRequest,
    (req, res, next) => feedController.generateFeed(req, res, next)
);

// Atom feed support (returns RSS but with atom content-type)
router.get('/atom',
    ValidationService.validateFeedRequest,
    (req, res, next) => {
        // Store original send method
        const originalSend = res.send;

        // Override send to set atom content type
        res.send = function(data) {
            if (!res.headersSent) {
                res.set('Content-Type', 'application/atom+xml; charset=utf-8');
            }
            return originalSend.call(this, data);
        };

        feedController.generateFeed(req, res, next);
    }
);

/**
 * Debug routes (only available in development)
 */
if (process.env.NODE_ENV === 'development') {

    // Debug: Show extracted raw data
    router.get('/debug/extract',
        ValidationService.validateFeedRequest,
        async (req, res, next) => {
            try {
                const { url } = req.validatedQuery;
                const scraperService = require('../services/scraperService');

                const html = await scraperService.fetchHtml(url);
                const articles = await scraperService.extractArticles(url);

                res.json({
                    debug: true,
                    url: url,
                    htmlLength: html.length,
                    articlesExtracted: articles.length,
                    articles: articles.slice(0, 5), // Limit for debug
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                next(error);
            }
        }
    );

    // Debug: Test HTML parsing
    router.post('/debug/parse', async (req, res, next) => {
        try {
            const { html, baseUrl } = req.body;

            if (!html) {
                return res.status(400).json({
                    error: true,
                    message: 'HTML content required in request body',
                    code: 'MISSING_HTML'
                });
            }

            const cheerio = require('cheerio');
            const $ = cheerio.load(html);
            const scraperService = require('../services/scraperService');

            // Use scraper service to find articles
            const articleElements = scraperService.findArticleElements($);
            const articles = [];

            for (const element of articleElements.slice(0, 5)) { // Limit to 5 for debug
                const article = scraperService.extractArticleData($, element, baseUrl || 'http://example.com');
                if (article) articles.push(article);
            }

            res.json({
                debug: true,
                htmlLength: html.length,
                elementsFound: articleElements.length,
                articlesExtracted: articles.length,
                articles: articles,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    });
}

module.exports = router;