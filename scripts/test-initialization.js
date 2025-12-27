#!/usr/bin/env node

/**
 * Test script to verify company initialization service works correctly
 * This creates a test company and user, then runs initialization
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { User, Company } = require('../server/models');
const CompanyInitializationService = require('../server/services/companyInitializationService');
const { v4: uuidv4 } = require('uuid');

async function testInitialization() {
  let testCompanyId = null;
  let testUserId = null;
  
  try {
    console.log('🧪 Testing Company Initialization Service...\n');
    
    // Connect to database
    await sequelize.authenticate();
    console.log('✅ Database connected\n');
    
    // Create a test company
    console.log('📝 Creating test company...');
    const testCompany = await Company.create({
      name: `Test Company ${Date.now()}`,
      address: '123 Test Street',
      phone: '1234567890',
      email: `test${Date.now()}@example.com`,
      country: 'Tanzania',
      timezone: 'Africa/Dar_es_Salaam',
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isActive: true
    });
    testCompanyId = testCompany.id;
    console.log(`✅ Test company created: ${testCompany.name} (${testCompanyId})\n`);
    
    // Create a test user for this company
    console.log('👤 Creating test user...');
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
    
    const testUser = await User.create({
      first_name: 'Test',
      last_name: 'User',
      username: `testuser${Date.now()}`,
      email: `testuser${Date.now()}@example.com`,
      password: hashedPassword,
      role: 'admin',
      companyId: testCompanyId,
      approval_status: 'approved',
      isSystemAdmin: false
    });
    testUserId = testUser.id;
    console.log(`✅ Test user created: ${testUser.username} (${testUserId})\n`);
    
    // Initialize the service
    console.log('🔧 Initializing CompanyInitializationService...');
    const models = require('../server/models');
    const initService = new CompanyInitializationService(sequelize, models);
    console.log('✅ Service initialized\n');
    
    // Track progress
    let progressCount = 0;
    const progressCallback = (update) => {
      progressCount++;
      if (progressCount % 10 === 0 || update.stage === 'resolving') {
        console.log(`  📊 Progress: ${update.message} (${update.progress}/${update.total || '?'})`);
      }
    };
    
    // Run initialization
    console.log('🚀 Starting company initialization...\n');
    const startTime = Date.now();
    
    const result = await initService.initializeCompany(
      testCompanyId,
      testUserId,
      progressCallback
    );
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 INITIALIZATION RESULTS:');
    console.log('='.repeat(80));
    console.log(`✅ Success: ${result.success}`);
    console.log(`📝 Message: ${result.message}`);
    console.log(`📦 Total records: ${result.total}`);
    console.log(`✅ Successful: ${result.successful}`);
    console.log(`❌ Failed: ${result.failed}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('='.repeat(80));
    
    if (result.details) {
      console.log('\n📋 Details by table:');
      Object.entries(result.details).forEach(([table, details]) => {
        console.log(`  ${table}: ${details.created}/${details.total} created`);
        if (details.errors && details.errors.length > 0) {
          console.log(`    ⚠️  Errors: ${details.errors.length}`);
        }
      });
    }
    
    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.slice(0, 5).forEach((error, idx) => {
        console.log(`  ${idx + 1}. ${error.table}: ${error.error}`);
      });
      if (result.errors.length > 5) {
        console.log(`  ... and ${result.errors.length - 5} more errors`);
      }
    }
    
    // Verify some data was created
    console.log('\n🔍 Verifying created data...');
    const { Store, Account, FinancialYear, CustomerGroup, LinkedAccount } = models;
    
    const storesCount = await Store.count({ where: { companyId: testCompanyId } });
    const accountsCount = await Account.count({ where: { companyId: testCompanyId } });
    const financialYearsCount = await FinancialYear.count({ where: { companyId: testCompanyId } });
    const customerGroupsCount = await CustomerGroup.count({ where: { companyId: testCompanyId } });
    const linkedAccountsCount = await LinkedAccount.count({ where: { companyId: testCompanyId } });
    
    console.log(`  📦 Stores: ${storesCount}`);
    console.log(`  💰 Accounts: ${accountsCount}`);
    console.log(`  📅 Financial Years: ${financialYearsCount}`);
    console.log(`  👥 Customer Groups: ${customerGroupsCount}`);
    console.log(`  🔗 Linked Accounts: ${linkedAccountsCount}`);
    
    if (result.success && storesCount > 0 && accountsCount > 0) {
      console.log('\n✅ TEST PASSED: Initialization completed successfully!');
      return 0;
    } else {
      console.log('\n❌ TEST FAILED: Initialization did not create expected data');
      return 1;
    }
    
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    return 1;
  } finally {
    // Cleanup: Delete test company and user
    if (testCompanyId) {
      try {
        console.log('\n🧹 Cleaning up test data...');
        if (testUserId) {
          await User.destroy({ where: { id: testUserId }, force: true });
          console.log('  ✅ Test user deleted');
        }
        await Company.destroy({ where: { id: testCompanyId }, force: true });
        console.log('  ✅ Test company deleted');
      } catch (cleanupError) {
        console.error('  ⚠️  Cleanup error:', cleanupError.message);
        console.log(`  💡 Manual cleanup needed: Company ID ${testCompanyId}, User ID ${testUserId}`);
      }
    }
    
    await sequelize.close();
  }
}

// Run the test
testInitialization()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });

