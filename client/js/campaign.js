let currentCampaignData = null;
let campaignInProgress = false;

// Initialize campaign panel
function initializeCampaignPanel() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('csvFileInput');

    // File upload handlers
    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragging');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragging');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragging');
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'text/csv') {
            handleFileUpload(files[0]);
        } else {
            showNotification('Please upload a CSV file', 'error');
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });

    // Load campaign history
    loadCampaignHistory();
}

// Handle file upload
function handleFileUpload(file) {
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    document.getElementById('fileInfo').style.display = 'flex';
    document.getElementById('uploadArea').style.display = 'none';

    // Parse CSV
    const reader = new FileReader();
    reader.onload = (e) => {
        parseCSV(e.target.result);
    };
    reader.readAsText(file);
}

// Parse CSV data
function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    // Validate required columns
    const requiredColumns = ['first_name', 'last_name', 'phone_number', 'lead_source', 'case_type', 'organizationid', 'leadid'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    
    if (missingColumns.length > 0) {
        showNotification(`Missing required columns: ${missingColumns.join(', ')}`, 'error');
        removeFile();
        return;
    }

    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        
        // Validate phone number
        row.phone_valid = validatePhoneNumber(row.phone_number);
        
        // Format phone number if valid
        if (row.phone_valid) {
            row.phone_formatted = formatPhoneToE164(row.phone_number);
            row.phone_number = row.phone_formatted; // Use formatted number
        }
        
        data.push(row);
    }

    currentCampaignData = data;
    displayCSVPreview(data);
    
    // Enable start button if valid data exists
    const validNumbers = data.filter(row => row.phone_valid).length;
    document.getElementById('startCampaignBtn').disabled = validNumbers === 0;
}

// Display CSV preview
function displayCSVPreview(data) {
    document.getElementById('csvPreview').style.display = 'block';
    document.getElementById('totalRecords').textContent = `${data.length} records found`;
    
    const validNumbers = data.filter(row => row.phone_valid).length;
    document.getElementById('validNumbers').textContent = `${validNumbers} valid phone numbers`;
    
    // Display first 10 rows
    const tbody = document.getElementById('previewTableBody');
    tbody.innerHTML = '';
    
    data.slice(0, 10).forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.first_name}</td>
            <td>${row.last_name}</td>
            <td class="${row.phone_valid ? 'valid-number' : 'invalid-number'}">${row.phone_number} ${row.phone_formatted && row.phone_formatted !== row.phone_number ? `(${row.phone_formatted})` : ''}</td>
            <td>${row.lead_source}</td>
            <td>${row.case_type}</td>
            <td>${row.organizationid}</td>
            <td>${row.leadid}</td>
            <td>${row.phone_valid ? '✓ Valid' : '✗ Invalid'}</td>
        `;
        tbody.appendChild(tr);
    });
    
    if (data.length > 10) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" style="text-align: center; font-style: italic;">... and ${data.length - 10} more records</td>`;
        tbody.appendChild(tr);
    }
}

// Remove uploaded file
function removeFile() {
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('csvPreview').style.display = 'none';
    document.getElementById('csvFileInput').value = '';
    currentCampaignData = null;
    document.getElementById('startCampaignBtn').disabled = true;
}

// Validate campaign data
function validateCampaign() {
    if (!currentCampaignData) {
        showNotification('Please upload a CSV file first', 'error');
        return;
    }

    const validRows = currentCampaignData.filter(row => row.phone_valid);
    const invalidRows = currentCampaignData.filter(row => !row.phone_valid);
    
    let message = `Validation Complete:\n`;
    message += `✓ ${validRows.length} valid records ready for calling\n`;
    if (invalidRows.length > 0) {
        message += `✗ ${invalidRows.length} records with invalid phone numbers\n`;
        message += `\nInvalid numbers:\n`;
        invalidRows.slice(0, 5).forEach(row => {
            message += `  - ${row.first_name} ${row.last_name}: ${row.phone_number}\n`;
        });
        if (invalidRows.length > 5) {
            message += `  ... and ${invalidRows.length - 5} more\n`;
        }
    }
    
    alert(message);
}

