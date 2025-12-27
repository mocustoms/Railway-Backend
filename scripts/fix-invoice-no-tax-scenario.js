#!/usr/bin/env node

/**
 * Fix Invoice with Incorrect Tax Amount
 * 
 * For invoices where user did NOT want tax but tax_amount was incorrectly stored:
 * 1. Removes incorrectly created tax GL entries
 * 2. Sets invoice tax_amount to 0
 * 3. Recalculates invoice totals
 * 
 * Usage: node scripts/fix-invoice-no-tax-scenario.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, GeneralLedger, SalesInvoice, SalesInvoiceItem } = require('../server/models');
const { Op } = require('sequelize');

async function fixInvoiceNoTaxScenario(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`\n🔧 Fixing Invoice: ${invoiceRefNumber} (No Tax Scenario)\n`);
    console.log('='.repeat(80));

    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items'
        }
      ],
      transaction
    });

    if (!invoice) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      await transaction.rollback();
      return;
    }

    console.log(`\n📋 CURRENT INVOICE STATE:`);
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Discount: ${parseFloat(invoice.discount_amount || 0).toFixed(2)}`);
    console.log(`   Tax: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   WHT: ${parseFloat(invoice.total_wht_amount || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);

    // Check if items have tax_id
    let itemsWithTaxId = 0;
    let itemsWithoutTaxId = 0;
    let totalItemTax = 0;

    for (const item of invoice.items || []) {
      const itemTax = parseFloat(item.tax_amount || 0);
      totalItemTax += itemTax;
      if (item.sales_tax_id) {
        itemsWithTaxId++;
      } else {
        itemsWithoutTaxId++;
      }
    }

    console.log(`\n📦 ITEM ANALYSIS:`);
    console.log(`   Items with tax_id: ${itemsWithTaxId}`);
    console.log(`   Items without tax_id: ${itemsWithoutTaxId}`);
    console.log(`   Total item tax amounts: ${totalItemTax.toFixed(2)}`);

    // If items have no tax_id, this is a "no tax" scenario
    if (itemsWithTaxId === 0 && itemsWithoutTaxId > 0) {
      console.log(`\n✅ Confirmed: This is a NO TAX scenario (items have no tax_id)`);
      
      // Check for incorrectly created tax GL entries
      const taxGLEntries = await GeneralLedger.findAll({
        where: {
          reference_number: {
            [Op.like]: `${invoiceRefNumber}-TAX-%`
          }
        },
        transaction
      });

      if (taxGLEntries.length > 0) {
        console.log(`\n⚠️  Found ${taxGLEntries.length} incorrectly created tax GL entries`);
        console.log(`   These will be deleted...`);
        
        for (const entry of taxGLEntries) {
          await entry.destroy({ transaction });
          console.log(`   ✅ Deleted: ${entry.reference_number}`);
        }
      }

      // Recalculate invoice totals (no tax)
      const subtotal = parseFloat(invoice.subtotal || 0);
      const discount = parseFloat(invoice.discount_amount || 0);
      const correctTotal = subtotal - discount; // No tax, no WHT
      const correctBalance = correctTotal - parseFloat(invoice.paid_amount || 0);

      console.log(`\n📊 RECALCULATING INVOICE TOTALS:`);
      console.log(`   Subtotal: ${subtotal.toFixed(2)}`);
      console.log(`   Discount: ${discount.toFixed(2)}`);
      console.log(`   Tax: 0.00 (should be 0)`);
      console.log(`   WHT: 0.00`);
      console.log(`   Correct Total: ${correctTotal.toFixed(2)}`);
      console.log(`   Current Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
      console.log(`   Difference: ${(parseFloat(invoice.total_amount || 0) - correctTotal).toFixed(2)}`);

      // Update invoice
      await invoice.update({
        tax_amount: 0,
        total_wht_amount: 0,
        total_amount: correctTotal,
        balance_amount: correctBalance > 0 ? correctBalance : 0,
        // Recalculate equivalent_amount if needed
        equivalent_amount: correctTotal * parseFloat(invoice.exchange_rate || 1)
      }, { transaction });

      console.log(`\n✅ Invoice updated:`);
      console.log(`   Tax: 0.00`);
      console.log(`   Total: ${correctTotal.toFixed(2)}`);
      console.log(`   Balance: ${correctBalance.toFixed(2)}`);

      // Also update items to ensure tax_amount is 0
      for (const item of invoice.items || []) {
        if (parseFloat(item.tax_amount || 0) > 0) {
          await item.update({
            tax_amount: 0,
            tax_percentage: 0,
            sales_tax_id: null,
            wht_amount: 0,
            wht_tax_id: null
          }, { transaction });
          console.log(`   ✅ Updated item ${item.id}: tax_amount set to 0`);
        }
      }

    } else if (itemsWithTaxId > 0) {
      console.log(`\n⚠️  Some items have tax_id assigned.`);
      console.log(`   This invoice may actually need tax entries.`);
      console.log(`   Please review manually.`);
      await transaction.rollback();
      return;
    }

    await transaction.commit();
    console.log(`\n✅ Invoice fixed successfully!`);
    console.log(`\n💡 Run the analysis script to verify:`);
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
  console.log('Usage: node scripts/fix-invoice-no-tax-scenario.js <invoice_ref_number>');
  console.log('Example: node scripts/fix-invoice-no-tax-scenario.js INV-20251113-0001');
  process.exit(1);
}

fixInvoiceNoTaxScenario(invoiceRefNumber);

