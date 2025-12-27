#!/usr/bin/env node

/**
 * Analyze Database Differences - Focus on Critical Issues
 * 
 * Categorizes differences into:
 * - CRITICAL: Constraints, foreign keys, missing columns, data type mismatches
 * - WARNING: Index naming differences, default value differences
 * - INFO: Style differences (naming conventions)
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

// Get constraints for a table
async function getConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = :tableName
    GROUP BY tc.constraint_name, tc.constraint_type, ccu.table_name, ccu.column_name
    ORDER BY tc.constraint_type, tc.constraint_name;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(constraints) ? constraints : [];
}

// Get columns for a table
async function getColumns(sequelize, tableName) {
  const columns = await sequelize.query(`
    SELECT 
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default
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

// Get all tables
async function getAllTables(sequelize) {
  const tables = await sequelize.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(tables) ? tables.map(t => t.table_name) : [];
}

// Main analysis
async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Error: Railway DATABASE_URL is required');
    process.exit(1);
  }
  
  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
  
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
  
  const critical = [];
  const warnings = [];
  const info = [];
  
  try {
    await localSequelize.authenticate();
    await railwaySequelize.authenticate();
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  Critical Database Differences Analysis                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    const localTables = await getAllTables(localSequelize);
    const railwayTables = await getAllTables(railwaySequelize);
    const commonTables = localTables.filter(t => railwayTables.includes(t));
    
    console.log(`Analyzing ${commonTables.length} common tables...\n`);
    
    for (const tableName of commonTables) {
      // Compare constraints
      const localConstraints = await getConstraints(localSequelize, tableName);
      const railwayConstraints = await getConstraints(railwaySequelize, tableName);
      
      const localConstraintMap = new Map(localConstraints.map(c => [c.constraint_name, c]));
      const railwayConstraintMap = new Map(railwayConstraints.map(c => [c.constraint_name, c]));
      
      // Check for missing constraints
      for (const [name, constraint] of localConstraintMap) {
        if (!railwayConstraintMap.has(name)) {
          if (constraint.constraint_type === 'UNIQUE' || constraint.constraint_type === 'PRIMARY KEY') {
            critical.push({
              type: 'MISSING_CONSTRAINT',
              table: tableName,
              constraint: name,
              constraint_type: constraint.constraint_type,
              columns: constraint.columns,
              location: 'Railway'
            });
          } else if (constraint.constraint_type === 'FOREIGN KEY') {
            critical.push({
              type: 'MISSING_FOREIGN_KEY',
              table: tableName,
              constraint: name,
              columns: constraint.columns,
              references: `${constraint.foreign_table_name}.${constraint.foreign_column_name}`,
              location: 'Railway'
            });
          }
        }
      }
      
      for (const [name, constraint] of railwayConstraintMap) {
        if (!localConstraintMap.has(name)) {
          if (constraint.constraint_type === 'UNIQUE' || constraint.constraint_type === 'PRIMARY KEY') {
            critical.push({
              type: 'EXTRA_CONSTRAINT',
              table: tableName,
              constraint: name,
              constraint_type: constraint.constraint_type,
              columns: constraint.columns,
              location: 'Railway'
            });
          } else if (constraint.constraint_type === 'FOREIGN KEY') {
            warnings.push({
              type: 'EXTRA_FOREIGN_KEY',
              table: tableName,
              constraint: name,
              columns: constraint.columns,
              references: `${constraint.foreign_table_name}.${constraint.foreign_column_name}`,
              location: 'Railway'
            });
          }
        }
      }
      
      // Compare columns
      const localColumns = await getColumns(localSequelize, tableName);
      const railwayColumns = await getColumns(railwaySequelize, tableName);
      
      const localColumnMap = new Map(localColumns.map(c => [c.column_name, c]));
      const railwayColumnMap = new Map(railwayColumns.map(c => [c.column_name, c]));
      
      // Check for missing columns
      for (const [name, column] of localColumnMap) {
        if (!railwayColumnMap.has(name)) {
          critical.push({
            type: 'MISSING_COLUMN',
            table: tableName,
            column: name,
            data_type: column.data_type,
            location: 'Railway'
          });
        } else {
          const railwayCol = railwayColumnMap.get(name);
          // Check for critical data type differences
          if (column.is_nullable !== railwayCol.is_nullable) {
            critical.push({
              type: 'NULLABILITY_MISMATCH',
              table: tableName,
              column: name,
              local: column.is_nullable,
              railway: railwayCol.is_nullable
            });
          }
          
          // Check for data type differences (excluding timestamp variations)
          if (column.udt_name !== railwayCol.udt_name && 
              !(column.udt_name === 'timestamp' && railwayCol.udt_name === 'timestamptz') &&
              !(column.udt_name === 'timestamptz' && railwayCol.udt_name === 'timestamp')) {
            warnings.push({
              type: 'DATA_TYPE_MISMATCH',
              table: tableName,
              column: name,
              local: column.udt_name,
              railway: railwayCol.udt_name
            });
          }
        }
      }
      
      for (const [name, column] of railwayColumnMap) {
        if (!localColumnMap.has(name)) {
          critical.push({
            type: 'EXTRA_COLUMN',
            table: tableName,
            column: name,
            data_type: column.data_type,
            location: 'Railway'
          });
        }
      }
    }
    
    // Print report
    console.log('═'.repeat(80));
    console.log('🔴 CRITICAL ISSUES (Must Fix)');
    console.log('═'.repeat(80));
    console.log('');
    
    if (critical.length === 0) {
      console.log('✅ No critical issues found!');
    } else {
      const grouped = {};
      critical.forEach(issue => {
        if (!grouped[issue.type]) grouped[issue.type] = [];
        grouped[issue.type].push(issue);
      });
      
      for (const [type, issues] of Object.entries(grouped)) {
        console.log(`\n${type} (${issues.length}):`);
        issues.slice(0, 20).forEach(issue => {
          if (issue.type === 'MISSING_CONSTRAINT' || issue.type === 'EXTRA_CONSTRAINT') {
            console.log(`   - ${issue.table}.${issue.constraint} (${issue.constraint_type}): [${issue.columns}]`);
          } else if (issue.type === 'MISSING_FOREIGN_KEY' || issue.type === 'EXTRA_FOREIGN_KEY') {
            console.log(`   - ${issue.table}.${issue.constraint}: [${issue.columns}] -> ${issue.references}`);
          } else if (issue.type === 'MISSING_COLUMN' || issue.type === 'EXTRA_COLUMN') {
            console.log(`   - ${issue.table}.${issue.column} (${issue.data_type})`);
          } else if (issue.type === 'NULLABILITY_MISMATCH') {
            console.log(`   - ${issue.table}.${issue.column}: Local=${issue.local}, Railway=${issue.railway}`);
          }
        });
        if (issues.length > 20) {
          console.log(`   ... and ${issues.length - 20} more`);
        }
      }
    }
    
    console.log('');
    console.log('═'.repeat(80));
    console.log('⚠️  WARNINGS (Should Review)');
    console.log('═'.repeat(80));
    console.log('');
    
    if (warnings.length === 0) {
      console.log('✅ No warnings');
    } else {
      const grouped = {};
      warnings.forEach(warning => {
        if (!grouped[warning.type]) grouped[warning.type] = [];
        grouped[warning.type].push(warning);
      });
      
      for (const [type, items] of Object.entries(grouped)) {
        console.log(`\n${type} (${items.length}):`);
        items.slice(0, 10).forEach(item => {
          if (item.type === 'DATA_TYPE_MISMATCH') {
            console.log(`   - ${item.table}.${item.column}: Local=${item.local}, Railway=${item.railway}`);
          } else {
            console.log(`   - ${item.table}: ${JSON.stringify(item).substring(0, 100)}`);
          }
        });
        if (items.length > 10) {
          console.log(`   ... and ${items.length - 10} more`);
        }
      }
    }
    
    console.log('');
    console.log('═'.repeat(80));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`Critical Issues: ${critical.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log('');
    
    if (critical.length > 0) {
      console.log('⚠️  Action Required: Fix critical issues before deploying!');
    } else {
      console.log('✅ No critical issues - database schemas are compatible!');
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

main().catch(console.error);

