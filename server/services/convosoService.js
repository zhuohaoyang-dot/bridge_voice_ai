const axios = require('axios');
const logger = require('../utils/logger');

class ConvosoService {
    constructor() {
        this.apiToken = process.env.CONVOSO_API_TOKEN || 'dmjhrjn17ou4k7s0u64m7qgwci4v9efd';
        this.baseUrl = process.env.CONVOSO_API_URL || 'https://api.convoso.com/v1';
        
        // Create axios instance with default config
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000, // 10 second timeout
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
    }

    /**
     * Search for a lead in Convoso by name and phone number
     * @param {Object} params - Search parameters
     * @param {string} params.firstName - Lead's first name
     * @param {string} params.lastName - Lead's last name
     * @param {string} params.phoneNumber - Lead's phone number
     * @returns {Promise<Object|null>} - Lead data with Convoso ID or null if not found
     */
    async searchLead({ firstName, lastName, phoneNumber }) {
        try {
            // Clean phone number - remove all non-digits
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            
            logger.info(`Searching Convoso for lead: ${firstName} ${lastName} - ${cleanPhone}`);
            
            // Prepare form data
            const params = new URLSearchParams();
            params.append('auth_token', this.apiToken);
            params.append('first_name', firstName);
            params.append('last_name', lastName);
            params.append('phone_number', cleanPhone);
            
            const response = await this.client.post('/leads/search', params.toString());
            
            if (response.data.success && response.data.data.total > 0) {
                const lead = response.data.data.entries[0];
                logger.info(`Found Convoso lead ID: ${lead.id} for ${firstName} ${lastName}`);
                
                return {
                    convoso_id: lead.id,
                    convoso_status: lead.status,
                    convoso_created_at: lead.created_at,
                    convoso_modified_at: lead.modified_at,
                    convoso_called_count: lead.called_count,
                    convoso_list_id: lead.list_id,
                    convoso_source_id: lead.source_id,
                    carrier_name: lead.carrier_name,
                    carrier_type: lead.carrier_type,
                    full_data: lead
                };
            } else {
                logger.info(`No Convoso lead found for ${firstName} ${lastName} - ${cleanPhone}`);
                return null;
            }
            
        } catch (error) {
            logger.error('Error searching Convoso lead:', error.message);
            if (error.response) {
                logger.error('Convoso API response:', error.response.data);
            }
            
            // Return null instead of throwing to allow graceful handling
            return null;
        }
    }

    /**
     * Search multiple leads in batch (with rate limiting)
     * @param {Array} leads - Array of lead objects with firstName, lastName, phoneNumber
     * @returns {Promise<Object>} - Map of original lead IDs to Convoso data
     */
    async searchLeadsBatch(leads) {
        const results = {};
        const batchSize = 5; // Process 5 leads at a time to avoid rate limiting
        const delayMs = 200; // 200ms delay between batches
        
        logger.info(`Starting batch search for ${leads.length} leads in Convoso`);
        
        for (let i = 0; i < leads.length; i += batchSize) {
            const batch = leads.slice(i, i + batchSize);
            
            // Process batch in parallel
            const batchPromises = batch.map(async (lead) => {
                try {
                    const convosoData = await this.searchLead({
                        firstName: lead.first_name || lead.firstName,
                        lastName: lead.last_name || lead.lastName,
                        phoneNumber: lead.phone || lead.phone_number || lead.phoneNumber
                    });
                    
                    return {
                        leadId: lead.id || lead.leadid,
                        convosoData
                    };
                } catch (error) {
                    logger.error(`Error searching lead ${lead.id}:`, error.message);
                    return {
                        leadId: lead.id || lead.leadid,
                        convosoData: null
                    };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            
            // Store results
            batchResults.forEach(result => {
                results[result.leadId] = result.convosoData;
            });
            
            // Add delay between batches (except for last batch)
            if (i + batchSize < leads.length) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        logger.info(`Batch search completed. Found ${Object.values(results).filter(r => r !== null).length} matches out of ${leads.length} leads`);
        
        return results;
    }

    /**
     * Get lead details by Convoso ID
     * @param {string} convosoId - Convoso lead ID
     * @returns {Promise<Object|null>} - Full lead details or null if not found
     */
    async getLeadById(convosoId) {
        try {
            logger.info(`Fetching Convoso lead details for ID: ${convosoId}`);
            
            const params = new URLSearchParams();
            params.append('auth_token', this.apiToken);
            params.append('id', convosoId);
            
            const response = await this.client.post('/leads/get', params.toString());
            
            if (response.data.success && response.data.data) {
                return response.data.data;
            } else {
                logger.warn(`No lead found with Convoso ID: ${convosoId}`);
                return null;
            }
            
        } catch (error) {
            logger.error('Error fetching Convoso lead by ID:', error.message);
            return null;
        }
    }

    /**
     * Update lead in Convoso
     * @param {string} convosoId - Convoso lead ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<boolean>} - Success status
     */
    async updateLead(convosoId, updates) {
        try {
            logger.info(`Updating Convoso lead ${convosoId}:`, updates);
            
            const params = new URLSearchParams();
            params.append('auth_token', this.apiToken);
            params.append('id', convosoId);
            
            // Add update fields
            Object.entries(updates).forEach(([key, value]) => {
                params.append(key, value);
            });
            
            const response = await this.client.post('/leads/update', params.toString());
            
            if (response.data.success) {
                logger.info(`Successfully updated Convoso lead ${convosoId}`);
                return true;
            } else {
                logger.error(`Failed to update Convoso lead ${convosoId}:`, response.data);
                return false;
            }
            
        } catch (error) {
            logger.error('Error updating Convoso lead:', error.message);
            return false;
        }
    }
}

// Export singleton instance
module.exports = new ConvosoService();