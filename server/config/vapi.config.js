module.exports = {
  apiKey: process.env.VAPI_API_KEY,
  frontendKey: process.env.VAPI_FRONTEND_KEY,
  assistantId: process.env.VAPI_ASSISTANT_PFAS, // Default to PFAS
  phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
  phoneNumber: process.env.VAPI_PHONE_NUMBER,
  baseUrl: 'https://api.vapi.ai',
  webhookSecret: process.env.WEBHOOK_SECRET,
  webhookUrl: process.env.WEBHOOK_URL,
  
  // Assistant mapping
  assistants: {
    PFAS: process.env.VAPI_ASSISTANT_PFAS,
    HAIR_STRAIGHTENER: process.env.VAPI_ASSISTANT_HAIR_STRAIGHTENER
  }
};