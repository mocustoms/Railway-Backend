#!/usr/bin/env node

/**
 * Detailed Schema Comparison: Local vs Railway
 * 
 * Compares column types, constraints, foreign keys, indexes, and defaults
 * between local and Railway databases
 */

require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');
const readline = require('readline');
const { getRailwayDatabaseUrl, parseDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function getDetailedTableInfo(sequelize, tableName) {
  // Get columns with full details
  const columns = await sequelize.query(
    `SELECT 
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = :tableName
     ORDER BY ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  
  // Get foreign keys
  const foreignKeys = await sequelize.query(
    `SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage AS ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
     AND tc.table_name = :tableName
     AND tc.table_schema = 'public'`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  
  // Get indexes
  const indexes = await sequelize.query(
    `SELECT
      indexname,
      indexdef
     FROM pg_indexes
     WHERE tablename = :tableName
     AND schemaname = 'public'`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  
  // Get constraints
  const constraints = await sequelize.query(
    `SELECT
      constraint_name,
      constraint_type
     FROM information_schema.table_constraints
     WHERE table_name = :tableName
     AND table_schema = 'public'`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  
  return {
    columns: Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0]) ? columns[0] : columns,
    foreignKeys: Array.isArray(foreignKeys) && foreignKeys.length > 0 && Array.isArray(foreignKeys[0]) ? foreignKeys[0] : foreignKeys,
    indexes: Array.isArray(indexes) && indexes.length > 0 && Array.isArray(indexes[0]) ? indexes[0] : indexes,
    constraints: Array.isArray(constraints) && constraints.length > 0 && Array.isArray(constraints[0]) ? constraints[0] : constraints
  };
}

async function compareSchemas() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    await localSequelize.authenticate();
    await railwaySequelize.authenticate();
    
    console.log('\n🔍 DETAILED SCHEMA COMPARISON: LOCAL vs RAILWAY\n');
    console.log('='.repeat(80));
    
    // Get tables
    const localTables = await localSequelize.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      { type: QueryTypes.SELECT }
    );
    const railwayTables = await railwaySequelize.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      { type: QueryTypes.SELECT }
    );
    
    const localTableNames = Array.isArray(localTables) && localTables.length > 0 && Array.isArray(localTables[0])
      ? localTables[0].map(t => t.table_name)
      : localTables.map(t => t.table_name);
    const railwayTableNames = Array.isArray(railwayTables) && railwayTables.length > 0 && Array.isArray(railwayTables[0])
      ? railwayTables[0].map(t => t.table_name)
      : railwayTables.map(t => t.table_name);
    
    const commonTables = localTableNames.filter(t => railwayTableNames.includes(t));
    
    console.log(`📊 Comparing ${commonTables.length} common tables...\n`);
    
    let issues = 0;
    const keyTables = ['sales_orders', 'sales_order_items', 'sales_invoices', 'sales_invoice_items', 'customers'];
    
    for (const table of keyTables) {
      if (!commonTables.includes(table)) {
        console.log(`⚠️  ${table}: Not found in both databases`);
        continue;
      }
      
      console.log(`\n📋 ${table}:`);
      console.log('-'.repeat(80));
      
      const localInfo = await getDetailedTableInfo(localSequelize, table);
      const railwayInfo = await getDetailedTableInfo(railwaySequelize, table);
      
      // Compare columns
      const localCols = new Map(localInfo.columns.map(c => [c.column_name, c]));
      const railwayCols = new Map(railwayInfo.columns.map(c => [c.column_name, c]));
      
      let tableIssues = 0;
      
      // Check for missing columns
      for (const [colName, localCol] of localCols) {
        if (!railwayCols.has(colName)) {
          console.log(`  ❌ Column missing in Railway: ${colName}`);
          tableIssues++;
        } else {
          const railwayCol = railwayCols.get(colName);
          // Compare data types
          if (localCol.data_type !== railwayCol.data_type || localCol.udt_name !== railwayCol.udt_name) {
            console.log(`  ⚠️  ${colName}: Type mismatch`);
            console.log(`     Local: ${localCol.data_type} (${localCol.udt_name})`);
            console.log(`     Railway: ${railwayCol.data_type} (${railwayCol.udt_name})`);
            tableIssues++;
          }
          // Compare nullable
          if (localCol.is_nullable !== railwayCol.is_nullable) {
            console.log(`  ⚠️  ${colName}: Nullable mismatch`);
            console.log(`     Local: ${localCol.is_nullable}`);
            console.log(`     Railway: ${railwayCol.is_nullable}`);
            tableIssues++;
          }
        }
      }
      
      // Check for extra columns in Railway
      for (const [colName] of railwayCols) {
        if (!localCols.has(colName)) {
          console.log(`  ⚠️  Extra column in Railway: ${colName}`);
          tableIssues++;
        }
      }
      
      // Compare foreign keys count
      if (localInfo.foreignKeys.length !== railwayInfo.foreignKeys.length) {
        console.log(`  ⚠️  Foreign key count mismatch`);
        console.log(`     Local: ${localInfo.foreignKeys.length}`);
        console.log(`     Railway: ${railwayInfo.foreignKeys.length}`);
        tableIssues++;
      }
      
      // Compare indexes count
      if (localInfo.indexes.length !== railwayInfo.indexes.length) {
        console.log(`  ⚠️  Index count mismatch`);
        console.log(`     Local: ${localInfo.indexes.length}`);
        console.log(`     Railway: ${railwayInfo.indexes.length}`);
        tableIssues++;
      }
      
      if (tableIssues === 0) {
        console.log(`  ✅ All columns, types, and constraints match`);
        console.log(`     Columns: ${localInfo.columns.length}, Foreign Keys: ${localInfo.foreignKeys.length}, Indexes: ${localInfo.indexes.length}`);
      } else {
        issues += tableIssues;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    if (issues === 0) {
      console.log('✅ SCHEMA VERIFICATION PASSED');
      console.log('   All key tables have matching columns, types, and constraints');
    } else {
      console.log(`⚠️  SCHEMA VERIFICATION FOUND ${issues} ISSUES`);
      console.log('   Review the differences above');
    }
    console.log('='.repeat(80));
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

compareSchemas().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

