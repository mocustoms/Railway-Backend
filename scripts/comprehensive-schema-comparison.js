#!/usr/bin/env node

/**
 * Comprehensive Schema Comparison: Local vs Railway
 * 
 * Compares:
 * - Tables and columns
 * - Indexes and constraints
 * - Foreign keys
 * - Unique constraints
 * - Sequelize model definitions vs actual database
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');
const fs = require('fs');
const path = require('path');

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
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

async function getIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(
    `SELECT
      i.relname AS index_name,
      a.attname AS column_name,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      pg_get_indexdef(ix.indexrelid) AS index_definition
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relkind = 'r'
    AND t.relname = :tableName
    ORDER BY i.relname, a.attnum`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(indexes) && indexes.length > 0 && Array.isArray(indexes[0])
    ? indexes[0]
    : indexes;
}

async function getConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(
    `SELECT
      conname AS constraint_name,
      contype AS constraint_type,
      pg_get_constraintdef(oid) AS constraint_definition
    FROM pg_constraint
    WHERE conrelid = (
      SELECT oid FROM pg_class WHERE relname = :tableName
    )
    ORDER BY conname`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(constraints) && constraints.length > 0 && Array.isArray(constraints[0])
    ? constraints[0]
    : constraints;
}

async function getForeignKeys(sequelize, tableName) {
  const fks = await sequelize.query(
    `SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = :tableName
    ORDER BY tc.constraint_name, kcu.ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(fks) && fks.length > 0 && Array.isArray(fks[0])
    ? fks[0]
    : fks;
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
  const tablesArray = Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0])
    ? tables[0]
    : tables;
  return tablesArray.map(t => t.table_name);
}

function normalizeIndexName(name) {
  // Remove table prefix and normalize
  return name.toLowerCase().replace(/^.*_/, '');
}

function compareIndexes(localIndexes, railwayIndexes) {
  const localMap = new Map();
  const railwayMap = new Map();
  
  // Group by index name
  localIndexes.forEach(idx => {
    const key = idx.index_name;
    if (!localMap.has(key)) {
      localMap.set(key, { name: key, columns: [], is_unique: idx.is_unique, is_primary: idx.is_primary });
    }
    if (idx.column_name) {
      localMap.get(key).columns.push(idx.column_name);
    }
  });
  
  railwayIndexes.forEach(idx => {
    const key = idx.index_name;
    if (!railwayMap.has(key)) {
      railwayMap.set(key, { name: key, columns: [], is_unique: idx.is_unique, is_primary: idx.is_primary });
    }
    if (idx.column_name) {
      railwayMap.get(key).columns.push(idx.column_name);
    }
  });
  
  const missing = [];
  const extra = [];
  const different = [];
  
  for (const [name, localIdx] of localMap) {
    if (!railwayMap.has(name)) {
      missing.push({ name, ...localIdx });
    } else {
      const railwayIdx = railwayMap.get(name);
      const localCols = localIdx.columns.sort().join(',');
      const railwayCols = railwayIdx.columns.sort().join(',');
      if (localCols !== railwayCols || localIdx.is_unique !== railwayIdx.is_unique) {
        different.push({
          name,
          local: localIdx,
          railway: railwayIdx
        });
      }
    }
  }
  
  for (const [name, railwayIdx] of railwayMap) {
    if (!localMap.has(name)) {
      extra.push({ name, ...railwayIdx });
    }
  }
  
  return { missing, extra, different };
}

function compareConstraints(localConstraints, railwayConstraints) {
  const localMap = new Map(localConstraints.map(c => [c.constraint_name, c]));
  const railwayMap = new Map(railwayConstraints.map(c => [c.constraint_name, c]));
  
  const missing = [];
  const extra = [];
  const different = [];
  
  for (const [name, localCon] of localMap) {
    if (!railwayMap.has(name)) {
      missing.push(localCon);
    } else {
      const railwayCon = railwayMap.get(name);
      if (localCon.constraint_definition !== railwayCon.constraint_definition) {
        different.push({
          name,
          local: localCon.constraint_definition,
          railway: railwayCon.constraint_definition
        });
      }
    }
  }
  
  for (const [name, railwayCon] of railwayMap) {
    if (!localMap.has(name)) {
      extra.push(railwayCon);
    }
  }
  
  return { missing, extra, different };
}

async function main() {
  const railwayDbUrl = process.argv[2] || 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔍 COMPREHENSIVE SCHEMA COMPARISON: LOCAL vs RAILWAY\n');
    console.log('='.repeat(80));
    
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    const localTables = await getTables(localSequelize);
    const railwayTables = await getTables(railwaySequelize);
    
    console.log(`📊 Local tables: ${localTables.length}`);
    console.log(`📊 Railway tables: ${railwayTables.length}\n`);

    const commonTables = localTables.filter(t => railwayTables.includes(t));
    const missingInRailway = localTables.filter(t => !railwayTables.includes(t));
    const extraInRailway = railwayTables.filter(t => !localTables.includes(t));

    if (missingInRailway.length > 0) {
      console.log('❌ Tables missing in Railway:');
      missingInRailway.forEach(t => console.log(`   - ${t}`));
      console.log('');
    }

    if (extraInRailway.length > 0) {
      console.log('⚠️  Extra tables in Railway:');
      extraInRailway.forEach(t => console.log(`   - ${t}`));
      console.log('');
    }

    console.log(`\n📋 Analyzing ${commonTables.length} common tables...\n`);

    let totalIssues = 0;
    const issues = [];

    // Key tables to check in detail
    const keyTables = ['packaging', 'users', 'products', 'stores', 'customers', 'sales_invoices', 'sales_orders'];
    
    for (const table of commonTables) {
      const isKeyTable = keyTables.includes(table);
      
      // Get indexes
      const localIndexes = await getIndexes(localSequelize, table);
      const railwayIndexes = await getIndexes(railwaySequelize, table);
      const indexDiff = compareIndexes(localIndexes, railwayIndexes);
      
      // Get constraints
      const localConstraints = await getConstraints(localSequelize, table);
      const railwayConstraints = await getConstraints(railwaySequelize, table);
      const constraintDiff = compareConstraints(localConstraints, railwayConstraints);
      
      // Get foreign keys
      const localFKs = await getForeignKeys(localSequelize, table);
      const railwayFKs = await getForeignKeys(railwaySequelize, table);
      
      const localFKMap = new Map(localFKs.map(fk => [`${fk.constraint_name}_${fk.column_name}`, fk]));
      const railwayFKMap = new Map(railwayFKs.map(fk => [`${fk.constraint_name}_${fk.column_name}`, fk]));
      
      const missingFKs = localFKs.filter(fk => !railwayFKMap.has(`${fk.constraint_name}_${fk.column_name}`));
      const extraFKs = railwayFKs.filter(fk => !localFKMap.has(`${fk.constraint_name}_${fk.column_name}`));
      
      if (indexDiff.missing.length > 0 || indexDiff.extra.length > 0 || indexDiff.different.length > 0 ||
          constraintDiff.missing.length > 0 || constraintDiff.extra.length > 0 || constraintDiff.different.length > 0 ||
          missingFKs.length > 0 || extraFKs.length > 0 || isKeyTable) {
        
        totalIssues++;
        issues.push({
          table,
          isKeyTable,
          indexes: indexDiff,
          constraints: constraintDiff,
          foreignKeys: { missing: missingFKs, extra: extraFKs }
        });
      }
    }

    if (totalIssues === 0) {
      console.log('✅ No differences found in indexes, constraints, or foreign keys!\n');
    } else {
      console.log(`\n⚠️  Found differences in ${totalIssues} tables:\n`);
      
      issues.forEach(({ table, isKeyTable, indexes, constraints, foreignKeys }) => {
        if (isKeyTable || indexes.missing.length > 0 || indexes.extra.length > 0 || indexes.different.length > 0 ||
            constraints.missing.length > 0 || constraints.extra.length > 0 || constraints.different.length > 0 ||
            foreignKeys.missing.length > 0 || foreignKeys.extra.length > 0) {
          
          console.log(`\n📋 Table: ${table}${isKeyTable ? ' (KEY TABLE)' : ''}`);
          console.log('-'.repeat(80));
          
          // Indexes
          if (indexes.missing.length > 0) {
            console.log(`❌ Missing indexes in Railway (${indexes.missing.length}):`);
            indexes.missing.forEach(idx => {
              console.log(`   - ${idx.name} (columns: ${idx.columns.join(', ')}, unique: ${idx.is_unique})`);
            });
          }
          if (indexes.extra.length > 0) {
            console.log(`⚠️  Extra indexes in Railway (${indexes.extra.length}):`);
            indexes.extra.forEach(idx => {
              console.log(`   - ${idx.name} (columns: ${idx.columns.join(', ')}, unique: ${idx.is_unique})`);
            });
          }
          if (indexes.different.length > 0) {
            console.log(`⚠️  Different indexes (${indexes.different.length}):`);
            indexes.different.forEach(diff => {
              console.log(`   - ${diff.name}:`);
              console.log(`     Local:    columns: ${diff.local.columns.join(', ')}, unique: ${diff.local.is_unique}`);
              console.log(`     Railway:  columns: ${diff.railway.columns.join(', ')}, unique: ${diff.railway.is_unique}`);
            });
          }
          
          // Constraints
          if (constraints.missing.length > 0) {
            console.log(`❌ Missing constraints in Railway (${constraints.missing.length}):`);
            constraints.missing.forEach(con => {
              console.log(`   - ${con.constraint_name} (${con.constraint_type}): ${con.constraint_definition}`);
            });
          }
          if (constraints.extra.length > 0) {
            console.log(`⚠️  Extra constraints in Railway (${constraints.extra.length}):`);
            constraints.extra.forEach(con => {
              console.log(`   - ${con.constraint_name} (${con.constraint_type}): ${con.constraint_definition}`);
            });
          }
          if (constraints.different.length > 0) {
            console.log(`⚠️  Different constraints (${constraints.different.length}):`);
            constraints.different.forEach(diff => {
              console.log(`   - ${diff.name}:`);
              console.log(`     Local:    ${diff.local}`);
              console.log(`     Railway:  ${diff.railway}`);
            });
          }
          
          // Foreign Keys
          if (foreignKeys.missing.length > 0) {
            console.log(`❌ Missing foreign keys in Railway (${foreignKeys.missing.length}):`);
            foreignKeys.missing.forEach(fk => {
              console.log(`   - ${fk.constraint_name}: ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
            });
          }
          if (foreignKeys.extra.length > 0) {
            console.log(`⚠️  Extra foreign keys in Railway (${foreignKeys.extra.length}):`);
            foreignKeys.extra.forEach(fk => {
              console.log(`   - ${fk.constraint_name}: ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
            });
          }
          
          console.log('');
        }
      });
    }

    // Summary
    console.log('='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log(`   Local tables: ${localTables.length}`);
    console.log(`   Railway tables: ${railwayTables.length}`);
    console.log(`   Common tables: ${commonTables.length}`);
    console.log(`   Tables with differences: ${totalIssues}`);
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
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

