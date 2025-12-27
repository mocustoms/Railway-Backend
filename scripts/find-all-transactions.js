require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    // Find all tables with 'transaction' in the name
    const allTables = await sequelize.query(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_name LIKE '%transaction%'
       ORDER BY table_name`,
      { type: QueryTypes.SELECT }
    );
    
    console.log('📋 All transaction-related tables:');
    console.log('='.repeat(80));
    
    for (const { table_name } of allTables) {
      try {
        const count = await sequelize.query(
          `SELECT COUNT(*) as cnt FROM "${table_name}"`,
          { type: QueryTypes.SELECT }
        );
        const total = parseInt(count[0]?.cnt || 0);
        
        // Check if table has companyId column
        const hasCompanyId = await sequelize.query(
          `SELECT column_name 
           FROM information_schema.columns 
           WHERE table_schema = 'public' 
           AND table_name = :tableName 
           AND column_name IN ('companyId', 'company_id')`,
          {
            replacements: { tableName: table_name },
            type: QueryTypes.SELECT
          }
        );
        
        let companyCount = 0;
        if (hasCompanyId && hasCompanyId.length > 0) {
          const companyIdCol = hasCompanyId[0].column_name;
          const companyResult = await sequelize.query(
            `SELECT COUNT(*) as cnt FROM "${table_name}" WHERE "${companyIdCol}" = '4e42f29c-4b11-48a3-a74a-ba4f26c138e3'`,
            { type: QueryTypes.SELECT }
          );
          companyCount = parseInt(companyResult[0]?.cnt || 0);
        }
        
        if (total > 0) {
          console.log(`  ${table_name.padEnd(40)} Total: ${total.toString().padStart(6)}${hasCompanyId && hasCompanyId.length > 0 ? `, Company: ${companyCount.toString().padStart(6)}` : ', No companyId column'}`);
        }
      } catch (error) {
        console.log(`  ${table_name.padEnd(40)} Error: ${error.message}`);
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









