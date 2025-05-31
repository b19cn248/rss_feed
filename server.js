// server.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');

// Import configuration and utilities
const config = require('./config');
const { logWithTimestamp } = require('./src/utils/helpers');

// Import middleware
const {
    requestLogger,
    responseLogger,
    rateLimiter,
    errorHandler,
    notFoundHandler,
    validateRequest,
    securityHeaders,
    corsConfig,
    responseTime
} = require('./src/middleware');

// Import routes
const routes = require('./src/routes');

/**
 * RSS Feed Generator Server
 * Main application entry point
 */
class Server {
    constructor() {
        this.app = express();
        this.server = null;

        // Initialize application
        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeErrorHandling();
        this.initializeScheduledTasks();
    }

    /**
     * Initialize Express middleware
     */
    initializeMiddleware() {
        // Trust proxy (important for rate limiting with reverse proxies)
        this.app.set('trust proxy', 1);

        // Basic security with Helmet
        this.app.use(helmet({
            contentSecurityPolicy: false, // Disable CSP for RSS feeds
            crossOriginEmbedderPolicy: false // Allow embedding
        }));

        // Custom security headers (early in pipeline)
        this.app.use(securityHeaders);

        // CORS configuration
        this.app.use(corsConfig);

        // Response time tracking (early to capture full request time)
        this.app.use(responseTime);

        // Request logging (early to log all requests)
        this.app.use(requestLogger);

        // Rate limiting (after logging, before processing)
        this.app.use(rateLimiter());

        // Body parsing middleware
        this.app.use(express.json({ limit: '1mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

        logWithTimestamp('✅ Middleware initialized');
    }

    /**
     * Initialize application routes
     */
    initializeRoutes() {
        // Mount main routes
        this.app.use('/', routes);

        // Favicon handler (prevent 404s)
        this.app.get('/favicon.ico', (req, res) => {
            res.status(204).end();
        });

        // Robots.txt (allow all bots to crawl feeds)
        this.app.get('/robots.txt', (req, res) => {
            res.type('text/plain');
            res.send(`User-agent: *
Allow: /feed
Allow: /rss
Allow: /atom
Disallow: /cache
Disallow: /debug
Disallow: /api/info

Sitemap: ${config.server.baseUrl}/sitemap.xml`);
        });

        // Basic sitemap for feeds
        this.app.get('/sitemap.xml', (req, res) => {
            res.type('application/xml');
            res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${config.server.baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${config.server.baseUrl}/api/info</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`);
        });

        logWithTimestamp('✅ Routes initialized');
    }

    /**
     * Initialize error handling
     */
    initializeErrorHandling() {
        // Response logger (after routes, before error handlers)
        this.app.use(responseLogger);

        // 404 handler for unknown routes
        this.app.use(notFoundHandler);

        // Global error handler (must be last)
        this.app.use(errorHandler);

        logWithTimestamp('✅ Error handling initialized');
    }

    /**
     * Initialize scheduled tasks
     */
    initializeScheduledTasks() {
        // Clean cache periodically (every hour)
        cron.schedule('0 * * * *', () => {
            this.cleanOldCache();
        });

        // System health check (every 15 minutes)
        cron.schedule('*/15 * * * *', () => {
            this.performHealthCheck();
        });

        // Log system stats (every 6 hours)
        cron.schedule('0 */6 * * *', () => {
            this.logSystemStats();
        });

        logWithTimestamp('✅ Scheduled tasks initialized');
    }

    /**
     * Clean old cache entries
     */
    cleanOldCache() {
        try {
            const feedService = require('./src/services/feedService');
            const stats = feedService.getCacheStats();

            logWithTimestamp(`Cache cleanup: ${stats.size} entries in cache`);

            // In a real implementation, you'd implement proper cache cleanup
            // For now, just log the stats
            if (stats.size > 50) {
                logWithTimestamp('Cache size is large, consider implementing cleanup', 'warn');
            }
        } catch (error) {
            logWithTimestamp(`Cache cleanup failed: ${error.message}`, 'error');
        }
    }

    /**
     * Perform system health check
     */
    performHealthCheck() {
        const memUsage = process.memoryUsage();
        const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

        logWithTimestamp(`Health check - Memory: ${memUsedMB}MB, Uptime: ${Math.round(process.uptime())}s`);

        // Alert if memory usage is too high
        if (memUsedMB > 500) {
            logWithTimestamp('High memory usage detected', 'warn');
        }
    }

    /**
     * Log system statistics
     */
    logSystemStats() {
        const memUsage = process.memoryUsage();
        const uptimeHours = Math.round(process.uptime() / 3600);

        logWithTimestamp(`System stats - Uptime: ${uptimeHours}h, Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    }

    /**
     * Start the server
     */
    async start() {
        try {
            // Validate configuration
            config.validate();

            // Start HTTP server
            this.server = this.app.listen(config.server.port, () => {
                logWithTimestamp(`🚀 RSS Feed Generator Server started`);
                logWithTimestamp(`📡 Server running on port ${config.server.port}`);
                logWithTimestamp(`🌍 Base URL: ${config.server.baseUrl}`);
                logWithTimestamp(`📊 Environment: ${config.server.env}`);
                logWithTimestamp(`⚙️  Cache duration: ${config.app.cacheDuration}s`);
                logWithTimestamp(`🔒 Rate limit: ${config.security.rateLimitMax} requests per ${config.security.rateLimitWindow / 1000}s`);

                // Show some example URLs
                logWithTimestamp(`\n📖 Example usage:`);
                logWithTimestamp(`   Feed: ${config.server.baseUrl}/feed?url=https://vnexpress.net`);
                logWithTimestamp(`   Preview: ${config.server.baseUrl}/preview?url=https://vnexpress.net`);
                logWithTimestamp(`   Health: ${config.server.baseUrl}/health`);
                logWithTimestamp(`   API Info: ${config.server.baseUrl}/api/info\n`);
            });

            // Handle server errors
            this.server.on('error', this.handleServerError.bind(this));

        } catch (error) {
            logWithTimestamp(`❌ Failed to start server: ${error.message}`, 'error');
            process.exit(1);
        }
    }

    /**
     * Handle server errors
     */
    handleServerError(error) {
        if (error.code === 'EADDRINUSE') {
            logWithTimestamp(`❌ Port ${config.server.port} is already in use`, 'error');
        } else {
            logWithTimestamp(`❌ Server error: ${error.message}`, 'error');
        }
        process.exit(1);
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logWithTimestamp('🔄 Shutting down server gracefully...');

        if (this.server) {
            this.server.close((err) => {
                if (err) {
                    logWithTimestamp(`Error during shutdown: ${err.message}`, 'error');
                    process.exit(1);
                } else {
                    logWithTimestamp('✅ Server closed successfully');
                    process.exit(0);
                }
            });
        } else {
            process.exit(0);
        }
    }
}

// Create and start server instance
const server = new Server();

// Handle graceful shutdown
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logWithTimestamp(`❌ Uncaught Exception: ${error.message}`, 'error');
    console.error(error.stack);
    server.shutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logWithTimestamp(`❌ Unhandled Rejection at: ${promise}, reason: ${reason}`, 'error');
    server.shutdown();
});

// Start the server
server.start();

module.exports = server;