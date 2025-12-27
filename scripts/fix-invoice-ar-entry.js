#!/usr/bin/env node

/**
 * Fix Incorrect AR Entry for Invoice
 * 
 * Corrects the AR entry amount to match the invoice balance
 * Usage: node scripts/fix-invoice-ar-entry.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, GeneralLedger, SalesInvoice } = require('../server/models');
const { Op } = require('sequelize');

async function fixInvoiceAREntry(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`\n🔧 Fixing AR Entry for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      transaction
    });

    if (!invoice) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      await transaction.rollback();
      return;
    }

    const invoiceBalance = parseFloat(invoice.balance_amount || invoice.total_amount || 0);
    const invoiceSubtotal = parseFloat(invoice.subtotal || 0);
    const invoiceDiscount = parseFloat(invoice.discount_amount || 0);
    const invoiceTax = parseFloat(invoice.tax_amount || 0);
    const invoiceWHT = parseFloat(invoice.total_wht_amount || 0);
    const invoiceEquivalentAmount = parseFloat(invoice.equivalent_amount || 0);
    const invoiceTotal = parseFloat(invoice.total_amount || 0);
    const exchangeRate = parseFloat(invoice.exchange_rate || 1);

    console.log(`\n📋 INVOICE DETAILS:`);
    console.log(`   Subtotal: ${invoiceSubtotal.toFixed(2)}`);
    console.log(`   Discount: ${invoiceDiscount.toFixed(2)}`);
    console.log(`   Tax: ${invoiceTax.toFixed(2)}`);
    console.log(`   WHT: ${invoiceWHT.toFixed(2)}`);
    console.log(`   Total: ${invoiceTotal.toFixed(2)}`);
    console.log(`   Balance: ${invoiceBalance.toFixed(2)}`);
    console.log(`   Expected Balance: ${(invoiceSubtotal - invoiceDiscount + invoiceTax - invoiceWHT).toFixed(2)}`);

    // Find AR entry
    const arEntry = await GeneralLedger.findOne({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}-AR`
        }
      },
      transaction
    });

    if (!arEntry) {
      console.log(`❌ AR entry not found`);
      await transaction.rollback();
      return;
    }

    const currentARAmount = parseFloat(arEntry.amount || 0);
    const currentAREquivDebit = parseFloat(arEntry.equivalent_debit_amount || 0);
    const currentARUserDebit = parseFloat(arEntry.user_debit_amount || 0);

    console.log(`\n📊 CURRENT AR ENTRY:`);
    console.log(`   Amount (system currency): ${currentARAmount.toFixed(2)}`);
    console.log(`   Equivalent Debit Amount: ${currentAREquivDebit.toFixed(2)}`);
    console.log(`   User Debit Amount: ${currentARUserDebit.toFixed(2)}`);

    // Calculate correct AR amount
    // AR should equal invoice balance_amount
    const correctARAmount = invoiceBalance;
    
    // Calculate equivalent amount proportionally
    const correctARInSystemCurrency = invoiceTotal > 0 && invoiceEquivalentAmount > 0
      ? (correctARAmount / invoiceTotal) * invoiceEquivalentAmount
      : (exchangeRate > 0 ? correctARAmount * exchangeRate : correctARAmount);

    console.log(`\n✅ CORRECT AR AMOUNTS:`);
    console.log(`   Balance Amount (invoice currency): ${correctARAmount.toFixed(2)}`);
    console.log(`   Equivalent Amount (system currency): ${correctARInSystemCurrency.toFixed(2)}`);

    if (Math.abs(currentARAmount - correctARInSystemCurrency) < 0.01) {
      console.log(`\n✅ AR entry is already correct. No changes needed.`);
      await transaction.rollback();
      return;
    }

    // Update AR entry
    await arEntry.update({
      amount: correctARInSystemCurrency,
      user_debit_amount: correctARAmount,
      equivalent_debit_amount: correctARInSystemCurrency,
      description: `Sales Invoice ${invoiceRefNumber} - ${invoice.customer?.full_name || 'Customer'} [CORRECTED]`
    }, { transaction });

    console.log(`\n✅ Updated AR entry:`);
    console.log(`   Old Amount: ${currentARAmount.toFixed(2)} → New Amount: ${correctARInSystemCurrency.toFixed(2)}`);
    console.log(`   Old User Debit: ${currentARUserDebit.toFixed(2)} → New User Debit: ${correctARAmount.toFixed(2)}`);

    await transaction.commit();
    console.log(`\n✅ AR entry corrected successfully!`);
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
  console.log('Usage: node scripts/fix-invoice-ar-entry.js <invoice_ref_number>');
  console.log('Example: node scripts/fix-invoice-ar-entry.js INV-20251113-0001');
  process.exit(1);
}

fixInvoiceAREntry(invoiceRefNumber);

