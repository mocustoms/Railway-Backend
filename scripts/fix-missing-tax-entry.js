#!/usr/bin/env node

/**
 * Fix Missing Tax Entry for an Invoice
 * 
 * Creates the missing tax entry in General Ledger for invoices that have tax
 * but the tax entry wasn't created during approval
 * 
 * Usage: node scripts/fix-missing-tax-entry.js <invoice_ref_number>
 */

require('dotenv').config();
const { sequelize, GeneralLedger, SalesInvoice, SalesInvoiceItem, TaxCode, Account, AccountType, FinancialYear, TransactionType, Currency } = require('../server/models');
const { Op } = require('sequelize');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');

async function fixMissingTaxEntry(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`\n🔧 Fixing Missing Tax Entry for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items'
        },
        {
          model: FinancialYear,
          as: 'financialYear',
          required: false
        }
      ],
      transaction
    });

    if (!invoice) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      await transaction.rollback();
      return;
    }

    if (invoice.status !== 'approved') {
      console.log(`❌ Invoice is not approved. Status: ${invoice.status}`);
      console.log(`   Please approve the invoice first.`);
      await transaction.rollback();
      return;
    }

    // Check if tax entry already exists
    const existingTaxEntries = await GeneralLedger.findAll({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}-TAX-%`
        }
      },
      transaction
    });

    if (existingTaxEntries.length > 0) {
      console.log(`✅ Tax entries already exist (${existingTaxEntries.length} entries)`);
      console.log(`   No fix needed.`);
      await transaction.rollback();
      return;
    }

    const invoiceTaxAmount = parseFloat(invoice.tax_amount || 0);
    if (invoiceTaxAmount <= 0) {
      console.log(`✅ Invoice has no tax amount. No fix needed.`);
      await transaction.rollback();
      return;
    }

    console.log(`\n📋 INVOICE DETAILS:`);
    console.log(`   Tax Amount: ${invoiceTaxAmount.toFixed(2)}`);
    console.log(`   Total Amount: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Equivalent Amount: ${parseFloat(invoice.equivalent_amount || 0).toFixed(2)}`);
    console.log(`   Exchange Rate: ${parseFloat(invoice.exchange_rate || 1).toFixed(6)}`);

    // Get financial year
    const financialYear = invoice.financialYear || await FinancialYear.findOne({
      where: { companyId: invoice.companyId, isActive: true },
      transaction
    });

    if (!financialYear) {
      throw new Error('Financial year not found');
    }

    // Get system currency
    const systemCurrency = await Currency.findOne({
      where: { companyId: invoice.companyId, is_default: true },
      transaction
    });

    if (!systemCurrency) {
      throw new Error('System default currency not found');
    }

    // Get transaction type
    let salesTransactionType = await TransactionType.findOne({
      where: { companyId: invoice.companyId, code: 'SALES_INVOICE' },
      transaction
    });

    if (!salesTransactionType) {
      salesTransactionType = await TransactionType.findOne({
        where: { code: 'SALES_INVOICE', companyId: null },
        transaction
      });
    }

    if (!salesTransactionType) {
      throw new Error('Sales transaction type not found');
    }

    // Try to find a default tax account
    // First, try to find from any active tax code
    const defaultTaxCode = await TaxCode.findOne({
      where: {
        companyId: invoice.companyId,
        is_active: true,
        sales_tax_account_id: { [Op.not]: null }
      },
      order: [['created_at', 'DESC']],
      transaction
    });

    let taxAccount = null;
    let taxAccountType = null;

    if (defaultTaxCode && defaultTaxCode.sales_tax_account_id) {
      taxAccount = await Account.findByPk(defaultTaxCode.sales_tax_account_id, { transaction });
      if (taxAccount) {
        taxAccountType = await AccountType.findByPk(taxAccount.account_type_id, { transaction });
        console.log(`\n✅ Found default tax account from tax code: ${defaultTaxCode.code}`);
        console.log(`   Tax Account: ${taxAccount.code} - ${taxAccount.name}`);
      }
    }

    // If not found, try to find any tax account type account
    if (!taxAccount) {
      let accountType = await AccountType.findOne({
        where: {
          companyId: invoice.companyId,
          code: { [Op.in]: ['LIABILITY', 'TAX_PAYABLE', 'CURRENT_LIABILITY'] }
        },
        transaction
      });

      if (!accountType) {
        accountType = await AccountType.findOne({
          where: {
            code: { [Op.in]: ['LIABILITY', 'TAX_PAYABLE', 'CURRENT_LIABILITY'] }
          },
          transaction
        });
      }

      if (accountType) {
        taxAccount = await Account.findOne({
          where: {
            companyId: invoice.companyId,
            account_type_id: accountType.id
          },
          transaction
        });

        if (taxAccount) {
          taxAccountType = accountType;
          console.log(`\n✅ Found fallback tax account: ${taxAccount.code} - ${taxAccount.name}`);
        }
      }
    }

    if (!taxAccount || !taxAccountType) {
      throw new Error('No tax account found. Please configure a tax account in your chart of accounts.');
    }

    // Calculate equivalent amount
    const totalAmount = parseFloat(invoice.total_amount || 0);
    const invoiceEquivalentAmount = parseFloat(invoice.equivalent_amount || 0);
    const exchangeRate = parseFloat(invoice.exchange_rate || 1);
    
    const taxAmountInSystemCurrency = totalAmount > 0 && invoiceEquivalentAmount > 0
      ? (invoiceTaxAmount / totalAmount) * invoiceEquivalentAmount
      : (exchangeRate > 0 ? invoiceTaxAmount * exchangeRate : invoiceTaxAmount);

    // Get existing GL entries to find the glParentId
    const existingGLEntries = await GeneralLedger.findAll({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}%`
        }
      },
      limit: 1,
      transaction
    });

    const glParentId = existingGLEntries.length > 0 
      ? existingGLEntries[0].general_ledger_id 
      : require('crypto').randomUUID();

    // Get user who approved (or created) the invoice
    const userId = invoice.approved_by || invoice.created_by;
    const userName = 'System Fix'; // We don't have user context here

    // Create tax entry
    const invoiceDate = new Date(invoice.invoice_date);
    
    const taxEntry = await GeneralLedger.create({
      financial_year_code: financialYear.name,
      financial_year_id: financialYear.id,
      system_date: new Date(),
      transaction_date: invoiceDate,
      reference_number: `${invoiceRefNumber}-TAX-${taxAccount.id.substring(0, 8)}`,
      transaction_type: 'SALES_INVOICE',
      transaction_type_name: 'Sales Invoice',
      transaction_type_id: salesTransactionType.id,
      created_by_code: userId,
      created_by_name: userName,
      description: `Tax Payable (${taxAccount.code}) - Invoice ${invoiceRefNumber} [FIXED]`,
      account_type_code: taxAccountType.code || 'LIABILITY',
      account_type_name: taxAccountType.name || 'Tax Payable',
      account_type_id: taxAccountType.id,
      account_id: taxAccount.id,
      account_name: taxAccount.name,
      account_code: taxAccount.code,
      account_nature: 'credit',
      exchange_rate: exchangeRate,
      amount: taxAmountInSystemCurrency,
      system_currency_id: systemCurrency.id,
      user_credit_amount: invoiceTaxAmount,
      equivalent_credit_amount: taxAmountInSystemCurrency,
      username: 'system',
      general_ledger_id: glParentId,
      companyId: invoice.companyId
    }, { transaction });

    console.log(`\n✅ Created tax entry:`);
    console.log(`   Reference: ${taxEntry.reference_number}`);
    console.log(`   Account: ${taxAccount.code} - ${taxAccount.name}`);
    console.log(`   Amount: ${invoiceTaxAmount.toFixed(2)} (invoice currency)`);
    console.log(`   Equivalent: ${taxAmountInSystemCurrency.toFixed(2)} (system currency)`);
    console.log(`   Nature: Credit`);

    await transaction.commit();
    console.log(`\n✅ Tax entry created successfully!`);
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
  console.log('Usage: node scripts/fix-missing-tax-entry.js <invoice_ref_number>');
  console.log('Example: node scripts/fix-missing-tax-entry.js INV-20251113-0001');
  process.exit(1);
}

fixMissingTaxEntry(invoiceRefNumber);

