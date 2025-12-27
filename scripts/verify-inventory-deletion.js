#!/usr/bin/env node

/**
 * Verify deletion of inventory and store request data
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
      { table: 'physical_inventories', column: 'companyId', label: 'Physical Inventories' },
      { table: 'physical_inventory_items', column: 'companyId', label: 'Physical Inventory Items' },
      { table: 'stock_adjustments', column: 'companyId', label: 'Stock Adjustments' },
      { table: 'stock_adjustment_items', column: 'companyId', label: 'Stock Adjustment Items' },
      { table: 'store_requests', column: 'companyId', label: 'Store Requests' },
      { table: 'store_request_items', column: 'companyId', label: 'Store Request Items' },
      { table: 'store_request_item_transactions', column: 'companyId', label: 'Store Request Item Transactions' },
    ];
    
    console.log('📊 RECORD COUNTS AFTER DELETION:');
    console.log('-'.repeat(80));
    
    let allDeleted = true;
    let totalRemaining = 0;
    for (const { table, column, label } of tablesToCheck) {
      const count = await countRecords(table, column, COMPANY_ID);
      const status = count === 0 ? '✅' : count === -1 ? '⚠️' : '❌';
      const message = count === 0 ? 'Deleted' : count === -1 ? 'Error checking' : `${count} remaining`;
      console.log(`  ${status} ${label.padEnd(35)} ${message}`);
      if (count > 0) {
        allDeleted = false;
        totalRemaining += count;
      }
    }
    
    console.log('-'.repeat(80));
    if (allDeleted) {
      console.log('\n✅ All requested data has been successfully deleted!\n');
      console.log('Deleted:');
      console.log('  ✅ Physical Inventories');
      console.log('  ✅ Stock Adjustments');
      console.log('  ✅ Store Requests (Issue/Receipt)\n');
    } else {
      console.log(`\n⚠️  ${totalRemaining} records still remain. Please check the output above.\n`);
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

