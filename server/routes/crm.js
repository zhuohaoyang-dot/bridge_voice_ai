const express = require('express');
const router = express.Router();
const axios = require('axios');
const logger = require('../utils/logger');
const convosoService = require('../services/convosoService');

// Bridge Legal CRM API configuration
const CRM_API_TOKEN = process.env.CRM_API_TOKEN || 'production_BN3ohoXElRlVFfiBUg9ldSrT';
const CRM_API_BASE = 'https://api.bridgify.com/venture/openapi/v1';

// Helper function to create CRM client
function createCRMClient() {
    return axios.create({
        baseURL: CRM_API_BASE,
        headers: {
            'Authorization': CRM_API_TOKEN, // Remove 'Bearer ' prefix since your curl doesn't use it
            'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
    });
}

// GET /api/crm/leads - Fetch leads from Bridge Legal CRM with Convoso ID enrichment
router.get('/leads', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 100, 
            leadType, 
            source, 
            fromDate, 
            toDate,
            includeConvosoId = 'true' // New parameter to control Convoso lookup
        } = req.query;
        
        logger.info('Fetching leads from Bridge Legal CRM with filters:', {
            page, limit, leadType, source, fromDate, toDate, includeConvosoId
        });
        
        // Build query parameters
        const params = {
            pageNumber: parseInt(page),
            pageSize: parseInt(limit)
        };
        
        // ENHANCED: Try different pagination parameter names for better compatibility
        if (page && page !== '1') {
            params.page = parseInt(page);      // Some APIs use 'page' instead of 'pageNumber'
            params.offset = (parseInt(page) - 1) * parseInt(limit); // Some APIs use offset
        }
        
        if (leadType) params.leadType = leadType;
        if (source) params.source = source;
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        
        // ENHANCED: Add sorting to ensure consistent pagination
        params.sortBy = 'id';          // Sort by ID for consistent ordering
        params.sortOrder = 'desc';     // Newest first
        params.orderBy = 'id DESC';    // Alternative sort format
        
        const crmClient = createCRMClient();
        
        // Try multiple possible endpoints for fetching leads
        const possibleEndpoints = [
            '/leads',
            '/lead/search',
            '/lead/query'
        ];
        
        let response = null;
        let successfulEndpoint = null;
        
        for (const endpoint of possibleEndpoints) {
            try {
                logger.info(`Trying CRM endpoint: ${endpoint}`);
                
                if (endpoint === '/lead/query' || endpoint === '/lead/search') {
                    // Try POST for search/query endpoints
                    response = await crmClient.post(endpoint, params);
                } else {
                    // Try GET for list endpoints
                    response = await crmClient.get(endpoint, { params });
                }
                
                // Check if we got a successful response
                if (response.data && response.data.code === 0) {
                    successfulEndpoint = endpoint;
                    logger.info(`✅ Success with endpoint: ${endpoint}`);
                    break;
                } else if (response.data && typeof response.data === 'object' && response.data.data) {
                    successfulEndpoint = endpoint;
                    logger.info(`✅ Success with endpoint: ${endpoint} (legacy format)`);
                    break;
                }
                
            } catch (endpointError) {
                logger.info(`❌ Endpoint ${endpoint} failed:`, endpointError.response?.status, endpointError.response?.data?.message || endpointError.message);
                continue;
            }
        }
        
        if (!response || !successfulEndpoint) {
            logger.error('All CRM endpoints failed. API structure may have changed.');
            return res.status(502).json({
                error: 'CRM API endpoints not found',
                message: 'Unable to find working endpoint for fetching leads. Please check API documentation.',
                testedEndpoints: possibleEndpoints,
                leads: [],
                total: 0,
                page: 1
            });
        }
        
        // Check if response is HTML (authentication failure)
        if (typeof response.data === 'string' && response.data.includes('<!doctype html>')) {
            logger.error('CRM API returned HTML (authentication failed)');
            logger.error('CRM Response contains login page - check API token validity');
            return res.status(401).json({ 
                error: 'CRM Authentication Failed',
                message: 'The CRM API token appears to be invalid or expired. Please check your CRM_API_TOKEN environment variable.',
                leads: [], 
                total: 0, 
                page: 1 
            });
        }
        
        // Check for proper JSON response structure
        if (!response.data || typeof response.data !== 'object') {
            logger.warn('CRM API returned unexpected response format');
            logger.warn('Response type:', typeof response.data);
            return res.status(502).json({ 
                error: 'Invalid CRM Response',
                message: 'CRM API returned unexpected response format',
                leads: [], 
                total: 0, 
                page: 1 
            });
        }
        
        // Handle different response formats
        let leads = [];
        let totalCount = 0;
        
        if (response.data.code === 0) {
            // Bridgify API format: {code: 0, msg: "Succeeded", data: {list: [...], total: 123}}
            if (response.data.data && response.data.data.list) {
                leads = Array.isArray(response.data.data.list) ? response.data.data.list : [];
                totalCount = response.data.data.total || leads.length;
                logger.info(`Successfully fetched ${leads.length} leads from CRM using ${successfulEndpoint} (Bridgify format)`);
                
                // ENHANCED: Log pagination info for debugging
                logger.info(`Pagination debug: page=${page}, pageSize=${limit}, total=${totalCount}, returned=${leads.length}`);
                
                // ENHANCED: Log first and last lead IDs to check for overlap
                if (leads.length > 0) {
                    const firstId = leads[0].id || leads[0].leadId || leads[0].leadid;
                    const lastId = leads[leads.length - 1].id || leads[leads.length - 1].leadId || leads[leads.length - 1].leadid;
                    logger.info(`Lead ID range: ${firstId} to ${lastId}`);
                }
            } else {
                logger.warn('Bridgify API response missing data.list structure');
                logger.info('Actual response.data.data structure:', response.data.data);
            }
        } else if (response.data.data) {
            // Legacy format: {data: [...], meta: {...}}
            leads = Array.isArray(response.data.data) ? response.data.data : [];
            totalCount = response.data.meta?.total || leads.length;
            logger.info(`Successfully fetched ${leads.length} leads from CRM using ${successfulEndpoint} (legacy format)`);
            
            // ENHANCED: Log pagination info for debugging
            logger.info(`Pagination debug: page=${page}, pageSize=${limit}, total=${totalCount}, returned=${leads.length}`);
        } else {
            logger.warn('No leads data found in CRM response');
            logger.info('CRM Response structure:', Object.keys(response.data));
            return res.json({ 
                code: 0,
                msg: "No leads found in CRM",
                data: {
                    list: [],
                    total: 0,
                    pageNum: parseInt(page),
                    pageSize: parseInt(limit),
                    pages: 0
                },
                endpoint: successfulEndpoint
            });
        }

        if (leads.length === 0) {
            logger.info('CRM returned empty lead list - no leads in database or filters too restrictive');
            return res.json({ 
                code: 0,
                msg: "No leads found matching criteria",
                data: {
                    list: [],
                    total: totalCount,
                    pageNum: parseInt(page),
                    pageSize: parseInt(limit),
                    pages: 0
                },
                endpoint: successfulEndpoint
            });
        }
        
        // Enrich with Convoso IDs if requested
        if (includeConvosoId === 'true' && leads.length > 0) {
            logger.info(`Enriching ${leads.length} leads with Convoso IDs`);
            
            // Search for Convoso IDs in batch
            const convosoResults = await convosoService.searchLeadsBatch(leads);
            
            // Merge Convoso data with leads
            leads = leads.map(lead => {
                const convosoData = convosoResults[lead.id];
                
                return {
                    ...lead,
                    convoso_id: convosoData?.convoso_id || null,
                    lead_id: convosoData?.convoso_id || null, // Also include as lead_id for consistency
                    convoso_status: convosoData?.convoso_status || null,
                    convoso_called_count: convosoData?.convoso_called_count || 0,
                    carrier_type: convosoData?.carrier_type || null,
                    carrier_name: convosoData?.carrier_name || null,
                    has_convoso_data: !!convosoData
                };
            });
            
            const enrichedCount = leads.filter(lead => lead.has_convoso_data).length;
            logger.info(`Enriched ${enrichedCount} out of ${leads.length} leads with Convoso data`);
        }
        
        res.json({
            code: 0,
            msg: "Succeeded",
            data: {
                list: leads,
                total: totalCount,
                pageNum: parseInt(page),
                pageSize: parseInt(limit),
                pages: Math.ceil(totalCount / parseInt(limit))
            },
            convoso_enriched: includeConvosoId === 'true',
            endpoint: successfulEndpoint // Include which endpoint worked for debugging
        });
        
    } catch (error) {
        logger.error('Error fetching CRM leads:', error);
        
        if (error.response) {
            // Log detailed error information
            logger.error('CRM API Error Details:', {
                status: error.response.status,
                statusText: error.response.statusText,
                headers: error.response.headers,
                data: typeof error.response.data === 'string' 
                    ? error.response.data.substring(0, 200) 
                    : error.response.data
            });
            
            return res.status(error.response.status).json({
                error: 'CRM API error',
                message: error.response.data?.message || 'Failed to fetch leads',
                details: error.response.status === 401 ? 'Authentication failed - check API token' : error.response.statusText
            });
        }
        
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch leads from CRM'
        });
    }
});

