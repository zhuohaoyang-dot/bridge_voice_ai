const WebSocket = require('ws');
const logger = require('./utils/logger');
const callMonitor = require('./services/callMonitor');

let wss = null;
const clients = new Map();

function initializeWebSocketServer() {
    // Main WebSocket server for real-time updates
    wss = new WebSocket.Server({ 
        port: process.env.WS_PORT || 8010
    });
    
    logger.info(`WebSocket server listening on port ${process.env.WS_PORT || 8010}`);
    
    // Handle main WebSocket connections
    wss.on('connection', (ws, req) => {
        const clientId = generateClientId();
        clients.set(clientId, ws);
        
        logger.info(`Client ${clientId} connected. Total clients: ${clients.size}`);
        
        // Send connection confirmation
        ws.send(JSON.stringify({
            type: 'connection',
            message: 'Connected to Bridge Legal Call System',
            clientId: clientId
        }));
        
        // Send current active calls
        const activeCalls = Array.from(callMonitor.getActiveCalls().values());
        ws.send(JSON.stringify({
            type: 'active_calls',
            calls: activeCalls
        }));
        
        // Handle incoming messages
        ws.on('message', (message) => {
            handleWebSocketMessage(clientId, message);
        });
        
        // Handle client disconnect
        ws.on('close', () => {
            clients.delete(clientId);
            logger.info(`Client ${clientId} disconnected. Total clients: ${clients.size}`);
        });
        
        ws.on('error', (error) => {
            logger.error(`WebSocket error for client ${clientId}:`, error);
        });
    });
    
    // Handle server errors
    wss.on('error', (error) => {
        logger.error('WebSocket server error:', error);
    });
}

// Generate unique client ID
function generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(clientId, message) {
    try {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'subscribe_call':
                logger.info(`Client ${clientId} subscribing to call ${data.callId}`);
                // Could implement call-specific subscriptions here
                break;
                
            case 'unsubscribe_call':
                logger.info(`Client ${clientId} unsubscribing from call ${data.callId}`);
                break;
                
            case 'subscribe_campaign':
                logger.info(`Client ${clientId} subscribing to campaign ${data.campaignId}`);
                break;
                
            case 'get_active_calls':
                const ws = clients.get(clientId);
                if (ws) {
                    const activeCalls = Array.from(callMonitor.getActiveCalls().values());
                    ws.send(JSON.stringify({
                        type: 'active_calls',
                        calls: activeCalls
                    }));
                }
                break;
                
            default:
                logger.warn(`Unknown message type from client ${clientId}: ${data.type}`);
        }
        
    } catch (error) {
        logger.error(`Error parsing WebSocket message from client ${clientId}:`, error);
    }
}

// Broadcast message to all connected clients
function broadcastToClients(data) {
    const message = JSON.stringify(data);
    
    clients.forEach((ws, clientId) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
    
    logger.debug(`Broadcasted ${data.type} to ${clients.size} clients`);
}

// Send message to specific client
function sendToClient(clientId, data) {
    const ws = clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Get connected clients count
function getClientCount() {
    return clients.size;
}

module.exports = {
    initializeWebSocketServer,
    broadcastToClients,
    sendToClient,
    getClientCount
};