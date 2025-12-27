#!/usr/bin/env node

/**
 * Export initial company data to JSON file
 * This data will be used to initialize new companies
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

const COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';
const OUTPUT_FILE = path.join(__dirname, '../data/initial-company-data.json');

// Tables to export in dependency order
const TABLES_TO_EXPORT = [
  { table: 'stores', column: 'companyId', excludeFields: ['createdBy', 'updatedBy'] },
  { table: 'accounts', column: 'companyId', excludeFields: ['createdBy', 'updatedBy'] },
  { table: 'financial_years', column: 'companyId', excludeFields: ['createdBy', 'updatedBy', 'closedBy'] },
  { table: 'customer_groups', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'linked_accounts', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'product_categories', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'packaging', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'tax_codes', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'adjustment_reasons', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'return_reasons', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'price_categories', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'currencies', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'payment_methods', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
  { table: 'payment_types', column: 'companyId', excludeFields: ['created_by', 'updated_by'] },
];

async function exportTableData(tableName, companyIdColumn, companyId, excludeFields = []) {
  try {
    // Try to get column names first to determine sort field
    const columnsResult = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = :tableName AND column_name IN ('createdAt', 'created_at', 'id')`,
      {
        replacements: { tableName },
        type: QueryTypes.SELECT
      }
    );
    
    const columns = Array.isArray(columnsResult) && columnsResult.length > 0 && Array.isArray(columnsResult[0])
      ? columnsResult[0].map(c => c.column_name)
      : Array.isArray(columnsResult) ? columnsResult.map(c => c.column_name) : [];
    
    const sortField = columns.includes('created_at') ? 'created_at' : columns.includes('createdAt') ? 'createdAt' : 'id';
    
    const result = await sequelize.query(
      `SELECT * FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId ORDER BY "${sortField}" ASC, "id" ASC`,
      {
        replacements: { companyId },
        type: QueryTypes.SELECT
      }
    );
    
    const records = Array.isArray(result) && result.length > 0 && Array.isArray(result[0])
      ? result[0]
      : Array.isArray(result) ? result : [result];
    
    if (!records || records.length === 0) {
      return [];
    }
    
    // Clean records - exclude specified fields (handle both camelCase and snake_case)
    // But keep original ID for mapping purposes (we'll store it as _originalId)
    return records.map(record => {
      if (!record) return null;
      const cleaned = { ...record };
      const originalId = cleaned.id; // Store original ID for mapping
      
      excludeFields.forEach(field => {
        delete cleaned[field];
        // Also try snake_case version
        const snakeField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        delete cleaned[snakeField];
        // And camelCase version
        const camelField = field.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        delete cleaned[camelField];
      });
      // Also exclude common timestamp fields
      delete cleaned.createdAt;
      delete cleaned.updatedAt;
      delete cleaned.created_at;
      delete cleaned.updated_at;
      delete cleaned.id;
      delete cleaned.companyId;
      delete cleaned.company_id;
      
      // Store original ID for foreign key mapping (for accounts, stores, currencies, price_categories, tax_codes, payment_methods)
      if (originalId && (tableName === 'accounts' || tableName === 'stores' || tableName === 'currencies' || tableName === 'price_categories' || tableName === 'tax_codes' || tableName === 'payment_methods')) {
        cleaned._originalId = originalId;
      }
      
      return cleaned;
    }).filter(r => r !== null);
  } catch (error) {
    console.error(`Error exporting ${tableName}:`, error.message);
    return [];
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('📦 Exporting initial company data...\n');
    
    const initialData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      sourceCompanyId: COMPANY_ID,
      tables: {}
    };
    
    console.log('📋 Exporting tables:');
    console.log('='.repeat(80));
    
    for (const { table, column, excludeFields } of TABLES_TO_EXPORT) {
      console.log(`  Exporting ${table}...`);
      const records = await exportTableData(table, column, COMPANY_ID, excludeFields);
      initialData.tables[table] = records;
      console.log(`    ✅ Exported ${records.length} records`);
    }
    
    // Ensure data directory exists
    const dataDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Initial data exported successfully!`);
    console.log(`📁 File: ${OUTPUT_FILE}`);
    console.log(`📊 Total tables: ${Object.keys(initialData.tables).length}`);
    console.log(`📊 Total records: ${Object.values(initialData.tables).reduce((sum, arr) => sum + arr.length, 0)}`);
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

