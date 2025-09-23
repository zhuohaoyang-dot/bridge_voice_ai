const crypto = require('crypto');
const callMonitor = require('../services/callMonitor');
const campaignController = require('./campaignController');
const { broadcastToClients } = require('../websocket');
const { sendRealtimeUpdate } = require('../routes/sse');
const logger = require('../utils/logger');
const vapiConfig = require('../config/vapi.config');

// Universal broadcast function that works with both WebSocket and SSE
function universalBroadcast(data) {
    // Try WebSocket first (for development)
    try {
        broadcastToClients(data);
    } catch (error) {
        logger.debug('WebSocket broadcast failed (normal in production):', error.message);
    }
    
    // Always send SSE update
    try {
        sendRealtimeUpdate(data.type, data);
    } catch (error) {
        logger.error('SSE broadcast failed:', error);
    }
}

// Validate webhook signature
function validateWebhookSignature(req) {
    // Check if webhook validation is disabled for development
    if (process.env.DISABLE_WEBHOOK_VALIDATION === 'true') {
        logger.warn('Webhook validation disabled - accepting all webhooks');
        return true;
    }
    
    const signature = req.headers['x-vapi-signature'];
    const webhookSecret = vapiConfig.webhookSecret;
    
    // If no webhook secret is configured, log warning but allow
    if (!webhookSecret) {
        logger.warn('No webhook secret configured - accepting webhook without validation');
        return true;
    }
    
    if (!signature) {
        logger.warn('No signature provided in webhook request');
        return false;
    }
    
    try {
        // Vapi uses HMAC-SHA256 for webhook signatures
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(req.rawBody || JSON.stringify(req.body))
            .digest('hex');
        
        // Use timing-safe comparison to prevent timing attacks
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch (error) {
        logger.error('Error validating webhook signature:', error);
        return false;
    }
}

// Handle Vapi webhooks - ENHANCED for better call status detection
exports.handleVapiWebhook = async (req, res) => {
    try {
        // Validate webhook signature
        if (!validateWebhookSignature(req)) {
            logger.warn('Invalid webhook signature received');
            return res.status(401).json({ error: 'Invalid signature' });
        }
        
        // Log the webhook payload for debugging - ENHANCED LOGGING
        logger.info('=== VAPI WEBHOOK RECEIVED ===');
        logger.info('Headers:', JSON.stringify(req.headers, null, 2));
        logger.info('Raw Body:', req.rawBody ? req.rawBody.substring(0, 1000) : 'No raw body');
        logger.info('Parsed Body:', JSON.stringify(req.body, null, 2));
        
        // Extract data from webhook - handle both nested and flat structures
        const webhookData = req.body.message || req.body;
        const { type } = webhookData;
        
        logger.info('Webhook Type:', type);
        logger.info('Call ID:', webhookData.call?.id || 'No call ID');
        
        // ENHANCED: Log call status if available
        if (webhookData.call?.status) {
            logger.info(`🔄 Call Status in Webhook: ${webhookData.call.status}`);
        }
        
        // Handle different webhook types based on Vapi's actual format
        switch (type) {
            case 'speech-update':
                if (webhookData.transcript) {
                    handleSpeechUpdate(webhookData.call, webhookData.transcript);
                }
                break;
                
            case 'transcript':
                // Handle both partial and final transcripts
                if (webhookData.transcript || webhookData.transcriptType) {
                    handleTranscriptEvent(webhookData);
                }
                break;
                
            case 'status-update':
                // ENHANCED: Better status update handling
                logger.info(`📞 Status Update Received: ${webhookData.call?.status}`);
                if (webhookData.call) {
                    handleStatusUpdate(webhookData.call);
                }
                break;
                
            case 'call-started':
                logger.info(`🚀 Call Started Event: ${webhookData.call?.id}`);
                handleCallStarted(webhookData.call || webhookData);
                break;
                
            case 'call-ended':
            case 'end-of-call-report':
            case 'hang':
                logger.info(`🏁 Call Ended Event: ${webhookData.call?.id}, Status: ${webhookData.call?.status}`);
                handleCallEnded(webhookData.call || webhookData);
                break;
                
            case 'conversation-update':
                handleConversationUpdate(webhookData);
                break;
                
            case 'function-call':
                handleFunctionCall(webhookData.call, webhookData.functionCall);
                break;
            
            // Handle no-answer events
            case 'call-no-answer':
            case 'no-answer':
                handleCallNoAnswer(webhookData.call || webhookData);
                break;
                
            // ENHANCED: Add more webhook types for better call detection
            case 'phone-call-connected':
            case 'phone-call-started':
                logger.info(`📞 Phone Connected Event: ${webhookData.call?.id}`);
                if (webhookData.call) {
                    handleCallConnected(webhookData.call);
                }
                break;
                
            case 'speech-started':
                logger.info(`🗣️ Speech Started Event: ${webhookData.call?.id}`);
                // Speech started usually means call is answered and active
                if (webhookData.call) {
                    const callData = callMonitor.getCall(webhookData.call.id);
                    if (callData && callData.status !== 'in-progress') {
                        logger.info(`🎯 SPEECH DETECTED: Marking call ${webhookData.call.id} as answered/in-progress`);
                        handleCallAnswered(webhookData.call);
                    }
                }
                break;
                
            case 'speech-ended':
                logger.info(`🔇 Speech Ended Event: ${webhookData.call?.id}`);
                break;
                
            // Add more comprehensive webhook types for call answered detection
            case 'call-answered':
            case 'phone-answered':
            case 'answered':
                logger.info(`✅ Call Answered Event: ${webhookData.call?.id}`);
                if (webhookData.call) {
                    handleCallAnswered(webhookData.call);
                }
                break;
                
            case 'conversation-started':
            case 'assistant-speaking':
            case 'user-speaking':
                logger.info(`💬 Conversation Active Event: ${type} for ${webhookData.call?.id}`);
                // Any conversation activity means call is answered
                if (webhookData.call) {
                    const callData = callMonitor.getCall(webhookData.call.id);
                    if (callData && callData.status !== 'in-progress') {
                        logger.info(`🎯 CONVERSATION DETECTED: Marking call ${webhookData.call.id} as answered/in-progress`);
                        handleCallAnswered(webhookData.call);
                    }
                }
                break;
                
            default:
                logger.info(`❓ Unhandled webhook type: ${type}`);
                logger.info('Full webhook data for unhandled type:', JSON.stringify(webhookData, null, 2));
                
                // ENHANCED: Try to detect call status changes even in unknown webhook types
                if (webhookData.call?.status) {
                    logger.info(`🔄 Detected status in unknown webhook: ${webhookData.call.status}`);
                    handleStatusUpdate(webhookData.call);
                }
        }
        
        // Always respond quickly to webhooks
        res.json({ received: true, timestamp: new Date().toISOString() });
        
    } catch (error) {
        logger.error('Error handling webhook:', error);
        logger.error('Request body that caused error:', JSON.stringify(req.body, null, 2));
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

// NEW: Handle transcript events with partial/final support
function handleTranscriptEvent(webhookData) {
    const { call, transcript, transcriptType, role } = webhookData;
    
    if (!call || !call.id) {
        logger.warn('Received transcript event without call data');
        return;
    }
    
    // Log transcript details
    logger.info(`Transcript Event - Call: ${call.id}, Type: ${transcriptType}, Role: ${role}`);
    logger.info(`Transcript Text: "${transcript}"`);
    
    const callData = callMonitor.getCall(call.id);
    if (!callData) {
        logger.warn(`Received transcript for unknown call: ${call.id}`);
        return;
    }
    
    // AUTOMATIC ANSWERED DETECTION: If we're getting transcripts, the call must be answered
    if (callData.status !== 'in-progress' && callData.status !== 'answered') {
        logger.info(`🎯 TRANSCRIPT DETECTED: Call ${call.id} must be answered, updating status`);
        callMonitor.updateCall(call.id, {
            status: 'in-progress',
            answeredAt: callData.answeredAt || new Date().toISOString()
        });
        
        // Broadcast that call is answered
        universalBroadcast({
            type: 'call_answered',
            call: {
                ...call,
                status: 'in-progress',
                answeredAt: callData.answeredAt || new Date().toISOString()
            }
        });
        
        logger.info(`Call ${call.id} automatically marked as answered due to transcript`);
    }
    
    // Initialize transcript array if not exists
    if (!callData.transcript) {
        callData.transcript = [];
    }
    
    // Create transcript entry
    const transcriptEntry = {
        speaker: role === 'assistant' ? 'assistant' : 'customer',
        text: transcript,
        transcriptType: transcriptType, // 'partial' or 'final'
        timestamp: new Date().toISOString(),
        raw: webhookData // Store raw data for debugging
    };
    
    // For partial transcripts, replace the last partial entry from same speaker
    // For final transcripts, always add as new entry
    if (transcriptType === 'partial') {
        // Find and replace last partial entry from same speaker
        const lastIndex = callData.transcript.length - 1;
        if (lastIndex >= 0 && 
            callData.transcript[lastIndex].speaker === transcriptEntry.speaker &&
            callData.transcript[lastIndex].transcriptType === 'partial') {
            // Replace the last partial transcript
            callData.transcript[lastIndex] = transcriptEntry;
        } else {
            // Add new partial transcript
            callData.transcript.push(transcriptEntry);
        }
    } else {
        // Final transcript - always add as new entry
        callData.transcript.push(transcriptEntry);
    }
    
    // Keep only last 100 entries
    if (callData.transcript.length > 100) {
        callData.transcript = callData.transcript.slice(-100);
    }
    
    callMonitor.updateCall(call.id, callData);
    
    // Broadcast transcript update (send both partial and final for real-time updates)
    broadcastToClients({
        type: 'transcript_update',
        callId: call.id,
        transcript: {
            speaker: transcriptEntry.speaker,
            text: transcript,
            transcriptType: transcriptType,
            timestamp: transcriptEntry.timestamp
        }
    });
    
    logger.info(`Broadcasted ${transcriptType} transcript for call ${call.id}`);
}

// Handle call started event
function handleCallStarted(call) {
    if (!call || !call.id) {
        logger.warn('Received call-started without call data');
        return;
    }
    
    // Update call in monitor
    callMonitor.addCall({
        ...call,
        status: 'started',
        startedAt: new Date().toISOString()
    });
    
    // Broadcast to WebSocket and SSE clients
    universalBroadcast({
        type: 'call_started',
        call
    });
    
    logger.info(`Call started: ${call.id}`);
}

// Handle call ringing event
function handleCallRinging(call) {
    if (!call || !call.id) return;
    
    callMonitor.updateCall(call.id, {
        status: 'ringing',
        ringingAt: new Date().toISOString()
    });
    
    broadcastToClients({
        type: 'call_ringing',
        call
    });
    
    logger.info(`Call ringing: ${call.id}`);
}

// Handle call answered event
function handleCallAnswered(call) {
    if (!call || !call.id) return;
    
    callMonitor.updateCall(call.id, {
        status: 'in-progress',
        answeredAt: new Date().toISOString()
    });
    
    broadcastToClients({
        type: 'call_answered',
        call
    });
    
    logger.info(`Call answered: ${call.id}`);
}

// Handle call ended event - ENHANCED with extended monitoring and cleanup
function handleCallEnded(call) {
    if (!call || !call.id) return;
    
    // SAFETY CHECK: Don't end calls that have active listeners
    const callData = callMonitor.getCall(call.id);
    if (callData && callData.hasActiveListeners) {
        logger.warn(`🛡️  IGNORING CALL END: Call ${call.id} has active listeners, not ending`);
        return;
    }
    
    const endedAt = new Date().toISOString();
    
    // Calculate duration if we have start time
    let duration = 0;
    if (callData?.answeredAt) {
        duration = Math.floor((new Date(endedAt) - new Date(callData.answeredAt)) / 1000);
    } else if (callData?.addedAt) {
        // Calculate total call duration from creation for debugging
        const totalDuration = Math.floor((new Date(endedAt) - new Date(callData.addedAt)) / 1000);
        logger.info(`Call ${call.id} ended without being answered. Total duration from creation: ${totalDuration}s`);
    }
    
    // Enhanced call end logging
    logger.info(`Call ending details - ID: ${call.id}, Duration: ${duration}s, End Reason: ${call.endReason || 'unknown'}`);
    if (callData) {
        logger.info(`Call lifecycle - Added: ${callData.addedAt}, Answered: ${callData.answeredAt || 'never'}, Ended: ${endedAt}`);
    }
    
    // Update call status but don't immediately close streams
    callMonitor.updateCall(call.id, {
        status: 'ended',
        endedAt,
        duration,
        endReason: call.endReason || 'unknown',
        wasAnswered: duration > 0,
        // Mark that cleanup is pending
        cleanupPending: true
    });
    
    // Update campaign if this call is part of one
    if (call.customer?.metadata?.campaignId) {
        campaignController.updateCallStatus(call.id, 'completed', {
            duration,
            endReason: call.endReason
        });
    }
    
    // EXTENDED: Keep calls in monitor much longer for debugging and monitoring
    const initialDelay = process.env.NODE_ENV === 'development' ? 600000 : 300000; // 10 min dev, 5 min prod
    logger.info(`Call ${call.id} marked as ended, delaying stream cleanup for ${initialDelay/1000} seconds`);
    
    // First delay: Keep streams open longer to process remaining audio and allow monitoring
    setTimeout(() => {
        logger.info(`Starting cleanup for call ${call.id}`);
        
        // Now broadcast the ended event to close audio streams
        universalBroadcast({
            type: 'call_ended',
            call: {
                ...call,
                duration,
                endedAt,
                wasAnswered: duration > 0
            }
        });
        
        // Clean up phone tracking
        const callController = require('./callController');
        if (call.customer?.number) {
            callController.cleanupPhoneTracking(call.id, call.customer.number);
        }
        
        // Second delay: Remove from monitor after streams are closed (extended for monitoring)
        const removalDelay = process.env.NODE_ENV === 'development' ? 900000 : 600000; // 15 min dev, 10 min prod
        setTimeout(() => {
            // SAFETY CHECK: Don't remove calls that still have active audio streams or listeners
            const callData = callMonitor.getCall(call.id);
            if (callData && callData.hasActiveListeners) {
                logger.warn(`🛡️  PREVENTING REMOVAL: Call ${call.id} still has active audio listeners`);
                // Reschedule for later
                setTimeout(() => {
                    const finalCallData = callMonitor.getCall(call.id);
                    if (finalCallData && !finalCallData.hasActiveListeners) {
                        logger.info(`Removing call ${call.id} after listener check delay`);
                        callMonitor.removeCall(call.id, true);
                        broadcastToClients({
                            type: 'call_removed_from_monitor',
                            callId: call.id,
                            reason: 'cleanup_complete_delayed',
                            totalCleanupTime: initialDelay + removalDelay + 300000
                        });
                    }
                }, 300000); // Check again in 5 minutes
                return;
            }
            
            logger.info(`Removing call ${call.id} from monitor after full cleanup (total: ${(initialDelay + removalDelay)/1000}s)`);
            const removed = callMonitor.removeCall(call.id, true); // Force removal for ended calls
            
            if (removed) {
                // Final cleanup broadcast
                broadcastToClients({
                    type: 'call_removed_from_monitor',
                    callId: call.id,
                    reason: 'cleanup_complete_extended',
                    totalCleanupTime: initialDelay + removalDelay
                });
            }
        }, removalDelay);
        
    }, initialDelay);
    
    logger.info(`Call ended: ${call.id}, duration: ${duration}s, cleanup scheduled`);
}

// Handle call failed event - ENHANCED with better state management
function handleCallFailed(call) {
    if (!call || !call.id) return;
    
    const failedAt = new Date().toISOString();
    const callData = callMonitor.getCall(call.id);
    
    // Enhanced failure logging
    logger.error(`Call failed - ID: ${call.id}, Reason: ${call.failureReason || 'unknown'}`);
    if (callData) {
        const totalDuration = Math.floor((new Date(failedAt) - new Date(callData.addedAt)) / 1000);
        logger.error(`Call lifecycle - Added: ${callData.addedAt}, Failed: ${failedAt}, Total duration: ${totalDuration}s`);
    }
    
    callMonitor.updateCall(call.id, {
        status: 'failed',
        failedAt: failedAt,
        failureReason: call.failureReason || 'unknown'
    });
    
    // Update campaign if this call is part of one
    if (call.customer?.metadata?.campaignId) {
        campaignController.updateCallStatus(call.id, 'failed', {
            failureReason: call.failureReason
        });
    }
    
    broadcastToClients({
        type: 'call_failed',
        call: {
            ...call,
            failedAt,
            failureReason: call.failureReason || 'unknown'
        }
    });
    
    // Clean up phone tracking
    const callController = require('./callController');
    if (call.customer?.number) {
        callController.cleanupPhoneTracking(call.id, call.customer.number);
    }
    
    // Extended monitoring for failed calls too
    const removalDelay = process.env.NODE_ENV === 'development' ? 15000 : 2000;
    
    setTimeout(() => {
        logger.info(`Removing failed call ${call.id} from monitor`);
        const removed = callMonitor.removeCall(call.id, true); // Force removal for failed calls
        
        if (removed) {
            broadcastToClients({
                type: 'call_removed_from_monitor',
                callId: call.id,
                reason: 'failed_cleanup',
                delayUsed: removalDelay
            });
        }
    }, removalDelay);
    
    logger.error(`Call failed: ${call.id}, reason: ${call.failureReason}, removal scheduled in ${removalDelay/1000}s`);
}

// Handle speech update (legacy - keeping for compatibility)
function handleSpeechUpdate(call, message) {
    if (!call || !call.id) return;
    
    const callData = callMonitor.getCall(call.id);
    if (!callData) return;
    
    // Initialize transcript array if not exists
    if (!callData.transcript) {
        callData.transcript = [];
    }
    
    // Add new transcript entry
    const transcriptEntry = {
        speaker: message.role || 'unknown',
        text: message.content,
        transcriptType: 'final', // Legacy events are considered final
        timestamp: new Date().toISOString()
    };
    
    callData.transcript.push(transcriptEntry);
    
    // Keep only last 100 entries
    if (callData.transcript.length > 100) {
        callData.transcript = callData.transcript.slice(-100);
    }
    
    callMonitor.updateCall(call.id, callData);
    
    broadcastToClients({
        type: 'transcript_update',
        callId: call.id,
        transcript: {
            speaker: message.role,
            text: message.content,
            transcriptType: 'final'
        }
    });
}

// Handle transcript update (legacy - keeping for compatibility)
function handleTranscriptUpdate(call, transcript) {
    if (!call || !call.id || !transcript) return;
    
    const callData = callMonitor.getCall(call.id);
    if (!callData) return;
    
    // Store complete transcript
    callData.fullTranscript = transcript;
    callMonitor.updateCall(call.id, callData);
    
    // Parse and broadcast individual messages if needed
    if (Array.isArray(transcript)) {
        transcript.forEach(entry => {
            broadcastToClients({
                type: 'transcript_update',
                callId: call.id,
                transcript: {
                    speaker: entry.speaker || entry.role,
                    text: entry.text || entry.content,
                    transcriptType: 'final'
                }
            });
        });
    }
}

// ENHANCED: Handle status update with better detection
function handleStatusUpdate(call) {
    if (!call || !call.id) return;
    
    const updates = {
        status: call.status,
        updatedAt: new Date().toISOString()
    };
    
    logger.info(`🔄 Call status update - ID: ${call.id}, Status: ${call.status}`);
    
    // Enhanced state validation and tracking
    const currentCall = callMonitor.getCall(call.id);
    if (currentCall) {
        logger.info(`📈 Status transition for ${call.id}: ${currentCall.status} → ${call.status}`);
        
        // Track important state transitions
        if (!currentCall.statusHistory) {
            currentCall.statusHistory = [];
        }
        currentCall.statusHistory.push({
            from: currentCall.status,
            to: call.status,
            timestamp: updates.updatedAt
        });
        updates.statusHistory = currentCall.statusHistory;
    } else {
        logger.warn(`⚠️ Status update for unknown call: ${call.id}`);
        // Try to add the call if it doesn't exist
        callMonitor.addCall({
            ...call,
            addedAt: new Date().toISOString(),
            extendedMonitoring: true
        });
    }
    
    // ENHANCED: Track when call is answered for duration with better detection
    const answeredStatuses = ['in-progress', 'answered', 'active', 'connected', 'conversation-started'];
    if (answeredStatuses.includes(call.status)) {
        updates.answeredAt = new Date().toISOString();
        logger.info(`✅ Call ${call.id} ANSWERED at ${updates.answeredAt} - STATUS: ${call.status}`);
        handleCallAnswered(call);
    } else if (call.status === 'ringing') {
        logger.info(`📞 Call ${call.id} is ringing - user's phone is ringing`);
        handleCallRinging(call);
    } else if (call.status === 'queued') {
        logger.info(`⏳ Call ${call.id} is queued - waiting to be processed`);
        // Don't treat queued as no-answer - it's still processing
    } else if (call.status === 'failed') {
        logger.error(`❌ Call ${call.id} failed with status update`);
        handleCallFailed(call);
    } else if (call.status === 'ended') {
        logger.info(`🏁 Call ${call.id} ended via status update`);
        handleCallEnded(call);
    } else {
        logger.warn(`❓ Unknown call status for ${call.id}: ${call.status} - checking if should be marked as answered`);
        
        // Try to detect answered calls even with unknown status
        if (call.status && !['queued', 'ringing', 'failed', 'ended', 'no-answer'].includes(call.status)) {
            logger.info(`🎯 ASSUMING ANSWERED: Unknown status '${call.status}' likely means call is active`);
            updates.answeredAt = new Date().toISOString();
            handleCallAnswered(call);
        }
    }
    
    callMonitor.updateCall(call.id, updates);
    
    // Broadcast enhanced status update
    broadcastToClients({
        type: 'call_status_update',
        callId: call.id,
        status: call.status,
        previousStatus: currentCall?.status,
        timestamp: updates.updatedAt,
        statusHistory: updates.statusHistory
    });
    
    logger.info(`✅ Call status updated: ${call.id} - ${call.status}`);
}

// Handle function call (for Vapi function calling)
function handleFunctionCall(call, functionCall) {
    if (!call || !call.id || !functionCall) return;
    
    logger.info(`Function call received for ${call.id}:`, functionCall);
    
    // Handle specific function calls if needed
    broadcastToClients({
        type: 'function_call',
        callId: call.id,
        functionCall
    });
}

// Handle message update
function handleMessageUpdate(call, messages) {
    if (!call || !call.id) return;
    
    const callData = callMonitor.getCall(call.id);
    if (!callData) return;
    
    // Store messages
    callData.messages = messages;
    callMonitor.updateCall(call.id, callData);
    
    broadcastToClients({
        type: 'message_update',
        callId: call.id,
        messages
    });
}

// Handle speech start event
function handleSpeechStart(call, data) {
    if (!call || !call.id) return;
    
    broadcastToClients({
        type: 'speech_start',
        callId: call.id,
        speaker: data.speaker,
        timestamp: new Date().toISOString()
    });
}

// Handle conversation update (transcripts)
function handleConversationUpdate(data) {
    if (!data.call || !data.call.id) return;
    
    const callData = callMonitor.getCall(data.call.id);
    if (!callData) {
        logger.warn(`Received conversation update for unknown call: ${data.call.id}`);
        return;
    }
    
    // Handle transcript updates
    if (data.messages && Array.isArray(data.messages)) {
        data.messages.forEach(message => {
            if (message.role && message.content) {
                // Add to transcript
                if (!callData.transcript) {
                    callData.transcript = [];
                }
                
                callData.transcript.push({
                    speaker: message.role === 'assistant' ? 'assistant' : 'customer',
                    text: message.content,
                    transcriptType: 'final',
                    timestamp: message.timestamp || new Date().toISOString()
                });
                
                // Broadcast transcript update
                broadcastToClients({
                    type: 'transcript_update',
                    callId: data.call.id,
                    transcript: {
                        speaker: message.role === 'assistant' ? 'assistant' : 'customer',
                        text: message.content,
                        transcriptType: 'final'
                    }
                });
            }
        });
        
        // Keep only last 100 entries
        if (callData.transcript.length > 100) {
            callData.transcript = callData.transcript.slice(-100);
        }
        
        callMonitor.updateCall(data.call.id, callData);
    }
}

// NEW: Handle phone call connected event
function handleCallConnected(call) {
    if (!call || !call.id) return;
    
    logger.info(`📞 Call ${call.id} connected - should transition to in-progress soon`);
    
    const callData = callMonitor.getCall(call.id);
    if (!callData) {
        logger.warn(`Received phone-connected event for unknown call: ${call.id}`);
        return;
    }
    
    // Update call status to connected/ringing
    callMonitor.updateCall(call.id, {
        status: 'ringing',
        connectedAt: new Date().toISOString()
    });
    
    broadcastToClients({
        type: 'call_connected',
        call
    });
    
    logger.info(`Call connected: ${call.id}`);
}


// Add a new handler for no-answer status
function handleCallNoAnswer(call) {
    if (!call || !call.id) return;
    
    const noAnswerAt = new Date().toISOString();
    const callData = callMonitor.getCall(call.id);
    
    // Enhanced logging to debug status transitions
    logger.warn(`🔔 Call ${call.id} marked as NO-ANSWER - investigating...`);
    if (callData) {
        logger.warn(`Call lifecycle - Added: ${callData.addedAt}, Current status: ${callData.status}`);
        logger.warn(`Status history:`, callData.statusHistory || []);
        
        // Check if call was actually answered but misclassified
        if (callData.answeredAt || callData.transcript?.length > 0) {
            logger.error(`⚠️  POTENTIAL STATUS MISMATCH: Call ${call.id} marked as no-answer but has answer indicators!`);
            logger.error(`- Answered at: ${callData.answeredAt}`);
            logger.error(`- Transcript entries: ${callData.transcript?.length || 0}`);
            
            // Don't treat as no-answer if we have evidence it was answered
            logger.warn(`Treating as answered call instead of no-answer`);
            return;
        }
    }
    
    logger.info(`Call ${call.id} was not answered after timeout`);
    
    callMonitor.updateCall(call.id, {
        status: 'no-answer',
        endedAt: noAnswerAt,
        endReason: 'no-answer',
        wasAnswered: false
    });
    
    // Update campaign if this call is part of one
    if (call.customer?.metadata?.campaignId) {
        campaignController.updateCallStatus(call.id, 'no-answer', {
            endReason: 'no-answer'
        });
    }
    
    broadcastToClients({
        type: 'call_no_answer',
        call: {
            ...call,
            status: 'no-answer',
            endedAt: noAnswerAt
        }
    });
    
    // Clean up phone tracking
    const callController = require('./callController');
    if (call.customer?.number) {
        callController.cleanupPhoneTracking(call.id, call.customer.number);
    }
    
    // EXTENDED: Remove from monitor after longer delay (5 minutes instead of 1 minute)
    // This gives more time to debug and prevents premature removal of answered calls
    const noAnswerDelay = process.env.NODE_ENV === 'development' ? 300000 : 180000; // 5 min dev, 3 min prod
    setTimeout(() => {
        const finalCheck = callMonitor.getCall(call.id);
        if (finalCheck && (finalCheck.answeredAt || finalCheck.transcript?.length > 0)) {
            logger.warn(`🛡️  PREVENTED REMOVAL: Call ${call.id} has answer indicators, keeping in monitor`);
            return;
        }
        
        logger.info(`Removing no-answer call ${call.id} after ${noAnswerDelay/1000}s delay`);
        const removed = callMonitor.removeCall(call.id); // Don't force - let safety checks work
        
        if (removed) {
            broadcastToClients({
                type: 'call_removed_from_monitor',
                callId: call.id,
                reason: 'no_answer_cleanup_after_extended_delay'
            });
        } else {
            logger.warn(`Call ${call.id} removal blocked by safety checks - call may have been answered`);
        }
    }, noAnswerDelay);
}

