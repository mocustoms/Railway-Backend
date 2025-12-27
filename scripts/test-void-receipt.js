require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { Receipt, GeneralLedger, Customer, SalesInvoice, ReceiptItem } = require('../server/models');
const { Op } = require('sequelize');

async function testVoidReceipt(receiptRefNumber, useRailway = false) {
  let dbUrl;
  if (useRailway) {
    // Use Railway database URL from environment or fallback to the one provided earlier
    dbUrl = process.env.RAILWAY_DATABASE_URL || 
            'postgresql://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';
    console.log('📊 Using Railway database');
  } else {
    dbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
    console.log('📊 Using Local database');
  }
  const sequelize = createDatabaseConnection(dbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database');
  
    console.log(`\n🔍 Testing void receipt: ${receiptRefNumber}\n`);
    console.log('='.repeat(80));
    
    // 1. Find the receipt
    const receipt = await Receipt.findOne({
      where: { 
        [Op.or]: [
          { receipt_reference_number: receiptRefNumber },
          { receiptReferenceNumber: receiptRefNumber }
        ]
      },
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          attributes: ['id', 'invoice_ref_number', 'paid_amount', 'total_amount']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'full_name', 'debt_balance', 'deposit_balance', 'loyalty_points']
        }
      ]
    });

    if (!receipt) {
      const dbType = useRailway ? 'Railway' : 'local';
      console.log(`❌ Receipt ${receiptRefNumber} not found in ${dbType} database`);
      console.log(`\n💡 Trying to find any receipts with similar reference numbers...`);
      
      // Try both field name formats
      const similarReceipts = await Receipt.findAll({
        where: {
          [Op.or]: [
            { receipt_reference_number: { [Op.like]: `%${receiptRefNumber.split('-').pop()}%` } },
            { receiptReferenceNumber: { [Op.like]: `%${receiptRefNumber.split('-').pop()}%` } }
          ]
        },
        attributes: ['id', 'receipt_reference_number', 'receiptReferenceNumber', 'status', 'created_at'],
        limit: 10,
        order: [['created_at', 'DESC']]
      });
      
      if (similarReceipts.length > 0) {
        console.log(`\nFound ${similarReceipts.length} similar receipts:`);
        similarReceipts.forEach(r => {
          const refNum = r.receipt_reference_number || r.receiptReferenceNumber;
          console.log(`   - ${refNum} (Status: ${r.status}, Created: ${r.created_at})`);
        });
      } else {
        console.log(`\n💡 No similar receipts found. Listing recent receipts...`);
        const recentReceipts = await Receipt.findAll({
          attributes: ['id', 'receipt_reference_number', 'receiptReferenceNumber', 'status', 'created_at'],
          limit: 5,
          order: [['created_at', 'DESC']]
        });
        if (recentReceipts.length > 0) {
          console.log(`\nRecent receipts in database:`);
          recentReceipts.forEach(r => {
            const refNum = r.receipt_reference_number || r.receiptReferenceNumber;
            console.log(`   - ${refNum} (Status: ${r.status}, Created: ${r.created_at})`);
          });
        }
      }
      
      return;
    }

    console.log(`\n📋 RECEIPT DETAILS:`);
    console.log(`   ID: ${receipt.id}`);
    console.log(`   Status: ${receipt.status}`);
    console.log(`   Payment Amount: ${receipt.payment_amount}`);
    console.log(`   Equivalent Amount: ${receipt.equivalent_amount}`);
    console.log(`   Use Customer Deposit: ${receipt.use_customer_deposit}`);
    console.log(`   Deposit Amount: ${receipt.deposit_amount || 0}`);
    console.log(`   Use Loyalty Points: ${receipt.use_loyalty_points}`);
    console.log(`   Loyalty Points Value: ${receipt.loyalty_points_value || 0}`);
    console.log(`   Reversed At: ${receipt.reversed_at || 'Not set'}`);
    console.log(`   Reversed By: ${receipt.reversed_by || 'Not set'}`);
    console.log(`   Reversal Reason: ${receipt.reversal_reason || 'Not provided'}`);

    // 2. Check receipt status
    console.log(`\n✅ RECEIPT STATUS CHECK:`);
    if (receipt.status === 'reversed') {
      console.log(`   ✓ Receipt status is 'reversed'`);
    } else {
      console.log(`   ❌ Receipt status is '${receipt.status}' (expected 'reversed')`);
    }

    // 3. Find original GL entries (INVOICE_PAYMENT)
    const originalGLEntries = await GeneralLedger.findAll({
      where: {
        reference_number: receipt.salesInvoice.invoice_ref_number,
        transaction_type: 'INVOICE_PAYMENT',
        general_ledger_id: {
          [Op.ne]: null
        }
      },
      order: [['created_at', 'ASC']]
    });

    // Find the receivable credit entry matching this receipt
    const receivableGLEntry = originalGLEntries.find(gl => 
      gl.account_id === receipt.receivable_account_id &&
      gl.account_nature === 'credit' &&
      Math.abs(parseFloat(gl.user_credit_amount || 0) - parseFloat(receipt.payment_amount)) < 0.01
    );

    if (!receivableGLEntry) {
      console.log(`\n❌ Could not find original GL entry for this receipt`);
      return;
    }

    // Get all GL entries for this payment batch
    const originalGLBatch = originalGLEntries.filter(gl => 
      gl.general_ledger_id === receivableGLEntry.general_ledger_id
    );

    console.log(`\n📊 ORIGINAL GL ENTRIES (${originalGLBatch.length} entries):`);
    originalGLBatch.forEach((gl, index) => {
      console.log(`   ${index + 1}. ${gl.account_name} (${gl.account_code})`);
      console.log(`      Nature: ${gl.account_nature.toUpperCase()}`);
      console.log(`      Amount: ${gl.user_debit_amount || gl.user_credit_amount || 0}`);
      console.log(`      Equivalent: ${gl.equivalent_debit_amount || gl.equivalent_credit_amount || 0}`);
    });

    // 4. Find reversal GL entries (RECEIPT_REVERSAL)
    const reversalGLEntries = await GeneralLedger.findAll({
      where: {
        reference_number: receiptRefNumber,
        transaction_type: 'RECEIPT_REVERSAL'
      },
      order: [['created_at', 'ASC']]
    });

    console.log(`\n🔄 REVERSAL GL ENTRIES (${reversalGLEntries.length} entries):`);
    if (reversalGLEntries.length === 0) {
      console.log(`   ❌ No reversal GL entries found!`);
    } else {
      reversalGLEntries.forEach((gl, index) => {
        console.log(`   ${index + 1}. ${gl.account_name} (${gl.account_code})`);
        console.log(`      Nature: ${gl.account_nature.toUpperCase()}`);
        console.log(`      Amount: ${gl.user_debit_amount || gl.user_credit_amount || 0}`);
        console.log(`      Equivalent: ${gl.equivalent_debit_amount || gl.equivalent_credit_amount || 0}`);
      });
    }

    // 5. Verify reversal entries match original (opposite nature, same amounts)
    console.log(`\n✅ REVERSAL VERIFICATION:`);
    if (reversalGLEntries.length !== originalGLBatch.length) {
      console.log(`   ❌ Entry count mismatch: Original=${originalGLBatch.length}, Reversal=${reversalGLEntries.length}`);
    } else {
      console.log(`   ✓ Entry count matches: ${originalGLBatch.length} entries`);
    }

    let allReversalsCorrect = true;
    for (const original of originalGLBatch) {
      const reversal = reversalGLEntries.find(r => r.account_id === original.account_id);
      
      if (!reversal) {
        console.log(`   ❌ No reversal entry found for account: ${original.account_name} (${original.account_code})`);
        allReversalsCorrect = false;
        continue;
      }

      // Check nature is opposite
      const expectedNature = original.account_nature === 'debit' ? 'credit' : 'debit';
      if (reversal.account_nature !== expectedNature) {
        console.log(`   ❌ Nature mismatch for ${original.account_name}: Original=${original.account_nature}, Reversal=${reversal.account_nature} (expected ${expectedNature})`);
        allReversalsCorrect = false;
      } else {
        console.log(`   ✓ ${original.account_name}: Nature reversed correctly (${original.account_nature} → ${reversal.account_nature})`);
      }

      // Check amounts match
      const originalAmount = parseFloat(original.user_debit_amount || original.user_credit_amount || 0);
      const reversalAmount = parseFloat(reversal.user_debit_amount || reversal.user_credit_amount || 0);
      
      if (Math.abs(originalAmount - reversalAmount) > 0.01) {
        console.log(`   ❌ Amount mismatch for ${original.account_name}: Original=${originalAmount}, Reversal=${reversalAmount}`);
        allReversalsCorrect = false;
      } else {
        console.log(`   ✓ ${original.account_name}: Amount matches (${originalAmount})`);
      }
    }

    if (allReversalsCorrect && reversalGLEntries.length === originalGLBatch.length) {
      console.log(`\n   ✅ All reversal GL entries are correct!`);
    }

    // 6. Check customer balances
    console.log(`\n💰 CUSTOMER BALANCE CHECK:`);
    console.log(`   Customer: ${receipt.customer.full_name}`);
    console.log(`   Current Debt Balance: ${parseFloat(receipt.customer.debt_balance || 0).toFixed(2)}`);
    console.log(`   Current Deposit Balance: ${parseFloat(receipt.customer.deposit_balance || 0).toFixed(2)}`);
    console.log(`   Current Loyalty Points: ${parseFloat(receipt.customer.loyalty_points || 0).toFixed(2)}`);
    
    // Note: We can't verify the exact balance without knowing the original balance
    // But we can check if the receipt items were deleted
    const receiptItems = await ReceiptItem.findAll({
      where: { receipt_id: receipt.id }
    });

    console.log(`\n📦 RECEIPT ITEMS CHECK:`);
    if (receiptItems.length === 0) {
      console.log(`   ✓ Receipt items have been deleted (expected)`);
    } else {
      console.log(`   ❌ Receipt items still exist (${receiptItems.length} items found)`);
    }

    // 7. Check invoice paid amount
    console.log(`\n📄 INVOICE PAID AMOUNT CHECK:`);
    console.log(`   Invoice: ${receipt.salesInvoice.invoice_ref_number}`);
    console.log(`   Total Amount: ${parseFloat(receipt.salesInvoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Paid Amount: ${parseFloat(receipt.salesInvoice.paid_amount || 0).toFixed(2)}`);
    console.log(`   Balance: ${(parseFloat(receipt.salesInvoice.total_amount || 0) - parseFloat(receipt.salesInvoice.paid_amount || 0)).toFixed(2)}`);

    // Check if there are any remaining receipt items for this invoice
    const remainingReceiptItems = await ReceiptItem.findAll({
      where: { sales_invoice_id: receipt.sales_invoice_id }
    });

    const totalPaidFromItems = remainingReceiptItems.reduce((sum, item) => 
      sum + parseFloat(item.payment_amount || 0), 0
    );

    console.log(`   Remaining Receipt Items: ${remainingReceiptItems.length}`);
    console.log(`   Total Paid from Items: ${totalPaidFromItems.toFixed(2)}`);
    
    if (Math.abs(parseFloat(receipt.salesInvoice.paid_amount || 0) - totalPaidFromItems) < 0.01) {
      console.log(`   ✓ Invoice paid amount matches remaining receipt items`);
    } else {
      console.log(`   ⚠️  Invoice paid amount (${parseFloat(receipt.salesInvoice.paid_amount || 0).toFixed(2)}) doesn't match receipt items total (${totalPaidFromItems.toFixed(2)})`);
    }

    // 8. Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📊 SUMMARY:`);
    const checks = [
      { name: 'Receipt status is reversed', pass: receipt.status === 'reversed' },
      { name: 'Reversal GL entries exist', pass: reversalGLEntries.length > 0 },
      { name: 'Reversal GL entries match original', pass: allReversalsCorrect && reversalGLEntries.length === originalGLBatch.length },
      { name: 'Receipt items deleted', pass: receiptItems.length === 0 },
      { name: 'Invoice paid amount updated', pass: Math.abs(parseFloat(receipt.salesInvoice.paid_amount || 0) - totalPaidFromItems) < 0.01 }
    ];

    checks.forEach(check => {
      console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
    });

    const allPassed = checks.every(check => check.pass);
    console.log(`\n${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}\n`);

  } catch (error) {
    console.error('❌ Error testing void receipt:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Get receipt reference number from command line
const receiptRefNumber = process.argv[2];
const useRailway = process.argv[3] === '--railway' || process.argv[3] === '-r';

if (!receiptRefNumber) {
  console.error('Usage: node test-void-receipt.js <RECEIPT_REF_NUMBER> [--railway]');
  console.error('Example: node test-void-receipt.js RCP-20251118-0002');
  console.error('Example: node test-void-receipt.js RCP-20251118-0002 --railway');
  process.exit(1);
}

testVoidReceipt(receiptRefNumber, useRailway)
  .then(() => {
    console.log('Test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });

