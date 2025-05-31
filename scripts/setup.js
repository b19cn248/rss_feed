// scripts/setup.js
/**
 * Setup script để khởi tạo project và kiểm tra environment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 RSS Feed Generator - Setup Script');
console.log('====================================\n');

/**
 * Kiểm tra Node.js version
 */
function checkNodeVersion() {
    console.log('📋 Checking Node.js version...');
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));

    console.log(`   Current version: ${nodeVersion}`);

    if (majorVersion < 16) {
        console.log('   ❌ Node.js version 16 or higher is required');
        process.exit(1);
    } else {
        console.log('   ✅ Node.js version is compatible');
    }
}

/**
 * Tạo .env file nếu chưa có
 */
function createEnvFile() {
    console.log('\n📄 Setting up environment file...');

    const envPath = path.join(__dirname, '..', '.env');
    const envExamplePath = path.join(__dirname, '..', '.env.example');

    if (!fs.existsSync(envPath)) {
        if (fs.existsSync(envExamplePath)) {
            fs.copyFileSync(envExamplePath, envPath);
            console.log('   ✅ Created .env from .env.example');
        } else {
            // Tạo .env mặc định
            const defaultEnv = `# Server Configuration
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

# Application Settings
CACHE_DURATION=3600
MAX_ARTICLES_PER_FEED=20
REQUEST_TIMEOUT=10000

# Security
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100

# Scraping Settings
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`;

            fs.writeFileSync(envPath, defaultEnv);
            console.log('   ✅ Created default .env file');
        }
    } else {
        console.log('   ℹ️  .env file already exists');
    }
}

/**
 * Tạo thư mục logs nếu chưa có
 */
function createDirectories() {
    console.log('\n📁 Creating necessary directories...');

    const directories = ['logs', 'tmp', 'data'];

    directories.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`   ✅ Created ${dir}/ directory`);
        } else {
            console.log(`   ℹ️  ${dir}/ directory already exists`);
        }
    });
}

/**
 * Kiểm tra dependencies
 */
function checkDependencies() {
    console.log('\n📦 Checking dependencies...');

    try {
        const packageJson = require('../package.json');
        const dependencies = Object.keys(packageJson.dependencies || {});
        const devDependencies = Object.keys(packageJson.devDependencies || {});

        console.log(`   📊 Production dependencies: ${dependencies.length}`);
        console.log(`   📊 Development dependencies: ${devDependencies.length}`);

        // Kiểm tra các dependency quan trọng
        const requiredDeps = ['express', 'cheerio', 'axios', 'rss'];
        const missingDeps = requiredDeps.filter(dep => !dependencies.includes(dep));

        if (missingDeps.length > 0) {
            console.log(`   ❌ Missing required dependencies: ${missingDeps.join(', ')}`);
            console.log('   🔧 Run: npm install');
            return false;
        } else {
            console.log('   ✅ All required dependencies are listed');
            return true;
        }
    } catch (error) {
        console.log('   ❌ Error reading package.json');
        return false;
    }
}

/**
 * Test server startup
 */
function testServerStartup() {
    console.log('\n🧪 Testing server startup...');

    try {
        // Import config to test
        const config = require('../config');
        config.validate();
        console.log('   ✅ Configuration is valid');

        // Test basic imports
        require('../src/services/scraperService');
        require('../src/services/feedService');
        console.log('   ✅ Core services can be imported');

        return true;
    } catch (error) {
        console.log(`   ❌ Server startup test failed: ${error.message}`);
        return false;
    }
}

/**
 * Tạo .env.example
 */
function createEnvExample() {
    const envExamplePath = path.join(__dirname, '..', '.env.example');

    if (!fs.existsSync(envExamplePath)) {
        const envExample = `# Server Configuration
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

# Application Settings
CACHE_DURATION=3600
MAX_ARTICLES_PER_FEED=20
REQUEST_TIMEOUT=10000

# Security
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100

# Scraping Settings
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`;

        fs.writeFileSync(envExamplePath, envExample);
        console.log('   ✅ Created .env.example');
    }
}

/**
 * Hiển thị hướng dẫn tiếp theo
 */
function showNextSteps() {
    console.log('\n🎯 Next Steps');
    console.log('==============');
    console.log('1. Install dependencies:');
    console.log('   npm install');
    console.log('');
    console.log('2. Start development server:');
    console.log('   npm run dev');
    console.log('');
    console.log('3. Test the API:');
    console.log('   curl http://localhost:3000/health');
    console.log('');
    console.log('4. Generate your first RSS feed:');
    console.log('   curl "http://localhost:3000/feed?url=https://vnexpress.net"');
    console.log('');
    console.log('5. Run test suite:');
    console.log('   node tests/examples.js');
    console.log('');
    console.log('📖 For more information, see README.md');
}

/**
 * Main setup function
 */
async function runSetup() {
    try {
        checkNodeVersion();
        createEnvExample();
        createEnvFile();
        createDirectories();

        const depsOk = checkDependencies();
        const serverOk = testServerStartup();

        console.log('\n📊 Setup Summary');
        console.log('=================');
        console.log(`✅ Node.js version: Compatible`);
        console.log(`${depsOk ? '✅' : '❌'} Dependencies: ${depsOk ? 'OK' : 'Missing'}`);
        console.log(`${serverOk ? '✅' : '❌'} Server test: ${serverOk ? 'Passed' : 'Failed'}`);

        if (depsOk && serverOk) {
            console.log('\n🎉 Setup completed successfully!');
            showNextSteps();
        } else {
            console.log('\n⚠️  Setup completed with warnings. Please fix the issues above.');
        }

    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        process.exit(1);
    }
}

// Chạy setup nếu file được execute trực tiếp
if (require.main === module) {
    runSetup();
}

module.exports = { runSetup };