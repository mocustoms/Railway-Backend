#!/usr/bin/env node

/**
 * Compare Local and Railway Database Schemas
 * 
 * Compares the local database schema with Railway database schema
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const readline = require('readline');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function getTableColumns(sequelize, tableName) {
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
  // Handle nested array result
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

async function getTables(sequelize) {
  const tables = await sequelize.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
     AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    { type: QueryTypes.SELECT }
  );
  // Handle nested array result
  const tablesArray = Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0])
    ? tables[0]
    : tables;
  return tablesArray.map(t => t.table_name);
}

async function main() {
  // Get Railway database URL
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  // Connect to local database
  const localSequelize = require('../config/database');
  
  // Connect to Railway database
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔍 COMPARING LOCAL vs RAILWAY DATABASE SCHEMAS\n');
    console.log('='.repeat(80));
    
    // Test connections
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Get tables from both databases
    const localTables = await getTables(localSequelize);
    const railwayTables = await getTables(railwaySequelize);
    
    console.log(`📊 Local tables: ${localTables.length}`);
    console.log(`📊 Railway tables: ${railwayTables.length}\n`);

    // Find missing tables
    const missingInRailway = localTables.filter(t => !railwayTables.includes(t));
    const extraInRailway = railwayTables.filter(t => !localTables.includes(t));

    if (missingInRailway.length > 0) {
      console.log('❌ Tables missing in Railway:');
      missingInRailway.forEach(t => console.log(`   - ${t}`));
      console.log('');
    }

    if (extraInRailway.length > 0) {
      console.log('⚠️  Extra tables in Railway (not in local):');
      extraInRailway.forEach(t => console.log(`   - ${t}`));
      console.log('');
    }

    // Compare columns for common tables
    const commonTables = localTables.filter(t => railwayTables.includes(t));
    console.log(`\n📋 Comparing columns in ${commonTables.length} common tables...\n`);

    let totalDifferences = 0;
    const differences = [];

    for (const table of commonTables) {
      const localColumns = await getTableColumns(localSequelize, table);
      const railwayColumns = await getTableColumns(railwaySequelize, table);

      const localColMap = new Map(localColumns.map(c => [c.column_name, c]));
      const railwayColMap = new Map(railwayColumns.map(c => [c.column_name, c]));

      const missingInRailway = localColumns.filter(c => !railwayColMap.has(c.column_name));
      const extraInRailway = railwayColumns.filter(c => !localColMap.has(c.column_name));
      
      // Check for column property differences
      const columnDifferences = [];
      for (const [colName, localCol] of localColMap) {
        if (railwayColMap.has(colName)) {
          const railwayCol = railwayColMap.get(colName);
          const diffs = [];
          
          // Compare data type
          if (localCol.data_type !== railwayCol.data_type || localCol.udt_name !== railwayCol.udt_name) {
            diffs.push({
              property: 'data_type',
              local: `${localCol.data_type} (${localCol.udt_name})`,
              railway: `${railwayCol.data_type} (${railwayCol.udt_name})`
            });
          }
          
          // Compare nullable
          if (localCol.is_nullable !== railwayCol.is_nullable) {
            diffs.push({
              property: 'is_nullable',
              local: localCol.is_nullable,
              railway: railwayCol.is_nullable
            });
          }
          
          // Compare default (normalize for comparison)
          const normalizeDefault = (def) => {
            if (!def) return null;
            // Remove ::type casts and quotes for comparison
            return def.replace(/::\w+/g, '').replace(/^'|'$/g, '');
          };
          if (normalizeDefault(localCol.column_default) !== normalizeDefault(railwayCol.column_default)) {
            diffs.push({
              property: 'column_default',
              local: localCol.column_default || 'NULL',
              railway: railwayCol.column_default || 'NULL'
            });
          }
          
          // Compare character length
          if (localCol.character_maximum_length !== railwayCol.character_maximum_length) {
            diffs.push({
              property: 'character_maximum_length',
              local: localCol.character_maximum_length || 'NULL',
              railway: railwayCol.character_maximum_length || 'NULL'
            });
          }
          
          // Compare numeric precision
          if (localCol.numeric_precision !== railwayCol.numeric_precision) {
            diffs.push({
              property: 'numeric_precision',
              local: localCol.numeric_precision || 'NULL',
              railway: railwayCol.numeric_precision || 'NULL'
            });
          }
          
          // Compare numeric scale
          if (localCol.numeric_scale !== railwayCol.numeric_scale) {
            diffs.push({
              property: 'numeric_scale',
              local: localCol.numeric_scale || 'NULL',
              railway: railwayCol.numeric_scale || 'NULL'
            });
          }
          
          if (diffs.length > 0) {
            columnDifferences.push({ column: colName, differences: diffs });
          }
        }
      }

      if (missingInRailway.length > 0 || extraInRailway.length > 0 || columnDifferences.length > 0) {
        totalDifferences++;
        differences.push({
          table,
          missing: missingInRailway.map(c => c.column_name),
          extra: extraInRailway.map(c => c.column_name),
          columnDifferences
        });
      }
    }

    if (totalDifferences === 0) {
      console.log('✅ All common tables have matching columns and column properties!\n');
    } else {
      console.log(`\n⚠️  Found differences in ${totalDifferences} tables:\n`);
      
      differences.forEach(({ table, missing, extra, columnDifferences }) => {
        console.log(`\n📋 Table: ${table}`);
        console.log('-'.repeat(80));
        
        if (missing.length > 0) {
          console.log(`❌ Missing columns in Railway (${missing.length}):`);
          missing.forEach(col => console.log(`   - ${col}`));
        }
        if (extra.length > 0) {
          console.log(`⚠️  Extra columns in Railway (${extra.length}):`);
          extra.forEach(col => console.log(`   - ${col}`));
        }
        if (columnDifferences && columnDifferences.length > 0) {
          console.log(`⚠️  Column property differences (${columnDifferences.length} columns):`);
          columnDifferences.forEach(({ column, differences: diffs }) => {
            console.log(`   Column: ${column}`);
            diffs.forEach(diff => {
              console.log(`     - ${diff.property}:`);
              console.log(`       Local:    ${diff.local}`);
              console.log(`       Railway:  ${diff.railway}`);
            });
          });
        }
        console.log('');
      });
    }

    // Summary
    console.log('='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log(`   Local tables: ${localTables.length}`);
    console.log(`   Railway tables: ${railwayTables.length}`);
    console.log(`   Common tables: ${commonTables.length}`);
    console.log(`   Missing in Railway: ${missingInRailway.length} tables`);
    console.log(`   Column differences: ${totalDifferences} tables`);
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

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

