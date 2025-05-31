// src/services/contentParserService.js
const cheerio = require('cheerio');
const config = require('../../config');
const { cleanText, makeAbsoluteUrl, stripHtml, truncateText, extractDomain } = require('../utils/helpers');
const { ParsingError, NoArticlesError } = require('../errors');

/**
 * Content Parser Service
 * Handles HTML parsing and content extraction with site-specific rules
 */
class ContentParserService {
    constructor() {
        // Site-specific parsing rules
        this.siteRules = this.loadSiteRules();
    }

    /**
     * Load site-specific parsing rules
     */
    loadSiteRules() {
        return {
            'vnexpress.net': {
                articleSelector: '.item-news, .item-news-common',
                titleSelector: '.title-news a, h3.title-news',
                linkSelector: '.title-news a',
                descriptionSelector: '.description',
                imageSelector: '.thumb-art img',
                dateSelector: '.time',
                removeSelectors: ['.ic', '.count_cmt']
            },
            'dantri.com.vn': {
                articleSelector: '.news-item, .dt-list-item',
                titleSelector: '.news-item__title a, .dt-list-title a',
                linkSelector: '.news-item__title a, .dt-list-title a',
                descriptionSelector: '.news-item__sapo, .dt-list-sapo',
                imageSelector: '.news-item__avatar img, .dt-list-avatar img',
                dateSelector: '.news-item__time, .dt-list-time'
            },
            'techcrunch.com': {
                articleSelector: '.post-block, article',
                titleSelector: '.post-block__title__link, .entry-title a',
                linkSelector: '.post-block__title__link, .entry-title a',
                descriptionSelector: '.post-block__content, .entry-summary',
                imageSelector: '.post-block__media img, .featured-image img',
                dateSelector: '.post-block__time, .entry-date'
            },
            // Default rules for unknown sites
            default: {
                articleSelector: config.scraping.articleListSelectors,
                titleSelector: ['h1', 'h2', 'h3', '.title', '.headline', '[class*="title"]'],
                linkSelector: 'a[href]',
                descriptionSelector: ['.excerpt', '.summary', '.description', 'p'],
                imageSelector: 'img[src]',
                dateSelector: ['time[datetime]', '.date', '.published', '[class*="date"]'],
                removeSelectors: ['script', 'style', 'nav', 'footer', 'aside', '.ad', '.advertisement']
            }
        };
    }

    /**
     * Parse HTML and extract articles
     * @param {string} html - Raw HTML content
     * @param {string} baseUrl - Base URL for making absolute URLs
     * @returns {Array} - Array of article objects
     */
    parseArticles(html, baseUrl) {
        try {
            const $ = cheerio.load(html);
            const domain = extractDomain(baseUrl);
            const rules = this.getSiteRules(domain);

            // Clean up HTML first
            this.cleanHtml($, rules);

            // Find article elements
            const articleElements = this.findArticleElements($, rules);

            if (articleElements.length === 0) {
                throw new NoArticlesError(baseUrl, 'No article elements found using any selector');
            }

            // Extract data from each article
            const articles = [];
            const seenUrls = new Set(); // Prevent duplicates

            for (const element of articleElements) {
                try {
                    const article = this.extractArticleData($, element, baseUrl, rules);

                    if (article && this.validateArticle(article) && !seenUrls.has(article.url)) {
                        articles.push(article);
                        seenUrls.add(article.url);
                    }
                } catch (error) {
                    // Log but continue with other articles
                    console.warn(`Failed to extract article: ${error.message}`);
                }
            }

            if (articles.length === 0) {
                throw new NoArticlesError(baseUrl, 'No valid articles could be extracted');
            }

            // Sort by date (newest first) and limit
            return this.sortAndLimitArticles(articles);

        } catch (error) {
            if (error instanceof NoArticlesError) {
                throw error;
            }
            throw new ParsingError(`Failed to parse articles: ${error.message}`, baseUrl);
        }
    }

    /**
     * Get parsing rules for specific domain
     */
    getSiteRules(domain) {
        return this.siteRules[domain] || this.siteRules.default;
    }

    /**
     * Clean HTML by removing unwanted elements
     */
    cleanHtml($, rules) {
        const removeSelectors = rules.removeSelectors || this.siteRules.default.removeSelectors;

        removeSelectors.forEach(selector => {
            $(selector).remove();
        });

        // Remove empty elements
        $('*').each(function() {
            const $el = $(this);
            if ($el.text().trim() === '' && $el.children().length === 0) {
                $el.remove();
            }
        });
    }

