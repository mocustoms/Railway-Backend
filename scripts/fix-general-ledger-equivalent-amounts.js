/**
 * Script to fix equivalent_debit_amount and equivalent_credit_amount values 
 * in general ledger entries for sales invoices
 * 
 * Recalculates based on invoice's equivalent_amount proportionally
 * 
 * Usage: node scripts/fix-general-ledger-equivalent-amounts.js [--dry-run]
 */

const sequelize = require('../config/database');
const { GeneralLedger, SalesInvoice } = require('../server/models');
const { Op } = require('sequelize');

async function fixGeneralLedgerEquivalentAmounts(dryRun = false) {
  try {
    console.log('🔧 Fixing General Ledger Equivalent Amounts for Sales Invoices');
    console.log('='.repeat(60));
    
    if (dryRun) {
      console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    }

    // Find all GL entries for sales invoices
    const glEntries = await GeneralLedger.findAll({
      where: {
        transaction_type: 'SALES_INVOICE'
      },
      attributes: [
        'id',
        'reference_number',
        'account_nature',
        'amount',
        'user_debit_amount',
        'user_credit_amount',
        'equivalent_debit_amount',
        'equivalent_credit_amount',
        'exchange_rate',
        'companyId'
      ],
      order: [['reference_number', 'ASC']]
    });

    console.log(`📊 Found ${glEntries.length} GL entries for sales invoices\n`);

    // Extract invoice reference numbers from GL entry reference numbers
    // Format: INV-20251110-0007-AR, INV-20251110-0007-REV, etc.
    // Invoice ref format: INV-YYYYMMDD-XXXX (3 parts separated by dashes)
    const invoiceRefNumbers = new Set();
    for (const entry of glEntries) {
      // Match invoice ref: INV-YYYYMMDD-XXXX (before the last dash and suffix)
      const match = entry.reference_number.match(/^(INV-\d{8}-\d+)/);
      if (match) {
        invoiceRefNumbers.add(match[1]);
      }
    }

    console.log(`📋 Found ${invoiceRefNumbers.size} unique invoices\n`);

    // Get all invoices
    const invoices = await SalesInvoice.findAll({
      where: {
        invoice_ref_number: {
          [Op.in]: Array.from(invoiceRefNumbers)
        }
      },
      attributes: ['id', 'invoice_ref_number', 'total_amount', 'subtotal', 'discount_amount', 'tax_amount', 'total_wht_amount', 'balance_amount', 'equivalent_amount', 'exchange_rate', 'companyId']
    });

    // Create a map for quick lookup
    const invoiceMap = new Map();
    for (const invoice of invoices) {
      invoiceMap.set(invoice.invoice_ref_number, invoice);
    }

    let updatedCount = 0;
    let errorCount = 0;
    const updates = [];

    // Process each GL entry
    for (const entry of glEntries) {
      try {
        // Extract invoice reference number
        // Format: INV-YYYYMMDD-XXXX-AR, INV-YYYYMMDD-XXXX-REV, etc.
        const match = entry.reference_number.match(/^(INV-\d{8}-\d+)/);
        if (!match) {
          continue; // Skip if we can't extract invoice ref
        }

        const invoiceRefNumber = match[1];
        const invoice = invoiceMap.get(invoiceRefNumber);

        if (!invoice) {
          console.warn(`⚠️  Invoice ${invoiceRefNumber} not found for GL entry ${entry.reference_number}`);
          continue;
        }

        // Determine which component this GL entry represents based on reference number suffix
        const suffix = entry.reference_number.replace(invoiceRefNumber + '-', '');
        let componentAmount = 0;
        let componentName = '';

        if (suffix.startsWith('COGS-') || suffix.startsWith('INV-')) {
          // COGS/Inventory entries - these are calculated, skip for now
          continue;
        } else if (suffix === 'AR') {
          componentAmount = parseFloat(invoice.balance_amount || invoice.total_amount || 0);
          componentName = 'Accounts Receivable';
        } else if (suffix === 'REV') {
          componentAmount = parseFloat(invoice.subtotal || 0);
          componentName = 'Sales Revenue';
        } else if (suffix === 'DISC') {
          componentAmount = parseFloat(invoice.discount_amount || 0);
          componentName = 'Discount Allowed';
        } else if (suffix === 'TAX') {
          componentAmount = parseFloat(invoice.tax_amount || 0);
          componentName = 'Tax Payable';
        } else if (suffix === 'WHT') {
          componentAmount = parseFloat(invoice.total_wht_amount || 0);
          componentName = 'WHT Receivable';
        } else {
          // Unknown component, skip
          continue;
        }

        if (componentAmount === 0) {
          continue; // Skip zero amounts
        }

        // Calculate correct equivalent amount proportionally
        const totalAmount = parseFloat(invoice.total_amount || 0);
        const invoiceEquivalentAmount = parseFloat(invoice.equivalent_amount || 0);
        
        if (totalAmount === 0 || invoiceEquivalentAmount === 0) {
          continue; // Skip if invoice has no amounts
        }

        // Calculate equivalent amount proportionally
        const correctEquivalentAmount = (componentAmount / totalAmount) * invoiceEquivalentAmount;

        // Get current equivalent amount from GL entry
        const currentEquivalentAmount = entry.account_nature === 'debit'
          ? parseFloat(entry.equivalent_debit_amount || 0)
          : parseFloat(entry.equivalent_credit_amount || 0);

        // Check if update is needed (allow 0.01 tolerance for rounding)
        const needsUpdate = Math.abs(currentEquivalentAmount - correctEquivalentAmount) > 0.01;

        if (needsUpdate) {
          updates.push({
            id: entry.id,
            referenceNumber: entry.reference_number,
            componentName,
            invoiceRefNumber,
            componentAmount,
            totalAmount,
            invoiceEquivalentAmount,
            currentEquivalentAmount,
            correctEquivalentAmount,
            difference: correctEquivalentAmount - currentEquivalentAmount,
            accountNature: entry.account_nature
          });

          if (!dryRun) {
            const updateData = {};
            if (entry.account_nature === 'debit') {
              updateData.equivalent_debit_amount = correctEquivalentAmount;
            } else {
              updateData.equivalent_credit_amount = correctEquivalentAmount;
            }

            // Also update the amount field to match
            updateData.amount = correctEquivalentAmount;

            await GeneralLedger.update(updateData, {
              where: { id: entry.id }
            });
          }

          updatedCount++;
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing GL entry ${entry.reference_number}:`, error.message);
      }
    }

    // Display results
    if (updates.length > 0) {
      console.log(`\n📋 GL Entries that need updating (${updates.length}):\n`);

      // Group by invoice for better readability
      const byInvoice = {};
      for (const update of updates) {
        if (!byInvoice[update.invoiceRefNumber]) {
          byInvoice[update.invoiceRefNumber] = [];
        }
        byInvoice[update.invoiceRefNumber].push(update);
      }

      for (const [invoiceRef, invoiceUpdates] of Object.entries(byInvoice)) {
        console.log(`\n📄 Invoice: ${invoiceRef} (${invoiceUpdates.length} entries)`);
        console.log('-'.repeat(60));
        
        for (const update of invoiceUpdates) {
          console.log(`  ${update.referenceNumber} (${update.componentName}):`);
          console.log(`    Component Amount: ${update.componentAmount.toFixed(2)}`);
          console.log(`    Current Equivalent: ${update.currentEquivalentAmount.toFixed(2)}`);
          console.log(`    Correct Equivalent: ${update.correctEquivalentAmount.toFixed(2)}`);
          console.log(`    Difference: ${update.difference > 0 ? '+' : ''}${update.difference.toFixed(2)}`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log(`✅ Summary:`);
      console.log(`   Total GL entries checked: ${glEntries.length}`);
      console.log(`   GL entries to update: ${updatedCount}`);
      console.log(`   Errors: ${errorCount}`);
      
      if (dryRun) {
        console.log(`\n⚠️  DRY RUN - No changes were made`);
        console.log(`   Run without --dry-run to apply changes`);
      } else {
        console.log(`\n✅ Successfully updated ${updatedCount} GL entries`);
      }
    } else {
      console.log(`\n✅ All GL entries already have correct equivalent amounts!`);
      console.log(`   No updates needed.`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

fixGeneralLedgerEquivalentAmounts(dryRun).catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

