// server/routes/conference.js
const express = require('express');
const router = express.Router();
const ConferenceController = require('../controllers/conferenceController');

// Validation middleware (optional - you can add your validators)
const validateConferenceCreate = (req, res, next) => {
  const { customerId, customerPhone } = req.body;
  if (!customerId || !customerPhone) {
    return res.status(400).json({
      success: false,
      error: 'customerId and customerPhone are required'
    });
  }
  next();
};

const validateAgentAdd = (req, res, next) => {
  const { conferenceId, agentPhone, agentName } = req.body;
  if (!conferenceId || !agentPhone || !agentName) {
    return res.status(400).json({
      success: false,
      error: 'conferenceId, agentPhone, and agentName are required'
    });
  }
  next();
};

// Create new conference bridge
router.post('/create', validateConferenceCreate, ConferenceController.createConference);

// Add agent to conference
router.post('/add-agent', validateAgentAdd, ConferenceController.addAgentToConference);

// Get conference status
router.get('/status/:conferenceId', ConferenceController.getConferenceStatus);

// End conference
router.post('/end/:conferenceId', ConferenceController.endConference);

// Twilio webhook endpoint
router.post('/webhook/twilio', ConferenceController.handleTwilioWebhook);

// Test endpoint
router.post('/test', ConferenceController.testConferenceFlow);

// Health check for conference system
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'conference',
    timestamp: new Date().toISOString(),
    config: {
      holdAssistantConfigured: !!process.env.VAPI_HOLD_ASSISTANT_ID,
      twilioConfigured: !!process.env.TWILIO_ACCOUNT_SID,
      redisConnected: true // You can add actual Redis connection check
    }
  });
});

module.exports = router;