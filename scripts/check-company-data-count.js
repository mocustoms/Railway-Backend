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

(async () => {
  await sequelize.authenticate();
  console.log('📊 Data counts for company:', COMPANY_ID, '\n');
  
  const tables = [
    { table: 'accounts', column: 'companyId' },
    { table: 'users', column: 'companyId' },
    { table: 'stores', column: 'companyId' },
    { table: 'customer_groups', column: 'companyId' },
    { table: 'linked_accounts', column: 'companyId' },
  ];
  
  for (const { table, column } of tables) {
    const count = await countRecords(table, column, COMPANY_ID);
    console.log(`${table.padEnd(25)} ${count >= 0 ? count : 'Error'}`);
  }
  
  await sequelize.close();
})();

