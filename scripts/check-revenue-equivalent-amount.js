const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Check sales_transactions equivalent_amount data
    const [stats] = await sequelize.query(`
      SELECT 
        COUNT(*) as total_count,
        COUNT(equivalent_amount) as non_null_count,
        SUM(equivalent_amount) as total_equivalent,
        SUM(total_amount) as total_amount,
        AVG(equivalent_amount) as avg_equivalent,
        MIN(equivalent_amount) as min_equivalent,
        MAX(equivalent_amount) as max_equivalent
      FROM sales_transactions
    `, { type: QueryTypes.SELECT });

    console.log('📊 Sales Transactions Statistics:');
    console.log('='.repeat(80));
    console.log(`Total Records: ${stats.total_count}`);
    console.log(`Records with equivalent_amount: ${stats.non_null_count}`);
    console.log(`Total Equivalent Amount: ${parseFloat(stats.total_equivalent || 0).toFixed(2)}`);
    console.log(`Total Amount: ${parseFloat(stats.total_amount || 0).toFixed(2)}`);
    console.log(`Average Equivalent Amount: ${parseFloat(stats.avg_equivalent || 0).toFixed(2)}`);
    console.log(`Min Equivalent Amount: ${parseFloat(stats.min_equivalent || 0).toFixed(2)}`);
    console.log(`Max Equivalent Amount: ${parseFloat(stats.max_equivalent || 0).toFixed(2)}`);
    console.log('='.repeat(80));

    // Check sample records
    const [samples] = await sequelize.query(`
      SELECT 
        transaction_ref_number,
        total_amount,
        equivalent_amount,
        exchange_rate,
        currency_id,
        status,
        created_at
      FROM sales_transactions
      ORDER BY created_at DESC
      LIMIT 10
    `, { type: QueryTypes.SELECT });

    console.log('\n📋 Sample Records (Last 10):');
    console.log('='.repeat(80));
    if (samples.length > 0) {
      samples.forEach((record, idx) => {
        console.log(`\n${idx + 1}. ${record.transaction_ref_number}`);
        console.log(`   Total Amount: ${parseFloat(record.total_amount || 0).toFixed(2)}`);
        console.log(`   Equivalent Amount: ${parseFloat(record.equivalent_amount || 0).toFixed(2)}`);
        console.log(`   Exchange Rate: ${parseFloat(record.exchange_rate || 1).toFixed(6)}`);
        console.log(`   Status: ${record.status}`);
        console.log(`   Created: ${new Date(record.created_at).toLocaleString()}`);
      });
    } else {
      console.log('   No sales transactions found.');
    }
    console.log('='.repeat(80));

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

