#!/usr/bin/env node

/**
 * Copy initial setup data from reference company to Railway company
 * This script copies: stores, accounts, financial years, customer groups,
 * linked accounts, currencies, tax codes, adjustment reasons, return reasons,
 * payment methods, payment types
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

// Get command line arguments
const SOURCE_COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';
const TARGET_COMPANY_ID = process.argv[3] || '7f1bf1df-c79d-49f7-9c3c-a3e3565283a7';
const RAILWAY_DB_URL = process.argv[4] || process.env.DATABASE_URL;

if (!RAILWAY_DB_URL) {
  console.error('❌ DATABASE_URL or Railway database URL is required');
  console.error('Usage: node copy-initial-setup-to-railway.js [sourceCompanyId] [targetCompanyId] [railwayDbUrl]');
  process.exit(1);
}

// Parse DATABASE_URL
const dbUrl = new URL(RAILWAY_DB_URL);
const localSequelize = require('../config/database');
const railwaySequelize = new Sequelize(RAILWAY_DB_URL, {
  dialect: 'postgres',
  logging: false
});

// Tables to copy in dependency order
const TABLES_TO_COPY = [
  { name: 'stores', label: 'Stores', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'currencies', label: 'Currencies', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'accounts', label: 'Accounts', idColumn: 'id', companyColumn: 'companyId', parentColumn: 'parentId' },
  { name: 'financial_years', label: 'Financial Years', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'customer_groups', label: 'Customer Groups', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'tax_codes', label: 'Tax Codes', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'adjustment_reasons', label: 'Adjustment Reasons', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'return_reasons', label: 'Return Reasons', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'payment_methods', label: 'Payment Methods', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'payment_types', label: 'Payment Types', idColumn: 'id', companyColumn: 'companyId' },
  { name: 'linked_accounts', label: 'Linked Accounts', idColumn: 'id', companyColumn: 'companyId' }
];

/**
 * Get a user from the target company to use as created_by/updated_by
 */
async function getTargetCompanyUser(targetCompanyId, targetSequelize) {
  try {
    const [users] = await targetSequelize.query(
      `SELECT id FROM users WHERE "companyId" = :companyId LIMIT 1`,
      {
        replacements: { companyId: targetCompanyId },
        type: targetSequelize.QueryTypes.SELECT
      }
    );
    
    const userResult = Array.isArray(users) && users.length > 0 ? users[0] : users;
    return userResult?.id || null;
  } catch (error) {
    console.error('Error getting target company user:', error);
    return null;
  }
}

/**
 * Check if a foreign key reference exists in target database
 */
async function checkForeignKeyExists(
  targetSequelize,
  tableName,
  idColumn,
  idValue,
  companyColumn,
  targetCompanyId
) {
  try {
    const [results] = await targetSequelize.query(
      `SELECT ${idColumn} FROM "${tableName}" WHERE ${idColumn} = :idValue AND "${companyColumn}" = :companyId LIMIT 1`,
      {
        replacements: { idValue, companyId: targetCompanyId },
        type: targetSequelize.QueryTypes.SELECT
      }
    );
    
    const result = Array.isArray(results) && results.length > 0 ? results[0] : results;
    return result ? true : false;
  } catch (error) {
    return false;
  }
}

/**
 * Copy table data
 */
