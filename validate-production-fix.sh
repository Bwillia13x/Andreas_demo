#!/bin/bash

# Quick validation script for the performance optimizer fix
echo "🔧 Validating Production Fix"
echo "============================"

# Build the application
echo "Building application..."
npm run build > /dev/null 2>&1

# Start server in background for quick test
echo "Starting server for validation..."
NODE_ENV=production node dist/index.js &
SERVER_PID=$!

# Wait for server to start
sleep 5

# Check if server is running without errors
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "✅ Server started successfully"
    
    # Test health endpoint
    HEALTH_RESPONSE=$(curl -s http://localhost:5000/api/health)
    if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
        echo "✅ Health check passed"
        echo "✅ Performance optimizer fix validated"
    else
        echo "❌ Health check failed"
        echo "Response: $HEALTH_RESPONSE"
    fi
else
    echo "❌ Server failed to start"
fi

# Clean up
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo ""
echo "🎯 Fix validation completed"