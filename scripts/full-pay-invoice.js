const sequelize = require('../server/config/database');
const { SalesInvoice, PaymentType, Account, Currency, ExchangeRate, FinancialYear, Customer } = require('../server/models');
const { buildCompanyWhere } = require('../server/middleware/stripCompanyId');

// Mock request object for buildCompanyWhere
const mockReq = {
  user: {
    companyId: process.env.COMPANY_ID || null // Set via environment variable if needed
  }
};

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
        }
      ],
      transaction
    });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceRefNumber} not found`);
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
      where: buildCompanyWhere(mockReq, { is_active: true }),
      transaction
    });

    if (!currentFinancialYear) {
      throw new Error('No active financial year found');
    }

    // Get currency and exchange rate
    const currencyId = invoice.currency_id;
    const exchangeRate = invoice.exchange_rate || 1.0;
    const exchangeRateId = invoice.exchange_rate_id;

    // Get a default payment type (Cash)
    const paymentType = await PaymentType.findOne({
      where: buildCompanyWhere(mockReq, { 
        payment_type_code: 'CASH' 
      }),
      include: [{
        model: Account,
        as: 'defaultAccount',
        attributes: ['id', 'code', 'name']
      }],
      transaction
    });

    if (!paymentType) {
      // Try to get any payment type
      const anyPaymentType = await PaymentType.findOne({
        where: buildCompanyWhere(mockReq, {}),
        include: [{
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'code', 'name']
        }],
        transaction
      });

      if (!anyPaymentType) {
        throw new Error('No payment type found. Please create a payment type first.');
      }

      console.log(`\n⚠️  Using payment type: ${anyPaymentType.payment_type_name} (${anyPaymentType.payment_type_code})`);
      paymentType = anyPaymentType;
    } else {
      console.log(`\n✅ Using payment type: ${paymentType.payment_type_name} (${paymentType.payment_type_code})`);
    }

    if (!paymentType.defaultAccount && !paymentType.default_account_id) {
      throw new Error(`Payment type ${paymentType.payment_type_name} does not have a default account assigned`);
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

    console.log(`\n📊 Payment Details:`);
    console.log(`   Payment Amount: ${balanceAmount}`);
    console.log(`   Currency: ${invoice.currency?.name || 'N/A'}`);
    console.log(`   Exchange Rate: ${exchangeRate}`);
    console.log(`   Payment Type: ${paymentType.payment_type_name}`);
    console.log(`   Asset Account: ${paymentType.defaultAccount?.name || 'N/A'}`);
    console.log(`   Receivable Account: ${receivableAccount.name}`);

    // Prepare payment data
    const paymentData = {
      paymentAmount: balanceAmount,
      paymentTypeId: paymentType.id,
      currencyId: currencyId,
      exchangeRate: exchangeRate,
      exchangeRateId: exchangeRateId || undefined,
      transactionDate: new Date().toISOString().split('T')[0],
      description: `Full payment for invoice ${invoiceRefNumber}`,
      receivableAccountId: receivableAccountId
    };

    console.log(`\n💳 Recording payment...`);

    // Call the record payment endpoint logic
    // We'll use the API endpoint via HTTP request
    const api = require('axios');
    const baseURL = process.env.API_BASE_URL || 'http://localhost:3000';
    const apiKey = process.env.API_KEY || ''; // Add if needed

    try {
      const response = await api.put(
        `${baseURL}/api/sales-invoices/${invoice.id}/record-payment`,
        paymentData,
        {
          headers: {
            'Content-Type': 'application/json',
            // Add authentication headers if needed
            // 'Authorization': `Bearer ${apiKey}`,
            // 'X-CSRF-Token': csrfToken
          },
          withCredentials: true
        }
      );

      console.log(`\n✅ Payment recorded successfully!`);
      console.log(`   Updated Invoice Status: ${response.data.status}`);
      console.log(`   Updated Payment Status: ${response.data.paymentStatus}`);
      console.log(`   New Paid Amount: ${response.data.paidAmount}`);
      console.log(`   New Balance Amount: ${response.data.balanceAmount}`);

    } catch (apiError) {
      // If API call fails, we can try direct database update (not recommended but for script purposes)
      console.log(`\n⚠️  API call failed. Attempting direct database update...`);
      console.log(`   Error: ${apiError.message}`);
      
      // Rollback and suggest manual payment
      await transaction.rollback();
      console.log(`\n❌ Cannot proceed with direct database update for security reasons.`);
      console.log(`   Please use the UI or ensure API authentication is configured.`);
      throw apiError;
    }

    await transaction.commit();
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
  console.error('Usage: node full-pay-invoice.js INV-20251114-0001');
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