    /**
     * Find article elements using site-specific or default selectors
     */
    findArticleElements($, rules) {
        const selectors = Array.isArray(rules.articleSelector) ?
            rules.articleSelector : [rules.articleSelector];

        const articleElements = [];
        const seenTexts = new Set();

        for (const selector of selectors) {
            $(selector).each((index, element) => {
                const $element = $(element);
                const text = cleanText($element.text());

                // Skip if too short or already seen
                if (text.length < 50 || seenTexts.has(text)) {
                    return;
                }

                seenTexts.add(text);
                articleElements.push(element);
            });

            // Stop if we have enough articles
            if (articleElements.length >= config.app.maxArticlesPerFeed * 2) {
                break;
            }
        }

        return articleElements;
    }

    /**
     * Extract data from a single article element
     */
    extractArticleData($, element, baseUrl, rules) {
        const $element = $(element);

        const article = {
            title: this.extractTitle($, $element, rules),
            url: this.extractUrl($, $element, baseUrl, rules),
            description: this.extractDescription($, $element, rules),
            publishedDate: this.extractDate($, $element, rules),
            image: this.extractImage($, $element, baseUrl, rules),
            author: this.extractAuthor($, $element, rules),
            category: this.extractCategory($, $element, rules)
        };

        // Generate GUID
        article.guid = article.url;

        // Clean and truncate content
        article.title = cleanText(article.title);
        article.description = truncateText(cleanText(article.description), 300);

        return article;
    }

    /**
     * Extract title using site-specific selectors
     */
    extractTitle($, $element, rules) {
        const selectors = Array.isArray(rules.titleSelector) ?
            rules.titleSelector : [rules.titleSelector];

        for (const selector of selectors) {
            const titleElement = $element.find(selector).first();
            if (titleElement.length > 0) {
                let title = cleanText(titleElement.text());

                // Try title attribute if text is empty
                if (!title && titleElement.attr('title')) {
                    title = cleanText(titleElement.attr('title'));
                }

                if (title && title.length > 10) {
                    return title;
                }
            }
        }

        // Fallback: find any link with meaningful text
        const fallbackTitle = $element.find('a').first().text().trim();
        return fallbackTitle.length > 10 ? fallbackTitle : 'Untitled Article';
    }

    /**
     * Extract URL using site-specific selectors
     */
    extractUrl($, $element, baseUrl, rules) {
        const linkSelectors = Array.isArray(rules.linkSelector) ?
            rules.linkSelector : [rules.linkSelector];

        for (const selector of linkSelectors) {
            const linkElement = $element.find(selector).first();
            if (linkElement.length > 0 && linkElement.attr('href')) {
                return makeAbsoluteUrl(linkElement.attr('href'), baseUrl);
            }
        }

        // Fallback: check if element itself has href
        if ($element.attr('href')) {
            return makeAbsoluteUrl($element.attr('href'), baseUrl);
        }

        return baseUrl; // Ultimate fallback
    }

    /**
     * Extract description using site-specific selectors
     */
    extractDescription($, $element, rules) {
        const selectors = Array.isArray(rules.descriptionSelector) ?
            rules.descriptionSelector : [rules.descriptionSelector];

        for (const selector of selectors) {
            const descElement = $element.find(selector).first();
            if (descElement.length > 0) {
                const desc = cleanText(stripHtml(descElement.html()));
                if (desc && desc.length > 30) {
                    return desc;
                }
            }
        }

        // Fallback: use element's own text content
        const fullText = cleanText($element.text());
        return fullText.length > 100 ?
            fullText.substring(0, 200) + '...' :
            fullText;
    }

    /**
     * Extract image using site-specific selectors
     */
    extractImage($, $element, baseUrl, rules) {
        const imgSelectors = Array.isArray(rules.imageSelector) ?
            rules.imageSelector : [rules.imageSelector];

        for (const selector of imgSelectors) {
            const imgElement = $element.find(selector).first();
            if (imgElement.length > 0) {
                const src = imgElement.attr('src') ||
                    imgElement.attr('data-src') ||
                    imgElement.attr('data-lazy-src');

                if (src) {
                    return makeAbsoluteUrl(src, baseUrl);
                }
            }
        }

        return null;
    }

