const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    const invoiceRefNumber = process.argv[2] || 'INV-20251114-0001';
    console.log(`🔍 Checking General Ledger entries for invoice: ${invoiceRefNumber}\n`);

    // First, get the invoice details
    const invoices = await sequelize.query(`
      SELECT 
        si.id,
        si."invoice_ref_number",
        si."total_amount",
        si."tax_amount",
        si."total_wht_amount",
        si."paid_amount",
        si."balance_amount",
        si."status",
        si."payment_status"
      FROM sales_invoices si
      WHERE si."invoice_ref_number" = :invoiceRefNumber
      LIMIT 1
    `, {
      replacements: { invoiceRefNumber },
      type: QueryTypes.SELECT
    });

    if (!invoices || invoices.length === 0) {
      console.log('❌ Invoice not found');
      process.exit(1);
    }

    const invoice = invoices[0];
    console.log('📄 Invoice Details:');
    console.log(`   Reference Number: ${invoice.invoice_ref_number}`);
    console.log(`   Total Amount: ${invoice.total_amount}`);
    console.log(`   Tax Amount (VAT): ${invoice.tax_amount}`);
    console.log(`   WHT Amount: ${invoice.total_wht_amount}`);
    console.log(`   Paid Amount: ${invoice.paid_amount}`);
    console.log(`   Balance Amount: ${invoice.balance_amount}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Payment Status: ${invoice.payment_status}\n`);

    // Get invoice items with WHT details
    const invoiceItems = await sequelize.query(`
      SELECT 
        sii.id,
        sii."wht_tax_id",
        sii."wht_amount",
        tc.code as wht_tax_code,
        tc.name as wht_tax_name,
        tc."sales_tax_account_id" as wht_account_id,
        a.code as wht_account_code,
        a.name as wht_account_name
      FROM sales_invoice_items sii
      LEFT JOIN tax_codes tc ON sii."wht_tax_id" = tc.id
      LEFT JOIN accounts a ON tc."sales_tax_account_id" = a.id
      WHERE sii."sales_invoice_id" = :invoiceId
        AND sii."wht_amount" > 0
      ORDER BY sii."created_at" ASC
    `, {
      replacements: { invoiceId: invoice.id },
      type: QueryTypes.SELECT
    });

    if (invoiceItems.length > 0) {
      console.log('📋 Invoice Items with WHT:');
      invoiceItems.forEach((item, idx) => {
        console.log(`   ${idx + 1}. Item ID: ${item.id}`);
        console.log(`      WHT Amount: ${item.wht_amount}`);
        console.log(`      WHT Tax Code: ${item.wht_tax_code || 'N/A'} (${item.wht_tax_name || 'N/A'})`);
        console.log(`      WHT Account: ${item.wht_account_code || 'N/A'} - ${item.wht_account_name || 'N/A'}`);
        console.log('');
      });
    }

    // Get all general ledger entries for this invoice
    const glEntries = await sequelize.query(`
      SELECT 
        gl.id,
        gl."reference_number",
        gl."transaction_type",
        gl."transaction_type_name",
        gl."description",
        gl."account_code",
        gl."account_name",
        gl."account_nature",
        gl."amount",
        gl."user_debit_amount",
        gl."user_credit_amount",
        gl."equivalent_debit_amount",
        gl."equivalent_credit_amount",
        gl."exchange_rate",
        gl."transaction_date",
        gl."created_at"
      FROM general_ledger gl
      WHERE gl."reference_number" = :invoiceRefNumber
      ORDER BY gl."created_at" ASC, gl."account_nature" DESC
    `, {
      replacements: { invoiceRefNumber },
      type: QueryTypes.SELECT
    });

    if (!glEntries || glEntries.length === 0) {
      console.log('⚠️  No general ledger entries found for this invoice.');
      console.log('   This could mean:');
      console.log('   1. Payment has not been recorded yet');
      console.log('   2. General ledger entries were not created');
      process.exit(0);
    }

    console.log('💰 General Ledger Entries:');
    console.log('=' .repeat(100));
    
    let totalDebits = 0;
    let totalCredits = 0;

    glEntries.forEach((entry, idx) => {
      console.log(`\n${idx + 1}. Entry ID: ${entry.id}`);
      console.log(`   Transaction Type: ${entry.transaction_type} - ${entry.transaction_type_name}`);
      console.log(`   Description: ${entry.description}`);
      console.log(`   Account: ${entry.account_code} - ${entry.account_name}`);
      console.log(`   Account Nature: ${entry.account_nature.toUpperCase()}`);
      console.log(`   Amount: ${entry.amount}`);
      console.log(`   Exchange Rate: ${entry.exchange_rate}`);
      
      if (entry.account_nature === 'debit') {
        console.log(`   Debit Amount: ${entry.user_debit_amount || entry.amount}`);
        console.log(`   Equivalent Debit: ${entry.equivalent_debit_amount || (entry.amount * entry.exchange_rate)}`);
        totalDebits += parseFloat(entry.user_debit_amount || entry.amount);
      } else {
        console.log(`   Credit Amount: ${entry.user_credit_amount || entry.amount}`);
        console.log(`   Equivalent Credit: ${entry.equivalent_credit_amount || (entry.amount * entry.exchange_rate)}`);
        totalCredits += parseFloat(entry.user_credit_amount || entry.amount);
      }
      
      console.log(`   Transaction Date: ${entry.transaction_date}`);
      console.log(`   Created At: ${entry.created_at}`);
    });

    console.log('\n' + '='.repeat(100));
    console.log('📊 Summary:');
    console.log(`   Total Debits: ${totalDebits.toFixed(2)}`);
    console.log(`   Total Credits: ${totalCredits.toFixed(2)}`);
    console.log(`   Balance: ${(totalDebits - totalCredits).toFixed(2)} ${totalDebits === totalCredits ? '✅ Balanced' : '❌ Not Balanced'}`);

    // Check for WHT entries specifically
    const whtEntries = glEntries.filter(e => 
      e.transaction_type_name && e.transaction_type_name.includes('WHT')
    );

    if (whtEntries.length > 0) {
      console.log(`\n📋 WHT Entries Found: ${whtEntries.length}`);
      whtEntries.forEach((entry, idx) => {
        console.log(`   ${idx + 1}. ${entry.account_code} - ${entry.account_name}: ${entry.amount} (${entry.account_nature})`);
      });
    } else if (invoice.total_wht_amount > 0) {
      console.log(`\n⚠️  WARNING: Invoice has WHT amount (${invoice.total_wht_amount}) but no WHT entries found in general ledger!`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();
