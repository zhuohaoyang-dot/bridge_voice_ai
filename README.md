# PFAS Call System - Bridge Legal

A comprehensive outbound call system with campaign management, live monitoring, and seamless call transfers.

## Features

- 🎯 **Campaign Management**: Create and manage call campaigns with CSV imports
- 📞 **Live Call Monitoring**: Real-time call status and transcript monitoring
- 🔄 **Seamless Transfers**: Automatic transfers between VAPI AI and human agents
- 📊 **Analytics Dashboard**: Track call performance and campaign metrics
- 🔗 **WebSocket Integration**: Real-time updates and live monitoring
- 🗄️ **Redis Caching**: Fast data access and campaign queue management

## Architecture

### Backend Services
- **Express.js API**: RESTful API endpoints
- **WebSocket Server**: Real-time communication
- **Redis**: Data caching and campaign queues
- **VAPI Integration**: AI voice assistant
- **Twilio Integration**: Call handling and transfers

### Frontend
- **Vanilla JavaScript**: Lightweight frontend
- **WebSocket Client**: Real-time updates
- **Campaign Management UI**: User-friendly interface

## Local Development

### Prerequisites
- Node.js 16+
- Redis server
- VAPI API account
- Twilio account (for transfers)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd pfas_call_system
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env
# Edit .env with your actual values
```

4. Start Redis server:
```bash
npm run redis:start
```

5. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3010`

## Deployment to Railway

### Step 1: Prepare Your Repository

1. **Push to GitHub**:
```bash
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### Step 2: Deploy on Railway

1. **Go to [Railway.app](https://railway.app)** and sign up/login
2. **Click "New Project"** → **"Deploy from GitHub repo"**
3. **Select your repository**
4. **Add Redis service**:
   - Click "Add Service" → "Database" → "Redis"
   - This will automatically set the `REDIS_URL` environment variable

### Step 3: Configure Environment Variables

In your Railway project dashboard, go to **Variables** and add:

```env
NODE_ENV=production
WEBHOOK_URL=https://your-app-name.railway.app/webhook
VAPI_API_KEY=your_vapi_api_key_here
VAPI_ASSISTANT_ID=your_vapi_assistant_id_here
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
```

### Step 4: Configure Domain (Optional)

1. In Railway dashboard, go to **Settings** → **Domains**
2. **Generate domain** or **add custom domain**
3. **Update WEBHOOK_URL** environment variable with your new domain

### Step 5: Verify Deployment

1. Visit your Railway app URL
2. Check `/api/health` endpoint for system status
3. Verify Redis connection in logs
4. Test campaign creation and call functionality

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (Railway sets this automatically) | No |
| `NODE_ENV` | Environment (production/development) | Yes |
| `REDIS_URL` | Redis connection URL (Railway sets this automatically) | Yes |
| `WEBHOOK_URL` | Your app's webhook URL for VAPI | Yes |
| `VAPI_API_KEY` | VAPI API key | Yes |
| `VAPI_ASSISTANT_ID` | VAPI assistant ID | Yes |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | Yes |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Yes |
| `TWILIO_PHONE_NUMBER` | Twilio phone number for transfers | Yes |
| `CONVOSO_API_KEY` | Convoso API key (if using) | No |
| `CONVOSO_BASE_URL` | Convoso API base URL | No |

## API Endpoints

### Health Check
- `GET /api/health` - System health status

### Campaigns
- `POST /api/campaigns` - Create new campaign
- `GET /api/campaigns` - List all campaigns
- `GET /api/campaigns/:id` - Get campaign details
- `POST /api/campaigns/:id/start` - Start campaign
- `POST /api/campaigns/:id/stop` - Stop campaign
- `DELETE /api/campaigns/:id` - Delete campaign

### Calls
- `GET /api/calls` - List all calls
- `GET /api/calls/:id` - Get call details
- `POST /api/calls/:id/transfer` - Transfer call to human

### Webhooks
- `POST /webhook/vapi` - VAPI webhook endpoint
- `POST /webhook/twilio` - Twilio webhook endpoint

## WebSocket Events

### Client to Server
- `subscribe_to_campaign` - Subscribe to campaign updates
- `get_campaign_status` - Request campaign status

### Server to Client
- `campaign_status` - Campaign status updates
- `call_started` - New call initiated
- `call_updated` - Call status changed
- `call_ended` - Call completed
- `transcript_update` - Live transcript updates

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis service is running on Railway
   - Check REDIS_URL environment variable

2. **VAPI Webhook Not Working**
   - Verify WEBHOOK_URL is correct
   - Check VAPI assistant configuration
   - Ensure webhook endpoint is accessible

3. **Call Transfers Failing**
   - Verify Twilio credentials
   - Check phone number format
   - Ensure Twilio webhook URLs are configured

### Logs

Check Railway logs in the dashboard for detailed error information.

## Support

For issues and questions:
1. Check the logs in Railway dashboard
2. Verify all environment variables are set correctly
3. Ensure external services (VAPI, Twilio) are properly configured

## License

Private - Bridge Legal 