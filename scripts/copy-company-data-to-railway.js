#!/usr/bin/env node

/**
 * Copy company data from local database to Railway database
 * Usage: node scripts/copy-company-data-to-railway.js <sourceCompanyId> <targetCompanyId> <railwayDatabaseUrl>
 */

require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');
const readline = require('readline');

// Get command line arguments
const SOURCE_COMPANY_ID = process.argv[2];
const TARGET_COMPANY_ID = process.argv[3] || SOURCE_COMPANY_ID; // Default to same company ID
const RAILWAY_DATABASE_URL = process.argv[4] || process.env.RAILWAY_DATABASE_URL;

if (!SOURCE_COMPANY_ID) {
  console.error('❌ Error: Source Company ID is required');
  console.log('Usage: node scripts/copy-company-data-to-railway.js <sourceCompanyId> [targetCompanyId] [railwayDatabaseUrl]');
  process.exit(1);
}

if (!RAILWAY_DATABASE_URL) {
  console.error('❌ Error: Railway DATABASE_URL is required');
  console.log('Please provide it as:');
  console.log('  1. Command line argument: node scripts/copy-company-data-to-railway.js <sourceCompanyId> <targetCompanyId> <railwayDatabaseUrl>');
  console.log('  2. Environment variable: RAILWAY_DATABASE_URL');
  process.exit(1);
}

// Local database connection
const localSequelize = require('../config/database');

// Railway database connection
let railwaySequelize;
try {
  railwaySequelize = new Sequelize(RAILWAY_DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Railway uses self-signed certificates
      }
    }
  });
} catch (error) {
  console.error('❌ Error creating Railway database connection:', error.message);
  process.exit(1);
}

// Tables to copy (in dependency order - dependencies first)
const TABLES_TO_COPY = [
  // Core setup data (no dependencies)
  'stores',
  'users',
  'accounts',
  'financial_years',
  
  // Customer related
  'customer_groups',
  
  // Linked accounts (depends on accounts and users)
  'linked_accounts',
  
  // Reference data (no dependencies)
  'product_brand_names',
  'product_manufacturers',
  'product_models',
  'product_colors',
  'product_store_locations',
  
  // Main product table
  'products',
  
  // Product child tables
  'product_serial_numbers',
  'product_expiry_dates',
  'product_transactions',
  'product_price_categories',
  'product_raw_materials',
  'product_dosages',
  'product_stores',
  'price_histories',
  
  // Customer related
  'customers',
  
  // Sales related
  'sales_agents',
  'proforma_invoices',
  'proforma_invoice_items',
  'sales_orders',
  'sales_order_items',
  'sales_invoices',
  'sales_invoice_items',
  'customer_deposits',
  
  // Inventory related
  'physical_inventories',
  'physical_inventory_items',
  'stock_adjustments',
  'stock_adjustment_items',
  'store_requests',
  'store_request_items',
  'store_request_item_transactions',
  
  // Financial
  'openingBalances',
  'general_ledger',
  'transactions',
];

