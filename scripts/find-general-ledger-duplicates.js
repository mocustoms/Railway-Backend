const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos',
  {
    logging: false
  }
);

async function findDuplicates() {
  try {
    console.log('🔍 Finding duplicate reference numbers in general_ledger...\n');

    const [duplicates] = await sequelize.query(`
      SELECT 
        "reference_number",
        "companyId",
        COUNT(*) as count,
        array_agg(id ORDER BY "created_at") as ids,
        array_agg("created_at" ORDER BY "created_at") as created_dates
      FROM "general_ledger"
      GROUP BY "reference_number", "companyId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC, "reference_number";
    `);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
      await sequelize.close();
      process.exit(0);
    }

    console.log(`⚠️  Found ${duplicates.length} duplicate group(s):\n`);
    console.log('='.repeat(80));

    for (const dup of duplicates) {
      console.log(`\n📋 Reference: "${dup.reference_number}"`);
      console.log(`   Company ID: ${dup.companyId}`);
      console.log(`   Count: ${dup.count} duplicate(s)`);
      console.log(`   IDs: ${dup.ids.join(', ')}`);
      console.log(`   Created dates: ${dup.created_dates.join(', ')}`);
      
      // Get full details of each duplicate
      const detailsResult = await sequelize.query(`
        SELECT 
          id,
          "reference_number",
          "transaction_date",
          "transaction_type",
          "account_id",
          "account_name",
          "amount",
          "account_nature",
          "created_at"
        FROM "general_ledger"
        WHERE "reference_number" = :refNum AND "companyId" = :companyId
        ORDER BY "created_at";
      `, {
        replacements: { refNum: dup.reference_number, companyId: dup.companyId },
        type: sequelize.QueryTypes.SELECT
      });

      const details = Array.isArray(detailsResult) ? detailsResult : detailsResult[0] || [];
      console.log(`\n   Details:`);
      details.forEach((detail, idx) => {
        console.log(`   ${idx + 1}. ID: ${detail.id}`);
        console.log(`      Date: ${detail.transaction_date}, Type: ${detail.transaction_type}`);
        console.log(`      Account: ${detail.account_name} (${detail.account_id})`);
        console.log(`      Amount: ${detail.amount || 0} (${detail.account_nature || 'N/A'})`);
        console.log(`      Created: ${detail.created_at}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 To fix duplicates, you can:');
    console.log('   1. Keep the oldest record (first created_at)');
    console.log('   2. Keep the most recent record (last created_at)');
    console.log('   3. Manually review and decide which to keep');
    console.log('\n⚠️  Be careful when deleting records - ensure data integrity!');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

findDuplicates();

