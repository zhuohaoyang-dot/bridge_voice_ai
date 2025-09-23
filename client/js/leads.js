// Leads Panel State
let allLeads = []; // Store all fetched leads
let filteredLeads = []; // Store filtered results
let currentLeads = []; // Current page of filtered results
let selectedLeads = new Set();
let currentPage = 1;
let totalPages = 1;
let totalRecords = 0;
let isLoading = false;
let lastFetchTime = 0;
let retryCount = 0;

// API Configuration
const CRM_API_URL = '/api/crm/leads';
const MIN_REQUEST_INTERVAL = 1000;
const FETCH_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Initialize leads panel
function initializeLeadsPanel() {
    console.log('Initializing CRM Leads Panel with Enhanced Filtering...');
    
    // Load lead types dynamically
    loadLeadTypes();
    
    // Add event listeners
    document.getElementById('selectAllCheckbox').addEventListener('change', toggleSelectAll);
    
    // Add real-time search listeners
    document.getElementById('leadTypeFilter').addEventListener('change', applyFilters);
    document.getElementById('searchTimeInput').addEventListener('input', applyFilters);
    document.getElementById('searchLeadIdInput').addEventListener('input', applyFilters);
    
    // Load saved filters
    loadSavedFilters();
    
    // Add custom styles for stage badges
    addStageStyles();
}

// Load lead types from API
async function loadLeadTypes() {
    try {
        const response = await fetch('/api/crm/lead-types');
        const data = await response.json();
        
        const select = document.getElementById('leadTypeFilter');
        // Clear existing options except "All Types"
        select.innerHTML = '<option value="">All Types</option>';
        
        // Add options from API
        data.leadTypes.forEach(leadType => {
            const option = document.createElement('option');
            option.value = leadType.id;
            option.textContent = leadType.name;
            select.appendChild(option);
        });
        
        console.log(`Loaded ${data.leadTypes.length} lead types from API`);
    } catch (error) {
        console.error('Error loading lead types:', error);
        // Fallback - keep hardcoded options if API fails
    }
}

// Add stage styles to the page
function addStageStyles() {
    if (!document.getElementById('stage-styles')) {
        const style = document.createElement('style');
        style.id = 'stage-styles';
        style.textContent = `
            .badge {
                display: inline-block;
                padding: 0.25rem 0.5rem;
                font-size: 0.75rem;
                font-weight: 600;
                border-radius: 9999px;
                text-transform: uppercase;
                white-space: nowrap;
            }
            .badge-blue { background-color: #3b82f6; color: white; }
            .badge-yellow { background-color: #f59e0b; color: white; }
            .badge-green { background-color: #10b981; color: white; }
            .badge-purple { background-color: #8b5cf6; color: white; }
            .badge-red { background-color: #ef4444; color: white; }
            .badge-gray { background-color: #6b7280; color: white; }
        `;
        document.head.appendChild(style);
    }
}

// Fetch leads with retry mechanism - simplified to fetch all available leads
async function fetchLeads() {
    // Check rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastFetchTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        showNotification(`Please wait ${Math.ceil(waitTime / 1000)} seconds before fetching again`, 'warning');
        return;
    }
    
    if (isLoading) {
        showNotification('A request is already in progress', 'warning');
        return;
    }
    
    isLoading = true;
    lastFetchTime = now;
    retryCount = 0;
    
    await fetchLeadsWithRetry();
}

