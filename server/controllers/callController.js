const vapiService = require('../services/vapiService');
const callMonitor = require('../services/callMonitor');
const { broadcastToClients } = require('../websocket');
const logger = require('../utils/logger');
const { formatToE164 } = require('../utils/validators');

// Track active calls by phone number to prevent duplicates
const activeCallsByPhone = new Map();

// Create a new call with deduplication
exports.createCall = async (req, res) => {
    try {
        const { phone_number, first_name, last_name, metadata } = req.body;
        
        // Validate assistant selection
        const assistantType = metadata?.assistantType;
        if (!assistantType) {
            return res.status(400).json({ 
                error: 'Please select an assistant',
                message: 'An AI assistant must be selected before making a call'
            });
        }
        
        // Validate phone number
        const formattedPhone = formatToE164(phone_number);
        if (!formattedPhone) {
            return res.status(400).json({ 
                error: 'Invalid phone number format' 
            });
        }
        
        // DEDUPLICATION CHECK - Prevent multiple calls to same number
        const existingCall = activeCallsByPhone.get(formattedPhone);
        if (existingCall) {
            const call = callMonitor.getCall(existingCall.callId);
            if (call && ['queued', 'ringing', 'in-progress'].includes(call.status)) {
                logger.warn(`Duplicate call attempt blocked for ${formattedPhone}. Existing call: ${existingCall.callId}`);
                return res.status(409).json({ 
                    error: 'Call already active to this number',
                    existingCallId: existingCall.callId,
                    existingCallStatus: call.status,
                    message: `A call is already ${call.status} for ${formattedPhone}. Please wait for the current call to complete.`
                });
            } else {
                // Remove stale entry if call is no longer active
                activeCallsByPhone.delete(formattedPhone);
            }
        }
        
        // Extract Convoso lead_id from metadata
        const convosoLeadId = metadata?.convoso_id || metadata?.lead_id || metadata?.convosoId || null;
        const bridgeLegalId = metadata?.leadId || metadata?.bridgeLegalId || null;
        const organizationId = metadata?.organizationId || "1"; // Default to "1" if not provided
        
        logger.info(`Creating call for ${first_name} ${last_name} at ${formattedPhone}`);
        logger.info('Call metadata:', JSON.stringify(metadata, null, 2));
        logger.info(`Convoso Lead ID: ${convosoLeadId}, Bridge Legal ID: ${bridgeLegalId}, Organization ID: ${organizationId}`);
        
        // Create call via Vapi with all metadata including Convoso lead_id
        const callData = await vapiService.createCall({
            phone_number: formattedPhone,
            first_name: first_name || '',
            last_name: last_name || '',
            lead_source: metadata?.source,
            case_type: metadata?.leadType,
            organizationid: organizationId, // Organization ID (should be "1")
            leadid: bridgeLegalId, // Pass Bridge Legal ID as leadid for VAPI assistant
            convoso_id: convosoLeadId, // Convoso ID for callback status
            metadata: {
                ...metadata,
                lead_id: convosoLeadId, // Convoso ID for callbacks
                convoso_id: convosoLeadId,
                bridge_legal_id: bridgeLegalId, // Bridge Legal ID
                organization_id: organizationId
            }
        });
        
        // Track this call by phone number for deduplication
        activeCallsByPhone.set(formattedPhone, {
            callId: callData.id,
            createdAt: new Date().toISOString(),
            customer: { first_name, last_name, phone: formattedPhone },
            convosoLeadId: convosoLeadId
        });
        
        // Add call to monitor with enhanced data and extended monitoring
        callMonitor.addCall({
            ...callData,
            customer: {
                ...callData.customer,
                name: `${first_name} ${last_name}`.trim(),
                metadata: {
                    ...metadata,
                    first_name,
                    last_name,
                    leadSource: metadata?.source,
                    caseType: metadata?.leadType,
                    organizationId: organizationId, // Organization ID ("1")
                    leadId: bridgeLegalId, // Bridge Legal ID for assistant
                    lead_id: convosoLeadId, // Convoso ID
                    convoso_id: convosoLeadId,
                    bridge_legal_id: bridgeLegalId
                }
            },
            contact: {
                first_name,
                last_name,
                lead_source: metadata?.source,
                case_type: metadata?.leadType,
                organizationid: organizationId, // Organization ID ("1")
                leadid: bridgeLegalId, // Bridge Legal ID
                convoso_id: convosoLeadId
            },
            // Extended monitoring for debugging
            extendedMonitoring: true,
            debugMode: process.env.NODE_ENV === 'development'
        });
        
        // Broadcast new call event with Convoso ID
        broadcastToClients({
            type: 'call_created',
            call: {
                ...callData,
                customer: {
                    ...callData.customer,
                    name: `${first_name} ${last_name}`.trim(),
                    metadata: {
                        ...metadata,
                        first_name,
                        last_name,
                        firstName: first_name,
                        lastName: last_name,
                        fullName: `${first_name} ${last_name}`.trim(),
                        leadSource: metadata?.source || 'Direct',
                        caseType: metadata?.leadType,
                        organizationId: organizationId, // Organization ID ("1")
                        leadId: bridgeLegalId, // Bridge Legal ID
                        lead_id: convosoLeadId, // Convoso ID
                        convoso_id: convosoLeadId,
                        bridge_legal_id: bridgeLegalId
                    }
                },
                metadata: {
                    ...metadata,
                    firstName: first_name,
                    lastName: last_name,
                    fullName: `${first_name} ${last_name}`.trim(),
                    leadSource: metadata?.source || 'Direct',
                    caseType: metadata?.leadType,
                    lead_id: convosoLeadId,
                    convoso_id: convosoLeadId,
                    bridge_legal_id: bridgeLegalId
                },
                contact: {
                    first_name,
                    last_name,
                    lead_source: metadata?.source,
                    case_type: metadata?.leadType,
                    organizationid: organizationId, // Organization ID ("1")
                    leadid: bridgeLegalId, // Bridge Legal ID
                    convoso_id: convosoLeadId
                },
                activeCallsByPhone: activeCallsByPhone.size // For debugging
            }
        });
        
        logger.info(`Call created successfully: ${callData.id} for ${formattedPhone}`);
        logger.info(`Active calls by phone: ${activeCallsByPhone.size}`);
        logger.info(`IDs passed to VAPI - Bridge Legal ID (leadId): ${bridgeLegalId}, Convoso ID: ${convosoLeadId}, Organization ID: ${organizationId}`);
        
        res.json({
            success: true,
            call: callData,
            deduplicationInfo: {
                phoneNumber: formattedPhone,
                activeCallsCount: activeCallsByPhone.size
            },
            leadIds: {
                convoso_id: convosoLeadId,
                bridge_legal_id: bridgeLegalId
            }
        });
        
    } catch (error) {
        logger.error('Error creating call:', error);
        
        // Clean up phone tracking on error
        if (formattedPhone && activeCallsByPhone.has(formattedPhone)) {
            activeCallsByPhone.delete(formattedPhone);
        }
        
        if (error.response?.data) {
            return res.status(error.response.status || 500).json({
                error: 'Failed to create call',
                details: error.response.data
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to create call',
            message: error.message 
        });
    }
};

// Clean up phone tracking when calls end
exports.cleanupPhoneTracking = (callId, phoneNumber) => {
    if (phoneNumber && activeCallsByPhone.has(phoneNumber)) {
        const tracked = activeCallsByPhone.get(phoneNumber);
        if (tracked && tracked.callId === callId) {
            activeCallsByPhone.delete(phoneNumber);
            logger.info(`Cleaned up phone tracking for ${phoneNumber}, call ${callId}`);
        }
    }
};

// Get active calls by phone (for debugging)
exports.getActiveCallsByPhone = () => {
    return Array.from(activeCallsByPhone.entries()).map(([phone, data]) => ({
        phone,
        callId: data.callId,
        createdAt: data.createdAt,
        customer: data.customer,
        convosoLeadId: data.convosoLeadId
    }));
};

// ... rest of the controller methods remain the same ...

// Control an active call (mute, unmute, say message, etc.) - UPDATED for VAPI Direct Control API
exports.controlCall = async (req, res) => {
    try {
        const { callId } = req.params;
        const { action, data } = req.body;
        
        const call = callMonitor.getCall(callId);
        if (!call || !call.monitor?.controlUrl) {
            return res.status(404).json({ 
                error: 'Call not found or not controllable' 
            });
        }
        
        logger.info(`Controlling call ${callId}: ${action}`);
        
        let controlPayload;
        switch (action) {
            case 'mute':
                controlPayload = { 
                    type: 'control',
                    control: 'mute-assistant' 
                };
                break;
                
            case 'unmute':
                controlPayload = { 
                    type: 'control',
                    control: 'unmute-assistant' 
                };
                break;
                
            case 'say':
                controlPayload = {
                    type: 'say',
                    content: data.message,
                    endCallAfterSpoken: data.endCallAfterSpoken || false
                };
                break;
                
            default:
                return res.status(400).json({ 
                    error: 'Invalid action. Supported: mute, unmute, say' 
                });
        }
        
        const result = await vapiService.controlCall(callId, {
            controlUrl: call.monitor.controlUrl,
            action: controlPayload
        });
        
        // Update call state
        if (action === 'mute') {
            callMonitor.updateCall(callId, { assistantMuted: true });
        } else if (action === 'unmute') {
            callMonitor.updateCall(callId, { assistantMuted: false });
        }
        
        // Broadcast control event
        broadcastToClients({
            type: 'call_control',
            callId,
            action,
            data,
            controlType: controlPayload.type
        });
        
        res.json({
            success: true,
            action,
            controlType: controlPayload.type,
            result
        });
        
    } catch (error) {
        logger.error('Error controlling call:', error);
        res.status(500).json({ 
            error: 'Failed to control call',
            message: error.message,
            details: error.response?.data || 'Control API call failed'
        });
    }
};

// Transfer a call - UPDATED to use VAPI Direct Control API
exports.transferCall = async (req, res) => {
    try {
        const { callId } = req.params;
        const { destination, message } = req.body;
        
        const call = callMonitor.getCall(callId);
        if (!call || !call.monitor?.controlUrl) {
            return res.status(404).json({ 
                error: 'Call not found or not controllable' 
            });
        }
        
        // Validate and format the destination
        let transferNumber;
        let transferMessage = message || 'Transferring your call now.';
        
        if (typeof destination === 'string') {
            transferNumber = destination;
        } else if (destination && destination.number) {
            transferNumber = destination.number;
            transferMessage = destination.message || transferMessage;
        } else {
            return res.status(400).json({
                error: 'Invalid transfer destination. Please provide a phone number.'
            });
        }
        
        // Format to E.164 if needed
        const formattedDestination = formatToE164(transferNumber);
        if (!formattedDestination) {
            return res.status(400).json({
                error: 'Invalid phone number format for transfer destination.'
            });
        }
        
        logger.info(`Initiating Direct Control API transfer for call ${callId} to ${formattedDestination}`);
        
        // Use VAPI Direct Control API transfer format
        const transferPayload = {
            type: 'transfer',
            destination: {
                type: 'number',
                number: formattedDestination
            },
            content: transferMessage
        };
        
        const result = await vapiService.controlCall(callId, {
            controlUrl: call.monitor.controlUrl,
            action: transferPayload
        });
        
        // Update call state
        callMonitor.updateCall(callId, { 
            status: 'transferring',
            transferMethod: 'direct_control_api',
            transferInitiated: true,
            transferDestination: formattedDestination,
            transferMessage: transferMessage,
            transferredAt: new Date().toISOString()
        });
        
        // Broadcast transfer event
        broadcastToClients({
            type: 'call_transfer_initiated',
            callId,
            method: 'direct_control_api',
            destination: formattedDestination,
            message: transferMessage
        });
        
        res.json({
            success: true,
            message: 'Transfer initiated via VAPI Direct Control API',
            destination: formattedDestination,
            method: 'direct_control_api',
            transferMessage: transferMessage
        });
        
    } catch (error) {
        logger.error('Error initiating Direct Control API transfer:', error);
        res.status(500).json({ 
            error: 'Failed to initiate transfer',
            message: error.message,
            details: error.response?.data || 'Direct Control API transfer failed'
        });
    }
};

// End a call - UPDATED for VAPI Direct Control API
exports.endCall = async (req, res) => {
    try {
        const { callId } = req.params;
        
        const call = callMonitor.getCall(callId);
        if (!call) {
            return res.status(404).json({ 
                error: 'Call not found or already ended' 
            });
        }
        
        logger.info(`Ending call ${callId} via Direct Control API`);
        
        // Update call state immediately (optimistic update)
        callMonitor.updateCall(callId, { 
            status: 'ending',
            endingMethod: 'direct_control_api',
            endingAt: new Date().toISOString()
        });
        
        // Broadcast ending event immediately
        broadcastToClients({
            type: 'call_ending',
            callId,
            endedBy: 'user',
            method: 'direct_control_api'
        });
        
        // Try to end call via VAPI Direct Control API if control URL exists
        if (call.monitor?.controlUrl) {
            try {
                const endCallPayload = {
                    type: 'end-call'
                };
                
                await vapiService.controlCall(callId, {
                    controlUrl: call.monitor.controlUrl,
                    action: endCallPayload
                });
                
                logger.info(`Call ${callId} ended via VAPI Direct Control API`);
            } catch (controlError) {
                // Log but don't fail - the call might already be ended
                logger.warn(`Failed to end call via Direct Control API: ${controlError.message}`);
            }
        }
        
        // Final update
        callMonitor.updateCall(callId, { 
            status: 'ended',
            endedAt: new Date().toISOString(),
            endedBy: 'user',
            endMethod: 'direct_control_api'
        });
        
        // Broadcast final end event
        broadcastToClients({
            type: 'call_ended',
            callId,
            endedBy: 'user',
            method: 'direct_control_api'
        });
        
        // Remove from monitor after a delay
        setTimeout(() => {
            callMonitor.removeCall(callId);
        }, 5000);
        
        res.json({
            success: true,
            message: 'Call ended successfully via Direct Control API',
            method: 'direct_control_api'
        });
        
    } catch (error) {
        logger.error('Error ending call via Direct Control API:', error);
        res.status(500).json({ 
            error: 'Failed to end call',
            message: error.message,
            details: error.response?.data || 'Direct Control API end call failed'
        });
    }
};

// Get call details
exports.getCall = async (req, res) => {
    try {
        const { callId } = req.params;
        
        // First check local monitor
        let call = callMonitor.getCall(callId);
        
        if (!call) {
            // Try to fetch from Vapi
            call = await vapiService.getCall(callId);
        }
        
        if (!call) {
            return res.status(404).json({ 
                error: 'Call not found' 
            });
        }
        
        res.json({
            success: true,
            call
        });
        
    } catch (error) {
        logger.error('Error getting call:', error);
        res.status(500).json({ 
            error: 'Failed to get call details',
            message: error.message 
        });
    }
};

// Get call details - ALIAS for getCall to match route naming
exports.getCallDetails = exports.getCall;

// Update call status - NEW FUNCTION
exports.updateCallStatus = async (req, res) => {
    try {
        const { callId } = req.params;
        const { status, metadata } = req.body;
        
        if (!callId) {
            return res.status(400).json({
                error: 'Call ID is required'
            });
        }
        
        if (!status) {
            return res.status(400).json({
                error: 'Status is required'
            });
        }
        
        const call = callMonitor.getCall(callId);
        if (!call) {
            return res.status(404).json({
                error: 'Call not found'
            });
        }
        
        logger.info(`Updating call ${callId} status to ${status}`);
        
        // Update call status
        const updates = {
            status,
            updatedAt: new Date().toISOString(),
            ...metadata
        };
        
        callMonitor.updateCall(callId, updates);
        
        // Broadcast status update
        broadcastToClients({
            type: 'call_status_updated',
            callId,
            status,
            updates
        });
        
        const updatedCall = callMonitor.getCall(callId);
        
        res.json({
            success: true,
            call: updatedCall,
            message: `Call status updated to ${status}`
        });
        
    } catch (error) {
        logger.error('Error updating call status:', error);
        res.status(500).json({
            error: 'Failed to update call status',
            message: error.message
        });
    }
};

// Get all active calls
exports.getActiveCalls = async (req, res) => {
    try {
        const activeCalls = Array.from(callMonitor.getActiveCalls().values());
        
        res.json({
            success: true,
            calls: activeCalls,
            count: activeCalls.length
        });
        
    } catch (error) {
        logger.error('Error getting active calls:', error);
        res.status(500).json({ 
            error: 'Failed to get active calls',
            message: error.message 
        });
    }
};

// Get debug information about call system - UPDATED to include Convoso IDs
exports.getDebugInfo = async (req, res) => {
    try {
        const callMonitor = require('../services/callMonitor');
        
        const debugInfo = {
            timestamp: new Date().toISOString(),
            activeCallsByPhone: Array.from(activeCallsByPhone.entries()).map(([phone, data]) => ({
                phone,
                callId: data.callId,
                createdAt: data.createdAt,
                customer: data.customer,
                convosoLeadId: data.convosoLeadId
            })),
            callMonitorStats: callMonitor.getCallStats(),
            activeCalls: Array.from(callMonitor.getActiveCalls().entries()).map(([callId, call]) => ({
                callId,
                status: call.status,
                phone: call.customer?.number,
                addedAt: call.addedAt,
                answeredAt: call.answeredAt,
                endedAt: call.endedAt,
                duration: call.duration,
                statusHistory: call.statusHistory,
                extendedMonitoring: call.extendedMonitoring,
                hasAudioStream: !!call.monitor?.listenUrl,
                convosoLeadId: call.customer?.metadata?.lead_id || call.customer?.metadata?.convoso_id,
                bridgeLegalId: call.customer?.metadata?.organizationId || call.customer?.metadata?.bridge_legal_id
            })),
            environment: {
                nodeEnv: process.env.NODE_ENV,
                developmentMode: process.env.NODE_ENV === 'development'
            }
        };
        
        logger.info('Debug info requested', {
            totalActiveCalls: debugInfo.activeCalls.length,
            totalPhoneTracking: debugInfo.activeCallsByPhone.length,
            audioStreamsActive: debugInfo.callMonitorStats.audioStreamsActive
        });
        
        res.json(debugInfo);
    } catch (error) {
        logger.error('Error getting debug info:', error);
        res.status(500).json({
            error: 'Failed to get debug info',
            message: error.message
        });
    }
};

// Manually clean up a phone number from tracking - NEW ENDPOINT
exports.cleanupPhoneNumber = async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        
        if (!phoneNumber) {
            return res.status(400).json({
                error: 'Phone number is required'
            });
        }
        
        const existingCall = activeCallsByPhone.get(phoneNumber);
        if (existingCall) {
            activeCallsByPhone.delete(phoneNumber);
            logger.info(`Manually cleaned up phone tracking for ${phoneNumber}, call ${existingCall.callId}`);
            
            res.json({
                success: true,
                message: `Cleaned up tracking for ${phoneNumber}`,
                removedCall: existingCall
            });
        } else {
            res.json({
                success: true,
                message: `No active tracking found for ${phoneNumber}`
            });
        }
    } catch (error) {
        logger.error('Error cleaning up phone number:', error);
        res.status(500).json({
            error: 'Failed to cleanup phone number',
            message: error.message
        });
    }
};

