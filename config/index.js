// config/index.js
require('dotenv').config();

/**
 * Cấu hình chính của ứng dụng
 * Tập trung tất cả environment variables và settings tại đây
 */
const config = {
    // Server settings
    server: {
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development',
        baseUrl: process.env.BASE_URL || 'http://localhost:3000'
    },

    // Application settings
    app: {
        cacheDuration: parseInt(process.env.CACHE_DURATION) || 3600, // 1 hour in seconds
        maxArticlesPerFeed: parseInt(process.env.MAX_ARTICLES_PER_FEED) || 20,
        requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 10000 // 10 seconds
    },

    // Security settings
    security: {
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000, // 15 minutes
        rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100
    },

    // Web scraping settings
    scraping: {
        userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timeout: parseInt(process.env.REQUEST_TIMEOUT) || 10000,

        // Các selector phổ biến để tìm nội dung chính
        contentSelectors: [
            'article',
            '[role="main"]',
            '.post',
            '.entry',
            '.content',
            '#content',
            '.main-content',
            '.post-content'
        ],

        // Các selector để tìm danh sách bài viết
        articleListSelectors: [
            'article',
            '.post',
            '.entry',
            '.news-item',
            '.article-item',
            '[class*="post"]',
            '[class*="article"]'
        ]
    }
};

/**
 * Validation function để kiểm tra config
 */
config.validate = function() {
    const required = ['server.port', 'server.baseUrl'];

    for (const key of required) {
        const value = key.split('.').reduce((obj, prop) => obj[prop], this);
        if (!value) {
            throw new Error(`Missing required configuration: ${key}`);
        }
    }

    console.log('✅ Configuration validated successfully');
    return true;
};

module.exports = config;