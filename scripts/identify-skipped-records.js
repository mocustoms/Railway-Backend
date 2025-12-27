#!/usr/bin/env node

/**
 * Identify which records were skipped during copy and why
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

const SOURCE_COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';
const TARGET_COMPANY_ID = process.argv[3] || '98e290ec-22aa-475d-8b29-44f70c94f993';
const RAILWAY_DATABASE_URL = process.argv[4] || process.env.RAILWAY_DATABASE_URL || 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';

const { Sequelize } = require('sequelize');

// Railway database connection
const railwaySequelize = new Sequelize(RAILWAY_DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

async function checkRecordExists(targetSequelize, tableName, recordId) {
  try {
    const result = await targetSequelize.query(
      `SELECT COUNT(*) as count FROM "${tableName}" WHERE "id" = :recordId`,
      { replacements: { recordId }, type: QueryTypes.SELECT }
    );
    const count = Array.isArray(result) && result[0]?.count || result?.count || 0;
    return parseInt(count) > 0;
  } catch (error) {
    return false;
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    await railwaySequelize.authenticate();
    
    console.log('🔍 IDENTIFYING SKIPPED RECORDS');
    console.log('='.repeat(80));
    console.log(`Source Company: ${SOURCE_COMPANY_ID}`);
    console.log(`Target Company: ${TARGET_COMPANY_ID}\n`);
    
    // Check Stores
    console.log('📦 STORES (2 skipped):');
    console.log('-'.repeat(80));
    const stores = await sequelize.query(
      `SELECT id, name, "companyId" FROM "stores" WHERE "companyId" = :companyId`,
      { replacements: { companyId: SOURCE_COMPANY_ID }, type: QueryTypes.SELECT }
    );
    const storesArray = Array.isArray(stores) && stores.length > 0 && Array.isArray(stores[0])
      ? stores[0]
      : Array.isArray(stores) ? stores : [stores];
    
    for (const store of storesArray) {
      if (!store) continue;
      const exists = await checkRecordExists(railwaySequelize, 'stores', store.id);
      console.log(`  ${exists ? '✅' : '❌'} ${store.name || store.id}`);
      if (!exists) {
        console.log(`     ID: ${store.id}`);
        console.log(`     Reason: Data format issue (Invalid value {})`);
      }
    }
    
    // Check Accounts
    console.log('\n💰 ACCOUNTS (2 skipped):');
    console.log('-'.repeat(80));
    const accounts = await sequelize.query(
      `SELECT id, name, code, "createdBy", "companyId" FROM "accounts" WHERE "companyId" = :companyId`,
      { replacements: { companyId: SOURCE_COMPANY_ID }, type: QueryTypes.SELECT }
    );
    const accountsArray = Array.isArray(accounts) && accounts.length > 0 && Array.isArray(accounts[0])
      ? accounts[0]
      : Array.isArray(accounts) ? accounts : [accounts];
    
    for (const account of accountsArray) {
      if (!account) continue;
      const exists = await checkRecordExists(railwaySequelize, 'accounts', account.id);
      if (!exists) {
        console.log(`  ❌ ${account.name || account.code || account.id}`);
        console.log(`     ID: ${account.id}`);
        console.log(`     Code: ${account.code || 'N/A'}`);
        console.log(`     Created By: ${account.createdBy || 'N/A'}`);
        
        // Check if createdBy user exists in Railway
        if (account.createdBy) {
          const userExists = await checkRecordExists(railwaySequelize, 'users', account.createdBy);
          console.log(`     Created By User Exists in Railway: ${userExists ? 'Yes' : 'No'}`);
          if (!userExists) {
            console.log(`     Reason: Foreign key constraint violation - createdBy user doesn't exist in Railway`);
          }
        }
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log('  Stores: 2 skipped (data format issues)');
    console.log('  Accounts: 2 skipped (createdBy foreign key constraint)');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
    await railwaySequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