// Fetch leads with retry logic - get all available leads
async function fetchLeadsWithRetry() {
    showLoading();
    updateButtonStates();
    
    try {
        // Reset data
        allLeads = [];
        let hasMore = true;
        let page = 1;
        let totalFetched = 0;
        let totalUnique = 0;
        
        // ENHANCED: Fetch up to 25 pages as requested
        while (hasMore && totalFetched < 2500 && page <= 25) {
            // Try different pagination parameters to avoid duplicates
            const params = new URLSearchParams({
                page: page,           // Try 'page' instead of 'pageNumber'
                pageNumber: page,     // Also include 'pageNumber' for compatibility
                pageSize: FETCH_SIZE,
                limit: FETCH_SIZE     // Some APIs use 'limit' instead of 'pageSize'
            });
            
            const url = `${CRM_API_URL}?${params}`;
            console.log(`Fetching page ${page}... (URL: ${url})`);
            
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, 30000); // 30 second timeout
            
            if (!response.ok) {
                if (response.status === 500 && retryCount < MAX_RETRIES) {
                    retryCount++;
                    console.log(`Retry ${retryCount} after 500 error`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * retryCount));
                    return fetchLeadsWithRetry();
                }
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (result.code !== 0) {
                throw new Error(result.msg || 'API returned error code');
            }
            
            // Add leads to our collection with enhanced deduplication
            const newLeads = result.data.list;
            if (!newLeads || newLeads.length === 0) {
                console.log(`Page ${page}: No leads returned, stopping pagination`);
                break;
            }
            
            // Enhanced duplicate detection using multiple ID fields
            const existingIds = new Set();
            allLeads.forEach(lead => {
                // Add multiple possible ID variations to the set
                if (lead.id) existingIds.add(lead.id);
                if (lead.leadId) existingIds.add(lead.leadId);
                if (lead.leadid) existingIds.add(lead.leadid);
                // Also use phone number as secondary identifier
                if (lead.phone) existingIds.add(lead.phone);
            });
            
            const uniqueNewLeads = newLeads.filter(lead => {
                const leadId = lead.id || lead.leadId || lead.leadid;
                const leadPhone = lead.phone;
                
                // Check if this lead is unique by ID or phone
                const isUniqueById = leadId && !existingIds.has(leadId);
                const isUniqueByPhone = leadPhone && !existingIds.has(leadPhone);
                
                return isUniqueById || (isUniqueByPhone && !leadId);
            });
            
            // Add the unique leads
            allLeads = allLeads.concat(uniqueNewLeads);
            totalFetched += newLeads.length;
            totalUnique += uniqueNewLeads.length;
            
            console.log(`Page ${page}: ${newLeads.length} leads received, ${uniqueNewLeads.length} unique new leads added, ${newLeads.length - uniqueNewLeads.length} duplicates skipped`);
            console.log(`Running totals: ${totalUnique} unique leads collected from ${totalFetched} total leads fetched`);
            
            // Update progress in button text
            const fetchBtn = document.getElementById('fetchLeadsBtn');
            if (fetchBtn) {
                const progressPercent = Math.round((page / 25) * 100);
                fetchBtn.innerHTML = `<span class="btn-icon">⏳</span> Page ${page}/25 (${totalUnique} unique leads)`;
            }
            
            // IMPROVED: Stop early if we're getting too many duplicates
            const duplicateRatio = (newLeads.length - uniqueNewLeads.length) / newLeads.length;
            if (page > 3 && duplicateRatio > 0.95) {
                console.log(`Page ${page}: High duplicate ratio (${Math.round(duplicateRatio * 100)}%), likely reached end of unique data`);
                showNotification(`Stopping early at page ${page} due to high duplicate ratio (${Math.round(duplicateRatio * 100)}%)`, 'info');
                break;
            }
            
            // IMPROVED: Stop if we get significantly fewer leads than expected
            if (newLeads.length < FETCH_SIZE * 0.5 && page > 1) {
                console.log(`Page ${page}: Received ${newLeads.length} leads (< 50% of page size), likely at end`);
                hasMore = false;
            } else {
                hasMore = newLeads.length === FETCH_SIZE;
            }
            
            page++;
            
            // Longer delay between requests to be more respectful to the API
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 500)); // Increased from 200ms to 500ms
            }
        }
        
        console.log(`✅ Fetch complete: Collected ${allLeads.length} unique leads from ${page - 1} pages (${totalFetched} total leads processed)`);
        
        // Apply filters
        applyFilters();
        
        // Update last sync time
        updateLastSyncTime();
        
        // Save current filters
        saveFilters();
        
        showNotification(`Fetched ${allLeads.length} unique leads from ${page - 1} pages`, 'success');
        
    } catch (error) {
        console.error('Error fetching leads:', error);
        
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            showNotification(`Error fetching leads. Retrying... (${retryCount}/${MAX_RETRIES})`, 'warning');
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * retryCount));
            return fetchLeadsWithRetry();
        }
        
        showError(error.message);
        showNotification('Failed to fetch leads after multiple attempts', 'error');
    } finally {
        isLoading = false;
        updateButtonStates();
    }
}

// Fetch with timeout
function fetchWithTimeout(url, options, timeout = 30000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
}