// GET /api/crm/leads/:id - Get single lead with Convoso data
router.get('/leads/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        logger.info(`Fetching lead ${id} from Bridge Legal CRM`);
        
        const crmClient = createCRMClient();
        
        // Fetch lead from Bridge Legal CRM
        const response = await crmClient.get(`/leads/${id}`);
        
        if (!response.data || !response.data.data) {
            return res.status(404).json({
                error: 'Lead not found'
            });
        }
        
        let lead = response.data.data;
        
        // Try to enrich with Convoso data
        if (lead.first_name && lead.last_name && lead.phone) {
            const convosoData = await convosoService.searchLead({
                firstName: lead.first_name,
                lastName: lead.last_name,
                phoneNumber: lead.phone
            });
            
            if (convosoData) {
                lead = {
                    ...lead,
                    convoso_id: convosoData.convoso_id,
                    lead_id: convosoData.convoso_id, // Also include as lead_id
                    convoso_status: convosoData.convoso_status,
                    convoso_called_count: convosoData.convoso_called_count,
                    carrier_type: convosoData.carrier_type,
                    carrier_name: convosoData.carrier_name,
                    has_convoso_data: true
                };
                
                logger.info(`Enriched lead ${id} with Convoso ID: ${convosoData.convoso_id}`);
            } else {
                lead.has_convoso_data = false;
            }
        }
        
        res.json({
            lead
        });
        
    } catch (error) {
        logger.error('Error fetching single lead:', error);
        
        if (error.response?.status === 404) {
            return res.status(404).json({
                error: 'Lead not found'
            });
        }
        
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch lead'
        });
    }
});

