const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Check for invoices with WHT or TAX suffixes
    const invoicesWithSuffix = await sequelize.query(`
      SELECT 
        invoice_ref_number,
        total_wht_amount,
        tax_amount,
        created_at
      FROM sales_invoices 
      WHERE invoice_ref_number LIKE '%WHT%' 
         OR invoice_ref_number LIKE '%TAX%'
         OR invoice_ref_number LIKE '%-%'
      ORDER BY created_at DESC 
      LIMIT 20
    `, {
      type: QueryTypes.SELECT
    });

    console.log('📋 Invoices with WHT/TAX suffixes or dashes:');
    console.log('='.repeat(100));
    if (invoicesWithSuffix.length > 0) {
      invoicesWithSuffix.forEach((inv, idx) => {
        console.log(`${idx + 1}. ${inv.invoice_ref_number}`);
        console.log(`   WHT: ${inv.total_wht_amount}, TAX: ${inv.tax_amount}`);
        console.log(`   Created: ${inv.created_at}\n`);
      });
    } else {
      console.log('No invoices found with WHT/TAX suffixes\n');
    }

    // Check the specific invoice
    const specificInvoice = await sequelize.query(`
      SELECT 
        invoice_ref_number,
        total_wht_amount,
        tax_amount
      FROM sales_invoices 
      WHERE invoice_ref_number = 'INV-20251114-0001'
    `, {
      type: QueryTypes.SELECT
    });

    console.log('📄 Invoice INV-20251114-0001:');
    if (specificInvoice.length > 0) {
      console.log(`   Reference: ${specificInvoice[0].invoice_ref_number}`);
      console.log(`   WHT: ${specificInvoice[0].total_wht_amount}`);
      console.log(`   TAX: ${specificInvoice[0].tax_amount}`);
    } else {
      console.log('   Not found');
    }

    // Check general ledger entries for reference numbers with suffixes
    const glEntries = await sequelize.query(`
      SELECT DISTINCT
        reference_number,
        transaction_type_name,
        COUNT(*) as entry_count
      FROM general_ledger 
      WHERE reference_number LIKE '%WHT%' 
         OR reference_number LIKE '%TAX%'
         OR reference_number LIKE 'INV-20251114-0001%'
      GROUP BY reference_number, transaction_type_name
      ORDER BY reference_number DESC
      LIMIT 20
    `, {
      type: QueryTypes.SELECT
    });

    console.log('\n💰 General Ledger Entries with WHT/TAX suffixes:');
    console.log('='.repeat(100));
    if (glEntries.length > 0) {
      glEntries.forEach((entry, idx) => {
        console.log(`${idx + 1}. ${entry.reference_number}`);
        console.log(`   Type: ${entry.transaction_type_name}`);
        console.log(`   Entries: ${entry.entry_count}\n`);
      });
    } else {
      console.log('No GL entries found with WHT/TAX suffixes\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();

