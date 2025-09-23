// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    console.log('PFAS Call System initializing...');
    
    // Load components first
    loadComponents().then(() => {
        // Initialize WebSocket after components are loaded
        if (typeof initializeWebSocket === 'function') {
            updateConnectionStatus('connecting');
            initializeWebSocket();
        }
    });
    
    // Initialize tab navigation
    initializeTabs();
    
    // Set up global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
    });
    
    // Set up unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
    });
});

// Load HTML components
async function loadComponents() {
    try {
        // Load campaign panel
        const campaignResponse = await fetch('components/campaign-panel.html');
        const campaignHtml = await campaignResponse.text();
        document.getElementById('campaign-panel').innerHTML = campaignHtml;
        
        // Load monitor panel
        const monitorResponse = await fetch('components/monitor-panel.html');
        const monitorHtml = await monitorResponse.text();
        document.getElementById('monitor-panel').innerHTML = monitorHtml;
        
        // Initialize panels after loading
        setTimeout(() => {
            initializeCampaignPanel();
            initializeMonitorPanel();
        }, 100);
        
    } catch (error) {
        console.error('Error loading components:', error);
        showNotification('Failed to load application components', 'error');
    }
}

// Initialize tab navigation
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            
            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update panel visibility
            tabPanels.forEach(panel => {
                if (panel.id === `${targetTab}-panel`) {
                    panel.classList.add('active');
                } else {
                    panel.classList.remove('active');
                }
            });
            
            // Save active tab
            localStorage.setItem('activeTab', targetTab);
        });
    });
    
    // Restore last active tab
    const lastActiveTab = localStorage.getItem('activeTab') || 'campaign';
    const activeButton = document.querySelector(`[data-tab="${lastActiveTab}"]`);
    if (activeButton) {
        activeButton.click();
    }
}

// Global notification function
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${getNotificationIcon(type)}</span>
            <span class="notification-message">${message}</span>
        </div>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

// Get notification icon based on type
function getNotificationIcon(type) {
    switch (type) {
        case 'success':
            return '✓';
        case 'error':
            return '✗';
        case 'warning':
            return '⚠';
        default:
            return 'ℹ';
    }
}

// API helper functions
async function apiCall(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Format phone number for display
function formatPhoneDisplay(phone) {
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length === 10) {
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    
    return phone;
}

// Export functions for use in other scripts
window.showNotification = showNotification;
window.apiCall = apiCall;
window.debounce = debounce;
window.throttle = throttle;
window.formatPhoneDisplay = formatPhoneDisplay;