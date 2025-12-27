const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Check if table exists and get count
    const [tableCheck] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'sales_transactions'
    `, { type: QueryTypes.SELECT });
    
    console.log('Table exists:', tableCheck[0]?.count > 0 ? 'Yes' : 'No');
    console.log('');

    // Get raw count
    const [rawCount] = await sequelize.query('SELECT COUNT(*) as count FROM sales_transactions', { type: QueryTypes.SELECT });
    console.log('Raw count:', rawCount[0]?.count || 0);
    console.log('');

    // Get all records without any filters
    const allRecords = await sequelize.query(`
      SELECT 
        id,
        transaction_ref_number,
        "companyId",
        total_amount,
        equivalent_amount,
        status
      FROM sales_transactions
      LIMIT 10
    `, { type: QueryTypes.SELECT });

    console.log('📋 Raw Records (first 10):');
    console.log('='.repeat(80));
    if (allRecords && allRecords.length > 0) {
      allRecords.forEach((record, idx) => {
        console.log(`${idx + 1}. ${JSON.stringify(record, null, 2)}`);
      });
    } else {
      console.log('   No records found');
    }
    console.log('='.repeat(80));

    // Test Sequelize sum
    const { SalesTransaction } = require('../server/models');
    const sumResult = await SalesTransaction.sum('equivalent_amount');
    console.log('\nSequelize.sum(equivalent_amount):', sumResult);
    console.log('Type:', typeof sumResult);
    console.log('Is null?', sumResult === null);
    console.log('Is undefined?', sumResult === undefined);

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();