// Start campaign
async function startCampaign() {
    if (!currentCampaignData || campaignInProgress) return;
    
    const campaignName = document.getElementById('campaignName').value || 'Unnamed Campaign';
    const callDelay = parseInt(document.getElementById('callDelay').value) || 5;
    const maxConcurrent = parseInt(document.getElementById('maxConcurrent').value) || 3;
    const scheduleTime = document.getElementById('scheduleTime').value;
    
    // Filter valid numbers only
    const validContacts = currentCampaignData.filter(row => row.phone_valid);
    
    if (validContacts.length === 0) {
        showNotification('No valid phone numbers to call', 'error');
        return;
    }

    campaignInProgress = true;
    document.getElementById('startCampaignBtn').disabled = true;
    document.getElementById('campaignProgress').style.display = 'block';
    
    // Initialize progress
    const campaignId = generateCampaignId();
    const campaign = {
        id: campaignId,
        name: campaignName,
        contacts: validContacts,
        callDelay,
        maxConcurrent,
        scheduleTime,
        startTime: new Date().toISOString(),
        stats: {
            total: validContacts.length,
            completed: 0,
            failed: 0,
            inProgress: 0
        }
    };
    
    updateCampaignProgress(campaign);
    
    try {
        // Send campaign to server
        const response = await fetch('/api/campaigns/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(campaign)
        });
        
        if (!response.ok) {
            throw new Error('Failed to start campaign');
        }
        
        const result = await response.json();
        showNotification(`Campaign "${campaignName}" started successfully!`, 'success');
        
        // Save to history
        saveCampaignToHistory(campaign);
        
        // Listen for updates via WebSocket
        subscribeToCampaignUpdates(campaignId);
        
    } catch (error) {
        console.error('Error starting campaign:', error);
        showNotification('Failed to start campaign: ' + error.message, 'error');
        campaignInProgress = false;
        document.getElementById('startCampaignBtn').disabled = false;
    }
}

// Stop campaign
async function stopCampaign() {
    if (!campaignInProgress) return;
    
    if (!confirm('Are you sure you want to stop the campaign?')) return;
    
    try {
        const response = await fetch('/api/campaigns/stop', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('Failed to stop campaign');
        }
        
        campaignInProgress = false;
        document.getElementById('startCampaignBtn').disabled = false;
        showNotification('Campaign stopped', 'info');
        
    } catch (error) {
        console.error('Error stopping campaign:', error);
        showNotification('Failed to stop campaign: ' + error.message, 'error');
    }
}

// Update campaign progress
function updateCampaignProgress(campaign) {
    const { stats } = campaign;
    const progress = (stats.completed / stats.total) * 100;
    
    document.getElementById('totalCalls').textContent = stats.total;
    document.getElementById('completedCalls').textContent = stats.completed;
    document.getElementById('failedCalls').textContent = stats.failed;
    document.getElementById('inProgressCalls').textContent = stats.inProgress;
    document.getElementById('progressFill').style.width = `${progress}%`;
    
    // Update header stats
    document.getElementById('campaignStatus').textContent = campaignInProgress ? 'Active' : 'Idle';
}

// Subscribe to campaign updates via WebSocket
function subscribeToCampaignUpdates(campaignId) {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: 'subscribe_campaign',
            campaignId
        }));
    }
}

// Handle campaign update from WebSocket
function handleCampaignUpdate(data) {
    if (data.type === 'campaign_update') {
        updateCampaignProgress(data.campaign);
        
        if (data.campaign.stats.completed === data.campaign.stats.total) {
            campaignInProgress = false;
            document.getElementById('startCampaignBtn').disabled = false;
            showNotification('Campaign completed!', 'success');
        }
    }
}

// Campaign history management
function saveCampaignToHistory(campaign) {
    const history = JSON.parse(localStorage.getItem('campaignHistory') || '[]');
    history.unshift({
        ...campaign,
        endTime: new Date().toISOString()
    });
    // Keep only last 10 campaigns
    localStorage.setItem('campaignHistory', JSON.stringify(history.slice(0, 10)));
    loadCampaignHistory();
}

function loadCampaignHistory() {
    const history = JSON.parse(localStorage.getItem('campaignHistory') || '[]');
    const historyList = document.getElementById('campaignHistoryList');
    
    if (history.length === 0) {
        historyList.innerHTML = '<p style="color: #666; text-align: center;">No campaign history</p>';
        return;
    }
    
    historyList.innerHTML = history.map(campaign => `
        <div class="history-item">
            <div class="history-info">
                <h4>${campaign.name}</h4>
                <p>${new Date(campaign.startTime).toLocaleString()}</p>
            </div>
            <div class="history-stats">
                <span>Total: ${campaign.stats.total}</span>
                <span>Completed: ${campaign.stats.completed}</span>
                <span>Failed: ${campaign.stats.failed}</span>
            </div>
        </div>
    `).join('');
}

// Utility functions
function validatePhoneNumber(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
}

// Format phone number to E.164
function formatPhoneToE164(phone) {
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length === 10) {
        // US number without country code
        return '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        // US number with country code
        return '+' + cleaned;
    } else if (phone.startsWith('+')) {
        // Already has country code
        return phone;
    } else if (cleaned.length > 0) {
        // Other international format - assume it needs a +
        return '+' + cleaned;
    }
    
    return phone;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function generateCampaignId() {
    return `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Add styles for history items
const style = document.createElement('style');
style.textContent = `
.history-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    background: #f9fafb;
    border-radius: 8px;
    margin-bottom: 10px;
}

.history-info h4 {
    margin: 0 0 5px;
    font-size: 16px;
}

.history-info p {
    margin: 0;
    color: #666;
    font-size: 14px;
}

.history-stats {
    display: flex;
    gap: 15px;
    font-size: 14px;
}

.history-stats span {
    color: #666;
}
`;
document.head.appendChild(style);

// Export functions for global access
window.initializeCampaignPanel = initializeCampaignPanel;
window.handleCampaignUpdate = handleCampaignUpdate;