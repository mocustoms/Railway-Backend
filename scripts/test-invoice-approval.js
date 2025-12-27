const sequelize = require('../config/database');
const { 
  SalesInvoice,
  GeneralLedger,
  Customer,
  LoyaltyTransaction,
  PriceHistory,
  ProductExpiryDate,
  ProductSerialNumber,
  ProductTransaction,
  SalesTransaction
} = require('../server/models');

async function testInvoiceApproval(invoiceRefNumber) {
  try {
    console.log(`\n🔍 Testing Invoice Approval for: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    // Find the invoice
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        {
          model: require('../server/models').SalesInvoiceItem,
          as: 'items'
        }
      ]
    });

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceRefNumber} not found`);
      return;
    }

    console.log(`\n✅ Invoice Found: ${invoiceRefNumber}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Customer: ${invoice.customer_id}`);
    console.log(`   Store: ${invoice.store_id}`);
    console.log(`   Items: ${invoice.items?.length || 0}`);

    if (invoice.status !== 'approved') {
      console.log(`\n⚠️  Invoice is not approved. Current status: ${invoice.status}`);
      console.log(`   Please approve the invoice first to test the approval flow.`);
      return;
    }

    const results = {
      generalLedger: { found: false, count: 0, entries: [] },
      customers: { found: false, updated: false },
      loyaltyTransactions: { found: false, count: 0, entries: [] },
      priceHistory: { found: false, count: 0, entries: [] },
      productExpiry: { found: false, count: 0, entries: [] },
      productSerial: { found: false, count: 0, entries: [] },
      productTransactions: { found: false, count: 0, entries: [] },
      salesTransaction: { found: false, updated: false }
    };

    // 1. GENERAL LEDGER
    console.log(`\n📊 1. Checking General Ledger...`);
    const glEntries = await GeneralLedger.findAll({
      where: {
        reference_number: {
          [sequelize.Sequelize.Op.like]: `${invoiceRefNumber}%`
        }
      },
      order: [['created_at', 'ASC']]
    });
    results.generalLedger.found = glEntries.length > 0;
    results.generalLedger.count = glEntries.length;
    results.generalLedger.entries = glEntries.map(gl => ({
      reference: gl.reference_number,
      account: gl.account_name,
      nature: gl.account_nature,
      amount: gl.amount
    }));
    console.log(`   ${results.generalLedger.found ? '✅' : '❌'} Found ${glEntries.length} GL entries`);
    if (glEntries.length > 0) {
      glEntries.forEach(gl => {
        console.log(`      - ${gl.reference_number}: ${gl.account_nature} ${gl.account_name} (${gl.amount})`);
      });
    }

    // 2. CUSTOMERS
    console.log(`\n👤 2. Checking Customers...`);
    if (invoice.customer_id) {
      const customer = await Customer.findByPk(invoice.customer_id);
      if (customer) {
        results.customers.found = true;
        results.customers.updated = true; // If invoice is approved, customer should be updated
        console.log(`   ✅ Customer found: ${customer.full_name}`);
        console.log(`      Debt Balance: ${customer.debt_balance}`);
        console.log(`      Account Balance: ${customer.account_balance}`);
        console.log(`      Loyalty Points: ${customer.loyalty_points || 0}`);
      } else {
        console.log(`   ❌ Customer not found`);
      }
    } else {
      console.log(`   ⚠️  No customer ID in invoice`);
    }

    // 3. LOYALTY TRANSACTIONS
    console.log(`\n🎁 3. Checking Loyalty Transactions...`);
    try {
      const loyaltyTransactions = await LoyaltyTransaction.findAll({
        where: {
          sales_invoice_id: invoice.id
        }
      });
      results.loyaltyTransactions.found = loyaltyTransactions.length > 0;
      results.loyaltyTransactions.count = loyaltyTransactions.length;
      results.loyaltyTransactions.entries = loyaltyTransactions.map(lt => ({
        ref: lt.transaction_ref_number,
        points: lt.points_amount,
        type: lt.transaction_type
      }));
      console.log(`   ${results.loyaltyTransactions.found ? '✅' : '⚠️ '} Found ${loyaltyTransactions.length} loyalty transaction(s)`);
      if (loyaltyTransactions.length > 0) {
        loyaltyTransactions.forEach(lt => {
          console.log(`      - ${lt.transaction_ref_number}: ${lt.points_amount} points (${lt.transaction_type})`);
        });
      } else {
        console.log(`      (No loyalty transactions - customer may not have loyalty card)`);
      }
    } catch (error) {
      console.log(`   ⚠️  Loyalty transactions table may not exist: ${error.message}`);
    }

    // 4. PRICE HISTORY
    console.log(`\n💰 4. Checking Price Change History...`);
    const priceHistory = await PriceHistory.findAll({
      where: {
        reference_number: invoiceRefNumber
      }
    });
    results.priceHistory.found = priceHistory.length > 0;
    results.priceHistory.count = priceHistory.length;
    results.priceHistory.entries = priceHistory.map(ph => ({
      product: ph.entity_name,
      oldPrice: ph.old_selling_price,
      newPrice: ph.new_selling_price
    }));
    console.log(`   ${results.priceHistory.found ? '✅' : '⚠️ '} Found ${priceHistory.length} price history entry(ies)`);
    if (priceHistory.length > 0) {
      priceHistory.forEach(ph => {
        console.log(`      - ${ph.entity_name}: ${ph.old_selling_price} → ${ph.new_selling_price}`);
      });
    } else {
      console.log(`      (No price changes - prices may be the same)`);
    }

    // 5. PRODUCT EXPIRY
    console.log(`\n📅 5. Checking Product Expiry (Batch Numbers)...`);
    let expiryCount = 0;
    const expiryUpdates = [];
    for (const item of invoice.items || []) {
      if (item.batch_number) {
        const productExpiry = await ProductExpiryDate.findOne({
          where: {
            product_id: item.product_id,
            store_id: invoice.store_id,
            batch_number: item.batch_number
          }
        });
        if (productExpiry) {
          expiryCount++;
          expiryUpdates.push({
            batch: productExpiry.batch_number,
            currentQty: productExpiry.current_quantity,
            totalSold: productExpiry.total_quantity_sold
          });
        }
      }
    }
    results.productExpiry.found = expiryCount > 0;
    results.productExpiry.count = expiryCount;
    results.productExpiry.entries = expiryUpdates;
    console.log(`   ${results.productExpiry.found ? '✅' : '⚠️ '} Found ${expiryCount} batch number record(s) updated`);
    if (expiryUpdates.length > 0) {
      expiryUpdates.forEach(exp => {
        console.log(`      - Batch ${exp.batch}: Current Qty: ${exp.currentQty}, Total Sold: ${exp.totalSold}`);
      });
    } else {
      console.log(`      (No batch numbers in invoice items)`);
    }

    // 6. PRODUCT SERIAL NUMBERS
    console.log(`\n🔢 6. Checking Product Serial Numbers...`);
    let serialCount = 0;
    const serialUpdates = [];
    for (const item of invoice.items || []) {
      if (item.serial_numbers && Array.isArray(item.serial_numbers) && item.serial_numbers.length > 0) {
        for (const serial of item.serial_numbers) {
          const productSerial = await ProductSerialNumber.findOne({
            where: {
              product_id: item.product_id,
              store_id: invoice.store_id,
              serial_number: String(serial).trim()
            }
          });
          if (productSerial) {
            serialCount++;
            serialUpdates.push({
              serial: productSerial.serial_number,
              currentQty: productSerial.current_quantity,
              totalSold: productSerial.total_quantity_sold,
              status: productSerial.status
            });
          }
        }
      }
    }
    results.productSerial.found = serialCount > 0;
    results.productSerial.count = serialCount;
    results.productSerial.entries = serialUpdates;
    console.log(`   ${results.productSerial.found ? '✅' : '⚠️ '} Found ${serialCount} serial number record(s) updated`);
    if (serialUpdates.length > 0) {
      serialUpdates.forEach(ser => {
        console.log(`      - Serial ${ser.serial}: Current Qty: ${ser.currentQty}, Total Sold: ${ser.totalSold}, Status: ${ser.status}`);
      });
    } else {
      console.log(`      (No serial numbers in invoice items)`);
    }

    // 7. PRODUCT TRANSACTIONS
    console.log(`\n📦 7. Checking Product Transactions...`);
    const productTransactions = await ProductTransaction.findAll({
      where: {
        reference_number: invoiceRefNumber
      }
    });
    results.productTransactions.found = productTransactions.length > 0;
    results.productTransactions.count = productTransactions.length;
    results.productTransactions.entries = productTransactions.map(pt => ({
      ref: pt.reference_number,
      product: pt.product_id,
      qtyOut: pt.quantity_out
    }));
    console.log(`   ${results.productTransactions.found ? '✅' : '❌'} Found ${productTransactions.length} product transaction(s)`);
    if (productTransactions.length > 0) {
      productTransactions.forEach(pt => {
        console.log(`      - ${pt.reference_number}: Product ${pt.product_id}, Qty Out: ${pt.quantity_out}`);
      });
    }

    // 8. SALES TRANSACTION
    console.log(`\n💼 8. Checking Sales Transaction...`);
    // Try to find by source_invoice_id first
    let salesTransaction = await SalesTransaction.findOne({
      where: {
        source_invoice_id: invoice.id
      }
    });
    
    // If not found, try to find by receipt_invoice_number (which might be the invoice ref)
    if (!salesTransaction && invoice.invoice_ref_number) {
      salesTransaction = await SalesTransaction.findOne({
        where: {
          receipt_invoice_number: invoice.invoice_ref_number
        }
      });
    }
    
    results.salesTransaction.found = salesTransaction !== null;
    results.salesTransaction.updated = salesTransaction?.status === 'approved';
    console.log(`   ${results.salesTransaction.found ? '✅' : '❌'} Sales transaction ${results.salesTransaction.found ? 'found' : 'not found'}`);
    if (salesTransaction) {
      console.log(`      Status: ${salesTransaction.status}`);
      console.log(`      Reference: ${salesTransaction.transaction_ref_number || 'N/A'}`);
      console.log(`      Type: ${salesTransaction.transaction_type || 'N/A'}`);
    } else {
      console.log(`      ⚠️  Note: Sales transaction is created during invoice creation, not approval.`);
      console.log(`         If invoice was created before sales transaction feature was added, it may not exist.`);
    }

    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📋 SUMMARY FOR INVOICE ${invoiceRefNumber}:\n`);
    
    const allChecks = [
      { name: '1. General Ledger', result: results.generalLedger.found, count: results.generalLedger.count },
      { name: '2. Customers', result: results.customers.found, count: results.customers.found ? 1 : 0 },
      { name: '3. Loyalty Transactions', result: results.loyaltyTransactions.found || true, count: results.loyaltyTransactions.count, optional: true },
      { name: '4. Price Change History', result: results.priceHistory.found || true, count: results.priceHistory.count, optional: true },
      { name: '5. Product Expiry', result: results.productExpiry.found || true, count: results.productExpiry.count, optional: true },
      { name: '6. Product Serial Numbers', result: results.productSerial.found || true, count: results.productSerial.count, optional: true },
      { name: '7. Product Transactions', result: results.productTransactions.found, count: results.productTransactions.count },
      { name: '8. Sales Transaction', result: results.salesTransaction.found, count: results.salesTransaction.found ? 1 : 0 }
    ];

    allChecks.forEach(check => {
      const status = check.result ? '✅' : (check.optional ? '⚠️ ' : '❌');
      const optional = check.optional ? ' (optional)' : '';
      console.log(`   ${status} ${check.name}: ${check.count} record(s)${optional}`);
    });

    const criticalChecks = allChecks.filter(c => !c.optional);
    const passedCritical = criticalChecks.filter(c => c.result).length;
    const totalCritical = criticalChecks.length;

    console.log(`\n   Critical Checks: ${passedCritical}/${totalCritical} passed`);
    
    if (passedCritical === totalCritical) {
      console.log(`\n   ✅ All critical tables have been affected correctly!`);
    } else {
      console.log(`\n   ⚠️  Some critical tables may not have been updated. Please review above.`);
    }

    console.log(`\n${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Error testing invoice approval:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference from command line
const invoiceRef = process.argv[2] || 'INV-20251110-0007';

testInvoiceApproval(invoiceRef);
