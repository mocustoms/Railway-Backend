const { Sequelize } = require('sequelize');
require('dotenv').config();

// This script simulates the approval by calling the helper directly
// In production, you would call the API endpoint

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

async function approveInvoice() {
  const transaction = await sequelize.transaction();
  
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    const invoiceRef = 'INV-20251110-0006';

    // Get invoice
    const invoice = await sequelize.query(`
      SELECT id, status, "companyId"
      FROM sales_invoices 
      WHERE invoice_ref_number = :invoiceRef
      LIMIT 1;
    `, {
      replacements: { invoiceRef },
      type: Sequelize.QueryTypes.SELECT,
      transaction
    });

    if (invoice.length === 0) {
      console.log('❌ Invoice not found!');
      await transaction.rollback();
      process.exit(1);
    }

    const inv = invoice[0];
    
    if (inv.status === 'approved') {
      console.log('✅ Invoice is already approved!');
      await transaction.rollback();
      return;
    }

    console.log(`📋 Approving invoice: ${invoiceRef}`);
    console.log(`   Invoice ID: ${inv.id}`);
    console.log(`   Current Status: ${inv.status}`);
    console.log(`   Company ID: ${inv.companyId}\n`);

    // For testing, we'll use the API approach
    // But first, let's check if we need a user
    console.log('⚠️  To approve via API, you need to:');
    console.log('   1. Make a PUT request to: /api/sales-invoices/:id/approve');
    console.log('   2. Include authentication token');
    console.log('   3. Include CSRF token\n');
    
    console.log('💡 Alternatively, you can approve it directly from the frontend');
    console.log('   or use a tool like Postman/curl with proper authentication.\n');

    await transaction.rollback();
    
    // Show the invoice ID for API call
    console.log('📝 Invoice ID for API call:', inv.id);
    console.log('   Endpoint: PUT /api/sales-invoices/' + inv.id + '/approve');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

approveInvoice();

