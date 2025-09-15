#!/bin/bash

# Production Security Validation Script
# Run this before deployment to verify security configuration

echo "🔒 Production Security Validation"
echo "================================="

# Check environment file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found - copy from .env.production.example"
    exit 1
fi

# Check for secure session secret
SESSION_SECRET=$(grep "SESSION_SECRET=" .env | cut -d'=' -f2)
if [ "$SESSION_SECRET" = "CHANGE-THIS-TO-SECURE-32-CHAR-STRING-FOR-PRODUCTION" ]; then
    echo "❌ SESSION_SECRET not changed from default - generate a secure 32-character string"
    exit 1
fi

if [ ${#SESSION_SECRET} -lt 32 ]; then
    echo "⚠️  SESSION_SECRET should be at least 32 characters long"
fi

# Check NODE_ENV is production
NODE_ENV=$(grep "NODE_ENV=" .env | cut -d'=' -f2)
if [ "$NODE_ENV" != "production" ]; then
    echo "❌ NODE_ENV must be set to 'production'"
    exit 1
fi

# Check DEMO_MODE is false
DEMO_MODE=$(grep "DEMO_MODE=" .env | cut -d'=' -f2)
if [ "$DEMO_MODE" != "false" ]; then
    echo "❌ DEMO_MODE must be set to 'false' for production"
    exit 1
fi

echo "✅ Environment configuration validated"

# Test security headers
echo "🔍 Testing security headers..."
npm run build > /dev/null 2>&1
node dist/index.js &
SERVER_PID=$!
sleep 3

HEADERS=$(curl -s -I http://localhost:5000/api/health)
if echo "$HEADERS" | grep -q "X-Content-Type-Options: nosniff"; then
    echo "✅ X-Content-Type-Options header present"
else
    echo "❌ X-Content-Type-Options header missing"
fi

if echo "$HEADERS" | grep -q "X-Frame-Options: DENY"; then
    echo "✅ X-Frame-Options header present"
else
    echo "❌ X-Frame-Options header missing"
fi

if echo "$HEADERS" | grep -q "X-XSS-Protection"; then
    echo "✅ X-XSS-Protection header present"
else
    echo "❌ X-XSS-Protection header missing"
fi

# Clean up
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo "✅ Security validation completed"
echo ""
echo "🚀 Ready for production deployment!"
echo "   Run: docker-compose -f docker-compose.production.yml up -d"