    /**
     * Extract published date
     */
    extractDate($, $element, rules) {
        const selectors = Array.isArray(rules.dateSelector) ?
            rules.dateSelector : [rules.dateSelector];

        for (const selector of selectors) {
            const dateElement = $element.find(selector).first();
            if (dateElement.length > 0) {
                let dateStr = dateElement.attr('datetime') ||
                    dateElement.attr('data-time') ||
                    dateElement.text();

                if (dateStr) {
                    const date = new Date(dateStr);
                    if (!isNaN(date.getTime())) {
                        return date;
                    }
                }
            }
        }

        // Fallback to current date
        return new Date();
    }

    /**
     * Extract author information
     */
    extractAuthor($, $element, rules) {
        const authorSelectors = [
            '.author',
            '.byline',
            '.writer',
            '[rel="author"]',
            '[class*="author"]'
        ];

        for (const selector of authorSelectors) {
            const authorElement = $element.find(selector).first();
            if (authorElement.length > 0) {
                const author = cleanText(authorElement.text());
                if (author && author.length > 0) {
                    return author;
                }
            }
        }

        return null;
    }

    /**
     * Extract category information
     */
    extractCategory($, $element, rules) {
        const categorySelectors = [
            '.category',
            '.tag',
            '.section',
            '[class*="category"]',
            '[class*="tag"]'
        ];

        for (const selector of categorySelectors) {
            const categoryElement = $element.find(selector).first();
            if (categoryElement.length > 0) {
                const category = cleanText(categoryElement.text());
                if (category && category.length > 0) {
                    return category;
                }
            }
        }

        return null;
    }

    /**
     * Validate article has minimum required data
     */
    validateArticle(article) {
        return (
            article &&
            article.title &&
            article.title.length > 10 &&
            article.url &&
            article.description &&
            article.description.length > 20
        );
    }

    /**
     * Sort articles by date and limit to max count
     */
    sortAndLimitArticles(articles) {
        return articles
            .sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate))
            .slice(0, config.app.maxArticlesPerFeed);
    }

    /**
     * Add custom parsing rules for a new site
     */
    addSiteRules(domain, rules) {
        this.siteRules[domain] = {
            ...this.siteRules.default,
            ...rules
        };
    }

    /**
     * Get site metadata from HTML
     */
    extractSiteMetadata(html, baseUrl) {
        try {
            const $ = cheerio.load(html);

            return {
                title: this.getSiteTitle($),
                description: this.getSiteDescription($),
                language: this.getLanguage($),
                favicon: this.getFavicon($, baseUrl),
                generator: $('meta[name="generator"]').attr('content'),
                charset: this.getCharset($)
            };
        } catch (error) {
            throw new ParsingError(`Failed to extract site metadata: ${error.message}`, baseUrl);
        }
    }

    /**
     * Extract site title from various sources
     */
    getSiteTitle($) {
        const titleSources = [
            () => $('meta[property="og:title"]').attr('content'),
            () => $('meta[name="twitter:title"]').attr('content'),
            () => $('title').text(),
            () => $('h1').first().text(),
            () => $('.site-title, .logo').first().text()
        ];

        for (const source of titleSources) {
            const title = source();
            if (title && title.trim().length > 0) {
                return cleanText(title);
            }
        }

        return 'Unknown Site';
    }

    /**
     * Extract site description
     */
    getSiteDescription($) {
        const descSources = [
            () => $('meta[name="description"]').attr('content'),
            () => $('meta[property="og:description"]').attr('content'),
            () => $('meta[name="twitter:description"]').attr('content')
        ];

        for (const source of descSources) {
            const desc = source();
            if (desc && desc.trim().length > 0) {
                return cleanText(desc);
            }
        }

        return 'Auto-generated RSS feed';
    }

    /**
     * Get page language
     */
    getLanguage($) {
        return $('html').attr('lang') ||
            $('meta[http-equiv="content-language"]').attr('content') ||
            'en';
    }

    /**
     * Get favicon URL
     */
    getFavicon($, baseUrl) {
        const favicon = $('link[rel="icon"], link[rel="shortcut icon"]').attr('href') ||
            $('link[rel="apple-touch-icon"]').attr('href');

        return favicon ? makeAbsoluteUrl(favicon, baseUrl) : null;
    }

    /**
     * Get page charset
     */
    getCharset($) {
        return $('meta[charset]').attr('charset') ||
            $('meta[http-equiv="content-type"]').attr('content')?.match(/charset=([^;]+)/)?.[1] ||
            'utf-8';
    }
}

module.exports = new ContentParserService();