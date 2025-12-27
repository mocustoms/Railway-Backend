#!/usr/bin/env node

/**
 * Comprehensive Database Comparison Tool
 * 
 * Compares local vs Railway databases for:
 * - Tables
 * - Columns (data types, nullability, defaults)
 * - Constraints (primary keys, unique, check)
 * - Foreign keys
 * - Indexes
 * - Sequences
 * 
 * Usage: node scripts/comprehensive-db-comparison.js [railway-database-url]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');
const config = require('../env');

// Parse DATABASE_URL
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  
  try {
    let normalizedUrl = databaseUrl.trim();
    if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
    }
    
    normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
    const url = new URL(normalizedUrl);
    
    const databaseName = url.pathname ? url.pathname.slice(1) : '';
    if (!databaseName) {
      throw new Error('Database name not found in DATABASE_URL');
    }
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: databaseName,
      username: url.username || 'postgres',
      password: url.password || ''
    };
  } catch (error) {
    throw new Error(`Failed to parse DATABASE_URL: ${error.message}`);
  }
}

// Get all tables
async function getAllTables(sequelize) {
  const tables = await sequelize.query(`
    SELECT 
      table_name,
      table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(tables) ? tables : [];
}

// Get table columns
async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(`
    SELECT 
      column_name,
      data_type,
      udt_name,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      is_nullable,
      column_default,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = :tableName
    ORDER BY ordinal_position;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(columns) ? columns : [];
}

// Get all constraints
async function getAllConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    LEFT JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = :tableName
    GROUP BY tc.constraint_name, tc.constraint_type, ccu.table_name, ccu.column_name, rc.update_rule, rc.delete_rule
    ORDER BY tc.constraint_type, tc.constraint_name;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(constraints) ? constraints : [];
}

// Get all indexes
async function getAllIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(`
    SELECT
      i.indexname,
      i.indexdef,
      idx.indisunique as is_unique,
      idx.indisprimary as is_primary
    FROM pg_indexes i
    JOIN pg_index idx ON i.indexname = (
      SELECT relname FROM pg_class WHERE oid = idx.indexrelid
    )
    WHERE i.schemaname = 'public' 
      AND i.tablename = :tableName
    ORDER BY i.indexname;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(indexes) ? indexes : [];
}

// Get sequences
async function getAllSequences(sequelize) {
  const sequences = await sequelize.query(`
    SELECT 
      sequence_name,
      data_type,
      numeric_precision,
      numeric_scale,
      start_value,
      minimum_value,
      maximum_value,
      increment
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(sequences) ? sequences : [];
}

// Compare arrays of objects
function compareArrays(local, railway, keyField, name) {
  const localMap = new Map(local.map(item => [item[keyField], item]));
  const railwayMap = new Map(railway.map(item => [item[keyField], item]));
  
  const onlyLocal = local.filter(item => !railwayMap.has(item[keyField]));
  const onlyRailway = railway.filter(item => !localMap.has(item[keyField]));
  const inBoth = local.filter(item => railwayMap.has(item[keyField]));
  
  return {
    onlyLocal,
    onlyRailway,
    inBoth,
    differences: inBoth.map(item => {
      const railwayItem = railwayMap.get(item[keyField]);
      const localStr = JSON.stringify(item);
      const railwayStr = JSON.stringify(railwayItem);
      return {
        key: item[keyField],
        local: item,
        railway: railwayItem,
        isDifferent: localStr !== railwayStr
      };
    }).filter(diff => diff.isDifferent)
  };
}

// Format column for display
function formatColumn(col) {
  let type = col.data_type;
  if (col.character_maximum_length) {
    type += `(${col.character_maximum_length})`;
  } else if (col.numeric_precision !== null) {
    type += `(${col.numeric_precision}`;
    if (col.numeric_scale !== null) {
      type += `,${col.numeric_scale}`;
    }
    type += `)`;
  }
  
  const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
  const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
  
  return `${col.column_name} ${type} ${nullable}${defaultVal}`;
}

// Main function
async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Error: Railway DATABASE_URL is required');
    console.error('');
    console.error('Usage: node scripts/comprehensive-db-comparison.js <railway-database-url>');
    process.exit(1);
  }
  
  // Parse Railway config
  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayDbUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
  
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Comprehensive Database Comparison                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Local Database:');
  console.log(`  Host: ${config.DB_HOST}:${config.DB_PORT}`);
  console.log(`  Database: ${config.DB_NAME}`);
  console.log('');
  console.log('Railway Database:');
  console.log(`  Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`  Database: ${railwayConfig.database}`);
  console.log('');
  
  // Create connections
  const localSequelize = require('../config/database');
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  
  const issues = [];
  const warnings = [];
  
  try {
    // Test connections
    console.log('🔄 Connecting to databases...');
    await localSequelize.authenticate();
    console.log('✅ Connected to local database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database');
    console.log('');
    
    // 1. Compare Tables
    console.log('═'.repeat(80));
    console.log('📊 1. COMPARING TABLES');
    console.log('═'.repeat(80));
    console.log('');
    
    const localTables = await getAllTables(localSequelize);
    const railwayTables = await getAllTables(railwaySequelize);
    
    const localTableNames = localTables.map(t => t.table_name).sort();
    const railwayTableNames = railwayTables.map(t => t.table_name).sort();
    
    const onlyLocalTables = localTableNames.filter(t => !railwayTableNames.includes(t));
    const onlyRailwayTables = railwayTableNames.filter(t => !localTableNames.includes(t));
    const commonTables = localTableNames.filter(t => railwayTableNames.includes(t));
    
    console.log(`Local: ${localTableNames.length} tables`);
    console.log(`Railway: ${railwayTableNames.length} tables`);
    console.log(`Common: ${commonTables.length} tables`);
    console.log('');
    
    if (onlyLocalTables.length > 0) {
      console.log(`⚠️  Tables only in LOCAL (${onlyLocalTables.length}):`);
      onlyLocalTables.forEach(t => {
        console.log(`   - ${t}`);
        warnings.push(`Table ${t} exists only in local database`);
      });
      console.log('');
    }
    
    if (onlyRailwayTables.length > 0) {
      console.log(`⚠️  Tables only in RAILWAY (${onlyRailwayTables.length}):`);
      onlyRailwayTables.forEach(t => {
        console.log(`   - ${t}`);
        warnings.push(`Table ${t} exists only in Railway database`);
      });
      console.log('');
    }
    
    if (onlyLocalTables.length === 0 && onlyRailwayTables.length === 0) {
      console.log('✅ All tables exist in both databases');
      console.log('');
    }
    
    // 2. Compare Columns for each common table
    console.log('═'.repeat(80));
    console.log('📋 2. COMPARING COLUMNS');
    console.log('═'.repeat(80));
    console.log('');
    
    for (const tableName of commonTables) {
      const localColumns = await getTableColumns(localSequelize, tableName);
      const railwayColumns = await getTableColumns(railwaySequelize, tableName);
      
      const columnComparison = compareArrays(localColumns, railwayColumns, 'column_name', 'columns');
      
      if (columnComparison.onlyLocal.length > 0 || columnComparison.onlyRailway.length > 0 || columnComparison.differences.length > 0) {
        console.log(`\n📌 Table: ${tableName}`);
        
        if (columnComparison.onlyLocal.length > 0) {
          console.log(`   ⚠️  Columns only in LOCAL (${columnComparison.onlyLocal.length}):`);
          columnComparison.onlyLocal.forEach(col => {
            console.log(`      - ${formatColumn(col)}`);
            issues.push(`Table ${tableName}: Column ${col.column_name} exists only in local`);
          });
        }
        
        if (columnComparison.onlyRailway.length > 0) {
          console.log(`   ⚠️  Columns only in RAILWAY (${columnComparison.onlyRailway.length}):`);
          columnComparison.onlyRailway.forEach(col => {
            console.log(`      - ${formatColumn(col)}`);
            issues.push(`Table ${tableName}: Column ${col.column_name} exists only in Railway`);
          });
        }
        
        if (columnComparison.differences.length > 0) {
          console.log(`   ⚠️  Column differences (${columnComparison.differences.length}):`);
          columnComparison.differences.forEach(diff => {
            console.log(`      - ${diff.key}:`);
            console.log(`        Local:   ${formatColumn(diff.local)}`);
            console.log(`        Railway: ${formatColumn(diff.railway)}`);
            issues.push(`Table ${tableName}: Column ${diff.key} differs between local and Railway`);
          });
        }
      }
    }
    
    if (issues.filter(i => i.includes('Column')).length === 0) {
      console.log('✅ All columns match in common tables');
    }
    console.log('');
    
    // 3. Compare Constraints
    console.log('═'.repeat(80));
    console.log('🔗 3. COMPARING CONSTRAINTS');
    console.log('═'.repeat(80));
    console.log('');
    
    for (const tableName of commonTables) {
      const localConstraints = await getAllConstraints(localSequelize, tableName);
      const railwayConstraints = await getAllConstraints(railwaySequelize, tableName);
      
      const constraintComparison = compareArrays(localConstraints, railwayConstraints, 'constraint_name', 'constraints');
      
      if (constraintComparison.onlyLocal.length > 0 || constraintComparison.onlyRailway.length > 0 || constraintComparison.differences.length > 0) {
        console.log(`\n📌 Table: ${tableName}`);
        
        if (constraintComparison.onlyLocal.length > 0) {
          console.log(`   ⚠️  Constraints only in LOCAL (${constraintComparison.onlyLocal.length}):`);
          constraintComparison.onlyLocal.forEach(con => {
            const fkInfo = con.foreign_table_name ? ` -> ${con.foreign_table_name}.${con.foreign_column_name}` : '';
            console.log(`      - ${con.constraint_name} (${con.constraint_type}): [${con.columns}]${fkInfo}`);
            issues.push(`Table ${tableName}: Constraint ${con.constraint_name} exists only in local`);
          });
        }
        
        if (constraintComparison.onlyRailway.length > 0) {
          console.log(`   ⚠️  Constraints only in RAILWAY (${constraintComparison.onlyRailway.length}):`);
          constraintComparison.onlyRailway.forEach(con => {
            const fkInfo = con.foreign_table_name ? ` -> ${con.foreign_table_name}.${con.foreign_column_name}` : '';
            console.log(`      - ${con.constraint_name} (${con.constraint_type}): [${con.columns}]${fkInfo}`);
            issues.push(`Table ${tableName}: Constraint ${con.constraint_name} exists only in Railway`);
          });
        }
        
        if (constraintComparison.differences.length > 0) {
          console.log(`   ⚠️  Constraint differences (${constraintComparison.differences.length}):`);
          constraintComparison.differences.forEach(diff => {
            console.log(`      - ${diff.key}:`);
            console.log(`        Local:   ${diff.local.constraint_type} [${diff.local.columns}]`);
            console.log(`        Railway: ${diff.railway.constraint_type} [${diff.railway.columns}]`);
            issues.push(`Table ${tableName}: Constraint ${diff.key} differs between local and Railway`);
          });
        }
      }
    }
    
    if (issues.filter(i => i.includes('Constraint')).length === 0) {
      console.log('✅ All constraints match in common tables');
    }
    console.log('');
    
    // 4. Compare Indexes
    console.log('═'.repeat(80));
    console.log('📑 4. COMPARING INDEXES');
    console.log('═'.repeat(80));
    console.log('');
    
    for (const tableName of commonTables) {
      const localIndexes = await getAllIndexes(localSequelize, tableName);
      const railwayIndexes = await getAllIndexes(railwaySequelize, tableName);
      
      const indexComparison = compareArrays(localIndexes, railwayIndexes, 'indexname', 'indexes');
      
      if (indexComparison.onlyLocal.length > 0 || indexComparison.onlyRailway.length > 0 || indexComparison.differences.length > 0) {
        console.log(`\n📌 Table: ${tableName}`);
        
        if (indexComparison.onlyLocal.length > 0) {
          console.log(`   ⚠️  Indexes only in LOCAL (${indexComparison.onlyLocal.length}):`);
          indexComparison.onlyLocal.forEach(idx => {
            const unique = idx.is_unique ? 'UNIQUE ' : '';
            console.log(`      - ${unique}${idx.indexname}`);
            warnings.push(`Table ${tableName}: Index ${idx.indexname} exists only in local`);
          });
        }
        
        if (indexComparison.onlyRailway.length > 0) {
          console.log(`   ⚠️  Indexes only in RAILWAY (${indexComparison.onlyRailway.length}):`);
          indexComparison.onlyRailway.forEach(idx => {
            const unique = idx.is_unique ? 'UNIQUE ' : '';
            console.log(`      - ${unique}${idx.indexname}`);
            warnings.push(`Table ${tableName}: Index ${idx.indexname} exists only in Railway`);
          });
        }
        
        if (indexComparison.differences.length > 0) {
          console.log(`   ⚠️  Index differences (${indexComparison.differences.length}):`);
          indexComparison.differences.forEach(diff => {
            console.log(`      - ${diff.key}:`);
            console.log(`        Local:   ${diff.local.indexdef.substring(0, 100)}...`);
            console.log(`        Railway: ${diff.railway.indexdef.substring(0, 100)}...`);
            issues.push(`Table ${tableName}: Index ${diff.key} differs between local and Railway`);
          });
        }
      }
    }
    
    if (warnings.filter(w => w.includes('Index')).length === 0) {
      console.log('✅ All indexes match in common tables');
    }
    console.log('');
    
    // 5. Compare Sequences
    console.log('═'.repeat(80));
    console.log('🔢 5. COMPARING SEQUENCES');
    console.log('═'.repeat(80));
    console.log('');
    
    const localSequences = await getAllSequences(localSequelize);
    const railwaySequences = await getAllSequences(railwaySequelize);
    
    const sequenceComparison = compareArrays(localSequences, railwaySequences, 'sequence_name', 'sequences');
    
    if (sequenceComparison.onlyLocal.length > 0 || sequenceComparison.onlyRailway.length > 0 || sequenceComparison.differences.length > 0) {
      if (sequenceComparison.onlyLocal.length > 0) {
        console.log(`⚠️  Sequences only in LOCAL (${sequenceComparison.onlyLocal.length}):`);
        sequenceComparison.onlyLocal.forEach(seq => {
          console.log(`   - ${seq.sequence_name}`);
          warnings.push(`Sequence ${seq.sequence_name} exists only in local`);
        });
        console.log('');
      }
      
      if (sequenceComparison.onlyRailway.length > 0) {
        console.log(`⚠️  Sequences only in RAILWAY (${sequenceComparison.onlyRailway.length}):`);
        sequenceComparison.onlyRailway.forEach(seq => {
          console.log(`   - ${seq.sequence_name}`);
          warnings.push(`Sequence ${seq.sequence_name} exists only in Railway`);
        });
        console.log('');
      }
      
      if (sequenceComparison.differences.length > 0) {
        console.log(`⚠️  Sequence differences (${sequenceComparison.differences.length}):`);
        sequenceComparison.differences.forEach(diff => {
          console.log(`   - ${diff.key}:`);
          console.log(`     Local:   ${JSON.stringify(diff.local)}`);
          console.log(`     Railway: ${JSON.stringify(diff.railway)}`);
          issues.push(`Sequence ${diff.key} differs between local and Railway`);
        });
        console.log('');
      }
    } else {
      console.log('✅ All sequences match');
      console.log('');
    }
    
    // Summary
    console.log('═'.repeat(80));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`Total Issues Found: ${issues.length}`);
    console.log(`Total Warnings: ${warnings.length}`);
    console.log('');
    
    if (issues.length > 0) {
      console.log('❌ ISSUES (require attention):');
      issues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. ${issue}`);
      });
      console.log('');
    }
    
    if (warnings.length > 0) {
      console.log('⚠️  WARNINGS (may need attention):');
      warnings.forEach((warning, idx) => {
        console.log(`   ${idx + 1}. ${warning}`);
      });
      console.log('');
    }
    
    if (issues.length === 0 && warnings.length === 0) {
      console.log('✅ No issues or warnings found! Databases are consistent.');
      console.log('');
    }
    
    console.log('═'.repeat(80));
    console.log('✅ Comparison Complete!');
    console.log('═'.repeat(80));
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ ERROR:');
    console.error('='.repeat(80));
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    console.error('');
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

// Run
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

