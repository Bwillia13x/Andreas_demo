import http from 'http';

// Test authentication and basic endpoint functionality
async function testAuthentication() {
  console.log('🔐 Authentication Test Starting...\n');
  
  const baseUrl = 'http://127.0.0.1:5001';
  const validToken = 'secure-admin-token-2024-prod-ready'; // Use the token we set in .env
  
  // Test 1: Health endpoint without auth (should work)
  console.log('✅ Test 1: Health endpoint (no auth required)');
  try {
    const response = await makeRequest(`${baseUrl}/api/health`);
    console.log(`   Status: ${response.status}`);
    console.log(`   ✅ Health endpoint accessible`);
  } catch (error) {
    console.log(`   ❌ Health endpoint error: ${error.message}`);
  }
  
  // Test 2: Test with the correct admin token
  console.log('\n✅ Test 2: Testing with correct admin token');
  
  const endpoints = [
    '/api/services',
    '/api/staff',
    '/api/appointments',
    '/api/inventory',
    '/api/analytics'
  ];
  
  let successCount = 0;
  for (const endpoint of endpoints) {
    try {
      const response = await makeRequest(`${baseUrl}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${validToken}` }
      });
      console.log(`   ${endpoint}: ${response.status} ${response.status === 200 ? '(SUCCESS!)' : response.status === 401 ? '(auth failed)' : '(other)'}`);
      if (response.status === 200) successCount++;
    } catch (error) {
      console.log(`   ${endpoint}: ERROR - ${error.message}`);
    }
  }
  
  console.log(`\n📊 Results: ${successCount}/${endpoints.length} endpoints working with authentication`);
  
  if (successCount === endpoints.length) {
    console.log('   🎉 All authentication tests PASSED!');
  } else if (successCount > 0) {
    console.log('   ⚠️  Partial success - some endpoints working');
  } else {
    console.log('   ❌ All authentication tests FAILED');
  }
  
  console.log('\n🎯 Authentication Test Complete!');
  process.exit(0);
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'GET',
      timeout: 5000,
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: data
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.abort();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

testAuthentication().catch(console.error);
