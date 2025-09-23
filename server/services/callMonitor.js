const WebSocket = require('ws');
const logger = require('../utils/logger');

class CallMonitor {
    constructor() {
        this.activeCalls = new Map();
        this.callListeners = new Map();
        this.audioStreams = new Map();
        this.retryAttempts = new Map(); // Track retry attempts for audio streams
        this.callStateHistory = new Map(); // Track call state changes
    }

    // Add a new call to monitor - ENHANCED with better state tracking
    addCall(callData) {
        const enhancedCallData = {
            ...callData,
            addedAt: new Date().toISOString(),
            transcript: [],
            events: [],
            statusHistory: [{
                status: callData.status || 'queued',
                timestamp: new Date().toISOString(),
                source: 'call_creation'
            }],
            extendedMonitoring: callData.extendedMonitoring || false,
            debugMode: callData.debugMode || false,
            hasActiveListeners: false,
            listenerCount: 0
        };
        
        this.activeCalls.set(callData.id, enhancedCallData);
        this.callStateHistory.set(callData.id, []);
        
        // Enhanced logging for better debugging
        logger.info(`Added call to monitor: ${callData.id}`);
        logger.info(`Call details - Phone: ${callData.customer?.number}, Status: ${callData.status || 'queued'}`);
        logger.info(`Extended monitoring: ${enhancedCallData.extendedMonitoring}, Debug mode: ${enhancedCallData.debugMode}`);
        
        // If call has listenUrl, set up audio streaming with retry logic
        if (callData.monitor?.listenUrl) {
            this.setupAudioStreamWithRetry(callData.id, callData.monitor.listenUrl);
        } else {
            logger.info(`No audio stream URL for call ${callData.id} - will be available when call is answered`);
        }
    }

