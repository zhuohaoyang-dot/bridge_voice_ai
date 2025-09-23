let ws = null;
let reconnectAttempts = 0;
let initialConnectAttempts = 0;
const maxReconnectAttempts = 5;
const maxInitialConnectAttempts = 10;
const reconnectDelay = 3000;
const initialConnectDelay = 2000;

// Initialize WebSocket connection
function initializeWebSocket() {
    const wsUrl = `ws://localhost:8010`;
    
    updateConnectionStatus('connecting');
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = handleWebSocketOpen;
        ws.onmessage = handleWebSocketMessage;
        ws.onclose = handleWebSocketClose;
        ws.onerror = handleWebSocketError;
        
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        handleInitialConnectionFailure();
    }
}

// Handle initial connection failures (server might still be starting)
function handleInitialConnectionFailure() {
    initialConnectAttempts++;
    
    if (initialConnectAttempts <= maxInitialConnectAttempts) {
        console.log(`WebSocket initial connection attempt ${initialConnectAttempts}/${maxInitialConnectAttempts}, retrying in ${initialConnectDelay}ms...`);
        updateConnectionStatus('connecting');
        setTimeout(initializeWebSocket, initialConnectDelay);
    } else {
        console.error('Failed to establish initial WebSocket connection after maximum attempts');
        updateConnectionStatus('disconnected');
    }
}

// Handle WebSocket open
function handleWebSocketOpen() {
    console.log('WebSocket connected');
    reconnectAttempts = 0;
    initialConnectAttempts = 0; // Reset initial connection attempts on success
    updateConnectionStatus('connected');
    
    // Update global ws reference
    window.ws = ws;
    
    // Request active calls
    ws.send(JSON.stringify({
        type: 'get_active_calls'
    }));
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(event) {
    try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'connection':
                console.log('Connected to server:', data.message);
                window.clientId = data.clientId;
                break;
                
            case 'call_created':
            case 'call_started':
            case 'call_ringing':
            case 'call_answered':
            case 'call_ended':
            case 'call_ending':
            case 'call_failed':
            case 'call_transferred':
            case 'call_control':
            case 'transcript_update':
            case 'call_initiated':
            case 'call_status_update':
            case 'call_removed_from_monitor':
                // Forward to monitor handler
                if (typeof handleCallUpdate === 'function') {
                    handleCallUpdate(data);
                }
                break;
                
            case 'campaign_update':
            case 'campaign_completed':
            case 'campaign_stopped':
                // Forward to campaign handler
                if (typeof handleCampaignUpdate === 'function') {
                    handleCampaignUpdate(data);
                }
                break;
                
            case 'active_calls':
                // Clear existing calls first
                if (typeof window.activeCallsMap !== 'undefined' && window.activeCallsMap) {
                    window.activeCallsMap.clear();
                }
                
                // Handle initial load of active calls
                if (data.calls && Array.isArray(data.calls)) {
                    console.log(`Loading ${data.calls.length} active calls`);
                    
                    if (data.calls.length > 0) {
                        data.calls.forEach(call => {
                            if (typeof addCallCard === 'function') {
                                addCallCard(call);
                            }
                        });
                    } else {
                        // Only show no calls message if the function and elements exist
                        if (typeof showNoCallsMessage === 'function') {
                            // Delay to ensure DOM is ready
                            setTimeout(() => {
                                showNoCallsMessage();
                            }, 100);
                        }
                    }
                }
                break;
                
            case 'error':
                console.error('Server error:', data.message);
                if (typeof showNotification === 'function') {
                    showNotification(data.message, 'error');
                }
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
        
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
}

// Handle WebSocket close
function handleWebSocketClose(event) {
    console.log('WebSocket disconnected:', event.code, event.reason);
    updateConnectionStatus('disconnected');
    ws = null;
    window.ws = null;
    
    // Attempt to reconnect
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Reconnecting in ${reconnectDelay / 1000} seconds... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        
        setTimeout(() => {
            initializeWebSocket();
        }, reconnectDelay);
    } else {
        if (typeof showNotification === 'function') {
            showNotification('Connection to server lost. Please refresh the page.', 'error');
        }
    }
}

// Handle WebSocket error
function handleWebSocketError(error) {
    console.error('WebSocket error:', error);
    
    // If we haven't established initial connection yet, handle differently
    if (initialConnectAttempts < maxInitialConnectAttempts && (!ws || ws.readyState === WebSocket.CONNECTING)) {
        handleInitialConnectionFailure();
    } else {
        updateConnectionStatus('disconnected');
    }
}

// Update connection status indicator
function updateConnectionStatus(status) {
    console.log('Updating connection status to:', status);
    
    const indicator = document.getElementById('wsStatusIndicator');
    const text = document.getElementById('wsStatusText');
    
    if (!indicator || !text) {
        console.warn('Connection status elements not found, will retry...');
        setTimeout(() => updateConnectionStatus(status), 1000);
        return;
    }
    
    switch (status) {
        case 'connected':
            indicator.className = 'status-indicator connected';
            text.textContent = 'Connected';
            break;
        case 'disconnected':
            indicator.className = 'status-indicator disconnected';
            text.textContent = 'Disconnected';
            break;
        case 'connecting':
            indicator.className = 'status-indicator';
            text.textContent = 'Connecting...';
            break;
    }
}

// Send message via WebSocket
function sendWebSocketMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
    } else {
        console.error('WebSocket is not connected');
        if (typeof showNotification === 'function') {
            showNotification('Connection lost. Please refresh the page.', 'error');
        }
        return false;
    }
}

// Subscribe to specific call updates
function subscribeToCall(callId) {
    sendWebSocketMessage({
        type: 'subscribe_call',
        callId
    });
}

// Unsubscribe from call updates
function unsubscribeFromCall(callId) {
    sendWebSocketMessage({
        type: 'unsubscribe_call',
        callId
    });
}

// Subscribe to campaign updates
function subscribeToCampaign(campaignId) {
    sendWebSocketMessage({
        type: 'subscribe_campaign',
        campaignId
    });
}

// Request active calls refresh
function refreshActiveCalls() {
    sendWebSocketMessage({
        type: 'get_active_calls'
    });
}

// Expose functions globally
window.initializeWebSocket = initializeWebSocket;
window.updateConnectionStatus = updateConnectionStatus;
window.sendWebSocketMessage = sendWebSocketMessage;
window.subscribeToCall = subscribeToCall;
window.unsubscribeFromCall = unsubscribeFromCall;
window.subscribeToCampaign = subscribeToCampaign;
window.refreshActiveCalls = refreshActiveCalls;

// Initialize WebSocket on load
document.addEventListener('DOMContentLoaded', () => {
    // Don't initialize here - let app.js handle it after components load
});