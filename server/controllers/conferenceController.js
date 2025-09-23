const twilioService = require('../services/twilioService');
const vapiService = require('../services/vapiService');
const redisService = require('../services/redisService');
const logger = require('../utils/logger');
const { broadcastToClients } = require('../websocket');

class ConferenceController {
  /**
   * Helper methods to work with your Redis service
   */
  static async saveConferenceData(conferenceId, data, ttl = 1800) {
    try {
      const key = `conference:${conferenceId}`;
      await redisService.client.setEx(key, ttl, JSON.stringify(data));
    } catch (error) {
      logger.error('Error saving conference data:', error);
      throw error;
    }
  }

  // when agent answers from queue
  static async handleQueueAgentJoin(conferenceId, callSid) {
    try {
        const conferenceData = await ConferenceController.getConferenceData(conferenceId);
        
        if (conferenceData && callSid === conferenceData.queueCallSid) {
            logger.info('🎉 Agent joined from queue!', { conferenceId });
            
            // Update conference status
            await ConferenceController.updateConferenceData(conferenceId, {
                status: 'agent_connected',
                agentJoinedAt: new Date().toISOString(),
                participants: ['customer', 'hold_assistant', 'agent']
            });
            
            // Notify hold assistant to leave
            if (conferenceData.holdAssistantCallId) {
                await vapiService.sendMessage(conferenceData.holdAssistantCallId, {
                    type: 'agent-joined',
                    message: 'Senior consultant has joined. Please say goodbye and disconnect.'
                });
                
                // Schedule hold assistant removal after goodbye
                setTimeout(async () => {
                    try {
                        await vapiService.endCall(conferenceData.holdAssistantCallId);
                    } catch (err) {
                        logger.error('Error ending hold assistant call:', err);
                    }
                }, 5000); // 5 seconds for goodbye
            }
            
            // Broadcast update
            broadcastToClients({
                type: 'agent_connected',
                data: { conferenceId, timestamp: new Date().toISOString() }
            });
        }
    } catch (error) {
        logger.error('Error handling queue agent join:', error);
    }
  }


  static async getConferenceData(conferenceId) {
    try {
      const key = `conference:${conferenceId}`;
      const data = await redisService.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Error getting conference data:', error);
      throw error;
    }
  }

  static async updateConferenceData(conferenceId, updates) {
    try {
      const conferenceData = await ConferenceController.getConferenceData(conferenceId);
      if (!conferenceData) {
        throw new Error('Conference not found');
      }
      const updatedData = { ...conferenceData, ...updates };
      await ConferenceController.saveConferenceData(conferenceId, updatedData);
      return updatedData;
    } catch (error) {
      logger.error('Error updating conference data:', error);
      throw error;
    }
  }

