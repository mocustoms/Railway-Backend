require('dotenv').config();
const path = require('path');
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function approveInvoiceSimple(invoiceRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to LOCAL database\n');

    // Get invoice details
    const invoiceResult = await sequelize.query(`
      SELECT 
        id,
        "invoice_ref_number",
        status,
        "subtotal",
        "total_amount",
        "companyId"
      FROM sales_invoices
      WHERE "invoice_ref_number" = :invoiceRefNumber
      LIMIT 1
    `, {
      replacements: { invoiceRefNumber },
      type: QueryTypes.SELECT
    });

    if (!invoiceResult || invoiceResult.length === 0) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      await sequelize.close();
      return;
    }

    const invoice = invoiceResult[0];
    console.log(`📄 Invoice: ${invoice.invoice_ref_number}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}\n`);

    if (invoice.status === 'approved') {
      console.log('✅ Invoice is already approved!\n');
    } else if (invoice.status === 'sent' || invoice.status === 'draft') {
      console.log('⚠️  To approve this invoice, please use the API endpoint:');
      console.log(`   PUT /api/sales-invoices/${invoice.id}/approve`);
      console.log('\n   Or approve it through the frontend application.\n');
      console.log('   The approval process will:');
      console.log('   1. Create General Ledger entries');
      console.log('   2. Update inventory');
      console.log('   3. Update customer balances');
      console.log('   4. Create sales transactions\n');
    } else {
      console.log(`⚠️  Invoice status is "${invoice.status}". Cannot approve from this status.\n`);
    }

    // Test GL entries if approved
    if (invoice.status === 'approved') {
      console.log('='.repeat(100));
      console.log('🧪 TESTING GENERAL LEDGER ENTRIES\n');
      
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        const scriptPath = path.join(__dirname, 'test-invoice-accounts.js');
        const { stdout } = await execAsync(
          `node "${scriptPath}" ${invoiceRefNumber}`,
          { cwd: path.join(__dirname, '..') }
        );
        console.log(stdout);
      } catch (error) {
        console.error('Error running test:', error.message);
      }
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

const invoiceRefNumber = process.argv[2] || 'INV-20251118-0004';
approveInvoiceSimple(invoiceRefNumber);