// Apply filters to the fetched data - simplified with search functionality
function applyFilters() {
    console.log('Applying filters...');
    
    // Get filter values
    const leadTypeFilter = document.getElementById('leadTypeFilter').value;
    const searchTime = document.getElementById('searchTimeInput').value.toLowerCase();
    const searchLeadId = document.getElementById('searchLeadIdInput').value.toLowerCase();
    const pageSize = parseInt(document.getElementById('pageSizeFilter').value);
    
    // Start with all leads
    filteredLeads = [...allLeads];
    
    // Apply lead type filter
    if (leadTypeFilter) {
        filteredLeads = filteredLeads.filter(lead => lead.leadType === leadTypeFilter);
        console.log(`Lead type filter "${leadTypeFilter}": ${allLeads.length} -> ${filteredLeads.length}`);
    }
    
    // Apply time search filter
    if (searchTime) {
        filteredLeads = filteredLeads.filter(lead => {
            const formattedTime = formatDateTime(lead.createdTime).toLowerCase();
            return formattedTime.includes(searchTime) || lead.createdTime.toLowerCase().includes(searchTime);
        });
        console.log(`Time search filter "${searchTime}": ${filteredLeads.length} results`);
    }
    
    // Apply lead ID search filter
    if (searchLeadId) {
        filteredLeads = filteredLeads.filter(lead => {
            return lead.id.toString().includes(searchLeadId);
        });
        console.log(`Lead ID search filter "${searchLeadId}": ${filteredLeads.length} results`);
    }
    
    // Sort by created time (newest first)
    filteredLeads.sort((a, b) => {
        const dateA = new Date(a.createdTime);
        const dateB = new Date(b.createdTime);
        return dateB - dateA;
    });
    
    // Final deduplication by ID before pagination
    const beforeCount = filteredLeads.length;
    filteredLeads = filteredLeads.filter((lead, index, arr) => 
        arr.findIndex(l => l.id === lead.id) === index
    );
    if (beforeCount !== filteredLeads.length) {
        console.warn(`Removed ${beforeCount - filteredLeads.length} duplicate leads from filtered results`);
    }
    
    // Update pagination
    totalRecords = filteredLeads.length;
    totalPages = Math.ceil(totalRecords / pageSize);
    currentPage = 1;
    
    // Clear selections
    selectedLeads.clear();
    
    // Update active filters display
    updateActiveFiltersDisplay(leadTypeFilter, searchTime, searchLeadId);
    
    // Show current page (this will handle data transformation and display)
    if (filteredLeads.length > 0) {
        showCurrentPage();
    } else if (allLeads.length === 0) {
        showNoResults('No leads fetched yet. Click "Fetch All Leads" to start.');
    } else {
        showNoResults('No leads match your search criteria. Try adjusting the filters.');
    }
    
    // Update stats
    updateStats();
}

// Format stage with color coding
function formatStage(stage) {
    const stageColors = {
        'new': 'badge-blue',
        'contacted': 'badge-yellow',
        'qualified': 'badge-green',
        'converted': 'badge-purple',
        'lost': 'badge-red'
    };
    
    const displayStage = stage || 'new';
    const colorClass = stageColors[displayStage.toLowerCase()] || 'badge-gray';
    
    return `<span class="badge ${colorClass}">${displayStage.toUpperCase()}</span>`;
}

// Create table row for lead - simplified columns
function createLeadRow(lead) {
    const tr = document.createElement('tr');
    tr.dataset.leadId = lead.id;
    
    tr.innerHTML = `
        <td class="checkbox-column">
            <input type="checkbox" 
                   data-lead-id="${lead.id}" 
                   onchange="toggleLeadSelection(${lead.id})"
                   ${selectedLeads.has(lead.id) ? 'checked' : ''}>
        </td>
        <td>${lead.id}</td>
        <td>${lead.convoso_id ? `<span class="cid-badge">${lead.convoso_id}</span>` : '<span class="cid-badge cid-missing">-</span>'}</td>
        <td>${lead.fullName}</td>
        <td class="phone-cell">
            ${lead.phoneFormatted}
            ${lead.phoneFormatted !== lead.phone ? `<br><small class="original-phone">${lead.phone}</small>` : ''}
        </td>
        <td>${lead.leadType || 'N/A'}</td>
        <td>${formatStage(lead.stage)}</td>
        <td>${lead.source || 'N/A'}</td>
        <td title="${lead.createdTime}">${formatDateTime(lead.createdTime)}</td>
        <td>
            <button class="btn btn-primary btn-sm" onclick="quickCall(${lead.id})" title="Start call">
                📞 Call
            </button>
        </td>
    `;
    
    return tr;
}

// Display leads in table
function displayLeads() {
    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = '';
    
    console.log(`Displaying ${currentLeads.length} leads:`, currentLeads.map(l => l.id));
    
    // Check for duplicates in currentLeads
    const ids = currentLeads.map(l => l.id);
    const uniqueIds = [...new Set(ids)];
    if (ids.length !== uniqueIds.length) {
        console.error(`DUPLICATE DETECTION: currentLeads has ${ids.length} leads but only ${uniqueIds.length} unique IDs!`);
        console.error('Duplicate IDs found:', ids.filter((id, index) => ids.indexOf(id) !== index));
    }
    
    currentLeads.forEach(lead => {
        const row = createLeadRow(lead);
        tbody.appendChild(row);
    });
    
    // Show table
    document.getElementById('leadsTableContainer').style.display = 'block';
    document.getElementById('leadsLoading').style.display = 'none';
    document.getElementById('leadsError').style.display = 'none';
    document.getElementById('noResults').style.display = 'none';
    
    // Update pagination
    updatePagination();
}

