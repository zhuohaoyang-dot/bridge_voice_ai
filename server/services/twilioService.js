const twilio = require('twilio');
const logger = require('../utils/logger');

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    this.baseUrl = process.env.SERVER_BASE_URL || 'https://your-server.com';
  }

  /**
   * Create a new conference room
   */
  async createConference({ conferenceId, customerId, customerPhone, initialCallId }) {
    try {
      logger.info('Creating Twilio conference', { conferenceId });

      // Conference TwiML
      const twiml = `
        <Response>
          <Dial>
            <Conference 
              statusCallback="${this.baseUrl}/api/conference/webhook/twilio"
              statusCallbackEvent="start end join leave mute hold"
              statusCallbackMethod="POST"
              endConferenceOnExit="false"
              startConferenceOnEnter="true"
              muted="false"
              beep="false"
              waitUrl="${this.baseUrl}/api/conference/wait-music">
              ${conferenceId}
            </Conference>
          </Dial>
        </Response>
      `;

      // Update the existing call to join conference
      // This assumes you have the Twilio Call SID from the initial VAPI call
      // You might need to store this mapping in your system
      const conference = {
        conferenceId,
        status: 'created',
        twiml
      };

      return conference;

    } catch (error) {
      logger.error('Error creating conference:', error);
      throw error;
    }
  }

  /**
   * Add a participant to an existing conference
   */
  async addParticipantToConference({ conferenceId, participantPhone, participantName, whisperMessage }) {
    try {
      logger.info('Adding participant to conference', { 
        conferenceId, 
        participantPhone 
      });

      // Create TwiML with optional whisper
      let twiml = '<Response>';
      
      if (whisperMessage) {
        twiml += `<Say>${whisperMessage}</Say>`;
      }
      
      twiml += `
        <Dial>
          <Conference 
            endConferenceOnExit="false"
            startConferenceOnEnter="true"
            beep="false">
            ${conferenceId}
          </Conference>
        </Dial>
      </Response>`;

      // Create outbound call to participant
      const call = await this.client.calls.create({
        to: participantPhone,
        from: this.phoneNumber,
        twiml: twiml,
        statusCallback: `${this.baseUrl}/api/conference/webhook/twilio`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        machineDetection: 'Enable',
        machineDetectionTimeout: 3000
      });

      logger.info('Call created to add participant', { 
        callSid: call.sid,
        conferenceId 
      });

      return call;

    } catch (error) {
      logger.error('Error adding participant to conference:', error);
      throw error;
    }
  }

  /**
   * Find active Twilio call by customer phone number
   * This is used to modify the customer's existing VAPI call to join a conference
   */
  async findActiveCallByPhone(customerPhone) {
    try {
      logger.info(`🔍 Searching for active Twilio call to ${customerPhone}`);
      
      // Search for calls made in the last 30 minutes to this number
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      
      const calls = await this.client.calls.list({
        to: customerPhone,
        from: this.phoneNumber, // +17254447698
        startTimeAfter: thirtyMinutesAgo,
        status: ['in-progress'], // Only active calls
        limit: 10
      });
      
      if (calls.length === 0) {
        logger.warn(`❌ No active calls found to ${customerPhone} from ${this.phoneNumber}`);
        return null;
      }
      
      // Get the most recent active call
      const activeCall = calls[0];
      
      logger.info(`✅ Found active call to ${customerPhone}`, {
        callSid: activeCall.sid,
        status: activeCall.status,
        startTime: activeCall.startTime,
        from: activeCall.from,
        to: activeCall.to
      });
      
      return activeCall;
      
    } catch (error) {
      logger.error(`Error finding active call for ${customerPhone}:`, error);
      return null;
    }
  }

  /**
   * Modify an existing Twilio call to join a conference
   * This provides seamless conference joining without SIP transfer
   */
  async modifyCallToJoinConference(callSid, conferenceId, welcomeMessage = null) {
    try {
      logger.info(`🔄 Modifying call ${callSid} to join conference ${conferenceId}`);
      
      // Create TwiML to join conference with optional welcome message
      let twiml = '<Response>';
      
      if (welcomeMessage) {
        twiml += `<Say voice="alice">${welcomeMessage}</Say>`;
      }
      
      twiml += `
        <Dial>
          <Conference 
            beep="false" 
            statusCallback="${this.baseUrl}/api/conference/webhook/twilio"
            statusCallbackEvent="join leave end"
            statusCallbackMethod="POST"
            endConferenceOnExit="false"
            startConferenceOnEnter="true">
            ${conferenceId}
          </Conference>
        </Dial>
      </Response>`;
      
      // Modify the existing call
      const updatedCall = await this.client.calls(callSid).update({
        twiml: twiml
      });
      
      logger.info(`✅ Successfully modified call ${callSid} to join conference`, {
        callSid: updatedCall.sid,
        conferenceId,
        status: updatedCall.status
      });
      
      return updatedCall;
      
    } catch (error) {
      logger.error(`❌ Error modifying call ${callSid} to join conference:`, error);
      throw error;
    }
  }

  /**
   * Validate Twilio configuration for seamless transfers
   * This helps troubleshoot any configuration issues
   */
  async validateConfiguration() {
    try {
      logger.info('🔍 Validating Twilio configuration for seamless transfers...');
      
      const validation = {
        accountSid: !!process.env.TWILIO_ACCOUNT_SID,
        authToken: !!process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: !!process.env.TWILIO_PHONE_NUMBER,
        serverBaseUrl: !!process.env.SERVER_BASE_URL,
        phoneNumberFormatted: this.phoneNumber
      };
      
      // Test API access
      try {
        await this.client.incomingPhoneNumbers.list({ limit: 1 });
        validation.apiAccess = true;
      } catch (error) {
        validation.apiAccess = false;
        validation.apiError = error.message;
      }
      
      logger.info('📋 Twilio Configuration Validation:', validation);
      
      if (!validation.accountSid || !validation.authToken || !validation.phoneNumber) {
        logger.error('❌ Missing required Twilio configuration!');
        return false;
      }
      
      if (!validation.apiAccess) {
        logger.error('❌ Twilio API access failed!');
        return false;
      }
      
      logger.info('✅ Twilio configuration is valid for seamless transfers');
      return true;
      
    } catch (error) {
      logger.error('❌ Error validating Twilio configuration:', error);
      return false;
    }
  }

  /**
   * Remove a participant from conference
   */
  async removeParticipant(conferenceId, participantCallSid) {
    try {
      logger.info('Removing participant from conference', { 
        conferenceId, 
        participantCallSid 
      });

      // Update the call to hangup
      await this.client.calls(participantCallSid).update({
        status: 'completed'
      });

      return { success: true };

    } catch (error) {
      logger.error('Error removing participant:', error);
      throw error;
    }
  }

  /**
   * Get conference status from Twilio
   */
  async getConferenceStatus(conferenceId) {
    try {
      // List conferences with the friendly name
      const conferences = await this.client.conferences.list({
        friendlyName: conferenceId,
        status: 'in-progress',
        limit: 1
      });

      if (conferences.length === 0) {
        return { status: 'not_found' };
      }

      const conference = conferences[0];
      
      // Get participants
      const participants = await this.client
        .conferences(conference.sid)
        .participants
        .list();

      return {
        sid: conference.sid,
        friendlyName: conference.friendlyName,
        status: conference.status,
        participantCount: participants.length,
        participants: participants.map(p => ({
          callSid: p.callSid,
          muted: p.muted,
          hold: p.hold,
          startTime: p.startTime
        })),
        dateCreated: conference.dateCreated,
        dateUpdated: conference.dateUpdated
      };

    } catch (error) {
      logger.error('Error getting conference status:', error);
      throw error;
    }
  }

  // handle a incoming call to the conference
  async handleIncomingCall(phoneNumber) {
    return `
      <Response>
        <Dial>
          <Conference
            statusCallback="${this.baseUrl}/api/conference/webhook/twilio"
            statusCallbackEvent="start end join leave">
            ${phoneNumber}
          </Conference>
        </Dial>
      </Response>
    `;
  }


  // get conference by id
  /**
   * End a conference
   */
  async endConference(conferenceId) {
    try {
      logger.info('Ending conference', { conferenceId });

      // Find the conference
      const conferences = await this.client.conferences.list({
        friendlyName: conferenceId,
        status: 'in-progress',
        limit: 1
      });

      if (conferences.length > 0) {
        // Update conference status to completed
        await this.client
          .conferences(conferences[0].sid)
          .update({ status: 'completed' });
      }

      return { success: true };

    } catch (error) {
      logger.error('Error ending conference:', error);
      throw error;
    }
  }

  /**
   * Update participant status (mute/unmute, hold/unhold)
   */
  async updateParticipant(conferenceId, participantCallSid, updates) {
    try {
      const conferences = await this.client.conferences.list({
        friendlyName: conferenceId,
        status: 'in-progress',
        limit: 1
      });

      if (conferences.length === 0) {
        throw new Error('Conference not found');
      }

      await this.client
        .conferences(conferences[0].sid)
        .participants(participantCallSid)
        .update(updates);

      return { success: true };

    } catch (error) {
      logger.error('Error updating participant:', error);
      throw error;
    }
  }

  /**
   * Play message to conference
   */
  async playMessageToConference(conferenceId, message) {
    try {
      const conferences = await this.client.conferences.list({
        friendlyName: conferenceId,
        status: 'in-progress',
        limit: 1
      });

      if (conferences.length === 0) {
        throw new Error('Conference not found');
      }

      // Use Twilio's announcement feature
      await this.client
        .conferences(conferences[0].sid)
        .update({
          announceUrl: `${this.baseUrl}/api/conference/announce?message=${encodeURIComponent(message)}`
        });

      return { success: true };

    } catch (error) {
      logger.error('Error playing message to conference:', error);
      throw error;
    }
  }

  /**
   * Transfer existing call to conference
   * This is used to move the initial customer call into the conference
   */
  async transferCallToConference(callSid, conferenceId) {
    try {
      logger.info('Transferring call to conference', { 
        callSid, 
        conferenceId 
      });

      const twiml = `
        <Response>
          <Say>Connecting you to a specialist. One moment please.</Say>
          <Dial>
            <Conference 
              endConferenceOnExit="false"
              startConferenceOnEnter="true"
              beep="false">
              ${conferenceId}
            </Conference>
          </Dial>
        </Response>
      `;

      await this.client.calls(callSid).update({
        twiml: twiml
      });

      return { success: true };

    } catch (error) {
      logger.error('Error transferring call to conference:', error);
      throw error;
    }
  }

  /**
   * Verify Twilio webhook signature for security
   */
  verifyWebhookSignature(req) {
    const signature = req.headers['x-twilio-signature'];
    const url = `${this.baseUrl}${req.originalUrl}`;
    
    return twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      req.body
    );
  }
}

// Export singleton instance
module.exports = new TwilioService();