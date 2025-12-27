const { sequelize } = require('../server/models');
const { QueryTypes, Op } = require('sequelize');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');

// Mock request object with companyId
const mockReq = {
  user: {
    companyId: process.env.COMPANY_ID || null
  }
};

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Simulate the stats endpoint query
    const whereClause = {};
    const companyWhere = buildCompanyWhere(mockReq, whereClause);

    console.log('🔍 Company Filter:');
    console.log(JSON.stringify(companyWhere, null, 2));
    console.log('');

    const { SalesTransaction } = require('../server/models');
    const [stats] = await sequelize.query(`
      SELECT 
        COUNT(*) as total_count,
        SUM(total_amount) as total_amount,
        SUM(equivalent_amount) as total_equivalent_amount,
        SUM(paid_amount) as total_paid,
        SUM(balance_amount) as total_balance
      FROM sales_transactions
      WHERE ${companyWhere.companyId ? `"companyId" = '${companyWhere.companyId}'` : '1=1'}
    `, { type: QueryTypes.SELECT });

    console.log('📊 Stats Endpoint Results:');
    console.log('='.repeat(80));
    console.log(`Total Count: ${stats.total_count}`);
    console.log(`Total Amount: ${parseFloat(stats.total_amount || 0).toFixed(2)}`);
    console.log(`Total Equivalent Amount: ${parseFloat(stats.total_equivalent_amount || 0).toFixed(2)}`);
    console.log(`Total Paid: ${parseFloat(stats.total_paid || 0).toFixed(2)}`);
    console.log(`Total Balance: ${parseFloat(stats.total_balance || 0).toFixed(2)}`);
    console.log('='.repeat(80));

    // Also check with Sequelize sum
    const sequelizeTotalEquivalent = await SalesTransaction.sum('equivalent_amount', { 
      where: companyWhere 
    });
    console.log(`\nSequelize SUM(equivalent_amount): ${parseFloat(sequelizeTotalEquivalent || 0).toFixed(2)}`);

    // Check all records with companyId
    const [allRecords] = await sequelize.query(`
      SELECT 
        id,
        transaction_ref_number,
        "companyId",
        total_amount,
        equivalent_amount,
        status
      FROM sales_transactions
      ORDER BY created_at DESC
      LIMIT 10
    `, { type: QueryTypes.SELECT });

    console.log('\n📋 All Records (with companyId):');
    console.log('='.repeat(80));
    allRecords.forEach((record, idx) => {
      console.log(`${idx + 1}. ${record.transaction_ref_number || record.id}`);
      console.log(`   CompanyId: ${record.companyId}`);
      console.log(`   Total Amount: ${parseFloat(record.total_amount || 0).toFixed(2)}`);
      console.log(`   Equivalent Amount: ${parseFloat(record.equivalent_amount || 0).toFixed(2)}`);
      console.log(`   Status: ${record.status}`);
    });
    console.log('='.repeat(80));

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();

