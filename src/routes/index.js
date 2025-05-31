// src/routes/index.js
const express = require('express');
const feedController = require('../controllers/feedController');
const { validateRequest } = require('../middleware');

const router = express.Router();

/**
 * RSS Feed Generation Routes
 */

// Main feed generation endpoint
router.get('/feed', validateRequest, feedController.generateFeed);

// Get feed metadata
router.get('/metadata', validateRequest, feedController.getFeedMetadata);

// Preview articles (for testing/debugging)
router.get('/preview', validateRequest, feedController.previewArticles);

/**
 * System and Utility Routes
 */

// Health check
router.get('/health', feedController.healthCheck);

// API information
router.get('/api/info', feedController.getApiInfo);

// Website validation
router.post('/validate', feedController.validateWebsite);

/**
 * Cache Management Routes
 */

// Get cache statistics
router.get('/cache/stats', feedController.getCacheStats);

// Clear cache
router.delete('/cache', feedController.clearCache);

/**
 * Root endpoint - API documentation
 */
router.get('/', (req, res) => {
    res.json({
        name: 'RSS Feed Generator API',
        version: '1.0.0',
        description: 'Generate RSS feeds from websites that don\'t provide them',

        quickStart: {
            generateFeed: {
                method: 'GET',
                endpoint: '/feed?url=<website_url>',
                example: `${req.protocol}://${req.get('host')}/feed?url=https://example.com`,
                description: 'Generate RSS feed for any website'
            },

            previewArticles: {
                method: 'GET',
                endpoint: '/preview?url=<website_url>',
                example: `${req.protocol}://${req.get('host')}/preview?url=https://example.com`,
                description: 'Preview articles before generating feed'
            }
        },

        endpoints: [
            'GET /feed - Generate RSS feed',
            'GET /metadata - Get feed metadata',
            'GET /preview - Preview articles',
            'GET /health - System health check',
            'GET /api/info - Detailed API documentation',
            'POST /validate - Validate website URL',
            'GET /cache/stats - Cache statistics',
            'DELETE /cache - Clear cache'
        ],

        documentation: `${req.protocol}://${req.get('host')}/api/info`,

        usage: {
            basicFeed: `${req.protocol}://${req.get('host')}/feed?url=https://vnexpress.net`,
            customTitle: `${req.protocol}://${req.get('host')}/feed?url=https://vnexpress.net&title=VnExpress RSS`,
            preview: `${req.protocol}://${req.get('host')}/preview?url=https://vnexpress.net&limit=5`
        },

        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 100,
            message: 'Requests are rate limited to prevent abuse'
        },

        caching: {
            duration: '1 hour',
            note: 'Feeds are cached to improve performance'
        },

        support: {
            email: 'support@example.com',
            documentation: 'https://github.com/your-repo/rss-feed-generator',
            issues: 'https://github.com/your-repo/rss-feed-generator/issues'
        }
    });
});

/**
 * Alternative routes for convenience
 */

// Alternative feed route (some feed readers expect /rss)
router.get('/rss', validateRequest, feedController.generateFeed);

// Alternative feed route (some expect /feeds)
router.get('/feeds', validateRequest, feedController.generateFeed);

// Atom feed support (returns RSS but with different content-type)
router.get('/atom', validateRequest, (req, res, next) => {
    // Set atom content type before processing
    const originalSend = res.send;
    res.send = function(data) {
        res.set('Content-Type', 'application/atom+xml; charset=utf-8');
        return originalSend.call(this, data);
    };

    feedController.generateFeed(req, res, next);
});

/**
 * Debug routes (only available in development)
 */
if (process.env.NODE_ENV === 'development') {

    // Debug: Show extracted raw data
    router.get('/debug/extract', validateRequest, async (req, res, next) => {
        try {
            const { url } = req.query;

            if (!url) {
                return res.status(400).json({
                    error: 'URL parameter required'
                });
            }

            const scraperService = require('../services/scraperService');
            const html = await scraperService.fetchHtml(url);
            const articles = await scraperService.extractArticles(url);

            res.json({
                debug: true,
                url: url,
                htmlLength: html.length,
                articlesExtracted: articles.length,
                articles: articles,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    });

    // Debug: Test HTML parsing
    router.post('/debug/parse', async (req, res, next) => {
        try {
            const { html, baseUrl } = req.body;

            if (!html) {
                return res.status(400).json({
                    error: 'HTML content required in request body'
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
                articles: articles
            });

        } catch (error) {
            next(error);
        }
    });
}

module.exports = router;