async function checkCompanyExists(sequelize, companyId, dbName) {
  try {
    const result = await sequelize.query(
      `SELECT id, name, email FROM "Company" WHERE id = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.SELECT
      }
    );
    
    const companies = Array.isArray(result) && result.length > 0 && Array.isArray(result[0])
      ? result[0]
      : result;
    
    if (Array.isArray(companies) && companies.length > 0) {
      return companies[0];
    }
    return companies || null;
  } catch (error) {
    console.error(`❌ Error checking company in ${dbName}:`, error.message);
    return null;
  }
}

async function countRecords(sequelize, tableName, companyIdColumn, companyId) {
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
    return -1;
  }
}

async function copyTableData(sourceSequelize, targetSequelize, tableName, sourceCompanyId, targetCompanyId) {
  try {
    // Get all records from source
    const recordsResult = await sourceSequelize.query(
      `SELECT * FROM "${tableName}" WHERE "companyId" = :companyId`,
      {
        replacements: { companyId: sourceCompanyId },
        type: QueryTypes.SELECT
      }
    );
    
    // Handle different result formats
    const records = Array.isArray(recordsResult) && recordsResult.length > 0 && Array.isArray(recordsResult[0])
      ? recordsResult[0]
      : Array.isArray(recordsResult) ? recordsResult : [recordsResult];
    
    if (!records || records.length === 0 || (records.length === 1 && !records[0])) {
      return { success: true, copied: 0, skipped: 0 };
    }
    
    let copied = 0;
    let skipped = 0;
    
    // Insert records into target with new companyId
    for (const record of records) {
      if (!record) continue;
      
      try {
        // Build column names and values, excluding only companyId (keep id to maintain relationships)
        const columns = Object.keys(record).filter(col => col !== 'companyId');
        const columnNames = columns.map(col => `"${col}"`).join(', ');
        
        // Build named placeholders and replacements
        const placeholders = columns.map((col, idx) => `:col${idx}`).join(', ');
        const replacements = {};
        columns.forEach((col, idx) => {
          replacements[`col${idx}`] = record[col];
        });
        replacements.targetCompanyId = targetCompanyId;
        
        // For foreign key columns that might not exist in target, check and use fallback if needed
        // This handles cases where created_by, updated_by, account_id, etc. reference records that don't exist
        const nullableFkColumns = ['created_by', 'updated_by', 'account_id', 'account_receivable_id', 'default_receivable_account_id'];
        
        // Get a fallback user from target company (cache it to avoid repeated queries)
        let fallbackUserId = null;
        const getFallbackUser = async () => {
          if (fallbackUserId) return fallbackUserId;
          const userResult = await targetSequelize.query(
            `SELECT id FROM "users" WHERE "companyId" = :targetCompanyId LIMIT 1`,
            { replacements: { targetCompanyId }, type: QueryTypes.SELECT }
          );
          const user = Array.isArray(userResult) && userResult.length > 0 && Array.isArray(userResult[0])
            ? userResult[0]
            : Array.isArray(userResult) ? userResult[0] : userResult;
          if (user && user.id) {
            fallbackUserId = user.id;
            return fallbackUserId;
          }
          return null;
        };
        
        for (const fkCol of nullableFkColumns) {
          if (columns.includes(fkCol) && record[fkCol]) {
            // Check if the referenced record exists in target
            let exists = false;
            if (fkCol.includes('user') || fkCol === 'created_by' || fkCol === 'updated_by') {
              const checkResult = await targetSequelize.query(
                `SELECT COUNT(*) as count FROM "users" WHERE "id" = :fkId`,
                { replacements: { fkId: record[fkCol] }, type: QueryTypes.SELECT }
              );
              exists = (Array.isArray(checkResult) && checkResult[0]?.count > 0) || (checkResult?.count > 0);
              
              if (!exists) {
                // Use fallback user from target company
                const fallbackUser = await getFallbackUser();
                if (fallbackUser) {
                  const colIndex = columns.indexOf(fkCol);
                  if (colIndex >= 0) {
                    replacements[`col${colIndex}`] = fallbackUser;
                  }
                } else {
                  // If no fallback user found and column is nullable, set to NULL
                  const colIndex = columns.indexOf(fkCol);
                  if (colIndex >= 0) {
                    replacements[`col${colIndex}`] = null;
                  }
                }
              }
            } else if (fkCol.includes('account')) {
              const checkResult = await targetSequelize.query(
                `SELECT COUNT(*) as count FROM "accounts" WHERE "id" = :fkId AND "companyId" = :targetCompanyId`,
                { replacements: { fkId: record[fkCol], targetCompanyId }, type: QueryTypes.SELECT }
              );
              exists = (Array.isArray(checkResult) && checkResult[0]?.count > 0) || (checkResult?.count > 0);
              
              if (!exists) {
                // Set to NULL if referenced account doesn't exist
                const colIndex = columns.indexOf(fkCol);
                if (colIndex >= 0) {
                  replacements[`col${colIndex}`] = null;
                }
              }
            }
          }
        }
        
        // Use parameterized query with named parameters
        const query = `INSERT INTO "${tableName}" (${columnNames}, "companyId") VALUES (${placeholders}, :targetCompanyId) ON CONFLICT DO NOTHING`;
        
        await targetSequelize.query(query, {
          replacements: replacements,
          type: QueryTypes.INSERT
        });
        copied++;
      } catch (error) {
        // Check if it's a duplicate/unique constraint error
        if (error.message && (
          error.message.includes('duplicate') || 
          error.message.includes('unique') ||
          error.message.includes('violates unique constraint')
        )) {
          skipped++;
        } else {
          // Log unexpected errors but continue
          console.log(`    ⚠️  Warning for record: ${error.message}`);
          skipped++;
        }
      }
    }
    
    return { success: true, copied, skipped };
  } catch (error) {
    return { success: false, error: error.message, copied: 0, skipped: 0 };
  }
}

async function main() {
  try {
    // Connect to both databases
    console.log('🔌 Connecting to databases...');
    await localSequelize.authenticate();
    console.log('  ✅ Local database connected');
    
    await railwaySequelize.authenticate();
    console.log('  ✅ Railway database connected\n');
    
    // Check source company exists
    console.log('🔍 Checking source company...');
    const sourceCompany = await checkCompanyExists(localSequelize, SOURCE_COMPANY_ID, 'local');
    if (!sourceCompany) {
      console.error(`❌ Source company ${SOURCE_COMPANY_ID} not found in local database`);
      process.exit(1);
    }
    console.log(`  ✅ Found: ${sourceCompany.name} (${sourceCompany.email})\n`);
    
    // Check target company exists
    console.log('🔍 Checking target company...');
    const targetCompany = await checkCompanyExists(railwaySequelize, TARGET_COMPANY_ID, 'Railway');
    if (!targetCompany) {
      console.error(`❌ Target company ${TARGET_COMPANY_ID} not found in Railway database`);
      console.log('  💡 Please create the company in Railway first or use an existing company ID');
      process.exit(1);
    }
    console.log(`  ✅ Found: ${targetCompany.name} (${targetCompany.email})\n`);
    
    // Count records to copy
    console.log('📊 Counting records to copy...');
    let totalRecords = 0;
    const tableCounts = [];
    
    for (const tableName of TABLES_TO_COPY) {
      const count = await countRecords(localSequelize, tableName, 'companyId', SOURCE_COMPANY_ID);
      if (count > 0) {
        tableCounts.push({ table: tableName, count });
        totalRecords += count;
      }
    }
    
    if (totalRecords === 0) {
      console.log('  ⚠️  No data found for source company. Nothing to copy.\n');
      process.exit(0);
    }
    
    console.log(`  📋 Found ${totalRecords} records across ${tableCounts.length} tables\n`);
    
    // Confirm before proceeding
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('⚠️  WARNING: This will copy data from LOCAL to RAILWAY!');
    console.log(`   Source: ${sourceCompany.name} (Local)`);
    console.log(`   Target: ${targetCompany.name} (Railway)`);
    console.log(`   Total records: ${totalRecords}`);
    console.log(`   Tables: ${tableCounts.length}\n`);
    
    const answer = await new Promise((resolve) => {
      rl.question('Are you sure you want to proceed? Type "COPY" to confirm: ', (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });
    
    if (answer !== 'COPY') {
      console.log('\n❌ Operation cancelled.');
      process.exit(0);
    }
    
    console.log('\n📦 COPYING DATA...');
    console.log('='.repeat(80));
    
    let totalCopied = 0;
    let totalSkipped = 0;
    const results = [];
    
    for (const { table, count } of tableCounts) {
      console.log(`\n📋 Copying ${table} (${count} records)...`);
      const result = await copyTableData(localSequelize, railwaySequelize, table, SOURCE_COMPANY_ID, TARGET_COMPANY_ID);
      
      if (result.success) {
        totalCopied += result.copied;
        totalSkipped += result.skipped;
        results.push({ table, ...result });
        console.log(`  ✅ Copied: ${result.copied}, Skipped: ${result.skipped}`);
      } else {
        results.push({ table, ...result });
        console.log(`  ❌ Error: ${result.error}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 COPY SUMMARY:');
    console.log(`   Total records copied: ${totalCopied}`);
    console.log(`   Total records skipped: ${totalSkipped}`);
    console.log(`   Tables processed: ${results.length}`);
    console.log('='.repeat(80));
    
    console.log('\n✅ Data copy completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

