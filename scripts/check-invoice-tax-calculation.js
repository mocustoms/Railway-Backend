#!/usr/bin/env node

/**
 * Check why invoice has tax when user didn't set any tax
 * 
 * Usage: node scripts/check-invoice-tax-calculation.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, SalesInvoice, SalesInvoiceItem, Product, TaxCode } = require('../server/models');
const { Op } = require('sequelize');

async function checkInvoiceTaxCalculation(invoiceRefNumber) {
  try {
    console.log(`\n🔍 Checking Tax Calculation for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              required: false
            },
            {
              model: TaxCode,
              as: 'salesTaxCode',
              required: false
            }
          ]
        }
      ]
    });

    if (!invoice) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      return;
    }

    console.log(`\n📋 INVOICE SUMMARY:`);
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Discount: ${parseFloat(invoice.discount_amount || 0).toFixed(2)}`);
    console.log(`   Tax Amount: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   WHT Amount: ${parseFloat(invoice.total_wht_amount || 0).toFixed(2)}`);
    console.log(`   Total Amount: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Balance Amount: ${parseFloat(invoice.balance_amount || invoice.total_amount || 0).toFixed(2)}`);

    // Calculate expected total
    const subtotal = parseFloat(invoice.subtotal || 0);
    const discount = parseFloat(invoice.discount_amount || 0);
    const tax = parseFloat(invoice.tax_amount || 0);
    const wht = parseFloat(invoice.total_wht_amount || 0);
    const expectedTotal = subtotal - discount + tax - wht;
    const actualTotal = parseFloat(invoice.total_amount || 0);

    console.log(`\n📊 CALCULATION CHECK:`);
    console.log(`   Expected Total: Subtotal (${subtotal.toFixed(2)}) - Discount (${discount.toFixed(2)}) + Tax (${tax.toFixed(2)}) - WHT (${wht.toFixed(2)}) = ${expectedTotal.toFixed(2)}`);
    console.log(`   Actual Total: ${actualTotal.toFixed(2)}`);
    console.log(`   Match: ${Math.abs(expectedTotal - actualTotal) < 0.01 ? '✅' : '❌'} (Diff: ${(expectedTotal - actualTotal).toFixed(2)})`);

    console.log(`\n📦 INVOICE ITEMS ANALYSIS:\n`);
    console.log('-'.repeat(120));
    console.log(`${'Item'.padEnd(10)} ${'Product'.padEnd(30)} ${'Qty'.padEnd(10)} ${'Unit Price'.padEnd(15)} ${'Subtotal'.padEnd(15)} ${'Tax %'.padEnd(10)} ${'Tax Amount'.padEnd(15)} ${'Tax ID'.padEnd(40)} ${'Has Tax?'.padEnd(10)}`);
    console.log('-'.repeat(120));

    let totalItemTax = 0;
    let itemsWithTaxId = 0;
    let itemsWithTaxAmountButNoId = 0;
    let itemsWithNoTax = 0;

    for (let i = 0; i < (invoice.items || []).length; i++) {
      const item = invoice.items[i];
      const productName = item.product?.name || 'Unknown';
      const quantity = parseFloat(item.quantity || 0);
      const unitPrice = parseFloat(item.unit_price || 0);
      const lineSubtotal = quantity * unitPrice;
      const taxPercentage = parseFloat(item.tax_percentage || 0);
      const itemTaxAmount = parseFloat(item.tax_amount || 0);
      const hasTaxId = !!item.sales_tax_id;
      
      totalItemTax += itemTaxAmount;

      if (hasTaxId) {
        itemsWithTaxId++;
      } else if (itemTaxAmount > 0) {
        itemsWithTaxAmountButNoId++;
      } else {
        itemsWithNoTax++;
      }

      const taxIdDisplay = item.sales_tax_id ? item.sales_tax_id.substring(0, 39) : 'NULL';
      const hasTaxDisplay = hasTaxId ? 'YES' : 'NO';

      console.log(`${String(i + 1).padEnd(10)} ${productName.substring(0, 29).padEnd(30)} ${quantity.toFixed(2).padStart(10)} ${unitPrice.toFixed(2).padStart(15)} ${lineSubtotal.toFixed(2).padStart(15)} ${taxPercentage.toFixed(2).padStart(10)} ${itemTaxAmount.toFixed(2).padStart(15)} ${taxIdDisplay.padEnd(40)} ${hasTaxDisplay.padEnd(10)}`);
    }

    console.log('-'.repeat(120));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Invoice Tax Amount: ${tax.toFixed(2)}`);
    console.log(`   Sum of Item Tax Amounts: ${totalItemTax.toFixed(2)}`);
    console.log(`   Items with Tax ID: ${itemsWithTaxId}`);
    console.log(`   Items with Tax Amount but NO Tax ID: ${itemsWithTaxAmountButNoId}`);
    console.log(`   Items with No Tax: ${itemsWithNoTax}`);

    console.log(`\n🔍 ANALYSIS:`);
    
    if (itemsWithTaxAmountButNoId > 0) {
      console.log(`\n   ⚠️  ISSUE FOUND: ${itemsWithTaxAmountButNoId} item(s) have tax_amount > 0 but sales_tax_id is NULL`);
      console.log(`      This suggests:`);
      console.log(`      1. Tax was calculated/stored incorrectly during invoice creation`);
      console.log(`      2. Tax amount should be 0 if user didn't set tax`);
      console.log(`      3. The invoice creation/update logic may be calculating tax even when tax_id is not set`);
    }

    if (Math.abs(tax - totalItemTax) > 0.01) {
      console.log(`\n   ⚠️  ISSUE: Invoice tax (${tax.toFixed(2)}) doesn't match sum of item taxes (${totalItemTax.toFixed(2)})`);
      console.log(`      Difference: ${(tax - totalItemTax).toFixed(2)}`);
    }

    if (tax > 0 && itemsWithTaxId === 0) {
      console.log(`\n   ❌ ROOT CAUSE: Invoice has tax (${tax.toFixed(2)}) but NO items have tax_id set`);
      console.log(`      This means:`);
      console.log(`      - User did NOT set any tax (correct - no tax_id)`);
      console.log(`      - But invoice.tax_amount was calculated/stored incorrectly`);
      console.log(`      - The invoice creation logic needs to be fixed to NOT calculate tax when tax_id is NULL`);
    }

    // Check if tax was calculated incorrectly
    if (tax > 0 && itemsWithTaxId === 0) {
      console.log(`\n💡 RECOMMENDATION:`);
      console.log(`   1. The invoice.tax_amount field should be set to 0 when no tax_id is assigned`);
      console.log(`   2. Check the invoice creation/update logic in salesInvoice.js`);
      console.log(`   3. The tax calculation should only happen when tax_id is provided`);
      console.log(`   4. For this invoice, you may need to:`);
      console.log(`      - Update invoice.tax_amount to 0`);
      console.log(`      - Update invoice.total_amount to: ${(subtotal - discount).toFixed(2)}`);
      console.log(`      - Remove the tax GL entry that was incorrectly created`);
    }

    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.log('Usage: node scripts/check-invoice-tax-calculation.js <invoice_ref_number>');
  console.log('Example: node scripts/check-invoice-tax-calculation.js INV-20251113-0001');
  process.exit(1);
}

checkInvoiceTaxCalculation(invoiceRefNumber);