    // Update existing call - ENHANCED with state history tracking
    updateCall(callId, updates) {
        const call = this.activeCalls.get(callId);
        if (call) {
            // Track status changes
            if (updates.status && updates.status !== call.status) {
                logger.info(`Call ${callId} status change: ${call.status} → ${updates.status}`);
                
                if (!call.statusHistory) call.statusHistory = [];
                call.statusHistory.push({
                    from: call.status,
                    to: updates.status,
                    timestamp: new Date().toISOString(),
                    source: 'webhook_update'
                });
                
                // Track in separate history map for debugging
                const history = this.callStateHistory.get(callId) || [];
                history.push({
                    status: updates.status,
                    timestamp: new Date().toISOString(),
                    previousStatus: call.status,
                    updates: Object.keys(updates)
                });
                this.callStateHistory.set(callId, history);
            }
            
            const updatedCall = {
                ...call,
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            this.activeCalls.set(callId, updatedCall);
            
            // If audio stream becomes available, set it up
            if (updates.monitor?.listenUrl && !this.audioStreams.has(callId)) {
                logger.info(`Audio stream URL now available for call ${callId}`);
                this.setupAudioStreamWithRetry(callId, updates.monitor.listenUrl);
            }
        }
    }

    // Get call by ID
    getCall(callId) {
        return this.activeCalls.get(callId);
    }

    // Get all active calls
    getActiveCalls() {
        return this.activeCalls;
    }

    // Remove call from monitor - ENHANCED with better cleanup and safety checks
    removeCall(callId, force = false) {
        const call = this.activeCalls.get(callId);
        if (call) {
            // SAFETY CHECK: Prevent removal of active calls unless forced
            if (!force && (call.status === 'ringing' || call.status === 'in-progress' || call.status === 'answered')) {
                logger.warn(`🛡️  BLOCKED REMOVAL: Call ${callId} is active (${call.status}), use force=true to override`);
                return false;
            }
            
            // SAFETY CHECK: Prevent removal of calls with transcripts unless forced
            if (!force && call.transcript && call.transcript.length > 0) {
                logger.warn(`🛡️  BLOCKED REMOVAL: Call ${callId} has ${call.transcript.length} transcript entries, likely answered`);
                return false;
            }
            
            logger.info(`Removing call ${callId} from monitor${force ? ' (FORCED)' : ''}`);
            
            // Log final call statistics for debugging
            if (call.statusHistory) {
                logger.info(`Call ${callId} status history:`, call.statusHistory);
            }
            
            if (call.addedAt) {
                const totalLifetime = Math.floor((Date.now() - new Date(call.addedAt).getTime()) / 1000);
                logger.info(`Call ${callId} total lifetime: ${totalLifetime}s`);
                logger.info(`Call ${callId} final status: ${call.status}, answered: ${call.answeredAt ? 'YES' : 'NO'}, transcripts: ${call.transcript?.length || 0}`);
            }
        }
        
        // Close audio stream if exists
        this.closeAudioStream(callId);
        
        // Clean up all tracking
        this.activeCalls.delete(callId);
        this.callListeners.delete(callId);
        this.retryAttempts.delete(callId);
        this.callStateHistory.delete(callId);
        
        logger.info(`Removed call from monitor: ${callId}`);
        return true;
    }

    // Track active listeners
    addListener(callId) {
        const call = this.activeCalls.get(callId);
        if (call) {
            call.listenerCount = (call.listenerCount || 0) + 1;
            call.hasActiveListeners = call.listenerCount > 0;
            logger.info(`Added listener to call ${callId}. Total listeners: ${call.listenerCount}`);
        }
    }

    removeListener(callId) {
        const call = this.activeCalls.get(callId);
        if (call) {
            call.listenerCount = Math.max(0, (call.listenerCount || 0) - 1);
            call.hasActiveListeners = call.listenerCount > 0;
            logger.info(`Removed listener from call ${callId}. Total listeners: ${call.listenerCount}`);
        }
    }

    // Set up audio streaming with retry logic - ENHANCED
    setupAudioStreamWithRetry(callId, listenUrl, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        
        try {
            // Skip if no listen URL provided
            if (!listenUrl) {
                logger.info(`No listen URL provided for call ${callId}, skipping audio stream`);
                return;
            }
            
            logger.info(`Setting up audio stream for call ${callId} (attempt ${retryCount + 1}/${maxRetries + 1}): ${listenUrl}`);
            
            const ws = new WebSocket(listenUrl);
            let audioBuffer = Buffer.alloc(0);
            let connectionTimeout;
            let isConnected = false;
            
            // Set connection timeout
            connectionTimeout = setTimeout(() => {
                if (!isConnected) {
                    logger.error(`Audio stream connection timeout for call ${callId}`);
                    ws.terminate();
                    this.handleAudioStreamRetry(callId, listenUrl, retryCount, 'connection_timeout');
                }
            }, 10000); // 10 second timeout
            
            ws.on('open', () => {
                isConnected = true;
                clearTimeout(connectionTimeout);
                logger.info(`Audio stream connected for call: ${callId}`);
                this.audioStreams.set(callId, ws);
                this.retryAttempts.delete(callId); // Reset retry count on success
                
                // Notify listeners that audio is available
                this.emitToListeners(callId, {
                    type: 'audio_connected',
                    callId,
                    attempt: retryCount + 1
                });
            });

            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    // Handle audio data
                    audioBuffer = Buffer.concat([audioBuffer, data]);
                    
                    // Emit audio data to listeners with enhanced info
                    this.emitToListeners(callId, {
                        type: 'audio_data',
                        data: data,
                        bufferSize: audioBuffer.length,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    // Handle control messages
                    try {
                        const message = JSON.parse(data.toString());
                        logger.info(`Audio stream message for call ${callId}:`, message);
                        this.handleStreamMessage(callId, message);
                    } catch (error) {
                        logger.error(`Error parsing stream message for call ${callId}:`, error);
                    }
                }
            });

            ws.on('close', (code, reason) => {
                clearTimeout(connectionTimeout);
                logger.info(`Audio stream closed for call ${callId} - Code: ${code}, Reason: ${reason}`);
                this.audioStreams.delete(callId);
                
                // Save audio buffer if needed
                if (audioBuffer.length > 0) {
                    this.saveAudioBuffer(callId, audioBuffer);
                }
                
                // Notify listeners
                this.emitToListeners(callId, {
                    type: 'audio_disconnected',
                    callId,
                    code,
                    reason: reason.toString(),
                    wasConnected: isConnected
                });
                
                // Retry if appropriate
                if (code !== 1000 && retryCount < maxRetries && isConnected) {
                    logger.info(`Audio stream closed unexpectedly for call ${callId}, will retry`);
                    this.handleAudioStreamRetry(callId, listenUrl, retryCount, `close_code_${code}`);
                }
            });

            ws.on('error', (error) => {
                clearTimeout(connectionTimeout);
                logger.error(`Audio stream error for call ${callId}:`, error);
                this.audioStreams.delete(callId);
                
                // Don't crash if audio stream fails - calls can work without it
                this.emitToListeners(callId, {
                    type: 'audio_error',
                    error: error.message,
                    callId,
                    attempt: retryCount + 1
                });
                
                // Retry on error
                this.handleAudioStreamRetry(callId, listenUrl, retryCount, error.message);
            });

        } catch (error) {
            logger.error(`Failed to setup audio stream for call ${callId}:`, error);
            this.handleAudioStreamRetry(callId, listenUrl, retryCount, error.message);
        }
    }
    