// Force cleanup all stale phone tracking - NEW ENDPOINT
exports.forceCleanupPhoneTracking = async (req, res) => {
    try {
        const callMonitor = require('../services/callMonitor');
        const cleaned = [];
        
        // Check each tracked phone number
        for (const [phone, data] of activeCallsByPhone.entries()) {
            const call = callMonitor.getCall(data.callId);
            
            // Remove if call doesn't exist or is ended/failed
            if (!call || ['ended', 'failed'].includes(call.status)) {
                activeCallsByPhone.delete(phone);
                cleaned.push({
                    phone,
                    callId: data.callId,
                    reason: !call ? 'call_not_found' : `call_${call.status}`
                });
            }
        }
        
        logger.info(`Force cleanup completed: removed ${cleaned.length} stale phone tracking entries`);
        
        res.json({
            success: true,
            message: `Cleaned up ${cleaned.length} stale phone tracking entries`,
            cleaned,
            remaining: activeCallsByPhone.size
        });
    } catch (error) {
        logger.error('Error in force cleanup:', error);
        res.status(500).json({
            error: 'Failed to force cleanup',
            message: error.message
        });
    }
};

// Add listener tracking
exports.addListener = async (req, res) => {
    try {
        const { callId } = req.params;
        
        const call = callMonitor.getCall(callId);
        if (!call) {
            return res.status(404).json({ 
                error: 'Call not found in monitor' 
            });
        }
        
        callMonitor.addListener(callId);
        
        res.json({
            success: true,
            message: `Listener added to call ${callId}`,
            listenerCount: call.listenerCount || 1
        });
        
    } catch (error) {
        logger.error('Error adding listener:', error);
        res.status(500).json({
            error: 'Failed to add listener',
            message: error.message
        });
    }
};

