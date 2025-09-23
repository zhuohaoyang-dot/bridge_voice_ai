# Bridge Legal PFAS Call System

A comprehensive outbound call campaign management system for Bridge Legal's PFAS and mass tort lead qualification. Built with Node.js/Express backend, integrates with VAPI AI for automated voice calls, includes real-time monitoring, Redis-based campaign management, CRM integration, and a modern dashboard.

## 🚀 Quick Deploy to Vercel

**Ready for immediate deployment!** This system is fully configured for Vercel deployment.

### Option 1: One-Command Deploy
```bash
./deploy.sh
```

### Option 2: Manual Steps
1. Push to GitHub
2. Connect to Vercel
3. Configure environment variables
4. Deploy!

📚 **See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions**

## ✨ Features

- **Campaign Management**: Upload CSV files and create automated outbound call campaigns
- **Real-Time Monitoring**: Live call monitoring with transcripts and call controls
- **AI Integration**: VAPI AI-powered voice assistants for PFAS and hair straightener campaigns
- **CRM Integration**: Seamless lead processing and qualification
- **Call Controls**: Mute, transfer, and end calls in real-time
- **WebSocket/SSE**: Real-time updates (WebSocket for dev, SSE for production)
- **Conference Calls**: Seamless agent transfers via Twilio
- **Dashboard**: Modern web interface for monitoring and management

## 🏗️ Architecture

### Backend (Node.js/Express)
- **API Server**: RESTful API with comprehensive endpoints
- **WebSocket Server**: Real-time communication (development)
- **SSE Support**: Server-Sent Events for production (Vercel-compatible)
- **Redis Integration**: Campaign state management and caching
- **Webhook Processing**: VAPI AI event handling

### Frontend (Vanilla JS)
- **Campaign Panel**: CSV upload and campaign management
- **Monitor Panel**: Live call monitoring with controls
- **Leads Panel**: CRM integration and lead processing
- **Real-time Updates**: WebSocket/SSE based live updates

### Integrations
- **VAPI AI**: Voice AI for automated calling
- **Twilio**: Conference calling and telephony
- **Redis**: State management and caching
- **CRM API**: Lead processing and qualification

## 🛠️ Development Setup

### Prerequisites
- Node.js 16+
- Redis server
- VAPI AI account
- Twilio account

### Local Installation
```bash
# Clone and install
npm install

# Start Redis
redis-server

# Set up environment variables
cp env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

### Environment Variables
See `env.example` for all required variables:
- VAPI AI credentials
- Twilio credentials  
- Redis connection
- CRM API tokens
- Webhook configuration

## 📦 Production Deployment

### Vercel (Recommended)
- ✅ Serverless functions
- ✅ Auto-scaling
- ✅ SSL certificates
- ✅ CDN integration
- ✅ Environment variables
- ✅ GitHub integration

### What's Included for Vercel:
- `vercel.json` - Deployment configuration
- `server/routes/sse.js` - Real-time updates (WebSocket alternative)
- `client/js/sse.js` - Client-side SSE implementation
- Conditional WebSocket disabling in production
- Universal broadcast system (WebSocket + SSE)

### External Services Needed:
1. **Redis Database**: Vercel KV, Upstash, or Redis Cloud
2. **VAPI AI Account**: Voice AI service
3. **Twilio Account**: Conference calling
4. **CRM Integration**: Lead processing

## 🔧 Configuration

### Campaign Types
- **PFAS**: Per- and polyfluoroalkyl substances campaigns
- **Hair Straightener**: Hair straightener litigation campaigns

### Call Flow
1. Campaign upload (CSV)
2. VAPI AI initiates calls
3. Real-time monitoring
4. Lead qualification
5. Agent transfer (if needed)
6. CRM integration

### Monitoring Features
- Live call status
- Real-time transcripts
- Call controls (mute/transfer/end)
- Campaign statistics
- Lead qualification tracking

## 📊 API Endpoints

### Core APIs
- `GET /api/health` - System health check
- `POST /api/campaigns` - Create campaign
- `GET /api/calls/live` - Live calls
- `POST /webhook` - VAPI webhooks

### Real-time APIs
- `GET /api/sse/events` - Server-Sent Events stream
- `GET /api/sse/campaigns/active` - Active campaigns
- `GET /api/sse/calls/live` - Live calls polling

### Integration APIs
- `POST /api/crm/leads` - CRM lead processing
- `POST /api/vapi/transfer` - Conference transfers
- `GET /api/conference/status` - Transfer status

## 🔒 Security

- Helmet.js security headers
- CORS configuration
- Rate limiting
- Webhook signature validation
- Environment variable protection

## 📈 Monitoring

### Health Checks
- Redis connectivity
- VAPI AI status
- Twilio configuration
- CRM integration

### Logging
- Winston-based logging
- Request/response tracking
- Error monitoring
- Performance metrics

## 🤝 Support

### Common Issues
- **Redis Connection**: Check REDIS_URL in environment
- **WebSocket Errors**: Normal in production (uses SSE instead)
- **VAPI Webhooks**: Ensure WEBHOOK_URL is accessible
- **Twilio Transfers**: Verify account SID and auth token

### Troubleshooting
1. Check Vercel function logs
2. Verify environment variables
3. Test webhook endpoints
4. Monitor Redis connectivity

## 📄 License

Bridge Legal Internal Use

---

**Ready to deploy?** Run `./deploy.sh` or follow the [detailed deployment guide](./DEPLOYMENT.md)! 