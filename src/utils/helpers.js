// src/utils/helpers.js

/**
 * Collection of utility functions for the RSS Feed Generator
 */

/**
 * Sanitize and clean text content
 * @param {string} text - Raw text to clean
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
    if (!text || typeof text !== 'string') return '';

    return text
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n+/g, ' ') // Replace newlines with space
        .replace(/\t+/g, ' ') // Replace tabs with space
        .trim(); // Remove leading/trailing whitespace
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string} - Domain name
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch (error) {
        console.error('Invalid URL:', url);
        return null;
    }
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Convert relative URL to absolute URL
 * @param {string} relativeUrl - Relative URL
 * @param {string} baseUrl - Base URL
 * @returns {string} - Absolute URL
 */
function makeAbsoluteUrl(relativeUrl, baseUrl) {
    if (!relativeUrl) return '';

    // If already absolute URL, return as is
    if (isValidUrl(relativeUrl)) {
        return relativeUrl;
    }

    try {
        return new URL(relativeUrl, baseUrl).href;
    } catch (error) {
        console.error('Error creating absolute URL:', error);
        return relativeUrl;
    }
}

/**
 * Extract text content from HTML, removing tags
 * @param {string} html - HTML content
 * @returns {string} - Plain text
 */
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Generate a simple hash for caching purposes
 * @param {string} str - String to hash
 * @returns {string} - Simple hash
 */
function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString();

    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString();
}

/**
 * Sleep function for adding delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength = 200) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Check if a string contains Vietnamese characters
 * @param {string} text - Text to check
 * @returns {boolean} - True if contains Vietnamese
 */
function containsVietnamese(text) {
    const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    return vietnameseRegex.test(text);
}

/**
 * Log with timestamp
 * @param {string} message - Message to log
 * @param {string} level - Log level (info, error, warn)
 */
function logWithTimestamp(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    switch (level) {
        case 'error':
            console.error(logMessage);
            break;
        case 'warn':
            console.warn(logMessage);
            break;
        default:
            console.log(logMessage);
    }
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Initial delay in ms
 * @returns {Promise} - Promise that resolves with function result
 */
async function retryWithBackoff(fn, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;

            const waitTime = delay * Math.pow(2, i);
            logWithTimestamp(`Retry ${i + 1}/${maxRetries} failed, waiting ${waitTime}ms...`, 'warn');
            await sleep(waitTime);
        }
    }
}

/**
 * Safely set response header (checks if headers already sent)
 * @param {object} res - Express response object
 * @param {string} name - Header name
 * @param {string} value - Header value
 */
function safeSetHeader(res, name, value) {
    if (!res || !res.set) {
        logWithTimestamp(`Invalid response object for header: ${name}`, 'warn');
        return;
    }

    if (!res.headersSent) {
        try {
            res.set(name, value);
        } catch (error) {
            logWithTimestamp(`Failed to set header ${name}: ${error.message}`, 'warn');
        }
    } else {
        logWithTimestamp(`Headers already sent, cannot set header: ${name}`, 'warn');
    }
}

/**
 * Create a safe response wrapper to prevent header setting errors
 * @param {object} res - Express response object
 * @returns {object} - Wrapped response object
 */
function createSafeResponseWrapper(res) {
    const originalEnd = res.end;
    const originalSend = res.send;
    const originalJson = res.json;

    // Track if response has been sent
    let responseSent = false;

    res.end = function(...args) {
        responseSent = true;
        return originalEnd.apply(this, args);
    };

    res.send = function(...args) {
        responseSent = true;
        return originalSend.apply(this, args);
    };

    res.json = function(...args) {
        responseSent = true;
        return originalJson.apply(this, args);
    };

    // Override set method to be safe
    const originalSet = res.set;
    res.set = function(name, value) {
        if (!responseSent && !this.headersSent) {
            return originalSet.call(this, name, value);
        } else {
            logWithTimestamp(`Attempted to set header after response sent: ${name}`, 'warn');
        }
    };

    return res;
}

module.exports = {
    cleanText,
    extractDomain,
    isValidUrl,
    makeAbsoluteUrl,
    stripHtml,
    simpleHash,
    sleep,
    truncateText,
    containsVietnamese,
    logWithTimestamp,
    retryWithBackoff,
    safeSetHeader,
    createSafeResponseWrapper
};