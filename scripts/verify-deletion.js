#!/usr/bin/env node

/**
 * Verify deletion of company data
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

const COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';

async function countRecords(tableName, companyIdColumn, companyId) {
  try {
    const result = await sequelize.query(
      `SELECT COUNT(*) as count FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.SELECT
      }
    );
    const count = Array.isArray(result) && result.length > 0 && Array.isArray(result[0])
      ? result[0][0]?.count || 0
      : result[0]?.count || 0;
    return parseInt(count) || 0;
  } catch (error) {
    return -1; // Error
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    console.log('🔍 VERIFYING DELETION FOR COMPANY:');
    console.log('='.repeat(80));
    console.log(`Company ID: ${COMPANY_ID}\n`);
    
    const tablesToCheck = [
      { table: 'products', column: 'companyId' },
      { table: 'product_brand_names', column: 'companyId' },
      { table: 'product_manufacturers', column: 'companyId' },
      { table: 'product_models', column: 'companyId' },
      { table: 'product_colors', column: 'companyId' },
      { table: 'product_store_locations', column: 'companyId' },
      { table: 'product_expiry_dates', column: 'companyId' },
      { table: 'product_transactions', column: 'companyId' },
      { table: 'product_price_categories', column: 'companyId' },
      { table: 'product_raw_materials', column: 'companyId' },
      { table: 'product_dosages', column: 'companyId' },
      { table: 'product_stores', column: 'companyId' },
    ];
    
    console.log('📊 RECORD COUNTS AFTER DELETION:');
    console.log('-'.repeat(80));
    
    let allDeleted = true;
    for (const { table, column } of tablesToCheck) {
      const count = await countRecords(table, column, COMPANY_ID);
      const status = count === 0 ? '✅' : count === -1 ? '⚠️' : '❌';
      const message = count === 0 ? 'Deleted' : count === -1 ? 'Error checking' : `${count} remaining`;
      console.log(`  ${status} ${table.padEnd(40)} ${message}`);
      if (count > 0) {
        allDeleted = false;
      }
    }
    
    console.log('-'.repeat(80));
    if (allDeleted) {
      console.log('\n✅ All product-related data has been successfully deleted!\n');
    } else {
      console.log('\n⚠️  Some records still remain. Please check the output above.\n');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

