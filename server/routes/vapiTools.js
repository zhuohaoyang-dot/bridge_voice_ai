const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const twilioService = require('../services/twilioService');
const vapiService = require('../services/vapiService');
const redisService = require('../services/redisService');
const { broadcastToClients } = require('../websocket');

/**
 * Format phone number to E164 format (+1XXXXXXXXXX)
 */
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
    } else if (phone.startsWith('+') && cleaned.length >= 10) {
        // Already has country code and is valid length
        return phone;
    } else if (cleaned.length >= 10 && cleaned.length <= 15) {
        // International format - assume it needs +
        return '+' + cleaned;
    }
    
    // Invalid phone number - return original
    logger.warn(`Invalid phone number format: ${phone}`);
    return phone;
}

/**
 * VAPI Custom Tool: Transfer to Conference
 * This endpoint is called by VAPI when the Hair Straightener assistant
 * determines a lead is qualified and needs to be transferred
 */
router.post('/transfer-conference', async (req, res) => {
    try {
        const { message } = req.body;
        const toolCallId = message?.toolCallList?.[0]?.id || 'unknown';
        
        logger.info('📞 Conference trigger received for qualified lead', {
            toolCallId,
            callId: message.call?.id,
            timestamp: new Date().toISOString(),
            transferMethod: 'seamless_call_modification' // New method indicator
        });
        
        // Since this tool is only called when qualified, we know status is true
        // Get all data from the call context and tool arguments as fallback
        const call = message.call;
        const variableValues = call?.assistant?.variableValues || {};
        const toolArgs = message.toolCallList?.[0]?.arguments || {};
        
        logger.info('🎯 Starting seamless conference creation process', {
            vapiCallId: call?.id,
            customerNumber: call?.customer?.number,
            expectedOutcome: 'customer_stays_on_same_call'
        });
        
        // OPTION B: Extract data from tool arguments (manually passed from prompt)
        // The prompt should call: transfer_to_conference({leadId: qualified_lead_id, customerName: "...", ...})
        
        // First try tool arguments (Option B), then fallback to variable values
        const leadId = toolArgs.leadId || 
                      toolArgs.qualified_lead_id ||     // Handle both possible parameter names
                      variableValues.qualified_lead_id || // Fallback to variable values
                      variableValues.leadId ||
                      variableValues.bridgeLegalId ||
                      call?.customer?.id;
                      
        // Enhanced phone number extraction with multiple fallbacks
        const rawCustomerPhone = toolArgs.customerPhone || 
                                toolArgs.phone ||
                                variableValues.phoneNumber ||  // This is now sent from backend
                                call?.customer?.number ||
                                variableValues.customerPhone ||
                                variableValues.phone ||
                                variableValues.phoneNumber;
        
        // Format phone number to E164 (+1XXXXXXXXXX)
        const customerPhone = formatPhoneToE164(rawCustomerPhone);
                             
        const customerName = toolArgs.customerName || 
                            variableValues.fullName ||
                            `${variableValues.firstName || ''} ${variableValues.lastName || ''}`.trim() || 
                            call?.customer?.name ||
                            'Customer';
        
        // Extract qualification data from tool arguments - aligned with prompt structure
        // Prompt sends: { qualificationData: { organizationId, customInfo, qualificationResult, leadType, qualifyStatus } }
        const qualificationData = toolArgs.qualificationData || {};
        
        // Extract specific fields from the qualificationData structure
        const organizationId = qualificationData.organizationId || 
                              variableValues.organizationId || 
                              toolArgs.organizationId || 
                              '1';
                              
        const customInfo = qualificationData.customInfo || 
                          variableValues.customInfo || 
                          {};
                          
        const qualificationResult = qualificationData.qualificationResult || 
                                   qualificationData.qualification_result ||
                                   variableValues.qualification_result ||
                                   {};
        
        // Use call ID as fallback for leadId if nothing else is available (FIXED: moved before logger)
        const finalLeadId = leadId || call?.id || `unknown_${Date.now()}`;
        
        logger.info('🎯 Conference data extracted for qualified lead (prompt-aligned)', {
            leadId: leadId || 'using_call_id_fallback',
            finalLeadId,
            rawCustomerPhone,
            customerPhone,
            phoneFormatted: customerPhone ? 'YES' : 'NO',
            customerName,
            organizationId,
            customInfoPresent: customInfo && Object.keys(customInfo).length > 0 ? 'YES' : 'NO',
            qualificationResultPresent: qualificationResult && Object.keys(qualificationResult).length > 0 ? 'YES' : 'NO',
            source: 'prompt_aligned_structure'
        });
        
        if (!finalLeadId || !customerPhone) {
            const errorMsg = `Missing critical data - leadId: ${finalLeadId}, phone: ${customerPhone} (raw: ${rawCustomerPhone})`;
            logger.error('❌ Conference creation failed:', errorMsg);
            throw new Error(errorMsg);
        }
        
        // Build comprehensive qualification data aligned with prompt structure
        const finalQualificationData = {
            qualifyStatus: true, // Always true since this tool is only called when qualified
            leadType: qualificationData.leadType || 'hair straightener',
            organizationId: organizationId,
            customInfo: customInfo,
            qualificationResult: qualificationResult,
            // Add any additional fields from the original qualificationData
            ...qualificationData
        };
        
        // Extract the dynamic lead type for consistent usage
        const dynamicLeadType = finalQualificationData.leadType;
        
        logger.info('🎯 Using dynamic lead type for hold assistant', {
            dynamicLeadType,
            source: 'qualification_data'
        });
        
        // Generate unique conference ID
        const conferenceId = `conf_${Date.now()}_${finalLeadId}`;
        
        // Create Twilio conference room
        const conference = await twilioService.createConference({
            conferenceId,
            customerId: finalLeadId,
            customerPhone,
            initialCallId: message.call.id
        });

        // Store conference data in Redis
        const conferenceData = {
            conferenceId,
            leadId: finalLeadId,
            customerId: finalLeadId,
            customerPhone,
            customerName: customerName || 'Customer',
            qualificationData: finalQualificationData,
            originalCallId: message.call.id,
            assistantType: dynamicLeadType,
            createdAt: new Date().toISOString(),
            status: 'initializing',
            participants: [],
            convoso_lead_id: message.call.assistant?.variableValues?.convoso_lead_id || finalLeadId
        };

        await redisService.client.setEx(
            `conference:${conferenceId}`,
            1800, // 30 min TTL
            JSON.stringify(conferenceData)
        );

        // Create VAPI hold assistant call
        const holdAssistantCall = await vapiService.createConferenceCall({
            conferenceId,
            customerPhone,
            assistantId: process.env.VAPI_HOLD_ASSISTANT_ID,
            metadata: {
                conferenceId,
                role: 'hold_assistant',
                customerId: finalLeadId,
                customerName,
                customerPhone: customerPhone, // Ensure phone is in metadata
                leadType: dynamicLeadType,
                qualificationData: finalQualificationData,
                qualificationSummary: `Qualified lead from ${dynamicLeadType} case. Lead ID: ${finalLeadId}`,
                instruction: 'Keep the customer engaged while waiting for senior consultant',
                // Additional context for the hold assistant - aligned with prompt structure
                leadId: finalLeadId,
                organizationId: organizationId,
                caseType: dynamicLeadType,
                // Include structured data from prompt
                customInfo: customInfo,
                qualificationResult: qualificationResult,
                // Summary data for quick reference
                dataStructure: 'prompt_aligned',
                timestamp: new Date().toISOString()
            }
        });

        // Update conference data with hold assistant info
        conferenceData.holdAssistantCallId = holdAssistantCall.id;
        conferenceData.participants.push('hold_assistant');
        conferenceData.status = 'hold_assistant_joining';

        await redisService.client.setEx(
            `conference:${conferenceId}`,
            1800,
            JSON.stringify(conferenceData)
        );

        // Dial the senior consultant queue into conference
        const queueCall = await twilioService.client.calls.create({
            to: '+18336130051', // Tier 2 senior consultant queue
            from: process.env.TWILIO_PHONE_NUMBER,
            twiml: `
                <Response>
                    <Say>Connecting qualified ${dynamicLeadType} lead. Conference ID: ${conferenceId.slice(-6)}.</Say>
                    <Dial>
                        <Conference 
                            beep="false" 
                            statusCallback="${process.env.SERVER_BASE_URL}/api/conference/webhook/twilio"
                            statusCallbackEvent="join leave end">
                            ${conferenceId}
                        </Conference>
                    </Dial>
                </Response>
            `,
            statusCallback: `${process.env.SERVER_BASE_URL}/api/conference/webhook/twilio`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        });

        // Update conference data with queue call info
        conferenceData.queueCallSid = queueCall.sid;
        conferenceData.status = 'waiting_for_agent';
        
        await redisService.client.setEx(
            `conference:${conferenceId}`,
            1800,
            JSON.stringify(conferenceData)
        );

        // Broadcast to WebSocket clients - ENHANCED for seamless transfer tracking
        broadcastToClients({
            type: 'qualified_lead_conference',
            data: {
                conferenceId,
                leadId: finalLeadId,
                customerPhone,
                customerName,
                status: 'conference_created_seamless_pending',
                participants: ['hold_assistant', 'queue_dialing', 'customer_seamless_join_pending'],
                transferMethod: 'seamless_call_modification',
                message: 'Conference created - attempting seamless customer join'
            }
        });

        logger.info('✅ Three-way conference created successfully', {
            conferenceId,
            holdAssistantCallId: holdAssistantCall.id,
            queueCallSid: queueCall.sid,
            participants: ['customer_pending', 'hold_assistant', 'queue_dialing']
        });

        // OPTION A: Seamless call modification instead of SIP transfer
        // Find and modify the customer's existing Twilio call to join conference
        logger.info(`🔍 Attempting to find customer's active call for seamless conference join`);
        
        const activeCall = await twilioService.findActiveCallByPhone(customerPhone);
        
        if (activeCall) {
            // Found the customer's active call - modify it to join conference
            logger.info(`✅ Found customer's active call ${activeCall.sid}, modifying to join conference`);
            
            const welcomeMessage = "Perfect! I'm now connecting you with one of our senior consultants. Please hold on for just a moment.";
            
            await twilioService.modifyCallToJoinConference(
                activeCall.sid, 
                conferenceId, 
                welcomeMessage
            );
            
            // Update conference data to include customer call
            conferenceData.customerCallSid = activeCall.sid;
            conferenceData.participants.push('customer_joined');
            conferenceData.status = 'customer_joining';
            conferenceData.transferMethod = 'call_modification';
            
            await redisService.client.setEx(
                `conference:${conferenceId}`,
                1800,
                JSON.stringify(conferenceData)
            );
            
            // Broadcast updated status
            broadcastToClients({
                type: 'qualified_lead_conference',
                data: {
                    conferenceId,
                    leadId: finalLeadId,
                    customerPhone,
                    customerName,
                    status: 'customer_joining_seamlessly',
                    participants: ['customer_joining', 'hold_assistant', 'queue_dialing'],
                    transferMethod: 'call_modification'
                }
            });

            logger.info('🎉 Seamless conference join successful', {
                conferenceId,
                customerCallSid: activeCall.sid,
                method: 'call_modification'
            });

            // Return success response without SIP transfer
            res.json({
                results: [{
                    toolCallId: toolCallId,
                    result: {
                        success: true,
                        conferenceId: conferenceId,
                        message: "Conference created and customer joined seamlessly",
                        method: "call_modification",
                        details: {
                            holdAssistantConnected: true,
                            queueDialing: true,
                            customerJoined: true,
                            conferenceReady: true,
                            seamlessTransfer: true
                        }
                    }
                }]
            });
            
        } else {
            // Fallback: Customer's call not found, use SIP transfer as backup
            logger.warn(`⚠️  Could not find customer's active call, falling back to SIP transfer`);
            
            // Return SIP transfer as fallback
            res.json({
                results: [{
                    toolCallId: toolCallId,
                    result: {
                        success: true,
                        conferenceId: conferenceId,
                        message: "Conference created - using SIP transfer fallback",
                        transferDestination: {
                            type: "sip",
                            sipUri: `sip:${conferenceId}@conference.twilio.com`,
                            headers: {
                                "X-Conference-Id": conferenceId,
                                "X-Customer-Id": finalLeadId
                            }
                        },
                        details: {
                            holdAssistantConnected: true,
                            queueDialing: true,
                            conferenceReady: true,
                            conferenceMethod: "sip_transfer_fallback"
                        }
                    }
                }]
            });
        }

    } catch (error) {
        logger.error('❌ Conference creation error:', error);
        
        // Enhanced error handling for different failure scenarios
        let errorMessage = 'Conference creation failed';
        let shouldTransferToQueue = false;
        
        if (error.message && error.message.includes('findActiveCallByPhone')) {
            errorMessage = 'Could not locate customer call for seamless transfer';
            shouldTransferToQueue = true;
        } else if (error.message && error.message.includes('modifyCallToJoinConference')) {
            errorMessage = 'Failed to modify customer call - using direct queue transfer';
            shouldTransferToQueue = true;
        } else if (error.code === 20003) { // Twilio authentication error
            errorMessage = 'Twilio authentication failed';
        } else if (error.code === 21205) { // Invalid phone number
            errorMessage = 'Invalid phone number format';
        }
        
        logger.error(`Conference creation failed: ${errorMessage}`, {
            error: error.message,
            stack: error.stack,
            customerPhone: req.body.message?.call?.customer?.number
        });
        
        // Return error response to VAPI with fallback options
        res.json({
            results: [{
                toolCallId: req.body.message?.toolCallList?.[0]?.id || 'unknown',
                result: {
                    success: false,
                    error: errorMessage,
                    message: shouldTransferToQueue ? 
                        "Conference creation failed - transferring directly to queue" :
                        "Conference creation failed - please try again",
                    // Provide fallback transfer if appropriate
                    ...(shouldTransferToQueue && {
                        fallbackTransfer: {
                            destination: "+18336130051",
                            message: "Let me transfer you directly to our senior consultant queue"
                        }
                    })
                }
            }]
        });
    }
});