// GET /api/crm/lead-types - Get available lead types
router.get('/lead-types', async (req, res) => {
    try {
        // Bridge Legal lead types - Updated to match actual data
        const leadTypes = [
            { id: 'Toxic Metal Baby Food', name: 'Toxic Metal Baby Food' },
            { id: 'Video Game Addiction', name: 'Video Game Addiction' },
            { id: 'Roblox', name: 'Roblox' },
            { id: 'LDS', name: 'LDS' },
            { id: 'hair straightener', name: 'Hair Straightener' },
            { id: 'Rideshare', name: 'Rideshare' },
            { id: 'CA WP Sexual Abuse', name: 'CA WP Sexual Abuse' },
            { id: 'Asbestos', name: 'Asbestos' },
            { id: 'Glyphosate', name: 'Glyphosate' },
            { id: 'Dupixent', name: 'Dupixent' },
            { id: 'IL JDC Abuse', name: 'IL JDC Abuse' },
            { id: 'JDC Abuse', name: 'JDC Abuse' },
            { id: 'PFAS', name: 'PFAS - Water Contamination' },
            { id: 'AFFF', name: 'AFFF - Firefighting Foam' }
        ];
        
        res.json({ leadTypes });
        
    } catch (error) {
        logger.error('Error fetching lead types:', error);
        res.status(500).json({
            error: 'Failed to fetch lead types'
        });
    }
});

// GET /api/crm/sources - Get available lead sources
router.get('/sources', async (req, res) => {
    try {
        // Common lead sources
        const sources = [
            { id: 'FACEBOOK', name: 'Facebook Ads' },
            { id: 'GOOGLE', name: 'Google Ads' },
            { id: 'TIKTOK', name: 'TikTok Ads' },
            { id: 'TV', name: 'TV Campaign' },
            { id: 'RADIO', name: 'Radio Campaign' },
            { id: 'REFERRAL', name: 'Referral' },
            { id: 'WEBSITE', name: 'Website Form' },
            { id: 'CONVOSO', name: 'Convoso' },
            { id: 'LIVE_TRANSFER', name: 'Live Transfer' },
            { id: 'OTHER', name: 'Other' }
        ];
        
        res.json({ sources });
        
    } catch (error) {
        logger.error('Error fetching sources:', error);
        res.status(500).json({
            error: 'Failed to fetch sources'
        });
    }
});

// POST /api/crm/leads/:id/convoso - Manually fetch/update Convoso ID for a lead
router.post('/leads/:id/convoso', async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, phoneNumber } = req.body;
        
        if (!firstName || !lastName || !phoneNumber) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'firstName, lastName, and phoneNumber are required'
            });
        }
        
        logger.info(`Manually searching Convoso for lead ${id}`);
        
        const convosoData = await convosoService.searchLead({
            firstName,
            lastName,
            phoneNumber
        });
        
        if (convosoData) {
            res.json({
                success: true,
                convoso_id: convosoData.convoso_id,
                lead_id: convosoData.convoso_id,
                convoso_data: convosoData
            });
        } else {
            res.json({
                success: false,
                message: 'No matching lead found in Convoso'
            });
        }
        
    } catch (error) {
        logger.error('Error searching Convoso:', error);
        res.status(500).json({
            error: 'Failed to search Convoso',
            message: error.message
        });
    }
});

// Add rate limiting to protect the API
const rateLimit = require('express-rate-limit');
const crmLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: 'Too many requests, please try again later.'
});

router.use(crmLimiter);

module.exports = router;