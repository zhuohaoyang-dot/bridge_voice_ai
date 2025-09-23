// Load environment variables first
require('dotenv').config();

// Import required modules
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');

const logger = require('./utils/logger');

// Import services
const vapiService = require('./services/vapiService');
const twilioService = require('./services/twilioService');
const { initializeRedis, shutdownRedis } = require('./init/redis');

// Import route modules
const healthRoutes = require('./routes/health');
const callRoutes = require('./routes/calls');
const campaignRoutes = require('./routes/campaigns');
const webhookRoutes = require('./routes/webhooks');
const crmRoutes = require('./routes/crm');
const conferenceRoutes = require('./routes/conference');
const vapiToolsRoutes = require('./routes/vapiTools');
const { router: sseRoutes } = require('./routes/sse');

// WebSocket server (disabled in production/Vercel)
const { initializeWebSocketServer } = require('./websocket');

// Validate critical services on startup
async function validateServices() {
    logger.info('🔍 Validating critical services...');
    
    // Validate Twilio configuration for seamless transfers
    const twilioValid = await twilioService.validateConfiguration();
    if (!twilioValid) {
        logger.error('❌ Twilio validation failed - seamless transfers may not work');
    }
    
    logger.info('✅ Service validation complete');
}

const app = express();
const PORT = process.env.PORT || 3010;

// Security middleware with updated CSP for WebSocket support
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'", 
        "ws://localhost:8010", 
        "wss://localhost:8010",
        "ws://127.0.0.1:8010", 
        "wss://127.0.0.1:8010",
        "wss://*.vapi.ai", 
        "ws://*.vapi.ai", 
        "https://api.vapi.ai",
        "https://*.ngrok-free.app",
        "wss://*.ngrok-free.app"
      ],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      mediaSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"]
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    // Allow same-origin requests or requests from the same host
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Special handling for webhook routes to capture raw body
app.use('/webhook', express.raw({ 
    type: 'application/json',
    limit: '50mb'
}));

// Parse raw body for webhook signature validation
app.use('/webhook', (req, res, next) => {
  if (req.body) {
      // If body is a Buffer, convert to string
      if (Buffer.isBuffer(req.body)) {
          req.rawBody = req.body.toString('utf-8');
          try {
              req.body = JSON.parse(req.rawBody);
          } catch (error) {
              logger.error('Failed to parse webhook body:', error);
              return res.status(400).json({ error: 'Invalid JSON' });
          }
      } else {
          // Body is already parsed (shouldn't happen with express.raw)
          req.rawBody = JSON.stringify(req.body);
      }
  }
  next();
});

// Body parsing middleware for other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// conference routes
app.use('/api/conference', conferenceRoutes);

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Static file serving
app.use(express.static(path.join(__dirname, '../client')));

// API routes
app.use('/api/health', healthRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/vapi-tools', vapiToolsRoutes);
// Add alias for more intuitive VAPI URLs
app.use('/api/vapi', vapiToolsRoutes);
// Server-Sent Events for real-time updates (Vercel-compatible)
app.use('/api/sse', sseRoutes);

// Default route - serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: 'Route not found',
    message: `${req.method} ${req.url} is not a valid endpoint`
  });
});

// Startup function to configure Vapi webhook
async function configureVapiWebhook() {
  try {
    logger.info('Configuring Vapi assistant webhook URL...');
    
    if (!process.env.WEBHOOK_URL) {
      logger.warn('WEBHOOK_URL not configured. Skipping webhook configuration.');
      logger.warn('Please set WEBHOOK_URL environment variable to enable live transcripts.');
      return;
    }

    // First, check current assistant configuration
    try {
      const currentAssistant = await vapiService.getAssistant();
      logger.info('Current assistant configuration:', {
        name: currentAssistant.name,
        serverUrl: currentAssistant.serverUrl || 'Not configured',
        transcriber: currentAssistant.transcriber?.provider
      });
    } catch (error) {
      logger.warn('Could not retrieve current assistant configuration:', error.message);
    }

    // Update the webhook URL
    await vapiService.updateAssistantWebhook();
    
    // Verify the update
    try {
      const updatedAssistant = await vapiService.getAssistant();
      logger.info('✅ Vapi webhook configuration completed successfully');
      logger.info('Updated assistant webhook URL:', updatedAssistant.serverUrl);
    } catch (error) {
      logger.warn('Could not verify webhook update:', error.message);
    }
    
  } catch (error) {
    logger.error('❌ Failed to configure Vapi webhook:', error.message);
    logger.warn('Live transcripts may not work properly without webhook configuration');
  }
}

// Create HTTP server
const server = createServer(app);

// Start server with webhook configuration
server.listen(PORT, async () => {
  logger.info(`🚀 Server started on port ${PORT}`);
  logger.info(`📱 Frontend available at: http://localhost:${PORT}`);
  logger.info(`🔗 API base URL: http://localhost:${PORT}/api`);
  
  // Initialize Redis FIRST before anything else that might use it
  await initializeRedis();
  
  // Initialize WebSocket only in development (not supported on Vercel)
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(() => {
      initializeWebSocketServer();
      logger.info(`📡 WebSocket server running on port 8010`);
    }, 1000);
  } else {
    logger.info(`📡 Using Server-Sent Events for real-time updates (Vercel-compatible)`);
  }
  
  // Configure Vapi webhook after server starts
  await configureVapiWebhook();
  
  // Validate critical services for seamless transfers
  await validateServices();
  
  logger.info('🎯 Bridge Legal PFAS Call System is ready!');
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await shutdownRedis();
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await shutdownRedis();
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;