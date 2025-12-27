#!/usr/bin/env node

/**
 * Verify Key Tables Schema Details
 * Checks column types, constraints, and structure for key tables
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

async function verifyTable(sequelize, tableName, label) {
  console.log(`\n📋 ${label} - ${tableName}:`);
  console.log('-'.repeat(80));
  
  // Check if table exists
  const [tableCheck] = await sequelize.query(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = :tableName
    )`,
    { replacements: { tableName }, type: QueryTypes.SELECT }
  );
  
  const exists = Array.isArray(tableCheck) && tableCheck.length > 0 
    ? tableCheck[0].exists 
    : tableCheck.exists;
  
  if (!exists) {
    console.log('  ❌ Table does not exist');
    return false;
  }
  
  console.log('  ✅ Table exists');
  
  // Get columns
  const columns = await sequelize.query(
    `SELECT 
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = :tableName
     ORDER BY ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  
  const cols = Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
  
  console.log(`  📊 Columns (${cols.length}):`);
  cols.forEach(col => {
    const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
    console.log(`     - ${col.column_name}: ${col.data_type} (${col.udt_name}) ${nullable}${defaultVal}`);
  });
  
  // Get foreign keys
  const fks = await sequelize.query(
    `SELECT
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
  
  const foreignKeys = Array.isArray(fks) && fks.length > 0 && Array.isArray(fks[0])
    ? fks[0]
    : fks;
  
  console.log(`  🔗 Foreign Keys (${foreignKeys.length}):`);
  foreignKeys.forEach(fk => {
    console.log(`     - ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
  });
  
  // Get indexes
  const idxs = await sequelize.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE tablename = :tableName
     AND schemaname = 'public'`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  
  const indexes = Array.isArray(idxs) && idxs.length > 0 && Array.isArray(idxs[0])
    ? idxs[0]
    : idxs;
  
  console.log(`  📇 Indexes (${indexes.length}):`);
  indexes.forEach(idx => {
    console.log(`     - ${idx.indexname}`);
  });
  
  return true;
}

async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Railway DATABASE_URL required');
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
    await localSequelize.authenticate();
    await railwaySequelize.authenticate();
    
    console.log('\n🔍 VERIFYING KEY TABLES SCHEMA DETAILS\n');
    console.log('='.repeat(80));
    
    const keyTables = [
      { name: 'sales_orders', label: 'Sales Orders' },
      { name: 'sales_order_items', label: 'Sales Order Items' },
      { name: 'sales_invoices', label: 'Sales Invoices' },
      { name: 'sales_invoice_items', label: 'Sales Invoice Items' },
      { name: 'customers', label: 'Customers' }
    ];
    
    console.log('\n📍 LOCAL DATABASE:');
    for (const table of keyTables) {
      await verifyTable(localSequelize, table.name, `LOCAL - ${table.label}`);
    }
    
    console.log('\n\n📍 RAILWAY DATABASE:');
    for (const table of keyTables) {
      await verifyTable(railwaySequelize, table.name, `RAILWAY - ${table.label}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Schema verification complete!');
    console.log('='.repeat(80));
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

