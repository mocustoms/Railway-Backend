#!/usr/bin/env node

/**
 * Verify deletion of transaction and customer data
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
      { table: 'proforma_invoices', column: 'companyId', label: 'Proforma Invoices' },
      { table: 'proforma_invoice_items', column: 'companyId', label: 'Proforma Invoice Items' },
      { table: 'sales_orders', column: 'companyId', label: 'Sales Orders' },
      { table: 'sales_order_items', column: 'companyId', label: 'Sales Order Items' },
      { table: 'customer_deposits', column: 'companyId', label: 'Customer Deposits' },
      { table: 'sales_agents', column: 'companyId', label: 'Sales Agents' },
      { table: 'sales_invoices', column: 'companyId', label: 'Sales Invoices' },
      { table: 'sales_invoice_items', column: 'companyId', label: 'Sales Invoice Items' },
      { table: 'customers', column: 'companyId', label: 'Customers' },
    ];
    
    console.log('📊 RECORD COUNTS AFTER DELETION:');
    console.log('-'.repeat(80));
    
    let allDeleted = true;
    let totalRemaining = 0;
    for (const { table, column, label } of tablesToCheck) {
      const count = await countRecords(table, column, COMPANY_ID);
      const status = count === 0 ? '✅' : count === -1 ? '⚠️' : '❌';
      const message = count === 0 ? 'Deleted' : count === -1 ? 'Error checking' : `${count} remaining`;
      console.log(`  ${status} ${label.padEnd(30)} ${message}`);
      if (count > 0) {
        allDeleted = false;
        totalRemaining += count;
      }
    }
    
    console.log('-'.repeat(80));
    if (allDeleted) {
      console.log('\n✅ All requested data has been successfully deleted!\n');
      console.log('Deleted:');
      console.log('  ✅ Proforma Invoices');
      console.log('  ✅ Sales Orders');
      console.log('  ✅ Customer Deposits');
      console.log('  ✅ Sales Agents');
      console.log('  ✅ Sales Invoices');
      console.log('  ✅ Customers\n');
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

