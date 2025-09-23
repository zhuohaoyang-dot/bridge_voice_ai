const redisService = require('../services/redisService');
const logger = require('../utils/logger');

async function initializeRedis() {
    try {
        logger.info('Initializing Redis connection...');
        
        // Connect to Redis
        await redisService.connect();
        
        // Verify connection
        const isConnected = await redisService.ping();
        if (!isConnected) {
            throw new Error('Redis ping failed');
        }
        
        // Run health check
        const health = await redisService.healthCheck();
        logger.info('Redis health check:', health);
        
        // Clean up old data if needed (optional)
        if (process.env.REDIS_CLEAN_ON_START === 'true') {
            logger.warn('Cleaning Redis data on start...');
            await redisService.flushAll();
        }
        
        logger.info('Redis initialized successfully');
        
        return true;
    } catch (error) {
        logger.error('Failed to initialize Redis:', error);
        
        // Decide whether to continue without Redis or exit
        if (process.env.REDIS_REQUIRED === 'true') {
            logger.error('Redis is required. Exiting...');
            process.exit(1);
        } else {
            logger.warn('Continuing without Redis. Some features may not work properly.');
            return false;
        }
    }
}

// Graceful shutdown
async function shutdownRedis() {
    try {
        logger.info('Shutting down Redis connection...');
        await redisService.disconnect();
        logger.info('Redis connection closed');
    } catch (error) {
        logger.error('Error during Redis shutdown:', error);
    }
}

module.exports = {
    initializeRedis,
    shutdownRedis
};