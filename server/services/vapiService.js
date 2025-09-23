const axios = require('axios');
const vapiConfig = require('../config/vapi.config');
const logger = require('../utils/logger');

// Debug: Log the assistant configuration
logger.info('🔧 VAPI Service - Assistant Configuration:');
logger.info(`Default Assistant ID: ${vapiConfig.assistantId}`);
logger.info(`Assistant Mappings: ${JSON.stringify(vapiConfig.assistants)}`);
logger.info(`Environment Variables:`);
logger.info(`VAPI_ASSISTANT_PFAS: ${process.env.VAPI_ASSISTANT_PFAS}`);
logger.info(`VAPI_ASSISTANT_HAIR_STRAIGHTENER: ${process.env.VAPI_ASSISTANT_HAIR_STRAIGHTENER}`);

class VapiService {
  constructor() {
    this.client = axios.create({
      baseURL: vapiConfig.baseUrl,
      headers: {
        'Authorization': `Bearer ${vapiConfig.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async createCall(customerData) {
    try {
      logger.info('VapiService.createCall input:', customerData);
      
      // Extract assistant type from metadata
      const assistantType = customerData.metadata?.assistantType;
      logger.info(`🔍 DEBUG: assistantType from metadata: ${assistantType}`);
      logger.info(`🔍 DEBUG: vapiConfig.assistants: ${JSON.stringify(vapiConfig.assistants)}`);
      
      let assistantId;
      
      if (assistantType && vapiConfig.assistants[assistantType]) {
        assistantId = vapiConfig.assistants[assistantType];
        logger.info(`✅ Using ${assistantType} assistant: ${assistantId}`);
      } else {
        assistantId = vapiConfig.assistantId; // Default PFAS assistant
        logger.info(`⚠️  Using default assistant: ${assistantId} (assistantType: ${assistantType}, available: ${Object.keys(vapiConfig.assistants)})`);
      }
      
      // UPDATED: Extract Bridge Legal ID and Convoso ID separately  
      const bridgeLegalId = customerData.leadid || 
                           customerData.metadata?.leadId || 
                           customerData.metadata?.bridgeLegalId || 
                           '';
                           
      const convosoId = customerData.convoso_id || 
                       customerData.lead_id || 
                       customerData.metadata?.lead_id || 
                       customerData.metadata?.convoso_id || 
                       '';
                       
      const organizationId = customerData.organizationid || 
                            customerData.metadata?.organizationId || 
                            customerData.metadata?.organization_id ||
                            '1';
      
      const payload = {
        assistantId: assistantId, // Use selected assistant
        phoneNumberId: vapiConfig.phoneNumberId,
        customer: {
          number: customerData.phone_number,
          numberE164CheckEnabled: true
        },
        maxDurationSeconds: 1800,
        assistantOverrides: {
          variableValues: {
            firstName: customerData.first_name || '',
            lastName: customerData.last_name || '',
            fullName: `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim(),
            phoneNumber: customerData.phone_number || '', // Add phone number as variable
            leadSource: customerData.lead_source || customerData.metadata?.source || '',
            leadType: customerData.case_type || customerData.metadata?.leadType || '',
            organizationId: String(organizationId || '1'),
            bridgeLegalId: String(bridgeLegalId || ''), // Bridge Legal's internal ID  
            leadId: String(bridgeLegalId || ''), // BRIDGE LEGAL ID - this is what VAPI assistant will use for bl_save_data
            convoso_lead_id: String(convosoId || ''), // CONVOSO ID - this is for callback status
            convosoId: String(convosoId || ''), // Also include as convosoId for clarity
            campaignId: customerData.metadata?.campaignId || '',
            notes: customerData.metadata?.notes || '',
            stage: customerData.metadata?.stage || '',
            fromPanel: customerData.metadata?.fromPanel || 'unknown',
            batchCall: String(customerData.metadata?.batchCall || false),
            // Include any Convoso-specific data if available
            convosoStatus: customerData.metadata?.convoso_status || '',
            convosoCalledCount: String(customerData.metadata?.convoso_called_count || '0'),
            carrierType: customerData.metadata?.carrier_type || '',
            carrierName: customerData.metadata?.carrier_name || ''
          }
        }
      };
  
      logger.info('🚀 VAPI PAYLOAD BEING SENT:');
      logger.info(JSON.stringify(payload, null, 2));
      logger.info(`📍 IDs - Bridge Legal (leadId): ${bridgeLegalId}, Convoso (convoso_lead_id): ${convosoId}, Organization: ${organizationId}`);
      
      const response = await this.client.post('/call', payload);
      
      logger.info('Vapi call created successfully', {
        callId: response.data.id,
        customerPhone: customerData.phone_number,
        customerName: `${customerData.first_name} ${customerData.last_name}`,
        convosoId: convosoId,
        bridgeLegalId: bridgeLegalId,
        maxDurationSeconds: 1800
      });
  
      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error('VAPI API Error Details:', {
          status: error.response.status,
          data: error.response.data,
          payload: payload
        });
      }
      logger.error('Error creating call:', error);
      throw error;
    }
  }

  /**
   * Create a conference call with the hold assistant
   * This assistant will engage with the customer while waiting for an agent
   */
  async createConferenceCall({ conferenceId, customerPhone, assistantId, metadata }) {
    try {
      const holdAssistantId = assistantId || process.env.VAPI_HOLD_ASSISTANT_ID;
      
      if (!holdAssistantId) {
        throw new Error('Hold assistant ID not configured');
      }
      
      // UPDATED: Include proper IDs in conference calls too
      const bridgeLegalId = metadata.leadId || metadata.bridgeLegalId || '';
      const convosoId = metadata.lead_id || metadata.convoso_id || '';
      const organizationId = metadata.organizationId || metadata.organization_id || '1';
  
      const payload = {
        assistantId: holdAssistantId,
        phoneNumberId: process.env.VAPI_HOLD_ASSISTANT_PHONE_NUMBER_ID,
        customer: {
          number: customerPhone,
          numberE164CheckEnabled: true
        },
        maxDurationSeconds: 1800, // 30 minutes max
        assistantOverrides: {
          variableValues: {
            conferenceId: conferenceId,
            isConferenceCall: 'true',
            customerName: metadata.customerName || '',
            customerPhone: customerPhone, // Ensure phone is passed as variable
            caseType: metadata.caseType || metadata.leadType || 'hair straightener',
            estimatedWaitTime: '2-3 minutes',
            previousResponses: metadata.sessionData || {},
            leadId: String(bridgeLegalId || ''), // BRIDGE LEGAL ID
            convosoId: String(convosoId || ''), // CONVOSO ID
            bridgeLegalId: String(bridgeLegalId || ''),
            organizationId: String(organizationId || '1'),
            qualificationSummary: metadata.qualificationSummary || '',
            exposureDetails: metadata.exposureDetails || '',
            healthConcerns: metadata.healthConcerns || '',
            // ENHANCED: Include structured data from prompt
            customInfo: JSON.stringify(metadata.customInfo || {}),
            qualificationResult: JSON.stringify(metadata.qualificationResult || {}),
            qualificationData: JSON.stringify(metadata.qualificationData || {}),
            // Additional phone number variations for compatibility
            phone: customerPhone,
            phoneNumber: customerPhone,
            customer_phone: customerPhone,
            // Include timestamp and data structure info
            dataStructure: metadata.dataStructure || 'prompt_aligned',
            transferTimestamp: metadata.timestamp || new Date().toISOString(),
            ...metadata
          },
          firstMessage: `Thanks for your patience! While we connect you with a specialist, I'll stay on the line with you. This typically takes 2-3 minutes. I see you've been affected by ${metadata.caseType || metadata.leadType || 'hair straightener'} exposure - I understand this must be a concerning time for you.`
        }
      };
  
      logger.info('Creating conference call with Vapi', {
        conferenceId,
        customerPhone,
        holdAssistantId,
        convosoId: convosoId,
        bridgeLegalId: bridgeLegalId,
        phoneNumberId: process.env.VAPI_HOLD_ASSISTANT_PHONE_NUMBER_ID
      });
  
      // Log the payload for debugging
      logger.info('VAPI Conference Call Payload:', JSON.stringify(payload, null, 2));
  
      const response = await this.client.post('/call', payload);
      
      logger.info('Conference call created successfully', {
        callId: response.data.id,
        conferenceId,
        convosoId: convosoId
      });
  
      return response.data;
    } catch (error) {
      // Enhanced error logging
      if (error.response) {
        logger.error('VAPI API Error Details:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        });
        
        // Log the exact error message from VAPI
        if (error.response.data) {
          logger.error('VAPI Error Response:', JSON.stringify(error.response.data, null, 2));
        }
      }
      
      logger.error('Error creating conference call:', error.message);
      throw error;
    }
  }

  /**
   * Handle agent joining the conference
   * This tells the VAPI assistant to gracefully exit
   */
  async handleAgentJoined(callId, agentInfo) {
    try {
      // Send a client message to the assistant
      await this.sendMessage(callId, {
        type: 'agent-joined',
        agentName: agentInfo.agentName,
        agentId: agentInfo.agentId,
        timestamp: new Date().toISOString()
      });

      // Give the assistant time to say goodbye
      setTimeout(async () => {
        try {
          await this.endCall(callId);
        } catch (err) {
          logger.error('Error ending VAPI call after agent joined:', err);
        }
      }, 5000); // 5 seconds for goodbye message

      return { success: true };
    } catch (error) {
      logger.error('Error handling agent joined:', error);
      throw error;
    }
  }

  async controlCall(callId, options) {
    try {
      const { controlUrl, action } = options;
      
      if (!controlUrl) {
        throw new Error('Control URL is required for call control operations');
      }

      logger.info(`Controlling call ${callId}`, {
        controlUrl: controlUrl,
        action: action
      });

      const response = await this.client.post(controlUrl, action);
      
      logger.info(`Call control successful for ${callId}`, {
        action: action.type || action.action,
        result: response.data
      });

      return response.data;
    } catch (error) {
      logger.error(`Error controlling call ${callId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getCall(callId) {
    try {
      const response = await this.client.get(`/call/${callId}`);
      return response.data;
    } catch (error) {
      logger.error('Error retrieving call:', error);
      throw error;
    }
  }

  async updateCall(callId, updateData) {
    try {
      const response = await this.client.patch(`/call/${callId}`, updateData);
      return response.data;
    } catch (error) {
      logger.error('Error updating call:', error);
      throw error;
    }
  }

  async endCall(callId) {
    try {
      const response = await this.client.patch(`/call/${callId}`, {
        status: 'ended'
      });
      return response.data;
    } catch (error) {
      logger.error('Error ending call:', error);
      throw error;
    }
  }

  // Get assistant configuration
  async getAssistant() {
    try {
      const assistantId = vapiConfig.assistantId;
      if (!assistantId) {
        throw new Error('Default assistant ID not configured (VAPI_ASSISTANT_PFAS)');
      }

      const response = await this.client.get(`/assistant/${assistantId}`);
      return response.data;
    } catch (error) {
      logger.error('Error getting assistant:', error);
      throw error;
    }
  }

  // Update assistant webhook URL
  async updateAssistantWebhook() {
    try {
      const assistantId = vapiConfig.assistantId;
      const webhookUrl = vapiConfig.webhookUrl;

      if (!assistantId) {
        throw new Error('Default assistant ID not configured (VAPI_ASSISTANT_PFAS)');
      }

      if (!webhookUrl) {
        throw new Error('WEBHOOK_URL not configured');
      }

      const response = await this.client.patch(`/assistant/${assistantId}`, {
        serverUrl: webhookUrl
      });

      logger.info('Assistant webhook URL updated successfully', {
        assistantId,
        webhookUrl,
        serverUrl: response.data.serverUrl
      });

      return response.data;
    } catch (error) {
      logger.error('Error updating assistant webhook:', error);
      throw error;
    }
  }

  // Send message to assistant during call
  async sendMessage(callId, message) {
    try {
      const response = await this.client.post(`/call/${callId}/say`, {
        message: message
      });
      return response.data;
    } catch (error) {
      logger.error('Error sending message:', error);
      throw error;
    }
  }
}

module.exports = new VapiService();