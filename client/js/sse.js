/**
 * Server-Sent Events client for real-time updates
 * Replaces WebSocket functionality for Vercel deployment
 */

class SSEClient {
    constructor() {
        this.eventSource = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        this.eventHandlers = new Map();
        this.pollingIntervals = new Map();
    }

    connect() {
        try {
            // Close existing connection if any
            this.disconnect();

            const baseUrl = window.location.origin;
            this.eventSource = new EventSource(`${baseUrl}/api/sse/events`);

            this.eventSource.onopen = () => {
                console.log('SSE connection established');
                this.connected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                
                // Trigger connected event
                this.emit('connected', { timestamp: new Date().toISOString() });
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing SSE message:', error);
                }
            };

            this.eventSource.onerror = (error) => {
                console.error('SSE connection error:', error);
                this.connected = false;
                
                if (this.eventSource.readyState === EventSource.CLOSED) {
                    this.attemptReconnect();
                }
            };

        } catch (error) {
            console.error('Error establishing SSE connection:', error);
            this.attemptReconnect();
        }
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.connected = false;
        
        // Stop all polling intervals
        this.pollingIntervals.forEach((interval) => {
            clearInterval(interval);
        });
        this.pollingIntervals.clear();
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.emit('max_reconnect_attempts_reached');
            return;
        }

        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay}ms`);

        setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);

        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }

    handleMessage(data) {
        const { type, data: messageData } = data;
        this.emit(type, messageData);
    }

    // Event handling
    on(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
    }

    off(eventType, handler) {
        if (this.eventHandlers.has(eventType)) {
            const handlers = this.eventHandlers.get(eventType);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    emit(eventType, data) {
        if (this.eventHandlers.has(eventType)) {
            this.eventHandlers.get(eventType).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${eventType}:`, error);
                }
            });
        }
    }

    // Polling-based data fetching (fallback for when SSE is not sufficient)
    startPolling(endpoint, interval = 5000, eventType = 'poll_update') {
        // Stop existing polling for this endpoint
        if (this.pollingIntervals.has(endpoint)) {
            clearInterval(this.pollingIntervals.get(endpoint));
        }

        const pollFunction = async () => {
            try {
                const response = await fetch(`${window.location.origin}/api/sse${endpoint}`);
                if (response.ok) {
                    const data = await response.json();
                    this.emit(eventType, data);
                }
            } catch (error) {
                console.error(`Polling error for ${endpoint}:`, error);
            }
        };

        // Initial call
        pollFunction();

        // Set up interval
        const intervalId = setInterval(pollFunction, interval);
        this.pollingIntervals.set(endpoint, intervalId);

        return intervalId;
    }

    stopPolling(endpoint) {
        if (this.pollingIntervals.has(endpoint)) {
            clearInterval(this.pollingIntervals.get(endpoint));
            this.pollingIntervals.delete(endpoint);
        }
    }

    // Utility methods for common operations
    async fetchActiveCampaigns() {
        try {
            const response = await fetch(`${window.location.origin}/api/sse/campaigns/active`);
            return response.ok ? await response.json() : null;
        } catch (error) {
            console.error('Error fetching active campaigns:', error);
            return null;
        }
    }

    async fetchLiveCalls() {
        try {
            const response = await fetch(`${window.location.origin}/api/sse/calls/live`);
            return response.ok ? await response.json() : null;
        } catch (error) {
            console.error('Error fetching live calls:', error);
            return null;
        }
    }

    async fetchCallDetails(callId) {
        try {
            const response = await fetch(`${window.location.origin}/api/sse/calls/${callId}`);
            return response.ok ? await response.json() : null;
        } catch (error) {
            console.error(`Error fetching call details for ${callId}:`, error);
            return null;
        }
    }
}

// Global SSE client instance
window.sseClient = new SSEClient();

// Auto-connect when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.sseClient.connect();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, you might want to reduce polling frequency
        console.log('Page hidden - consider reducing update frequency');
    } else {
        // Page is visible, ensure connection is active
        if (!window.sseClient.connected) {
            window.sseClient.connect();
        }
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    window.sseClient.disconnect();
}); 