// server.js
const express = require('express');
const helmet = require('helmet');
const cron = require('node-cron');

// Import configuration and utilities
const config = require('./config');
const { logWithTimestamp } = require('./src/utils/helpers');
const { AppError, ErrorUtils } = require('./src/errors');

// Import enhanced middleware
const {
    requestLogger,
    responseLogger,
    rateLimiter,
    errorHandler,
    notFoundHandler,
    securityHeaders,
    corsConfig,
    responseTime,
    requestSizeLimiter
} = require('./src/middleware');

// Import routes
const routes = require('./src/routes');

/**
 * RSS Feed Generator Server (Enhanced)
 * Main application entry point with improved error handling and monitoring
 */
class Server {
    constructor() {
        this.app = express();
        this.server = null;
        this.isShuttingDown = false;

        // Server statistics
        this.stats = {
            startTime: new Date(),
            totalRequests: 0,
            totalErrors: 0,
            uptime: 0
        };

        // Initialize application
        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeErrorHandling();
        this.initializeScheduledTasks();
        this.initializeGracefulShutdown();
    }

    /**
     * Initialize Express middleware with enhanced configuration
     */
    initializeMiddleware() {
        // Trust proxy for accurate IP addresses (important for rate limiting)
        this.app.set('trust proxy', 1);

        // Disable x-powered-by header
        this.app.disable('x-powered-by');

        // Enhanced security with Helmet
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["*", "data:", "https:"],
                    scriptSrc: ["'none'"], // No scripts needed for RSS feeds
                    objectSrc: ["'none'"],
                    frameSrc: ["'none'"]
                }
            },
            crossOriginEmbedderPolicy: false, // Allow embedding for RSS readers
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        }));

        // Custom security headers (applied early)
        this.app.use(securityHeaders);

        // CORS configuration for RSS feeds
        this.app.use(corsConfig);

        // Response time tracking
        this.app.use(responseTime);

        // Request logging (early to capture all requests)
        this.app.use(requestLogger);

        // Request statistics tracking
        this.app.use((req, res, next) => {
            this.stats.totalRequests++;
            next();
        });

        // Rate limiting with enhanced configuration
        this.app.use(rateLimiter());

        // Request size limiting
        this.app.use(requestSizeLimiter('2mb'));

        // Body parsing middleware with security considerations
        this.app.use(express.json({
            limit: '1mb',
            strict: true,
            verify: (req, res, buf) => {
                // Basic request verification
                req.rawBody = buf;
            }
        }));

        this.app.use(express.urlencoded({
            extended: true,
            limit: '1mb',
            parameterLimit: 100
        }));

        // Request timeout middleware
        this.app.use((req, res, next) => {
            req.setTimeout(config.app.requestTimeout, () => {
                const error = new AppError('Request timeout', 408, 'REQUEST_TIMEOUT');
                next(error);
            });
            next();
        });

        logWithTimestamp('✅ Enhanced middleware initialized');
    }

    /**
     * Initialize application routes
     */
    initializeRoutes() {
        // Health check endpoint (before main routes for priority)
        this.app.get('/ping', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: Math.round(process.uptime())
            });
        });

        // Mount main routes
        this.app.use('/', routes);

        // Favicon handler (prevent 404s)
        this.app.get('/favicon.ico', (req, res) => {
            res.status(204).end();
        });

        // Enhanced robots.txt
        this.app.get('/robots.txt', (req, res) => {
            res.type('text/plain');
            const robotsTxt = `User-agent: *
Allow: /feed
Allow: /rss
Allow: /atom
Allow: /metadata
Allow: /preview
Allow: /health
Allow: /api/info
Disallow: /cache
Disallow: /debug
Disallow: /validate

# Crawl-delay to be respectful
Crawl-delay: 1

# Sitemap location
Sitemap: ${config.server.baseUrl}/sitemap.xml

# Contact information
# Contact: ${config.server.baseUrl}/api/info`;

            res.send(robotsTxt);
        });

        // Enhanced sitemap for better SEO
        this.app.get('/sitemap.xml', (req, res) => {
            res.type('application/xml');
            const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:changefreq="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:priority="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${config.server.baseUrl}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${config.server.baseUrl}/api/info</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${config.server.baseUrl}/health</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`;
            res.send(sitemap);
        });

        // OpenAPI/Swagger JSON endpoint for API documentation
        this.app.get('/openapi.json', (req, res) => {
            const openApiSpec = this.generateOpenApiSpec(req);
            res.json(openApiSpec);
        });

        logWithTimestamp('✅ Routes initialized');
    }

    /**
     * Initialize error handling
     */
    initializeErrorHandling() {
        // Response logger (after routes, before error handlers)
        this.app.use(responseLogger);

        // Error statistics tracking
        this.app.use((err, req, res, next) => {
            this.stats.totalErrors++;
            next(err);
        });

        // 404 handler for unknown routes
        this.app.use(notFoundHandler);

        // Global error handler (must be last)
        this.app.use(errorHandler);

        logWithTimestamp('✅ Enhanced error handling initialized');
    }

    /**
     * Initialize scheduled tasks
     */
    initializeScheduledTasks() {
        // Clean cache periodically (every hour)
        cron.schedule('0 * * * *', () => {
            this.performCacheCleanup();
        }, {
            scheduled: true,
            timezone: "UTC"
        });

        // System health check (every 15 minutes)
        cron.schedule('*/15 * * * *', () => {
            this.performHealthCheck();
        }, {
            scheduled: true,
            timezone: "UTC"
        });

        // Log system stats (every 6 hours)
        cron.schedule('0 */6 * * *', () => {
            this.logSystemStats();
        }, {
            scheduled: true,
            timezone: "UTC"
        });

        // Daily statistics report (every day at midnight UTC)
        cron.schedule('0 0 * * *', () => {
            this.generateDailyReport();
        }, {
            scheduled: true,
            timezone: "UTC"
        });

        logWithTimestamp('✅ Scheduled tasks initialized');
    }

    /**
     * Initialize graceful shutdown handling
     */
    initializeGracefulShutdown() {
        // Handle graceful shutdown
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
        process.on('SIGINT', () => this.shutdown('SIGINT'));

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logWithTimestamp(`❌ Uncaught Exception: ${error.message}`, 'error');
            console.error('Stack trace:', error.stack);
            this.shutdown('UNCAUGHT_EXCEPTION');
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logWithTimestamp(`❌ Unhandled Rejection at: ${promise}, reason: ${reason}`, 'error');
            this.shutdown('UNHANDLED_REJECTION');
        });

        logWithTimestamp('✅ Graceful shutdown handlers initialized');
    }

    /**
     * Perform cache cleanup with detailed logging
     */
    performCacheCleanup() {
        try {
            const feedService = require('./src/services/feedService');
            const stats = feedService.getCacheStats();

            logWithTimestamp(`Cache cleanup: ${stats.size} entries, ${stats.expiredEntries} expired`);

            if (stats.expiredEntries > 0) {
                // Cleanup is handled automatically by feedService
                logWithTimestamp(`Cache cleanup completed`);
            }

            // Alert if cache size is growing too large
            if (stats.size > 80) {
                logWithTimestamp('Cache size approaching limit, consider clearing old entries', 'warn');
            }

        } catch (error) {
            logWithTimestamp(`Cache cleanup failed: ${error.message}`, 'error');
        }
    }

    /**
     * Perform comprehensive health check
     */
    performHealthCheck() {
        const memUsage = process.memoryUsage();
        const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const uptime = Math.round(process.uptime());

        const healthStatus = {
            timestamp: new Date().toISOString(),
            uptime: uptime,
            memory: {
                used: memUsedMB,
                total: memTotalMB,
                percentage: Math.round((memUsedMB / memTotalMB) * 100)
            },
            requests: {
                total: this.stats.totalRequests,
                errors: this.stats.totalErrors,
                errorRate: this.stats.totalRequests > 0 ?
                    Math.round((this.stats.totalErrors / this.stats.totalRequests) * 100) : 0
            }
        };

        logWithTimestamp(
            `Health Check - Uptime: ${uptime}s, Memory: ${memUsedMB}/${memTotalMB}MB (${healthStatus.memory.percentage}%), ` +
            `Requests: ${this.stats.totalRequests} (${healthStatus.requests.errorRate}% errors)`
        );

        // Alert conditions
        if (memUsedMB > 500) {
            logWithTimestamp('🚨 High memory usage detected', 'warn');
        }

        if (healthStatus.requests.errorRate > 10 && this.stats.totalRequests > 100) {
            logWithTimestamp('🚨 High error rate detected', 'warn');
        }

        // Update uptime stats
        this.stats.uptime = uptime;
    }

    /**
     * Log comprehensive system statistics
     */
    logSystemStats() {
        const memUsage = process.memoryUsage();
        const uptimeHours = Math.round(process.uptime() / 3600);
        const startTime = this.stats.startTime;
        const runningTime = Math.round((Date.now() - startTime.getTime()) / 1000 / 3600);

        const stats = {
            uptime: `${uptimeHours}h`,
            startTime: startTime.toISOString(),
            runningTime: `${runningTime}h`,
            memory: {
                heap: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                total: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
            },
            requests: {
                total: this.stats.totalRequests,
                errors: this.stats.totalErrors,
                rps: Math.round(this.stats.totalRequests / (process.uptime() || 1))
            }
        };

        logWithTimestamp(
            `📊 System Stats - ${JSON.stringify(stats, null, 2)}`
        );
    }

    /**
     * Generate daily report
     */
    generateDailyReport() {
        const report = {
            date: new Date().toISOString().split('T')[0],
            uptime: Math.round(process.uptime() / 3600),
            totalRequests: this.stats.totalRequests,
            totalErrors: this.stats.totalErrors,
            errorRate: this.stats.totalRequests > 0 ?
                ((this.stats.totalErrors / this.stats.totalRequests) * 100).toFixed(2) : '0.00',
            memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        };

        logWithTimestamp(`📈 Daily Report - ${JSON.stringify(report)}`);
    }

    /**
     * Generate OpenAPI specification
     */
    generateOpenApiSpec(req) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        return {
            openapi: '3.0.0',
            info: {
                title: 'RSS Feed Generator API',
                version: '1.0.0',
                description: 'Generate RSS feeds from websites that don\'t provide them',
                contact: {
                    name: 'API Support',
                    url: `${baseUrl}/api/info`
                }
            },
            servers: [
                {
                    url: baseUrl,
                    description: 'Production server'
                }
            ],
            paths: {
                '/feed': {
                    get: {
                        summary: 'Generate RSS feed',
                        parameters: [
                            {
                                name: 'url',
                                in: 'query',
                                required: true,
                                schema: { type: 'string', format: 'uri' },
                                description: 'Website URL to generate feed from'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'RSS XML feed',
                                content: {
                                    'application/rss+xml': {
                                        schema: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                },
                '/health': {
                    get: {
                        summary: 'Health check',
                        responses: {
                            '200': {
                                description: 'Health status',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                status: { type: 'string' },
                                                timestamp: { type: 'string' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };
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
                const startupInfo = [
                    '🚀 RSS Feed Generator Server Started',
                    '====================================',
                    `📡 Port: ${config.server.port}`,
                    `🌍 Base URL: ${config.server.baseUrl}`,
                    `📊 Environment: ${config.server.env}`,
                    `⚙️  Cache Duration: ${config.app.cacheDuration}s`,
                    `🔒 Rate Limit: ${config.security.rateLimitMax} requests per ${config.security.rateLimitWindow / 1000}s`,
                    `⏱️  Request Timeout: ${config.app.requestTimeout}ms`,
                    `📄 Max Articles: ${config.app.maxArticlesPerFeed}`,
                    '',
                    '📖 Example Usage:',
                    `   Feed: ${config.server.baseUrl}/feed?url=https://vnexpress.net`,
                    `   Preview: ${config.server.baseUrl}/preview?url=https://vnexpress.net`,
                    `   Health: ${config.server.baseUrl}/health`,
                    `   API Docs: ${config.server.baseUrl}/api/info`,
                    `   OpenAPI: ${config.server.baseUrl}/openapi.json`,
                    ''
                ];

                startupInfo.forEach(line => logWithTimestamp(line));
            });

            // Handle server errors
            this.server.on('error', this.handleServerError.bind(this));

            // Server ready events
            this.server.on('listening', () => {
                logWithTimestamp('🟢 Server is ready to accept connections');
            });

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
        } else if (error.code === 'EACCES') {
            logWithTimestamp(`❌ Permission denied to bind to port ${config.server.port}`, 'error');
        } else {
            logWithTimestamp(`❌ Server error: ${error.message}`, 'error');
        }
        process.exit(1);
    }

    /**
     * Graceful shutdown
     */
    async shutdown(signal) {
        if (this.isShuttingDown) {
            logWithTimestamp('🔄 Force shutdown - killing process');
            process.exit(1);
        }

        this.isShuttingDown = true;
        logWithTimestamp(`🔄 Graceful shutdown initiated (${signal})`);

        // Stop accepting new connections
        if (this.server) {
            this.server.close((err) => {
                if (err) {
                    logWithTimestamp(`❌ Error during shutdown: ${err.message}`, 'error');
                    process.exit(1);
                } else {
                    logWithTimestamp('✅ Server closed successfully');
                    this.generateFinalReport();
                    process.exit(0);
                }
            });

            // Force close after 10 seconds
            setTimeout(() => {
                logWithTimestamp('⏰ Force closing server after timeout');
                process.exit(1);
            }, 10000);
        } else {
            this.generateFinalReport();
            process.exit(0);
        }
    }

    /**
     * Generate final report before shutdown
     */
    generateFinalReport() {
        const uptime = Math.round(process.uptime());
        const finalReport = {
            shutdownTime: new Date().toISOString(),
            totalUptime: `${Math.round(uptime / 3600)}h ${Math.round((uptime % 3600) / 60)}m`,
            totalRequests: this.stats.totalRequests,
            totalErrors: this.stats.totalErrors,
            finalErrorRate: this.stats.totalRequests > 0 ?
                ((this.stats.totalErrors / this.stats.totalRequests) * 100).toFixed(2) + '%' : '0%'
        };

        logWithTimestamp(`📋 Final Report: ${JSON.stringify(finalReport)}`);
    }

    /**
     * Get server statistics
     */
    getStats() {
        return {
            ...this.stats,
            uptime: Math.round(process.uptime()),
            isShuttingDown: this.isShuttingDown
        };
    }
}

// Create and start server instance
const server = new Server();

// Start the server
server.start();

module.exports = server;