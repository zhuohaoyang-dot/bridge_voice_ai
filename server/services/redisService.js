const redis = require('redis');
const logger = require('../utils/logger');

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            // Parse Redis URL for cloud configuration
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
            
            this.client = redis.createClient({
                url: redisUrl,
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            logger.error('Redis: Max reconnection attempts reached');
                            return new Error('Max reconnection attempts reached');
                        }
                        const delay = Math.min(retries * 100, 3000);
                        logger.info(`Redis: Reconnecting in ${delay}ms...`);
                        return delay;
                    },
                    connectTimeout: 10000,
                    keepAlive: 5000
                },
                // Redis Cloud specific settings
                pingInterval: 5000,
                database: 0 // Redis Cloud uses database 0 by default
            });

            // Error handling
            this.client.on('error', (err) => {
                logger.error('Redis Client Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                logger.info('Redis Client Connected');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                logger.info('Redis Client Ready');
            });

            this.client.on('end', () => {
                logger.info('Redis Client Disconnected');
                this.isConnected = false;
            });

            // Connect to Redis
            await this.client.connect();
            
            // Test connection
            await this.client.ping();
            
            return true;
        } catch (error) {
            logger.error('Failed to connect to Redis:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            this.isConnected = false;
        }
    }

    // Campaign operations
    async saveCampaign(campaignId, campaignData) {
        try {
            const key = `campaign:${campaignId}`;
            const ttl = 60 * 60 * 24 * 7; // 7 days
            
            await this.client.setEx(key, ttl, JSON.stringify(campaignData));
            
            // Add to active campaigns set
            await this.client.sAdd('active_campaigns', campaignId);
            
            logger.info(`Campaign saved: ${campaignId}`);
            return true;
        } catch (error) {
            logger.error(`Error saving campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async getCampaign(campaignId) {
        try {
            const key = `campaign:${campaignId}`;
            const data = await this.client.get(key);
            
            if (!data) return null;
            
            return JSON.parse(data);
        } catch (error) {
            logger.error(`Error getting campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async updateCampaign(campaignId, updates) {
        try {
            const campaign = await this.getCampaign(campaignId);
            if (!campaign) {
                throw new Error('Campaign not found');
            }
            
            const updatedCampaign = { ...campaign, ...updates };
            await this.saveCampaign(campaignId, updatedCampaign);
            
            return updatedCampaign;
        } catch (error) {
            logger.error(`Error updating campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async deleteCampaign(campaignId) {
        try {
            const key = `campaign:${campaignId}`;
            
            // Remove from Redis
            await this.client.del(key);
            
            // Remove from active campaigns set
            await this.client.sRem('active_campaigns', campaignId);
            
            // Clean up related data
            await this.client.del(`campaign_queue:${campaignId}`);
            
            logger.info(`Campaign deleted: ${campaignId}`);
            return true;
        } catch (error) {
            logger.error(`Error deleting campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async getAllCampaigns() {
        try {
            const campaignIds = await this.client.sMembers('active_campaigns');
            const campaigns = [];
            
            for (const id of campaignIds) {
                const campaign = await this.getCampaign(id);
                if (campaign) {
                    campaigns.push(campaign);
                }
            }
            
            return campaigns;
        } catch (error) {
            logger.error('Error getting all campaigns:', error);
            throw error;
        }
    }

    // Campaign queue operations
    async saveCampaignQueue(campaignId, contacts) {
        try {
            const key = `campaign_queue:${campaignId}`;
            const ttl = 60 * 60 * 24; // 24 hours
            
            // Store as a list for queue operations
            await this.client.del(key); // Clear existing queue
            
            if (contacts.length > 0) {
                const contactStrings = contacts.map(c => JSON.stringify(c));
                await this.client.rPush(key, contactStrings);
                await this.client.expire(key, ttl);
            }
            
            logger.info(`Campaign queue saved: ${campaignId} with ${contacts.length} contacts`);
            return true;
        } catch (error) {
            logger.error(`Error saving campaign queue ${campaignId}:`, error);
            throw error;
        }
    }

    async getNextContact(campaignId) {
        try {
            const key = `campaign_queue:${campaignId}`;
            const contactJson = await this.client.lPop(key);
            
            if (!contactJson) return null;
            
            return JSON.parse(contactJson);
        } catch (error) {
            logger.error(`Error getting next contact for campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async getQueueLength(campaignId) {
        try {
            const key = `campaign_queue:${campaignId}`;
            return await this.client.lLen(key);
        } catch (error) {
            logger.error(`Error getting queue length for campaign ${campaignId}:`, error);
            throw error;
        }
    }

    // Call tracking operations
    async addCallToCampaign(campaignId, callId, callData) {
        try {
            const key = `campaign_calls:${campaignId}`;
            await this.client.hSet(key, callId, JSON.stringify(callData));
            await this.client.expire(key, 60 * 60 * 24 * 7); // 7 days
            
            return true;
        } catch (error) {
            logger.error(`Error adding call ${callId} to campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async getCampaignCalls(campaignId) {
        try {
            const key = `campaign_calls:${campaignId}`;
            const calls = await this.client.hGetAll(key);
            
            const parsedCalls = {};
            for (const [callId, callData] of Object.entries(calls)) {
                parsedCalls[callId] = JSON.parse(callData);
            }
            
            return parsedCalls;
        } catch (error) {
            logger.error(`Error getting calls for campaign ${campaignId}:`, error);
            throw error;
        }
    }

    // Utility methods
    async ping() {
        try {
            const result = await this.client.ping();
            return result === 'PONG';
        } catch (error) {
            logger.error('Redis ping failed:', error);
            return false;
        }
    }

    async flushAll() {
        try {
            if (process.env.NODE_ENV === 'development') {
                await this.client.flushAll();
                logger.warn('Redis: All data flushed');
                return true;
            } else {
                throw new Error('Flush operation not allowed in production');
            }
        } catch (error) {
            logger.error('Error flushing Redis:', error);
            throw error;
        }
    }

    // Health check
    async healthCheck() {
        try {
            const info = {
                connected: this.isConnected,
                responsive: await this.ping(),
                activeCampaigns: await this.client.sCard('active_campaigns'),
                memoryUsage: await this.client.info('memory')
            };
            
            return info;
        } catch (error) {
            logger.error('Redis health check failed:', error);
            return {
                connected: false,
                responsive: false,
                error: error.message
            };
        }
    }
}

// Create singleton instance
const redisService = new RedisService();

module.exports = redisService;