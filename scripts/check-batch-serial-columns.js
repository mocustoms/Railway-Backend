const sequelize = require('../config/database');

async function checkColumns() {
  try {
    // Check sales_invoice_items
    const invoiceColumns = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_items' 
      AND (column_name LIKE '%serial%' OR column_name LIKE '%batch%' OR column_name LIKE '%expiry%')
      ORDER BY column_name
    `, { type: sequelize.QueryTypes.SELECT });

    console.log('\n📋 Sales Invoice Items columns:');
    if (invoiceColumns.length === 0) {
      console.log('  ❌ No batch/serial columns found!');
    } else {
      invoiceColumns.forEach(c => {
        console.log(`  ✅ ${c.column_name}: ${c.data_type}`);
      });
    }

    // Check sales_order_items
    const orderColumns = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'sales_order_items' 
      AND (column_name LIKE '%serial%' OR column_name LIKE '%batch%' OR column_name LIKE '%expiry%')
      ORDER BY column_name
    `, { type: sequelize.QueryTypes.SELECT });

    console.log('\n📋 Sales Order Items columns:');
    if (orderColumns.length === 0) {
      console.log('  ❌ No batch/serial columns found!');
    } else {
      orderColumns.forEach(c => {
        console.log(`  ✅ ${c.column_name}: ${c.data_type}`);
      });
    }

    // Summary
    console.log('\n📊 Summary:');
    if (invoiceColumns.length === 3 && orderColumns.length === 3) {
      console.log('  ✅ All columns exist! Migrations have been applied.');
    } else {
      console.log('  ⚠️  Missing columns detected. You may need to run migrations.');
      console.log('  Run: npx sequelize-cli db:migrate');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking columns:', error.message);
    process.exit(1);
  }
}

checkColumns();

