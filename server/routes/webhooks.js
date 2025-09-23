const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const logger = require('../utils/logger');

// Log all webhook requests
router.use((req, res, next) => {
    logger.info(`Webhook received: ${req.method} ${req.path}`, {
        headers: req.headers,
        body: req.body
    });
    next();
});

// Main Vapi webhook endpoint
router.post('/vapi', webhookController.handleVapiWebhook);

// Alternative webhook endpoints (in case Vapi sends to different paths)
router.post('/', webhookController.handleVapiWebhook);
router.post('/call-status', webhookController.handleVapiWebhook);
router.post('/transcript', webhookController.handleVapiWebhook);

// Health check for webhook
router.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        endpoint: 'webhook',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;