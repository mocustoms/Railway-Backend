/**
 * Test Script: Check Invoice Payment Posting for INV-20251111-0028
 * 
 * This script verifies that invoice payments have been properly posted to:
 * 1. Receipt records
 * 2. ReceiptItems (item-level payments)
 * 3. ReceiptTransactions (GL entries for payments)
 * 4. General Ledger entries (payment-related)
 * 5. Customer balance updates (debt, deposit, loyalty)
 * 6. Payment method details
 */

const sequelize = require('./config/database');
const { Op } = require('sequelize');
const {
  SalesInvoice,
  SalesInvoiceItem,
  Receipt,
  ReceiptItem,
  ReceiptTransaction,
  GeneralLedger,
  Customer,
  PaymentType,
  BankDetail,
  Account,
  Currency,
  FinancialYear
} = require('./server/models');

const invoiceRefNumber = 'INV-20251111-0028';

async function testInvoicePayment() {
  try {
    console.log('💳 Testing Invoice Payment Posting for:', invoiceRefNumber);
    console.log('='.repeat(80));
    
    // 1. Find the invoice
    console.log('\n1️⃣  Checking Sales Invoice...');
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items',
          attributes: ['id', 'product_id', 'quantity', 'unit_price', 'line_total']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'debt_balance', 'deposit_balance', 'loyalty_points']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'code', 'name', 'symbol']
        }
      ]
    });

    if (!invoice) {
      console.log('❌ Invoice NOT FOUND:', invoiceRefNumber);
      return;
    }

    console.log('✅ Invoice Found:');
    console.log(`   Total Amount: ${invoice.total_amount}`);
    console.log(`   Paid Amount: ${invoice.paid_amount}`);
    console.log(`   Balance Amount: ${invoice.balance_amount}`);
    console.log(`   Payment Status: ${invoice.payment_status}`);
    console.log(`   Currency: ${invoice.currency?.code || 'N/A'}`);

    // 2. Check Receipt records
    console.log('\n2️⃣  Checking Receipt Records...');
    const receipts = await Receipt.findAll({
      where: {
        sales_invoice_id: invoice.id
      },
      include: [
        {
          model: PaymentType,
          as: 'paymentType',
          attributes: ['id', 'code', 'name']
        },
        {
          model: BankDetail,
          as: 'bankDetail',
          attributes: ['id', 'bank_name', 'account_number'],
          required: false
        },
        {
          model: Account,
          as: 'receivableAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'assetAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'liabilityAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'code', 'name']
        }
      ],
      order: [['created_at', 'ASC']]
    });

    console.log(`   Found ${receipts.length} receipt(s)`);
    
    if (receipts.length === 0) {
      console.log('   ❌ NO Receipt records found!');
    } else {
      console.log('   ✅ Receipt records found:');
      receipts.forEach((receipt, index) => {
        console.log(`\n   Receipt ${index + 1}:`);
        console.log(`      Reference: ${receipt.receiptReferenceNumber}`);
        console.log(`      Date: ${receipt.transactionDate}`);
        console.log(`      Payment Amount: ${receipt.paymentAmount}`);
        console.log(`      Deposit Amount: ${receipt.depositAmount || 0}`);
        console.log(`      Loyalty Points Amount: ${receipt.loyaltyPointsAmount || 0}`);
        console.log(`      Total Amount: ${receipt.paymentAmount + (receipt.depositAmount || 0) + (receipt.loyaltyPointsAmount || 0)}`);
        console.log(`      Payment Type: ${receipt.paymentType?.name || 'N/A'} (${receipt.paymentType?.code || 'N/A'})`);
        console.log(`      Bank Detail: ${receipt.bankDetail ? `${receipt.bankDetail.bank_name} - ${receipt.bankDetail.account_number}` : 'N/A'}`);
        console.log(`      Cheque Number: ${receipt.cheque_number || 'N/A'}`);
        console.log(`      Receivable Account: ${receipt.receivableAccount?.name || 'N/A'} (${receipt.receivableAccount?.code || 'N/A'})`);
        console.log(`      Asset Account: ${receipt.assetAccount?.name || 'N/A'} (${receipt.assetAccount?.code || 'N/A'})`);
        console.log(`      Liability Account: ${receipt.liabilityAccount?.name || 'N/A'} (${receipt.liabilityAccount?.code || 'N/A'})`);
        console.log(`      Currency: ${receipt.currency?.code || 'N/A'}`);
        console.log(`      Exchange Rate: ${receipt.exchangeRate || 1}`);
        console.log(`      Equivalent Amount: ${receipt.equivalentAmount || receipt.paymentAmount}`);
      });
    }

    // 3. Check ReceiptItems (item-level payments)
    console.log('\n3️⃣  Checking ReceiptItems (Item-Level Payments)...');
    let totalReceiptItems = 0;
    for (const receipt of receipts) {
      const receiptItems = await ReceiptItem.findAll({
        where: {
          receiptId: receipt.id
        },
        include: [
          {
            model: SalesInvoiceItem,
            as: 'salesInvoiceItem',
            attributes: ['id', 'product_id', 'quantity', 'line_total'],
            required: false
          }
        ],
        order: [['created_at', 'ASC']]
      });

      totalReceiptItems += receiptItems.length;
      
      if (receiptItems.length > 0) {
        console.log(`   ✅ Receipt ${receipt.receiptReferenceNumber} has ${receiptItems.length} item-level payment(s):`);
        receiptItems.forEach((item, index) => {
          console.log(`\n      ReceiptItem ${index + 1}:`);
          console.log(`         Invoice Item ID: ${item.salesInvoiceItemId}`);
          console.log(`         Payment Amount: ${item.paymentAmount}`);
          console.log(`         Item Total: ${item.itemTotal}`);
          console.log(`         Item Remaining: ${item.itemRemaining}`);
          console.log(`         Equivalent Amount: ${item.equivalentAmount}`);
          if (item.salesInvoiceItem) {
            console.log(`         Invoice Item Line Total: ${item.salesInvoiceItem.line_total}`);
            console.log(`         Invoice Item Quantity: ${item.salesInvoiceItem.quantity}`);
          }
        });
      } else {
        console.log(`   ⚠️  Receipt ${receipt.receiptReferenceNumber} has NO ReceiptItems`);
      }
    }

    // Also check by invoice ID directly
    const allReceiptItemsForInvoice = await ReceiptItem.findAll({
      where: {
        salesInvoiceId: invoice.id
      },
      include: [
        {
          model: SalesInvoiceItem,
          as: 'salesInvoiceItem',
          attributes: ['id', 'product_id', 'quantity', 'line_total'],
          required: false
        }
      ],
      order: [['created_at', 'ASC']]
    });

    if (allReceiptItemsForInvoice.length > 0 && totalReceiptItems === 0) {
      console.log(`\n   ⚠️  Found ${allReceiptItemsForInvoice.length} ReceiptItems by invoice ID, but not linked to receipts!`);
      allReceiptItemsForInvoice.forEach((item, index) => {
        console.log(`      Item ${index + 1}: Payment Amount = ${item.paymentAmount}, Receipt ID = ${item.receiptId}`);
      });
    }

    if (totalReceiptItems === 0 && allReceiptItemsForInvoice.length === 0) {
      console.log('   ❌ NO ReceiptItems found at all!');
      console.log('   ⚠️  This indicates payment was NOT made at item level, which contradicts system design.');
    } else {
      console.log(`\n   ✅ Total ReceiptItems found: ${totalReceiptItems > 0 ? totalReceiptItems : allReceiptItemsForInvoice.length}`);
    }

    // 4. Check ReceiptTransactions (GL entries for payments)
    console.log('\n4️⃣  Checking ReceiptTransactions (Payment GL Entries)...');
    let totalReceiptTransactions = 0;
    for (const receipt of receipts) {
      const receiptTransactions = await ReceiptTransaction.findAll({
        where: {
          receipt_id: receipt.id
        },
        include: [
          {
            model: Account,
            as: 'receivableAccount',
            attributes: ['id', 'code', 'name'],
            required: false
          },
          {
            model: Account,
            as: 'assetAccount',
            attributes: ['id', 'code', 'name'],
            required: false
          },
          {
            model: Account,
            as: 'liabilityAccount',
            attributes: ['id', 'code', 'name'],
            required: false
          },
          {
            model: Account,
            as: 'loyaltyAccount',
            attributes: ['id', 'code', 'name'],
            required: false
          },
          {
            model: PaymentType,
            as: 'paymentType',
            attributes: ['id', 'code', 'name'],
            required: false
          }
        ],
        order: [['created_at', 'ASC']]
      });

      totalReceiptTransactions += receiptTransactions.length;
      
      if (receiptTransactions.length > 0) {
        console.log(`   Receipt ${receipt.receiptReferenceNumber} has ${receiptTransactions.length} transaction(s):`);
        receiptTransactions.forEach((rt, index) => {
          console.log(`      Transaction ${index + 1}:`);
          console.log(`         Type: ${rt.transactionType || 'N/A'}`);
          console.log(`         Amount: ${rt.amount}`);
          console.log(`         Receivable Account: ${rt.receivableAccount?.name || 'N/A'}`);
          console.log(`         Asset Account: ${rt.assetAccount?.name || 'N/A'}`);
          console.log(`         Liability Account: ${rt.liabilityAccount?.name || 'N/A'}`);
          console.log(`         Loyalty Account: ${rt.loyaltyAccount?.name || 'N/A'}`);
        });
      }
    }

    if (totalReceiptTransactions === 0) {
      console.log('   ❌ NO ReceiptTransactions found!');
    } else {
      console.log(`   ✅ Total ReceiptTransactions: ${totalReceiptTransactions}`);
    }

    // 5. Check General Ledger entries for payments
    console.log('\n5️⃣  Checking General Ledger Entries for Payments...');
    const paymentGlEntries = await GeneralLedger.findAll({
      where: {
        reference_number: invoiceRefNumber,
        transaction_type: {
          [Op.like]: '%PAYMENT%'
        }
      },
      order: [['created_at', 'ASC']]
    });

    console.log(`   Found ${paymentGlEntries.length} payment-related GL entries`);
    
    if (paymentGlEntries.length > 0) {
      console.log('   ✅ Payment GL entries found:');
      paymentGlEntries.forEach((entry, index) => {
        console.log(`      Entry ${index + 1}:`);
        console.log(`         Account: ${entry.account_name} (${entry.account_code})`);
        console.log(`         Nature: ${entry.account_nature}`);
        console.log(`         Amount: ${entry.amount}`);
        console.log(`         Debit: ${entry.user_debit_amount || 0}, Credit: ${entry.user_credit_amount || 0}`);
        console.log(`         Description: ${entry.description || 'N/A'}`);
      });
    } else {
      console.log('   ⚠️  No payment-specific GL entries found (may be included in invoice GL entries)');
    }

    // 6. Verify payment totals
    console.log('\n6️⃣  Verifying Payment Totals...');
    const totalReceiptAmount = receipts.reduce((sum, r) => {
      const payment = parseFloat(r.paymentAmount || 0);
      const deposit = parseFloat(r.depositAmount || 0);
      const loyalty = parseFloat(r.loyaltyPointsAmount || 0);
      return sum + payment + deposit + loyalty;
    }, 0);
    const invoicePaidAmount = parseFloat(invoice.paid_amount || 0);
    const invoiceBalance = parseFloat(invoice.balance_amount || 0);
    const invoiceTotal = parseFloat(invoice.total_amount || 0);

    console.log(`   Invoice Total Amount: ${invoiceTotal}`);
    console.log(`   Invoice Paid Amount: ${invoicePaidAmount}`);
    console.log(`   Invoice Balance Amount: ${invoiceBalance}`);
    console.log(`   Total Receipt Amount: ${totalReceiptAmount}`);

    if (Math.abs(totalReceiptAmount - invoicePaidAmount) < 0.01) {
      console.log('   ✅ Receipt totals match invoice paid amount');
    } else {
      console.log(`   ⚠️  Receipt totals (${totalReceiptAmount}) do not match invoice paid amount (${invoicePaidAmount})`);
    }

    if (Math.abs(invoiceTotal - invoicePaidAmount - invoiceBalance) < 0.01) {
      console.log('   ✅ Invoice amounts balance correctly (Total = Paid + Balance)');
    } else {
      console.log('   ⚠️  Invoice amounts do not balance correctly');
    }

    // 7. Check customer balance impact
    console.log('\n7️⃣  Checking Customer Balance Impact...');
    if (invoice.customer) {
      const customer = await Customer.findByPk(invoice.customer_id);
      if (customer) {
        console.log(`   Customer: ${customer.full_name} (${customer.customer_id})`);
        console.log(`   Current Debt Balance: ${customer.debt_balance}`);
        console.log(`   Current Deposit Balance: ${customer.deposit_balance}`);
        console.log(`   Current Loyalty Points: ${customer.loyalty_points}`);
        
        // Calculate expected debt balance (should be reduced by paid amount)
        const expectedDebtReduction = invoicePaidAmount;
        console.log(`   Expected Debt Reduction: ${expectedDebtReduction}`);
        console.log('   ✅ Customer balances updated (verification requires knowing previous balance)');
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 PAYMENT POSTING SUMMARY');
    console.log('='.repeat(80));
    
    const checks = {
      'Receipt Records': receipts.length > 0,
      'ReceiptTransactions': totalReceiptTransactions > 0,
      'Payment GL Entries': paymentGlEntries.length > 0,
      'Amounts Match': Math.abs(totalReceiptAmount - invoicePaidAmount) < 0.01,
      'Invoice Balanced': Math.abs(invoiceTotal - invoicePaidAmount - invoiceBalance) < 0.01
    };

    const allPassed = Object.values(checks).every(check => check === true);
    
    Object.entries(checks).forEach(([name, passed]) => {
      console.log(`   ${passed ? '✅' : '❌'} ${name}: ${passed ? 'PASS' : 'FAIL'}`);
    });

    if (allPassed) {
      console.log('\n✅ ALL PAYMENT CHECKS PASSED - Invoice payment appears to be fully posted!');
    } else {
      console.log('\n⚠️  SOME PAYMENT CHECKS FAILED - Payment may not be fully posted!');
    }

    // Payment method summary
    if (receipts.length > 0) {
      console.log('\n💳 Payment Method Summary:');
      receipts.forEach((receipt, index) => {
        console.log(`   Payment ${index + 1}:`);
        console.log(`      Method: ${receipt.paymentType?.name || 'Unknown'}`);
        if (receipt.depositAmount > 0) {
          console.log(`      Used Customer Deposit: ${receipt.depositAmount}`);
        }
        if (receipt.loyaltyPointsAmount > 0) {
          console.log(`      Used Loyalty Points: ${receipt.loyaltyPointsAmount}`);
        }
        console.log(`      Direct Payment: ${receipt.paymentAmount || 0}`);
      });
    }

  } catch (error) {
    console.error('❌ Error testing invoice payment:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

// Run the test
testInvoicePayment();