async function copyTableData(
  sourceSequelize,
  targetSequelize,
  tableConfig,
  sourceCompanyId,
  targetCompanyId,
  idMaps,
  targetUserId
) {
  const { name, label, idColumn, companyColumn, parentColumn } = tableConfig;
  
  try {
    // Get all records from source
    const [sourceRecords] = await sourceSequelize.query(
      `SELECT * FROM "${name}" WHERE "${companyColumn}" = :companyId`,
      {
        replacements: { companyId: sourceCompanyId },
        type: sourceSequelize.QueryTypes.SELECT
      }
    );
    
    const records = Array.isArray(sourceRecords) && sourceRecords.length > 0 && Array.isArray(sourceRecords[0])
      ? sourceRecords[0]
      : Array.isArray(sourceRecords) ? sourceRecords : [sourceRecords];
    
    if (records.length === 0) {
      console.log(`  ⚠️  No ${label} found for source company`);
      return { copied: 0, skipped: 0 };
    }
    
    let copied = 0;
    let skipped = 0;
    const newIdMap = new Map();
    
    for (const record of records) {
      try {
        // Get column names (excluding id, companyId, timestamps)
        const [columnInfo] = await sourceSequelize.query(
          `SELECT column_name, data_type, is_nullable 
           FROM information_schema.columns 
           WHERE table_name = :tableName 
           ORDER BY ordinal_position`,
          {
            replacements: { tableName: name },
            type: sourceSequelize.QueryTypes.SELECT
          }
        );
        
        const columns = Array.isArray(columnInfo) && columnInfo.length > 0 && Array.isArray(columnInfo[0])
          ? columnInfo[0]
          : Array.isArray(columnInfo) ? columnInfo : [columnInfo];
        
        const columnNames = columns
          .map(col => col.column_name)
          .filter(col => 
            col !== 'id' && 
            col !== 'created_at' && 
            col !== 'updated_at' &&
            col !== companyColumn
          );
        
        // Build INSERT statement
        const values = [];
        const placeholders = [];
        const replacements = {};
        
        let paramIndex = 0;
        
        // Always include id (UUID)
        placeholders.push(`:id${paramIndex}`);
        replacements[`id${paramIndex}`] = record[idColumn];
        paramIndex++;
        
        // Add companyId
        placeholders.push(`:companyId${paramIndex}`);
        replacements[`companyId${paramIndex}`] = targetCompanyId;
        paramIndex++;
        
        // Process other columns
        for (const colName of columnNames) {
          let value = record[colName];
          
          // Handle foreign key mappings
          if (colName === parentColumn && value && idMaps.has(name)) {
            const parentMap = idMaps.get(name);
            if (parentMap.has(value)) {
              value = parentMap.get(value);
            } else {
              value = null; // Parent not found, set to null
            }
          } else if (colName.includes('_id') || colName.endsWith('Id')) {
            // Check if this is a foreign key we need to map
            const fkTable = colName.replace(/_id$|Id$/, '');
            const fkTableName = fkTable === 'account' ? 'accounts' :
                              fkTable === 'currency' ? 'currencies' :
                              fkTable === 'store' ? 'stores' :
                              fkTable === 'accountReceivable' ? 'accounts' :
                              fkTable === 'defaultLiabilityAccount' ? 'accounts' :
                              fkTable === 'accountType' ? 'account_types' :
                              fkTable === 'parent' ? 'accounts' :
                              `${fkTable}s`;
            
            if (value && idMaps.has(fkTableName)) {
              const fkMap = idMaps.get(fkTableName);
              if (fkMap.has(value)) {
                value = fkMap.get(value);
              } else {
                // Check if reference exists in target
                const exists = await checkForeignKeyExists(
                  targetSequelize,
                  fkTableName,
                  'id',
                  value,
                  companyColumn,
                  targetCompanyId
                );
                if (!exists) {
                  value = null; // Reference doesn't exist, set to null
                }
              }
            } else if (value) {
              // Check if reference exists in target
              const exists = await checkForeignKeyExists(
                targetSequelize,
                fkTableName,
                'id',
                value,
                companyColumn,
                targetCompanyId
              );
              if (!exists) {
                value = null;
              }
            }
          }
          
          // Handle created_by/updated_by
          if (colName === 'created_by' || colName === 'createdBy' || 
              colName === 'updated_by' || colName === 'updatedBy') {
            value = targetUserId;
          }
          
          // Handle currency_id mapping for stores
          if (colName === 'default_currency_id' && value && idMaps.has('currencies')) {
            const currencyMap = idMaps.get('currencies');
            if (currencyMap.has(value)) {
              value = currencyMap.get(value);
            } else {
              value = null;
            }
          }
          
          placeholders.push(`:col${paramIndex}`);
          replacements[`col${paramIndex}`] = value;
          paramIndex++;
        }
        
        // Build column list
        const insertColumns = [idColumn, companyColumn, ...columnNames].map(col => `"${col}"`).join(', ');
        
        // Execute INSERT
        await targetSequelize.query(
          `INSERT INTO "${name}" (${insertColumns}) VALUES (${placeholders.join(', ')}) 
           ON CONFLICT (${idColumn}) DO NOTHING`,
          {
            replacements,
            type: targetSequelize.QueryTypes.INSERT
          }
        );
        
        newIdMap.set(record[idColumn], record[idColumn]); // Same ID
        copied++;
      } catch (error) {
        if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
          skipped++;
        } else {
          console.error(`  ❌ Error copying ${label} record ${record[idColumn]}:`, error.message);
          skipped++;
        }
      }
    }
    
    // Store ID map for this table
    if (!idMaps.has(name)) {
      idMaps.set(name, new Map());
    }
    newIdMap.forEach((newId, oldId) => {
      idMaps.get(name).set(oldId, newId);
    });
    
    return { copied, skipped };
  } catch (error) {
    console.error(`❌ Error copying ${label}:`, error.message);
    return { copied: 0, skipped: 0 };
  }
}

/**
 * Update parent relationships for accounts
 */
