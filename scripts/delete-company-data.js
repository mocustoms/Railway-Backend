#!/usr/bin/env node

/**
 * Delete All Data for a Specific Company
 * 
 * This script safely deletes all data associated with a company ID
 * Usage: node scripts/delete-company-data.js <company-id>
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const readline = require('readline');

const COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';

// Tables to delete - ordered by deletion dependency
// Child tables (with foreign keys) should be deleted first
const TABLES_TO_DELETE = [
  // All transaction-related tables
  'receipt_transactions',
  'loyalty_transactions',
  'sales_transactions',
  'product_transactions',
  'transactions',
];

async function checkCompanyExists(companyId) {
  const companiesResult = await sequelize.query(
    `SELECT id, name, email FROM "Company" WHERE id = :companyId`,
    {
      replacements: { companyId },
      type: QueryTypes.SELECT
    }
  );
  const companies = Array.isArray(companiesResult) && companiesResult.length > 0 && Array.isArray(companiesResult[0])
    ? companiesResult[0]
    : companiesResult;
  return companies && companies.length > 0 ? companies[0] : null;
}

async function countRecordsInTable(tableName, companyId) {
  try {
    // Check if table has companyId column
    const columnsResult = await sequelize.query(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_schema = 'public' 
       AND table_name = :tableName 
       AND column_name IN ('companyId', 'company_id')`,
      {
        replacements: { tableName },
        type: QueryTypes.SELECT
      }
    );
    
    const columns = Array.isArray(columnsResult) && columnsResult.length > 0 && Array.isArray(columnsResult[0])
      ? columnsResult[0]
      : columnsResult;
    
    if (!columns || columns.length === 0) {
      return { count: 0, hasCompanyId: false };
    }
    
    const companyIdColumn = columns[0].column_name;
    const countResult = await sequelize.query(
      `SELECT COUNT(*) as count FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.SELECT
      }
    );
    
    const result = Array.isArray(countResult) && countResult.length > 0 && Array.isArray(countResult[0])
      ? countResult[0][0]
      : countResult[0];
    
    return { 
      count: parseInt(result.count) || 0, 
      hasCompanyId: true,
      columnName: companyIdColumn
    };
  } catch (error) {
    return { count: 0, hasCompanyId: false, error: error.message };
  }
}

async function deleteRecordsFromTable(tableName, companyId, companyIdColumn, transaction) {
  try {
    // First, count records before deletion
    const countResult = await sequelize.query(
      `SELECT COUNT(*) as count FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    const countBefore = parseInt(countResult[0]?.count || 0);
    
    if (countBefore === 0) {
      return { success: true, deleted: 0 };
    }
    
    // Perform deletion using raw SQL
    const deleteResult = await sequelize.query(
      `DELETE FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.RAW,
        transaction
      }
    );
    
    // PostgreSQL returns rowCount in the metadata
    // The result structure is: [rows, metadata] where metadata has rowCount
    let deleted = 0;
    if (Array.isArray(deleteResult)) {
      // Try to get rowCount from metadata
      if (deleteResult[1] && deleteResult[1].rowCount !== undefined) {
        deleted = deleteResult[1].rowCount;
      } else if (deleteResult[0] && deleteResult[0].rowCount !== undefined) {
        deleted = deleteResult[0].rowCount;
      } else {
        // Fallback: use countBefore as deleted count
        deleted = countBefore;
      }
    }
    
    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function nullifyProductForeignKeys(companyId, transaction) {
  try {
    // Set foreign keys to NULL in products table before deleting reference data
    const result = await sequelize.query(
      `UPDATE products 
       SET brand_id = NULL, 
           manufacturer_id = NULL, 
           model_id = NULL, 
           color_id = NULL, 
           store_location_id = NULL
       WHERE "companyId" = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.UPDATE,
        transaction
      }
    );
    return { success: true, updated: result[1] || 0 };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function deleteProductReferences(companyId, transaction) {
  try {
    // Delete or nullify product references in transaction/item tables
    // These tables reference products but we want to delete products, so we need to handle them
    
    const tablesToClean = [
      { table: 'physical_inventory_items', action: 'DELETE' },
      { table: 'stock_adjustment_items', action: 'DELETE' },
      { table: 'store_request_items', action: 'DELETE' },
      { table: 'sales_invoice_items', action: 'DELETE' }, // Delete invoice items that reference these products
      { table: 'sales_order_items', action: 'DELETE' }, // Delete order items that reference these products
      { table: 'proforma_invoice_items', action: 'DELETE' }, // Delete proforma items that reference these products
    ];
    
    let totalDeleted = 0;
    const results = [];
    
    for (const { table, action } of tablesToClean) {
      try {
        // First, get product IDs for this company
        const productIdsResult = await sequelize.query(
          `SELECT id FROM products WHERE "companyId" = :companyId`,
          {
            replacements: { companyId },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        
        const products = Array.isArray(productIdsResult) && productIdsResult.length > 0 && Array.isArray(productIdsResult[0])
          ? productIdsResult[0]
          : productIdsResult;
        
        if (products && products.length > 0) {
          const productIdList = products.map(p => `'${p.id}'`).join(',');
          
          if (action === 'DELETE') {
            // Check if table exists and has product_id column
            const columnsResult = await sequelize.query(
              `SELECT column_name FROM information_schema.columns 
               WHERE table_schema = 'public' AND table_name = :tableName AND column_name = 'product_id'`,
              {
                replacements: { tableName: table },
                type: QueryTypes.SELECT,
                transaction
              }
            );
            
            const columns = Array.isArray(columnsResult) && columnsResult.length > 0 && Array.isArray(columnsResult[0])
              ? columnsResult[0]
              : columnsResult;
            
            if (columns && columns.length > 0) {
              // Delete items that reference these products
              const deleteResult = await sequelize.query(
                `DELETE FROM "${table}" WHERE product_id IN (${productIdList})`,
                {
                  type: QueryTypes.DELETE,
                  transaction
                }
              );
              const deleted = Array.isArray(deleteResult) && deleteResult.length > 1 ? deleteResult[1] : (deleteResult[1] || 0);
              totalDeleted += deleted;
              results.push({ table, deleted, success: true });
            }
          }
        }
      } catch (error) {
        results.push({ table, deleted: 0, success: false, error: error.message });
      }
    }
    
    return { success: true, totalDeleted, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    console.log('🔍 CHECKING COMPANY DATA');
    console.log('='.repeat(80));
    console.log(`Company ID: ${COMPANY_ID}\n`);
    
    // Check if company exists
    const company = await checkCompanyExists(COMPANY_ID);
    if (!company) {
      console.log('❌ Company not found with this ID');
      process.exit(1);
    }
    
    console.log(`✅ Found company: ${company.name} (${company.email || 'No email'})\n`);
    
    // Count records in each table
    console.log('📊 COUNTING RECORDS PER TABLE:');
    console.log('-'.repeat(80));
    
    const tableCounts = [];
    let totalRecords = 0;
    
    for (const table of TABLES_TO_DELETE) {
      const result = await countRecordsInTable(table, COMPANY_ID);
      if (result.hasCompanyId && result.count > 0) {
        tableCounts.push({
          table,
          count: result.count,
          columnName: result.columnName
        });
        totalRecords += result.count;
        console.log(`  ${table.padEnd(40)} ${result.count.toString().padStart(6)} records`);
      } else if (result.hasCompanyId) {
        console.log(`  ${table.padEnd(40)} ${'0'.padStart(6)} records (no data)`);
      } else {
        console.log(`  ${table.padEnd(40)} ${'N/A'.padStart(6)} (no companyId column)`);
      }
    }
    
    console.log('-'.repeat(80));
    console.log(`  ${'TOTAL'.padEnd(40)} ${totalRecords.toString().padStart(6)} records\n`);
    
    if (totalRecords === 0) {
      console.log('✅ No data found for this company. Nothing to delete.\n');
      process.exit(0);
    }
    
    // Ask for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('⚠️  WARNING: This will permanently delete the following data for this company!');
    console.log(`   Company: ${company.name}`);
    console.log(`   Data to delete: Transactions (general transaction records)`);
    console.log(`   Total records to delete: ${totalRecords}`);
    console.log(`   Tables affected: ${tableCounts.length}\n`);
    
    const answer = await new Promise((resolve) => {
      rl.question('Are you sure you want to proceed? Type "DELETE" to confirm: ', (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });
    
    if (answer !== 'DELETE') {
      console.log('\n❌ Deletion cancelled');
      process.exit(0);
    }
    
    console.log('\n🗑️  DELETING DATA...');
    console.log('='.repeat(80));
    
    const transaction = await sequelize.transaction();
    
    try {
      let totalDeleted = 0;
      const deletionResults = [];
      
      // Delete all transaction tables
      console.log('\n🗑️  Deleting Transaction Data...');
      for (const tableInfo of tableCounts) {
        const result = await deleteRecordsFromTable(tableInfo.table, COMPANY_ID, tableInfo.columnName, transaction);
        if (result.success) {
          const deleted = result.deleted || 0;
          totalDeleted += deleted;
          deletionResults.push({ table: tableInfo.table, deleted, success: true });
          console.log(`  ✅ ${tableInfo.table.padEnd(35)} Deleted ${deleted} records`);
        } else {
          deletionResults.push({ table: tableInfo.table, deleted: 0, success: false, error: result.error });
          console.log(`  ❌ ${tableInfo.table.padEnd(35)} Error: ${result.error}`);
          throw new Error(`Failed to delete ${tableInfo.table}: ${result.error}`);
        }
      }
      
      await transaction.commit();
      
      console.log('\n' + '='.repeat(80));
      console.log('📊 DELETION SUMMARY:');
      console.log(`   Total records deleted: ${totalDeleted}`);
      console.log(`   Tables processed: ${deletionResults.length}`);
      console.log(`   Successful: ${deletionResults.filter(r => r.success).length}`);
      console.log(`   Failed: ${deletionResults.filter(r => !r.success).length}`);
      console.log('='.repeat(80));
      console.log('\n✅ Deletion completed successfully!\n');
      
      // Note: Company record itself is NOT deleted
      console.log('💡 Note: The company record itself was NOT deleted.');
      console.log('   If you want to delete the company, do it manually from the database.\n');
      
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

