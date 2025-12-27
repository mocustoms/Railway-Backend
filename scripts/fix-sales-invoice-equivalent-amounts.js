/**
 * Script to fix equivalent_amount values for existing sales invoices
 * Recalculates equivalent_amount = total_amount * exchange_rate for all invoices
 * 
 * Usage: node scripts/fix-sales-invoice-equivalent-amounts.js [--dry-run]
 */

const sequelize = require('../config/database');
const { SalesInvoice } = require('../server/models');

async function fixEquivalentAmounts(dryRun = false) {
  try {
    console.log('🔧 Fixing Sales Invoice Equivalent Amounts');
    console.log('='.repeat(60));
    
    if (dryRun) {
      console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    }

    // Find all invoices
    const invoices = await SalesInvoice.findAll({
      attributes: ['id', 'invoice_ref_number', 'total_amount', 'exchange_rate', 'equivalent_amount', 'companyId']
    });

    console.log(`📊 Found ${invoices.length} invoices to check\n`);

    let updatedCount = 0;
    let errorCount = 0;
    const updates = [];

    for (const invoice of invoices) {
      try {
        const totalAmount = parseFloat(invoice.total_amount || 0);
        const exchangeRate = parseFloat(invoice.exchange_rate || 1);
        const currentEquivalentAmount = parseFloat(invoice.equivalent_amount || 0);
        
        // Calculate correct equivalent amount
        const correctEquivalentAmount = totalAmount * exchangeRate;

        // Check if update is needed
        const needsUpdate = Math.abs(currentEquivalentAmount - correctEquivalentAmount) > 0.01; // Allow 0.01 tolerance for rounding

        if (needsUpdate) {
          updates.push({
            id: invoice.id,
            invoiceRefNumber: invoice.invoice_ref_number,
            totalAmount,
            exchangeRate,
            currentEquivalentAmount,
            correctEquivalentAmount,
            difference: correctEquivalentAmount - currentEquivalentAmount
          });

          if (!dryRun) {
            await SalesInvoice.update(
              { equivalent_amount: correctEquivalentAmount },
              { where: { id: invoice.id } }
            );
          }

          updatedCount++;
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing invoice ${invoice.invoice_ref_number}:`, error.message);
      }
    }

    // Display results
    if (updates.length > 0) {
      console.log(`\n📋 Invoices that need updating (${updates.length}):\n`);
      
      // Group by company for better readability
      const byCompany = {};
      for (const update of updates) {
        const invoice = invoices.find(inv => inv.id === update.id);
        const companyId = invoice?.companyId || 'Unknown';
        if (!byCompany[companyId]) {
          byCompany[companyId] = [];
        }
        byCompany[companyId].push(update);
      }

      for (const [companyId, companyUpdates] of Object.entries(byCompany)) {
        console.log(`\n🏢 Company: ${companyId} (${companyUpdates.length} invoices)`);
        console.log('-'.repeat(60));
        
        // Show first 10, then summary
        const toShow = companyUpdates.slice(0, 10);
        for (const update of toShow) {
          console.log(`  ${update.invoiceRefNumber}:`);
          console.log(`    Total Amount: ${update.totalAmount.toFixed(2)}`);
          console.log(`    Exchange Rate: ${update.exchangeRate.toFixed(6)}`);
          console.log(`    Current Equivalent: ${update.currentEquivalentAmount.toFixed(2)}`);
          console.log(`    Correct Equivalent: ${update.correctEquivalentAmount.toFixed(2)}`);
          console.log(`    Difference: ${update.difference > 0 ? '+' : ''}${update.difference.toFixed(2)}`);
        }
        
        if (companyUpdates.length > 10) {
          console.log(`  ... and ${companyUpdates.length - 10} more invoices`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log(`✅ Summary:`);
      console.log(`   Total invoices checked: ${invoices.length}`);
      console.log(`   Invoices to update: ${updatedCount}`);
      console.log(`   Errors: ${errorCount}`);
      
      if (dryRun) {
        console.log(`\n⚠️  DRY RUN - No changes were made`);
        console.log(`   Run without --dry-run to apply changes`);
      } else {
        console.log(`\n✅ Successfully updated ${updatedCount} invoices`);
      }
    } else {
      console.log(`\n✅ All invoices already have correct equivalent_amount values!`);
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

fixEquivalentAmounts(dryRun).catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