  /**
   * Create a conference bridge for customer waiting
   */
  static async createConference(req, res) {
    try {
      const { callId, customerId, customerPhone, customerName, sessionData } = req.body;

      // Generate unique conference ID
      const conferenceId = `pfas-${Date.now()}-${customerId}`;
      
      logger.info('Creating conference bridge', { 
        conferenceId, 
        callId, 
        customerId 
      });

      // Create conference room structure
      const conference = await twilioService.createConference({
        conferenceId,
        customerId,
        customerPhone,
        initialCallId: callId
      });

      // Store conference data in Redis
      await ConferenceController.saveConferenceData(conferenceId, {
        conferenceId,
        customerId,
        customerPhone,
        customerName,
        sessionData,
        status: 'waiting',
        createdAt: new Date().toISOString(),
        participants: []
      }, 1800); // 30 min expiry

      // Create VAPI hold assistant call to join conference
      const vapiCall = await vapiService.createConferenceCall({
        conferenceId,
        customerPhone,
        assistantId: process.env.VAPI_HOLD_ASSISTANT_ID,
        metadata: {
          conferenceId,
          customerId,
          customerName,
          sessionData,
          qualificationComplete: true,
          caseType: sessionData?.caseType || 'PFAS'
        }
      });

      // Update Redis with VAPI call info
      await ConferenceController.updateConferenceData(conferenceId, {
        vapiCallId: vapiCall.id,
        participants: ['vapi_assistant'],
        status: 'waiting_with_assistant'
      });

      // Notify WebSocket clients
      broadcastToClients({
        type: 'conference_created',
        data: {
          conferenceId,
          customerId,
          status: 'waiting_with_assistant',
          hasAssistant: true
        }
      });

      res.json({
        success: true,
        conferenceId,
        conference,
        vapiCall,
        message: 'Conference created with VAPI hold assistant'
      });

    } catch (error) {
      logger.error('Error creating conference:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Add agent to existing conference
   */
  static async addAgentToConference(req, res) {
    try {
      const { conferenceId, agentPhone, agentName, agentId } = req.body;

      logger.info('Adding agent to conference', { 
        conferenceId, 
        agentId 
      });

      // Get conference data
      const conferenceData = await ConferenceController.getConferenceData(conferenceId);
      if (!conferenceData) {
        throw new Error('Conference not found');
      }

      // Call agent and add to conference
      const agentCall = await twilioService.addParticipantToConference({
        conferenceId,
        participantPhone: agentPhone,
        participantName: agentName,
        whisperMessage: `Connecting you to ${conferenceData.customerName || 'the customer'} for a PFAS case. The customer is currently with our AI assistant.`
      });

      // Update conference data
      await ConferenceController.updateConferenceData(conferenceId, {
        status: 'agent_joined',
        agentId,
        agentName,
        agentJoinedAt: new Date().toISOString(),
        participants: ['vapi_assistant', 'agent']
      });

      // Send message to VAPI that agent has joined
      if (conferenceData.vapiCallId) {
        await vapiService.sendMessage(conferenceData.vapiCallId, {
          type: 'agent-joined',
          agentName,
          message: 'Agent from Bridge Litigation Support has joined'
        });
      }

      // Notify WebSocket clients
      broadcastToClients({
        type: 'agent_joined_conference',
        data: {
          conferenceId,
          agentId,
          agentName,
          participants: 2
        }
      });

      res.json({
        success: true,
        conferenceId,
        agentCall,
        message: 'Agent successfully added to conference'
      });

    } catch (error) {
      logger.error('Error adding agent to conference:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get conference status
   */
  static async getConferenceStatus(req, res) {
    try {
      const { conferenceId } = req.params;

      // Get from Redis
      const conferenceData = await ConferenceController.getConferenceData(conferenceId);
      if (!conferenceData) {
        return res.status(404).json({
          success: false,
          error: 'Conference not found'
        });
      }

      // Get live status from Twilio
      const twilioStatus = await twilioService.getConferenceStatus(conferenceId);

      // Calculate wait time
      const waitTimeSeconds = conferenceData.createdAt ? 
        Math.floor((Date.now() - new Date(conferenceData.createdAt).getTime()) / 1000) : 0;

      res.json({
        success: true,
        conference: {
          ...conferenceData,
          twilioStatus,
          waitTime: waitTimeSeconds,
          waitTimeFormatted: `${Math.floor(waitTimeSeconds / 60)}m ${waitTimeSeconds % 60}s`
        }
      });

    } catch (error) {
      logger.error('Error getting conference status:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * End conference
   */
  static async endConference(req, res) {
    try {
      const { conferenceId } = req.params;

      logger.info('Ending conference', { conferenceId });

      // Get conference data
      const conferenceData = await ConferenceController.getConferenceData(conferenceId);
      
      // End VAPI call if active
      if (conferenceData?.vapiCallId) {
        try {
          await vapiService.endCall(conferenceData.vapiCallId);
        } catch (err) {
          logger.error('Error ending VAPI call:', err);
        }
      }

      // End conference in Twilio
      await twilioService.endConference(conferenceId);

      // Update Redis
      await ConferenceController.updateConferenceData(conferenceId, {
        status: 'ended',
        endedAt: new Date().toISOString()
      });

      // Notify WebSocket
      broadcastToClients({
        type: 'conference_ended',
        data: { conferenceId }
      });

      res.json({
        success: true,
        conferenceId,
        message: 'Conference ended successfully'
      });

    } catch (error) {
      logger.error('Error ending conference:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle Twilio conference webhooks
   */
  static async handleTwilioWebhook(req, res) {
    try {
      const {
        ConferenceSid,
        StatusCallbackEvent,
        CallSid,
        FriendlyName,
        From,
        To
      } = req.body;

      logger.info('Twilio conference webhook', {
        event: StatusCallbackEvent,
        conference: FriendlyName || ConferenceSid,
        callSid: CallSid,
        from: From,
        to: To
      });

      // Handle different conference events
      switch (StatusCallbackEvent) {
        case 'participant-join':
          if (FriendlyName) {
            logger.info(`🎯 Participant joined conference: ${FriendlyName}`, {
              callSid: CallSid,
              from: From
            });

            // Check if this is the queue agent joining
            if (From === '+18336130051' || To === '+18336130051') {
              logger.info('🎉 Queue agent detected joining conference');
              await ConferenceController.handleQueueAgentJoin(FriendlyName, CallSid);
            } else {
              // Update participant list for other joins (customer, hold assistant)
              const conferenceData = await ConferenceController.getConferenceData(FriendlyName);
              if (conferenceData) {
                // For SIP transfers, we identify customer by phone number match
                const normalizedFrom = From?.replace('+1', '').replace('+', '');
                const normalizedCustomer = conferenceData.customerPhone?.replace('+1', '').replace('+', '');
                
                let participantType = 'other';
                if (normalizedFrom === normalizedCustomer) {
                  participantType = 'customer';
                  // Update conference with customer call info for SIP transfer
                  await ConferenceController.updateConferenceData(FriendlyName, {
                    customerCallSid: CallSid,
                    customerJoinedAt: new Date().toISOString(),
                    status: 'customer_connected'
                  });
                  
                  if (!conferenceData.participants.includes('customer')) {
                    conferenceData.participants.push('customer');
                  }
                } else if (CallSid === conferenceData.holdAssistantCallId) {
                  participantType = 'hold_assistant';
                }
                
                logger.info(`�� ${participantType} joined conference ${FriendlyName}`, {
                  callSid: CallSid,
                  participantCount: conferenceData.participants.length + 1
                });
                
                // Broadcast participant join
                broadcastToClients({
                  type: 'conference_participant_joined',
                  data: {
                    conferenceId: FriendlyName,
                    participantType,
                    callSid: CallSid,
                    participants: conferenceData.participants
                  }
                });
              }
            }
          }
          break;

        case 'participant-leave':
          if (FriendlyName) {
            logger.info(`👋 Participant left conference: ${FriendlyName}`, {
              callSid: CallSid
            });

            const conferenceData = await ConferenceController.getConferenceData(FriendlyName);
            if (conferenceData) {
              // Check if hold assistant left (expected after agent joins)
              if (CallSid === conferenceData.holdAssistantCallId) {
                logger.info('🤖 Hold assistant left conference as expected');
                await ConferenceController.updateConferenceData(FriendlyName, {
                  status: 'agent_and_customer_connected',
                  holdAssistantLeftAt: new Date().toISOString()
                });
              }
            }
          }
          break;

        case 'conference-start':
          if (FriendlyName) {
            logger.info(`🚀 Conference started: ${FriendlyName}`);
            await ConferenceController.updateConferenceData(FriendlyName, {
              conferenceStartedAt: new Date().toISOString(),
              twilioConferenceSid: ConferenceSid
            });
          }
          break;

        case 'conference-end':
          if (FriendlyName) {
            logger.info(`🏁 Conference ended: ${FriendlyName}`);
            const conferenceData = await ConferenceController.getConferenceData(FriendlyName);
            
            if (conferenceData) {
              await ConferenceController.updateConferenceData(FriendlyName, {
                status: 'ended',
                endedAt: new Date().toISOString(),
                twilioConferenceSid: ConferenceSid
              });

              // Broadcast conference end
              broadcastToClients({
                type: 'conference_ended',
                data: {
                  conferenceId: FriendlyName,
                  endedAt: new Date().toISOString(),
                  finalStatus: 'completed'
                }
              });
            }
          }
          break;

        default:
          logger.info(`📝 Unhandled conference event: ${StatusCallbackEvent}`);
      }

      res.status(200).send('OK');

    } catch (error) {
      logger.error('Error handling Twilio webhook:', error);
      res.status(200).send('OK'); // Always return 200 to Twilio
    }
  }

  /**
   * Test endpoint to simulate the full flow
   */
  static async testConferenceFlow(req, res) {
    try {
      const { customerPhone = '+1234567890', customerName = 'Test Customer' } = req.body;

      logger.info('Starting conference test flow');

      // Test that Redis is connected
      const redisConnected = redisService.isConnected;
      if (!redisConnected) {
        throw new Error('Redis is not connected');
      }

      // Step 1: Create test conference
      const conferenceId = `test-${Date.now()}`;
      
      const result = {
        conferenceId,
        redisConnected,
        message: 'Test conference created',
        steps: [
          '1. Conference room created',
          '2. VAPI hold assistant would join and engage customer',
          '3. Agent can be added manually via add-agent endpoint',
          '4. When agent says "Bridge Litigation Support", VAPI exits',
          '5. Customer and agent continue conversation'
        ],
        nextAction: `POST /api/conference/add-agent with conferenceId: ${conferenceId}`
      };

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      logger.error('Error in test flow:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = ConferenceController;