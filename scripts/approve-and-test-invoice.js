require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { SalesInvoice } = require('../server/models');
const { QueryTypes } = require('sequelize');
const axios = require('axios');

async function approveAndTestInvoice(invoiceRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // First, check invoice status
    const invoiceResult = await sequelize.query(`
      SELECT 
        id,
        "invoice_ref_number",
        status,
        "total_amount",
        "subtotal",
        "tax_amount",
        "discount_amount",
        "total_wht_amount",
        "paid_amount",
        "balance_amount"
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
    console.log(`   Current Status: ${invoice.status}`);
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Paid: ${parseFloat(invoice.paid_amount || 0).toFixed(2)}`);
    console.log(`   Balance: ${parseFloat(invoice.balance_amount || 0).toFixed(2)}\n`);

    if (invoice.status === 'approved') {
      console.log('⚠️  Invoice is already approved. Testing GL entries...\n');
    } else if (invoice.status === 'draft' || invoice.status === 'sent') {
      console.log(`🔄 Approving invoice...\n`);
      
      // Get a test user for approval (you may need to adjust this)
      const userResult = await sequelize.query(`
        SELECT id, username, "companyId"
        FROM users
        WHERE "companyId" = :companyId
        LIMIT 1
      `, {
        replacements: { companyId: invoice.companyId || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3' },
        type: QueryTypes.SELECT
      });

      if (!userResult || userResult.length === 0) {
        console.log('❌ No user found for approval. Please approve manually via API.');
        await sequelize.close();
        return;
      }

      // For now, we'll use direct database update (not recommended for production)
      // In production, use the API endpoint with proper authentication
      console.log('⚠️  Note: Direct approval via database. For production, use API endpoint with authentication.\n');
      
      // Update invoice status to approved
      await sequelize.query(`
        UPDATE sales_invoices
        SET status = 'approved',
            "approved_at" = NOW(),
            "updated_at" = NOW()
        WHERE id = :invoiceId
      `, {
        replacements: { invoiceId: invoice.id },
        type: QueryTypes.UPDATE
      });

      console.log('✅ Invoice status updated to approved');
      console.log('⚠️  Note: GL entries are created when invoice is approved via API endpoint.');
      console.log('   This script only updates the status. GL entries should be created via the approval route.\n');
    } else {
      console.log(`⚠️  Invoice status is "${invoice.status}". Cannot approve from this status.`);
      console.log('   Only "draft" or "sent" invoices can be approved.\n');
    }

    // Now test the GL entries
    console.log('='.repeat(100));
    console.log('🧪 TESTING GENERAL LEDGER ENTRIES\n');
    
    // Run the test script
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout, stderr } = await execAsync(
        `node scripts/test-invoice-accounts.js ${invoiceRefNumber}`,
        { cwd: __dirname.replace('/scripts', '') }
      );
      console.log(stdout);
      if (stderr) console.error(stderr);
    } catch (error) {
      console.error('Error running test script:', error.message);
      // Fallback: run test inline
      console.log('\nRunning inline test...\n');
      await testInvoiceGL(invoiceRefNumber, sequelize);
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

async function testInvoiceGL(invoiceRefNumber, sequelize) {
  // Simplified inline test
  const glEntries = await sequelize.query(`
    SELECT 
      "account_nature",
      "account_code",
      "account_name",
      amount,
      description
    FROM general_ledger
    WHERE "reference_number" LIKE :pattern
    ORDER BY "account_nature" ASC, "account_name" ASC
  `, {
    replacements: { pattern: `${invoiceRefNumber}%` },
    type: QueryTypes.SELECT
  });

  if (glEntries.length === 0) {
    console.log('❌ No GL entries found. Invoice may need to be approved via API endpoint.');
    return;
  }

  console.log(`Found ${glEntries.length} GL entries:\n`);
  let totalDebit = 0;
  let totalCredit = 0;

  glEntries.forEach((entry, index) => {
    const amount = parseFloat(entry.amount || 0);
    if (entry.account_nature === 'debit') {
      totalDebit += amount;
    } else {
      totalCredit += amount;
    }
    console.log(`${index + 1}. ${entry.account_nature.toUpperCase()}: ${entry.account_code} - ${entry.account_name}`);
    console.log(`   Amount: ${amount.toFixed(2)}`);
    console.log(`   Description: ${entry.description}\n`);
  });

  console.log(`Total Debit: ${totalDebit.toFixed(2)}`);
  console.log(`Total Credit: ${totalCredit.toFixed(2)}`);
  console.log(`Balance: ${(totalDebit - totalCredit).toFixed(2)} ${totalDebit === totalCredit ? '✅ BALANCED' : '❌ NOT BALANCED'}`);
}

const invoiceRefNumber = process.argv[2] || 'INV-20251118-0004';
approveAndTestInvoice(invoiceRefNumber);