// Update pagination for filtered results
function updatePagination() {
    const pageSize = parseInt(document.getElementById('pageSizeFilter').value);
    const from = filteredLeads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const to = Math.min(currentPage * pageSize, filteredLeads.length);
    
    document.getElementById('showingFrom').textContent = from;
    document.getElementById('showingTo').textContent = to;
    document.getElementById('totalRecords').textContent = filteredLeads.length;
    document.getElementById('currentPage').textContent = currentPage;
    document.getElementById('totalPages').textContent = totalPages || 1;
    
    // Update button states - fix pagination buttons
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (prevBtn) prevBtn.disabled = currentPage === 1 || isLoading || totalPages === 0;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages || isLoading || totalPages === 0;
    
    // Show filter summary
    const filterSummary = [];
    if (document.getElementById('leadTypeFilter').value) {
        filterSummary.push(`Type: ${document.getElementById('leadTypeFilter').value}`);
    }
    if (document.getElementById('searchTimeInput').value) {
        filterSummary.push(`Time: ${document.getElementById('searchTimeInput').value}`);
    }
    if (document.getElementById('searchLeadIdInput').value) {
        filterSummary.push(`ID: ${document.getElementById('searchLeadIdInput').value}`);
    }
    
    if (filterSummary.length > 0 && filteredLeads.length < allLeads.length) {
        showNotification(`Filtered ${filteredLeads.length} from ${allLeads.length} total leads (${filterSummary.join(', ')})`, 'info');
    }
}

// Navigate pages in filtered results
function previousPage() {
    if (currentPage > 1 && !isLoading) {
        currentPage--;
        showCurrentPage();
    }
}

function nextPage() {
    if (currentPage < totalPages && !isLoading) {
        currentPage++;
        showCurrentPage();
    }
}

// Show current page of filtered results
function showCurrentPage() {
    const pageSize = parseInt(document.getElementById('pageSizeFilter').value);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    
    // Get current page slice and deduplicate by ID as final safety check
    const pageLeads = filteredLeads.slice(start, end);
    const uniquePageLeads = pageLeads.filter((lead, index, arr) => 
        arr.findIndex(l => l.id === lead.id) === index
    );
    
    currentLeads = uniquePageLeads.map(lead => ({
        id: lead.id, // Bridge Legal ID (e.g., "4964157")
        organizationId: "1", // Fixed organization ID
        firstName: lead.firstName || '',
        lastName: lead.lastName || '',
        fullName: lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
        phone: lead.phone,
        phoneFormatted: formatPhoneToE164(lead.phone),
        leadType: lead.leadType,
        source: lead.source,
        stage: lead.stage || 'new',
        createdTime: lead.createdTime,
        convoso_id: lead.convoso_id // Add missing convoso_id field
    }));
    
    if (pageLeads.length !== uniquePageLeads.length) {
        console.warn(`Removed ${pageLeads.length - uniquePageLeads.length} duplicate leads from current page`);
    }
    
    displayLeads();
}

// Update page size handler
document.addEventListener('DOMContentLoaded', () => {
    const pageSizeFilter = document.getElementById('pageSizeFilter');
    if (pageSizeFilter) {
        pageSizeFilter.addEventListener('change', () => {
            if (filteredLeads.length > 0) {
                currentPage = 1; // Reset to first page when changing page size
                applyFilters();
            }
        });
    }
});

// Enhanced stats update
function updateStats() {
    document.getElementById('totalLeadsCount').textContent = `${filteredLeads.length} / ${allLeads.length}`;
    updateSelectionUI();
    
    // Update stage statistics if available
    if (allLeads.length > 0) {
        const stageCounts = {};
        filteredLeads.forEach(lead => {
            const stage = lead.stage || 'new';
            stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        });
        
        // Display stage counts if you have a container for it
        console.log('Stage distribution:', stageCounts);
    }
}

// Show no results with custom message
function showNoResults(message = 'No leads found') {
    document.getElementById('noResults').style.display = 'block';
    document.getElementById('noResults').querySelector('p').textContent = message;
    document.getElementById('leadsTableContainer').style.display = 'none';
    document.getElementById('leadsLoading').style.display = 'none';
    document.getElementById('leadsError').style.display = 'none';
}



// Format date time for display - fixed to handle CRM API format
function formatDateTime(dateTimeStr) {
    if (!dateTimeStr) return 'N/A';
    
    try {
        // CRM API returns format: "2025-08-27 19:17:43"
        // Convert to proper ISO format for Date parsing
        const isoString = dateTimeStr.replace(' ', 'T');
        const date = new Date(isoString);
        
        // Format as MM/DD/YYYY HH:MM:SS to match your CRM display
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
    } catch (e) {
        console.error('Error formatting date:', e);
        return dateTimeStr;
    }
}

// Format phone to E164 - UPDATED to match campaign validation
function formatPhoneToE164(phone) {
    if (!phone) return null;
    
    // Remove all non-numeric characters
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length === 10) {
        // US number without country code
        return '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        // US number with country code
        return '+' + cleaned;
    } else if (phone.startsWith('+')) {
        // Already has country code - validate length
        if (cleaned.length >= 10 && cleaned.length <= 15) {
            return phone;
        }
    } else if (cleaned.length >= 10 && cleaned.length <= 15) {
        // Other international format - assume it needs a +
        return '+' + cleaned;
    }
    
    // Invalid phone number
    return null;
}

