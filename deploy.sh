#!/bin/bash

# PFAS Call System - Railway Deployment Script

echo "🚀 PFAS Call System - Railway Deployment"
echo "========================================"

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git repository not found. Initializing..."
    git init
    git branch -M main
fi

# Check for uncommitted changes
if [[ `git status --porcelain` ]]; then
    echo "📝 Found uncommitted changes. Adding all files..."
    git add .
    
    # Prompt for commit message
    read -p "Enter commit message (or press Enter for default): " commit_message
    if [ -z "$commit_message" ]; then
        commit_message="Prepare for Railway deployment"
    fi
    
    git commit -m "$commit_message"
else
    echo "✅ No uncommitted changes found"
fi

# Check if remote origin exists
if ! git remote get-url origin > /dev/null 2>&1; then
    echo ""
    echo "⚠️  No git remote found!"
    echo "Please add your GitHub repository as origin:"
    echo "git remote add origin https://github.com/yourusername/your-repo-name.git"
    echo ""
    echo "Then run this script again or push manually:"
    echo "git push -u origin main"
    exit 1
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Repository pushed to GitHub successfully!"
echo ""
echo "🌐 Next Steps for Railway Deployment:"
echo "===================================="
echo ""
echo "1. Go to https://railway.app and sign in"
echo "2. Click 'New Project' → 'Deploy from GitHub repo'"
echo "3. Select your repository: $(git remote get-url origin)"
echo "4. Add Redis database:"
echo "   - Click 'Add Service' → 'Database' → 'Redis'"
echo ""
echo "5. Configure Environment Variables in Railway dashboard:"
echo "   NODE_ENV=production"
echo "   WEBHOOK_URL=https://your-app-name.railway.app/webhook"
echo "   VAPI_API_KEY=your_vapi_api_key_here"
echo "   VAPI_ASSISTANT_ID=your_vapi_assistant_id_here"
echo "   TWILIO_ACCOUNT_SID=your_twilio_account_sid_here"
echo "   TWILIO_AUTH_TOKEN=your_twilio_auth_token_here"
echo "   TWILIO_PHONE_NUMBER=your_twilio_phone_number_here"
echo ""
echo "6. Once deployed, update WEBHOOK_URL with your actual Railway domain"
echo ""
echo "📖 For detailed instructions, see README.md" 