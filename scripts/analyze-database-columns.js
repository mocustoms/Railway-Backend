#!/usr/bin/env node

/**
 * Database Column Analysis Script
 * 
 * Analyzes column counts, data types, constraints, and settings
 * for all tables in the database schema.
 */

const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../database-schema.json');

if (!fs.existsSync(schemaPath)) {
  console.error('❌ database-schema.json not found!');
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const tables = Object.keys(schema).sort();

console.log('📊 DATABASE COLUMN ANALYSIS');
console.log('='.repeat(80));
console.log(`Total Tables: ${tables.length}\n`);

// Statistics
let totalColumns = 0;
const dataTypeCounts = {};
const nullableCounts = { nullable: 0, notNull: 0 };
const defaultCounts = { withDefault: 0, withoutDefault: 0 };
let uuidCounts = 0;
let enumCounts = 0;

// Table details
const tableDetails = [];

tables.forEach(tableName => {
  const table = schema[tableName];
  const columns = table.columns || [];
  totalColumns += columns.length;
  
  const tableInfo = {
    name: tableName,
    columnCount: columns.length,
    columns: [],
    dataTypes: {},
    nullable: 0,
    notNull: 0,
    withDefault: 0,
    foreignKeys: 0,
    primaryKeys: 0,
    unique: 0
  };
  
  columns.forEach(col => {
    const colInfo = {
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      hasDefault: !!col.column_default,
      default: col.column_default,
      maxLength: col.character_maximum_length,
      precision: col.numeric_precision,
      scale: col.numeric_scale
    };
    
    tableInfo.columns.push(colInfo);
    
    // Count data types
    const typeKey = col.data_type;
    tableInfo.dataTypes[typeKey] = (tableInfo.dataTypes[typeKey] || 0) + 1;
    dataTypeCounts[typeKey] = (dataTypeCounts[typeKey] || 0) + 1;
    
    // Count nullable
    if (col.is_nullable === 'YES') {
      tableInfo.nullable++;
      nullableCounts.nullable++;
    } else {
      tableInfo.notNull++;
      nullableCounts.notNull++;
    }
    
    // Count defaults
    if (col.column_default) {
      tableInfo.withDefault++;
      defaultCounts.withDefault++;
    } else {
      defaultCounts.withoutDefault++;
    }
    
    // Check for UUID
    if (col.udt_name === 'uuid' || col.data_type === 'uuid') {
      // uuidCounts++; // Will count separately
    }
    
    // Check for ENUM (usually in udt_name)
    if (col.udt_name && col.udt_name.startsWith('enum_')) {
      enumCounts++;
    }
  });
  
  tableDetails.push(tableInfo);
});

// Sort by column count (descending)
tableDetails.sort((a, b) => b.columnCount - a.columnCount);

// Print summary
console.log('📈 SUMMARY STATISTICS');
console.log('='.repeat(80));
console.log(`Total Columns: ${totalColumns}`);
console.log(`Average Columns per Table: ${(totalColumns / tables.length).toFixed(1)}`);
console.log(`\nNullable Columns: ${nullableCounts.nullable} (${((nullableCounts.nullable / totalColumns) * 100).toFixed(1)}%)`);
console.log(`NOT NULL Columns: ${nullableCounts.notNull} (${((nullableCounts.notNull / totalColumns) * 100).toFixed(1)}%)`);
console.log(`Columns with Defaults: ${defaultCounts.withDefault} (${((defaultCounts.withDefault / totalColumns) * 100).toFixed(1)}%)`);
console.log(`Columns without Defaults: ${defaultCounts.withoutDefault} (${((defaultCounts.withoutDefault / totalColumns) * 100).toFixed(1)}%)`);
console.log(`ENUM Types: ${enumCounts}`);

// Top data types
console.log('\n📋 TOP DATA TYPES');
console.log('='.repeat(80));
const sortedTypes = Object.entries(dataTypeCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
sortedTypes.forEach(([type, count]) => {
  console.log(`  ${type.padEnd(30)} ${count.toString().padStart(5)} columns (${((count / totalColumns) * 100).toFixed(1)}%)`);
});

// Tables with most columns
console.log('\n📊 TABLES BY COLUMN COUNT');
console.log('='.repeat(80));
console.log('Top 20 Tables:');
tableDetails.slice(0, 20).forEach((table, index) => {
  console.log(`${(index + 1).toString().padStart(2)}. ${table.name.padEnd(40)} ${table.columnCount.toString().padStart(3)} columns`);
});

// Detailed table information
console.log('\n📋 DETAILED TABLE INFORMATION');
console.log('='.repeat(80));

tableDetails.forEach((table, index) => {
  console.log(`\n${index + 1}. ${table.name} (${table.columnCount} columns)`);
  console.log('-'.repeat(80));
  console.log(`   Nullable: ${table.nullable} | NOT NULL: ${table.notNull}`);
  console.log(`   With Defaults: ${table.withDefault} | Without Defaults: ${table.columnCount - table.withDefault}`);
  console.log(`   Data Types: ${Object.keys(table.dataTypes).join(', ')}`);
  
  // Show sample columns
  if (table.columns.length > 0) {
    console.log(`\n   Sample Columns (first 5):`);
    table.columns.slice(0, 5).forEach(col => {
      const nullable = col.nullable ? 'NULL' : 'NOT NULL';
      const defaultStr = col.hasDefault ? ` DEFAULT: ${col.default?.substring(0, 30) || '...'}` : '';
      const length = col.maxLength ? `(${col.maxLength})` : '';
      console.log(`     - ${col.name.padEnd(30)} ${(col.type + length).padEnd(20)} ${nullable}${defaultStr}`);
    });
    if (table.columns.length > 5) {
      console.log(`     ... and ${table.columns.length - 5} more columns`);
    }
  }
});

// Column settings summary
console.log('\n\n⚙️  COLUMN SETTINGS SUMMARY');
console.log('='.repeat(80));
console.log('\nCommon Column Patterns:');

// Find common patterns
const patterns = {
  'ID (Primary Key)': 0,
  'Timestamps (createdAt/updatedAt)': 0,
  'Foreign Keys (companyId, userId, etc.)': 0,
  'Boolean Flags (is_active, is_deleted)': 0,
  'Codes (code, barcode, etc.)': 0,
  'Names (name, title, etc.)': 0,
  'Descriptions (description, notes, etc.)': 0
};

tableDetails.forEach(table => {
  table.columns.forEach(col => {
    const name = col.name.toLowerCase();
    
    if (name === 'id' && !col.nullable) {
      patterns['ID (Primary Key)']++;
    }
    if (name.includes('created') || name.includes('updated')) {
      patterns['Timestamps (createdAt/updatedAt)']++;
    }
    if (name.includes('id') && name !== 'id' && col.type === 'uuid') {
      patterns['Foreign Keys (companyId, userId, etc.)']++;
    }
    if (name.startsWith('is_') || name.startsWith('is')) {
      patterns['Boolean Flags (is_active, is_deleted)']++;
    }
    if (name === 'code' || name === 'barcode') {
      patterns['Codes (code, barcode, etc.)']++;
    }
    if (name === 'name' || name === 'title') {
      patterns['Names (name, title, etc.)']++;
    }
    if (name === 'description' || name === 'notes' || name === 'note') {
      patterns['Descriptions (description, notes, etc.)']++;
    }
  });
});

Object.entries(patterns).forEach(([pattern, count]) => {
  if (count > 0) {
    console.log(`  ${pattern.padEnd(40)} ${count.toString().padStart(4)} columns`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('✅ Analysis complete!');

