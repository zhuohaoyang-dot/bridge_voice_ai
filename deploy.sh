#!/bin/bash

# Bridge Legal PFAS Call System - Deployment Script
# This script helps prepare and deploy the system to Vercel via GitHub

set -e  # Exit on any error

echo "🚀 Bridge Legal PFAS Call System - Deployment Setup"
echo "=================================================="

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing Git repository..."
    git init
    echo "✅ Git repository initialized"
else
    echo "✅ Git repository already exists"
fi

# Check if we have a remote origin
if ! git remote get-url origin > /dev/null 2>&1; then
    echo ""
    echo "❗ No git remote origin found."
    echo "   Please create a GitHub repository and add it as origin:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git"
    echo ""
    read -p "Press Enter when you've added the remote origin..."
fi

# Add all files to git
echo "📝 Adding files to git..."
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo "✅ No changes to commit"
else
    echo "💾 Committing changes..."
    git commit -m "Deploy: Bridge Legal PFAS Call System ready for Vercel deployment

- Added Vercel configuration (vercel.json)
- Created SSE-based real-time updates (Vercel-compatible)
- Added deployment documentation
- Environment variables template included
- WebSocket conditionally disabled in production"
fi

# Push to GitHub
echo "⬆️  Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Code pushed to GitHub successfully!"
echo ""
echo "🔧 Next Steps:"
echo "=============="
echo "1. Go to https://vercel.com and sign in"
echo "2. Click 'Import Project' and connect your GitHub account"
echo "3. Select your repository"
echo "4. Configure these settings:"
echo "   - Framework Preset: Other"
echo "   - Build Command: npm install"
echo "   - Output Directory: ./"
echo ""
echo "5. Add Environment Variables (see env.example for full list):"
echo "   Required variables:"
echo "   - NODE_ENV=production"
echo "   - REDIS_URL=your-redis-url"
echo "   - VAPI_API_KEY=your-vapi-key"
echo "   - TWILIO_ACCOUNT_SID=your-twilio-sid"
echo "   - TWILIO_AUTH_TOKEN=your-twilio-token"
echo "   - And others from env.example"
echo ""
echo "6. After deployment, update these variables with your Vercel URL:"
echo "   - SERVER_BASE_URL=https://your-app.vercel.app"
echo "   - WEBHOOK_URL=https://your-app.vercel.app/webhook"
echo ""
echo "7. Set up Redis database:"
echo "   - Option A: Vercel KV (recommended)"
echo "   - Option B: Upstash Redis (free tier)"
echo "   - Option C: Redis Cloud"
echo ""
echo "📚 For detailed instructions, see DEPLOYMENT.md"
echo ""
echo "🎯 Your app will be available at: https://your-app-name.vercel.app" 