# Bridge Legal PFAS Call System - Vercel Deployment Guide

## Prerequisites

1. **GitHub Account**: Make sure you have a GitHub account
2. **Vercel Account**: Sign up at [vercel.com](https://vercel.com) (free tier available)
3. **External Redis**: Since Vercel doesn't provide persistent Redis, you'll need either:
   - **Vercel KV** (Redis-compatible, recommended)
   - **Upstash Redis** (free tier available)
   - **Redis Cloud** (free tier available)

## Step 1: Push to GitHub

1. Initialize git repository (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Bridge Legal PFAS Call System"
   ```

2. Create a new repository on GitHub

3. Add the remote and push:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

## Step 2: Set Up Redis Database

### Option A: Vercel KV (Recommended)
1. Go to your Vercel dashboard
2. Navigate to Storage → Create Database → KV
3. Name it `pfas-call-system-redis`
4. Note the connection details

### Option B: Upstash Redis (Alternative)
1. Sign up at [upstash.com](https://upstash.com)
2. Create a new Redis database
3. Copy the Redis URL

## Step 3: Deploy to Vercel

1. **Connect GitHub to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click "Import Project"
   - Connect your GitHub account
   - Select your repository

2. **Configure Build Settings:**
   - Framework Preset: Other
   - Root Directory: `./` (leave default)
   - Build Command: `npm install` (leave default)
   - Output Directory: `./` (leave default)

3. **Add Environment Variables:**
   In Vercel dashboard, add these environment variables (use the `env.example` file as reference):

   ```
   NODE_ENV=production
   PORT=3010
   LOG_LEVEL=info
   
   # Update these with your actual domain after deployment
   SERVER_BASE_URL=https://your-app-name.vercel.app
   WEBHOOK_URL=https://your-app-name.vercel.app/webhook
   WEBHOOK_SECRET=your-webhook-secret-key
   
   # Redis (from Step 2)
   REDIS_URL=your-redis-connection-string
   REDIS_REQUIRED=true
   
   # VAPI Configuration (your existing values)
   VAPI_API_KEY=your-vapi-api-key
   VAPI_FRONTEND_KEY=your-vapi-frontend-key
   VAPI_ASSISTANT_PFAS=your-pfas-assistant-id
   VAPI_ASSISTANT_HAIR_STRAIGHTENER=your-hair-straightener-assistant-id
   VAPI_PHONE_NUMBER_ID=your-vapi-phone-number-id
   VAPI_PHONE_NUMBER=your-vapi-phone-number
   VAPI_HOLD_ASSISTANT_ID=your-hold-assistant-id
   VAPI_HOLD_ASSISTANT_PHONE_NUMBER_ID=your-hold-assistant-phone-number-id
   
   # Twilio Configuration (your existing values)
   TWILIO_ACCOUNT_SID=your-twilio-account-sid
   TWILIO_AUTH_TOKEN=your-twilio-auth-token
   TWILIO_PHONE_NUMBER=your-twilio-phone-number
   
   # CRM Configuration (your existing values)
   CRM_API_TOKEN=your-crm-api-token
   
   # Convoso Configuration (your existing values)
   CONVOSO_API_TOKEN=your-convoso-api-token
   CONVOSO_API_URL=https://api.convoso.com/v1
   ```

4. **Deploy:**
   - Click "Deploy"
   - Wait for deployment to complete
   - Note your deployment URL (e.g., `https://your-app-name.vercel.app`)

## Step 4: Update Webhook URLs

After deployment, update these environment variables with your actual Vercel URL:

1. **SERVER_BASE_URL**: `https://your-app-name.vercel.app`
2. **WEBHOOK_URL**: `https://your-app-name.vercel.app/webhook`

Redeploy after updating these variables.

## Step 5: Configure External Services

### VAPI Configuration
1. Update your VAPI assistant webhook URLs to point to your Vercel deployment
2. Test webhook endpoints: `https://your-app-name.vercel.app/webhook`

### Twilio Configuration
1. Update Twilio webhook URLs if needed
2. Ensure conference endpoints are accessible

## Important Notes

### WebSocket Limitations
- **Vercel doesn't support persistent WebSocket connections**
- The live monitoring features that rely on WebSockets will need modification
- Consider using:
  - **Server-Sent Events (SSE)** for real-time updates
  - **Polling** for status updates
  - **Vercel's Edge Functions** for real-time features

### File Storage
- Vercel has ephemeral file storage
- Move CSV uploads and logs to external storage (AWS S3, Vercel Blob, etc.)

### Function Timeout
- Vercel functions have a 60-second timeout (configured in `vercel.json`)
- Long-running operations may need optimization

## Monitoring and Logs

1. **Vercel Dashboard**: Monitor deployments and function logs
2. **Health Check**: `https://your-app-name.vercel.app/api/health`
3. **Function Logs**: Available in Vercel dashboard under Functions tab

## Troubleshooting

### Common Issues:
1. **Redis Connection**: Ensure REDIS_URL is correctly set
2. **Environment Variables**: Check all required variables are set
3. **CORS Issues**: Update CORS configuration for production domain
4. **Webhook Timeouts**: Optimize webhook processing for Vercel's 60s limit

### Testing Deployment:
1. Visit: `https://your-app-name.vercel.app`
2. Check health endpoint: `https://your-app-name.vercel.app/api/health`
3. Test campaign upload functionality
4. Verify webhook endpoints respond correctly

## Next Steps

1. **Custom Domain**: Add your custom domain in Vercel settings
2. **SSL Certificate**: Automatically provided by Vercel
3. **Analytics**: Enable Vercel Analytics for monitoring
4. **Backup Strategy**: Set up regular Redis backups

## Support

For deployment issues:
- Check Vercel function logs
- Monitor Redis connection status
- Verify all external API configurations
- Test webhook endpoints manually 