// Add phone validation function to match campaign.js
function validatePhoneNumber(phone) {
    if (!phone) return false;
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
}

// Toggle lead selection
function toggleLeadSelection(leadId) {
    if (selectedLeads.has(leadId)) {
        selectedLeads.delete(leadId);
    } else {
        selectedLeads.add(leadId);
    }
    
    updateSelectionUI();
}

// Toggle select all
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAllCheckbox').checked;
    
    if (selectAll) {
        currentLeads.forEach(lead => selectedLeads.add(lead.id));
    } else {
        selectedLeads.clear();
    }
    
    // Update individual checkboxes
    document.querySelectorAll('[data-lead-id]').forEach(checkbox => {
        checkbox.checked = selectAll;
    });
    
    updateSelectionUI();
}

// Select all leads
function selectAllLeads() {
    currentLeads.forEach(lead => selectedLeads.add(lead.id));
    document.getElementById('selectAllCheckbox').checked = true;
    
    document.querySelectorAll('[data-lead-id]').forEach(checkbox => {
        checkbox.checked = true;
    });
    
    updateSelectionUI();
}

// Deselect all leads
function deselectAllLeads() {
    selectedLeads.clear();
    
    // Clear select all checkbox - with null check
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
    }
    
    // Clear individual checkboxes
    document.querySelectorAll('[data-lead-id]').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Update UI only if elements are accessible
    try {
        updateSelectionUI();
    } catch (error) {
        console.log('Selection UI update skipped (elements not accessible):', error.message);
    }
}

