const sequelize = require('../config/database');

async function checkColumn() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    const result = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'product_expiry_dates' 
      AND (column_name LIKE '%company%' OR column_name = 'id')
      ORDER BY column_name
    `, { type: sequelize.QueryTypes.SELECT });

    console.log('\n📋 Columns in product_expiry_dates:');
    result.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkColumn();

