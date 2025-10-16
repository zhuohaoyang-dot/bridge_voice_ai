// Audio streaming state management - ENHANCED
const activeAudioStreams = new Map();
const audioContexts = new Map();
const audioRetryAttempts = new Map(); // Track client-side retry attempts
const audioStreamErrors = new Map(); // Track error history

// Use existing activeCallsMap if it exists, otherwise create it
if (typeof window.activeCallsMap === 'undefined') {
    window.activeCallsMap = new Map();
}
const activeCallsMap = window.activeCallsMap;

let selectedCallId = null;
let currentCallForAction = null;

// Toggle listen functionality - ENHANCED with better state checking
async function toggleListen(btn) {
    const callId = btn.dataset.callId;
    const isListening = btn.classList.contains('listening');
    
    if (isListening) {
        stopListening(callId, btn);
    } else {
        startListening(callId, btn);
    }
}

// Start listening to a call - ENHANCED with retry logic and better error handling
// Start listening to a call - ENHANCED with retry logic and better error handling
async function startListening(callId, btn) {
    try {
        const call = activeCallsMap.get(callId);
        
        if (!call) {
            showNotification('Call not found in active calls', 'error');
            return;
        }
        
        // For queued calls, wait for them to be answered
        if (call.status === 'queued' || call.status === 'ringing') {
            showNotification('Call is not yet in progress. Waiting for call to be answered...', 'info');
            
            // Add visual indicator that we're waiting
            btn.classList.add('waiting');
            btn.title = 'Waiting for call to connect...';
            
            // Set up a watcher for when call becomes active
            const checkInterval = setInterval(() => {
                const updatedCall = activeCallsMap.get(callId);
                if (!updatedCall) {
                    clearInterval(checkInterval);
                    btn.classList.remove('waiting');
                    return;
                }
                
                // Accept multiple status values that indicate call is answered
                const answeredStatuses = ['in-progress', 'answered', 'active', 'connected', 'conversation-started'];
                if (answeredStatuses.includes(updatedCall.status) && updatedCall.monitor?.listenUrl) {
                    clearInterval(checkInterval);
                    btn.classList.remove('waiting');
                    console.log(`Call ${callId} is now active (${updatedCall.status}), starting audio stream`);
                    startListening(callId, btn); // Retry
                } else if (answeredStatuses.includes(updatedCall.status) && !updatedCall.monitor?.listenUrl) {
                    // Call is answered but no listen URL yet - keep waiting but show different message
                    console.log(`Call ${callId} answered (${updatedCall.status}) but no audio URL yet`);
                    showNotification(`Call answered! Waiting for audio stream...`, 'success');
                } else if (['ended', 'failed'].includes(updatedCall.status)) {
                    clearInterval(checkInterval);
                    btn.classList.remove('waiting');
                    showNotification('Call ended before audio could be established', 'warning');
                    btn.classList.remove('listening');
                    btn.title = 'Listen to Call';
                }
            }, 2000); // Check every 2 seconds
            
            // Stop checking after 10 minutes
            setTimeout(() => {
                clearInterval(checkInterval);
                btn.classList.remove('waiting');
                if (activeCallsMap.has(callId)) {
                    const finalCall = activeCallsMap.get(callId);
                    if (finalCall.status === 'queued' || finalCall.status === 'ringing') {
                        showNotification('Call took too long to connect', 'error');
                        btn.classList.remove('listening');
                        btn.title = 'Listen to Call';
                    }
                }
            }, 1200000); // 20 minutes
            return;
        }
        
        // Enhanced call state validation
        if (!call.monitor || !call.monitor.listenUrl) {
            const statusMsg = call.status ? `Call status: ${call.status}` : 'Status unknown';
            const errorMsg = `Audio stream not available. ${statusMsg}. Audio is only available for answered calls.`;
            
            showNotification(errorMsg, 'error');
            console.error('Call monitor data:', call.monitor);
            console.error('Call status:', call.status);
            console.error('Call details:', call);
            return;
        }
        
        // Check for existing retry attempts
        const retryInfo = audioRetryAttempts.get(callId);
        if (retryInfo && retryInfo.count >= 3) {
            showNotification('Maximum audio connection attempts reached for this call', 'error');
            return;
        }
        
        btn.classList.add('listening');
        btn.title = 'Stop Listening';
        
        // Create audio context - let browser choose optimal sample rate
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContexts.set(callId, audioContext);
        
        console.log('AudioContext sample rate:', audioContext.sampleRate);
        console.log(`Attempting to connect to Vapi audio stream: ${call.monitor.listenUrl}`);
        console.log('Call status:', call.status);
        console.log('Call monitor data:', call.monitor);
        
        // Notify server that we're starting to listen
        try {
            await apiCall(`/api/calls/${callId}/add-listener`, { method: 'POST' });
            console.log(`Added listener for call ${callId}`);
        } catch (error) {
            console.warn('Failed to register listener with server:', error);
        }
        
        // Start audio connection with retry logic
        await connectToAudioStream(callId, call.monitor.listenUrl, audioContext, btn);
        
    } catch (error) {
        console.error('Error in startListening:', error);
        showNotification('Failed to start audio stream', 'error');
        btn.classList.remove('listening');
        btn.classList.remove('waiting');
        handleAudioStreamError(callId, error.message, btn);
    }
}

