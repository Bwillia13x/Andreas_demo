#!/bin/bash

# Generate Secure Session Secret Script
# Creates a cryptographically secure session secret for production use

set -e

echo "🔐 Generating Secure Session Secret for Production"
echo "================================================="
echo ""

# Generate a secure 64-character random string
SESSION_SECRET=$(openssl rand -hex 32)

if [ -z "$SESSION_SECRET" ]; then
    echo "❌ Failed to generate session secret using openssl"
    echo "Trying alternative method..."
    
    # Fallback method using /dev/urandom
    SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d "=+/" | cut -c1-64)
fi

if [ -z "$SESSION_SECRET" ]; then
    echo "❌ Failed to generate session secret"
    echo "Please install openssl or ensure /dev/urandom is available"
    exit 1
fi

echo "✅ Generated secure session secret: ${SESSION_SECRET:0:8}...${SESSION_SECRET: -8}"
echo ""

# Update .env file
if [ -f ".env" ]; then
    echo "📝 Updating .env file..."
    
    # Create backup
    cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Created backup: .env.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Update SESSION_SECRET in .env file
    if grep -q "SESSION_SECRET=" .env; then
        # Replace existing SESSION_SECRET
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" .env
        else
            # Linux
            sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" .env
        fi
        echo "✅ Updated existing SESSION_SECRET in .env"
    else
        # Add SESSION_SECRET to .env
        echo "SESSION_SECRET=${SESSION_SECRET}" >> .env
        echo "✅ Added SESSION_SECRET to .env"
    fi
else
    echo "📝 Creating new .env file..."
    cat > .env << EOF
# Production Environment Configuration
# Generated on $(date)

# Server Configuration
NODE_ENV=production
PORT=5000

# Session Security (REQUIRED for production)
SESSION_SECRET=${SESSION_SECRET}

# OpenAI Integration (Optional - enables live AI responses)
# OPENAI_API_KEY=your-openai-api-key-here

# Database Configuration (Optional - uses in-memory storage if not set)
# DATABASE_URL=postgresql://username:password@localhost:5432/mgmt_vibe

# Security Configuration
SECURITY_HEADERS_CONFIG={"hsts":{"enabled":true,"maxAge":31536000}}

# Performance Configuration
PERFORMANCE_MONITORING=true
MEMORY_OPTIMIZATION=true

# Demo Mode (Set to false in production)
DEMO_MODE=false
EOF
    echo "✅ Created new .env file with secure session secret"
fi

echo ""
echo "🔒 Security Information:"
echo "   - Session secret length: ${#SESSION_SECRET} characters"
echo "   - Entropy: ~256 bits"
echo "   - Generated using: $(which openssl > /dev/null && echo 'OpenSSL' || echo '/dev/urandom')"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "   - Keep this session secret confidential"
echo "   - Never commit the .env file to version control"
echo "   - Regenerate the secret if it's ever compromised"
echo "   - Use different secrets for different environments"
echo ""
echo "✅ Session secret generation complete!"
echo "   Your application is now ready for secure production deployment."