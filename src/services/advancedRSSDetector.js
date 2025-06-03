// src/services/advancedRSSDetector.js (COMPLETE FIXED VERSION)
const httpService = require('./httpService');
const { logWithTimestamp, makeAbsoluteUrl, extractDomain } = require('../utils/helpers');

/**
 * Advanced RSS Detector Service (FIXED)
 * Comprehensive RSS feed detection with proper error handling and early exit
 */
class AdvancedRSSDetector {
    constructor() {
        // Statistics for each detection method
        this.stats = {
            htmlHeadDetection: 0,
            commonPathDetection: 0,
            urlPatternDetection: 0,
            domainRuleDetection: 0,
            sitemapDetection: 0,
            robotsDetection: 0,
            contentMiningDetection: 0,
            wordpressDetection: 0,
            totalAttempts: 0,
            totalSuccess: 0,
            cacheHits: 0,
            earlyExits: 0,
            blockedRequests: 0
        };

        // Domain-specific RSS patterns
        this.domainRules = this.loadDomainRules();

        // Cache for detected RSS URLs (TTL: 1 hour)
        this.rssCache = new Map();

        // Failed URL cache to avoid retrying (TTL: 10 minutes)
        this.failedUrlCache = new Set();

        // Rate limiting
        this.lastRequestTime = 0;
        this.minDelay = 200; // Minimum delay between requests
    }

    /**
     * 🎯 Main method: Find RSS feed URL using all available strategies (FIXED)
     * @param {string} url - Website URL (keep original path!)
     * @returns {Promise<string|null>} - RSS URL if found
     */
    async findRSSFeed(url) {
        try {
            this.stats.totalAttempts++;
            const startTime = Date.now();

            // Normalize URL but KEEP the path
            const normalizedUrl = this.normalizeUrl(url);
            logWithTimestamp(`🔍 [Advanced] Starting RSS detection for: ${normalizedUrl}`);

            // Check cache first
            const cachedRSS = this.getCachedRSS(normalizedUrl);
            if (cachedRSS) {
                this.stats.cacheHits++;
                logWithTimestamp(`💾 Cache hit: ${cachedRSS}`);
                return cachedRSS;
            }

            // Check if this URL recently failed
            if (this.isRecentlyFailed(normalizedUrl)) {
                logWithTimestamp(`⏭️  Skipping recently failed URL: ${normalizedUrl}`);
                return null;
            }

            // Run detection strategies in priority order with EARLY EXIT
            const strategies = [
                { name: 'HTML Head', fn: () => this.detectFromHTMLHead(normalizedUrl) },
                { name: 'Domain Rules', fn: () => this.detectFromDomainRules(normalizedUrl) },
                { name: 'URL Pattern', fn: () => this.detectFromURLPattern(normalizedUrl) },
                { name: 'Common Paths', fn: () => this.detectFromCommonPaths(normalizedUrl) },
                { name: 'WordPress', fn: () => this.detectFromWordPress(normalizedUrl) }
                // Remove expensive strategies (sitemap, robots, content mining) for performance
            ];

            // Try each strategy until one succeeds
            for (const strategy of strategies) {
                try {
                    logWithTimestamp(`🔄 Trying strategy: ${strategy.name}`);

                    const rssUrl = await strategy.fn();
                    if (rssUrl) {
                        const duration = Date.now() - startTime;
                        logWithTimestamp(`✅ RSS detected via ${strategy.name} in ${duration}ms: ${rssUrl}`);

                        // Cache successful result
                        this.cacheRSSUrl(normalizedUrl, rssUrl);
                        this.stats.totalSuccess++;
                        this.stats.earlyExits++;

                        return rssUrl;
                    }
                } catch (error) {
                    logWithTimestamp(`⚠️  Strategy ${strategy.name} failed: ${error.message}`, 'warn');
                    continue; // Try next strategy
                }

                // Small delay between strategies to avoid overwhelming server
                await this.rateLimit();
            }

            // Mark as failed to avoid retrying soon
            this.markAsFailed(normalizedUrl);
            logWithTimestamp(`❌ No RSS feed found for ${normalizedUrl} after trying all strategies`);
            return null;

        } catch (error) {
            logWithTimestamp(`💥 Error in RSS detection: ${error.message}`, 'error');
            this.markAsFailed(url);
            return null;
        }
    }

