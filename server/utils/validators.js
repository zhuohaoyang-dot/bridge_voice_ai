// server/utils/validators.js

// Validate phone number
exports.validatePhoneNumber = (phone) => {
    if (!phone) {
        return { valid: false, error: 'Phone number is required' };
    }

    const cleaned = String(phone).replace(/\D/g, '');

    if (cleaned.length < 10) {
        return { valid: false, error: 'Phone number is too short' };
    }

    if (cleaned.length > 15) {
        return { valid: false, error: 'Phone number is too long' };
    }

    return { valid: true, cleaned };
};

// Validate email
exports.validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Validate campaign data
exports.validateCampaignData = (data) => {
    const errors = [];

    if (!data.name || data.name.trim().length === 0) {
        errors.push('Campaign name is required');
    }

    if (!data.contacts || !Array.isArray(data.contacts) || data.contacts.length === 0) {
        errors.push('At least one contact is required');
    }

    if (data.callDelay && (data.callDelay < 1 || data.callDelay > 300)) {
        errors.push('Call delay must be between 1 and 300 seconds');
    }

    if (data.maxConcurrent && (data.maxConcurrent < 1 || data.maxConcurrent > 10)) {
        errors.push('Max concurrent calls must be between 1 and 10');
    }

    if (data.scheduleTime) {
        const scheduleDate = new Date(data.scheduleTime);
        if (isNaN(scheduleDate.getTime())) {
            errors.push('Invalid schedule time');
        } else if (scheduleDate <= new Date()) {
            errors.push('Schedule time must be in the future');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
};

// Validate webhook signature timestamp
exports.validateWebhookTimestamp = (timestamp) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const webhookTime = parseInt(timestamp);
    
    if (isNaN(webhookTime)) {
        return false;
    }
    
    // Allow 5 minute window
    return Math.abs(currentTime - webhookTime) <= 300;
};

// Sanitize input
exports.sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;
    
    // Remove any potential script tags or HTML
    return input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
};

// Validate CSV headers
exports.validateCSVHeaders = (headers, requiredHeaders) => {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const missing = requiredHeaders.filter(
        required => !normalizedHeaders.includes(required.toLowerCase())
    );
    
    return {
        valid: missing.length === 0,
        missing
    };
};

// Format phone number to E.164
exports.formatToE164 = (phone, defaultCountryCode = '1') => {
    const cleaned = String(phone).replace(/\D/g, '');
    
    if (cleaned.length === 10) {
        // Assume US/Canada number
        return `+${defaultCountryCode}${cleaned}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        // US/Canada with country code
        return `+${cleaned}`;
    } else if (cleaned.length > 10) {
        // International number
        return `+${cleaned}`;
    }
    
    return null;
};

// Validate conference creation request
exports.validateConferenceCreate = (req, res, next) => {
    const { callId, customerId, customerPhone } = req.body;
    
    if (!callId || !customerId || !customerPhone) {
      return res.status(400).json({
        error: 'Missing required fields: callId, customerId, customerPhone'
      });
    }
    
    // Validate phone number format
    const phoneValidation = exports.validatePhoneNumber(customerPhone);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        error: `Invalid phone number: ${phoneValidation.error}`
      });
    }
    
    next();
  };
  
  // Validate agent addition to conference
  exports.validateAgentAdd = (req, res, next) => {
    const { conferenceId, agentPhone, agentName, agentId } = req.body;
    
    if (!conferenceId || !agentPhone || !agentId) {
      return res.status(400).json({
        error: 'Missing required fields: conferenceId, agentPhone, agentId'
      });
    }
    
    // Validate agent phone number
    const phoneValidation = exports.validatePhoneNumber(agentPhone);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        error: `Invalid agent phone number: ${phoneValidation.error}`
      });
    }
    
    next();
  };