// Update selection UI
function updateSelectionUI() {
    const selectedCount = selectedLeads.size;
    
    // Update counts - with null checks
    const selectedLeadsCountEl = document.getElementById('selectedLeadsCount');
    if (selectedLeadsCountEl) {
        selectedLeadsCountEl.textContent = selectedCount;
    }
    
    const selectedCountEl = document.getElementById('selectedCount');
    if (selectedCountEl) {
        selectedCountEl.textContent = selectedCount;
    }
    
    // Enable/disable buttons - with null checks
    const callSelectedBtn = document.getElementById('callSelectedBtn');
    if (callSelectedBtn) {
        callSelectedBtn.disabled = selectedCount === 0;
    }
    
    const createCampaignBtn = document.getElementById('createCampaignBtn');
    if (createCampaignBtn) {
        createCampaignBtn.disabled = selectedCount === 0;
    }
    
    const exportSelectedBtn = document.getElementById('exportSelectedBtn');
    if (exportSelectedBtn) {
        exportSelectedBtn.disabled = selectedCount === 0;
    }
    
    // Update select all checkbox state
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedCount === currentLeads.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// Quick call single lead
function quickCall(leadId) {
    const lead = currentLeads.find(l => l.id === leadId);
    if (!lead) return;
    
    // Store current lead for modal
    window.currentQuickCallLead = lead;
    
    // Populate modal
    document.getElementById('quickCallLeadName').textContent = lead.fullName;
    document.getElementById('quickCallPhone').textContent = lead.phoneFormatted;
    document.getElementById('quickCallLeadType').textContent = lead.leadType || 'N/A';
    document.getElementById('quickCallSource').textContent = lead.source || 'N/A';
    document.getElementById('quickCallStage').textContent = lead.stage || 'new';
    document.getElementById('quickCallNotes').value = '';
    
    // Reset assistant selection
    document.getElementById('quickCallAssistant').value = '';
    
    // Show modal
    document.getElementById('quickCallModal').style.display = 'flex';
}

// Close quick call modal
function closeQuickCallModal() {
    document.getElementById('quickCallModal').style.display = 'none';
    window.currentQuickCallLead = null;
}

// Initiate quick call
async function initiateQuickCall() {
    const lead = window.currentQuickCallLead;
    if (!lead) return;
    
    const notes = document.getElementById('quickCallNotes').value;
    const assistantType = document.getElementById('quickCallAssistant').value;
    
    // Validate assistant selection
    if (!assistantType) {
        showNotification('Please select an AI assistant', 'error');
        return;
    }
    
    try {
        // Create call through API
        const response = await apiCall('/api/calls/create', {
            method: 'POST',
            body: JSON.stringify({
                phone_number: lead.phoneFormatted,
                first_name: lead.firstName,
                last_name: lead.lastName,
                metadata: {
                    leadId: lead.id,
                    organizationId: lead.organizationId,
                    convoso_id: lead.convoso_id || lead.lead_id || null, // Add Convoso ID
                    leadType: lead.leadType,
                    source: lead.source,
                    stage: lead.stage,
                    notes: notes,
                    assistantType: assistantType, // Add assistant selection
                    fromPanel: 'leads'
                }
            })
        });
        
        showNotification(`Call initiated to ${lead.fullName} using ${assistantType} assistant`, 'success');
        closeQuickCallModal();
        
        // Switch to monitor panel to see the call
        document.querySelector('[data-tab="monitor"]').click();
        
    } catch (error) {
        console.error('Error initiating call:', error);
        showNotification('Failed to initiate call: ' + error.message, 'error');
    }
}

// Call selected leads (show modal for assistant selection)
async function callSelectedLeads() {
    const selectedLeadIds = Array.from(selectedLeads);
    if (selectedLeadIds.length === 0) {
        showNotification('Please select leads to call', 'warning');
        return;
    }
    
    // Update modal with selected count
    document.getElementById('bulkCallCount').textContent = selectedLeadIds.length;
    
    // Reset assistant selection
    document.getElementById('bulkCallAssistant').value = '';
    
    // Show modal
    document.getElementById('bulkCallModal').style.display = 'flex';
}

// Close bulk call modal
function closeBulkCallModal() {
    document.getElementById('bulkCallModal').style.display = 'none';
}

// Initiate bulk call after assistant selection
async function initiateBulkCall() {
    const assistantType = document.getElementById('bulkCallAssistant').value;
    
    // Validate assistant selection
    if (!assistantType) {
        showNotification('Please select an AI assistant', 'error');
        return;
    }
    
    // Close modal
    closeBulkCallModal();
    
    const selectedLeadIds = Array.from(selectedLeads);
    
    // Confirm the action
    if (!confirm(`Are you sure you want to start calling ${selectedLeadIds.length} selected leads using ${assistantType} assistant?`)) {
        return;
    }
    
    // Get selected lead objects from filtered leads
    const leadsToCall = filteredLeads.filter(lead => selectedLeads.has(lead.id));
    
    // Validate and format phone numbers
    const validLeads = [];
    const invalidLeads = [];
    
    leadsToCall.forEach(lead => {
        const formattedPhone = formatPhoneToE164(lead.phone);
        if (formattedPhone && validatePhoneNumber(lead.phone)) {
            validLeads.push({
                ...lead,
                formattedPhone: formattedPhone
            });
        } else {
            invalidLeads.push(lead);
        }
    });
    
    if (validLeads.length === 0) {
        showNotification('No leads have valid phone numbers for calling', 'error');
        return;
    }
    
    if (invalidLeads.length > 0) {
        showNotification(`${invalidLeads.length} leads have invalid phone numbers and will be skipped`, 'warning');
    }
    
    // Show progress notification
    showNotification(`Starting calls to ${validLeads.length} leads using ${assistantType} assistant...`, 'info');
    
    // Disable the button to prevent multiple clicks
    const callButton = document.getElementById('callSelectedBtn');
    const originalText = callButton.innerHTML;
    callButton.disabled = true;
    callButton.innerHTML = '<span class="btn-icon">⏳</span> Calling...';
    
    let successCount = 0;
    let failCount = 0;
    
    try {
        // Switch to monitor panel to see the calls
        document.querySelector('[data-tab="monitor"]').click();
        
        // Start calls with a small delay between each to avoid overwhelming the system
        for (let i = 0; i < validLeads.length; i++) {
            const lead = validLeads[i];
            
            try {
                const response = await fetch('/api/calls/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        phone_number: lead.formattedPhone,
                        first_name: lead.firstName || '',
                        last_name: lead.lastName || '',
                        metadata: {
                            leadId: lead.id,
                            convoso_id: lead.convoso_id || lead.lead_id || null, // Add Convoso ID
                            organizationId: lead.organizationId,
                            leadType: lead.leadType,
                            source: lead.source,
                            stage: lead.stage,
                            assistantType: assistantType, // Add assistant selection
                            fromPanel: 'leads-bulk',
                            batchCall: true
                        }
                    })
                });
                
                if (response.ok) {
                    successCount++;
                    console.log(`✅ Call initiated for ${lead.fullName} (${lead.formattedPhone}) using ${assistantType}`);
                } else {
                    failCount++;
                    console.error(`❌ Failed to call ${lead.fullName}: ${response.statusText}`);
                }
                
                // Small delay between calls to avoid rate limiting
                if (i < validLeads.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                }
                
            } catch (error) {
                failCount++;
                console.error(`❌ Error calling ${lead.fullName}:`, error);
            }
            
            // Update button with progress
            callButton.innerHTML = `<span class="btn-icon">📞</span> Calling... (${i + 1}/${validLeads.length})`;
        }
        
        // Show final results
        if (successCount > 0) {
            showNotification(`✅ Successfully initiated ${successCount} calls using ${assistantType} assistant${failCount > 0 ? ` (${failCount} failed)` : ''}`, 'success');
            
            // Clear selection after successful calls (just clear the data, skip UI update to avoid null errors)
            selectedLeads.clear();
        } else {
            showNotification(`❌ Failed to initiate any calls`, 'error');
        }
        
        // Switch to monitor panel to see the calls
        document.querySelector('[data-tab="monitor"]').click();
        
    } catch (error) {
        console.error('Error in bulk calling:', error);
        showNotification('Failed to initiate calls: ' + error.message, 'error');
    } finally {
        // Re-enable button
        callButton.disabled = false;
        callButton.innerHTML = originalText;
    }
}

