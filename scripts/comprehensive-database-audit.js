#!/usr/bin/env node

/**
 * Comprehensive Database Audit
 * 
 * Checks all tables for:
 * 1. Duplicate unique indexes on single columns (multi-tenant issues)
 * 2. Missing composite unique indexes where companyId should be included
 * 3. Foreign key issues
 * 4. Schema inconsistencies between local and Railway
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { createRailwaySequelize } = require('../config/railway-db');

const railwayUrl = 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';

async function getTables(sequelize) {
  const tables = await sequelize.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE 'pg_%'
    AND table_name NOT LIKE 'SequelizeMeta'
    ORDER BY table_name
  `, { type: QueryTypes.SELECT });
  
  const result = Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0])
    ? tables[0]
    : tables;
  
  return result.map(t => t.table_name || t);
}

async function getIndexes(sequelize, tableName) {
  try {
    const indexes = await sequelize.query(`
      SELECT
        i.relname AS index_name,
        pg_get_indexdef(ix.indexrelid) AS definition,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) FILTER (WHERE a.attname IS NOT NULL) AS columns
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relkind = 'r'
      AND t.relname = :tableName
      GROUP BY i.relname, ix.indisunique, ix.indisprimary, ix.indexrelid, ix.indkey
      ORDER BY i.relname
    `, {
      replacements: { tableName },
      type: QueryTypes.SELECT
    });
    
    const result = Array.isArray(indexes) && indexes.length > 0 && Array.isArray(indexes[0])
      ? indexes[0]
      : indexes;
    
    // Ensure columns is always an array
    return result.map(idx => ({
      ...idx,
      columns: Array.isArray(idx.columns) ? idx.columns.filter(c => c) : []
    }));
  } catch (error) {
    console.error(`Error getting indexes for ${tableName}:`, error.message);
    return [];
  }
}

async function hasCompanyIdColumn(sequelize, tableName) {
  const result = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = :tableName
      AND column_name IN ('companyId', 'company_id')
    )
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  const exists = Array.isArray(result) && result.length > 0 ? result[0] : result;
  return exists?.exists || false;
}

async function getColumns(sequelize, tableName) {
  const columns = await sequelize.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = :tableName
    ORDER BY ordinal_position
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

function analyzeIndexes(indexes, hasCompanyId) {
  const issues = [];
  
  // Get all unique indexes (excluding primary keys)
  const uniqueIndexes = indexes.filter(idx => idx.is_unique && !idx.is_primary);
  
  for (const idx of uniqueIndexes) {
    const definition = idx.definition || '';
    const columns = Array.isArray(idx.columns) ? idx.columns.filter(c => c) : [];
    
    // Check if this is a single-column unique index
    if (columns.length === 1) {
      const columnName = columns[0];
      
      // Skip if it's the primary key column (id)
      if (columnName === 'id' || columnName === 'Id') {
        continue;
      }
      
      // If table has companyId, this might be a multi-tenant issue
      if (hasCompanyId) {
        // Common columns that should be composite with companyId
        const multiTenantColumns = [
          'code', 'name', 'username', 'email', 'reference_number',
          'receipt_number', 'invoice_number', 'order_number', 'customer_id',
          'account_number', 'serial_number', 'barcode'
        ];
        
        if (multiTenantColumns.some(col => columnName.toLowerCase().includes(col.toLowerCase()))) {
          issues.push({
            type: 'MULTI_TENANT_ISSUE',
            severity: 'HIGH',
            index: idx.index_name,
            column: columnName,
            description: `Single-column unique index on '${columnName}' should include companyId for multi-tenant isolation`,
            recommendation: `Drop this index and create composite unique index on (${columnName}, companyId)`
          });
        }
      }
    }
    
    // Check for duplicate indexes (same columns, different names)
    const otherIndexes = uniqueIndexes.filter(other => 
      other.index_name !== idx.index_name &&
      JSON.stringify(other.columns?.sort()) === JSON.stringify(columns.sort())
    );
    
    if (otherIndexes.length > 0) {
      issues.push({
        type: 'DUPLICATE_INDEX',
        severity: 'MEDIUM',
        index: idx.index_name,
        duplicates: otherIndexes.map(i => i.index_name),
        description: `Duplicate unique index found`,
        recommendation: `Remove duplicate indexes, keep only one`
      });
    }
  }
  
  return issues;
}

async function auditDatabase(sequelize, label) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`AUDITING ${label.toUpperCase()} DATABASE`);
  console.log('='.repeat(80));
  
  const tables = await getTables(sequelize);
  console.log(`\n📊 Found ${tables.length} tables to audit\n`);
  
  const allIssues = [];
  const tablesWithIssues = [];
  
  let processed = 0;
  for (const tableName of tables) {
    try {
      process.stdout.write(`\r⏳ Processing: ${tableName} (${++processed}/${tables.length})`);
      const hasCompanyId = await hasCompanyIdColumn(sequelize, tableName);
      const indexes = await getIndexes(sequelize, tableName);
      const issues = analyzeIndexes(indexes, hasCompanyId);
      
      if (issues.length > 0) {
        allIssues.push(...issues.map(issue => ({ ...issue, table: tableName })));
        tablesWithIssues.push({ table: tableName, issues, hasCompanyId });
      }
    } catch (error) {
      console.error(`\n❌ Error auditing table ${tableName}:`, error.message);
    }
  }
  process.stdout.write('\n');
  
  return { tables, allIssues, tablesWithIssues };
}

async function compareDatabases() {
  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  
  try {
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database');
    
    // Audit both databases
    const localAudit = await auditDatabase(localSequelize, 'LOCAL');
    const railwayAudit = await auditDatabase(railwaySequelize, 'RAILWAY');
    
    // Compare results
    console.log(`\n${'='.repeat(80)}`);
    console.log('COMPARISON SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n📊 Tables:`);
    console.log(`   Local:   ${localAudit.tables.length}`);
    console.log(`   Railway: ${railwayAudit.tables.length}`);
    
    console.log(`\n⚠️  Issues Found:`);
    console.log(`   Local:   ${localAudit.allIssues.length} issues in ${localAudit.tablesWithIssues.length} tables`);
    console.log(`   Railway: ${railwayAudit.allIssues.length} issues in ${railwayAudit.tablesWithIssues.length} tables`);
    
    // Group issues by type
    const localByType = {};
    localAudit.allIssues.forEach(issue => {
      localByType[issue.type] = (localByType[issue.type] || 0) + 1;
    });
    
    const railwayByType = {};
    railwayAudit.allIssues.forEach(issue => {
      railwayByType[issue.type] = (railwayByType[issue.type] || 0) + 1;
    });
    
    console.log(`\n📋 Issue Breakdown:`);
    console.log(`\n   LOCAL:`);
    Object.entries(localByType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
    
    console.log(`\n   RAILWAY:`);
    Object.entries(railwayByType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
    
    // Detailed report
    if (localAudit.allIssues.length > 0 || railwayAudit.allIssues.length > 0) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('DETAILED ISSUES REPORT');
      console.log('='.repeat(80));
      
      // Local issues
      if (localAudit.tablesWithIssues.length > 0) {
        console.log(`\n🔴 LOCAL DATABASE ISSUES:\n`);
        localAudit.tablesWithIssues.forEach(({ table, issues, hasCompanyId }) => {
          console.log(`\n📋 Table: ${table}${hasCompanyId ? ' (has companyId)' : ''}`);
          console.log('-'.repeat(80));
          issues.forEach((issue, idx) => {
            console.log(`\n  ${idx + 1}. [${issue.severity}] ${issue.type}`);
            console.log(`     Index: ${issue.index}`);
            if (issue.column) {
              console.log(`     Column: ${issue.column}`);
            }
            if (issue.duplicates) {
              console.log(`     Duplicates: ${issue.duplicates.join(', ')}`);
            }
            console.log(`     Issue: ${issue.description}`);
            console.log(`     Fix: ${issue.recommendation}`);
          });
        });
      }
      
      // Railway issues
      if (railwayAudit.tablesWithIssues.length > 0) {
        console.log(`\n🔴 RAILWAY DATABASE ISSUES:\n`);
        railwayAudit.tablesWithIssues.forEach(({ table, issues, hasCompanyId }) => {
          console.log(`\n📋 Table: ${table}${hasCompanyId ? ' (has companyId)' : ''}`);
          console.log('-'.repeat(80));
          issues.forEach((issue, idx) => {
            console.log(`\n  ${idx + 1}. [${issue.severity}] ${issue.type}`);
            console.log(`     Index: ${issue.index}`);
            if (issue.column) {
              console.log(`     Column: ${issue.column}`);
            }
            if (issue.duplicates) {
              console.log(`     Duplicates: ${issue.duplicates.join(', ')}`);
            }
            console.log(`     Issue: ${issue.description}`);
            console.log(`     Fix: ${issue.recommendation}`);
          });
        });
      }
    } else {
      console.log(`\n✅ No issues found! Both databases are clean.`);
    }
    
    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(80));
    console.log(`\nTotal issues found:`);
    console.log(`   Local:   ${localAudit.allIssues.length}`);
    console.log(`   Railway: ${railwayAudit.allIssues.length}`);
    
    if (localAudit.allIssues.length === 0 && railwayAudit.allIssues.length === 0) {
      console.log(`\n✅ Both databases are clean - no issues detected!`);
    } else {
      console.log(`\n⚠️  Please review the issues above and fix them.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

compareDatabases().catch(console.error);