async function updateParentRelationships(
  sourceSequelize,
  targetSequelize,
  sourceCompanyId,
  targetCompanyId,
  accountMap
) {
  try {
    // Get all accounts with parent relationships from source
    const [sourceAccounts] = await sourceSequelize.query(
      `SELECT id, "parentId" FROM accounts WHERE "companyId" = :companyId AND "parentId" IS NOT NULL`,
      {
        replacements: { companyId: sourceCompanyId },
        type: sourceSequelize.QueryTypes.SELECT
      }
    );
    
    const accounts = Array.isArray(sourceAccounts) && sourceAccounts.length > 0 && Array.isArray(sourceAccounts[0])
      ? sourceAccounts[0]
      : Array.isArray(sourceAccounts) ? sourceAccounts : [sourceAccounts];
    
    let updated = 0;
    
    for (const account of accounts) {
      const sourceAccountId = account.id;
      const sourceParentId = account.parentId;
      
      if (accountMap.has(sourceAccountId) && accountMap.has(sourceParentId)) {
        const targetAccountId = accountMap.get(sourceAccountId);
        const targetParentId = accountMap.get(sourceParentId);
        
        await targetSequelize.query(
          `UPDATE accounts SET "parentId" = :parentId WHERE id = :accountId AND "companyId" = :companyId`,
          {
            replacements: { parentId: targetParentId, accountId: targetAccountId, companyId: targetCompanyId },
            type: targetSequelize.QueryTypes.UPDATE
          }
        );
        updated++;
      }
    }
    
    return updated;
  } catch (error) {
    console.error('❌ Error updating parent relationships:', error.message);
    return 0;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🚀 Starting Initial Setup Data Copy to Railway');
    console.log('='.repeat(80));
    console.log(`Source Company ID: ${SOURCE_COMPANY_ID}`);
    console.log(`Target Company ID: ${TARGET_COMPANY_ID}`);
    console.log(`Railway DB: ${dbUrl.hostname}:${dbUrl.port}`);
    console.log('');
    
    // Test connections
    console.log('📡 Testing database connections...');
    await localSequelize.authenticate();
    console.log('  ✅ Local database connected');
    
    await railwaySequelize.authenticate();
    console.log('  ✅ Railway database connected');
    console.log('');
    
    // Get target company user
    console.log('👤 Getting target company user...');
    const targetUserId = await getTargetCompanyUser(TARGET_COMPANY_ID, railwaySequelize);
    if (!targetUserId) {
      console.error('❌ No user found for target company. Please ensure the company has at least one user.');
      process.exit(1);
    }
    console.log(`  ✅ Using user: ${targetUserId}`);
    console.log('');
    
    // ID maps for foreign key relationships
    const idMaps = new Map();
    
    // Copy tables in order
    console.log('📋 Copying initial setup data...');
    console.log('-'.repeat(80));
    
    let totalCopied = 0;
    let totalSkipped = 0;
    
    for (const tableConfig of TABLES_TO_COPY) {
      console.log(`\n📦 Copying ${tableConfig.label}...`);
      const result = await copyTableData(
        localSequelize,
        railwaySequelize,
        tableConfig,
        SOURCE_COMPANY_ID,
        TARGET_COMPANY_ID,
        idMaps,
        targetUserId
      );
      
      totalCopied += result.copied;
      totalSkipped += result.skipped;
      
      console.log(`  ✅ Copied: ${result.copied}, Skipped: ${result.skipped}`);
    }
    
    // Update parent relationships for accounts
    if (idMaps.has('accounts')) {
      console.log('\n🔗 Updating account parent relationships...');
      const accountMap = idMaps.get('accounts');
      const updated = await updateParentRelationships(
        localSequelize,
        railwaySequelize,
        SOURCE_COMPANY_ID,
        TARGET_COMPANY_ID,
        accountMap
      );
      console.log(`  ✅ Updated ${updated} parent relationships`);
    }
    
    // Update linked accounts with mapped account IDs
    if (idMaps.has('linked_accounts') && idMaps.has('accounts')) {
      console.log('\n🔗 Updating linked accounts with mapped account IDs...');
      const accountMap = idMaps.get('accounts');
      
      // Get all linked accounts from target
      const [linkedAccounts] = await railwaySequelize.query(
        `SELECT id, account_id FROM linked_accounts WHERE "companyId" = :companyId AND account_id IS NOT NULL`,
        {
          replacements: { companyId: TARGET_COMPANY_ID },
          type: railwaySequelize.QueryTypes.SELECT
        }
      );
      
      const linked = Array.isArray(linkedAccounts) && linkedAccounts.length > 0 && Array.isArray(linkedAccounts[0])
        ? linkedAccounts[0]
        : Array.isArray(linkedAccounts) ? linkedAccounts : [linkedAccounts];
      
      let updated = 0;
      for (const linkedAccount of linked) {
        // Get the original account ID from source
        const [sourceLinked] = await localSequelize.query(
          `SELECT account_id FROM linked_accounts WHERE id = :id`,
          {
            replacements: { id: linkedAccount.id },
            type: localSequelize.QueryTypes.SELECT
          }
        );
        
        const source = Array.isArray(sourceLinked) && sourceLinked.length > 0 && Array.isArray(sourceLinked[0])
          ? sourceLinked[0]
          : Array.isArray(sourceLinked) ? sourceLinked[0] : sourceLinked;
        
        if (source?.account_id && accountMap.has(source.account_id)) {
          const mappedAccountId = accountMap.get(source.account_id);
          await railwaySequelize.query(
            `UPDATE linked_accounts SET account_id = :accountId WHERE id = :id`,
            {
              replacements: { accountId: mappedAccountId, id: linkedAccount.id },
              type: railwaySequelize.QueryTypes.UPDATE
            }
          );
          updated++;
        }
      }
      console.log(`  ✅ Updated ${updated} linked account references`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Initial setup data copy completed!');
    console.log(`📊 Summary: ${totalCopied} records copied, ${totalSkipped} skipped`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
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

