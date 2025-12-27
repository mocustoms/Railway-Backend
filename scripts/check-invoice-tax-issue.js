#!/usr/bin/env node

/**
 * Check why tax entry wasn't created for an invoice
 * 
 * Usage: node scripts/check-invoice-tax-issue.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, SalesInvoice, SalesInvoiceItem, TaxCode } = require('../server/models');
const { Op } = require('sequelize');

async function checkInvoiceTaxIssue(invoiceRefNumber) {
  try {
    console.log(`\n🔍 Checking Tax Issue for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: TaxCode,
              as: 'salesTaxCode',
              required: false
            },
            {
              model: TaxCode,
              as: 'whtTaxCode',
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
    console.log(`   Total Tax: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   Total WHT: ${parseFloat(invoice.total_wht_amount || 0).toFixed(2)}`);
    console.log(`   Number of Items: ${invoice.items?.length || 0}\n`);

    console.log(`\n📦 INVOICE ITEMS DETAILS:\n`);
    console.log('-'.repeat(100));
    console.log(`${'Item'.padEnd(10)} ${'Product'.padEnd(30)} ${'Qty'.padEnd(10)} ${'Unit Price'.padEnd(15)} ${'Tax Amount'.padEnd(15)} ${'Tax ID'.padEnd(40)} ${'Tax Code'.padEnd(15)} ${'Tax Account'.padEnd(40)}`);
    console.log('-'.repeat(100));

    let totalItemTax = 0;
    let itemsWithTax = 0;
    let itemsWithoutTaxId = 0;
    let itemsWithTaxButNoAccount = 0;

    for (let i = 0; i < (invoice.items || []).length; i++) {
      const item = invoice.items[i];
      const itemTaxAmount = parseFloat(item.tax_amount || 0);
      const itemWhtAmount = parseFloat(item.wht_amount || 0);
      totalItemTax += itemTaxAmount;

      const hasTax = itemTaxAmount > 0;
      const hasTaxId = !!item.sales_tax_id;
      const taxCode = item.salesTaxCode;
      const hasTaxAccount = taxCode && taxCode.sales_tax_account_id;

      if (hasTax) itemsWithTax++;
      if (hasTax && !hasTaxId) itemsWithoutTaxId++;
      if (hasTax && hasTaxId && !hasTaxAccount) itemsWithTaxButNoAccount++;

      const productName = item.product?.name || 'Unknown';
      const taxCodeName = taxCode?.code || taxCode?.name || 'N/A';
      const taxAccountId = taxCode?.sales_tax_account_id || 'N/A';

      console.log(`${String(i + 1).padEnd(10)} ${productName.substring(0, 29).padEnd(30)} ${parseFloat(item.quantity || 0).toFixed(2).padStart(10)} ${parseFloat(item.unit_price || 0).toFixed(2).padStart(15)} ${itemTaxAmount.toFixed(2).padStart(15)} ${(item.sales_tax_id || 'NULL').substring(0, 39).padEnd(40)} ${taxCodeName.substring(0, 14).padEnd(15)} ${String(taxAccountId).substring(0, 39).padEnd(40)}`);

      if (itemWhtAmount > 0) {
        const whtCode = item.whtTaxCode;
        const whtCodeName = whtCode?.code || whtCode?.name || 'N/A';
        const whtAccountId = whtCode?.sales_tax_account_id || 'N/A';
        console.log(`${'  WHT:'.padEnd(10)} ${' '.padEnd(30)} ${' '.padEnd(10)} ${' '.padEnd(15)} ${itemWhtAmount.toFixed(2).padStart(15)} ${(item.wht_tax_id || 'NULL').substring(0, 39).padEnd(40)} ${whtCodeName.substring(0, 14).padEnd(15)} ${String(whtAccountId).substring(0, 39).padEnd(40)}`);
      }
    }

    console.log('-'.repeat(100));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Invoice Total Tax: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   Sum of Item Taxes: ${totalItemTax.toFixed(2)}`);
    console.log(`   Items with Tax Amount > 0: ${itemsWithTax}`);
    console.log(`   Items with Tax but NO tax_id: ${itemsWithoutTaxId}`);
    console.log(`   Items with Tax ID but NO tax account: ${itemsWithTaxButNoAccount}`);

    console.log(`\n🔍 ANALYSIS:`);
    
    // Check if invoice tax matches sum of item taxes
    const invoiceTax = parseFloat(invoice.tax_amount || 0);
    const taxDiff = Math.abs(invoiceTax - totalItemTax);
    
    if (taxDiff > 0.01) {
      console.log(`   ⚠️  Invoice tax (${invoiceTax.toFixed(2)}) doesn't match sum of item taxes (${totalItemTax.toFixed(2)})`);
      console.log(`      Difference: ${taxDiff.toFixed(2)}`);
    } else {
      console.log(`   ✅ Invoice tax matches sum of item taxes`);
    }

    // Check why tax entry wasn't created
    if (itemsWithTax === 0) {
      console.log(`\n   ❌ ISSUE: No items have tax_amount > 0`);
      console.log(`      But invoice shows tax_amount = ${invoiceTax.toFixed(2)}`);
      console.log(`      This suggests tax is calculated at invoice level but not stored at item level`);
    } else if (itemsWithoutTaxId > 0) {
      console.log(`\n   ❌ ISSUE: ${itemsWithoutTaxId} item(s) have tax_amount > 0 but sales_tax_id is NULL`);
      console.log(`      Tax entry requires BOTH tax_amount > 0 AND sales_tax_id to be set`);
      console.log(`      Code check: if (itemTaxAmount > 0 && item.sales_tax_id)`);
    } else if (itemsWithTaxButNoAccount > 0) {
      console.log(`\n   ❌ ISSUE: ${itemsWithTaxButNoAccount} item(s) have tax but tax code has no sales_tax_account_id`);
      console.log(`      Tax entry requires tax code to have sales_tax_account_id configured`);
    } else {
      console.log(`\n   ✅ All items with tax have tax_id and tax account configured`);
      console.log(`   ⚠️  But tax entry still wasn't created - checking tax code details...`);
      
      // Check tax codes
      for (const item of invoice.items || []) {
        if (parseFloat(item.tax_amount || 0) > 0 && item.sales_tax_id) {
          const taxCode = await TaxCode.findByPk(item.sales_tax_id);
          if (taxCode) {
            console.log(`\n   Tax Code: ${taxCode.code} (${taxCode.name})`);
            console.log(`      ID: ${taxCode.id}`);
            console.log(`      Sales Tax Account ID: ${taxCode.sales_tax_account_id || 'NULL'}`);
            console.log(`      Rate: ${parseFloat(taxCode.rate || 0).toFixed(2)}%`);
          }
        }
      }
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
  console.log('Usage: node scripts/check-invoice-tax-issue.js <invoice_ref_number>');
  console.log('Example: node scripts/check-invoice-tax-issue.js INV-20251113-0001');
  process.exit(1);
}

checkInvoiceTaxIssue(invoiceRefNumber);

