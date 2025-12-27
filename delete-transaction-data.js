const sequelize = require('./config/database');
const { Op } = require('sequelize');

// Initialize models
require('./server/models');

async function deleteTransactionData() {
  // Ensure database connection is established
  await sequelize.authenticate();
  console.log('✅ Database connection established\n');
  
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🗑️  Starting deletion of transaction data...\n');

    // Get company ID from environment or use a default (you may want to make this configurable)
    const companyId = process.env.COMPANY_ID || null;
    const whereClause = companyId ? { companyId } : {};

    // 1. Delete General Ledger entries (these reference transactions)
    console.log('1. Deleting General Ledger entries...');
    const GeneralLedger = sequelize.models.GeneralLedger || require('./server/models/generalLedger');
    const generalLedgerCount = await GeneralLedger.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${generalLedgerCount} General Ledger entries`);

    // 2. Delete Product Transactions
    console.log('2. Deleting Product Transactions...');
    const ProductTransaction = sequelize.models.ProductTransaction || require('./server/models/productTransaction');
    const productTransactionCount = await ProductTransaction.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${productTransactionCount} Product Transactions`);

    // 3. Delete Stock Adjustment Items and Stock Adjustments
    console.log('3. Deleting Stock Adjustment Items...');
    const StockAdjustmentItem = sequelize.models.StockAdjustmentItem || require('./server/models/stockAdjustmentItem');
    const stockAdjustmentItemCount = await StockAdjustmentItem.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${stockAdjustmentItemCount} Stock Adjustment Items`);

    console.log('4. Deleting Stock Adjustments...');
    const StockAdjustment = sequelize.models.StockAdjustment || require('./server/models/stockAdjustment');
    const stockAdjustmentCount = await StockAdjustment.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${stockAdjustmentCount} Stock Adjustments`);

    // 4. Delete Physical Inventory Items and Physical Inventories
    console.log('5. Deleting Physical Inventory Items...');
    const PhysicalInventoryItem = sequelize.models.PhysicalInventoryItem || require('./server/models/physicalInventoryItem');
    const physicalInventoryItemCount = await PhysicalInventoryItem.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${physicalInventoryItemCount} Physical Inventory Items`);

    console.log('6. Deleting Physical Inventory Reversals...');
    const PhysicalInventoryReversal = sequelize.models.PhysicalInventoryReversal || require('./server/models/physicalInventoryReversal');
    const physicalInventoryReversalCount = await PhysicalInventoryReversal.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${physicalInventoryReversalCount} Physical Inventory Reversals`);

    console.log('7. Deleting Physical Inventories...');
    const PhysicalInventory = sequelize.models.PhysicalInventory || require('./server/models/physicalInventory');
    const physicalInventoryCount = await PhysicalInventory.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${physicalInventoryCount} Physical Inventories`);

    // 5. Delete Sales Transactions (these reference sales invoices)
    console.log('8. Deleting Sales Transactions...');
    const SalesTransaction = sequelize.models.SalesTransaction || require('./server/models/salesTransaction');
    const salesTransactionCount = await SalesTransaction.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${salesTransactionCount} Sales Transactions`);

    // 6. Delete Receipt Transactions, Receipt Items, and Receipts
    console.log('9. Deleting Receipt Transactions...');
    const ReceiptTransaction = sequelize.models.ReceiptTransaction || require('./server/models/receiptTransaction');
    const receiptTransactionCount = await ReceiptTransaction.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${receiptTransactionCount} Receipt Transactions`);

    console.log('10. Deleting Receipt Items...');
    const ReceiptItem = sequelize.models.ReceiptItem || require('./server/models/receiptItem');
    const receiptItemCount = await ReceiptItem.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${receiptItemCount} Receipt Items`);

    console.log('11. Deleting Receipts...');
    const Receipt = sequelize.models.Receipt || require('./server/models/receipt');
    const receiptCount = await Receipt.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${receiptCount} Receipts`);

    // 7. Delete Sales Invoice Items and Sales Invoices
    console.log('12. Deleting Sales Invoice Items...');
    const SalesInvoiceItem = sequelize.models.SalesInvoiceItem || require('./server/models/salesInvoiceItem');
    const salesInvoiceItemCount = await SalesInvoiceItem.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${salesInvoiceItemCount} Sales Invoice Items`);

    console.log('13. Deleting Sales Invoices...');
    const SalesInvoice = sequelize.models.SalesInvoice || require('./server/models/salesInvoice');
    const salesInvoiceCount = await SalesInvoice.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${salesInvoiceCount} Sales Invoices`);

    // 8. Delete Sales Order Items and Sales Orders
    console.log('14. Deleting Sales Order Items...');
    const SalesOrderItem = sequelize.models.SalesOrderItem || require('./server/models/salesOrderItem');
    const salesOrderItemCount = await SalesOrderItem.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${salesOrderItemCount} Sales Order Items`);

    console.log('15. Deleting Sales Orders...');
    const SalesOrder = sequelize.models.SalesOrder || require('./server/models/salesOrder');
    const salesOrderCount = await SalesOrder.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${salesOrderCount} Sales Orders`);

    // 9. Delete Proforma Invoice Items and Proforma Invoices
    console.log('16. Deleting Proforma Invoice Items...');
    const ProformaInvoiceItem = sequelize.models.ProformaInvoiceItem || require('./server/models/proformaInvoiceItem');
    const proformaInvoiceItemCount = await ProformaInvoiceItem.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${proformaInvoiceItemCount} Proforma Invoice Items`);

    console.log('17. Deleting Proforma Invoices...');
    const ProformaInvoice = sequelize.models.ProformaInvoice || require('./server/models/proformaInvoice');
    const proformaInvoiceCount = await ProformaInvoice.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${proformaInvoiceCount} Proforma Invoices`);

    // 10. Delete Customer Deposits
    console.log('18. Deleting Customer Deposits...');
    const CustomerDeposit = sequelize.models.CustomerDeposit || require('./server/models/customerDeposit');
    const customerDepositCount = await CustomerDeposit.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${customerDepositCount} Customer Deposits`);

    // 11. Delete Loyalty Transactions
    console.log('19. Deleting Loyalty Transactions...');
    const LoyaltyTransaction = sequelize.models.LoyaltyTransaction || require('./server/models/loyaltyTransaction');
    const loyaltyTransactionCount = await LoyaltyTransaction.destroy({
      where: whereClause,
      transaction
    });
    console.log(`   ✅ Deleted ${loyaltyTransactionCount} Loyalty Transactions`);

    // 12. Reset ProductStore quantities to 0 (but keep the records)
    console.log('20. Resetting ProductStore quantities to 0...');
    const ProductStore = sequelize.models.ProductStore || require('./server/models/productStore');
    const productStoreUpdateCount = await ProductStore.update(
      { quantity: 0, last_updated: new Date() },
      { 
        where: whereClause,
        transaction 
      }
    );
    console.log(`   ✅ Reset ${productStoreUpdateCount[0]} ProductStore quantities`);

    // Commit transaction
    await transaction.commit();
    
    console.log('\n✅ All transaction data deleted successfully!');
    console.log('\nSummary:');
    console.log(`   - General Ledger: ${generalLedgerCount}`);
    console.log(`   - Product Transactions: ${productTransactionCount}`);
    console.log(`   - Stock Adjustments: ${stockAdjustmentCount} (${stockAdjustmentItemCount} items)`);
    console.log(`   - Physical Inventories: ${physicalInventoryCount} (${physicalInventoryItemCount} items, ${physicalInventoryReversalCount} reversals)`);
    console.log(`   - Sales Transactions: ${salesTransactionCount}`);
    console.log(`   - Receipts: ${receiptCount} (${receiptItemCount} items, ${receiptTransactionCount} transactions)`);
    console.log(`   - Sales Invoices: ${salesInvoiceCount} (${salesInvoiceItemCount} items)`);
    console.log(`   - Sales Orders: ${salesOrderCount} (${salesOrderItemCount} items)`);
    console.log(`   - Proforma Invoices: ${proformaInvoiceCount} (${proformaInvoiceItemCount} items)`);
    console.log(`   - Customer Deposits: ${customerDepositCount}`);
    console.log(`   - Loyalty Transactions: ${loyaltyTransactionCount}`);
    console.log(`   - ProductStore quantities reset: ${productStoreUpdateCount[0]}`);
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error deleting transaction data:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run the deletion
deleteTransactionData()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