// Connect to audio stream with enhanced error handling - NEW FUNCTION
async function connectToAudioStream(callId, listenUrl, audioContext, btn, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        // Variables for dynamic sample rate detection
        let vapiSampleRate = null;
        let audioFormat = null;
        let formatTimeout = null;
        
        // Connect DIRECTLY to Vapi's WebSocket URL
        const ws = new WebSocket(listenUrl);
        ws.binaryType = 'arraybuffer';
        
        // Timing variables for smooth playback
        let nextStartTime = 0;
        let isFirstChunk = true;
        let connectionTimeout = null;
        let isConnected = false;
        
        // Set connection timeout - Enhanced timeout handling
        connectionTimeout = setTimeout(() => {
            if (!isConnected) {
                console.error(`Audio stream connection timeout for call ${callId}`);
                ws.close();
                handleAudioStreamRetry(callId, listenUrl, audioContext, btn, retryCount, 'Connection timeout');
            }
        }, 30000); // 30 second timeout (increased from 15s)
        
        ws.onopen = () => {
            isConnected = true;
            clearTimeout(connectionTimeout);
            console.log(`Connected to Vapi audio stream for call ${callId}`);
            activeAudioStreams.set(callId, ws);
            
            // Reset retry count on successful connection
            audioRetryAttempts.delete(callId);
            
            // Set timeout for format detection - fallback to common rates after 3 seconds
            formatTimeout = setTimeout(() => {
                if (!vapiSampleRate) {
                    console.warn('No format info received, falling back to 16000Hz mono');
                    vapiSampleRate = 16000;
                    audioFormat = { channels: 1, encoding: 'pcm16' };
                    showNotification('Using fallback audio format: 16000Hz mono', 'warning');
                }
            }, 3000);
            
            // Show listening indicator
            const card = document.querySelector(`[data-call-id="${callId}"]`);
            if (card) {
                card.classList.add('listening-active');
                
                if (!card.querySelector('.audio-indicator')) {
                    const audioIndicator = document.createElement('div');
                    audioIndicator.className = 'audio-indicator';
                    audioIndicator.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 6L12 10.5 8.5 8 11 5.5 13 7.5 15.5 8z" fill="currentColor"/>
                            <circle cx="12" cy="12" r="2" fill="currentColor" class="pulse-dot"/>
                        </svg>
                        <span>Listening ${retryCount > 0 ? `(retry ${retryCount})` : ''}</span>
                    `;
                    card.querySelector('.call-card-header').appendChild(audioIndicator);
                }
            }
            
            showNotification(`Connected to audio stream${retryCount > 0 ? ` (retry ${retryCount})` : ''} - waiting for format info`, 'info');
        };
        
        ws.onmessage = async (event) => {
            // Same message handling logic as before, but with enhanced error handling
            if (event.data instanceof ArrayBuffer) {
                // Only process audio if we know the format
                if (!vapiSampleRate) {
                    console.warn('Received audio before format info - skipping chunk');
                    return;
                }
                
                try {
                    const int16Array = new Int16Array(event.data);
                    const inputSampleRate = vapiSampleRate; // Use detected rate
                    const channels = audioFormat?.channels || 1;
                    
                    // Validate audio data
                    if (int16Array.length === 0) {
                        console.warn('Received empty audio chunk');
                        return;
                    }
                    
                    console.log(`Processing audio: ${int16Array.length} samples, ${inputSampleRate}Hz, ${channels} channels`);
                    
                    // Handle multi-channel audio - convert to mono if needed
                    let monoSamples;
                    if (channels === 2) {
                        // Convert stereo to mono by averaging channels
                        monoSamples = [];
                        for (let i = 0; i < int16Array.length; i += 2) {
                            if (i + 1 < int16Array.length) {
                                monoSamples.push((int16Array[i] + int16Array[i + 1]) / 2);
                            } else {
                                monoSamples.push(int16Array[i]);
                            }
                        }
                    } else if (channels === 1) {
                        // Already mono
                        monoSamples = Array.from(int16Array);
                    } else {
                        // Unsupported channel count - mix down to mono
                        console.warn(`Unsupported channel count: ${channels}, mixing to mono`);
                        monoSamples = [];
                        const samplesPerChannel = int16Array.length / channels;
                        for (let i = 0; i < samplesPerChannel; i++) {
                            let sum = 0;
                            for (let ch = 0; ch < channels; ch++) {
                                sum += int16Array[i * channels + ch];
                            }
                            monoSamples.push(sum / channels);
                        }
                    }
                    
                    // Validate mono samples
                    if (monoSamples.length === 0) {
                        console.warn('No audio samples after channel processing');
                        return;
                    }
                    
                    // Calculate proper buffer size for resampling
                    const outputSamples = Math.floor(monoSamples.length * audioContext.sampleRate / inputSampleRate);
                    if (outputSamples <= 0) {
                        console.warn('Invalid output sample count');
                        return;
                    }
                    
                    const audioBuffer = audioContext.createBuffer(1, outputSamples, audioContext.sampleRate);
                    const channelData = audioBuffer.getChannelData(0);
                    
                    // Improved resampling with proper ratio calculation
                    const ratio = monoSamples.length / outputSamples;
                    for (let i = 0; i < outputSamples; i++) {
                        const srcIndex = i * ratio;
                        const srcIndexInt = Math.floor(srcIndex);
                        const fraction = srcIndex - srcIndexInt;
                        
                        if (srcIndexInt < monoSamples.length - 1) {
                            const sample1 = monoSamples[srcIndexInt] / 32768.0;
                            const sample2 = monoSamples[srcIndexInt + 1] / 32768.0;
                            channelData[i] = sample1 + (sample2 - sample1) * fraction;
                        } else if (srcIndexInt < monoSamples.length) {
                            channelData[i] = monoSamples[srcIndexInt] / 32768.0;
                        } else {
                            channelData[i] = 0;
                        }
                    }
                    
                    // Schedule playback with proper timing
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioContext.destination);
                    
                    const currentTime = audioContext.currentTime;
                    
                    if (isFirstChunk) {
                        // Small initial delay to ensure smooth start
                        nextStartTime = currentTime + 0.05;
                        isFirstChunk = false;
                        showNotification('Now playing audio', 'success');
                    }
                    
                    // Schedule this chunk to play at the exact right time
                    source.start(nextStartTime);
                    nextStartTime += audioBuffer.duration;
                    
                    // Prevent drift - reset if we're falling too far behind
                    if (nextStartTime < currentTime - 0.1) {
                        console.log('Audio timing reset - fell behind');
                        nextStartTime = currentTime + 0.05;
                    }
                    
                } catch (error) {
                    console.error('Audio processing error:', error);
                    showNotification('Audio processing error: ' + error.message, 'error');
                }
            } else {
                // Handle Vapi control messages
                try {
                    const message = JSON.parse(event.data);
                    console.log('Vapi message:', message);
                    
                    // Extract audio format from start message
                    if (message.type === 'start' && message.sampleRate) {
                        vapiSampleRate = message.sampleRate;
                        audioFormat = message;
                        
                        // Clear the format timeout since we got the info
                        if (formatTimeout) {
                            clearTimeout(formatTimeout);
                            formatTimeout = null;
                        }
                        
                        console.log('Vapi audio format detected:', {
                            sampleRate: vapiSampleRate,
                            channels: audioFormat.channels,
                            encoding: audioFormat.encoding
                        });
                        showNotification(`Audio format: ${vapiSampleRate}Hz, ${audioFormat.channels || 1} channels`, 'info');
                    }
                    
                    // Handle other message types
                    if (message.type === 'error') {
                        console.error('Vapi stream error:', message);
                        showNotification('Audio stream error: ' + message.message, 'error');
                        handleAudioStreamError(callId, message.message, btn);
                    }
                    
                } catch (e) {
                    console.log('Non-JSON message from Vapi:', event.data);
                }
            }
        };
        
        ws.onerror = (error) => {
            clearTimeout(connectionTimeout);
            console.error('Vapi audio stream error:', error);
            console.error('Audio stream URL that failed:', listenUrl);
            
            const errorMessage = 'Audio stream connection failed';
            console.error('This may be due to the call not being answered, Vapi service issues, or network problems.');
            
            // Clear timeout if connection fails
            if (formatTimeout) {
                clearTimeout(formatTimeout);
                formatTimeout = null;
            }
            
            // Track error for debugging
            trackAudioStreamError(callId, errorMessage, error);
            
            // Attempt retry if appropriate
            if (!isConnected && retryCount < maxRetries) {
                handleAudioStreamRetry(callId, listenUrl, audioContext, btn, retryCount, errorMessage);
            } else {
                showNotification(errorMessage + ' - Max retries reached', 'error');
                stopListening(callId, btn);
            }
        };
        
        ws.onclose = (event) => {
            clearTimeout(connectionTimeout);
            console.log(`Vapi audio stream closed: code=${event.code}, reason=${event.reason}`);
            console.log('Close event details:', event);
            
            // Clear timeout on close
            if (formatTimeout) {
                clearTimeout(formatTimeout);
                formatTimeout = null;
            }
            
            let shouldRetry = false;
            let errorMessage = '';
            
            // Handle different close codes
            if (event.code === 1000) {
                // Normal closure
                console.log('Audio stream closed normally');
                stopListening(callId, btn);
                return;
            } else if (event.code === 1005) {
                // No Status Received - might be recoverable
                const call = activeCallsMap.get(callId);
                if (call && call.status === 'in-progress' && isConnected) {
                    console.log('Unexpected closure (1005) during active call, checking if retry needed');
                    errorMessage = 'Audio stream lost connection unexpectedly';
                    shouldRetry = retryCount < maxRetries;
                } else {
                    errorMessage = 'Audio stream closed without status';
                }
            } else if (event.code === 1002) {
                errorMessage = 'Audio stream failed - Protocol error';
            } else if (event.code === 1003) {
                errorMessage = 'Audio stream failed - Unsupported data format';
            } else if (event.code === 1006) {
                // Abnormal closure - connection lost
                errorMessage = 'Audio stream failed - Connection lost unexpectedly';
                const call = activeCallsMap.get(callId);
                if (call && call.status === 'in-progress' && isConnected) {
                    shouldRetry = retryCount < maxRetries;
                }
            } else if (event.code >= 4000) {
                // Vapi-specific error codes
                errorMessage = `Audio stream failed - Vapi error (${event.code}): ${event.reason}`;
            } else {
                errorMessage = `Audio stream closed unexpectedly (${event.code})`;
                shouldRetry = retryCount < maxRetries && isConnected;
            }
            
            // Log the error
            if (errorMessage) {
                console.error(errorMessage);
                trackAudioStreamError(callId, errorMessage, event);
            }
            
            // Check if call is still active before retrying
            if (shouldRetry) {
                const currentCall = activeCallsMap.get(callId);
                if (currentCall && ['in-progress', 'answered'].includes(currentCall.status)) {
                    showNotification(errorMessage + ' - Attempting to reconnect...', 'warning');
                    handleAudioStreamRetry(callId, listenUrl, audioContext, btn, retryCount, errorMessage);
                } else {
                    console.log('Call is no longer active, not retrying audio connection');
                    showNotification(errorMessage, 'error');
                    stopListening(callId, btn);
                }
            } else {
                showNotification(errorMessage || 'Audio stream closed', shouldRetry ? 'warning' : 'error');
                stopListening(callId, btn);
            }
        };
        
    } catch (error) {
        console.error('Error connecting to audio stream:', error);
        handleAudioStreamRetry(callId, listenUrl, audioContext, btn, retryCount, error.message);
    }
}

// Handle audio stream retry logic - NEW FUNCTION
function handleAudioStreamRetry(callId, listenUrl, audioContext, btn, retryCount, errorMessage) {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
    
    if (retryCount >= maxRetries) {
        console.error(`Max audio stream retries (${maxRetries}) exceeded for call ${callId}`);
        showNotification(`Audio connection failed after ${maxRetries} attempts`, 'error');
        stopListening(callId, btn);
        return;
    }
    
    const nextRetryCount = retryCount + 1;
    
    // Track retry attempt
    audioRetryAttempts.set(callId, {
        count: nextRetryCount,
        lastError: errorMessage,
        nextRetryAt: Date.now() + retryDelay
    });
    
    console.log(`Scheduling audio stream retry ${nextRetryCount}/${maxRetries} for call ${callId} in ${retryDelay/1000}s`);
    showNotification(`Audio connection failed. Retrying in ${retryDelay/1000}s... (${nextRetryCount}/${maxRetries})`, 'warning');
    
    setTimeout(() => {
        // Check if call still exists and listening is still desired
        const call = activeCallsMap.get(callId);
        if (call && btn.classList.contains('listening')) {
            console.log(`Retrying audio stream connection for call ${callId} (attempt ${nextRetryCount})`);
            connectToAudioStream(callId, listenUrl, audioContext, btn, nextRetryCount);
        } else {
            console.log(`Skipping retry for call ${callId} - call removed or listening stopped`);
            audioRetryAttempts.delete(callId);
        }
    }, retryDelay);
}

// Track audio stream errors for debugging - NEW FUNCTION
function trackAudioStreamError(callId, errorMessage, errorDetails) {
    if (!audioStreamErrors.has(callId)) {
        audioStreamErrors.set(callId, []);
    }
    
    const errors = audioStreamErrors.get(callId);
    errors.push({
        timestamp: new Date().toISOString(),
        message: errorMessage,
        details: errorDetails,
        type: typeof errorDetails
    });
    
    // Keep only last 10 errors per call
    if (errors.length > 10) {
        errors.splice(0, errors.length - 10);
    }
    
    console.log(`Audio error tracked for call ${callId}:`, errors[errors.length - 1]);
}

// Schedule audio retry for calls that are not yet answered - NEW FUNCTION
function scheduleAudioRetryForCall(callId, btn) {
    const retryDelay = 5000; // Check every 5 seconds
    const maxChecks = 12; // Check for 1 minute total
    let checkCount = 0;
    
    const checkInterval = setInterval(() => {
        checkCount++;
        const call = activeCallsMap.get(callId);
        
        if (!call || checkCount >= maxChecks) {
            clearInterval(checkInterval);
            return;
        }
        
        // If call is now in progress and has audio URL, try connecting
        if (call.status === 'in-progress' && call.monitor?.listenUrl) {
            clearInterval(checkInterval);
            console.log(`Call ${callId} is now in progress, attempting audio connection`);
            showNotification('Call answered! Connecting to audio stream...', 'info');
            startListening(callId, btn);
        } else if (['ended', 'failed'].includes(call.status)) {
            clearInterval(checkInterval);
            console.log(`Call ${callId} ended before audio became available`);
        }
    }, retryDelay);
}

// Handle general audio stream errors - NEW FUNCTION
function handleAudioStreamError(callId, errorMessage, btn) {
    trackAudioStreamError(callId, errorMessage, 'general_error');
    
    // Remove listening state
    if (btn) {
        btn.classList.remove('listening');
        btn.title = 'Listen to Call';
    }
    
    // Clean up audio context
    const audioContext = audioContexts.get(callId);
    if (audioContext) {
        audioContext.suspend().then(() => {
            audioContext.close();
        });
        audioContexts.delete(callId);
    }
    
    // Remove visual indicators
    const card = document.querySelector(`[data-call-id="${callId}"]`);
    if (card) {
        card.classList.remove('listening-active');
        const audioIndicator = card.querySelector('.audio-indicator');
        if (audioIndicator) {
            audioIndicator.remove();
        }
    }
}

// Stop listening to a call
function stopListening(callId, btn) {
    if (btn) {
        btn.classList.remove('listening');
        btn.title = 'Listen to Call';
    }
    
    // Close WebSocket
    const ws = activeAudioStreams.get(callId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    activeAudioStreams.delete(callId);
    
    // Stop and close audio context
    const audioContext = audioContexts.get(callId);
    if (audioContext) {
        audioContext.suspend().then(() => {
            audioContext.close();
        });
        audioContexts.delete(callId);
    }
    
    // Notify server that we're stopping listening
    try {
        apiCall(`/api/calls/${callId}/remove-listener`, { method: 'POST' }).catch(error => {
            console.warn('Failed to unregister listener with server:', error);
        });
        console.log(`Removed listener for call ${callId}`);
    } catch (error) {
        console.warn('Failed to notify server about listener removal:', error);
    }
    
    // Remove listening indicators
    const card = document.querySelector(`[data-call-id="${callId}"]`);
    if (card) {
        card.classList.remove('listening-active');
        const audioIndicator = card.querySelector('.audio-indicator');
        if (audioIndicator) {
            audioIndicator.remove();
        }
    }
    
    console.log(`Stopped listening to call ${callId}`);
}

// Initialize monitor panel
function initializeMonitorPanel() {
    console.log('Initializing monitor panel...');
    
    // Check if monitor panel elements exist
    const noCallsMessage = document.getElementById('noCallsMessage');
    const activeCallsGrid = document.getElementById('activeCallsGrid');
    const wsStatusIndicator = document.getElementById('wsStatusIndicator');
    const wsStatusText = document.getElementById('wsStatusText');
    
    if (!noCallsMessage || !activeCallsGrid) {
        console.error('Monitor panel elements not found. Retrying...');
        setTimeout(initializeMonitorPanel, 500);
        return;
    }
    
    // Update connection status if WebSocket is already connected
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        if (wsStatusIndicator && wsStatusText) {
            wsStatusIndicator.className = 'status-indicator connected';
            wsStatusText.textContent = 'Connected';
        }
    }
    
    // Set up periodic updates
    setInterval(updateCallDurations, 1000);
    
    // Initialize with no calls message
    showNoCallsMessage();
    
    // Request active calls again after initialization
    if (typeof refreshActiveCalls === 'function') {
        setTimeout(refreshActiveCalls, 500);
    }
    
    console.log('Monitor panel initialized');
}

// Handle incoming call updates from WebSocket
function handleCallUpdate(data) {
    console.log('handleCallUpdate received:', data);
    
    switch (data.type) {
        case 'call_created':
        case 'call_started':
        case 'call_initiated':
            const callData = data.call || data;
            if (callData && (callData.id || callData.callId)) {
                addCallCard(callData);
            }
            break;
            
        case 'call_ringing':
        case 'call_answered':
        case 'call_control':
            updateCallCard(data.call || { id: data.callId, status: data.type });
            break;
            
        case 'call_ended':
        case 'call_failed':
            updateCallCard(data.call || { id: data.callId, status: 'ended' });
            setTimeout(() => removeCallCard((data.call && data.call.id) || data.callId), 3000);
            break;
            
        case 'transcript_update':
            updateTranscript(data.callId, data.transcript);
            break;
            
        case 'call_transferred':
            updateCallCard({ id: data.callId, status: 'transferred' });
            setTimeout(() => removeCallCard(data.callId), 2000);
            break;
    }
    
    updateActiveCallsCount();
}

// Add new call card
function addCallCard(call) {
    console.log('Adding call card:', call.id);
    console.log('Full call object:', JSON.stringify(call, null, 2));
    
    // Store call data
    activeCallsMap.set(call.id, call);
    
    // Hide no calls message
    const noCallsElement = document.getElementById('noCallsMessage');
    if (noCallsElement) {
        noCallsElement.style.display = 'none';
    }
    
    // Get template and clone
    const template = document.getElementById('callCardTemplate');
    if (!template) {
        console.error('Call card template not found');
        return;
    }
    
    const card = template.content.cloneNode(true);
    const cardElement = card.querySelector('.call-card');
    
    // Set call ID
    cardElement.dataset.callId = call.id;
    
    // Extract customer info and metadata with comprehensive debugging
    let customerName = 'Unknown Caller';
    let phoneNumber = 'Unknown';
    let leadSource = 'N/A';
    let caseType = 'N/A';
    
    console.log('🔍 Debugging call metadata extraction:');
    console.log('call.customer:', call.customer);
    console.log('call.contact:', call.contact);
    console.log('call.metadata:', call.metadata);
    
    if (call.customer) {
        // Try to get customer name from multiple sources
        customerName = call.customer.name || 
            `${call.customer.metadata?.first_name || ''} ${call.customer.metadata?.last_name || ''}`.trim() || 
            `${call.customer.metadata?.firstName || ''} ${call.customer.metadata?.lastName || ''}`.trim() ||
            'Unknown Caller';
        phoneNumber = call.customer.number || 'Unknown';
        
        // Try to get leadSource from multiple sources, handle null values
        leadSource = call.customer.metadata?.leadSource || 
                    call.customer.leadSource || 
                    call.customer.metadata?.source || 
                    call.metadata?.leadSource ||
                    call.metadata?.source ||
                    'N/A';
        
        // Try to get caseType from multiple sources, handle null values  
        caseType = call.customer.metadata?.caseType || 
                  call.customer.caseType || 
                  call.customer.metadata?.leadType || 
                  call.customer.metadata?.case_type || 
                  call.metadata?.leadType ||
                  call.metadata?.caseType ||
                  'N/A';
        
        console.log('📊 Extracted from call.customer:', { customerName, leadSource, caseType });
    }
    
    // Check if metadata comes from contact object (for campaign calls)
    if (call.contact) {
        leadSource = call.contact.lead_source || leadSource;
        caseType = call.contact.case_type || caseType;
        customerName = `${call.contact.first_name || ''} ${call.contact.last_name || ''}`.trim() || customerName;
        console.log('📊 Enhanced from call.contact:', { customerName, leadSource, caseType });
    }
    
    // Check metadata at root level
    if (call.metadata) {
        leadSource = call.metadata.leadSource || call.metadata.source || leadSource;
        caseType = call.metadata.leadType || call.metadata.caseType || caseType;
        customerName = call.metadata.fullName || `${call.metadata.firstName || ''} ${call.metadata.lastName || ''}`.trim() || customerName;
        console.log('📊 Enhanced from call.metadata:', { customerName, leadSource, caseType });
    }
    
    // Handle null/empty values - convert to meaningful display
    if (!leadSource || leadSource === 'null' || leadSource === null) {
        leadSource = 'Direct';
    }
    if (!caseType || caseType === 'null' || caseType === null) {
        caseType = 'General';
    }
    
    console.log('✅ Final values:', { customerName, phoneNumber, leadSource, caseType });
    
    // Fill in call information
    cardElement.querySelector('.caller-name').textContent = customerName;
    cardElement.querySelector('.phone-number').textContent = phoneNumber;
    
    // Set metadata
    cardElement.querySelector('.lead-source').textContent = leadSource;
    cardElement.querySelector('.case-type').textContent = caseType;
    
    // Set initial status
    updateCallStatus(cardElement, call.status || 'queued');
    
    // Add control button event handlers
    cardElement.querySelectorAll('.control-btn').forEach(btn => {
        btn.dataset.callId = call.id;
    });
    
    // Initialize debug button visibility
    updateDebugButtonVisibility(cardElement, call.status || 'queued');
    
    // Add to grid
    const activeCallsGrid = document.getElementById('activeCallsGrid');
    if (activeCallsGrid) {
        activeCallsGrid.appendChild(cardElement);
    }
    
    // Start duration timer if call is in progress
    if (call.status === 'in-progress' && call.answeredAt) {
        startDurationTimer(call.id, call.answeredAt);
    }
}

// Update existing call card
function updateCallCard(updates) {
    const callId = updates.id || updates.callId;
    if (!callId) {
        console.error('Cannot update call card: missing call ID', updates);
        return;
    }
    
    const card = document.querySelector(`[data-call-id="${callId}"]`);
    if (!card) return;
    
    // Update stored data
    const callData = activeCallsMap.get(callId);
    if (callData) {
        activeCallsMap.set(callId, { ...callData, ...updates });
    }
    
    // Update status if changed
    if (updates.status) {
        updateCallStatus(card, updates.status);
        
        if (updates.status === 'in-progress' && updates.answeredAt) {
            startDurationTimer(callId, updates.answeredAt);
        }
        
        // Show/hide debug button based on status and environment
        updateDebugButtonVisibility(card, updates.status);
    }
    
    // Update mute button state if needed
    if (updates.assistantMuted !== undefined) {
        const muteBtn = card.querySelector('[data-action="mute"]');
        if (muteBtn) {
            muteBtn.classList.toggle('active', updates.assistantMuted);
            muteBtn.title = updates.assistantMuted ? 'Unmute Assistant' : 'Mute Assistant';
        }
    }
}

// Update debug button visibility based on call status and environment
function updateDebugButtonVisibility(card, status) {
    const debugBtn = card.querySelector('.control-btn.debug');
    if (!debugBtn) return;
    
    // Show debug button in development AND production environments (including Railway)
    // This allows debugging in deployed environments when needed
    const isDevelopment = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1' || 
                         window.location.hostname.includes('dev');
    
    const isRailwayOrProduction = window.location.hostname.includes('railway.app') || 
                                 window.location.hostname.includes('up.railway.app') ||
                                 window.location.protocol === 'https:';
    
    const answeredStatuses = ['in-progress', 'answered', 'active', 'connected', 'conversation-started'];
    const isNotAnswered = !answeredStatuses.includes(status);
    
    // Show button if: (development OR production/railway) AND call not answered
    // Also show if URL has debug parameter for emergency access
    const hasDebugParam = window.location.search.includes('debug=true');
    
    const shouldShow = (isDevelopment || isRailwayOrProduction || hasDebugParam) && isNotAnswered;
    
    // Debug logging to help troubleshoot visibility issues
    console.log(`Debug button visibility check:`, {
        hostname: window.location.hostname,
        protocol: window.location.protocol,
        isDevelopment,
        isRailwayOrProduction,
        hasDebugParam,
        status,
        isNotAnswered,
        shouldShow
    });
    
    if (shouldShow) {
        debugBtn.style.display = 'flex';
        debugBtn.style.background = '#fef3c7';
        debugBtn.style.color = '#92400e';
        debugBtn.title = `🔧 DEBUG: Force mark as answered (Current: ${status})`;
    } else {
        debugBtn.style.display = 'none';
    }
}

// Remove call card
function removeCallCard(callId) {
    const card = document.querySelector(`[data-call-id="${callId}"]`);
    if (card) {
        // Stop any active audio streams first
        const listenBtn = card.querySelector('[data-action="listen"]');
        if (listenBtn && listenBtn.classList.contains('listening')) {
            stopListening(callId, listenBtn);
        }
        
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.remove();
            activeCallsMap.delete(callId);
            
            if (activeCallsMap.size === 0) {
                showNoCallsMessage();
            }
            updateActiveCallsCount();
        }, 300);
    }
}

// Update call status badge
function updateCallStatus(card, status) {
    const badge = card.querySelector('.status-badge');
    if (!badge) return;
    
    badge.className = 'status-badge';
    
    switch (status) {
        case 'queued':
            badge.classList.add('queued');
            badge.textContent = 'Queued';
            break;
        case 'ringing':
            badge.classList.add('ringing');
            badge.textContent = 'Ringing';
            break;
        case 'in-progress':
        case 'answered':
            badge.classList.add('in-progress');
            badge.textContent = 'In Progress';
            break;
        case 'ended':
            badge.classList.add('ended');
            badge.textContent = 'Ended';
            break;
        case 'failed':
            badge.classList.add('ended');
            badge.textContent = 'Failed';
            break;
        case 'transferred':
            badge.classList.add('ended');
            badge.textContent = 'Transferred';
            break;
        case 'no-answer':
            badge.classList.add('ended');
            badge.textContent = 'No Answer';
            break;
        default:
            badge.textContent = status;
    }
}

// Update transcript
function updateTranscript(callId, transcript) {
    const card = document.querySelector(`[data-call-id="${callId}"]`);
    if (!card) return;
    
    const transcriptContent = card.querySelector('.transcript-content');
    if (!transcriptContent) return;
    
    // Remove placeholder if exists
    const placeholder = transcriptContent.querySelector('.transcript-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    // Handle partial transcripts - update in place, final transcripts - add new
    const transcriptType = transcript.transcriptType || 'final';
    const speaker = transcript.speaker === 'assistant' ? 'assistant' : 'customer';
    
    if (transcriptType === 'partial') {
        // For partial transcripts, find and update the last partial entry from same speaker
        let lastPartialEntry = null;
        const entries = transcriptContent.querySelectorAll('.transcript-entry');
        
        // Find last partial entry from same speaker
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.classList.contains(speaker) && entry.dataset.transcriptType === 'partial') {
                lastPartialEntry = entry;
                break;
            }
        }
        
        if (lastPartialEntry) {
            // Update existing partial entry
            const textSpan = lastPartialEntry.querySelector('.text');
            if (textSpan) {
                textSpan.textContent = transcript.text;
                lastPartialEntry.dataset.transcriptType = 'partial';
                lastPartialEntry.classList.add('partial-transcript');
            }
        } else {
            // Create new partial entry
            const entry = document.createElement('div');
            entry.className = `transcript-entry ${speaker} partial-transcript`;
            entry.dataset.transcriptType = 'partial';
            entry.innerHTML = `
                <span class="speaker">${speaker === 'assistant' ? 'Assistant' : 'Customer'}:</span>
                <span class="text">${transcript.text}</span>
                <span class="partial-indicator">...</span>
            `;
            transcriptContent.appendChild(entry);
        }
    } else {
        // Final transcript - convert any existing partial to final or add new
        const entries = transcriptContent.querySelectorAll('.transcript-entry');
        let updatedPartial = false;
        
        // Check if last entry is partial from same speaker
        if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            if (lastEntry.classList.contains(speaker) && 
                lastEntry.dataset.transcriptType === 'partial') {
                // Convert partial to final
                const textSpan = lastEntry.querySelector('.text');
                const partialIndicator = lastEntry.querySelector('.partial-indicator');
                
                if (textSpan) {
                    textSpan.textContent = transcript.text;
                    lastEntry.dataset.transcriptType = 'final';
                    lastEntry.classList.remove('partial-transcript');
                    if (partialIndicator) {
                        partialIndicator.remove();
                    }
                    updatedPartial = true;
                }
            }
        }
        
        if (!updatedPartial) {
            // Add new final transcript entry
            const entry = document.createElement('div');
            entry.className = `transcript-entry ${speaker}`;
            entry.dataset.transcriptType = 'final';
            entry.innerHTML = `
                <span class="speaker">${speaker === 'assistant' ? 'Assistant' : 'Customer'}:</span>
                <span class="text">${transcript.text}</span>
            `;
            transcriptContent.appendChild(entry);
        }
    }
    
    // Auto-scroll to bottom
    transcriptContent.scrollTop = transcriptContent.scrollHeight;
    
    // Keep only last 20 entries (increased for better conversation flow)
    const entries = transcriptContent.querySelectorAll('.transcript-entry');
    if (entries.length > 20) {
        entries[0].remove();
    }
    
    // Check for alerts only on final transcripts
    if (transcriptType === 'final') {
        checkForAlerts(callId, transcript);
    }
}

// Enhanced alert system for customer issues
function checkForAlerts(callId, transcript) {
    if (transcript.speaker !== 'customer' && transcript.speaker !== 'user') return;
    
    const text = transcript.text.toLowerCase();
    
    // Categorize alert keywords
    const alertKeywords = {
        transfer: ['supervisor', 'manager', 'transfer', 'speak to someone else', 'real person', 'human agent', 'get me someone else', 'escalate'],
        dissatisfaction: ['unsatisfied', 'unhappy', 'disappointed', 'frustrated', 'angry', 'upset', 'terrible', 'horrible', 'awful', 'disgusted'],
        ai_detection: ['robot', 'bot', 'artificial', 'not real', 'computer', 'automated', 'fake voice', 'recorded'],
        refusal: ["don't want to talk", "not interested", "stop calling", "remove me", "take me off", "don't call again"],
        confusion: ["don't understand", "confused", "what are you talking about", "makes no sense", "unclear"]
    };
    
    let alertType = null;
    let matchedKeywords = [];
    
    // Check for each category
    for (const [category, keywords] of Object.entries(alertKeywords)) {
        const matches = keywords.filter(keyword => text.includes(keyword));
        if (matches.length > 0) {
            alertType = category;
            matchedKeywords = matches;
            break;
        }
    }
    
    if (alertType) {
        // Visual alert on the call card
        const card = document.querySelector(`[data-call-id="${callId}"]`);
        if (card) {
            card.classList.add('alert-active', `alert-${alertType}`);
            
            // Add alert indicator
            const statusBadge = card.querySelector('.status-badge');
            if (statusBadge && !statusBadge.classList.contains('alert-requested')) {
                statusBadge.classList.add('alert-requested', `alert-${alertType}`);
                statusBadge.innerHTML = `${statusBadge.textContent} - ${alertType.toUpperCase()} ALERT`;
            }
            
            // Add alert banner to card
            if (!card.querySelector('.alert-banner')) {
                const alertBanner = document.createElement('div');
                alertBanner.className = `alert-banner alert-${alertType}`;
                alertBanner.innerHTML = `
                    <strong>${alertType.toUpperCase()} DETECTED:</strong> "${transcript.text}"
                    <button onclick="dismissAlert('${callId}')" class="dismiss-btn">×</button>
                `;
                card.insertBefore(alertBanner, card.firstChild);
            }
        }
        
        // Show notification
        showNotification(`${alertType.toUpperCase()} detected in call ${callId}`, 'warning');
        
        // Play alert sound
        playAlertSound();
        
        // Log for monitoring
        console.warn(`${alertType} alert detected in call ${callId}:`, {
            text: transcript.text,
            keywords: matchedKeywords,
            timestamp: new Date().toISOString()
        });
    }
}

// Function to dismiss alerts
function dismissAlert(callId) {
    const card = document.querySelector(`[data-call-id="${callId}"]`);
    if (card) {
        card.classList.remove('alert-active');
        card.classList.remove(...Array.from(card.classList).filter(c => c.startsWith('alert-')));
        
        const alertBanner = card.querySelector('.alert-banner');
        if (alertBanner) alertBanner.remove();
        
        const statusBadge = card.querySelector('.status-badge');
        if (statusBadge) {
            statusBadge.classList.remove('alert-requested');
            statusBadge.classList.remove(...Array.from(statusBadge.classList).filter(c => c.startsWith('alert-')));
            statusBadge.textContent = statusBadge.textContent.split(' - ')[0];
        }
    }
}

// Start duration timer
function startDurationTimer(callId, startTime) {
    const updateDuration = () => {
        const card = document.querySelector(`[data-call-id="${callId}"]`);
        if (!card) return;
        
        const durationElement = card.querySelector('.call-duration');
        if (!durationElement) return;
        
        const duration = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        
        durationElement.textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };
    
    updateDuration();
    const call = activeCallsMap.get(callId);
    if (call) {
        call.durationInterval = setInterval(updateDuration, 1000);
    }
}

// Update all call durations
function updateCallDurations() {
    activeCallsMap.forEach((call, callId) => {
        if (call.status === 'in-progress' && call.answeredAt && !call.durationInterval) {
            startDurationTimer(callId, call.answeredAt);
        }
    });
}

// Control button handlers
async function muteAssistant(btn) {
    const callId = btn.dataset.callId;
    const isMuted = btn.classList.contains('active');
    
    try {
        const response = await fetch(`/api/calls/${callId}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: isMuted ? 'unmute' : 'mute'
            })
        });
        
        if (!response.ok) throw new Error('Failed to control call');
        
    } catch (error) {
        console.error('Error controlling call:', error);
        showNotification('Failed to control call', 'error');
    }
}

