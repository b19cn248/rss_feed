// src/services/scraperService.js
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config');
const {
    cleanText,
    makeAbsoluteUrl,
    stripHtml,
    truncateText,
    logWithTimestamp,
    retryWithBackoff
} = require('../utils/helpers');

/**
 * Web Scraper Service
 * Handles all web scraping operations
 */
class ScraperService {
    constructor() {
        // Axios instance với default config
        this.httpClient = axios.create({
            timeout: config.scraping.timeout,
            headers: {
                'User-Agent': config.scraping.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'DNT': '1',
                'Connection': 'keep-alive'
            }
        });
    }

    /**
     * Fetch HTML content from URL
     * @param {string} url - URL to fetch
     * @returns {Promise<string>} - HTML content
     */
    async fetchHtml(url) {
        try {
            logWithTimestamp(`Fetching: ${url}`);

            const response = await retryWithBackoff(async () => {
                return await this.httpClient.get(url);
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response.data;
        } catch (error) {
            logWithTimestamp(`Error fetching ${url}: ${error.message}`, 'error');
            throw new Error(`Failed to fetch ${url}: ${error.message}`);
        }
    }

    /**
     * Extract articles from a website's homepage
     * @param {string} url - Website URL
     * @returns {Promise<Array>} - Array of article objects
     */
    async extractArticles(url) {
        try {
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const articles = [];
            const baseUrl = new URL(url).origin;

            // Loại bỏ các elements không cần thiết
            $('script, style, nav, footer, aside, .ad, .advertisement').remove();

            // Thử các selector khác nhau để tìm articles
            const articleElements = this.findArticleElements($);

            for (const element of articleElements) {
                const article = this.extractArticleData($, element, baseUrl);
                if (article && this.isValidArticle(article)) {
                    articles.push(article);
                }
            }

            // Giới hạn số lượng articles
            const limitedArticles = articles.slice(0, config.app.maxArticlesPerFeed);

            logWithTimestamp(`Extracted ${limitedArticles.length} articles from ${url}`);
            return limitedArticles;

        } catch (error) {
            logWithTimestamp(`Error extracting articles from ${url}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Find article elements using various selectors
     * @param {object} $ - Cheerio instance
     * @returns {Array} - Array of article elements
     */
    findArticleElements($) {
        const articleElements = [];
        const seenTexts = new Set(); // Để tránh duplicate

        for (const selector of config.scraping.articleListSelectors) {
            $(selector).each((index, element) => {
                const $element = $(element);
                const text = cleanText($element.text());

                // Skip nếu đã thấy content này rồi hoặc quá ngắn
                if (seenTexts.has(text) || text.length < 50) {
                    return;
                }

                seenTexts.add(text);
                articleElements.push(element);
            });

            // Nếu đã tìm được đủ articles thì dừng
            if (articleElements.length >= config.app.maxArticlesPerFeed * 2) {
                break;
            }
        }

        return articleElements;
    }

    /**
     * Extract data from a single article element
     * @param {object} $ - Cheerio instance
     * @param {object} element - Article element
     * @param {string} baseUrl - Base URL for making absolute URLs
     * @returns {object} - Article data object
     */
    extractArticleData($, element, baseUrl) {
        const $element = $(element);

        try {
            // Extract title
            const title = this.extractTitle($, $element);

            // Extract URL
            const url = this.extractUrl($, $element, baseUrl);

            // Extract description/excerpt
            const description = this.extractDescription($, $element);

            // Extract date (optional)
            const publishedDate = this.extractDate($, $element);

            // Extract image (optional)
            const image = this.extractImage($, $element, baseUrl);

            return {
                title: cleanText(title),
                url,
                description: truncateText(cleanText(description), 300),
                publishedDate,
                image,
                guid: url // RSS guid
            };

        } catch (error) {
            logWithTimestamp(`Error extracting article data: ${error.message}`, 'warn');
            return null;
        }
    }

    /**
     * Extract title from article element
     * @param {object} $ - Cheerio instance
     * @param {object} $element - Article element
     * @returns {string} - Article title
     */
    extractTitle($, $element) {
        const titleSelectors = [
            'h1', 'h2', 'h3',
            '.title', '.headline', '.post-title',
            '[class*="title"]', '[class*="headline"]',
            'a[title]'
        ];

        for (const selector of titleSelectors) {
            const titleElement = $element.find(selector).first();
            if (titleElement.length > 0) {
                let title = cleanText(titleElement.text());

                // Nếu không có text, thử lấy từ title attribute
                if (!title && titleElement.attr('title')) {
                    title = cleanText(titleElement.attr('title'));
                }

                if (title && title.length > 10) {
                    return title;
                }
            }
        }

        // Fallback: lấy text đầu tiên có độ dài phù hợp
        const fallbackTitle = $element.find('a').first().text().trim();
        return fallbackTitle.length > 10 ? fallbackTitle : 'Untitled Article';
    }

    /**
     * Extract URL from article element
     * @param {object} $ - Cheerio instance
     * @param {object} $element - Article element
     * @param {string} baseUrl - Base URL
     * @returns {string} - Article URL
     */
    extractUrl($, $element, baseUrl) {
        // Tìm link đầu tiên trong element
        const linkElement = $element.find('a[href]').first();

        if (linkElement.length > 0) {
            const href = linkElement.attr('href');
            return makeAbsoluteUrl(href, baseUrl);
        }

        // Fallback: kiểm tra chính element có href không
        if ($element.attr('href')) {
            return makeAbsoluteUrl($element.attr('href'), baseUrl);
        }

        return baseUrl; // Fallback to base URL
    }

    /**
     * Extract description from article element
     * @param {object} $ - Cheerio instance
     * @param {object} $element - Article element
     * @returns {string} - Article description
     */
    extractDescription($, $element) {
        const descriptionSelectors = [
            '.excerpt', '.summary', '.description',
            '.post-excerpt', '.entry-summary',
            'p', '.content'
        ];

        for (const selector of descriptionSelectors) {
            const descElement = $element.find(selector).first();
            if (descElement.length > 0) {
                const desc = cleanText(stripHtml(descElement.html()));
                if (desc && desc.length > 30) {
                    return desc;
                }
            }
        }

        // Fallback: lấy text content của toàn bộ element
        const fullText = cleanText($element.text());
        return fullText.length > 100 ? fullText.substring(0, 200) + '...' : fullText;
    }

    /**
     * Extract published date from article element
     * @param {object} $ - Cheerio instance
     * @param {object} $element - Article element
     * @returns {Date|null} - Published date or null
     */
    extractDate($, $element) {
        const dateSelectors = [
            'time[datetime]',
            '.date', '.published', '.post-date',
            '[class*="date"]', '[class*="time"]'
        ];

        for (const selector of dateSelectors) {
            const dateElement = $element.find(selector).first();
            if (dateElement.length > 0) {
                let dateStr = dateElement.attr('datetime') || dateElement.text();
                const date = new Date(dateStr);

                if (!isNaN(date.getTime())) {
                    return date;
                }
            }
        }

        // Fallback: current date
        return new Date();
    }

    /**
     * Extract image from article element
     * @param {object} $ - Cheerio instance
     * @param {object} $element - Article element
     * @param {string} baseUrl - Base URL
     * @returns {string|null} - Image URL or null
     */
    extractImage($, $element, baseUrl) {
        const imgElement = $element.find('img').first();

        if (imgElement.length > 0) {
            const src = imgElement.attr('src') || imgElement.attr('data-src');
            if (src) {
                return makeAbsoluteUrl(src, baseUrl);
            }
        }

        return null;
    }

    /**
     * Validate if article has minimum required data
     * @param {object} article - Article object
     * @returns {boolean} - True if valid
     */
    isValidArticle(article) {
        return (
            article &&
            article.title &&
            article.title.length > 10 &&
            article.url &&
            article.description &&
            article.description.length > 20
        );
    }
}

module.exports = new ScraperService();