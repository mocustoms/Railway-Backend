#!/usr/bin/env node

/**
 * Comprehensive Database Structure Verification
 * 
 * Verifies database structure including:
 * - All tables
 * - All columns (data types, nullable, defaults, constraints)
 * - Primary keys
 * - Foreign keys
 * - Indexes
 * - Unique constraints
 * 
 * Usage:
 *   - Local DB: node scripts/verify-database-structure.js
 *   - Railway DB: node scripts/verify-database-structure.js --railway
 *   - Compare: node scripts/verify-database-structure.js --compare
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const railwayDbConfig = require('../config/railway-db');

// Use Railway DB if --railway flag is passed, otherwise use local
const useRailway = process.argv.includes('--railway');
const compareMode = process.argv.includes('--compare');

let localSequelize, railwaySequelize;

if (useRailway) {
  console.log('🔗 Connecting to Railway database...\n');
  railwaySequelize = railwayDbConfig.createRailwaySequelize();
} else {
  const { sequelize } = require('../server/models');
  localSequelize = sequelize;
  console.log('🔗 Connecting to local database...\n');
}

if (compareMode) {
  const { sequelize } = require('../server/models');
  localSequelize = sequelize;
  railwaySequelize = railwayDbConfig.createRailwaySequelize();
  console.log('🔗 Connecting to both local and Railway databases for comparison...\n');
}

async function getAllTables(sequelize) {
  const tables = await sequelize.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `, { type: QueryTypes.SELECT });
  
  return tables.map(t => t.table_name);
}

async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(`
    SELECT 
      c.column_name,
      c.data_type,
      c.udt_name,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.is_nullable,
      c.column_default,
      c.ordinal_position
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
    AND c.table_name = :tableName
    ORDER BY c.ordinal_position;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return columns;
}

async function getPrimaryKeys(sequelize, tableName) {
  const pks = await sequelize.query(`
    SELECT
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
    AND tc.table_name = :tableName
    AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return pks.map(pk => pk.column_name);
}

async function getForeignKeys(sequelize, tableName) {
  const fks = await sequelize.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
    AND tc.table_name = :tableName
    AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.constraint_name, kcu.ordinal_position;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return fks;
}

async function getUniqueConstraints(sequelize, tableName) {
  const uniques = await sequelize.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
    AND tc.table_name = :tableName
    AND tc.constraint_type = 'UNIQUE'
    ORDER BY tc.constraint_name, kcu.ordinal_position;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return uniques;
}

async function getIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = :tableName
    AND indexname NOT LIKE '%_pkey'
    AND indexname NOT IN (
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = :tableName
      AND constraint_type IN ('UNIQUE', 'PRIMARY KEY')
    )
    ORDER BY indexname;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return indexes;
}

function formatDataType(col) {
  let type = col.udt_name || col.data_type;
  
  if (col.character_maximum_length) {
    type += `(${col.character_maximum_length})`;
  } else if (col.numeric_precision && col.numeric_scale !== null) {
    type += `(${col.numeric_precision},${col.numeric_scale})`;
  } else if (col.numeric_precision) {
    type += `(${col.numeric_precision})`;
  }
  
  return type;
}

function formatDefault(defaultValue) {
  if (!defaultValue) return null;
  
  // Remove function call parentheses for readability
  if (defaultValue.includes('nextval')) {
    return 'AUTO_INCREMENT';
  }
  if (defaultValue.includes('CURRENT_TIMESTAMP')) {
    return 'CURRENT_TIMESTAMP';
  }
  if (defaultValue.includes('now()')) {
    return 'now()';
  }
  
  return defaultValue;
}

async function verifyTable(sequelize, tableName, dbName = 'Database') {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 TABLE: ${tableName} (${dbName})`);
  console.log('='.repeat(80));
  
  // Get columns
  const columns = await getTableColumns(sequelize, tableName);
  console.log(`\n📊 COLUMNS (${columns.length}):`);
  console.log('-'.repeat(80));
  console.log(`${'Column Name'.padEnd(30)} ${'Type'.padEnd(25)} ${'Nullable'.padEnd(10)} ${'Default'}`);
  console.log('-'.repeat(80));
  
  columns.forEach(col => {
    const type = formatDataType(col);
    const nullable = col.is_nullable === 'YES' ? 'YES' : 'NO';
    const defaultValue = formatDefault(col.column_default) || '-';
    console.log(`${col.column_name.padEnd(30)} ${type.padEnd(25)} ${nullable.padEnd(10)} ${defaultValue}`);
  });
  
  // Get primary keys
  const primaryKeys = await getPrimaryKeys(sequelize, tableName);
  if (primaryKeys.length > 0) {
    console.log(`\n🔑 PRIMARY KEYS: ${primaryKeys.join(', ')}`);
  } else {
    console.log(`\n⚠️  NO PRIMARY KEY FOUND`);
  }
  
  // Get foreign keys
  const foreignKeys = await getForeignKeys(sequelize, tableName);
  if (foreignKeys.length > 0) {
    console.log(`\n🔗 FOREIGN KEYS (${foreignKeys.length}):`);
    foreignKeys.forEach(fk => {
      console.log(`   ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name} (${fk.delete_rule}/${fk.update_rule})`);
    });
  }
  
  // Get unique constraints
  const uniques = await getUniqueConstraints(sequelize, tableName);
  if (uniques.length > 0) {
    const uniqueGroups = {};
    uniques.forEach(u => {
      if (!uniqueGroups[u.constraint_name]) {
        uniqueGroups[u.constraint_name] = [];
      }
      uniqueGroups[u.constraint_name].push(u.column_name);
    });
    console.log(`\n✨ UNIQUE CONSTRAINTS (${Object.keys(uniqueGroups).length}):`);
    Object.entries(uniqueGroups).forEach(([name, cols]) => {
      console.log(`   ${name}: ${cols.join(', ')}`);
    });
  }
  
  // Get indexes
  const indexes = await getIndexes(sequelize, tableName);
  if (indexes.length > 0) {
    console.log(`\n📇 INDEXES (${indexes.length}):`);
    indexes.forEach(idx => {
      console.log(`   ${idx.indexname}`);
    });
  }
}

async function verifyDatabase(sequelize, dbName = 'Database') {
  try {
    await sequelize.authenticate();
    console.log(`✅ Connected to ${dbName}\n`);
  } catch (error) {
    console.error(`❌ Failed to connect to ${dbName}:`, error.message);
    throw error;
  }
  
  const tables = await getAllTables(sequelize);
  console.log(`📦 Found ${tables.length} tables\n`);
  
  const summary = {
    totalTables: tables.length,
    tablesWithNoPK: [],
    tablesWithFKs: 0,
    totalColumns: 0,
    totalIndexes: 0
  };
  
  for (const tableName of tables) {
    const columns = await getTableColumns(sequelize, tableName);
    const primaryKeys = await getPrimaryKeys(sequelize, tableName);
    const foreignKeys = await getForeignKeys(sequelize, tableName);
    const indexes = await getIndexes(sequelize, tableName);
    
    summary.totalColumns += columns.length;
    summary.totalIndexes += indexes.length;
    
    if (primaryKeys.length === 0) {
      summary.tablesWithNoPK.push(tableName);
    }
    
    if (foreignKeys.length > 0) {
      summary.tablesWithFKs++;
    }
    
    await verifyTable(sequelize, tableName, dbName);
  }
  
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY (${dbName})`);
  console.log('='.repeat(80));
  console.log(`Total Tables: ${summary.totalTables}`);
  console.log(`Total Columns: ${summary.totalColumns}`);
  console.log(`Total Indexes: ${summary.totalIndexes}`);
  console.log(`Tables with Foreign Keys: ${summary.tablesWithFKs}`);
  if (summary.tablesWithNoPK.length > 0) {
    console.log(`\n⚠️  Tables without Primary Keys (${summary.tablesWithNoPK.length}):`);
    summary.tablesWithNoPK.forEach(t => console.log(`   - ${t}`));
  } else {
    console.log(`\n✅ All tables have primary keys`);
  }
  console.log('='.repeat(80));
  
  return summary;
}

async function compareDatabases() {
  console.log('🔍 COMPARING LOCAL vs RAILWAY DATABASES\n');
  
  const localSummary = await verifyDatabase(localSequelize, 'LOCAL');
  const railwaySummary = await verifyDatabase(railwaySequelize, 'RAILWAY');
  
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log(`Tables: Local=${localSummary.totalTables}, Railway=${railwaySummary.totalTables}, Diff=${railwaySummary.totalTables - localSummary.totalTables}`);
  console.log(`Columns: Local=${localSummary.totalColumns}, Railway=${railwaySummary.totalColumns}, Diff=${railwaySummary.totalColumns - localSummary.totalColumns}`);
  console.log(`Indexes: Local=${localSummary.totalIndexes}, Railway=${railwaySummary.totalIndexes}, Diff=${railwaySummary.totalIndexes - localSummary.totalIndexes}`);
  
  if (localSummary.tablesWithNoPK.length !== railwaySummary.tablesWithNoPK.length) {
    console.log(`\n⚠️  Primary Key Mismatch:`);
    console.log(`   Local tables without PK: ${localSummary.tablesWithNoPK.length}`);
    console.log(`   Railway tables without PK: ${railwaySummary.tablesWithNoPK.length}`);
  }
  
  console.log('='.repeat(80));
}

async function main() {
  try {
    if (compareMode) {
      await compareDatabases();
    } else if (useRailway) {
      await verifyDatabase(railwaySequelize, 'RAILWAY');
    } else {
      await verifyDatabase(localSequelize, 'LOCAL');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (localSequelize) {
      await localSequelize.close();
    }
    if (railwaySequelize) {
      await railwaySequelize.close();
    }
    console.log('\n✅ Verification complete');
    process.exit(0);
  }
}

main();