function sayMessage(btn) {
    currentCallForAction = btn.dataset.callId;
    const modal = document.getElementById('sayMessageModal');
    if (modal) {
        modal.style.display = 'flex';
        const textArea = document.getElementById('sayMessageText');
        if (textArea) {
            textArea.focus();
        }
    }
}

async function sendSayMessage() {
    const messageElement = document.getElementById('sayMessageText');
    const endCallElement = document.getElementById('endCallAfterMessage');
    
    if (!messageElement) return;
    
    const message = messageElement.value.trim();
    const endCall = endCallElement ? endCallElement.checked : false;
    
    if (!message) {
        showNotification('Please enter a message', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/calls/${currentCallForAction}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'say',
                data: {
                    message,
                    endCallAfterSpoken: endCall
                }
            })
        });
        
        if (!response.ok) throw new Error('Failed to send message');
        
        closeSayMessage();
        showNotification('Message sent successfully', 'success');
        
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
    }
}

function closeSayMessage() {
    const modal = document.getElementById('sayMessageModal');
    const textArea = document.getElementById('sayMessageText');
    const checkbox = document.getElementById('endCallAfterMessage');
    
    if (modal) modal.style.display = 'none';
    if (textArea) textArea.value = '';
    if (checkbox) checkbox.checked = false;
    
    currentCallForAction = null;
}

