const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Check all sales_transactions with companyId
    const [allRecords] = await sequelize.query(`
      SELECT 
        id,
        transaction_ref_number,
        "companyId",
        total_amount,
        equivalent_amount,
        status,
        created_at
      FROM sales_transactions
      ORDER BY created_at DESC
    `, { type: QueryTypes.SELECT });

    console.log('📋 All Sales Transactions:');
    console.log('='.repeat(80));
    if (allRecords && allRecords.length > 0) {
      allRecords.forEach((record, idx) => {
        console.log(`\n${idx + 1}. ${record.transaction_ref_number || record.id}`);
        console.log(`   CompanyId: ${record.companyId || 'NULL'}`);
        console.log(`   Total Amount: ${parseFloat(record.total_amount || 0).toFixed(2)}`);
        console.log(`   Equivalent Amount: ${parseFloat(record.equivalent_amount || 0).toFixed(2)}`);
        console.log(`   Status: ${record.status}`);
        console.log(`   Created: ${new Date(record.created_at).toLocaleString()}`);
      });
    } else {
      console.log('   No sales transactions found.');
    }
    console.log('='.repeat(80));

    // Check stats by companyId
    const [companyStats] = await sequelize.query(`
      SELECT 
        "companyId",
        COUNT(*) as count,
        SUM(total_amount) as total_amount,
        SUM(equivalent_amount) as total_equivalent_amount
      FROM sales_transactions
      GROUP BY "companyId"
    `, { type: QueryTypes.SELECT });

    console.log('\n📊 Stats by CompanyId:');
    console.log('='.repeat(80));
    if (companyStats && companyStats.length > 0) {
      companyStats.forEach((stat, idx) => {
        console.log(`\n${idx + 1}. CompanyId: ${stat.companyId || 'NULL'}`);
        console.log(`   Count: ${stat.count}`);
        console.log(`   Total Amount: ${parseFloat(stat.total_amount || 0).toFixed(2)}`);
        console.log(`   Total Equivalent Amount: ${parseFloat(stat.total_equivalent_amount || 0).toFixed(2)}`);
      });
    } else {
      console.log('   No data found.');
    }
    console.log('='.repeat(80));

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();

