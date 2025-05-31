// scripts/start.js
/**
 * Production start script với health checks và monitoring
 */

const cluster = require('cluster');
const os = require('os');
const { logWithTimestamp } = require('../src/utils/helpers');

const numCPUs = os.cpus().length;
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Master process management
 */
if (cluster.isMaster && !isDevelopment) {
    console.log('🚀 RSS Feed Generator - Production Mode');
    console.log('========================================');
    logWithTimestamp(`Master ${process.pid} is running`);
    logWithTimestamp(`Starting ${numCPUs} workers...`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        const worker = cluster.fork();
        logWithTimestamp(`Worker ${worker.process.pid} started`);
    }

    // Handle worker exit
    cluster.on('exit', (worker, code, signal) => {
        logWithTimestamp(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`, 'error');
        logWithTimestamp('Starting a new worker...');
        cluster.fork();
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        logWithTimestamp('Master received SIGTERM, shutting down gracefully...');

        for (const id in cluster.workers) {
            cluster.workers[id].kill();
        }
    });

    // Health monitoring
    setInterval(() => {
        const workers = Object.keys(cluster.workers).length;
        const memUsage = process.memoryUsage();
        const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);

        logWithTimestamp(`Health check - Workers: ${workers}, Memory: ${memMB}MB`);
    }, 30000); // Every 30 seconds

} else {
    // Worker process hoặc development mode
    startWorker();
}

/**
 * Start worker process
 */
function startWorker() {
    try {
        // Validate environment
        if (!process.env.NODE_ENV) {
            process.env.NODE_ENV = 'development';
        }

        // Load and validate config
        const config = require('../config');
        config.validate();

        // Start the server
        require('../server');

        if (cluster.isWorker) {
            logWithTimestamp(`Worker ${process.pid} started successfully`);
        } else {
            logWithTimestamp('Development server started');
        }

    } catch (error) {
        logWithTimestamp(`Failed to start worker: ${error.message}`, 'error');
        process.exit(1);
    }
}

/**
 * Health check endpoint for load balancer
 */
function setupHealthCheck() {
    const express = require('express');
    const app = express();

    app.get('/health', (req, res) => {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            pid: process.pid,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            load: os.loadavg()
        };

        res.json(health);
    });

    const healthPort = process.env.HEALTH_PORT || 3001;
    app.listen(healthPort, () => {
        logWithTimestamp(`Health check server running on port ${healthPort}`);
    });
}

// Setup health check in production
if (process.env.NODE_ENV === 'production') {
    setupHealthCheck();
}