// Create campaign from selected leads (for campaign panel)
async function createCampaignFromLeads() {
    const selectedLeadIds = Array.from(selectedLeads);
    if (selectedLeadIds.length === 0) {
        showNotification('Please select leads for campaign', 'warning');
        return;
    }
    
    // Get selected lead objects from filtered leads
    const leadsToCall = filteredLeads.filter(lead => selectedLeads.has(lead.id));
    
    // Prepare contacts for campaign with proper E164 formatting
    const contacts = leadsToCall.map(lead => {
        // Format phone number to E164
        const formattedPhone = formatPhoneToE164(lead.phone);
        const isValidPhone = formattedPhone !== null && formattedPhone !== '';
        
        return {
            first_name: lead.firstName,
            last_name: lead.lastName,
            phone_number: formattedPhone || lead.phone, // Use formatted number or original if formatting failed
            phone_formatted: formattedPhone,
            phone_valid: isValidPhone,
            lead_source: lead.source,
            case_type: lead.leadType,
            stage: lead.stage || 'new',
            organizationid: lead.organizationId,
            leadid: lead.id
        };
    });
    
    // Filter out contacts with invalid phone numbers
    const validContacts = contacts.filter(contact => contact.phone_valid);
    const invalidCount = contacts.length - validContacts.length;
    
    if (validContacts.length === 0) {
        showNotification('No leads have valid phone numbers for campaign', 'error');
        return;
    }
    
    if (invalidCount > 0) {
        showNotification(`${invalidCount} leads have invalid phone numbers and will be skipped`, 'warning');
    }
    
    // Create campaign name
    const leadType = document.getElementById('leadTypeFilter').value;
    const campaignName = leadType 
        ? `CRM ${leadType} Leads - ${new Date().toLocaleString()}`
        : `CRM Leads - ${new Date().toLocaleString()}`;
    
    // Switch to campaign panel and populate
    document.querySelector('[data-tab="campaign"]').click();
    
    // Wait for panel to load
    setTimeout(() => {
        // Set campaign data with properly formatted contacts
        window.currentCampaignData = validContacts;
        document.getElementById('campaignName').value = campaignName;
        
        // Trigger campaign preview
        if (typeof displayCSVPreview === 'function') {
            displayCSVPreview(validContacts);
            document.getElementById('csvPreview').style.display = 'block';
            document.getElementById('startCampaignBtn').disabled = false;
            
            showNotification(`${validContacts.length} leads ready for campaign (${invalidCount} invalid numbers skipped)`, 'success');
        }
    }, 500);
}