exports.removeListener = async (req, res) => {
    try {
        const { callId } = req.params;
        
        const call = callMonitor.getCall(callId);
        if (!call) {
            return res.status(404).json({ 
                error: 'Call not found in monitor' 
            });
        }
        
        callMonitor.removeListener(callId);
        
        res.json({
            success: true,
            message: `Listener removed from call ${callId}`,
            listenerCount: call.listenerCount || 0
        });
        
    } catch (error) {
        logger.error('Error removing listener:', error);
        res.status(500).json({
            error: 'Failed to remove listener',
            message: error.message
        });
    }
};

// DEBUG: Force a call to be marked as answered - for testing when status detection fails
exports.forceCallAnswered = async (req, res) => {
    try {
        const { callId } = req.params;
        
        const call = callMonitor.getCall(callId);
        if (!call) {
            return res.status(404).json({ 
                error: 'Call not found in monitor' 
            });
        }
        
        logger.warn(`🔧 DEBUG: Force marking call ${callId} as answered`);
        logger.warn(`Previous status: ${call.status}`);
        
        // Force update the call status
        callMonitor.updateCall(callId, {
            status: 'in-progress',
            answeredAt: new Date().toISOString(),
            forceAnswered: true
        });
        
        // Broadcast the status change
        broadcastToClients({
            type: 'call_answered',
            call: {
                ...call,
                status: 'in-progress',
                answeredAt: new Date().toISOString(),
                forceAnswered: true
            }
        });
        
        logger.warn(`✅ DEBUG: Call ${callId} forced to answered status`);
        
        res.json({
            success: true,
            message: `Call ${callId} forced to answered status`,
            call: {
                id: callId,
                status: 'in-progress',
                answeredAt: new Date().toISOString(),
                forceAnswered: true
            }
        });
        
    } catch (error) {
        logger.error('Error force-answering call:', error);
        res.status(500).json({
            error: 'Failed to force answer call',
            message: error.message
        });
    }
};