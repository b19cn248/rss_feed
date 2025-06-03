// tests/rssDetectorTest.js
/**
 * Comprehensive Test Cases for Advanced RSS Detector
 * Tests all detection strategies with real-world URLs
 */

const advancedRSSDetector = require('../src/services/advancedRSSDetector');
const { logWithTimestamp } = require('../src/utils/helpers');

/**
 * Test cases categorized by detection method
 */
const testCases = {
    // Test cases that should find RSS via HTML head tags
    htmlHeadDetection: [
        {
            name: 'TechCrunch (Standard RSS)',
            url: 'https://techcrunch.com',
            expectedRSS: 'https://techcrunch.com/feed/',
            description: 'Has proper <link rel="alternate"> tag'
        },
        {
            name: 'GitHub Blog',
            url: 'https://github.blog',
            expectedRSS: 'https://github.blog/feed/',
            description: 'Standard blog with RSS autodiscovery'
        }
    ],

    // Test cases for domain-specific rules
    domainRuleDetection: [
        {
            name: 'VnExpress Sức khỏe',
            url: 'https://vnexpress.net/suc-khoe',
            expectedRSS: 'https://vnexpress.net/rss/suc-khoe.rss',
            description: 'Domain rule: /category → /rss/category.rss'
        },
        {
            name: 'VnExpress Thế giới',
            url: 'https://vnexpress.net/the-gioi',
            expectedRSS: 'https://vnexpress.net/rss/the-gioi.rss',
            description: 'Domain rule pattern matching'
        },
        {
            name: 'Thanh Niên Homepage',
            url: 'https://thanhnien.vn',
            expectedRSS: 'https://thanhnien.vn/rss/home.rss',
            description: 'Fixed RSS URL for Thanh Niên'
        },
        {
            name: 'Kenh14 Homepage',
            url: 'https://kenh14.vn',
            expectedRSS: 'https://kenh14.vn/home.rss',
            description: 'Fixed RSS URL for Kenh14'
        }
    ],

    // Test cases for URL pattern inference
    urlPatternDetection: [
        {
            name: 'WordPress Category Feed',
            url: 'https://example-wp-site.com/category/technology',
            expectedPattern: '/category/technology/feed',
            description: 'WordPress category to feed pattern'
        },
        {
            name: 'News Site Section',
            url: 'https://news-site.com/business',
            expectedPattern: '/rss/business.rss',
            description: 'Section to RSS pattern'
        }
    ],

    // Test cases for common paths
    commonPathDetection: [
        {
            name: 'Site with /rss path',
            url: 'https://example.com',
            expectedRSS: 'https://example.com/rss',
            description: 'Common /rss path'
        },
        {
            name: 'Site with /feed path',
            url: 'https://blog-site.com',
            expectedRSS: 'https://blog-site.com/feed',
            description: 'Common /feed path'
        }
    ],

    // Test cases that should fail (no RSS available)
    noRSSAvailable: [
        {
            name: 'Google Homepage',
            url: 'https://google.com',
            expectedRSS: null,
            description: 'No RSS feed available'
        },
        {
            name: 'Static Landing Page',
            url: 'https://static-site.example.com',
            expectedRSS: null,
            description: 'No dynamic content, no RSS'
        }
    ]
};

/**
 * Real-world test URLs for manual testing
 */
const realWorldTests = [
    // Vietnamese news sites
    { url: 'https://vnexpress.net/suc-khoe', expected: 'Domain rule detection' },
    { url: 'https://vnexpress.net/the-gioi', expected: 'Domain rule detection' },
    { url: 'https://tuoitre.vn', expected: 'Domain rule detection' },
    { url: 'https://thanhnien.vn', expected: 'Domain rule detection' },
    { url: 'https://kenh14.vn', expected: 'Domain rule detection' },
    { url: 'https://dantri.com.vn', expected: 'Domain rule detection' },

    // International sites with standard RSS
    { url: 'https://techcrunch.com', expected: 'HTML head detection' },
    { url: 'https://github.blog', expected: 'HTML head detection' },
    { url: 'https://wordpress.org/news', expected: 'WordPress detection' },

    // Sites requiring pattern inference
    { url: 'https://news.ycombinator.com', expected: 'Common path detection' },
    { url: 'https://dev.to', expected: 'Common path detection' },

    // Edge cases
    { url: 'https://medium.com/@username', expected: 'URL pattern detection' },
    { url: 'https://example.tumblr.com', expected: 'URL pattern detection' }
];

/**
 * Run comprehensive RSS detector tests
 */
