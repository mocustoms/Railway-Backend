const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    const invoices = await sequelize.query(`
      SELECT 
        invoice_ref_number, 
        total_amount, 
        total_wht_amount, 
        tax_amount,
        paid_amount, 
        balance_amount,
        status, 
        payment_status, 
        created_at
      FROM sales_invoices 
      ORDER BY created_at DESC 
      LIMIT 5
    `, {
      type: QueryTypes.SELECT
    });

    console.log('📋 Recent Invoices:');
    console.log('='.repeat(100));
    invoices.forEach((inv, idx) => {
      console.log(`\n${idx + 1}. ${inv.invoice_ref_number}`);
      console.log(`   Total Amount: ${inv.total_amount}`);
      console.log(`   Tax Amount (VAT): ${inv.tax_amount}`);
      console.log(`   WHT Amount: ${inv.total_wht_amount}`);
      console.log(`   Paid Amount: ${inv.paid_amount}`);
      console.log(`   Balance Amount: ${inv.balance_amount}`);
      console.log(`   Status: ${inv.status}`);
      console.log(`   Payment Status: ${inv.payment_status}`);
      console.log(`   Created At: ${inv.created_at}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();