// TwiML endpoint for handling conference joins when VAPI transfers calls
router.post('/join-conference/:conferenceId', async (req, res) => {
    try {
        const { conferenceId } = req.params;
        
        // Log the incoming conference join request
        logger.info(`📞 TwiML Conference Join Request: ${conferenceId}`, {
            callSid: req.body.CallSid,
            from: req.body.From,
            to: req.body.To
        });

        // Verify conference exists in Redis
        const conferenceData = await redisService.client.get(`conference:${conferenceId}`);
        if (!conferenceData) {
            logger.warn(`Conference ${conferenceId} not found in Redis`);
            
            // Fallback TwiML - transfer to queue directly
            const fallbackTwiML = `
            <Response>
                <Say>I apologize, but I'm having trouble connecting you to the conference. Let me transfer you directly to our senior consultant.</Say>
                <Dial>
                    <Number>+18336130051</Number>
                </Dial>
            </Response>
            `;
            
            res.type('text/xml');
            res.send(fallbackTwiML);
            return;
        }

        // Generate TwiML to join the conference
        const twiml = `
        <Response>
            <Say>Connecting you with a specialist now. Please hold while I connect you.</Say>
            <Dial>
                <Conference 
                    statusCallback="${process.env.SERVER_BASE_URL}/api/conference/webhook/twilio"
                    statusCallbackEvent="start end join leave"
                    statusCallbackMethod="POST"
                    endConferenceOnExit="false" 
                    startConferenceOnEnter="true"
                    beep="false"
                    waitUrl="">
                    ${conferenceId}
                </Conference>
            </Dial>
        </Response>
        `;
        
        // Update conference data to track customer joining
        const parsedConferenceData = JSON.parse(conferenceData);
        parsedConferenceData.customerJoinedAt = new Date().toISOString();
        parsedConferenceData.customerCallSid = req.body.CallSid;
        parsedConferenceData.status = 'customer_joining';
        
        if (!parsedConferenceData.participants.includes('customer')) {
            parsedConferenceData.participants.push('customer');
        }
        
        await redisService.client.setEx(
            `conference:${conferenceId}`,
            1800,
            JSON.stringify(parsedConferenceData)
        );

        // Broadcast update
        broadcastToClients({
            type: 'customer_joining_conference',
            data: {
                conferenceId,
                callSid: req.body.CallSid,
                participants: parsedConferenceData.participants
            }
        });

        logger.info(`✅ Customer joining conference ${conferenceId}`, {
            callSid: req.body.CallSid,
            participants: parsedConferenceData.participants.length
        });
        
        res.type('text/xml');
        res.send(twiml);
        
    } catch (error) {
        logger.error('❌ Conference join TwiML error:', error);
        
        // Error fallback TwiML
        const errorTwiML = `
        <Response>
            <Say>I apologize, but I'm experiencing technical difficulties. Let me transfer you to our support team.</Say>
            <Dial>
                <Number>+18336130051</Number>
            </Dial>
        </Response>
        `;
        
        res.type('text/xml');
        res.send(errorTwiML);
    }
});



// Health check for VAPI tools
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'VAPI Tools',
        timestamp: new Date().toISOString(),
        endpoints: [
            'POST /transfer-conference',
            'GET /health'
        ]
    });
});

module.exports = router;