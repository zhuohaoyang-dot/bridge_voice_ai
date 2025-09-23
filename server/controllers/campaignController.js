const vapiService = require('../services/vapiService');
const csvProcessor = require('../services/csvProcessor');
const redisService = require('../services/redisService');
const { broadcastToClients } = require('../websocket');
const logger = require('../utils/logger');

// Start a new campaign
exports.startCampaign = async (req, res) => {
    try {
        const { id, name, contacts, callDelay, maxConcurrent, scheduleTime } = req.body;

        // Check if there's already an active campaign
        const activeCampaigns = await redisService.getAllCampaigns();
        const runningCampaigns = activeCampaigns.filter(c => c.status === 'active');
        
        if (runningCampaigns.length > 0) {
            return res.status(400).json({ 
                error: 'A campaign is already in progress. Please stop it before starting a new one.' 
            });
        }

        // Initialize campaign
        const campaign = {
            id,
            name,
            totalContacts: contacts.length,
            callDelay: callDelay * 1000, // Convert to milliseconds
            maxConcurrent,
            scheduleTime,
            startTime: new Date().toISOString(),
            stats: {
                total: contacts.length,
                completed: 0,
                failed: 0,
                inProgress: 0,
                queued: contacts.length
            },
            status: 'active',
            currentBatch: 0,
            callResults: []
        };

        // Save campaign to Redis
        await redisService.saveCampaign(id, campaign);
        
        // Save contacts queue to Redis
        await redisService.saveCampaignQueue(id, contacts);

        // If scheduled, set up scheduled execution
        if (scheduleTime) {
            const scheduledDate = new Date(scheduleTime);
            const delay = scheduledDate.getTime() - Date.now();
            
            if (delay > 0) {
                campaign.status = 'scheduled';
                await redisService.updateCampaign(id, { status: 'scheduled' });
                
                setTimeout(() => {
                    executeCampaign(id);
                }, delay);
                
                logger.info(`Campaign ${id} scheduled for ${scheduleTime}`);
                return res.json({ 
                    message: 'Campaign scheduled successfully', 
                    campaign 
                });
            }
        }

        // Start campaign immediately
        executeCampaign(id);

        res.json({ 
            message: 'Campaign started successfully', 
            campaign 
        });

    } catch (error) {
        logger.error('Error starting campaign:', error);
        res.status(500).json({ error: 'Failed to start campaign' });
    }
};

// Execute campaign calls
async function executeCampaign(campaignId) {
    try {
        const campaign = await redisService.getCampaign(campaignId);
        if (!campaign || campaign.status !== 'active') return;

        const { maxConcurrent, callDelay } = campaign;

        // Process calls in batches
        const processBatch = async () => {
            try {
                // Check campaign status
                const currentCampaign = await redisService.getCampaign(campaignId);
                if (!currentCampaign || currentCampaign.status !== 'active') {
                    logger.info(`Campaign ${campaignId} is no longer active`);
                    return;
                }

                // Get queue length
                const queueLength = await redisService.getQueueLength(campaignId);
                
                if (queueLength === 0) {
                    // Campaign completed
                    await completeCampaign(campaignId);
                    return;
                }

                // Get next batch
                const batch = [];
                for (let i = 0; i < maxConcurrent && i < queueLength; i++) {
                    const contact = await redisService.getNextContact(campaignId);
                    if (contact) {
                        batch.push(contact);
                    }
                }

                if (batch.length === 0) {
                    // No more contacts
                    await completeCampaign(campaignId);
                    return;
                }

                // Update stats
                const updatedCampaign = await redisService.updateCampaign(campaignId, {
                    'stats.queued': await redisService.getQueueLength(campaignId),
                    'stats.inProgress': currentCampaign.stats.inProgress + batch.length,
                    currentBatch: currentCampaign.currentBatch + 1
                });

                // Broadcast update
                broadcastToClients({
                    type: 'campaign_update',
                    campaignId,
                    campaign: updatedCampaign
                });

                // Process batch calls
                const batchPromises = batch.map(contact => makeCall(campaignId, contact));
                
                await Promise.allSettled(batchPromises);

                // Schedule next batch
                setTimeout(processBatch, callDelay);
                
            } catch (error) {
                logger.error(`Error processing batch for campaign ${campaignId}:`, error);
                // Try again after delay
                setTimeout(processBatch, callDelay);
            }
        };

        // Update campaign status to active
        await redisService.updateCampaign(campaignId, { status: 'active' });
        
        // Start processing
        processBatch();
        
    } catch (error) {
        logger.error(`Error executing campaign ${campaignId}:`, error);
    }
}

