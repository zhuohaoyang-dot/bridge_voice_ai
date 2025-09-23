const redisService = require('../services/redisService');
const logger = require('./logger');

class RedisMonitor {
    constructor() {
        this.metrics = {
            operations: {
                success: 0,
                failed: 0
            },
            latency: [],
            lastCheck: null
        };
    }

    // Monitor Redis operations
    async trackOperation(operationName, operation) {
        const start = Date.now();
        
        try {
            const result = await operation();
            const duration = Date.now() - start;
            
            this.metrics.operations.success++;
            this.metrics.latency.push({
                operation: operationName,
                duration,
                timestamp: new Date().toISOString(),
                success: true
            });
            
            // Keep only last 100 operations
            if (this.metrics.latency.length > 100) {
                this.metrics.latency.shift();
            }
            
            // Log slow operations
            if (duration > 100) {
                logger.warn(`Slow Redis operation: ${operationName} took ${duration}ms`);
            }
            
            return result;
        } catch (error) {
            this.metrics.operations.failed++;
            this.metrics.latency.push({
                operation: operationName,
                duration: Date.now() - start,
                timestamp: new Date().toISOString(),
                success: false,
                error: error.message
            });
            
            logger.error(`Redis operation failed: ${operationName}`, error);
            throw error;
        }
    }

    // Get average latency
    getAverageLatency() {
        const recentOps = this.metrics.latency.slice(-20);
        if (recentOps.length === 0) return 0;
        
        const totalDuration = recentOps.reduce((sum, op) => sum + op.duration, 0);
        return Math.round(totalDuration / recentOps.length);
    }

    // Get success rate
    getSuccessRate() {
        const total = this.metrics.operations.success + this.metrics.operations.failed;
        if (total === 0) return 100;
        
        return Math.round((this.metrics.operations.success / total) * 100);
    }

    // Monitor Redis health
    async checkHealth() {
        try {
            const start = Date.now();
            
            // Basic ping test
            const pingOk = await this.trackOperation('ping', () => redisService.ping());
            
            // Memory check
            const info = await this.trackOperation('info', async () => {
                const infoStr = await redisService.client.info('memory');
                const lines = infoStr.split('\r\n');
                const memoryInfo = {};
                
                lines.forEach(line => {
                    if (line.includes(':')) {
                        const [key, value] = line.split(':');
                        memoryInfo[key] = value;
                    }
                });
                
                return memoryInfo;
            });
            
            // Get database size
            const dbSize = await this.trackOperation('dbsize', () => 
                redisService.client.dbSize()
            );
            
            // Active campaigns count
            const activeCampaignsCount = await this.trackOperation('campaign_count', () =>
                redisService.client.sCard('active_campaigns')
            );
            
            const health = {
                status: pingOk ? 'healthy' : 'unhealthy',
                latency: Date.now() - start,
                averageLatency: this.getAverageLatency(),
                successRate: this.getSuccessRate(),
                memory: {
                    used: info.used_memory_human || 'N/A',
                    peak: info.used_memory_peak_human || 'N/A',
                    rss: info.used_memory_rss_human || 'N/A'
                },
                database: {
                    keys: dbSize,
                    activeCampaigns: activeCampaignsCount
                },
                timestamp: new Date().toISOString()
            };
            
            this.metrics.lastCheck = health;
            
            // Log warning if memory usage is high
            if (info.used_memory_rss && info.maxmemory) {
                const usagePercent = (parseInt(info.used_memory_rss) / parseInt(info.maxmemory)) * 100;
                if (usagePercent > 80) {
                    logger.warn(`High Redis memory usage: ${usagePercent.toFixed(2)}%`);
                }
            }
            
            return health;
            
        } catch (error) {
            logger.error('Redis health check failed:', error);
            
            return {
                status: 'unhealthy',
                error: error.message,
                averageLatency: this.getAverageLatency(),
                successRate: this.getSuccessRate(),
                timestamp: new Date().toISOString()
            };
        }
    }

    // Get current metrics
    getMetrics() {
        return {
            ...this.metrics,
            averageLatency: this.getAverageLatency(),
            successRate: this.getSuccessRate()
        };
    }

    // Start periodic health checks
    startMonitoring(intervalMs = 60000) {
        logger.info(`Starting Redis monitoring with ${intervalMs}ms interval`);
        
        // Initial check
        this.checkHealth();
        
        // Periodic checks
        this.monitorInterval = setInterval(() => {
            this.checkHealth();
        }, intervalMs);
    }

    // Stop monitoring
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            logger.info('Redis monitoring stopped');
        }
    }

    // Get Redis Cloud specific metrics
    async getCloudMetrics() {
        try {
            const config = await this.trackOperation('config', async () => {
                const configData = {};
                
                try {
                    // Try to get maxmemory
                    const maxmemory = await redisService.client.configGet('maxmemory');
                    if (maxmemory) configData.maxmemory = maxmemory;
                } catch (e) {
                    // Some Redis Cloud instances may not allow CONFIG commands
                    logger.debug('Cannot get Redis config (normal for Redis Cloud)');
                }
                
                return configData;
            });
            
            const info = await this.trackOperation('full_info', async () => {
                const sections = ['server', 'clients', 'memory', 'stats', 'keyspace'];
                const fullInfo = {};
                
                for (const section of sections) {
                    try {
                        const sectionInfo = await redisService.client.info(section);
                        fullInfo[section] = this.parseInfo(sectionInfo);
                    } catch (e) {
                        logger.debug(`Cannot get ${section} info`);
                    }
                }
                
                return fullInfo;
            });
            
            return {
                config,
                info,
                health: this.metrics.lastCheck,
                performance: {
                    averageLatency: this.getAverageLatency(),
                    successRate: this.getSuccessRate(),
                    recentOperations: this.metrics.latency.slice(-10)
                }
            };
            
        } catch (error) {
            logger.error('Failed to get cloud metrics:', error);
            return null;
        }
    }

    // Parse Redis INFO output
    parseInfo(infoStr) {
        const info = {};
        const lines = infoStr.split('\r\n');
        
        lines.forEach(line => {
            if (line && !line.startsWith('#') && line.includes(':')) {
                const [key, value] = line.split(':');
                info[key] = value;
            }
        });
        
        return info;
    }
}

// Create singleton instance
const redisMonitor = new RedisMonitor();

module.exports = redisMonitor;