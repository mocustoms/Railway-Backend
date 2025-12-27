require('dotenv').config();
const sequelize = require('../config/database');
const {
  SalesInvoice,
  SalesInvoiceItem,
  PaymentType,
  Account,
  Currency,
  ExchangeRate,
  FinancialYear,
  Customer,
  GeneralLedger,
  TransactionType,
  Receipt,
  ReceiptItem,
  ReceiptTransaction,
  LinkedAccount,
  User
} = require('../server/models');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');
const { Op } = require('sequelize');

// Mock request object - companyId will be set from invoice
let mockReq = {
  user: {
    companyId: process.env.COMPANY_ID || null,
    id: process.env.USER_ID || '00000000-0000-0000-0000-000000000000', // System user
    username: 'system',
    first_name: 'System',
    last_name: 'User'
  }
};

async function generateReceiptRefNumber(req) {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  
  // Find the last receipt for today
  const lastReceipt = await Receipt.findOne({
    where: buildCompanyWhere(req, {
      receipt_reference_number: {
        [Op.like]: `RCP-${dateStr}-%`
      }
    }),
    attributes: ['receipt_reference_number'],
    order: [['receipt_reference_number', 'DESC']]
  });

  let nextSequence = 1;
  if (lastReceipt && lastReceipt.receipt_reference_number) {
    const match = lastReceipt.receipt_reference_number.match(/RCP-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }

  const referenceNumber = `RCP-${dateStr}-${String(nextSequence).padStart(4, '0')}`;
  
  // Check if it exists
  const exists = await Receipt.findOne({
    where: buildCompanyWhere(req, { receipt_reference_number: referenceNumber }),
    attributes: ['id']
  });

  if (exists) {
    throw new Error('Receipt reference number collision');
  }

  return referenceNumber;
}

async function fullPayInvoice(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing Full Payment for Invoice: ${invoiceRefNumber}`);
    console.log(`${'='.repeat(80)}\n`);

    // Find invoice by reference number
    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(mockReq, { invoice_ref_number: invoiceRefNumber }),
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'account_balance', 'debt_balance']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol']
        },
        {
          model: SalesInvoiceItem,
          as: 'items',
          attributes: ['id', 'line_total', 'quantity']
        }
      ],
      transaction
    });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceRefNumber} not found`);
    }

    // Set companyId from invoice
    if (!mockReq.user.companyId && invoice.companyId) {
      mockReq.user.companyId = invoice.companyId;
    }

    if (!mockReq.user.companyId) {
      throw new Error('Company ID is required. Please set COMPANY_ID in .env or ensure invoice has companyId');
    }

    // Get a real user ID for this company (use created_by or find any user)
    if (mockReq.user.id === '00000000-0000-0000-0000-000000000000') {
      const realUser = await User.findOne({
        where: buildCompanyWhere(mockReq, {}),
        attributes: ['id', 'username', 'first_name', 'last_name'],
        transaction
      });
      
      if (realUser) {
        mockReq.user.id = realUser.id;
        mockReq.user.username = realUser.username;
        mockReq.user.first_name = realUser.first_name;
        mockReq.user.last_name = realUser.last_name;
      } else if (invoice.created_by) {
        // Use the invoice creator
        const creator = await User.findOne({
          where: { id: invoice.created_by },
          attributes: ['id', 'username', 'first_name', 'last_name'],
          transaction
        });
        if (creator) {
          mockReq.user.id = creator.id;
          mockReq.user.username = creator.username;
          mockReq.user.first_name = creator.first_name;
          mockReq.user.last_name = creator.last_name;
        }
      }
    }

    console.log(`✅ Invoice Found:`);
    console.log(`   ID: ${invoice.id}`);
    console.log(`   Customer: ${invoice.customer?.full_name || 'N/A'}`);
    console.log(`   Total Amount: ${invoice.total_amount}`);
    console.log(`   Paid Amount: ${invoice.paid_amount || 0}`);
    console.log(`   Balance Amount: ${invoice.balance_amount || invoice.total_amount}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Payment Status: ${invoice.payment_status || 'unpaid'}`);

    const balanceAmount = parseFloat(invoice.balance_amount || invoice.total_amount);
    
    if (balanceAmount <= 0) {
      console.log(`\n⚠️  Invoice is already fully paid. No payment needed.`);
      await transaction.rollback();
      return;
    }

    // Get current financial year
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(mockReq, { isActive: true }),
      transaction
    });

    if (!currentFinancialYear) {
      throw new Error('No active financial year found');
    }

    // Get currency and exchange rate
    const currencyId = invoice.currency_id;
    const exchangeRate = parseFloat(invoice.exchange_rate || 1.0);
    const exchangeRateId = invoice.exchange_rate_id;
    const transactionDate = new Date().toISOString().split('T')[0];

    // Get a default payment type (Cash)
    let paymentType = await PaymentType.findOne({
      where: buildCompanyWhere(mockReq, { 
        code: 'CASH' 
      }),
      include: [{
        model: Account,
        as: 'defaultAccount',
        attributes: ['id', 'code', 'name', 'type']
      }],
      transaction
    });

    if (!paymentType) {
      // Try to get any payment type
      paymentType = await PaymentType.findOne({
        where: buildCompanyWhere(mockReq, {}),
        include: [{
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'code', 'name', 'type']
        }],
        transaction
      });

      if (!paymentType) {
        throw new Error('No payment type found. Please create a payment type first.');
      }

      console.log(`\n⚠️  Using payment type: ${paymentType.name} (${paymentType.code})`);
    } else {
      console.log(`\n✅ Using payment type: ${paymentType.name} (${paymentType.code})`);
    }

    const assetAccount = paymentType.defaultAccount || (paymentType.default_account_id ? await Account.findOne({
      where: buildCompanyWhere(mockReq, { id: paymentType.default_account_id }),
      transaction
    }) : null);

    if (!assetAccount) {
      throw new Error(`Payment type ${paymentType.name} does not have a default account assigned`);
    }

    // Get receivable account
    const receivableAccountId = invoice.account_receivable_id;
    if (!receivableAccountId) {
      throw new Error('Invoice does not have an account receivable assigned');
    }

    const receivableAccount = await Account.findOne({
      where: buildCompanyWhere(mockReq, { id: receivableAccountId }),
      transaction
    });

    if (!receivableAccount) {
      throw new Error('Account receivable not found');
    }

    // Get system default currency
    const systemCurrency = await Currency.findOne({
      where: buildCompanyWhere(mockReq, { is_default: true }),
      transaction
    });

    if (!systemCurrency) {
      throw new Error('System default currency not found');
    }

    // Get or create transaction type
    let transactionType = await TransactionType.findOne({ 
      where: { code: 'INVOICE_PAYMENT' }
    });
    
    if (!transactionType) {
      transactionType = await TransactionType.create({
        companyId: null,
        code: 'INVOICE_PAYMENT',
        name: 'Invoice Payment',
        description: 'Sales invoice payment transactions'
      }, { transaction });
    }

    console.log(`\n📊 Payment Details:`);
    console.log(`   Payment Amount: ${balanceAmount}`);
    console.log(`   Currency: ${invoice.currency?.name || 'N/A'}`);
    console.log(`   Exchange Rate: ${exchangeRate}`);
    console.log(`   Payment Type: ${paymentType.name}`);
    console.log(`   Asset Account: ${assetAccount.name}`);
    console.log(`   Receivable Account: ${receivableAccount.name}`);

    // Calculate equivalent amount
    const equivalentAmount = balanceAmount * exchangeRate;

    // Create General Ledger entries
    const generalLedgerId = require('uuid').v4();
    const paymentDescription = `Full payment for invoice ${invoiceRefNumber}`;

    // Asset Account Entry (Debit) - Cash/Bank account receives payment
    await GeneralLedger.create({
      id: require('uuid').v4(),
      financial_year_code: currentFinancialYear.name,
      financial_year_id: currentFinancialYear.id,
      system_date: new Date(),
      transaction_date: transactionDate,
      reference_number: invoice.invoice_ref_number,
      transaction_type: 'INVOICE_PAYMENT',
      transaction_type_name: 'Invoice Payment',
      transaction_type_id: transactionType.id,
      created_by_code: mockReq.user.id,
      created_by_name: `${mockReq.user.first_name} ${mockReq.user.last_name}`,
      description: paymentDescription,
      account_type_code: assetAccount.type || 'ASSET',
      account_type_name: assetAccount.type || 'Asset',
      account_id: assetAccount.id,
      account_name: assetAccount.name,
      account_code: assetAccount.code,
      account_nature: 'debit',
      exchange_rate: exchangeRate,
      amount: balanceAmount,
      system_currency_id: systemCurrency.id,
      user_debit_amount: balanceAmount,
      equivalent_debit_amount: equivalentAmount,
      username: mockReq.user.username,
      general_ledger_id: generalLedgerId,
      companyId: mockReq.user.companyId
    }, { transaction });

    // Account Receivable Entry (Credit) - Reduce receivables
    await GeneralLedger.create({
      id: require('uuid').v4(),
      financial_year_code: currentFinancialYear.name,
      financial_year_id: currentFinancialYear.id,
      system_date: new Date(),
      transaction_date: transactionDate,
      reference_number: invoice.invoice_ref_number,
      transaction_type: 'INVOICE_PAYMENT',
      transaction_type_name: 'Invoice Payment',
      transaction_type_id: transactionType.id,
      created_by_code: mockReq.user.id,
      created_by_name: `${mockReq.user.first_name} ${mockReq.user.last_name}`,
      description: paymentDescription,
      account_type_code: receivableAccount.type || 'ASSET',
      account_type_name: receivableAccount.type || 'Asset',
      account_id: receivableAccount.id,
      account_name: receivableAccount.name,
      account_code: receivableAccount.code,
      account_nature: 'credit',
      exchange_rate: exchangeRate,
      amount: balanceAmount,
      system_currency_id: systemCurrency.id,
      user_credit_amount: balanceAmount,
      equivalent_credit_amount: equivalentAmount,
      username: mockReq.user.username,
      general_ledger_id: generalLedgerId,
      companyId: mockReq.user.companyId
    }, { transaction });

    // Update invoice
    const newPaidAmount = parseFloat(invoice.paid_amount || 0) + balanceAmount;
    const newBalanceAmount = Math.max(0, parseFloat(invoice.total_amount) - newPaidAmount);
    let paymentStatus = 'unpaid';
    if (newPaidAmount >= parseFloat(invoice.total_amount)) {
      paymentStatus = newPaidAmount > parseFloat(invoice.total_amount) ? 'overpaid' : 'paid';
    } else if (newPaidAmount > 0) {
      paymentStatus = 'partial';
    }

    const updateData = {
      paid_amount: newPaidAmount,
      balance_amount: newBalanceAmount,
      payment_status: paymentStatus,
      updated_by: mockReq.user.id
    };

    if (paymentStatus === 'paid' && !invoice.paid_at) {
      updateData.paid_at = new Date();
    }

    await invoice.update(updateData, { transaction });

    // Generate receipt reference number
    const receiptReferenceNumber = await generateReceiptRefNumber(mockReq);

    // Create receipt
    const receipt = await Receipt.create({
      companyId: mockReq.user.companyId,
      receiptReferenceNumber: receiptReferenceNumber,
      salesInvoiceId: invoice.id,
      customerId: invoice.customer_id,
      salesAgentId: invoice.sales_agent_id,
      paymentAmount: balanceAmount,
      currencyId: currencyId,
      exchangeRate: exchangeRate,
      exchangeRateId: exchangeRateId || null,
      systemDefaultCurrencyId: systemCurrency.id,
      equivalentAmount: equivalentAmount,
      paymentTypeId: paymentType.id,
      useCustomerDeposit: false,
      depositAmount: null,
      useLoyaltyPoints: false,
      loyaltyPointsAmount: null,
      loyaltyPointsValue: null,
      chequeNumber: null,
      bankDetailId: null,
      branch: null,
      receivableAccountId: receivableAccountId,
      assetAccountId: assetAccount.id,
      liabilityAccountId: null,
      transactionDate: transactionDate,
      financialYearId: currentFinancialYear.id,
      description: paymentDescription,
      status: 'active',
      createdBy: mockReq.user.id,
      updatedBy: mockReq.user.id
    }, { transaction });

    // Create receipt items for each invoice item (proportional payment)
    if (invoice.items && invoice.items.length > 0) {
      const totalInvoiceAmount = parseFloat(invoice.total_amount);
      
      for (const item of invoice.items) {
        const itemTotal = parseFloat(item.line_total || 0);
        const itemPaymentAmount = (itemTotal / totalInvoiceAmount) * balanceAmount;
        const itemRemaining = Math.max(0, itemTotal - itemPaymentAmount);
        
        await ReceiptItem.create({
          companyId: mockReq.user.companyId,
          receiptId: receipt.id,
          salesInvoiceId: invoice.id,
          salesInvoiceItemId: item.id,
          salesAgentId: invoice.sales_agent_id,
          paymentAmount: itemPaymentAmount,
          currencyId: currencyId,
          exchangeRate: exchangeRate,
          exchangeRateId: exchangeRateId || null,
          systemDefaultCurrencyId: systemCurrency.id,
          equivalentAmount: itemPaymentAmount * exchangeRate,
          itemTotal: itemTotal,
          itemRemaining: itemRemaining,
          financialYearId: currentFinancialYear.id
        }, { transaction });
      }
    }

    // Update customer debt balance
    if (invoice.customer) {
      await Customer.decrement('debt_balance', {
        by: equivalentAmount,
        where: buildCompanyWhere(mockReq, { id: invoice.customer_id }),
        transaction
      });
    }

    await transaction.commit();

    console.log(`\n✅ Payment recorded successfully!`);
    console.log(`   Receipt Number: ${receiptReferenceNumber}`);
    console.log(`   Updated Invoice Status: ${invoice.status}`);
    console.log(`   Updated Payment Status: ${paymentStatus}`);
    console.log(`   New Paid Amount: ${newPaidAmount}`);
    console.log(`   New Balance Amount: ${newBalanceAmount}`);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Invoice ${invoiceRefNumber} fully paid successfully!`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    await transaction.rollback();
    console.error(`\n❌ Error processing payment:`, error.message);
    console.error(`Stack:`, error.stack);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference number from command line argument
const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.error('❌ Please provide an invoice reference number');
  console.error('Usage: node full-pay-invoice-direct.js INV-20251114-0001');
  process.exit(1);
}

// Run the script
fullPayInvoice(invoiceRefNumber)
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

