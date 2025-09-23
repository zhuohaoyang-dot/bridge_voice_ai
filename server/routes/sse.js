const express = require('express');
const router = express.Router();
const redisService = require('../services/redisService');
const logger = require('../utils/logger');

// Store SSE connections
const connections = new Map();

// SSE endpoint for real-time updates
router.get('/events', (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const clientId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    // Store connection
    connections.set(clientId, res);
    
    // Send initial connection event
    res.write(`data: ${JSON.stringify({
        type: 'connected',
        clientId: clientId,
        timestamp: new Date().toISOString()
    })}\n\n`);

    logger.info(`SSE client connected: ${clientId}`);

    // Handle client disconnect
    req.on('close', () => {
        connections.delete(clientId);
        logger.info(`SSE client disconnected: ${clientId}`);
    });

    req.on('error', (error) => {
        logger.error(`SSE client error for ${clientId}:`, error);
        connections.delete(clientId);
    });
});

// Function to broadcast to all SSE clients
function broadcastToClients(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    
    for (const [clientId, res] of connections) {
        try {
            res.write(message);
        } catch (error) {
            logger.error(`Error sending SSE message to client ${clientId}:`, error);
            connections.delete(clientId);
        }
    }
}

// Endpoint to get current active campaigns (replaces WebSocket polling)
router.get('/campaigns/active', async (req, res) => {
    try {
        const campaigns = await redisService.getActiveCampaigns();
        res.json({
            success: true,
            campaigns: campaigns || []
        });
    } catch (error) {
        logger.error('Error fetching active campaigns:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch active campaigns'
        });
    }
});

// Endpoint to get current live calls (replaces WebSocket polling)
router.get('/calls/live', async (req, res) => {
    try {
        const liveCalls = await redisService.getLiveCalls();
        res.json({
            success: true,
            calls: liveCalls || []
        });
    } catch (error) {
        logger.error('Error fetching live calls:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch live calls'
        });
    }
});

// Endpoint to get call details (replaces WebSocket call info)
router.get('/calls/:callId', async (req, res) => {
    try {
        const { callId } = req.params;
        const callDetails = await redisService.getCallDetails(callId);
        
        if (!callDetails) {
            return res.status(404).json({
                success: false,
                error: 'Call not found'
            });
        }

        res.json({
            success: true,
            call: callDetails
        });
    } catch (error) {
        logger.error(`Error fetching call details for ${req.params.callId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch call details'
        });
    }
});

// Function to send real-time updates (called from webhook handlers)
function sendRealtimeUpdate(type, data) {
    const update = {
        type,
        data,
        timestamp: new Date().toISOString()
    };
    
    broadcastToClients(update);
    logger.debug(`Sent SSE update: ${type}`, data);
}

// Export the router and utility functions
module.exports = {
    router,
    sendRealtimeUpdate,
    broadcastToClients
}; 