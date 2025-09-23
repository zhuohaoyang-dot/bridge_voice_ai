const express = require('express');
const router = express.Router();
const callController = require('../controllers/callController');

// Create a new call
router.post('/create', callController.createCall);

// Control an active call (mute, unmute, etc.)
router.post('/:callId/control', callController.controlCall);

// Transfer a call
router.post('/:callId/transfer', callController.transferCall);

// Get active calls
router.get('/active', callController.getActiveCalls);

// End a call
router.post('/:callId/end', callController.endCall);

// Get call details
router.get('/:callId', callController.getCallDetails);

// Update call status
router.patch('/:callId/status', callController.updateCallStatus);

// Listener tracking endpoints
router.post('/:callId/add-listener', callController.addListener);
router.post('/:callId/remove-listener', callController.removeListener);

// DEBUG ENDPOINTS - For monitoring and debugging the call system
router.get('/debug/info', callController.getDebugInfo);
router.delete('/debug/phone/:phoneNumber', callController.cleanupPhoneNumber);
router.post('/debug/cleanup-phone-tracking', callController.forceCleanupPhoneTracking);
router.post('/debug/:callId/force-answered', callController.forceCallAnswered);

module.exports = router;