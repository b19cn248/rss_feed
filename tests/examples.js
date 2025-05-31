// tests/examples.js
/**
 * Example test cases và usage examples cho RSS Feed Generator
 */

const config = require('../config');

// Base URL của local server
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Test cases cho các website phổ biến
 */
const testWebsites = [
    {
        name: 'VnExpress',
        url: 'https://vnexpress.net',
        description: 'Trang tin tức lớn nhất Việt Nam',
        expectedArticles: 15
    },
    {
        name: 'TechCrunch',
        url: 'https://techcrunch.com',
        description: 'Technology news website',
        expectedArticles: 10
    },
    {
        name: 'GitHub Blog',
        url: 'https://github.blog',
        description: 'GitHub official blog',
        expectedArticles: 8
    },
    {
        name: 'Dân Trí',
        url: 'https://dantri.com.vn',
        description: 'Báo điện tử Dân Trí',
        expectedArticles: 12
    }
];

/**
 * Test basic functionality
 */
async function testBasicFunctionality() {
    console.log('🧪 Testing Basic Functionality...\n');

    try {
        // Test health check
        console.log('1. Testing health check...');
        const healthResponse = await fetch(`${BASE_URL}/health`);
        if (healthResponse.ok) {
            console.log('   ✅ Health check passed');
        } else {
            console.log('   ❌ Health check failed');
        }

        // Test API info
        console.log('2. Testing API info...');
        const apiResponse = await fetch(`${BASE_URL}/api/info`);
        if (apiResponse.ok) {
            console.log('   ✅ API info accessible');
        } else {
            console.log('   ❌ API info failed');
        }

        // Test invalid URL handling
        console.log('3. Testing invalid URL handling...');
        const invalidResponse = await fetch(`${BASE_URL}/feed?url=invalid-url`);
        if (invalidResponse.status === 400) {
            console.log('   ✅ Invalid URL properly rejected');
        } else {
            console.log('   ❌ Invalid URL handling failed');
        }

    } catch (error) {
        console.error('❌ Basic functionality test failed:', error.message);
    }
}

/**
 * Test feed generation cho một website
 */
async function testFeedGeneration(website) {
    console.log(`\n📡 Testing ${website.name} (${website.url})...`);

    try {
        // Test preview first
        console.log('   📖 Testing article preview...');
        const previewUrl = `${BASE_URL}/preview?url=${encodeURIComponent(website.url)}&limit=5`;
        const previewResponse = await fetch(previewUrl);

        if (previewResponse.ok) {
            const previewData = await previewResponse.json();
            console.log(`   ✅ Found ${previewData.data.preview.length} articles in preview`);

            // Show sample article
            if (previewData.data.preview.length > 0) {
                const sample = previewData.data.preview[0];
                console.log(`   📄 Sample article: "${sample.title.substring(0, 50)}..."`);
            }
        } else {
            console.log('   ❌ Preview failed');
            return false;
        }

        // Test full feed generation
        console.log('   📡 Testing RSS feed generation...');
        const feedUrl = `${BASE_URL}/feed?url=${encodeURIComponent(website.url)}`;
        const feedResponse = await fetch(feedUrl);

        if (feedResponse.ok) {
            const rssXml = await feedResponse.text();
            console.log(`   ✅ RSS feed generated (${rssXml.length} characters)`);

            // Basic XML validation
            if (rssXml.includes('<rss') && rssXml.includes('</rss>')) {
                console.log('   ✅ Valid RSS structure');
            } else {
                console.log('   ❌ Invalid RSS structure');
            }

            return true;
        } else {
            console.log('   ❌ Feed generation failed');
            return false;
        }

    } catch (error) {
        console.log(`   ❌ Error testing ${website.name}: ${error.message}`);
        return false;
    }
}

/**
 * Test metadata extraction
 */
async function testMetadata(website) {
    try {
        console.log(`   📊 Testing metadata extraction...`);
        const metadataUrl = `${BASE_URL}/metadata?url=${encodeURIComponent(website.url)}`;
        const metadataResponse = await fetch(metadataUrl);

        if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            console.log(`   ✅ Metadata: "${metadata.data.title}"`);
            console.log(`   📈 Article count: ${metadata.data.articleCount}`);
        } else {
            console.log('   ❌ Metadata extraction failed');
        }
    } catch (error) {
        console.log(`   ❌ Metadata test error: ${error.message}`);
    }
}

/**
 * Test cache functionality
 */
async function testCaching() {
    console.log('\n💾 Testing Cache Functionality...');

    try {
        // Get cache stats
        const statsResponse = await fetch(`${BASE_URL}/cache/stats`);
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            console.log(`   📊 Cache size: ${stats.data.size} entries`);
        }

        // Test feed generation twice (second should be faster due to cache)
        const testUrl = testWebsites[0].url;

        console.log('   ⏱️  First request (no cache)...');
        const start1 = Date.now();
        await fetch(`${BASE_URL}/feed?url=${encodeURIComponent(testUrl)}`);
        const time1 = Date.now() - start1;

        console.log('   ⏱️  Second request (cached)...');
        const start2 = Date.now();
        await fetch(`${BASE_URL}/feed?url=${encodeURIComponent(testUrl)}`);
        const time2 = Date.now() - start2;

        console.log(`   📈 First request: ${time1}ms`);
        console.log(`   📈 Second request: ${time2}ms`);

        if (time2 < time1) {
            console.log('   ✅ Cache is working (second request faster)');
        } else {
            console.log('   ⚠️  Cache might not be working optimally');
        }

    } catch (error) {
        console.error('❌ Cache test failed:', error.message);
    }
}

