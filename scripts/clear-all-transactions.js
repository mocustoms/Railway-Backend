#!/usr/bin/env node

/**
 * Clear Transaction Data, Receipts, and Customer Balances for a specific company
 * 
 * This script deletes transaction data, receipts, and resets customer balances
 * for a specific companyId
 * Usage: node scripts/clear-all-transactions.js [companyId]
 *        Or set COMPANY_ID environment variable
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const readline = require('readline');

// All transaction-related tables (no foreign key dependencies to other transaction tables)
const TRANSACTION_TABLES = [
  'receipt_transactions',
  'loyalty_transactions',
  'sales_transactions',
  'product_transactions',
  'transactions',
  'general_ledger',     // General ledger entries
  'store_request_item_transactions',
];

// Tables with foreign key dependencies (delete in order)
// Delete child tables first, then parent tables

// Invoice-related tables
const INVOICE_TABLES = [
  'sales_invoice_items',    // Delete first (has FK to sales_invoices)
  'sales_invoices',         // Delete second
];

// Order-related tables
const ORDER_TABLES = [
  'sales_order_items',      // Delete first (has FK to sales_orders)
  'sales_orders',            // Delete second
];

// Proforma invoice tables
const PROFORMA_TABLES = [
  'proforma_invoice_items',  // Delete first (has FK to proforma_invoices)
  'proforma_invoices',       // Delete second
];

// Physical inventory tables
const PHYSICAL_INVENTORY_TABLES = [
  'physical_inventory_items',      // Delete first (has FK to physical_inventories)
  'physical_inventory_reversals',  // Delete second (might have FK to physical_inventories)
  'physical_inventories',          // Delete third
];

// Stock adjustment tables
const STOCK_ADJUSTMENT_TABLES = [
  'stock_adjustment_items',  // Delete first (has FK to stock_adjustments)
  'stock_adjustments',        // Delete second
];

// Store request tables
const STORE_REQUEST_TABLES = [
  'store_request_items',      // Delete first (has FK to store_requests)
  'store_requests',           // Delete second
];

// Journal entry tables
const JOURNAL_ENTRY_TABLES = [
  'journal_entry_lines',     // Delete first (has FK to journal_entries)
  'journal_entries',         // Delete second
];

// Receipt-related tables (delete in order due to foreign key constraints)
const RECEIPT_TABLES = [
  'receipt_items',      // Delete first (has foreign key to receipts)
  'receipts',           // Delete second
];

async function countRecordsInTable(tableName, companyId = null) {
  try {
    let query = `SELECT COUNT(*) as count FROM "${tableName}"`;
    const replacements = {};
    
    if (companyId) {
      // Check if table has companyId column
      query += ` WHERE "companyId" = :companyId`;
      replacements.companyId = companyId;
    }
    
    const result = await sequelize.query(
      query,
      {
        type: QueryTypes.SELECT,
        replacements
      }
    );
    return parseInt(result[0]?.count || 0);
  } catch (error) {
    return { error: error.message };
  }
}

async function deleteAllFromTable(tableName, transaction, companyId = null) {
  try {
    let countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
    let deleteQuery = `DELETE FROM "${tableName}"`;
    const replacements = {};
    
    if (companyId) {
      countQuery += ` WHERE "companyId" = :companyId`;
      deleteQuery += ` WHERE "companyId" = :companyId`;
      replacements.companyId = companyId;
    }
    
    // Count before deletion
    const countResult = await sequelize.query(
      countQuery,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements
      }
    );
    const countBefore = parseInt(countResult[0]?.count || 0);
    
    if (countBefore === 0) {
      return { success: true, deleted: 0 };
    }
    
    // Delete records (filtered by companyId if provided)
    const deleteResult = await sequelize.query(
      deleteQuery,
      {
        type: QueryTypes.RAW,
        transaction,
        replacements
      }
    );
    
    // Get rowCount from result
    let deleted = 0;
    if (Array.isArray(deleteResult)) {
      if (deleteResult[1] && deleteResult[1].rowCount !== undefined) {
        deleted = deleteResult[1].rowCount;
      } else if (deleteResult[0] && deleteResult[0].rowCount !== undefined) {
        deleted = deleteResult[0].rowCount;
      } else {
        deleted = countBefore; // Fallback
      }
    }
    
    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function resetCustomerBalances(transaction, companyId = null) {
  try {
    let countQuery = `SELECT COUNT(*) as count FROM "customers" 
       WHERE ("debt_balance" != 0 
          OR "deposit_balance" != 0 
          OR "account_balance" != 0 
          OR "loyalty_points" != 0)`;
    let updateQuery = `UPDATE "customers" 
       SET "debt_balance" = 0,
           "deposit_balance" = 0,
           "account_balance" = 0,
           "loyalty_points" = 0
       WHERE ("debt_balance" != 0 
          OR "deposit_balance" != 0 
          OR "account_balance" != 0 
          OR "loyalty_points" != 0)`;
    const replacements = {};
    
    if (companyId) {
      countQuery += ` AND "companyId" = :companyId`;
      updateQuery += ` AND "companyId" = :companyId`;
      replacements.companyId = companyId;
    }
    
    // Count customers with non-zero balances
    const countResult = await sequelize.query(
      countQuery,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements
      }
    );
    const customersAffected = parseInt(countResult[0]?.count || 0);
    
    if (customersAffected === 0) {
      return { success: true, updated: 0 };
    }
    
    // Reset customer balances to 0 (filtered by companyId if provided)
    const updateResult = await sequelize.query(
      updateQuery,
      {
        type: QueryTypes.RAW,
        transaction,
        replacements
      }
    );
    
    // Get rowCount from result
    let updated = 0;
    if (Array.isArray(updateResult)) {
      if (updateResult[1] && updateResult[1].rowCount !== undefined) {
        updated = updateResult[1].rowCount;
      } else if (updateResult[0] && updateResult[0].rowCount !== undefined) {
        updated = updateResult[0].rowCount;
      } else {
        updated = customersAffected; // Fallback
      }
    }
    
    return { success: true, updated };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function resetProductStoreQuantities(transaction, companyId = null) {
  try {
    let countQuery = `SELECT COUNT(*) as count FROM "product_stores" 
       WHERE "quantity" != 0`;
    let updateQuery = `UPDATE "product_stores" 
       SET "quantity" = 0
       WHERE "quantity" != 0`;
    const replacements = {};
    
    if (companyId) {
      countQuery += ` AND "companyId" = :companyId`;
      updateQuery += ` AND "companyId" = :companyId`;
      replacements.companyId = companyId;
    }
    
    // Count product stores with non-zero quantities
    const countResult = await sequelize.query(
      countQuery,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements
      }
    );
    const productStoresAffected = parseInt(countResult[0]?.count || 0);
    
    if (productStoresAffected === 0) {
      return { success: true, updated: 0 };
    }
    
    // Reset product store quantities to 0 (filtered by companyId if provided)
    const updateResult = await sequelize.query(
      updateQuery,
      {
        type: QueryTypes.RAW,
        transaction,
        replacements
      }
    );
    
    // Get rowCount from result
    let updated = 0;
    if (Array.isArray(updateResult)) {
      if (updateResult[1] && updateResult[1].rowCount !== undefined) {
        updated = updateResult[1].rowCount;
      } else if (updateResult[0] && updateResult[0].rowCount !== undefined) {
        updated = updateResult[0].rowCount;
      } else {
        updated = productStoresAffected; // Fallback
      }
    }
    
    return { success: true, updated };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  try {
    // Get companyId from command line argument or environment variable
    const companyId = process.argv[2] || process.env.COMPANY_ID || null;
    
    if (!companyId) {
      console.error('❌ Error: Company ID is required!');
      console.error('   Usage: node scripts/clear-all-transactions.js <companyId>');
      console.error('   Or set COMPANY_ID environment variable');
      process.exit(1);
    }
    
    console.log(`📋 Company ID: ${companyId}\n`);
    
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    console.log('🔍 CHECKING TRANSACTION DATA, RECEIPTS, AND CUSTOMER BALANCES');
    console.log('='.repeat(80));
    
    // Count records in transaction tables
    console.log('\n📊 COUNTING RECORDS PER TABLE:');
    console.log('-'.repeat(80));
    
    const tableCounts = [];
    let totalRecords = 0;
    
    for (const table of TRANSACTION_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          tableCounts.push({ table, count, type: 'transaction' });
          totalRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in invoice tables
    const invoiceCounts = [];
    let totalInvoiceRecords = 0;
    
    for (const table of INVOICE_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          invoiceCounts.push({ table, count, type: 'invoice' });
          totalInvoiceRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in order tables
    const orderCounts = [];
    let totalOrderRecords = 0;
    
    for (const table of ORDER_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          orderCounts.push({ table, count, type: 'order' });
          totalOrderRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in proforma tables
    const proformaCounts = [];
    let totalProformaRecords = 0;
    
    for (const table of PROFORMA_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          proformaCounts.push({ table, count, type: 'proforma' });
          totalProformaRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in physical inventory tables
    const physicalInventoryCounts = [];
    let totalPhysicalInventoryRecords = 0;
    
    for (const table of PHYSICAL_INVENTORY_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          physicalInventoryCounts.push({ table, count, type: 'physical_inventory' });
          totalPhysicalInventoryRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in stock adjustment tables
    const stockAdjustmentCounts = [];
    let totalStockAdjustmentRecords = 0;
    
    for (const table of STOCK_ADJUSTMENT_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          stockAdjustmentCounts.push({ table, count, type: 'stock_adjustment' });
          totalStockAdjustmentRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in store request tables
    const storeRequestCounts = [];
    let totalStoreRequestRecords = 0;
    
    for (const table of STORE_REQUEST_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          storeRequestCounts.push({ table, count, type: 'store_request' });
          totalStoreRequestRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in journal entry tables
    const journalEntryCounts = [];
    let totalJournalEntryRecords = 0;
    
    for (const table of JOURNAL_ENTRY_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          journalEntryCounts.push({ table, count, type: 'journal_entry' });
          totalJournalEntryRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count records in receipt tables
    const receiptCounts = [];
    let totalReceiptRecords = 0;
    
    for (const table of RECEIPT_TABLES) {
      const count = await countRecordsInTable(table, companyId);
      if (typeof count === 'number') {
        if (count > 0) {
          receiptCounts.push({ table, count, type: 'receipt' });
          totalReceiptRecords += count;
        }
        console.log(`  ${table.padEnd(40)} ${count.toString().padStart(6)} records`);
      } else {
        console.log(`  ${table.padEnd(40)} Error: ${count.error}`);
      }
    }
    
    // Count customers with non-zero balances for this company
    let customerCountQuery = `SELECT COUNT(*) as count FROM "customers" 
       WHERE ("debt_balance" != 0 
          OR "deposit_balance" != 0 
          OR "account_balance" != 0 
          OR "loyalty_points" != 0)
       AND "companyId" = :companyId`;
    const customerBalanceResult = await sequelize.query(
      customerCountQuery,
      {
        type: QueryTypes.SELECT,
        replacements: { companyId }
      }
    );
    const customersWithBalances = parseInt(customerBalanceResult[0]?.count || 0);
    
    if (customersWithBalances > 0) {
      console.log(`  ${'customers (balances to reset)'.padEnd(40)} ${customersWithBalances.toString().padStart(6)} customers`);
    } else {
      console.log(`  ${'customers (balances to reset)'.padEnd(40)} ${'0'.padStart(6)} customers`);
    }
    
    // Count product stores with non-zero quantities for this company
    let productStoreCountQuery = `SELECT COUNT(*) as count FROM "product_stores" 
       WHERE "quantity" != 0
       AND "companyId" = :companyId`;
    const productStoreQuantityResult = await sequelize.query(
      productStoreCountQuery,
      {
        type: QueryTypes.SELECT,
        replacements: { companyId }
      }
    );
    const productStoresWithStock = parseInt(productStoreQuantityResult[0]?.count || 0);
    
    if (productStoresWithStock > 0) {
      console.log(`  ${'product_stores (quantities to reset)'.padEnd(40)} ${productStoresWithStock.toString().padStart(6)} records`);
    } else {
      console.log(`  ${'product_stores (quantities to reset)'.padEnd(40)} ${'0'.padStart(6)} records`);
    }
    
    console.log('-'.repeat(80));
    const grandTotal = totalRecords + totalInvoiceRecords + totalOrderRecords + totalProformaRecords + 
                      totalPhysicalInventoryRecords + totalStockAdjustmentRecords + totalStoreRequestRecords + 
                      totalJournalEntryRecords + totalReceiptRecords;
    console.log(`  ${'TOTAL RECORDS TO DELETE'.padEnd(40)} ${grandTotal.toString().padStart(6)} records`);
    if (customersWithBalances > 0) {
      console.log(`  ${'CUSTOMERS TO RESET'.padEnd(40)} ${customersWithBalances.toString().padStart(6)} customers`);
    } else {
      console.log(`  ${'CUSTOMERS TO RESET'.padEnd(40)} ${'0'.padStart(6)} customers`);
    }
    if (productStoresWithStock > 0) {
      console.log(`  ${'PRODUCT STORES TO RESET'.padEnd(40)} ${productStoresWithStock.toString().padStart(6)} records\n`);
    } else {
      console.log(`  ${'PRODUCT STORES TO RESET'.padEnd(40)} ${'0'.padStart(6)} records\n`);
    }
    
    if (grandTotal === 0 && customersWithBalances === 0 && productStoresWithStock === 0) {
      console.log('✅ No data found. Nothing to delete or reset.\n');
      process.exit(0);
    }
    
    // Ask for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('⚠️  WARNING: This will permanently:');
    console.log(`   - Delete transaction data for company ${companyId} (${totalRecords} records)`);
    console.log(`   - Delete invoices for company ${companyId} (${totalInvoiceRecords} records)`);
    console.log(`   - Delete sales orders for company ${companyId} (${totalOrderRecords} records)`);
    console.log(`   - Delete proforma invoices for company ${companyId} (${totalProformaRecords} records)`);
    console.log(`   - Delete physical inventories for company ${companyId} (${totalPhysicalInventoryRecords} records)`);
    console.log(`   - Delete stock adjustments for company ${companyId} (${totalStockAdjustmentRecords} records)`);
    console.log(`   - Delete store requests for company ${companyId} (${totalStoreRequestRecords} records)`);
    console.log(`   - Delete journal entries for company ${companyId} (${totalJournalEntryRecords} records)`);
    console.log(`   - Delete receipts for company ${companyId} (${totalReceiptRecords} records)`);
    console.log(`   - Reset customer balances for company ${companyId} (${customersWithBalances} customers)`);
    console.log(`   - Reset product store quantities for company ${companyId} (${productStoresWithStock} records)`);
    console.log(`   Total records to delete: ${grandTotal}`);
    const totalTables = tableCounts.length + invoiceCounts.length + orderCounts.length + proformaCounts.length + 
                       physicalInventoryCounts.length + stockAdjustmentCounts.length + storeRequestCounts.length + 
                       journalEntryCounts.length + receiptCounts.length;
    console.log(`   Tables affected: ${totalTables}\n`);
    
    const answer = await new Promise((resolve) => {
      rl.question('Are you sure you want to proceed? Type "DELETE ALL" to confirm: ', (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });
    
    if (answer !== 'DELETE ALL') {
      console.log('\n❌ Deletion cancelled');
      process.exit(0);
    }
    
    console.log('\n🗑️  DELETING ALL TRANSACTION DATA, RECEIPTS, AND RESETTING CUSTOMER BALANCES...');
    console.log('='.repeat(80));
    
    const transaction = await sequelize.transaction();
    
    try {
      let totalDeleted = 0;
      const deletionResults = [];
      
      // Delete transaction tables
      for (const { table, count } of tableCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'transaction' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'transaction' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete invoice tables (in order due to foreign keys)
      for (const { table, count } of invoiceCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'invoice' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'invoice' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete order tables (in order due to foreign keys)
      for (const { table, count } of orderCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'order' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'order' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete proforma tables (in order due to foreign keys)
      for (const { table, count } of proformaCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'proforma' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'proforma' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete physical inventory tables (in order due to foreign keys)
      for (const { table, count } of physicalInventoryCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'physical_inventory' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'physical_inventory' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete stock adjustment tables (in order due to foreign keys)
      for (const { table, count } of stockAdjustmentCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'stock_adjustment' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'stock_adjustment' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete store request tables (in order due to foreign keys)
      for (const { table, count } of storeRequestCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'store_request' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'store_request' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete journal entry tables (in order due to foreign keys)
      for (const { table, count } of journalEntryCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'journal_entry' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'journal_entry' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Delete receipt tables (in order due to foreign keys)
      for (const { table, count } of receiptCounts) {
        const result = await deleteAllFromTable(table, transaction, companyId);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table, deleted, success: true, type: 'receipt' });
          console.log(`  ✅ ${table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table, deleted: 0, success: false, error: result.error, type: 'receipt' });
          console.log(`  ❌ ${table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${table}: ${result.error}`);
        }
      }
      
      // Reset customer balances
      if (customersWithBalances > 0) {
        console.log('\n💰 RESETTING CUSTOMER BALANCES...');
        const balanceResult = await resetCustomerBalances(transaction, companyId);
        if (balanceResult.success) {
          const updated = balanceResult.updated || 0;
          deletionResults.push({ table: 'customers (balances)', deleted: updated, success: true, type: 'balance' });
          console.log(`  ✅ customers (balances)${' '.padEnd(20)} Reset ${updated} customers`);
        } else {
          deletionResults.push({ table: 'customers (balances)', deleted: 0, success: false, error: balanceResult.error, type: 'balance' });
          console.log(`  ❌ customers (balances)${' '.padEnd(20)} Error: ${balanceResult.error}`);
          throw new Error(`Failed to reset customer balances: ${balanceResult.error}`);
        }
      }
      
      // Reset product store quantities
      if (productStoresWithStock > 0) {
        console.log('\n📦 RESETTING PRODUCT STORE QUANTITIES...');
        const stockResult = await resetProductStoreQuantities(transaction, companyId);
        if (stockResult.success) {
          const updated = stockResult.updated || 0;
          deletionResults.push({ table: 'product_stores (quantities)', deleted: updated, success: true, type: 'stock' });
          console.log(`  ✅ product_stores (quantities)${' '.padEnd(15)} Reset ${updated} records`);
        } else {
          deletionResults.push({ table: 'product_stores (quantities)', deleted: 0, success: false, error: stockResult.error, type: 'stock' });
          console.log(`  ❌ product_stores (quantities)${' '.padEnd(15)} Error: ${stockResult.error}`);
          throw new Error(`Failed to reset product store quantities: ${stockResult.error}`);
        }
      }
      
      await transaction.commit();
      
      console.log('\n' + '='.repeat(80));
      console.log('📊 DELETION SUMMARY:');
      console.log(`   Total records deleted: ${totalDeleted}`);
      console.log(`   Customers reset: ${customersWithBalances}`);
      console.log(`   Product stores reset: ${productStoresWithStock}`);
      console.log(`   Tables processed: ${deletionResults.length}`);
      console.log(`   Successful: ${deletionResults.filter(r => r.success).length}`);
      console.log(`   Failed: ${deletionResults.filter(r => !r.success).length}`);
      console.log('='.repeat(80));
      console.log('\n✅ All transaction data, receipts cleared, customer balances and stock quantities reset successfully!\n');
      
    } catch (error) {
      await transaction.rollback();
      console.error('\n❌ Error during deletion:', error.message);
      console.error('   Transaction rolled back - no changes were made.\n');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});