function transferCall(btn) {
    currentCallForAction = btn.dataset.callId;
    const modal = document.getElementById('transferCallModal');
    
    if (modal) {
        modal.style.display = 'flex';
        
        // Set up dropdown change handler
        const dropdown = document.getElementById('transferDestination');
        const customField = document.getElementById('customNumberField');
        const messageField = document.getElementById('transferMessage');
        
        if (dropdown) {
            // Set default selection and message
            dropdown.value = '+15703560262';
            updateTransferMessage();
            
            // Add change handler for dropdown
            dropdown.onchange = function() {
                if (this.value === 'custom') {
                    customField.style.display = 'block';
                    document.getElementById('customTransferNumber').focus();
                } else {
                    customField.style.display = 'none';
                }
                updateTransferMessage();
            };
            
            dropdown.focus();
        }
    }
}

function updateTransferMessage() {
    const dropdown = document.getElementById('transferDestination');
    const messageField = document.getElementById('transferMessage');
    
    if (dropdown && messageField) {
        const selectedOption = dropdown.options[dropdown.selectedIndex];
        const defaultMessage = selectedOption.getAttribute('data-message');
        
        if (defaultMessage && !messageField.value.trim()) {
            messageField.value = defaultMessage;
        }
    }
}

async function executeTransfer() {
    const dropdown = document.getElementById('transferDestination');
    const customNumberField = document.getElementById('customTransferNumber');
    const messageElement = document.getElementById('transferMessage');
    
    if (!dropdown) return;
    
    let number;
    let transferMessage = messageElement ? messageElement.value.trim() : '';
    
    // Get the selected destination
    if (dropdown.value === 'custom') {
        if (!customNumberField || !customNumberField.value.trim()) {
            showNotification('Please enter a custom phone number', 'error');
            customNumberField?.focus();
            return;
        }
        number = customNumberField.value.trim();
    } else {
        number = dropdown.value;
    }
    
    if (!number) {
        showNotification('Please select a transfer destination', 'error');
        return;
    }
    
    // Format number to E.164 if needed (for custom numbers)
    if (dropdown.value === 'custom') {
        if (!number.startsWith('+')) {
            // Remove all non-numeric characters
            const cleaned = number.replace(/\D/g, '');
            
            // Add US country code if 10 digits
            if (cleaned.length === 10) {
                number = '+1' + cleaned;
            } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
                number = '+' + cleaned;
            } else {
                showNotification('Please enter a valid phone number with country code', 'error');
                return;
            }
        }
        
        // Validate E.164 format for custom numbers
        const e164Regex = /^\+[1-9]\d{1,14}$/;
        if (!e164Regex.test(number)) {
            showNotification('Invalid phone number format. Use E.164 format (e.g., +12345678900)', 'error');
            return;
        }
    }
    
    // Set default message if empty
    if (!transferMessage) {
        const selectedOption = dropdown.options[dropdown.selectedIndex];
        transferMessage = selectedOption.getAttribute('data-message') || 'Transferring your call now.';
    }
    
    try {
        showNotification('Initiating transfer via VAPI Direct Control API...', 'info');
        
        const response = await fetch(`/api/calls/${currentCallForAction}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destination: {
                    number: number,
                    message: transferMessage
                },
                message: transferMessage
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to transfer call');
        }
        
        closeTransferCall();
        
        const destinationLabel = dropdown.value === 'custom' ? 'Custom Number' : 
                                dropdown.options[dropdown.selectedIndex].text.split(' - ')[0];
        
        showNotification(`Call transferred successfully to ${destinationLabel} (${number}) via Direct Control API`, 'success');
        
        // Log the transfer method for debugging
        console.log('Transfer completed:', {
            method: result.method,
            destination: number,
            destinationLabel: destinationLabel,
            message: transferMessage
        });
        
    } catch (error) {
        console.error('Error transferring call via Direct Control API:', error);
        showNotification('Failed to transfer call: ' + error.message, 'error');
    }
}

function closeTransferCall() {
    const modal = document.getElementById('transferCallModal');
    const dropdown = document.getElementById('transferDestination');
    const customField = document.getElementById('customNumberField');
    const customNumberInput = document.getElementById('customTransferNumber');
    const messageInput = document.getElementById('transferMessage');
    
    if (modal) modal.style.display = 'none';
    if (dropdown) {
        dropdown.value = '+15703560262'; // Reset to default
        dropdown.onchange = null; // Remove event handler
    }
    if (customField) customField.style.display = 'none';
    if (customNumberInput) customNumberInput.value = '';
    if (messageInput) messageInput.value = '';
    
    currentCallForAction = null;
}

async function endCall(btn) {
    const callId = btn.dataset.callId;
    
    if (!confirm('Are you sure you want to end this call?')) return;
    
    try {
        const response = await fetch(`/api/calls/${callId}/end`, {
            method: 'POST'
        });
        
        if (!response.ok) throw new Error('Failed to end call');
        
        showNotification('Call ended', 'info');
        
    } catch (error) {
        console.error('Error ending call:', error);
        showNotification('Failed to end call', 'error');
    }
}

async function showCallDetails(btn) {
    const callId = btn.dataset.callId;
    selectedCallId = callId;
    
    try {
        const response = await fetch(`/api/calls/${callId}`);
        if (!response.ok) throw new Error('Failed to get call details');
        
        const { call } = await response.json();
        
        const detailsHtml = `
            <div class="call-details">
                <h4>Call Information</h4>
                <div class="detail-item">
                    <strong>Call ID:</strong> ${call.id}
                </div>
                <div class="detail-item">
                    <strong>Status:</strong> ${call.status}
                </div>
                <div class="detail-item">
                    <strong>Customer:</strong> ${call.customer?.name || 'Unknown'}
                </div>
                <div class="detail-item">
                    <strong>Phone:</strong> ${call.customer?.number || 'Unknown'}
                </div>
                <div class="detail-item">
                    <strong>Duration:</strong> ${call.duration ? formatDuration(call.duration) : 'N/A'}
                </div>
                
                <h4>Metadata</h4>
                <div class="detail-item">
                    <strong>Lead Source:</strong> ${call.customer?.metadata?.leadSource || 'N/A'}
                </div>
                <div class="detail-item">
                    <strong>Case Type:</strong> ${call.customer?.metadata?.caseType || 'N/A'}
                </div>
                <div class="detail-item">
                    <strong>Organization ID:</strong> ${call.customer?.metadata?.organizationId || 'N/A'}
                </div>
                <div class="detail-item">
                    <strong>Lead ID:</strong> ${call.customer?.metadata?.leadId || 'N/A'}
                </div>
                
                <h4>Call Timeline</h4>
                <div class="timeline">
                    ${call.createdAt ? `<div class="timeline-item">Created: ${formatTime(call.createdAt)}</div>` : ''}
                    ${call.ringingAt ? `<div class="timeline-item">Ringing: ${formatTime(call.ringingAt)}</div>` : ''}
                    ${call.answeredAt ? `<div class="timeline-item">Answered: ${formatTime(call.answeredAt)}</div>` : ''}
                    ${call.endedAt ? `<div class="timeline-item">Ended: ${formatTime(call.endedAt)}</div>` : ''}
                </div>
                
                ${call.monitor ? `
                <h4>Monitor URLs</h4>
                <div class="detail-item">
                    <strong>Listen URL:</strong> <code>${call.monitor.listenUrl}</code>
                </div>
                <div class="detail-item">
                    <strong>Control URL:</strong> <code>${call.monitor.controlUrl}</code>
                </div>
                ` : ''}
            </div>
        `;
        
        const contentElement = document.getElementById('callDetailsContent');
        const modalElement = document.getElementById('callDetailsModal');
        
        if (contentElement) contentElement.innerHTML = detailsHtml;
        if (modalElement) modalElement.style.display = 'flex';
        
    } catch (error) {
        console.error('Error getting call details:', error);
        showNotification('Failed to get call details', 'error');
    }
}

function closeCallDetails() {
    const modal = document.getElementById('callDetailsModal');
    if (modal) modal.style.display = 'none';
    selectedCallId = null;
}

// Play alert sound
function playAlertSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
        console.error('Error playing alert sound:', error);
    }
}

// Helper functions
function showNoCallsMessage() {
    const noCallsMessage = document.getElementById('noCallsMessage');
    const activeCallsGrid = document.getElementById('activeCallsGrid');
    
    if (noCallsMessage && activeCallsGrid) {
        noCallsMessage.style.display = 'block';
        activeCallsGrid.innerHTML = '';
    }
}

function updateActiveCallsCount() {
    const countElement = document.getElementById('activeCallsCount');
    if (countElement) {
        countElement.textContent = activeCallsMap.size;
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
}

function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Use global notification system if available
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    }
}

// Event handlers
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-btn')) {
        const modal = e.target.closest('.modal-content').parentElement;
        if (modal) modal.style.display = 'none';
    }
    
    if (e.target.classList.contains('say-message-modal') || 
        e.target.classList.contains('transfer-call-modal') ||
        e.target.classList.contains('call-details-modal')) {
        e.target.style.display = 'none';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.say-message-modal, .transfer-call-modal, .call-details-modal')
            .forEach(modal => modal.style.display = 'none');
    }
});

// Styles
const audioStyles = document.createElement('style');
audioStyles.textContent = `
.audio-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: #dcfce7;
    color: #16a34a;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    animation: pulse 2s infinite;
}

.audio-indicator svg {
    width: 16px;
    height: 16px;
}

.pulse-dot {
    animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
    0%, 100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.5;
        transform: scale(1.5);
    }
}