/**
 * Test rate limiting
 */
async function testRateLimit() {
    console.log('\n🛡️  Testing Rate Limiting...');

    try {
        const requests = [];
        const testUrl = `${BASE_URL}/health`;

        // Send multiple requests quickly
        for (let i = 0; i < 10; i++) {
            requests.push(fetch(testUrl));
        }

        const responses = await Promise.all(requests);
        const successCount = responses.filter(r => r.ok).length;
        const rateLimitedCount = responses.filter(r => r.status === 429).length;

        console.log(`   📊 Successful requests: ${successCount}`);
        console.log(`   🚫 Rate limited requests: ${rateLimitedCount}`);

        if (successCount > 0) {
            console.log('   ✅ Server is responding');
        }

        if (rateLimitedCount === 0) {
            console.log('   ℹ️  Rate limiting not triggered (normal for light testing)');
        }

    } catch (error) {
        console.error('❌ Rate limit test failed:', error.message);
    }
}

/**
 * Performance test
 */
async function performanceTest() {
    console.log('\n⚡ Performance Testing...');

    const testUrl = testWebsites[0].url;
    const iterations = 3;
    const times = [];

    for (let i = 0; i < iterations; i++) {
        try {
            console.log(`   🔄 Iteration ${i + 1}/${iterations}...`);

            const start = Date.now();
            const response = await fetch(`${BASE_URL}/feed?url=${encodeURIComponent(testUrl)}`);
            const end = Date.now();

            if (response.ok) {
                const time = end - start;
                times.push(time);
                console.log(`      ⏱️  Response time: ${time}ms`);
            }

            // Wait between requests
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.log(`      ❌ Iteration ${i + 1} failed: ${error.message}`);
        }
    }

    if (times.length > 0) {
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        console.log(`   📊 Average response time: ${avgTime.toFixed(2)}ms`);
        console.log(`   📊 Min response time: ${minTime}ms`);
        console.log(`   📊 Max response time: ${maxTime}ms`);
    }
}

/**
 * Run all tests
 */
async function runAllTests() {
    console.log('🚀 RSS Feed Generator - Test Suite');
    console.log('=====================================');
    console.log(`Testing server at: ${BASE_URL}\n`);

    // Basic functionality tests
    await testBasicFunctionality();

    // Test each website
    let successCount = 0;
    for (const website of testWebsites) {
        const success = await testFeedGeneration(website);
        if (success) {
            await testMetadata(website);
            successCount++;
        }
    }

    // Additional tests
    await testCaching();
    await testRateLimit();
    await performanceTest();

    // Summary
    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`✅ Successful websites: ${successCount}/${testWebsites.length}`);
    console.log(`📈 Success rate: ${((successCount / testWebsites.length) * 100).toFixed(1)}%`);

    if (successCount === testWebsites.length) {
        console.log('🎉 All tests passed!');
    } else {
        console.log('⚠️  Some tests failed. Check the logs above.');
    }
}

/**
 * Usage examples
 */
function showUsageExamples() {
    console.log('\n📖 Usage Examples');
    console.log('==================');

    console.log('\n1. Generate RSS feed:');
    console.log(`   curl "${BASE_URL}/feed?url=https://vnexpress.net"`);

    console.log('\n2. Preview articles:');
    console.log(`   curl "${BASE_URL}/preview?url=https://vnexpress.net&limit=5"`);

    console.log('\n3. Get metadata:');
    console.log(`   curl "${BASE_URL}/metadata?url=https://vnexpress.net"`);

    console.log('\n4. Custom feed title:');
    console.log(`   curl "${BASE_URL}/feed?url=https://vnexpress.net&title=My Custom Feed"`);

    console.log('\n5. Validate website:');
    console.log(`   curl -X POST ${BASE_URL}/validate -H "Content-Type: application/json" -d '{"url": "https://vnexpress.net"}'`);

    console.log('\n6. Cache management:');
    console.log(`   curl "${BASE_URL}/cache/stats"`);
    console.log(`   curl -X DELETE "${BASE_URL}/cache?url=https://vnexpress.net"`);
}

// Export functions for external use
module.exports = {
    testBasicFunctionality,
    testFeedGeneration,
    testMetadata,
    testCaching,
    testRateLimit,
    performanceTest,
    runAllTests,
    showUsageExamples,
    testWebsites
};

// Run tests if this file is executed directly
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--examples')) {
        showUsageExamples();
    } else if (args.includes('--help')) {
        console.log('RSS Feed Generator Test Suite');
        console.log('Usage: node tests/examples.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --examples    Show usage examples');
        console.log('  --help        Show this help message');
        console.log('  (no args)     Run all tests');
    } else {
        // Run all tests
        runAllTests().catch(error => {
            console.error('❌ Test suite failed:', error);
            process.exit(1);
        });
    }
}