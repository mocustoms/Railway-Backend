#!/usr/bin/env node

/**
 * Test the full registration and initialization process
 * 1. Register a new user
 * 2. Register a company
 * 3. Initialize company data
 */

require('dotenv').config();
const axios = require('axios');
const config = require('../env');
const sequelize = require('../config/database');
const { User, Company } = require('../server/models');

const BASE_URL = `http://localhost:${config.PORT || 3000}/api`;
const TEST_USER = {
  firstName: 'Salama',
  lastName: 'Test',
  username: 'Salama',
  email: 'salama@test.com',
  password: 'Admin@123'
};
const TEST_COMPANY = {
  companyName: 'Sharwa Int.',
  companyAddress: '123 Test Street, Dar es Salaam',
  companyPhone: '255123456789',
  companyEmail: 'info@sharwaint.com',
  companyCountry: 'Tanzania',
  companyTimezone: 'Africa/Dar_es_Salaam'
};

async function testFullRegistration() {
  let cookies = [];
  let csrfToken = null;
  let userId = null;
  let companyId = null;

  try {
    console.log('🧪 Testing Full Registration and Initialization Process\n');
    console.log('='.repeat(80));
    
    // Connect to database for cleanup/approval
    await sequelize.authenticate();
    
    // Clean up: Delete existing user and company for clean test
    console.log('\n🧹 Cleaning up any existing test data...');
    const existingUser = await User.findOne({ where: { username: TEST_USER.username } });
    if (existingUser) {
      if (existingUser.companyId) {
        const existingCompany = await Company.findByPk(existingUser.companyId);
        if (existingCompany) {
          // Delete all company data first
          const { Account } = require('../server/models');
          await Account.destroy({ where: { companyId: existingCompany.id }, force: true });
          await existingCompany.destroy({ force: true });
          console.log('   ✅ Existing company and accounts deleted');
        }
      }
      await existingUser.destroy({ force: true });
      console.log('   ✅ Existing user deleted');
    }
    // Also check by email
    const existingUserByEmail = await User.findOne({ where: { email: TEST_USER.email } });
    if (existingUserByEmail && existingUserByEmail.username !== TEST_USER.username) {
      if (existingUserByEmail.companyId) {
        const existingCompany = await Company.findByPk(existingUserByEmail.companyId);
        if (existingCompany) {
          const { Account } = require('../server/models');
          await Account.destroy({ where: { companyId: existingCompany.id }, force: true });
          await existingCompany.destroy({ force: true });
        }
      }
      await existingUserByEmail.destroy({ force: true });
      console.log('   ✅ Existing user (by email) deleted');
    }
    
    console.log('\n📋 Testing auto-approval on registration...');

    // Create axios instance with cookie support
    const api = axios.create({
      baseURL: BASE_URL,
      withCredentials: true,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Intercept requests to add cookies
    api.interceptors.request.use((config) => {
      // Add cookies to request
      if (cookies.length > 0) {
        config.headers['Cookie'] = cookies.join('; ');
      }
      return config;
    });

    // Intercept responses to capture cookies
    api.interceptors.response.use((response) => {
      const setCookieHeaders = response.headers['set-cookie'];
      if (setCookieHeaders) {
        cookies = setCookieHeaders.map(cookie => cookie.split(';')[0]);
      }
      return response;
    });

    // Step 1: Register User
    console.log('\n📝 Step 1: Registering User...');
    console.log(`   Username: ${TEST_USER.username}`);
    console.log(`   Email: ${TEST_USER.email}`);
    
    try {
      const registerResponse = await api.post('/auth/register', TEST_USER);
      console.log('   ✅ User registered successfully');
      console.log(`   User ID: ${registerResponse.data.user?.id || 'N/A'}`);
      userId = registerResponse.data.user?.id;
      
      // Verify user is approved immediately
      const verifyUser = await User.findByPk(userId);
      if (verifyUser) {
        console.log(`   ✅ Approval Status: ${verifyUser.approval_status} (should be 'approved')`);
        if (verifyUser.approval_status !== 'approved') {
          console.log('   ⚠️  WARNING: User should be approved on registration!');
        }
      }
      
      // Get CSRF token from response
      if (registerResponse.data.csrfToken) {
        csrfToken = registerResponse.data.csrfToken;
        api.defaults.headers['X-CSRF-Token'] = csrfToken;
        console.log(`   🔑 CSRF Token set: ${csrfToken.substring(0, 20)}...`);
      }
      
      // Get cookies and update CSRF token if found
      const setCookieHeaders = registerResponse.headers['set-cookie'];
      if (setCookieHeaders) {
        cookies = setCookieHeaders.map(cookie => cookie.split(';')[0]);
        const csrfCookie = cookies.find(c => c.startsWith('csrfToken=') || c.startsWith('csrf_token='));
        if (csrfCookie) {
          const tokenValue = csrfCookie.split('=')[1];
          if (tokenValue && (!csrfToken || tokenValue !== csrfToken)) {
            csrfToken = tokenValue;
            api.defaults.headers['X-CSRF-Token'] = csrfToken;
            console.log(`   🔑 CSRF Token from cookie: ${csrfToken.substring(0, 20)}...`);
          }
        }
      }
      
      if (!csrfToken) {
        console.log('   ⚠️  Warning: No CSRF token found, will try to get one');
        // Try to get CSRF token from endpoint
        try {
          const csrfResponse = await api.get('/auth/csrf-token');
          if (csrfResponse.data.csrfToken) {
            csrfToken = csrfResponse.data.csrfToken;
            api.defaults.headers['X-CSRF-Token'] = csrfToken;
            console.log(`   🔑 CSRF Token from endpoint: ${csrfToken.substring(0, 20)}...`);
          }
        } catch (csrfError) {
          console.log('   ⚠️  Could not get CSRF token:', csrfError.message);
        }
      }
    } catch (error) {
      if (error.response?.status === 409 || error.response?.status === 400) {
        const errorMsg = error.response?.data?.message || '';
        if (errorMsg.includes('already exists') || errorMsg.includes('User with this')) {
          console.log('   ⚠️  User already exists, continuing with login...');
          // Ensure user is approved before login
          const userCheck = await User.findOne({ where: { username: TEST_USER.username } });
          if (userCheck && userCheck.approval_status !== 'approved') {
            await userCheck.update({ approval_status: 'approved' });
            console.log('   ✅ User approved before login');
          }
          // Try to login instead
          try {
            const loginResponse = await api.post('/auth/login', {
              username: TEST_USER.username,
              password: TEST_USER.password
            });
            console.log('   ✅ Logged in successfully');
            userId = loginResponse.data.user?.id;
            
            // Get CSRF token from login response
            if (loginResponse.data.csrfToken) {
              csrfToken = loginResponse.data.csrfToken;
              api.defaults.headers['X-CSRF-Token'] = csrfToken;
            }
            
            // Get cookies
            const setCookieHeaders = loginResponse.headers['set-cookie'];
            if (setCookieHeaders) {
              cookies = setCookieHeaders.map(cookie => cookie.split(';')[0]);
              const csrfCookie = cookies.find(c => c.startsWith('csrfToken='));
              if (csrfCookie && !csrfToken) {
                csrfToken = csrfCookie.split('=')[1];
                api.defaults.headers['X-CSRF-Token'] = csrfToken;
              }
            }
          } catch (loginError) {
            throw new Error(`Login failed: ${loginError.response?.data?.message || loginError.message}`);
          }
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Step 2: Register Company
    console.log('\n🏢 Step 2: Registering Company...');
    console.log(`   Company Name: ${TEST_COMPANY.companyName}`);
    
    const companyResponse = await api.post('/auth/register-company', TEST_COMPANY);
    
    if (companyResponse.data.company) {
      companyId = companyResponse.data.company.id;
      console.log('   ✅ Company registered successfully');
      console.log(`   Company ID: ${companyId}`);
      console.log(`   Requires Initialization: ${companyResponse.data.requiresInitialization || false}`);
      
      // Update cookies and CSRF token
      const newCookies = companyResponse.headers['set-cookie']?.map(c => c.split(';')[0]) || [];
      if (newCookies.length > 0) {
        cookies = newCookies;
        const newCsrfCookie = cookies.find(c => c.startsWith('csrfToken='));
        if (newCsrfCookie) {
          csrfToken = newCsrfCookie.split('=')[1];
          api.defaults.headers['X-CSRF-Token'] = csrfToken;
        }
      }
      
      if (companyResponse.data.csrfToken) {
        csrfToken = companyResponse.data.csrfToken;
        api.defaults.headers['X-CSRF-Token'] = csrfToken;
      }
    } else {
      throw new Error('Company registration failed: No company data returned');
    }

    // Step 3: Initialize Company Data
    console.log('\n🚀 Step 3: Initializing Company Data...');
    console.log('   This may take a few moments...\n');
    
    const startTime = Date.now();
    const initResponse = await api.post('/company/initialize', {});
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    if (initResponse.data.success) {
      console.log('   ✅ Initialization completed successfully!');
      console.log(`   ⏱️  Duration: ${duration}s`);
      console.log(`   📦 Total records: ${initResponse.data.total}`);
      console.log(`   ✅ Successful: ${initResponse.data.successful}`);
      console.log(`   ❌ Failed: ${initResponse.data.failed}`);
      
      if (initResponse.data.details) {
        console.log('\n   📋 Details by table:');
        // Show all tables, including those with 0 total (might have been skipped)
        const allTables = new Set([
          'financial_years', 'currencies', 'account_types', 'accounts', 
          'price_categories', 'exchange_rates', 'stores', 'customer_groups',
          'linked_accounts', 'product_categories', 'packaging', 'tax_codes',
          'adjustment_reasons', 'return_reasons', 'payment_methods', 'payment_types'
        ]);
        
        // Add tables from response
        Object.keys(initResponse.data.details).forEach(table => allTables.add(table));
        
        Array.from(allTables).forEach(table => {
          const details = initResponse.data.details[table] || { total: 0, created: 0, errors: [] };
          const status = details.created === details.total && details.total > 0 ? '✅' : details.total === 0 ? '⚪' : '⚠️';
          console.log(`     ${status} ${table}: ${details.created}/${details.total} created`);
          if (details.errors && details.errors.length > 0) {
            console.log(`        ⚠️  ${details.errors.length} errors`);
            // Show detailed errors for critical tables
            if (table === 'accounts' || table === 'financial_years' || table === 'account_types' || table === 'payment_methods') {
              console.log(`        🔍 Detailed errors for ${table}:`);
              details.errors.slice(0, 5).forEach((err, idx) => {
                console.log(`           ${idx + 1}. Record ${err.index + 1}: ${err.error?.substring(0, 200)}`);
              });
              if (details.errors.length > 5) {
                console.log(`           ... and ${details.errors.length - 5} more errors`);
              }
            } else if (details.created === 0 && details.total > 0) {
              // Show first error for tables with 0 created
              console.log(`        🔍 First error: ${details.errors[0]?.error?.substring(0, 200)}`);
            }
          } else if (details.created === 0 && details.total > 0) {
            console.log(`        ⚠️  No errors logged but 0 records created - check server logs`);
          } else if (details.total === 0) {
            console.log(`        ℹ️  No data in initial file (skipped)`);
          }
        });
      }
      
      if (initResponse.data.errors && initResponse.data.errors.length > 0) {
        console.log('\n   ⚠️  Errors encountered:');
        initResponse.data.errors.slice(0, 10).forEach((error, idx) => {
          console.log(`     ${idx + 1}. ${error.table}: ${error.error?.substring(0, 150)}`);
        });
        if (initResponse.data.errors.length > 10) {
          console.log(`     ... and ${initResponse.data.errors.length - 10} more errors`);
        }
      }
    } else {
      throw new Error(`Initialization failed: ${initResponse.data.message || 'Unknown error'}`);
    }

    // Step 4: Verify Data
    console.log('\n🔍 Step 4: Verifying Initialized Data...');
    
    // Get stores
    const storesResponse = await api.get('/stores');
    const storesCount = storesResponse.data?.data?.length || storesResponse.data?.stores?.length || 0;
    console.log(`   📦 Stores: ${storesCount}`);
    
    // Get accounts
    const accountsResponse = await api.get('/accounts');
    const accountsCount = accountsResponse.data?.data?.length || accountsResponse.data?.accounts?.length || 0;
    console.log(`   💰 Accounts: ${accountsCount}`);
    
    // Get financial years
    const fyResponse = await api.get('/financial-years');
    const fyCount = fyResponse.data?.data?.length || fyResponse.data?.financialYears?.length || 0;
    console.log(`   📅 Financial Years: ${fyCount}`);
    
    // Get customer groups
    const cgResponse = await api.get('/customer-groups');
    const cgCount = cgResponse.data?.data?.length || cgResponse.data?.customerGroups?.length || 0;
    console.log(`   👥 Customer Groups: ${cgCount}`);

    console.log('\n' + '='.repeat(80));
    if (initResponse.data.success && storesCount > 0 && accountsCount > 0) {
      console.log('✅ TEST PASSED: Full registration and initialization completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`   User: ${TEST_USER.username} (${userId})`);
      console.log(`   Company: ${TEST_COMPANY.companyName} (${companyId})`);
      console.log(`   Stores: ${storesCount}`);
      console.log(`   Accounts: ${accountsCount}`);
      console.log(`   Financial Years: ${fyCount}`);
      console.log(`   Customer Groups: ${cgCount}`);
      return 0;
    } else {
      console.log('❌ TEST FAILED: Initialization did not create expected data');
      return 1;
    }

  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error(`   ⚠️  Cannot connect to server at ${BASE_URL}`);
      console.error('   Please ensure the server is running on port', config.PORT || 3000);
      console.error('   Start server with: npm run server');
    } else if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Response:', JSON.stringify(error.response.data, null, 2).substring(0, 500));
    } else {
      console.error('   Error details:', error);
    }
    if (error.stack && process.env.NODE_ENV === 'development') {
      console.error('\nStack:', error.stack);
    }
    return 1;
  } finally {
    await sequelize.close();
  }
}

// Run the test
testFullRegistration()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });

