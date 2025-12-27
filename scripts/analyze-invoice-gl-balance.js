#!/usr/bin/env node

/**
 * Analyze Invoice General Ledger Balance
 * 
 * Checks if GL entries for an invoice are balanced
 * Usage: node scripts/analyze-invoice-gl-balance.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, GeneralLedger, SalesInvoice, SalesInvoiceItem } = require('../server/models');
const { Op } = require('sequelize');

async function analyzeInvoiceGL(invoiceRefNumber) {
  try {
    console.log(`\n🔍 Analyzing Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    // Find the invoice
    const invoice = await SalesInvoice.findOne({
      where: {
        invoice_ref_number: invoiceRefNumber
      },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items'
        }
      ]
    });

    if (!invoice) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      return;
    }

    console.log(`\n📋 INVOICE DETAILS:`);
    console.log(`   ID: ${invoice.id}`);
    console.log(`   Reference: ${invoice.invoice_ref_number}`);
    console.log(`   Date: ${invoice.invoice_date}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Discount: ${parseFloat(invoice.discount_amount || 0).toFixed(2)}`);
    console.log(`   Tax: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   WHT: ${parseFloat(invoice.total_wht_amount || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Balance: ${parseFloat(invoice.balance_amount || invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Equivalent Amount: ${parseFloat(invoice.equivalent_amount || 0).toFixed(2)}`);
    console.log(`   Exchange Rate: ${parseFloat(invoice.exchange_rate || 1).toFixed(6)}`);

    // Get all GL entries for this invoice
    // GL entries use reference_number like: INV-YYYYMMDD-XXXX-AR, INV-YYYYMMDD-XXXX-REV, etc.
    const glEntries = await GeneralLedger.findAll({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}%`
        }
      },
      order: [['reference_number', 'ASC']]
    });

    if (glEntries.length === 0) {
      console.log(`\n⚠️  No General Ledger entries found for this invoice`);
      console.log(`   This invoice may not have been approved yet.`);
      return;
    }

    console.log(`\n📊 GENERAL LEDGER ENTRIES (${glEntries.length}):`);
    console.log('-'.repeat(80));
    console.log(`${'Reference'.padEnd(30)} ${'Account'.padEnd(30)} ${'Nature'.padEnd(10)} ${'Amount'.padEnd(15)} ${'Equiv Amount'.padEnd(15)}`);
    console.log('-'.repeat(80));

    let totalDebits = 0;
    let totalCredits = 0;
    let totalEquivDebits = 0;
    let totalEquivCredits = 0;

    const entriesByType = {
      COGS: [],
      Inventory: [],
      AR: [],
      Revenue: [],
      Discount: [],
      Tax: [],
      WHT: []
    };

    for (const entry of glEntries) {
      const amount = parseFloat(entry.amount || 0);
      const equivAmount = parseFloat(entry.equivalent_debit_amount || entry.equivalent_credit_amount || 0);
      const nature = entry.account_nature || 'unknown';
      const accountName = entry.account_name || entry.account_code || 'Unknown';
      const ref = entry.reference_number || 'Unknown';

      // Categorize entry
      if (ref.includes('-COGS-')) {
        entriesByType.COGS.push(entry);
      } else if (ref.includes('-INV-')) {
        entriesByType.Inventory.push(entry);
      } else if (ref.includes('-AR')) {
        entriesByType.AR.push(entry);
      } else if (ref.includes('-REV')) {
        entriesByType.Revenue.push(entry);
      } else if (ref.includes('-DISC')) {
        entriesByType.Discount.push(entry);
      } else if (ref.includes('-TAX-')) {
        entriesByType.Tax.push(entry);
      } else if (ref.includes('-WHT-')) {
        entriesByType.WHT.push(entry);
      }

      if (nature === 'debit') {
        totalDebits += amount;
        totalEquivDebits += equivAmount;
      } else if (nature === 'credit') {
        totalCredits += amount;
        totalEquivCredits += equivAmount;
      }

      console.log(`${ref.padEnd(30)} ${accountName.substring(0, 29).padEnd(30)} ${nature.padEnd(10)} ${amount.toFixed(2).padStart(15)} ${equivAmount.toFixed(2).padStart(15)}`);
    }

    console.log('-'.repeat(80));
    console.log(`\n📈 SUMMARY BY TYPE:`);
    console.log(`   COGS Entries: ${entriesByType.COGS.length}`);
    console.log(`   Inventory Entries: ${entriesByType.Inventory.length}`);
    console.log(`   AR Entries: ${entriesByType.AR.length}`);
    console.log(`   Revenue Entries: ${entriesByType.Revenue.length}`);
    console.log(`   Discount Entries: ${entriesByType.Discount.length}`);
    console.log(`   Tax Entries: ${entriesByType.Tax.length}`);
    console.log(`   WHT Entries: ${entriesByType.WHT.length}`);

    console.log(`\n💰 BALANCE CHECK (System Currency):`);
    console.log(`   Total Debits: ${totalDebits.toFixed(2)}`);
    console.log(`   Total Credits: ${totalCredits.toFixed(2)}`);
    console.log(`   Difference: ${(totalDebits - totalCredits).toFixed(2)}`);
    
    if (Math.abs(totalDebits - totalCredits) < 0.01) {
      console.log(`   ✅ BALANCED`);
    } else {
      console.log(`   ❌ NOT BALANCED (Difference: ${(totalDebits - totalCredits).toFixed(2)})`);
    }

    console.log(`\n💰 BALANCE CHECK (Equivalent Amounts):`);
    console.log(`   Total Equiv Debits: ${totalEquivDebits.toFixed(2)}`);
    console.log(`   Total Equiv Credits: ${totalEquivCredits.toFixed(2)}`);
    console.log(`   Difference: ${(totalEquivDebits - totalEquivCredits).toFixed(2)}`);
    
    if (Math.abs(totalEquivDebits - totalEquivCredits) < 0.01) {
      console.log(`   ✅ BALANCED`);
    } else {
      console.log(`   ❌ NOT BALANCED (Difference: ${(totalEquivDebits - totalEquivCredits).toFixed(2)})`);
    }

    // Expected equation: AR = REV - DISC + TAX - WHT
    const arAmount = entriesByType.AR.reduce((sum, e) => sum + parseFloat(e.equivalent_debit_amount || 0), 0);
    const revAmount = entriesByType.Revenue.reduce((sum, e) => sum + parseFloat(e.equivalent_credit_amount || 0), 0);
    const discAmount = entriesByType.Discount.reduce((sum, e) => sum + parseFloat(e.equivalent_debit_amount || 0), 0);
    const taxAmount = entriesByType.Tax.reduce((sum, e) => sum + parseFloat(e.equivalent_credit_amount || 0), 0);
    const whtAmount = entriesByType.WHT.reduce((sum, e) => sum + parseFloat(e.equivalent_debit_amount || 0), 0);

    console.log(`\n📐 ACCOUNTING EQUATION CHECK:`);
    console.log(`   AR (debit): ${arAmount.toFixed(2)}`);
    console.log(`   REV (credit): ${revAmount.toFixed(2)}`);
    console.log(`   DISC (debit): ${discAmount.toFixed(2)}`);
    console.log(`   TAX (credit): ${taxAmount.toFixed(2)}`);
    console.log(`   WHT (debit): ${whtAmount.toFixed(2)}`);
    console.log(`\n   Expected: AR = REV - DISC + TAX - WHT`);
    console.log(`   Calculated: ${arAmount.toFixed(2)} = ${revAmount.toFixed(2)} - ${discAmount.toFixed(2)} + ${taxAmount.toFixed(2)} - ${whtAmount.toFixed(2)}`);
    const expectedAR = revAmount - discAmount + taxAmount - whtAmount;
    console.log(`   Expected AR: ${expectedAR.toFixed(2)}`);
    console.log(`   Actual AR: ${arAmount.toFixed(2)}`);
    console.log(`   Difference: ${(arAmount - expectedAR).toFixed(2)}`);

    if (Math.abs(arAmount - expectedAR) < 0.01) {
      console.log(`   ✅ EQUATION BALANCED`);
    } else {
      console.log(`   ❌ EQUATION NOT BALANCED`);
    }

    // Check invoice amounts vs GL amounts
    console.log(`\n🔍 INVOICE vs GL COMPARISON:`);
    const invoiceSubtotal = parseFloat(invoice.subtotal || 0);
    const invoiceDiscount = parseFloat(invoice.discount_amount || 0);
    const invoiceTax = parseFloat(invoice.tax_amount || 0);
    const invoiceWHT = parseFloat(invoice.total_wht_amount || 0);
    const invoiceBalance = parseFloat(invoice.balance_amount || invoice.total_amount || 0);

    console.log(`   Invoice Subtotal: ${invoiceSubtotal.toFixed(2)}`);
    console.log(`   GL Revenue: ${revAmount.toFixed(2)}`);
    console.log(`   Match: ${Math.abs(invoiceSubtotal - revAmount) < 0.01 ? '✅' : '❌'} (Diff: ${(invoiceSubtotal - revAmount).toFixed(2)})`);

    console.log(`   Invoice Discount: ${invoiceDiscount.toFixed(2)}`);
    console.log(`   GL Discount: ${discAmount.toFixed(2)}`);
    if (invoiceDiscount > 0 || discAmount > 0) {
      console.log(`   Match: ${Math.abs(invoiceDiscount - discAmount) < 0.01 ? '✅' : '❌'} (Diff: ${(invoiceDiscount - discAmount).toFixed(2)})`);
    } else {
      console.log(`   Match: ✅ (Both zero)`);
    }

    console.log(`   Invoice Tax: ${invoiceTax.toFixed(2)}`);
    console.log(`   GL Tax: ${taxAmount.toFixed(2)}`);
    if (invoiceTax > 0 || taxAmount > 0) {
      console.log(`   Match: ${Math.abs(invoiceTax - taxAmount) < 0.01 ? '✅' : '❌'} (Diff: ${(invoiceTax - taxAmount).toFixed(2)})`);
    } else {
      console.log(`   Match: ✅ (Both zero)`);
    }

    console.log(`   Invoice WHT: ${invoiceWHT.toFixed(2)}`);
    console.log(`   GL WHT: ${whtAmount.toFixed(2)}`);
    if (invoiceWHT > 0 || whtAmount > 0) {
      console.log(`   Match: ${Math.abs(invoiceWHT - whtAmount) < 0.01 ? '✅' : '❌'} (Diff: ${(invoiceWHT - whtAmount).toFixed(2)})`);
    } else {
      console.log(`   Match: ✅ (Both zero)`);
    }

    console.log(`   Invoice Balance: ${invoiceBalance.toFixed(2)}`);
    console.log(`   GL AR: ${arAmount.toFixed(2)}`);
    console.log(`   Match: ${Math.abs(invoiceBalance - arAmount) < 0.01 ? '✅' : '❌'} (Diff: ${(invoiceBalance - arAmount).toFixed(2)})`);

    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference number from command line
const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.log('Usage: node scripts/analyze-invoice-gl-balance.js <invoice_ref_number>');
  console.log('Example: node scripts/analyze-invoice-gl-balance.js INV-20250126-0001');
  process.exit(1);
}

analyzeInvoiceGL(invoiceRefNumber);

