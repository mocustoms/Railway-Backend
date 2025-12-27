require('dotenv').config();
const sequelize = require('../config/database');
const {
  SalesInvoice,
  Receipt,
  ReceiptItem,
  GeneralLedger,
  Customer,
  LoyaltyCardConfig,
  Account,
  Currency,
  FinancialYear,
  TransactionType
} = require('../server/models');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');
const { Op } = require('sequelize');

// Mock request object
let mockReq = {
  user: {
    companyId: process.env.COMPANY_ID || null,
    id: process.env.USER_ID || '00000000-0000-0000-0000-000000000000',
    username: 'system',
    first_name: 'System',
    last_name: 'User'
  }
};

async function fixInvoiceLoyaltyPayment(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Fixing Loyalty Payment for Invoice: ${invoiceRefNumber}`);
    console.log(`${'='.repeat(80)}\n`);

    // Find invoice
    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(mockReq, { invoice_ref_number: invoiceRefNumber }),
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'loyalty_points']
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

    // Get a real user ID for this company
    const { User } = require('../server/models');
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

    console.log(`Invoice found: ${invoice.invoice_ref_number}`);
    console.log(`Customer: ${invoice.customer?.full_name || 'N/A'}`);
    console.log(`Current Paid Amount: ${invoice.paid_amount || 0}`);
    console.log(`Current Balance: ${invoice.balance_amount || 0}`);
    console.log(`Customer Loyalty Points: ${invoice.customer?.loyalty_points || 0}\n`);

    // Find receipts for this invoice with loyalty points
    const receipts = await Receipt.findAll({
      where: buildCompanyWhere(mockReq, {
        salesInvoiceId: invoice.id,
        useLoyaltyPoints: true
      }),
      include: [
        {
          model: ReceiptItem,
          as: 'items',
          attributes: ['id', 'paymentAmount', 'salesInvoiceItemId']
        }
      ],
      transaction
    });

    if (receipts.length === 0) {
      console.log('No loyalty point receipts found for this invoice.');
      await transaction.rollback();
      return;
    }

    console.log(`Found ${receipts.length} receipt(s) with loyalty points\n`);

    // Get loyalty config
    const loyaltyConfig = await LoyaltyCardConfig.findOne({
      where: buildCompanyWhere(mockReq, { is_active: true }),
      transaction
    });

    if (!loyaltyConfig) {
      throw new Error('Loyalty configuration not found');
    }

    const redemptionRate = parseFloat(loyaltyConfig.redemption_rate || 100);
    console.log(`Redemption Rate: ${redemptionRate}\n`);

    // Process each receipt
    for (const receipt of receipts) {
      console.log(`\nProcessing Receipt: ${receipt.receiptReferenceNumber}`);
      console.log(`  Loyalty Points Used: ${receipt.loyaltyPointsAmount || 0}`);
      console.log(`  Loyalty Points Value: ${receipt.loyaltyPointsValue || 0}`);
      console.log(`  Payment Amount: ${receipt.paymentAmount || 0}`);

      // Calculate what it should be based on receipt items
      const totalItemPayments = receipt.items.reduce((sum, item) => {
        return sum + parseFloat(item.paymentAmount || 0);
      }, 0);

      console.log(`  Total Item Payments: ${totalItemPayments}`);

      // The user entered amounts in items (currency)
      // Based on the issue: user entered 3500 in items (currency), had 3534 points available
      // With redemption rate 100: 3500 currency = 350,000 points (user doesn't have this!)
      // The system should have limited to available points: 3534 points = 35.34 currency
      // But the user said they entered 3500 and system took 3534, suggesting they meant 3500 POINTS
      // With redemption rate 100: 3500 points = 35 currency
      // So the correct fix: use 3500 points = 35 currency (what user intended)
      // OR: use available points 3534 = 35.34 currency (what system should have done)
      // Based on user's description "inserted 3500 but the system took 3,534", 
      // they wanted 3500 points, so correct amount is 35 currency
      const correctLoyaltyPointsAmount = 3500; // What user intended to use
      const correctPaymentAmount = correctLoyaltyPointsAmount / redemptionRate; // 3500 / 100 = 35
      const correctLoyaltyPointsValue = correctPaymentAmount; // Payment amount is the currency value

      console.log(`  Correct Payment Amount: ${correctPaymentAmount}`);
      console.log(`  Correct Loyalty Points Amount: ${correctLoyaltyPointsAmount}`);
      console.log(`  Correct Loyalty Points Value: ${correctLoyaltyPointsValue}`);

      // Check if already correct (within 0.01 tolerance)
      const pointsDiff = Math.abs(receipt.loyaltyPointsAmount - correctLoyaltyPointsAmount);
      const valueDiff = Math.abs(receipt.paymentAmount - correctPaymentAmount);
      
      if (pointsDiff < 0.01 && valueDiff < 0.01) {
        console.log(`  ✓ Receipt is already correct`);
        continue;
      }

      // Calculate difference: what was used vs what should be used
      // If system used 3456 points but should use 3500, difference = -44 points
      // We need to add back the extra points that were incorrectly deducted
      const pointsDifference = receipt.loyaltyPointsAmount - correctLoyaltyPointsAmount;
      const valueDifference = receipt.paymentAmount - correctPaymentAmount;

      console.log(`  Points Difference: ${pointsDifference}`);
      console.log(`  Value Difference: ${valueDifference}`);

      // Find GL entries for this receipt
      const glEntries = await GeneralLedger.findAll({
        where: buildCompanyWhere(mockReq, {
          reference_number: invoice.invoice_ref_number,
          transaction_type: 'INVOICE_PAYMENT',
          [Op.or]: [
            { transaction_type_name: { [Op.like]: '%Loyalty%' } },
            { account_nature: 'credit', amount: receipt.paymentAmount }
          ]
        }),
        transaction
      });

      console.log(`  Found ${glEntries.length} GL entries`);

      // Update receipt
      await receipt.update({
        loyaltyPointsAmount: correctLoyaltyPointsAmount,
        loyaltyPointsValue: correctPaymentAmount,
        paymentAmount: correctPaymentAmount,
        updatedBy: mockReq.user.id
      }, { transaction });

      // Update receipt items to match the correct payment amount
      // The items currently show 3500 (what user entered), but should show 35 (actual payment)
      const itemPaymentRatio = correctPaymentAmount / totalItemPayments;
      for (const item of receipt.items) {
        const currentAmount = parseFloat(item.paymentAmount || 0);
        const correctItemAmount = currentAmount * itemPaymentRatio;
        await item.update({
          paymentAmount: correctItemAmount,
          equivalentAmount: correctItemAmount * parseFloat(receipt.exchangeRate || 1)
        }, { transaction });
        console.log(`  Updated ReceiptItem ${item.id}: ${currentAmount} -> ${correctItemAmount}`);
      }

      // Update customer loyalty points
      // Original receipt used: receipt.loyaltyPointsAmount points
      // Should have used: correctLoyaltyPointsAmount points
      // Difference: receipt.loyaltyPointsAmount - correctLoyaltyPointsAmount
      // If positive, we need to add back points (system took too many)
      // If negative, we need to deduct points (system took too few)
      if (pointsDifference !== 0) {
        // Get current customer points before update
        await invoice.customer.reload({ transaction });
        const pointsBefore = parseFloat(invoice.customer.loyalty_points || 0);
        
        // Add back the difference (if system took 350000 but should take 3500, add back 346500)
        await Customer.increment('loyalty_points', {
          by: pointsDifference, // This will be negative, so increment adds back points
          where: buildCompanyWhere(mockReq, { id: invoice.customer_id }),
          transaction
        });
        
        await invoice.customer.reload({ transaction });
        const pointsAfter = parseFloat(invoice.customer.loyalty_points || 0);
        console.log(`  Updated customer loyalty points: ${pointsBefore} -> ${pointsAfter} (${pointsDifference > 0 ? 'added' : 'deducted'} ${Math.abs(pointsDifference)})`);
      }

      // Update GL entries
      for (const glEntry of glEntries) {
        if (glEntry.transaction_type_name && glEntry.transaction_type_name.includes('Loyalty')) {
          // This is the loyalty account debit entry
          await glEntry.update({
            amount: correctPaymentAmount,
            user_debit_amount: correctPaymentAmount,
            equivalent_debit_amount: correctPaymentAmount * parseFloat(glEntry.exchange_rate || 1),
            updated_by_code: mockReq.user.id,
            updated_by_name: `${mockReq.user.first_name} ${mockReq.user.last_name}`
          }, { transaction });
          console.log(`  Updated Loyalty Account GL entry (Debit): ${correctPaymentAmount}`);
        } else if (glEntry.account_nature === 'credit' && Math.abs(glEntry.amount - receipt.paymentAmount) < 0.01) {
          // This is the receivable account credit entry
          await glEntry.update({
            amount: correctPaymentAmount,
            user_credit_amount: correctPaymentAmount,
            equivalent_credit_amount: correctPaymentAmount * parseFloat(glEntry.exchange_rate || 1),
            updated_by_code: mockReq.user.id,
            updated_by_name: `${mockReq.user.first_name} ${mockReq.user.last_name}`
          }, { transaction });
          console.log(`  Updated Receivable Account GL entry (Credit): ${correctPaymentAmount}`);
        }
      }
    }

    // Recalculate invoice totals
    const allReceipts = await Receipt.findAll({
      where: buildCompanyWhere(mockReq, { salesInvoiceId: invoice.id }),
      attributes: ['paymentAmount'],
      transaction
    });

    const totalPaid = allReceipts.reduce((sum, r) => sum + parseFloat(r.paymentAmount || 0), 0);
    const totalAmount = parseFloat(invoice.total_amount || 0);
    const newBalance = Math.max(0, totalAmount - totalPaid);

    let paymentStatus = 'unpaid';
    if (totalPaid >= totalAmount) {
      paymentStatus = totalPaid > totalAmount ? 'overpaid' : 'paid';
    } else if (totalPaid > 0) {
      paymentStatus = 'partial';
    }

    await invoice.update({
      paid_amount: totalPaid,
      balance_amount: newBalance,
      payment_status: paymentStatus,
      updated_by: mockReq.user.id
    }, { transaction });

    console.log(`\n✅ Invoice updated:`);
    console.log(`   Paid Amount: ${totalPaid}`);
    console.log(`   Balance Amount: ${newBalance}`);
    console.log(`   Payment Status: ${paymentStatus}`);

    // Get updated customer
    await invoice.customer.reload({ transaction });
    console.log(`\n✅ Customer updated:`);
    console.log(`   Loyalty Points: ${invoice.customer.loyalty_points}`);

    await transaction.commit();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Invoice ${invoiceRefNumber} fixed successfully!`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    await transaction.rollback();
    console.error(`\n❌ Error fixing invoice:`, error.message);
    console.error(`Stack:`, error.stack);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference number from command line argument
const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.error('Usage: node fix-invoice-loyalty-payment.js <INVOICE_REF_NUMBER>');
  console.error('Example: node fix-invoice-loyalty-payment.js INV-20251114-0001');
  process.exit(1);
}

fixInvoiceLoyaltyPayment(invoiceRefNumber)
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

