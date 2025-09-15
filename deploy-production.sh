#!/bin/bash

# Production Deployment Script for mgmt-vibe
# This script automates the production deployment process

set -e  # Exit on any error

echo "🚀 mgmt-vibe Production Deployment"
echo "=================================="
echo ""

# Step 1: Security validation
echo "Step 1: Running security validation..."
if ! ./production-security-check.sh; then
    echo "❌ Security validation failed. Please fix issues before deployment."
    exit 1
fi
echo ""

# Step 2: Build and test
echo "Step 2: Building and testing application..."
npm run build
echo "✅ Build completed successfully"

echo "Running smoke tests with authentication..."
# Set required environment variables for smoke tests
export ADMIN_TOKEN="${ADMIN_TOKEN:-secure-admin-token-2024-prod-ready}"
export SESSION_SECRET="${SESSION_SECRET:-b782dfd2510d0ccb17fcdff896bc1bec32fc1622d181cb0884bbb31e1aa7bffd}"

if ! npm run smoke; then
    echo "❌ Smoke tests failed. Please fix issues before deployment."
    echo "💡 Note: Smoke tests require ADMIN_TOKEN and SESSION_SECRET environment variables"
    exit 1
fi
echo "✅ Smoke tests passed"
echo ""

# Step 3: Docker build
echo "Step 3: Building Docker image..."
docker build -t mgmt-vibe:v1.0.0 .
echo "✅ Docker image built successfully"
echo ""

# Step 4: Deploy with Docker Compose
echo "Step 4: Deploying with Docker Compose..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker-compose -f docker-compose.production.yml up -d

echo "⏳ Waiting for application to start..."
sleep 10

# Step 5: Health check
echo "Step 5: Verifying deployment..."
HEALTH_CHECK=$(curl -s http://localhost:5000/api/health || echo "failed")

# Also test a protected endpoint to verify authentication is working
AUTH_CHECK=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:5000/api/services || echo "failed")

if echo "$HEALTH_CHECK" | grep -q '"status":"ok"' && echo "$AUTH_CHECK" | grep -q '"id"'; then
    echo "✅ Health check passed"
    echo "✅ Authentication check passed"
    echo "✅ Application is running at http://localhost:5000"
    echo ""
    echo "🎉 DEPLOYMENT SUCCESSFUL!"
    echo ""
    echo "📊 Next steps:"
    echo "   1. Monitor application logs: docker logs -f mgmt-vibe-production"
    echo "   2. Check performance metrics in first 24 hours"
    echo "   3. Verify all business functions are working"
    echo "   4. Set up external monitoring and alerting"
    echo ""
    echo "📋 Monitoring commands:"
    echo "   - Health: curl http://localhost:5000/api/health"
    echo "   - Auth test: curl -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:5000/api/services"
    echo "   - Logs: docker logs mgmt-vibe-production"
    echo "   - Stats: docker stats mgmt-vibe-production"
else
    echo "❌ Deployment verification failed"
    echo "Health Response: $HEALTH_CHECK"
    echo "Auth Response: $AUTH_CHECK"
    echo ""
    echo "🔍 Troubleshooting:"
    echo "   - Check logs: docker logs mgmt-vibe-production"
    echo "   - Check container status: docker ps"
    echo "   - Verify environment configuration"
    echo "   - Ensure ADMIN_TOKEN is properly set"
    exit 1
fi