// Make individual call
async function makeCall(campaignId, contact) {
    try {
        const campaign = await redisService.getCampaign(campaignId);
        if (!campaign) return;

        // Format phone number
        const validators = require('../utils/validators');
        const formattedPhone = validators.formatToE164(contact.phone_number);
        
        if (!formattedPhone) {
            throw new Error(`Invalid phone number format: ${contact.phone_number}`);
        }
        
        logger.info(`Calling ${contact.first_name} ${contact.last_name} at ${formattedPhone}`);
        
        // Create call via Vapi
        const callData = await vapiService.createCall({
            phone_number: formattedPhone,
            first_name: contact.first_name || '',
            last_name: contact.last_name || '',
            metadata: {
                campaignId,
                leadSource: contact.lead_source,
                caseType: contact.case_type,
                organizationId: contact.organizationid,
                leadId: contact.leadid
            }
        });

        // Store call result in Redis
        const callResult = {
            contactId: contact.leadid,
            callId: callData.id,
            status: 'initiated',
            startTime: new Date().toISOString()
        };
        
        await redisService.addCallToCampaign(campaignId, callData.id, callResult);

        // Add call to monitor
        const callMonitor = require('../services/callMonitor');
        callMonitor.addCall({
            ...callData,
            customer: {
                ...callData.customer,
                metadata: {
                    campaignId,
                    leadSource: contact.lead_source,
                    caseType: contact.case_type,
                    organizationId: contact.organizationid,
                    leadId: contact.leadid,
                    first_name: contact.first_name,
                    last_name: contact.last_name
                }
            },
            contact: {
                first_name: contact.first_name,
                last_name: contact.last_name,
                lead_source: contact.lead_source,
                case_type: contact.case_type,
                organizationid: contact.organizationid,
                leadid: contact.leadid
            }
        });

        // Broadcast new call
        broadcastToClients({
            type: 'call_initiated',
            campaignId,
            call: {
                ...callData,
                contact
            }
        });

        logger.info(`Call initiated for ${contact.first_name} ${contact.last_name}: ${callData.id}`);

    } catch (error) {
        logger.error(`Failed to call ${contact.phone_number}:`, error.message);
        
        // Update failed stats
        const campaign = await redisService.getCampaign(campaignId);
        if (campaign) {
            await redisService.updateCampaign(campaignId, {
                'stats.failed': campaign.stats.failed + 1,
                'stats.inProgress': Math.max(0, campaign.stats.inProgress - 1)
            });
        }
        
        broadcastToClients({
            type: 'call_failed',
            campaignId,
            contact,
            error: error.message
        });
    }
}

// Complete campaign
async function completeCampaign(campaignId) {
    try {
        const campaign = await redisService.getCampaign(campaignId);
        if (!campaign) return;

        const updatedCampaign = await redisService.updateCampaign(campaignId, {
            status: 'completed',
            endTime: new Date().toISOString()
        });

        broadcastToClients({
            type: 'campaign_completed',
            campaignId,
            campaign: updatedCampaign
        });

        logger.info(`Campaign ${campaignId} completed`);
        
    } catch (error) {
        logger.error(`Error completing campaign ${campaignId}:`, error);
    }
}

// Stop campaign
exports.stopCampaign = async (req, res) => {
    try {
        const activeCampaigns = await redisService.getAllCampaigns();
        const runningCampaign = activeCampaigns.find(c => c.status === 'active');
        
        if (!runningCampaign) {
            return res.status(400).json({ error: 'No active campaign to stop' });
        }

        const updatedCampaign = await redisService.updateCampaign(runningCampaign.id, {
            status: 'stopped',
            endTime: new Date().toISOString()
        });

        // Clear queue
        await redisService.deleteCampaign(runningCampaign.id);

        // Broadcast stop event
        broadcastToClients({
            type: 'campaign_stopped',
            campaignId: runningCampaign.id,
            campaign: updatedCampaign
        });

        logger.info(`Campaign ${runningCampaign.id} stopped`);

        res.json({ 
            message: 'Campaign stopped successfully',
            campaign: updatedCampaign
        });

    } catch (error) {
        logger.error('Error stopping campaign:', error);
        res.status(500).json({ error: 'Failed to stop campaign' });
    }
};

