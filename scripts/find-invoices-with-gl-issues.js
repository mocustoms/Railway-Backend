#!/usr/bin/env node

/**
 * Find Invoices with Potential GL Balance Issues
 * 
 * Lists invoices that might have balance problems
 * Usage: node scripts/find-invoices-with-gl-issues.js [limit]
 */

require('dotenv').config();
const { sequelize, GeneralLedger, SalesInvoice } = require('../server/models');
const { Op } = require('sequelize');

async function findInvoicesWithIssues(limit = 10) {
  try {
    console.log(`\n🔍 Finding invoices with potential GL balance issues...\n`);
    console.log('='.repeat(80));

    // Get recent approved invoices
    const invoices = await SalesInvoice.findAll({
      where: {
        status: 'approved'
      },
      order: [['approved_at', 'DESC']],
      limit: parseInt(limit),
      attributes: ['id', 'invoice_ref_number', 'invoice_date', 'subtotal', 'discount_amount', 'tax_amount', 'total_wht_amount', 'total_amount', 'balance_amount', 'equivalent_amount', 'exchange_rate', 'status', 'approved_at']
    });

    console.log(`Found ${invoices.length} approved invoices\n`);

    const issues = [];

    for (const invoice of invoices) {
      // Get GL entries for this invoice
      const glEntries = await GeneralLedger.findAll({
        where: {
          reference_number: {
            [Op.like]: `${invoice.invoice_ref_number}%`
          }
        }
      });

      if (glEntries.length === 0) {
        issues.push({
          invoice: invoice.invoice_ref_number,
          issue: 'No GL entries found',
          severity: 'high'
        });
        continue;
      }

      // Calculate totals
      let totalDebits = 0;
      let totalCredits = 0;
      let arAmount = 0;
      let revAmount = 0;
      let discAmount = 0;
      let taxAmount = 0;
      let whtAmount = 0;

      for (const entry of glEntries) {
        const amount = parseFloat(entry.amount || 0);
        const ref = entry.reference_number || '';

        if (entry.account_nature === 'debit') {
          totalDebits += amount;
        } else if (entry.account_nature === 'credit') {
          totalCredits += amount;
        }

        if (ref.includes('-AR')) {
          arAmount += parseFloat(entry.equivalent_debit_amount || 0);
        } else if (ref.includes('-REV')) {
          revAmount += parseFloat(entry.equivalent_credit_amount || 0);
        } else if (ref.includes('-DISC')) {
          discAmount += parseFloat(entry.equivalent_debit_amount || 0);
        } else if (ref.includes('-TAX-')) {
          taxAmount += parseFloat(entry.equivalent_credit_amount || 0);
        } else if (ref.includes('-WHT-')) {
          whtAmount += parseFloat(entry.equivalent_debit_amount || 0);
        }
      }

      // Check balance
      const balanceDiff = Math.abs(totalDebits - totalCredits);
      const invoiceSubtotal = parseFloat(invoice.subtotal || 0);
      const invoiceDiscount = parseFloat(invoice.discount_amount || 0);
      const invoiceTax = parseFloat(invoice.tax_amount || 0);
      const invoiceWHT = parseFloat(invoice.total_wht_amount || 0);
      const invoiceBalance = parseFloat(invoice.balance_amount || invoice.total_amount || 0);

      // Expected AR = REV - DISC + TAX - WHT
      const expectedAR = revAmount - discAmount + taxAmount - whtAmount;
      const arDiff = Math.abs(arAmount - expectedAR);

      // Check for issues
      if (balanceDiff > 0.01) {
        issues.push({
          invoice: invoice.invoice_ref_number,
          issue: `GL not balanced: Debits=${totalDebits.toFixed(2)}, Credits=${totalCredits.toFixed(2)}, Diff=${balanceDiff.toFixed(2)}`,
          severity: 'high',
          details: {
            totalDebits,
            totalCredits,
            difference: balanceDiff
          }
        });
      } else if (arDiff > 0.01) {
        issues.push({
          invoice: invoice.invoice_ref_number,
          issue: `AR equation not balanced: AR=${arAmount.toFixed(2)}, Expected=${expectedAR.toFixed(2)}, Diff=${arDiff.toFixed(2)}`,
          severity: 'high',
          details: {
            arAmount,
            expectedAR,
            difference: arDiff
          }
        });
      } else if (Math.abs(invoiceSubtotal - revAmount) > 0.01) {
        issues.push({
          invoice: invoice.invoice_ref_number,
          issue: `Revenue mismatch: Invoice=${invoiceSubtotal.toFixed(2)}, GL=${revAmount.toFixed(2)}`,
          severity: 'medium',
          details: {
            invoiceSubtotal,
            glRevenue: revAmount
          }
        });
      } else if (invoiceTax === 0 && taxAmount > 0) {
        issues.push({
          invoice: invoice.invoice_ref_number,
          issue: `Tax mismatch: Invoice has no tax but GL has tax entries`,
          severity: 'medium'
        });
      } else if (invoiceTax > 0 && taxAmount === 0) {
        issues.push({
          invoice: invoice.invoice_ref_number,
          issue: `Tax mismatch: Invoice has tax (${invoiceTax.toFixed(2)}) but GL has no tax entries`,
          severity: 'high'
        });
      }
    }

    if (issues.length === 0) {
      console.log('✅ No issues found in the checked invoices!\n');
    } else {
      console.log(`⚠️  Found ${issues.length} invoice(s) with potential issues:\n`);
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.invoice}`);
        console.log(`   Issue: ${issue.issue}`);
        console.log(`   Severity: ${issue.severity}`);
        if (issue.details) {
          console.log(`   Details:`, issue.details);
        }
        console.log('');
      });

      console.log('\n💡 To analyze a specific invoice, run:');
      console.log(`   node scripts/analyze-invoice-gl-balance.js <invoice_ref_number>`);
      console.log(`\n   Example: node scripts/analyze-invoice-gl-balance.js ${issues[0].invoice}`);
    }

    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

const limit = process.argv[2] || 10;
findInvoicesWithIssues(limit);

