// making for redis health check
const express = require('express');
const router = express.Router();
const redisService = require('../services/redisService');
const redisMonitor = require('../utils/redisMonitor');
const logger = require('../utils/logger');

// Basic health check
router.get('/', async (req, res) => {
    try {
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV
        };
        
        res.json(health);
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            status: 'error',
            error: error.message
        });
    }
});

// Redis health check
router.get('/redis', async (req, res) => {
    try {
        const redisHealth = await redisMonitor.checkHealth();
        
        if (redisHealth.status === 'healthy') {
            res.json(redisHealth);
        } else {
            res.status(503).json(redisHealth);
        }
    } catch (error) {
        logger.error('Redis health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Detailed system metrics
router.get('/metrics', async (req, res) => {
    try {
        const metrics = {
            server: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            },
            redis: redisMonitor.getMetrics(),
            timestamp: new Date().toISOString()
        };
        
        res.json(metrics);
    } catch (error) {
        logger.error('Failed to get metrics:', error);
        res.status(500).json({
            error: 'Failed to retrieve metrics'
        });
    }
});

// Redis Cloud specific metrics (protected endpoint)
router.get('/redis/cloud', async (req, res) => {
    try {
        // Add basic auth check here if needed
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const cloudMetrics = await redisMonitor.getCloudMetrics();
        res.json(cloudMetrics);
    } catch (error) {
        logger.error('Failed to get cloud metrics:', error);
        res.status(500).json({
            error: 'Failed to retrieve cloud metrics'
        });
    }
});

module.exports = router;