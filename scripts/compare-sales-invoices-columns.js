#!/usr/bin/env node

/**
 * Compare sales_invoices table columns between Local and Railway
 */

require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');

function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  let normalizedUrl = databaseUrl.trim().replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalizedUrl);
  const databaseName = url.pathname ? url.pathname.slice(1) : '';
  if (!databaseName) throw new Error('Database name not found');
  
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: databaseName,
    username: url.username || 'postgres',
    password: url.password || ''
  };
}

async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(
    `SELECT 
      column_name, 
      data_type, 
      udt_name,
      is_nullable, 
      column_default,
      character_maximum_length
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = :tableName
     ORDER BY ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  if (!railwayDbUrl) {
    console.error('❌ Railway DATABASE_URL required');
    console.log('Usage: node scripts/compare-sales-invoices-columns.js [railway-db-url]');
    process.exit(1);
  }

  const localSequelize = require('../config/database');
  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    }
  });

  try {
    console.log('\n🔍 COMPARING sales_invoices TABLE COLUMNS: LOCAL vs RAILWAY\n');
    console.log('='.repeat(100));
    
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    const localColumns = await getTableColumns(localSequelize, 'sales_invoices');
    const railwayColumns = await getTableColumns(railwaySequelize, 'sales_invoices');

    const localColMap = new Map(localColumns.map(c => [c.column_name, c]));
    const railwayColMap = new Map(railwayColumns.map(c => [c.column_name, c]));

    const allColumns = [...new Set([...localColumns.map(c => c.column_name), ...railwayColumns.map(c => c.column_name)])].sort();

    console.log(`📊 Total columns: Local=${localColumns.length}, Railway=${railwayColumns.length}\n`);

    // Check for recurring/scheduled columns specifically
    const recurringColumns = [
      'scheduled_type',
      'recurring_period',
      'scheduled_date',
      'recurring_day_of_week',
      'recurring_date',
      'recurring_month',
      'start_time',
      'end_time'
    ];

    console.log('🔍 RECURRING/SCHEDULED COLUMNS CHECK:');
    console.log('-'.repeat(100));
    let allPresent = true;
    for (const colName of recurringColumns) {
      const inLocal = localColMap.has(colName);
      const inRailway = railwayColMap.has(colName);
      
      if (inLocal && inRailway) {
        const localCol = localColMap.get(colName);
        const railwayCol = railwayColMap.get(colName);
        const typeMatch = localCol.data_type === railwayCol.data_type || localCol.udt_name === railwayCol.udt_name;
        const nullableMatch = localCol.is_nullable === railwayCol.is_nullable;
        
        if (typeMatch && nullableMatch) {
          console.log(`  ✅ ${colName.padEnd(25)} - Present in both (Type: ${localCol.udt_name || localCol.data_type}, Nullable: ${localCol.is_nullable})`);
        } else {
          console.log(`  ⚠️  ${colName.padEnd(25)} - Present but type/nullable mismatch`);
          console.log(`     Local:   ${localCol.data_type} (${localCol.udt_name}), nullable=${localCol.is_nullable}`);
          console.log(`     Railway: ${railwayCol.data_type} (${railwayCol.udt_name}), nullable=${railwayCol.is_nullable}`);
          allPresent = false;
        }
      } else if (inLocal && !inRailway) {
        console.log(`  ❌ ${colName.padEnd(25)} - Missing in Railway`);
        allPresent = false;
      } else if (!inLocal && inRailway) {
        console.log(`  ⚠️  ${colName.padEnd(25)} - Extra in Railway (not in local)`);
        allPresent = false;
      } else {
        console.log(`  ❌ ${colName.padEnd(25)} - Missing in both!`);
        allPresent = false;
      }
    }

    console.log('\n📋 ALL COLUMNS COMPARISON:');
    console.log('-'.repeat(100));
    console.log('Column Name'.padEnd(30) + 'Local'.padEnd(15) + 'Railway'.padEnd(15) + 'Type Match'.padEnd(15) + 'Status');
    console.log('-'.repeat(100));

    let differences = 0;
    for (const colName of allColumns) {
      const localCol = localColMap.get(colName);
      const railwayCol = railwayColMap.get(colName);
      
      const inLocal = !!localCol;
      const inRailway = !!railwayCol;
      
      let status = '';
      let typeMatch = 'N/A';
      
      if (inLocal && inRailway) {
        const typesMatch = localCol.data_type === railwayCol.data_type || localCol.udt_name === railwayCol.udt_name;
        const nullableMatch = localCol.is_nullable === railwayCol.is_nullable;
        typeMatch = typesMatch ? '✅' : '❌';
        status = typesMatch && nullableMatch ? '✅ Match' : '⚠️  Mismatch';
        if (!typesMatch || !nullableMatch) differences++;
      } else if (inLocal && !inRailway) {
        status = '❌ Missing Railway';
        differences++;
      } else if (!inLocal && inRailway) {
        status = '⚠️  Extra in Railway';
        differences++;
      }
      
      const localType = localCol ? (localCol.udt_name || localCol.data_type) : 'N/A';
      const railwayType = railwayCol ? (railwayCol.udt_name || railwayCol.data_type) : 'N/A';
      
      console.log(
        colName.padEnd(30) + 
        (inLocal ? '✅' : '❌').padEnd(15) + 
        (inRailway ? '✅' : '❌').padEnd(15) + 
        typeMatch.padEnd(15) + 
        status
      );
    }

    console.log('\n' + '='.repeat(100));
    console.log('📊 SUMMARY:');
    console.log(`   Total columns: ${allColumns.length}`);
    console.log(`   Differences: ${differences}`);
    console.log(`   Recurring/Scheduled columns: ${allPresent ? '✅ All present and matching' : '❌ Issues found'}`);
    console.log('='.repeat(100));
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
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

