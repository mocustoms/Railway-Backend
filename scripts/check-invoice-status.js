const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'easymauzo_pos',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function checkInvoiceStatus() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    const invoiceRef = 'INV-20251110-0006';

    const invoice = await sequelize.query(`
      SELECT 
        id, 
        invoice_ref_number, 
        status, 
        approved_by,
        approved_at,
        "companyId"
      FROM sales_invoices 
      WHERE invoice_ref_number = :invoiceRef
      LIMIT 1;
    `, {
      replacements: { invoiceRef },
      type: Sequelize.QueryTypes.SELECT
    });

    if (invoice.length === 0) {
      console.log('❌ Invoice not found!');
      process.exit(1);
    }

    const inv = invoice[0];
    console.log('📄 Invoice Status:');
    console.log(`   Reference: ${inv.invoice_ref_number}`);
    console.log(`   Status: ${inv.status}`);
    console.log(`   Approved By: ${inv.approved_by || 'Not approved'}`);
    console.log(`   Approved At: ${inv.approved_at || 'Not approved'}`);
    console.log(`   Company ID: ${inv.companyId}\n`);

    if (inv.status !== 'approved') {
      console.log('⚠️  Invoice is NOT approved!');
      console.log('   Current status:', inv.status);
      console.log('\n💡 Possible reasons:');
      console.log('   1. Approval endpoint threw an error');
      console.log('   2. Transaction was rolled back');
      console.log('   3. Frontend didn\'t call the endpoint correctly');
      console.log('   4. Check backend server logs for errors\n');
    } else {
      console.log('✅ Invoice is approved!');
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkInvoiceStatus();

