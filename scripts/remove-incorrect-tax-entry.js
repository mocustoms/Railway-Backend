#!/usr/bin/env node

/**
 * Remove Incorrectly Created Tax Entry
 * 
 * Removes the tax entry that was incorrectly created when invoice had no tax
 * Usage: node scripts/remove-incorrect-tax-entry.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, GeneralLedger } = require('../server/models');
const { Op } = require('sequelize');

async function removeIncorrectTaxEntry(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`\n🔧 Removing Incorrect Tax Entry for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    // Find tax entries for this invoice
    const taxEntries = await GeneralLedger.findAll({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}-TAX-%`
        }
      },
      transaction
    });

    if (taxEntries.length === 0) {
      console.log(`✅ No tax entries found. Nothing to remove.`);
      await transaction.rollback();
      return;
    }

    console.log(`\n📋 Found ${taxEntries.length} tax entry/entries:`);
    taxEntries.forEach((entry, index) => {
      console.log(`   ${index + 1}. ${entry.reference_number}`);
      console.log(`      Account: ${entry.account_name} (${entry.account_code})`);
      console.log(`      Amount: ${parseFloat(entry.amount || 0).toFixed(2)}`);
      console.log(`      Created: ${entry.created_at}`);
    });

    // Delete the entries
    const deletedCount = await GeneralLedger.destroy({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}-TAX-%`
        }
      },
      transaction
    });

    await transaction.commit();
    console.log(`\n✅ Removed ${deletedCount} tax entry/entries`);
    console.log(`\n💡 Run the analysis script again to verify the balance:`);
    console.log(`   node scripts/analyze-invoice-gl-balance.js ${invoiceRefNumber}`);

  } catch (error) {
    await transaction.rollback();
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.log('Usage: node scripts/remove-incorrect-tax-entry.js <invoice_ref_number>');
  console.log('Example: node scripts/remove-incorrect-tax-entry.js INV-20251113-0001');
  process.exit(1);
}

removeIncorrectTaxEntry(invoiceRefNumber);