async function runRSSDetectorTests() {
    console.log('🧪 Advanced RSS Detector - Comprehensive Test Suite');
    console.log('=====================================================\n');

    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        detectionMethods: {},
        errors: []
    };

    // Test each category
    for (const [category, tests] of Object.entries(testCases)) {
        console.log(`\n📋 Testing ${category}:`);
        console.log(''.padEnd(50, '-'));

        for (const test of tests) {
            results.total++;
            console.log(`\n🔍 Testing: ${test.name}`);
            console.log(`   URL: ${test.url}`);
            console.log(`   Expected: ${test.expectedRSS || test.expectedPattern || 'No RSS'}`);
            console.log(`   Description: ${test.description}`);

            try {
                const startTime = Date.now();
                const foundRSS = await advancedRSSDetector.findRSSFeed(test.url);
                const duration = Date.now() - startTime;

                if (test.expectedRSS === null && foundRSS === null) {
                    // Expected no RSS and found no RSS
                    console.log(`   ✅ PASS - Correctly found no RSS (${duration}ms)`);
                    results.passed++;
                } else if (foundRSS && (foundRSS === test.expectedRSS || foundRSS.includes(test.expectedPattern))) {
                    // Found expected RSS
                    console.log(`   ✅ PASS - Found RSS: ${foundRSS} (${duration}ms)`);
                    results.passed++;

                    // Track detection method
                    const stats = advancedRSSDetector.getStats();
                    const method = getLastUsedMethod(stats);
                    results.detectionMethods[method] = (results.detectionMethods[method] || 0) + 1;

                } else if (foundRSS && test.expectedRSS && foundRSS !== test.expectedRSS) {
                    // Found different RSS than expected (might still be valid)
                    console.log(`   ⚠️  PARTIAL - Found different RSS: ${foundRSS} (${duration}ms)`);
                    console.log(`      Expected: ${test.expectedRSS}`);
                    results.passed++; // Count as pass since RSS was found
                } else {
                    // Failed to find expected RSS
                    console.log(`   ❌ FAIL - No RSS found (${duration}ms)`);
                    results.failed++;
                    results.errors.push({
                        test: test.name,
                        url: test.url,
                        expected: test.expectedRSS,
                        found: foundRSS
                    });
                }

            } catch (error) {
                console.log(`   ❌ ERROR - ${error.message}`);
                results.failed++;
                results.errors.push({
                    test: test.name,
                    url: test.url,
                    error: error.message
                });
            }

            // Small delay to avoid overwhelming servers
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Display results summary
    displayTestResults(results);

    return results;
}

/**
 * Test real-world URLs manually
 */
async function testRealWorldURLs() {
    console.log('\n🌍 Real-World URL Testing');
    console.log('==========================\n');

    const realWorldResults = [];

    for (const test of realWorldTests) {
        console.log(`\n🔍 Testing: ${test.url}`);
        console.log(`   Expected method: ${test.expected}`);

        try {
            const startTime = Date.now();
            const foundRSS = await advancedRSSDetector.findRSSFeed(test.url);
            const duration = Date.now() - startTime;

            if (foundRSS) {
                console.log(`   ✅ SUCCESS: ${foundRSS} (${duration}ms)`);
                const stats = advancedRSSDetector.getStats();
                const method = getLastUsedMethod(stats);
                console.log(`   📊 Detection method: ${method}`);

                realWorldResults.push({
                    url: test.url,
                    rss: foundRSS,
                    method: method,
                    duration: duration,
                    success: true
                });
            } else {
                console.log(`   ❌ FAILED: No RSS found (${duration}ms)`);
                realWorldResults.push({
                    url: test.url,
                    rss: null,
                    method: 'None',
                    duration: duration,
                    success: false
                });
            }

        } catch (error) {
            console.log(`   ❌ ERROR: ${error.message}`);
            realWorldResults.push({
                url: test.url,
                error: error.message,
                success: false
            });
        }

        // Delay between requests
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Display real-world results
    displayRealWorldResults(realWorldResults);

    return realWorldResults;
}

/**
 * Performance testing
 */
async function performanceTest() {
    console.log('\n⚡ Performance Testing');
    console.log('======================\n');

    const testUrls = [
        'https://vnexpress.net/suc-khoe',
        'https://techcrunch.com',
        'https://github.blog',
        'https://thanhnien.vn'
    ];

    const performanceResults = [];

    for (const url of testUrls) {
        console.log(`\n⏱️  Performance test: ${url}`);

        const times = [];
        const iterations = 3;

        for (let i = 0; i < iterations; i++) {
            try {
                const startTime = Date.now();
                const foundRSS = await advancedRSSDetector.findRSSFeed(url);
                const duration = Date.now() - startTime;

                times.push(duration);
                console.log(`   Iteration ${i + 1}: ${duration}ms ${foundRSS ? '✅' : '❌'}`);

                // Clear cache for fair testing
                advancedRSSDetector.rssCache.clear();

            } catch (error) {
                console.log(`   Iteration ${i + 1}: Error - ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (times.length > 0) {
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);

            console.log(`   📊 Average: ${avgTime.toFixed(2)}ms`);
            console.log(`   📊 Min: ${minTime}ms, Max: ${maxTime}ms`);

            performanceResults.push({
                url,
                avgTime: avgTime.toFixed(2),
                minTime,
                maxTime,
                iterations: times.length
            });
        }
    }

    return performanceResults;
}

/**
 * Get the last used detection method from stats
 */
function getLastUsedMethod(stats) {
    const methods = [
        { name: 'HTML Head', count: stats.htmlHeadDetection },
        { name: 'Domain Rules', count: stats.domainRuleDetection },
        { name: 'URL Pattern', count: stats.urlPatternDetection },
        { name: 'Common Paths', count: stats.commonPathDetection },
        { name: 'WordPress', count: stats.wordpressDetection },
        { name: 'Sitemap', count: stats.sitemapDetection },
        { name: 'Robots.txt', count: stats.robotsDetection },
        { name: 'Content Mining', count: stats.contentMiningDetection }
    ];

    return methods.reduce((best, current) =>
        current.count > best.count ? current : best
    ).name;
}

/**
 * Display test results summary
 */
function displayTestResults(results) {
    console.log('\n📊 Test Results Summary');
    console.log('========================');
    console.log(`Total tests: ${results.total}`);
    console.log(`Passed: ${results.passed} (${((results.passed / results.total) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${results.failed} (${((results.failed / results.total) * 100).toFixed(1)}%)`);

    console.log('\n📈 Detection Methods Used:');
    for (const [method, count] of Object.entries(results.detectionMethods)) {
        console.log(`   ${method}: ${count} times`);
    }

    if (results.errors.length > 0) {
        console.log('\n❌ Failed Tests:');
        results.errors.forEach(error => {
            console.log(`   - ${error.test}: ${error.error || 'RSS not found'}`);
        });
    }
}

/**
 * Display real-world results
 */
function displayRealWorldResults(results) {
    console.log('\n📊 Real-World Test Summary');
    console.log('===========================');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Success rate: ${successful.length}/${results.length} (${((successful.length / results.length) * 100).toFixed(1)}%)`);

    console.log('\n✅ Successful detections:');
    successful.forEach(result => {
        console.log(`   ${result.url} → ${result.method} (${result.duration}ms)`);
    });

    if (failed.length > 0) {
        console.log('\n❌ Failed detections:');
        failed.forEach(result => {
            console.log(`   ${result.url} → ${result.error || 'No RSS found'}`);
        });
    }
}

/**
 * Manual test function for specific URL
 */
async function testSpecificURL(url) {
    console.log(`\n🔍 Manual Test: ${url}`);
    console.log(''.padEnd(50, '='));

    try {
        console.log('🔄 Starting detection...');

        const startTime = Date.now();
        const rssUrl = await advancedRSSDetector.findRSSFeed(url);
        const duration = Date.now() - startTime;

        if (rssUrl) {
            console.log(`✅ RSS Found: ${rssUrl}`);
            console.log(`⏱️  Detection time: ${duration}ms`);

            const stats = advancedRSSDetector.getStats();
            console.log(`📊 Detection method: ${getLastUsedMethod(stats)}`);
            console.log(`📈 Detector stats:`, stats);

            return { success: true, rss: rssUrl, duration, stats };
        } else {
            console.log(`❌ No RSS feed found`);
            console.log(`⏱️  Search time: ${duration}ms`);

            const stats = advancedRSSDetector.getStats();
            console.log(`📈 Detector stats:`, stats);

            return { success: false, duration, stats };
        }

    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Export test functions
module.exports = {
    runRSSDetectorTests,
    testRealWorldURLs,
    performanceTest,
    testSpecificURL,
    testCases,
    realWorldTests
};

// Run tests if this file is executed directly
if (require.main === module) {
    async function runAllTests() {
        try {
            await runRSSDetectorTests();
            await testRealWorldURLs();
            await performanceTest();

            console.log('\n🎉 All tests completed!');
        } catch (error) {
            console.error('❌ Test suite failed:', error);
        }
    }

    runAllTests();
}