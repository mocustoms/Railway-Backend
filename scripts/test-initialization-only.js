require('dotenv').config();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'http://localhost:3000';
let csrfToken = '';
let cookies = '';

// Helper to make authenticated requests
async function makeRequest(method, url, data = {}) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${url}`,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie': cookies
      },
      withCredentials: true
    };
    
    if (method !== 'get') {
      config.data = data;
    }
    
    const response = await axios(config);
    
    // Update cookies and CSRF token
    if (response.headers['set-cookie']) {
      cookies = response.headers['set-cookie'].join('; ');
    }
    if (response.data.csrfToken) {
      csrfToken = response.data.csrfToken;
    }
    
    return response;
  } catch (error) {
    if (error.response) {
      console.error(`Request failed: ${error.response.status} - ${error.response.data.message || JSON.stringify(error.response.data)}`);
    } else {
      console.error(`Request error: ${error.message}`);
    }
    throw error;
  }
}

async function testInitialization() {
  try {
    console.log('🧪 Testing Initialization Only\n');
    
    // Step 1: Register user
    console.log('📝 Step 1: Registering User...');
    const timestamp = Date.now().toString().slice(-8); // Last 8 digits
    const registerResponse = await makeRequest('post', '/api/auth/register', {
      firstName: 'Test',
      lastName: 'User',
      username: `testuser${timestamp}`,
      email: `test${timestamp}@test.com`,
      password: 'Test@123456'
    });
    
    if (registerResponse.data.csrfToken) {
      csrfToken = registerResponse.data.csrfToken;
    }
    console.log('✅ User registered');
    
    // Step 2: Register company
    console.log('\n🏢 Step 2: Registering Company...');
    const companyResponse = await makeRequest('post', '/api/auth/register-company', {
      companyName: `TestCompany${timestamp}`,
      companyAddress: '123 Test St',
      companyPhone: '1234567890',
      companyEmail: `company${timestamp}@test.com`
    });
    
    console.log('✅ Company registered');
    console.log('   Company ID:', companyResponse.data.company.id);
    
    // Step 3: Initialize
    console.log('\n🚀 Step 3: Initializing Company Data...');
    const initResponse = await makeRequest('post', '/api/company/initialize', {});
    
    console.log('\n📊 Initialization Results:');
    console.log('   Success:', initResponse.data.success);
    console.log('   Message:', initResponse.data.message);
    console.log('   Total:', initResponse.data.total);
    console.log('   Successful:', initResponse.data.successful);
    console.log('   Failed:', initResponse.data.failed);
    
    if (initResponse.data.details) {
      console.log('\n📋 Details by table:');
      Object.entries(initResponse.data.details).forEach(([table, details]) => {
        const status = details.created > 0 ? '✅' : '⚠️';
        console.log(`   ${status} ${table}: ${details.created}/${details.total} created`);
        if (details.errors && details.errors.length > 0) {
          console.log(`      ⚠️  ${details.errors.length} errors`);
          // Show ALL errors for accounts and financial_years (critical tables)
          const errorLimit = (table === 'accounts' || table === 'financial_years') ? details.errors.length : 2;
          details.errors.slice(0, errorLimit).forEach((err, idx) => {
            const errorMsg = err.error || err.message || JSON.stringify(err);
            console.log(`         ${idx + 1}. ${errorMsg.substring(0, 200)}`);
          });
        } else if (details.created === 0 && details.total > 0) {
          // If no errors logged but nothing created, this is suspicious
          console.log(`      ⚠️  No errors logged but 0 records created - check server logs`);
        }
      });
    }
    
    if (initResponse.data.errors && initResponse.data.errors.length > 0) {
      console.log('\n❌ Errors:');
      initResponse.data.errors.slice(0, 5).forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.table || 'unknown'}: ${err.error || err.message || JSON.stringify(err).substring(0, 150)}`);
      });
    }
    
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testInitialization();

