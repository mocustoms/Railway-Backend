/**
 * Test Script: Check if Invoice INV-20251111-0028 is posted to all required tables
 * 
 * This script verifies that a sales invoice has been properly posted to:
 * 1. General Ledger entries
 * 2. Customer balance updates
 * 3. Loyalty Transactions
 * 4. Price History
 * 5. Product Expiry updates
 * 6. Product Serial Numbers
 * 7. Product Transactions
 * 8. Sales Transaction
 */

const sequelize = require('./config/database');
const { Op } = require('sequelize');
const {
  SalesInvoice,
  SalesInvoiceItem,
  GeneralLedger,
  Customer,
  LoyaltyTransaction,
  PriceHistory,
  ProductExpiryDate,
  ProductSerialNumber,
  ProductTransaction,
  SalesTransaction,
  Product,
  Store,
  FinancialYear
} = require('./server/models');

const invoiceRefNumber = 'INV-20251111-0028';

async function testInvoicePosting() {
  try {
    console.log('🔍 Testing Invoice Posting for:', invoiceRefNumber);
    console.log('='.repeat(80));
    
    // 1. Find the invoice
    console.log('\n1️⃣  Checking Sales Invoice...');
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
              attributes: ['id', 'code', 'name']
            }
          ]
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'debt_balance', 'deposit_balance', 'loyalty_points']
        },
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: FinancialYear,
          as: 'financialYear',
          attributes: ['id', 'name']
        }
      ]
    });

    if (!invoice) {
      console.log('❌ Invoice NOT FOUND:', invoiceRefNumber);
      return;
    }

    console.log('✅ Invoice Found:');
    console.log(`   ID: ${invoice.id}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Payment Status: ${invoice.payment_status}`);
    console.log(`   Total Amount: ${invoice.total_amount}`);
    console.log(`   Paid Amount: ${invoice.paid_amount}`);
    console.log(`   Balance Amount: ${invoice.balance_amount}`);
    console.log(`   Customer: ${invoice.customer?.full_name} (${invoice.customer?.customer_id})`);
    console.log(`   Store: ${invoice.store?.name}`);
    console.log(`   Items Count: ${invoice.items?.length || 0}`);
    console.log(`   Approved By: ${invoice.approved_by ? 'Yes' : 'No'}`);
    console.log(`   Approved Date: ${invoice.approved_at || 'N/A'}`);

    // 2. Check General Ledger entries
    console.log('\n2️⃣  Checking General Ledger Entries...');
    const glEntries = await GeneralLedger.findAll({
      where: {
        reference_number: {
          [Op.like]: `${invoiceRefNumber}%`
        }
      },
      order: [['created_at', 'ASC']]
    });

    console.log(`   Found ${glEntries.length} GL entries`);
    
    if (glEntries.length === 0) {
      console.log('   ❌ NO General Ledger entries found!');
    } else {
      console.log('   ✅ General Ledger entries found:');
      const glTypes = {};
      glEntries.forEach(entry => {
        const type = entry.transaction_type || 'UNKNOWN';
        glTypes[type] = (glTypes[type] || 0) + 1;
        console.log(`      - ${entry.transaction_type_name || type}: ${entry.account_name} (${entry.account_nature}) - ${entry.amount}`);
      });
      console.log(`   Summary: ${Object.keys(glTypes).length} different transaction types`);
      
      // Check for expected GL entries
      const expectedTypes = ['COGS', 'INVENTORY', 'ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'TAX_PAYABLE', 'WHT_RECEIVABLE', 'DISCOUNT_ALLOWED'];
      const foundTypes = Object.keys(glTypes);
      const missingTypes = expectedTypes.filter(type => 
        !foundTypes.some(found => found.includes(type) || found.includes(type.replace('_', '')))
      );
      
      if (missingTypes.length > 0) {
        console.log(`   ⚠️  Missing expected GL types: ${missingTypes.join(', ')}`);
      } else {
        console.log('   ✅ All expected GL entry types found');
      }
    }

    // 3. Check Customer balance update
    console.log('\n3️⃣  Checking Customer Balance Update...');
    if (invoice.customer) {
      const customer = await Customer.findByPk(invoice.customer_id);
      if (customer) {
        console.log(`   Customer Debt Balance: ${customer.debt_balance}`);
        console.log(`   Customer Deposit Balance: ${customer.deposit_balance}`);
        console.log(`   Customer Loyalty Points: ${customer.loyalty_points}`);
        
        // Check if debt balance includes this invoice
        if (parseFloat(customer.debt_balance) >= parseFloat(invoice.balance_amount)) {
          console.log('   ✅ Customer debt balance appears to include this invoice');
        } else {
          console.log('   ⚠️  Customer debt balance may not include this invoice');
        }
      }
    }

    // 4. Check Loyalty Transactions
    console.log('\n4️⃣  Checking Loyalty Transactions...');
    const loyaltyTransactions = await LoyaltyTransaction.findAll({
      where: {
        sales_invoice_id: invoice.id
      }
    });

    console.log(`   Found ${loyaltyTransactions.length} loyalty transactions`);
    if (loyaltyTransactions.length > 0) {
      console.log('   ✅ Loyalty transactions found:');
      loyaltyTransactions.forEach(lt => {
        console.log(`      - Points: ${lt.points}, Type: ${lt.transaction_type}, Date: ${lt.transaction_date}`);
      });
    } else {
      console.log('   ℹ️  No loyalty transactions (may be normal if customer has no loyalty card)');
    }

    // 5. Check Price History
    console.log('\n5️⃣  Checking Price History...');
    let priceHistoryCount = 0;
    for (const item of invoice.items || []) {
      const priceHistory = await PriceHistory.findAll({
        where: {
          entity_type: 'product',
          entity_id: item.product_id,
          reference_number: invoiceRefNumber
        }
      });
      priceHistoryCount += priceHistory.length;
    }
    
    console.log(`   Found ${priceHistoryCount} price history entries`);
    if (priceHistoryCount > 0) {
      console.log('   ✅ Price history entries found');
    } else {
      console.log('   ⚠️  No price history entries found');
    }

    // 6. Check Product Expiry Date updates
    console.log('\n6️⃣  Checking Product Expiry Date Updates...');
    let expiryUpdates = 0;
    for (const item of invoice.items || []) {
      if (item.batch_number) {
        const expiry = await ProductExpiryDate.findOne({
          where: {
            product_id: item.product_id,
            batch_number: item.batch_number,
            store_id: invoice.store_id
          }
        });
        if (expiry) {
          expiryUpdates++;
        }
      }
    }
    
    console.log(`   Found ${expiryUpdates} batch number records`);
    if (expiryUpdates > 0 || invoice.items?.every(item => !item.batch_number)) {
      console.log('   ✅ Product expiry tracking OK');
    } else {
      console.log('   ⚠️  Some batch numbers may not be tracked');
    }

    // 7. Check Product Serial Numbers
    console.log('\n7️⃣  Checking Product Serial Numbers...');
    let serialNumberCount = 0;
    for (const item of invoice.items || []) {
      if (item.serial_numbers && item.serial_numbers.length > 0) {
        for (const serial of item.serial_numbers) {
          const serialRecord = await ProductSerialNumber.findOne({
            where: {
              product_id: item.product_id,
              serial_number: serial,
              store_id: invoice.store_id
            }
          });
          if (serialRecord && serialRecord.status === 'sold') {
            serialNumberCount++;
          }
        }
      }
    }
    
    console.log(`   Found ${serialNumberCount} serial numbers marked as sold`);
    if (serialNumberCount > 0 || invoice.items?.every(item => !item.serial_numbers || item.serial_numbers.length === 0)) {
      console.log('   ✅ Serial number tracking OK');
    } else {
      console.log('   ⚠️  Some serial numbers may not be marked as sold');
    }

    // 8. Check Product Transactions
    console.log('\n8️⃣  Checking Product Transactions...');
    const productTransactions = await ProductTransaction.findAll({
      where: {
        reference_number: invoiceRefNumber
      },
      order: [['created_at', 'ASC']]
    });

    console.log(`   Found ${productTransactions.length} product transactions`);
    if (productTransactions.length > 0) {
      console.log('   ✅ Product transactions found:');
      productTransactions.forEach(pt => {
        console.log(`      - Product: ${pt.product_id}, Quantity: ${pt.quantity}, Type: ${pt.transaction_type}`);
      });
    } else {
      console.log('   ❌ NO Product transactions found!');
    }

    // 9. Check Sales Transaction
    console.log('\n9️⃣  Checking Sales Transaction...');
    const salesTransaction = await SalesTransaction.findOne({
      where: {
        source_invoice_id: invoice.id
      }
    });

    if (salesTransaction) {
      console.log('   ✅ Sales Transaction found:');
      console.log(`      Reference: ${salesTransaction.transaction_ref_number}`);
      console.log(`      Type: ${salesTransaction.transaction_type}`);
      console.log(`      Total: ${salesTransaction.total_amount}`);
      console.log(`      Status: ${salesTransaction.status}`);
    } else {
      console.log('   ❌ NO Sales Transaction found!');
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    
    const checks = {
      'Invoice Status': invoice.status === 'approved' || invoice.status === 'paid' || invoice.status === 'partial_paid',
      'General Ledger': glEntries.length > 0,
      'Product Transactions': productTransactions.length > 0,
      'Sales Transaction': salesTransaction !== null,
      'Price History': priceHistoryCount > 0 || invoice.items?.length === 0,
      'Customer Balance': invoice.customer !== null
    };

    const allPassed = Object.values(checks).every(check => check === true);
    
    Object.entries(checks).forEach(([name, passed]) => {
      console.log(`   ${passed ? '✅' : '❌'} ${name}: ${passed ? 'PASS' : 'FAIL'}`);
    });

    if (allPassed) {
      console.log('\n✅ ALL CHECKS PASSED - Invoice appears to be fully posted!');
    } else {
      console.log('\n⚠️  SOME CHECKS FAILED - Invoice may not be fully posted!');
      console.log('\n💡 If invoice status is not "approved", it needs to be approved first.');
      console.log('   Approval triggers posting to all tables.');
    }

  } catch (error) {
    console.error('❌ Error testing invoice posting:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

// Run the test
testInvoicePosting();