.call-card.listening-active {
    border-color: #16a34a;
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.1);
}

.control-btn.listening {
    background: #dcfce7;
    color: #166534;
    animation: pulse 2s infinite;
}

.control-btn.listening:hover {
    background: #bbf7d0;
}

@keyframes pulse {
    0% {
        box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
    }
    70% {
        box-shadow: 0 0 0 10px rgba(34, 197, 94, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
    }
}

.call-details {
    max-height: 60vh;
    overflow-y: auto;
}

.call-details h4 {
    margin: 20px 0 10px;
    color: #374151;
    font-size: 16px;
}

.call-details h4:first-child {
    margin-top: 0;
}

.detail-item {
    margin: 10px 0;
    font-size: 14px;
}

.detail-item strong {
    color: #4b5563;
    margin-right: 8px;
}

.detail-item code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    word-break: break-all;
}

.timeline {
    margin-top: 10px;
}

.timeline-item {
    padding: 8px 0;
    border-left: 2px solid #e5e7eb;
    padding-left: 15px;
    margin-left: 10px;
    font-size: 14px;
    color: #6b7280;
}

.timeline-item:first-child {
    border-left-color: #10b981;
}

.timeline-item:last-child {
    border-left-color: #ef4444;
}

.alert-banner {
    padding: 8px 12px;
    margin-bottom: 10px;
    border-radius: 6px;
    font-size: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.alert-banner.alert-transfer {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #f59e0b;
}

.alert-banner.alert-dissatisfaction {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #ef4444;
}

.alert-banner.alert-ai_detection {
    background: #e0e7ff;
    color: #3730a3;
    border: 1px solid #6366f1;
}

.dismiss-btn {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
}

.call-card.alert-active {
    border: 2px solid #f59e0b;
    animation: pulse-alert 2s infinite;
}

@keyframes pulse-alert {
    0% {
        box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4);
    }
    70% {
        box-shadow: 0 0 0 10px rgba(245, 158, 11, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    }
}

.status-badge.alert-requested {
    background-color: #fef3c7;
    color: #92400e;
    font-weight: bold;
    animation: blink 1s infinite;
}

@keyframes blink {
    0%, 50%, 100% {
        opacity: 1;
    }
    25%, 75% {
        opacity: 0.5;
    }
}

/* Partial transcript styling */
.transcript-entry.partial-transcript {
    opacity: 0.7;
    font-style: italic;
    background-color: rgba(59, 130, 246, 0.05);
    border-left: 3px solid #3b82f6;
    padding-left: 8px;
    margin-left: 4px;
    border-radius: 4px;
}

.partial-indicator {
    color: #3b82f6;
    font-weight: bold;
    margin-left: 4px;
    animation: pulse-dots 1.5s infinite;
}

@keyframes pulse-dots {
    0%, 50%, 100% {
        opacity: 1;
    }
    25%, 75% {
        opacity: 0.3;
    }
}

.transcript-entry[data-transcript-type="final"] {
    border-left: 2px solid transparent;
    padding-left: 0;
}

.transcript-entry.assistant.partial-transcript {
    border-left-color: #0969da;
    background-color: rgba(9, 105, 218, 0.05);
}

.transcript-entry.customer.partial-transcript {
    border-left-color: #10b981;
    background-color: rgba(16, 185, 129, 0.05);
}
`;
document.head.appendChild(audioStyles);

// Global exports
window.initializeMonitorPanel = initializeMonitorPanel;
window.handleCallUpdate = handleCallUpdate;
window.toggleListen = toggleListen;
window.muteAssistant = muteAssistant;
window.sayMessage = sayMessage;
window.sendSayMessage = sendSayMessage;
window.closeSayMessage = closeSayMessage;
window.transferCall = transferCall;
window.executeTransfer = executeTransfer;
window.closeTransferCall = closeTransferCall;
window.endCall = endCall;
window.showCallDetails = showCallDetails;
window.closeCallDetails = closeCallDetails;
window.dismissAlert = dismissAlert;

// DEBUG: Force call to be marked as answered - for testing status detection issues
async function forceCallAnswered(btn) {
    try {
        const callCard = btn.closest('.call-card');
        const callId = callCard.dataset.callId;
        
        if (!callId) {
            showNotification('Cannot find call ID', 'error');
            return;
        }
        
        console.log(`🔧 DEBUG: Force answering call ${callId}`);
        
        const response = await apiCall(`/api/calls/debug/${callId}/force-answered`, {
            method: 'POST'
        });
        
        if (response.success) {
            showNotification(`🔧 DEBUG: Call ${callId} forced to answered status`, 'success');
            console.log('Force answered response:', response);
            
            // The status update will come via WebSocket, so no need to manually update UI
        } else {
            showNotification('Failed to force answer call', 'error');
        }
        
    } catch (error) {
        console.error('Error forcing call answered:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

window.forceCallAnswered = forceCallAnswered;