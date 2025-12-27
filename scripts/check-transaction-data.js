require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

const COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    // Show which database we're connected to
    const dbResult = await sequelize.query('SELECT current_database() as db', { type: QueryTypes.SELECT });
    console.log(`📊 Connected to database: ${dbResult[0].db}\n`);
    
    const tables = ['receipt_transactions', 'loyalty_transactions', 'sales_transactions', 'product_transactions', 'transactions'];
    
    console.log(`Checking transaction data for company: ${COMPANY_ID}\n`);
    console.log('='.repeat(80));
    
    for (const table of tables) {
      try {
        // Check with companyId
        const resultWithCompany = await sequelize.query(
          `SELECT COUNT(*) as count FROM "${table}" WHERE "companyId" = :companyId`,
          {
            replacements: { companyId: COMPANY_ID },
            type: QueryTypes.SELECT
          }
        );
        const countWithCompany = parseInt(resultWithCompany[0]?.count || 0);
        
        // Check all records
        const resultAll = await sequelize.query(
          `SELECT COUNT(*) as count FROM "${table}"`,
          {
            type: QueryTypes.SELECT
          }
        );
        const countAll = parseInt(resultAll[0]?.count || 0);
        
        console.log(`  ${table.padEnd(35)} Total: ${countAll.toString().padStart(6)}, For company: ${countWithCompany.toString().padStart(6)}`);
      } catch (error) {
        console.log(`  ${table.padEnd(35)} Error: ${error.message}`);
      }
    }
    
    console.log('='.repeat(80));
    
    await sequelize.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

