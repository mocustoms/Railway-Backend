require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

const COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';

async function countRecords(tableName, companyIdColumn, companyId) {
  try {
    const result = await sequelize.query(
      `SELECT COUNT(*) as count FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId`,
      {
        replacements: { companyId },
        type: QueryTypes.SELECT
      }
    );
    const count = Array.isArray(result) && result.length > 0 && Array.isArray(result[0])
      ? result[0][0]?.count || 0
      : result[0]?.count || 0;
    return parseInt(count) || 0;
  } catch (error) {
    return -1;
  }
}

async function getRecords(tableName, companyIdColumn, companyId, limit = 5) {
  try {
    const result = await sequelize.query(
      `SELECT * FROM "${tableName}" WHERE "${companyIdColumn}" = :companyId LIMIT :limit`,
      {
        replacements: { companyId, limit },
        type: QueryTypes.SELECT
      }
    );
    return Array.isArray(result) && result.length > 0 && Array.isArray(result[0])
      ? result[0]
      : Array.isArray(result) ? result : [result];
  } catch (error) {
    return [];
  }
}

(async () => {
  await sequelize.authenticate();
  console.log('📊 Checking remaining data for company:', COMPANY_ID, '\n');
  
  const tables = [
    { table: 'stores', column: 'companyId', label: 'Stores' },
    { table: 'users', column: 'companyId', label: 'Users' },
    { table: 'accounts', column: 'companyId', label: 'Accounts' },
    { table: 'financial_years', column: 'companyId', label: 'Financial Years' },
    { table: 'customer_groups', column: 'companyId', label: 'Customer Groups' },
    { table: 'linked_accounts', column: 'companyId', label: 'Linked Accounts' },
    { table: 'product_brand_names', column: 'companyId', label: 'Product Brand Names' },
    { table: 'product_manufacturers', column: 'companyId', label: 'Product Manufacturers' },
    { table: 'product_models', column: 'companyId', label: 'Product Models' },
    { table: 'product_colors', column: 'companyId', label: 'Product Colors' },
    { table: 'product_categories', column: 'companyId', label: 'Product Categories' },
    { table: 'packaging', column: 'companyId', label: 'Packaging' },
    { table: 'tax_codes', column: 'companyId', label: 'Tax Codes' },
    { table: 'adjustment_reasons', column: 'companyId', label: 'Adjustment Reasons' },
    { table: 'return_reasons', column: 'companyId', label: 'Return Reasons' },
    { table: 'price_categories', column: 'companyId', label: 'Price Categories' },
    { table: 'currencies', column: 'companyId', label: 'Currencies' },
    { table: 'payment_methods', column: 'companyId', label: 'Payment Methods' },
    { table: 'payment_types', column: 'companyId', label: 'Payment Types' },
  ];
  
  console.log('📋 DATA SUMMARY:');
  console.log('='.repeat(80));
  
  const dataSummary = {};
  
  for (const { table, column, label } of tables) {
    const count = await countRecords(table, column, COMPANY_ID);
    if (count > 0) {
      dataSummary[table] = { label, count, records: await getRecords(table, column, COMPANY_ID, 3) };
      console.log(`\n${label}: ${count} records`);
      if (dataSummary[table].records && dataSummary[table].records.length > 0) {
        const sample = dataSummary[table].records[0];
        const keys = Object.keys(sample).slice(0, 5);
        console.log(`  Sample fields: ${keys.join(', ')}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`Total tables with data: ${Object.keys(dataSummary).length}`);
  
  await sequelize.close();
})();