    // Handle audio stream retry logic
    handleAudioStreamRetry(callId, listenUrl, retryCount, errorReason) {
        const maxRetries = 3;
        
        if (retryCount < maxRetries) {
            const nextRetryCount = retryCount + 1;
            const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
            
            // Track retry attempts
            this.retryAttempts.set(callId, {
                count: nextRetryCount,
                lastError: errorReason,
                nextRetryAt: new Date(Date.now() + retryDelay).toISOString()
            });
            
            logger.info(`Scheduling audio stream retry ${nextRetryCount}/${maxRetries} for call ${callId} in ${retryDelay/1000}s. Reason: ${errorReason}`);
            
            setTimeout(() => {
                // Check if call still exists before retrying
                const call = this.activeCalls.get(callId);
                if (call && !this.audioStreams.has(callId)) {
                    logger.info(`Retrying audio stream setup for call ${callId} (attempt ${nextRetryCount})`);
                    this.setupAudioStreamWithRetry(callId, listenUrl, nextRetryCount);
                } else {
                    logger.info(`Skipping retry for call ${callId} - call removed or stream already connected`);
                }
            }, retryDelay);
            
            // Notify listeners of retry schedule
            this.emitToListeners(callId, {
                type: 'audio_retry_scheduled',
                callId,
                retryCount: nextRetryCount,
                maxRetries,
                retryDelay,
                reason: errorReason
            });
        } else {
            logger.error(`Max audio stream retries exceeded for call ${callId}. Final error: ${errorReason}`);
            this.retryAttempts.delete(callId);
            
            // Notify listeners of failure
            this.emitToListeners(callId, {
                type: 'audio_retry_failed',
                callId,
                maxRetries,
                finalError: errorReason
            });
        }
    }

    // Close audio stream
    closeAudioStream(callId) {
        const ws = this.audioStreams.get(callId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
            this.audioStreams.delete(callId);
        }
    }

    // Handle messages from audio stream
    handleStreamMessage(callId, message) {
        const call = this.activeCalls.get(callId);
        if (!call) return;

        // Add to events
        call.events.push({
            type: message.type,
            data: message,
            timestamp: new Date().toISOString()
        });

        // Emit to listeners
        this.emitToListeners(callId, message);
    }

    // Add listener for call events
    addListener(callId, listenerId, callback) {
        if (!this.callListeners.has(callId)) {
            this.callListeners.set(callId, new Map());
        }
        this.callListeners.get(callId).set(listenerId, callback);
    }

    // Remove listener
    removeListener(callId, listenerId) {
        const listeners = this.callListeners.get(callId);
        if (listeners) {
            listeners.delete(listenerId);
            if (listeners.size === 0) {
                this.callListeners.delete(callId);
            }
        }
    }

    // Emit event to all listeners for a call
    emitToListeners(callId, event) {
        const listeners = this.callListeners.get(callId);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(event);
                } catch (error) {
                    logger.error(`Error in call listener for ${callId}:`, error);
                }
            });
        }
    }

    // Save audio buffer
    saveAudioBuffer(callId, buffer) {
        // In production, we might want to:
        // - Save to S3 or cloud storage
        // - Convert to different format
        // - Process for analytics
        logger.info(`Audio buffer for call ${callId} ready for processing (${buffer.length} bytes)`);
    }

    // Get enhanced call statistics for debugging
    getCallStats() {
        const stats = {
            total: this.activeCalls.size,
            byStatus: {},
            avgDuration: 0,
            retryAttempts: this.retryAttempts.size,
            audioStreamsActive: this.audioStreams.size
        };

        let totalDuration = 0;
        let callsWithDuration = 0;

        this.activeCalls.forEach((call, callId) => {
            // Count by status
            const status = call.status || 'unknown';
            stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

            // Calculate average duration
            if (call.duration) {
                totalDuration += call.duration;
                callsWithDuration++;
            }
        });

        if (callsWithDuration > 0) {
            stats.avgDuration = Math.round(totalDuration / callsWithDuration);
        }

        // Add retry statistics
        stats.retryDetails = Array.from(this.retryAttempts.entries()).map(([callId, retryInfo]) => ({
            callId,
            ...retryInfo
        }));

        return stats;
    }

    // Enhanced cleanup with better logic for unanswered calls
    cleanup(maxAge = 3600000) { // Default 1 hour
        const now = Date.now();
        const toRemove = [];

        this.activeCalls.forEach((call, callId) => {
            const callTime = new Date(call.endedAt || call.addedAt).getTime();
            const age = now - callTime;
            
            // More intelligent cleanup logic
            if (call.status === 'ended' && age > maxAge) {
                toRemove.push({ callId, reason: 'ended_timeout', age });
            } else if (call.status === 'failed' && age > (maxAge / 2)) {
                toRemove.push({ callId, reason: 'failed_timeout', age });
            } else if (!call.status && age > (maxAge / 4)) {
                // Remove unknown status calls after 15 minutes
                toRemove.push({ callId, reason: 'unknown_status_timeout', age });
            } else if (call.status === 'queued' && age > 300000) {
                // Remove queued calls after 5 minutes (likely abandoned)
                toRemove.push({ callId, reason: 'queued_timeout', age });
            }
        });

        toRemove.forEach(({ callId, reason, age }) => {
            logger.info(`Cleanup removing call ${callId} - Reason: ${reason}, Age: ${Math.floor(age/1000)}s`);
            this.removeCall(callId);
        });

        if (toRemove.length > 0) {
            logger.info(`Cleaned up ${toRemove.length} old calls`);
        }
    }
}

// Create singleton instance
const callMonitor = new CallMonitor();

// Set up periodic cleanup
setInterval(() => {
    callMonitor.cleanup();
}, 300000); // Every 5 minutes

module.exports = callMonitor;