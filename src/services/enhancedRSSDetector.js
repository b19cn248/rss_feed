// Enhanced RSS Detector Service - Triệt để phát hiện RSS feed
const httpService = require('./httpService');
const { logWithTimestamp, makeAbsoluteUrl, extractDomain } = require('../utils/helpers');

/**
 * Enhanced RSS Detector với khả năng phát hiện mạnh mẽ
 * Hỗ trợ đầy đủ các báo Việt Nam và website quốc tế
 */
class EnhancedRSSDetector {
    constructor() {
        this.stats = {
            htmlHeadDetection: 0,
            domainRuleDetection: 0,
            urlPatternDetection: 0,
            commonPathDetection: 0,
            sitemapDetection: 0,
            robotsDetection: 0,
            smartPatternDetection: 0,  // 🆕 Phát hiện thông minh
            totalAttempts: 0,
            totalSuccess: 0,
            cacheHits: 0,
            earlyExits: 0
        };

        // Domain rules cho các báo Việt Nam phổ biến
        this.domainRules = this.loadVietnameseMediaRules();

        // Cache RSS URLs (TTL: 1 hour)
        this.rssCache = new Map();

        // Failed URL cache (TTL: 5 phút thay vì 10 phút)
        this.failedUrlCache = new Set();

        // Rate limiting
        this.lastRequestTime = 0;
        this.minDelay = 150;
    }

    /**
     * 🎯 Main method: Tìm RSS feed với logic nâng cao
     */
    async findRSSFeed(url) {
        try {
            this.stats.totalAttempts++;
            const startTime = Date.now();
            const normalizedUrl = this.normalizeUrl(url);

            logWithTimestamp(`🔍 [Enhanced] Starting RSS detection for: ${normalizedUrl}`);

            // Check cache
            const cachedRSS = this.getCachedRSS(normalizedUrl);
            if (cachedRSS) {
                this.stats.cacheHits++;
                return cachedRSS;
            }

            // 🆕 Kiểm tra failed cache nhưng với thời gian ngắn hơn (5 phút)
            if (this.isRecentlyFailed(normalizedUrl)) {
                const failTime = this.getFailTime(normalizedUrl);
                if (Date.now() - failTime < 5 * 60 * 1000) { // 5 phút
                    logWithTimestamp(`⏭️ Skipping recently failed URL (retry after 5min): ${normalizedUrl}`);
                    return null;
                }
                // Xóa khỏi failed cache nếu đã qua 5 phút
                this.removeFromFailedCache(normalizedUrl);
            }

            // Strategies theo thứ tự ưu tiên
            const strategies = [
                { name: 'Domain Rules', fn: () => this.detectFromDomainRules(normalizedUrl) },
                { name: 'Smart Pattern', fn: () => this.detectFromSmartPattern(normalizedUrl) }, // 🆕
                { name: 'HTML Head', fn: () => this.detectFromHTMLHead(normalizedUrl) },
                { name: 'Enhanced Common Paths', fn: () => this.detectFromEnhancedCommonPaths(normalizedUrl) }, // 🆕
                { name: 'URL Pattern', fn: () => this.detectFromURLPattern(normalizedUrl) }
            ];

            // Thử từng strategy với early exit
            for (const strategy of strategies) {
                try {
                    logWithTimestamp(`🔄 Trying strategy: ${strategy.name}`);
                    const rssUrl = await strategy.fn();

                    if (rssUrl) {
                        const duration = Date.now() - startTime;
                        logWithTimestamp(`✅ RSS found via ${strategy.name} in ${duration}ms: ${rssUrl}`);

                        this.cacheRSSUrl(normalizedUrl, rssUrl);
                        this.stats.totalSuccess++;
                        this.stats.earlyExits++;
                        return rssUrl;
                    }
                } catch (error) {
                    logWithTimestamp(`⚠️ Strategy ${strategy.name} failed: ${error.message}`, 'warn');
                    continue;
                }

                await this.rateLimit();
            }

            // Mark as failed with shorter TTL
            this.markAsFailed(normalizedUrl);
            logWithTimestamp(`❌ No RSS feed found for ${normalizedUrl}`);
            return null;

        } catch (error) {
            logWithTimestamp(`💥 Error in RSS detection: ${error.message}`, 'error');
            this.markAsFailed(url);
            return null;
        }
    }