// Get campaign status
exports.getCampaignStatus = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const campaign = await redisService.getCampaign(campaignId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Get call results
        const calls = await redisService.getCampaignCalls(campaignId);
        campaign.callResults = Object.values(calls);

        res.json({ campaign });

    } catch (error) {
        logger.error('Error getting campaign status:', error);
        res.status(500).json({ error: 'Failed to get campaign status' });
    }
};

// Get all campaigns
exports.getAllCampaigns = async (req, res) => {
    try {
        const campaigns = await redisService.getAllCampaigns();
        res.json({ campaigns });

    } catch (error) {
        logger.error('Error getting campaigns:', error);
        res.status(500).json({ error: 'Failed to get campaigns' });
    }
};

// Upload CSV
exports.uploadCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const csvData = await csvProcessor.parseCSV(req.file.path);
        
        // Validate CSV structure
        const validation = csvProcessor.validateCSVStructure(csvData);
        if (!validation.valid) {
            return res.status(400).json({ 
                error: 'Invalid CSV structure',
                details: validation.errors 
            });
        }

        // Process and validate phone numbers
        const processedData = csvProcessor.processContacts(csvData);

        res.json({
            message: 'CSV uploaded and processed successfully',
            data: {
                total: processedData.length,
                valid: processedData.filter(c => c.phone_valid).length,
                invalid: processedData.filter(c => !c.phone_valid).length,
                preview: processedData.slice(0, 10)
            }
        });

    } catch (error) {
        logger.error('Error uploading CSV:', error);
        res.status(500).json({ error: 'Failed to process CSV file' });
    }
};

// Schedule campaign
exports.scheduleCampaign = async (req, res) => {
    try {
        const { campaignData, scheduleTime } = req.body;
        
        // Validate schedule time
        const scheduledDate = new Date(scheduleTime);
        if (scheduledDate <= new Date()) {
            return res.status(400).json({ error: 'Schedule time must be in the future' });
        }

        // Create scheduled campaign
        const campaign = {
            ...campaignData,
            status: 'scheduled',
            scheduleTime
        };

        await redisService.saveCampaign(campaign.id, campaign);

        // Set up scheduled execution
        const delay = scheduledDate.getTime() - Date.now();
        setTimeout(() => {
            executeCampaign(campaign.id);
        }, delay);

        res.json({
            message: 'Campaign scheduled successfully',
            campaign
        });

    } catch (error) {
        logger.error('Error scheduling campaign:', error);
        res.status(500).json({ error: 'Failed to schedule campaign' });
    }
};

// Update call status (called from webhook)
exports.updateCallStatus = async (callId, status, details) => {
    try {
        // Find campaign containing this call
        const campaigns = await redisService.getAllCampaigns();
        
        for (const campaign of campaigns) {
            const calls = await redisService.getCampaignCalls(campaign.id);
            
            if (calls[callId]) {
                // Update call result
                calls[callId].status = status;
                calls[callId].endTime = new Date().toISOString();
                
                if (details) {
                    calls[callId].details = details;
                }
                
                await redisService.addCallToCampaign(campaign.id, callId, calls[callId]);

                // Update campaign stats
                const updatedStats = { ...campaign.stats };
                
                if (status === 'completed') {
                    updatedStats.completed++;
                    updatedStats.inProgress = Math.max(0, updatedStats.inProgress - 1);
                } else if (status === 'failed' || status === 'no-answer' || status === 'busy') {
                    updatedStats.failed++;
                    updatedStats.inProgress = Math.max(0, updatedStats.inProgress - 1);
                }

                await redisService.updateCampaign(campaign.id, { stats: updatedStats });

                // Broadcast update
                broadcastToClients({
                    type: 'campaign_update',
                    campaignId: campaign.id,
                    campaign: await redisService.getCampaign(campaign.id)
                });

                break;
            }
        }
    } catch (error) {
        logger.error(`Error updating call status for ${callId}:`, error);
    }
};