    /**
     * 🔧 Normalize URL while preserving path
     */
    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            // Keep the path! This was the main bug
            return `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '') || urlObj.origin;
        } catch (error) {
            return url;
        }
    }

    /**
     * 📄 Strategy 1: Detect from HTML head tags (FIXED with better error handling)
     */
    async detectFromHTMLHead(url) {
        try {
            const html = await this.safeFetchHtml(url);
            if (!html) return null;

            const cheerio = require('cheerio');
            const $ = cheerio.load(html);

            // Enhanced selectors
            const rssSelectors = [
                'link[type="application/rss+xml"]',
                'link[type="application/atom+xml"]',
                'link[rel="alternate"][type="application/rss+xml"]',
                'link[rel="alternate"][type="application/atom+xml"]',
                'link[rel="feed"]'
            ];

            for (const selector of rssSelectors) {
                const $links = $(selector);
                for (let i = 0; i < $links.length; i++) {
                    const href = $($links[i]).attr('href');
                    if (href) {
                        const rssUrl = makeAbsoluteUrl(href, url);
                        if (await this.validateRSSUrl(rssUrl)) {
                            this.stats.htmlHeadDetection++;
                            logWithTimestamp(`📄 HTML head detection: ${rssUrl}`);
                            return rssUrl;
                        }
                    }
                }
            }
            return null;
        } catch (error) {
            logWithTimestamp(`HTML head detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🎯 Strategy 2: Domain-specific rules (IMPROVED with path handling)
     */
    async detectFromDomainRules(url) {
        try {
            const urlObj = new URL(url);
            const domain = extractDomain(url);
            const rules = this.domainRules[domain];

            if (!rules) return null;

            logWithTimestamp(`🎯 Applying domain rules for: ${domain}`);

            for (const rule of rules.patterns) {
                const rssUrl = this.applyDomainRule(url, rule);
                if (rssUrl && await this.validateRSSUrl(rssUrl)) {
                    this.stats.domainRuleDetection++;
                    logWithTimestamp(`🎯 Domain rule success: ${rssUrl}`);
                    return rssUrl;
                }
            }
            return null;
        } catch (error) {
            logWithTimestamp(`Domain rule detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🧠 Strategy 3: URL pattern inference (IMPROVED)
     */
    async detectFromURLPattern(url) {
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s);

            logWithTimestamp(`🧠 Analyzing URL pattern: ${urlObj.pathname}`);

            // Generate potential RSS URLs based on URL structure
            const candidates = [];

            // Pattern 1: /category → /rss/category.rss (VnExpress style)
            if (pathSegments.length === 1) {
                candidates.push(`${urlObj.origin}/rss/${pathSegments[0]}.rss`);
                candidates.push(`${urlObj.origin}/${pathSegments[0]}/feed`);
            }

            // Pattern 2: Root domain → /rss/trang-chu.rss (VnExpress default)
            if (pathSegments.length === 0) {
                candidates.push(`${urlObj.origin}/rss/trang-chu.rss`);
                candidates.push(`${urlObj.origin}/rss`);
            }

            // Test candidates with early exit
            for (const candidate of candidates) {
                if (await this.validateRSSUrl(candidate)) {
                    this.stats.urlPatternDetection++;
                    logWithTimestamp(`🧠 URL pattern success: ${candidate}`);
                    return candidate;
                }
                await this.rateLimit(); // Rate limiting between tests
            }

            return null;
        } catch (error) {
            logWithTimestamp(`URL pattern detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 📁 Strategy 4: Common paths (REDUCED to avoid 406 errors)
     */
    async detectFromCommonPaths(url) {
        try {
            const urlObj = new URL(url);
            // Reduced common paths to avoid triggering 406 errors
            const commonPaths = [
                '/rss',
                '/feed'
                // Removed .xml paths that commonly trigger 406 on VnExpress
            ];

            logWithTimestamp(`📁 Testing ${commonPaths.length} common paths`);

            for (const path of commonPaths) {
                const candidate = `${urlObj.origin}${path}`;
                if (await this.validateRSSUrl(candidate)) {
                    this.stats.commonPathDetection++;
                    logWithTimestamp(`📁 Common path success: ${candidate}`);
                    return candidate;
                }
                await this.rateLimit();
            }
            return null;
        } catch (error) {
            logWithTimestamp(`Common path detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🔧 Strategy 5: WordPress detection (SIMPLIFIED)
     */
    async detectFromWordPress(url) {
        try {
            const urlObj = new URL(url);
            const candidates = [
                `${url}/feed`,
                `${urlObj.origin}/feed`
            ];

            logWithTimestamp(`🔧 Testing WordPress patterns`);

            for (const candidate of candidates) {
                if (await this.validateRSSUrl(candidate)) {
                    this.stats.wordpressDetection++;
                    logWithTimestamp(`🔧 WordPress success: ${candidate}`);
                    return candidate;
                }
                await this.rateLimit();
            }
            return null;
        } catch (error) {
            logWithTimestamp(`WordPress detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🏗️ Load domain-specific RSS rules (UPDATED with better VnExpress patterns)
     */
    loadDomainRules() {
        return {
            'vnexpress.net': {
                patterns: [
                    // VnExpress pattern: /category → /rss/category.rss
                    { type: 'path_to_rss', template: '/rss/{path}.rss' },
                    // VnExpress default homepage RSS
                    { type: 'fixed', url: '/rss/trang-chu.rss' },
                    // VnExpress RSS directory
                    { type: 'fixed', url: '/rss' }
                ]
            },
            'tuoitre.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss/tin-moi-nhat.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },
            'kenh14.vn': {
                patterns: [
                    { type: 'fixed', url: '/home.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },
            'thanhnien.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss/home.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },
            'dantri.com.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss.htm' },
                    { type: 'fixed', url: '/rss' }
                ]
            }
        };
    }

    /**
     * 🎯 Apply domain-specific rule (FIXED to handle paths correctly)
     */
    applyDomainRule(url, rule) {
        const urlObj = new URL(url);

        switch (rule.type) {
            case 'fixed':
                return `${urlObj.origin}${rule.url}`;

            case 'path_to_rss':
                // Extract the path segment (e.g., "phap-luat" from "/phap-luat")
                const pathSegments = urlObj.pathname.split('/').filter(s => s);
                if (pathSegments.length > 0) {
                    const path = pathSegments[0]; // Take first segment
                    return `${urlObj.origin}${rule.template.replace('{path}', path)}`;
                } else {
                    // Root path → default RSS
                    return `${urlObj.origin}/rss/trang-chu.rss`;
                }

            default:
                return null;
        }
    }

    /**
     * ✅ Validate RSS URL (IMPROVED with better error handling)
     */
    async validateRSSUrl(rssUrl) {
        try {
            // Skip recently failed URLs
            if (this.isRecentlyFailed(rssUrl)) {
                return false;
            }

            const response = await this.safeFetchHtml(rssUrl);

            if (!response || response.length < 50) {
                this.markAsFailed(rssUrl);
                return false;
            }

            const content = response.toLowerCase();
            const isValidRSS =
                content.includes('<rss') ||
                content.includes('<feed') ||
                content.includes('<channel>') ||
                content.includes('xmlns="http://www.w3.org/2005/atom"') ||
                content.includes('xmlns:atom=');

            if (!isValidRSS) {
                this.markAsFailed(rssUrl);
            }

            return isValidRSS;
        } catch (error) {
            this.markAsFailed(rssUrl);
            return false;
        }
    }

    /**
     * 🛡️ Safe HTML fetching with proper error handling
     */
    async safeFetchHtml(url) {
        try {
            await this.rateLimit();

            const response = await httpService.fetchHtml(url, {
                timeout: 5000, // 5 second timeout
                maxRedirects: 3,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });

            return response;
        } catch (error) {
            // Handle specific error codes
            if (error.message.includes('406')) {
                logWithTimestamp(`⚠️  406 Not Acceptable for ${url} - site may block automated requests`, 'warn');
                this.stats.blockedRequests++;
                this.markAsFailed(url);
            } else if (error.message.includes('timeout')) {
                logWithTimestamp(`⏰ Timeout for ${url}`, 'warn');
            }
            return null;
        }
    }

    /**
     * ⏱️ Rate limiting to avoid overwhelming servers
     */
    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minDelay) {
            const delay = this.minDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * 💾 Cache management (IMPROVED)
     */
    getCachedRSS(url) {
        const normalizedUrl = this.normalizeUrl(url);
        const cached = this.rssCache.get(normalizedUrl);

        if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour TTL
            return cached.rssUrl;
        } else if (cached) {
            this.rssCache.delete(normalizedUrl); // Expired
        }

        return null;
    }

    cacheRSSUrl(url, rssUrl) {
        const normalizedUrl = this.normalizeUrl(url);
        this.rssCache.set(normalizedUrl, {
            rssUrl: rssUrl,
            timestamp: Date.now()
        });
    }

    /**
     * 🚫 Failed URL tracking to avoid retries
     */
    isRecentlyFailed(url) {
        return this.failedUrlCache.has(url);
    }

    markAsFailed(url) {
        this.failedUrlCache.add(url);

        // Auto-expire failed URLs after 10 minutes
        setTimeout(() => {
            this.failedUrlCache.delete(url);
        }, 10 * 60 * 1000);
    }

    /**
     * 📊 Get detection statistics (ENHANCED)
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalAttempts > 0 ?
                Math.round((this.stats.totalSuccess / this.stats.totalAttempts) * 100) + '%' : '0%',
            cacheSize: this.rssCache.size,
            failedUrlCacheSize: this.failedUrlCache.size,
            supportedDomains: Object.keys(this.domainRules).length,
            earlyExitRate: this.stats.totalAttempts > 0 ?
                Math.round((this.stats.earlyExits / this.stats.totalAttempts) * 100) + '%' : '0%'
        };
    }

    /**
     * 🔄 Reset statistics and caches
     */
    resetStats() {
        Object.keys(this.stats).forEach(key => {
            this.stats[key] = 0;
        });
        this.rssCache.clear();
        this.failedUrlCache.clear();
    }

    /**
     * ➕ Add new domain rule
     */
    addDomainRule(domain, patterns) {
        this.domainRules[domain] = { patterns };
        logWithTimestamp(`Added domain rule for: ${domain}`);
    }

    /**
     * 🧹 Cleanup expired caches
     */
    cleanup() {
        const now = Date.now();

        // Clean RSS cache
        for (const [url, cache] of this.rssCache.entries()) {
            if (now - cache.timestamp > 3600000) { // 1 hour
                this.rssCache.delete(url);
            }
        }

        logWithTimestamp(`Cache cleanup: ${this.rssCache.size} entries remaining`);
    }
}

module.exports = new AdvancedRSSDetector();