    /**
     * 🆕 Smart Pattern Detection - Phát hiện thông minh dựa trên URL structure
     */
    async detectFromSmartPattern(url) {
        try {
            const urlObj = new URL(url);
            const domain = extractDomain(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s);

            logWithTimestamp(`🧠 Smart pattern analysis for ${domain}: ${urlObj.pathname}`);

            const candidates = [];

            // Pattern 1: Vietnamese news sites - /category → /rss/category.rss
            if (this.isVietnameseNewsSite(domain)) {
                if (pathSegments.length === 1) {
                    candidates.push(`${urlObj.origin}/rss/${pathSegments[0]}.rss`);
                    candidates.push(`${urlObj.origin}/rss/${pathSegments[0]}`);
                }

                // Default homepage RSS for Vietnamese sites
                candidates.push(`${urlObj.origin}/rss/trang-chu.rss`);
                candidates.push(`${urlObj.origin}/rss/home.rss`);
                candidates.push(`${urlObj.origin}/rss/tin-moi-nhat.rss`);
            }

            // Pattern 2: Special handling for known sites with category-specific RSS
            if (domain.includes('theverge.com') && pathSegments.length > 0) {
                // The Verge: /entertainment → /rss/entertainment/index.xml
                candidates.push(`${urlObj.origin}/rss/${pathSegments[0]}/index.xml`);
                
                // Also try nested paths
                if (pathSegments.length > 1) {
                    candidates.push(`${urlObj.origin}/rss/${pathSegments.join('/')}/index.xml`);
                }
            }

            // Pattern 3: Extension-based detection (e.g., .htm to .rss)
            if (urlObj.pathname.endsWith('.htm')) {
                const rssPath = urlObj.pathname.replace('.htm', '.rss');
                candidates.push(`${urlObj.origin}${rssPath}`);
                logWithTimestamp(`🔄 Smart pattern: .htm to .rss conversion detected`);
            }

            if (urlObj.pathname.endsWith('.html')) {
                const rssPath = urlObj.pathname.replace('.html', '.rss');
                candidates.push(`${urlObj.origin}${rssPath}`);
                logWithTimestamp(`🔄 Smart pattern: .html to .rss conversion detected`);
            }

            // Pattern 4: International sites - /category → /category/feed
            if (pathSegments.length >= 1) {
                // Try category-specific RSS first
                candidates.push(`${urlObj.origin}/rss/${pathSegments[0]}/index.xml`);
                candidates.push(`${urlObj.origin}/rss/${pathSegments[0]}.xml`);
                candidates.push(`${urlObj.origin}/feed/${pathSegments[0]}`);
                
                // Then try appending to current path (but avoid if URL ends with .htm/.html)
                if (!urlObj.pathname.match(/\.(htm|html)$/)) {
                    candidates.push(`${url}/feed`);
                    candidates.push(`${url}/rss`);
                    candidates.push(`${url}/index.xml`);
                }
            }

            // Pattern 4: Root domain patterns
            if (pathSegments.length === 0) {
                candidates.push(`${urlObj.origin}/rss.xml`);
                candidates.push(`${urlObj.origin}/feed.xml`);
                candidates.push(`${urlObj.origin}/atom.xml`);
            }

            // Test candidates
            for (const candidate of candidates) {
                if (await this.validateRSSUrl(candidate)) {
                    this.stats.smartPatternDetection++;
                    logWithTimestamp(`🧠 Smart pattern success: ${candidate}`);
                    return candidate;
                }
                await this.rateLimit();
            }

            return null;
        } catch (error) {
            logWithTimestamp(`Smart pattern detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🔧 Strategy 4: URL Pattern Detection (FIXED - was missing)
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

            // Pattern 2: Root domain → /rss/trang-chu.rss (Vietnamese default)
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
     * 🆕 Enhanced Common Paths - Nhiều pattern hơn, ưu tiên theo region
     */
    async detectFromEnhancedCommonPaths(url) {
        try {
            const urlObj = new URL(url);
            const domain = extractDomain(url);

            let commonPaths = [];

            // Vietnamese sites - ưu tiên patterns phổ biến ở VN
            if (this.isVietnameseNewsSite(domain)) {
                commonPaths = [
                    '/rss',
                    '/rss.rss',
                    '/rss/home.rss',
                    '/rss/trang-chu.rss',
                    '/rss/tin-moi-nhat.rss',
                    '/feed',
                    '/feed.xml'
                ];
            } else {
                // International sites
                commonPaths = [
                    '/feed',
                    '/rss',
                    '/rss.xml',
                    '/feed.xml',
                    '/atom.xml',
                    '/index.xml',
                    '/feeds/all.atom.xml',
                    '/blog/feed'
                ];
            }

            logWithTimestamp(`📁 Testing ${commonPaths.length} enhanced common paths for ${domain}`);

            for (const path of commonPaths) {
                const candidate = `${urlObj.origin}${path}`;
                if (await this.validateRSSUrl(candidate)) {
                    this.stats.commonPathDetection++;
                    logWithTimestamp(`📁 Enhanced common path success: ${candidate}`);
                    return candidate;
                }
                await this.rateLimit();
            }

            return null;
        } catch (error) {
            logWithTimestamp(`Enhanced common path detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🆕 Improved Domain Rules với đầy đủ báo Việt Nam
     */
    loadVietnameseMediaRules() {
        return {
            // Báo Lao Động
            'laodong.vn': {
                patterns: [
                    { type: 'path_to_rss', template: '/rss/{path}.rss' },
                    { type: 'fixed', url: '/rss/home.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // VnExpress
            'vnexpress.net': {
                patterns: [
                    { type: 'path_to_rss', template: '/rss/{path}.rss' },
                    { type: 'fixed', url: '/rss/trang-chu.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Thanh Niên
            'thanhnien.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss/home.rss' },
                    { type: 'path_to_rss', template: '/rss/{path}.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Tuổi Trẻ
            'tuoitre.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss/tin-moi-nhat.rss' },
                    { type: 'path_to_rss', template: '/rss/{path}.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Dân Trí
            'dantri.com.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss.htm' },
                    { type: 'path_to_rss', template: '/rss/{path}.htm' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Nhân Dân
            'nhandan.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss/chinhtri.rss' },
                    { type: 'fixed', url: '/rss/home.rss' },
                    { type: 'path_to_rss', template: '/rss/{path}.rss' }
                ]
            },

            // Công An Nhân Dân
            'cand.com.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss.htm' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Vietnamnet
            'vietnamnet.vn': {
                patterns: [
                    { type: 'fixed', url: '/vn/rss/' },
                    { type: 'path_to_rss', template: '/vn/rss/{path}' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Zing News
            'zingnews.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss' },
                    { type: 'path_to_rss', template: '/rss/{path}' }
                ]
            },

            // Tiền Phong
            'tienphong.vn': {
                patterns: [
                    { type: 'fixed', url: '/rss/home.rss' },
                    { type: 'path_to_rss', template: '/rss/{path}.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // Kênh 14
            'kenh14.vn': {
                patterns: [
                    { type: 'fixed', url: '/home.rss' },
                    { type: 'fixed', url: '/rss' }
                ]
            },

            // VnEconomy - Special handling for .htm to .rss
            'vneconomy.vn': {
                patterns: [
                    { type: 'htm_to_rss', template: '' },
                    { type: 'fixed', url: '/rss/home.rss' }
                ]
            },

            // Café F - Similar pattern
            'cafef.vn': {
                patterns: [
                    { type: 'htm_to_rss', template: '' },
                    { type: 'fixed', url: '/rss/home.rss' }
                ]
            },

            // Soha - Similar pattern
            'soha.vn': {
                patterns: [
                    { type: 'htm_to_rss', template: '' },
                    { type: 'fixed', url: '/rss.xml' }
                ]
            },

            // International patterns
            'techcrunch.com': {
                patterns: [
                    { type: 'fixed', url: '/feed/' },
                    { type: 'path_to_feed', template: '/{path}/feed/' }
                ]
            },

            'wordpress.com': {
                patterns: [
                    { type: 'fixed', url: '/feed/' },
                    { type: 'path_to_feed', template: '/{path}/feed/' }
                ]
            },

            // The Verge - Special handling for their RSS structure
            'theverge.com': {
                patterns: [
                    { type: 'verge_style', template: '/rss/{section}/index.xml' },
                    { type: 'fixed', url: '/rss/index.xml' }
                ]
            },
            'www.theverge.com': {
                patterns: [
                    { type: 'verge_style', template: '/rss/{section}/index.xml' },
                    { type: 'fixed', url: '/rss/index.xml' }
                ]
            },

            // Polygon - Similar structure to The Verge
            'polygon.com': {
                patterns: [
                    { type: 'verge_style', template: '/rss/{section}/index.xml' },
                    { type: 'fixed', url: '/rss/index.xml' }
                ]
            },
            'www.polygon.com': {
                patterns: [
                    { type: 'verge_style', template: '/rss/{section}/index.xml' },
                    { type: 'fixed', url: '/rss/index.xml' }
                ]
            },

            // BBC News
            'bbc.com': {
                patterns: [
                    { type: 'path_to_rss', template: '/news/{path}/rss.xml' },
                    { type: 'fixed', url: '/news/rss.xml' }
                ]
            },
            'www.bbc.com': {
                patterns: [
                    { type: 'path_to_rss', template: '/news/{path}/rss.xml' },
                    { type: 'fixed', url: '/news/rss.xml' }
                ]
            },

            // CNN
            'cnn.com': {
                patterns: [
                    { type: 'path_to_rss', template: '/services/rss/{path}.rss' },
                    { type: 'fixed', url: '/services/rss/' }
                ]
            },

            // Medium publications
            'medium.com': {
                patterns: [
                    { type: 'path_to_feed', template: '/{path}/feed' },
                    { type: 'fixed', url: '/feed' }
                ]
            }
        };
    }

    /**
     * 🆕 Improved Domain Rule Application
     */
    async detectFromDomainRules(url) {
        try {
            const urlObj = new URL(url);
            const domain = extractDomain(url);
            const rules = this.domainRules[domain];
            const pathSegments = urlObj.pathname.split('/').filter(s => s);

            if (!rules) return null;

            logWithTimestamp(`🎯 Applying domain rules for: ${domain}`);

            // If URL has path segments, skip 'fixed' rules that point to root RSS
            const filteredPatterns = pathSegments.length > 0 
                ? rules.patterns.filter(rule => rule.type !== 'fixed' || !rule.url.includes('index.xml'))
                : rules.patterns;

            for (const rule of filteredPatterns) {
                const rssUrl = this.applyDomainRule(url, rule);
                if (rssUrl && await this.validateRSSUrl(rssUrl)) {
                    this.stats.domainRuleDetection++;
                    logWithTimestamp(`🎯 Domain rule success: ${rssUrl}`);
                    return rssUrl;
                }
                await this.rateLimit();
            }

            // If no category-specific RSS found but URL has path, try root RSS as fallback
            if (pathSegments.length > 0 && rules.patterns.some(r => r.type === 'fixed')) {
                for (const rule of rules.patterns.filter(r => r.type === 'fixed')) {
                    const rssUrl = this.applyDomainRule(url, rule);
                    if (rssUrl && await this.validateRSSUrl(rssUrl)) {
                        this.stats.domainRuleDetection++;
                        logWithTimestamp(`🎯 Domain rule fallback to root RSS: ${rssUrl}`);
                        return rssUrl;
                    }
                }
            }

            return null;
        } catch (error) {
            logWithTimestamp(`Domain rule detection failed: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * 🆕 Enhanced Domain Rule Application
     */
    applyDomainRule(url, rule) {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(s => s);

        switch (rule.type) {
            case 'fixed':
                return `${urlObj.origin}${rule.url}`;

            case 'path_to_rss':
                if (pathSegments.length > 0) {
                    const path = pathSegments[0];
                    return `${urlObj.origin}${rule.template.replace('{path}', path)}`;
                } else {
                    // Fallback to default RSS for root
                    return `${urlObj.origin}/rss/trang-chu.rss`;
                }

            case 'path_to_feed':
                if (pathSegments.length > 0) {
                    const path = pathSegments[0];
                    return `${urlObj.origin}${rule.template.replace('{path}', path)}`;
                }
                return `${urlObj.origin}/feed/`;

            case 'verge_style':
                // The Verge style: /rss/{section}/index.xml
                if (pathSegments.length > 0) {
                    const section = pathSegments[0]; // e.g., 'entertainment'
                    const rssUrl = `${urlObj.origin}${rule.template.replace('{section}', section)}`;
                    logWithTimestamp(`🎯 Verge style rule: ${url} → ${rssUrl}`);
                    return rssUrl;
                }
                return null;

            case 'full_path':
                // Use full path after domain
                if (pathSegments.length > 0) {
                    const fullPath = pathSegments.join('/');
                    return `${urlObj.origin}${rule.template.replace('{fullpath}', fullPath)}`;
                }
                return null;

            case 'last_segment':
                // Use only the last path segment
                if (pathSegments.length > 0) {
                    const lastSegment = pathSegments[pathSegments.length - 1];
                    return `${urlObj.origin}${rule.template.replace('{segment}', lastSegment)}`;
                }
                return null;

            case 'htm_to_rss':
                // Convert .htm URLs to .rss (e.g., vneconomy.vn)
                if (urlObj.pathname.endsWith('.htm')) {
                    const rssPath = urlObj.pathname.replace('.htm', '.rss');
                    logWithTimestamp(`🔄 HTM to RSS conversion: ${urlObj.pathname} → ${rssPath}`);
                    return `${urlObj.origin}${rssPath}`;
                }
                return null;

            default:
                return null;
        }
    }

    /**
     * 🆕 Kiểm tra xem có phải báo Việt Nam không
     */
    isVietnameseNewsSite(domain) {
        const vietnameseDomains = [
            'vnexpress.net', 'tuoitre.vn', 'thanhnien.vn', 'dantri.com.vn',
            'laodong.vn', 'nhandan.vn', 'tienphong.vn', 'kenh14.vn',
            'zingnews.vn', 'vietnamnet.vn', 'cand.com.vn', 'baomoi.com',
            'soha.vn', 'cafef.vn', 'vietnamplus.vn', 'vov.vn'
        ];
        return vietnameseDomains.includes(domain);
    }

    /**
     * 🆕 Enhanced Failed URL Management
     */
    markAsFailed(url) {
        this.failedUrlCache.add(url);
        this.failTimeMap = this.failTimeMap || new Map();
        this.failTimeMap.set(url, Date.now());

        // Auto-expire after 5 minutes (reduced from 10)
        setTimeout(() => {
            this.failedUrlCache.delete(url);
            this.failTimeMap.delete(url);
        }, 5 * 60 * 1000);
    }

    getFailTime(url) {
        this.failTimeMap = this.failTimeMap || new Map();
        return this.failTimeMap.get(url) || 0;
    }

    removeFromFailedCache(url) {
        this.failedUrlCache.delete(url);
        if (this.failTimeMap) {
            this.failTimeMap.delete(url);
        }
    }

    isRecentlyFailed(url) {
        return this.failedUrlCache.has(url);
    }

    /**
     * 🆕 FIXED: Enhanced RSS validation with better error handling and logging
     */
    async validateRSSUrl(rssUrl) {
        try {
            if (this.isRecentlyFailed(rssUrl)) {
                logWithTimestamp(`⏭️ Skipping recently failed RSS URL: ${rssUrl}`);
                return false;
            }

            logWithTimestamp(`🔍 Validating RSS URL: ${rssUrl}`);
            const response = await this.safeFetchHtml(rssUrl);

            if (!response || response.length < 50) {
                logWithTimestamp(`❌ RSS validation failed - empty or too short response: ${rssUrl}`, 'warn');
                this.markAsFailed(rssUrl);
                return false;
            }

            // Log first 200 characters for debugging
            logWithTimestamp(`📄 RSS content preview (${response.length} chars): ${response.substring(0, 200).replace(/\n/g, ' ')}`);

            const content = response.toLowerCase();

            // Enhanced RSS detection patterns
            const rssPatterns = [
                '<rss',                    // RSS 2.0
                '<feed',                   // Atom
                '<channel>',               // RSS channel
                'xmlns="http://www.w3.org/2005/atom"',  // Atom namespace
                'xmlns:atom=',             // Atom namespace prefix
                'application/rss+xml',     // RSS MIME type
                'application/atom+xml',    // Atom MIME type
                '<item>',                  // RSS items
                '<entry>',                 // Atom entries
                'rss version=',            // RSS version declaration
                'http://purl.org/rss',     // RSS namespace
                '<?xml version='           // XML declaration (basic check)
            ];

            let foundPatterns = [];
            let isValidRSS = false;

            for (const pattern of rssPatterns) {
                if (content.includes(pattern)) {
                    foundPatterns.push(pattern);
                    isValidRSS = true;
                }
            }

            // Enhanced validation - check for actual content structure
            if (isValidRSS) {
                // Additional validation: ensure it has actual RSS structure
                const hasItems = content.includes('<item>') || content.includes('<entry>');
                const hasTitle = content.includes('<title>');
                const hasDescription = content.includes('<description>') || content.includes('<summary>');

                if (!hasItems && !hasTitle) {
                    logWithTimestamp(`⚠️ RSS structure incomplete for ${rssUrl} - missing items or title`, 'warn');
                    // Don't mark as failed immediately, might be valid but empty feed
                }

                logWithTimestamp(`✅ RSS validation SUCCESS for ${rssUrl} - patterns found: [${foundPatterns.join(', ')}]`);
                return true;
            }

            // Check if it's an HTML error page
            if (content.includes('<html') || content.includes('<!doctype html')) {
                logWithTimestamp(`❌ RSS validation failed - received HTML page instead of RSS: ${rssUrl}`, 'warn');
            } else {
                logWithTimestamp(`❌ RSS validation failed - no RSS patterns found: ${rssUrl}`, 'warn');
            }

            this.markAsFailed(rssUrl);
            return false;

        } catch (error) {
            logWithTimestamp(`💥 RSS validation error for ${rssUrl}: ${error.message}`, 'error');
            this.markAsFailed(rssUrl);
            return false;
        }
    }

    /**
     * Safe HTML fetching với enhanced error handling
     */
    async safeFetchHtml(url) {
        try {
            await this.rateLimit();

            const response = await httpService.fetchHtml(url, {
                timeout: 8000, // Tăng timeout lên 8s
                maxRedirects: 3,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache'
                }
            });

            return response;
        } catch (error) {
            if (error.message.includes('406') || error.message.includes('403')) {
                logWithTimestamp(`⚠️ Access denied for ${url} - site may block automated requests`, 'warn');
            }
            return null;
        }
    }

    /**
     * Improved HTML Head Detection
     */
    async detectFromHTMLHead(url) {
        try {
            const html = await this.safeFetchHtml(url);
            if (!html) return null;

            const cheerio = require('cheerio');
            const $ = cheerio.load(html);

            // Enhanced RSS selectors
            const rssSelectors = [
                'link[type="application/rss+xml"]',
                'link[type="application/atom+xml"]',
                'link[rel="alternate"][type="application/rss+xml"]',
                'link[rel="alternate"][type="application/atom+xml"]',
                'link[rel="feed"]',
                'link[rel="alternate"][href*="rss"]',
                'link[rel="alternate"][href*="feed"]',
                'link[rel="alternate"][href*="atom"]'
            ];

            for (const selector of rssSelectors) {
                const $links = $(selector);
                for (let i = 0; i < $links.length; i++) {
                    const href = $($links[i]).attr('href');
                    if (href) {
                        const rssUrl = makeAbsoluteUrl(href, url);
                        if (await this.validateRSSUrl(rssUrl)) {
                            this.stats.htmlHeadDetection++;
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

    // Utility methods remain the same...
    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '') || urlObj.origin;
        } catch (error) {
            return url;
        }
    }

    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minDelay) {
            const delay = this.minDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
    }

    getCachedRSS(url) {
        const cached = this.rssCache.get(url);
        if (cached && Date.now() - cached.timestamp < 3600000) {
            return cached.rssUrl;
        } else if (cached) {
            this.rssCache.delete(url);
        }
        return null;
    }

    cacheRSSUrl(url, rssUrl) {
        this.rssCache.set(url, {
            rssUrl: rssUrl,
            timestamp: Date.now()
        });
    }

    /**
     * 🆕 Enhanced Statistics
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalAttempts > 0 ?
                Math.round((this.stats.totalSuccess / this.stats.totalAttempts) * 100) + '%' : '0%',
            cacheSize: this.rssCache.size,
            failedUrlCacheSize: this.failedUrlCache.size,
            supportedDomains: Object.keys(this.domainRules).length,
            vietnameseSitesSupported: Object.keys(this.domainRules).filter(d =>
                this.isVietnameseNewsSite(d)).length,
            earlyExitRate: this.stats.totalAttempts > 0 ?
                Math.round((this.stats.earlyExits / this.stats.totalAttempts) * 100) + '%' : '0%'
        };
    }

    /**
     * 🆕 Add domain rule dynamically
     */
    addDomainRule(domain, patterns) {
        this.domainRules[domain] = { patterns };
        logWithTimestamp(`Added domain rule for: ${domain}`);
    }

    /**
     * 🆕 Clear failed cache for specific URL or all
     */
    clearFailedCache(url = null) {
        if (url) {
            this.failedUrlCache.delete(url);
            if (this.failTimeMap) {
                this.failTimeMap.delete(url);
            }
            logWithTimestamp(`🧹 Cleared failed cache for: ${url}`);
        } else {
            this.failedUrlCache.clear();
            this.failTimeMap = new Map();
            logWithTimestamp(`🧹 Cleared all failed cache`);
        }
    }

    /**
     * 🆕 Debug method: Test specific RSS URL validation
     */
    async debugRSSUrl(rssUrl) {
        try {
            logWithTimestamp(`🔧 DEBUG: Testing RSS URL: ${rssUrl}`);

            // Clear from failed cache if exists
            this.removeFromFailedCache(rssUrl);

            const startTime = Date.now();
            const isValid = await this.validateRSSUrl(rssUrl);
            const duration = Date.now() - startTime;

            const result = {
                url: rssUrl,
                isValid: isValid,
                duration: duration,
                timestamp: new Date().toISOString()
            };

            if (isValid) {
                logWithTimestamp(`✅ DEBUG SUCCESS: ${rssUrl} is valid RSS (${duration}ms)`);
            } else {
                logWithTimestamp(`❌ DEBUG FAILED: ${rssUrl} is not valid RSS (${duration}ms)`);
            }

            return result;

        } catch (error) {
            logWithTimestamp(`💥 DEBUG ERROR for ${rssUrl}: ${error.message}`, 'error');
            return {
                url: rssUrl,
                isValid: false,
                error: error.message,
                duration: 0
            };
        }
    }

    /**
     * 🆕 Debug method: Test all domain rule patterns for a URL
     */
    async debugDomainRules(url) {
        try {
            const urlObj = new URL(url);
            const domain = extractDomain(url);
            const rules = this.domainRules[domain];

            if (!rules) {
                logWithTimestamp(`❌ No domain rules found for: ${domain}`);
                return { domain, hasRules: false };
            }

            logWithTimestamp(`🔧 DEBUG: Testing all domain rules for ${domain}`);

            const results = [];

            for (let i = 0; i < rules.patterns.length; i++) {
                const rule = rules.patterns[i];
                const rssUrl = this.applyDomainRule(url, rule);

                if (rssUrl) {
                    logWithTimestamp(`🔍 Testing rule ${i + 1}: ${JSON.stringify(rule)} → ${rssUrl}`);
                    const testResult = await this.debugRSSUrl(rssUrl);
                    results.push({
                        ruleIndex: i + 1,
                        rule: rule,
                        generatedUrl: rssUrl,
                        ...testResult
                    });

                    // Small delay between tests
                    await this.rateLimit();
                }
            }

            return {
                domain,
                hasRules: true,
                totalRules: rules.patterns.length,
                results: results,
                validUrls: results.filter(r => r.isValid)
            };

        } catch (error) {
            logWithTimestamp(`💥 DEBUG ERROR for domain rules: ${error.message}`, 'error');
            return { domain: extractDomain(url), hasRules: false, error: error.message };
        }
    }
}

module.exports = new EnhancedRSSDetector();