// Export selected leads
function exportSelectedLeads() {
    const selectedLeadIds = Array.from(selectedLeads);
    if (selectedLeadIds.length === 0) return;
    
    // Get selected lead objects from filtered leads
    const leadsToExport = filteredLeads.filter(lead => selectedLeads.has(lead.id));
    
    // Create CSV content - simplified columns
    const headers = ['ID', 'Name', 'Phone', 'Lead Type', 'Stage', 'Source', 'Created Time'];
    const rows = leadsToExport.map(lead => [
        lead.id,
        lead.convoso_id || '',
        lead.fullName,
        formatPhoneToE164(lead.phone),
        lead.leadType,
        lead.stage || 'new',
        lead.source,
        formatDateTime(lead.createdTime)
    ]);
    
    // Convert to CSV
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm_leads_export_${new Date().getTime()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showNotification(`Exported ${leadsToExport.length} leads`, 'success');
}

// Clear filters
function clearFilters() {
    document.getElementById('leadTypeFilter').value = '';
    document.getElementById('searchTimeInput').value = '';
    document.getElementById('searchLeadIdInput').value = '';
    document.getElementById('pageSizeFilter').value = '25';
    
    // Re-apply filters (which will show all)
    if (allLeads.length > 0) {
        currentPage = 1;
        applyFilters();
    }
}

// Save filters to localStorage
function saveFilters() {
    const filters = {
        leadType: document.getElementById('leadTypeFilter').value,
        searchTime: document.getElementById('searchTimeInput').value,
        searchLeadId: document.getElementById('searchLeadIdInput').value,
        pageSize: document.getElementById('pageSizeFilter').value
    };
    
    localStorage.setItem('crmLeadFilters', JSON.stringify(filters));
}

// Load saved filters
function loadSavedFilters() {
    const saved = localStorage.getItem('crmLeadFilters');
    if (saved) {
        try {
            const filters = JSON.parse(saved);
            document.getElementById('leadTypeFilter').value = filters.leadType || '';
            document.getElementById('searchTimeInput').value = filters.searchTime || '';
            document.getElementById('searchLeadIdInput').value = filters.searchLeadId || '';
            document.getElementById('pageSizeFilter').value = filters.pageSize || '25';
        } catch (e) {
            console.error('Error loading saved filters:', e);
        }
    }
}

// UI State functions
function showLoading() {
    document.getElementById('leadsLoading').style.display = 'block';
    document.getElementById('leadsTableContainer').style.display = 'none';
    document.getElementById('leadsError').style.display = 'none';
    document.getElementById('noResults').style.display = 'none';
}

function showError(message) {
    document.getElementById('leadsError').style.display = 'block';
    document.getElementById('leadsError').querySelector('.error-message').textContent = message;
    document.getElementById('leadsTableContainer').style.display = 'none';
    document.getElementById('leadsLoading').style.display = 'none';
    document.getElementById('noResults').style.display = 'none';
}

// Update button states
function updateButtonStates() {
    const fetchBtn = document.getElementById('fetchLeadsBtn');
    const clearBtn = document.getElementById('clearFiltersBtn');
    
    if (fetchBtn) {
        fetchBtn.disabled = isLoading;
        if (isLoading) {
            fetchBtn.innerHTML = '<span class="btn-icon">⏳</span> Fetching...';
        } else {
            fetchBtn.innerHTML = '<span class="btn-icon">🔄</span> Fetch All Leads';
        }
    }
    
    if (clearBtn) clearBtn.disabled = isLoading;
    
    // Fix pagination buttons
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (prevBtn) prevBtn.disabled = currentPage === 1 || isLoading || totalPages === 0;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages || isLoading || totalPages === 0;
}

// Retry fetch
function retryFetch() {
    fetchLeads();
}

// Update last sync time
function updateLastSyncTime() {
    const now = new Date();
    document.getElementById('lastSyncTime').textContent = now.toLocaleTimeString();
}

// Update active filters display
function updateActiveFiltersDisplay(leadType, searchTime, searchLeadId) {
    const activeFiltersDiv = document.getElementById('activeFiltersDisplay');
    const filterTagsSpan = document.getElementById('filterTags');
    
    const filterTags = [];
    
    if (leadType) {
        filterTags.push(`<span class="filter-tag">Lead Type: ${leadType} <span class="remove-filter" onclick="removeFilter('leadType')">×</span></span>`);
    }
    
    if (searchTime) {
        filterTags.push(`<span class="filter-tag">Time: ${searchTime} <span class="remove-filter" onclick="removeFilter('searchTime')">×</span></span>`);
    }
    
    if (searchLeadId) {
        filterTags.push(`<span class="filter-tag">ID: ${searchLeadId} <span class="remove-filter" onclick="removeFilter('searchLeadId')">×</span></span>`);
    }
    
    if (filterTags.length > 0) {
        activeFiltersDiv.style.display = 'block';
        filterTagsSpan.innerHTML = filterTags.join(' ');
    } else {
        activeFiltersDiv.style.display = 'none';
    }
}

// Remove specific filter
function removeFilter(filterType) {
    switch(filterType) {
        case 'leadType':
            document.getElementById('leadTypeFilter').value = '';
            break;
        case 'searchTime':
            document.getElementById('searchTimeInput').value = '';
            break;
        case 'searchLeadId':
            document.getElementById('searchLeadIdInput').value = '';
            break;
    }
    
    currentPage = 1;
    applyFilters();
}

// Call lead from details modal (missing function)
function callLeadFromDetails() {
    const lead = window.currentLeadForDetails;
    if (!lead) {
        showNotification('No lead selected', 'error');
        return;
    }
    
    // Close the details modal and open quick call modal
    closeLeadDetails();
    quickCall(lead.id);
}

// Close lead details modal (missing function)
function closeLeadDetails() {
    const modal = document.getElementById('leadDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
    window.currentLeadForDetails = null;
}

// Export functions for global access
window.initializeLeadsPanel = initializeLeadsPanel;
window.fetchLeads = fetchLeads;
window.clearFilters = clearFilters;
window.toggleLeadSelection = toggleLeadSelection;
window.toggleSelectAll = toggleSelectAll;
window.selectAllLeads = selectAllLeads;
window.deselectAllLeads = deselectAllLeads;
window.quickCall = quickCall;
window.closeQuickCallModal = closeQuickCallModal;
window.initiateQuickCall = initiateQuickCall;
window.callSelectedLeads = callSelectedLeads;
window.createCampaignFromLeads = createCampaignFromLeads;
window.exportSelectedLeads = exportSelectedLeads;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.retryFetch = retryFetch;
window.applyFilters = applyFilters;
window.removeFilter = removeFilter;
window.callLeadFromDetails = callLeadFromDetails;
window.closeLeadDetails = closeLeadDetails;