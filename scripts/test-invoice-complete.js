/**
 * Comprehensive test script to verify all related tables for a sales invoice
 * Tests all 8 required tables and shows detailed data
 * 
 * Usage: node scripts/test-invoice-complete.js INV-20251110-0012
 */

const sequelize = require('../config/database');
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
  ProductStore,
  Product,
  Store,
  FinancialYear
} = require('../server/models');
const { Op } = require('sequelize');

async function testInvoice(invoiceRefNumber) {
  try {
    console.log('🧪 Comprehensive Invoice Test');
    console.log('='.repeat(80));
    console.log(`Invoice: ${invoiceRefNumber}\n`);

    // Find invoice
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        { model: SalesInvoiceItem, as: 'items' },
        { model: Store, as: 'store' },
        { model: Customer, as: 'customer' }
      ]
    });

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceRefNumber} not found`);
      process.exit(1);
    }

    console.log('✅ Invoice Found:');
    console.log(`   ID: ${invoice.id}`);
    console.log(`   Date: ${invoice.invoice_date}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Customer: ${invoice.customer?.full_name || 'N/A'} (${invoice.customer_id})`);
    console.log(`   Store: ${invoice.store?.name || 'N/A'} (${invoice.store_id})`);
    console.log(`   Total Amount: ${invoice.total_amount}`);
    console.log(`   Equivalent Amount: ${invoice.equivalent_amount}`);
    console.log(`   Exchange Rate: ${invoice.exchange_rate}`);
    console.log(`   Items: ${invoice.items?.length || 0}\n`);

    const results = {
      generalLedger: { status: 'PENDING', data: [], pass: false },
      customers: { status: 'PENDING', data: null, pass: false },
      loyaltyTransactions: { status: 'PENDING', data: [], pass: false },
      priceHistory: { status: 'PENDING', data: [], pass: false },
      productExpiry: { status: 'PENDING', data: [], pass: false },
      productSerialNumbers: { status: 'PENDING', data: [], pass: false },
      productTransactions: { status: 'PENDING', data: [], pass: false },
      productStore: { status: 'PENDING', data: [], pass: false },
      salesTransaction: { status: 'PENDING', data: null, pass: false }
    };

    // ============================================
    // 1. GENERAL LEDGER
    // ============================================
    console.log('1️⃣  GENERAL LEDGER ENTRIES');
    console.log('-'.repeat(80));
    try {
      const glEntries = await GeneralLedger.findAll({
        where: {
          reference_number: {
            [Op.like]: `${invoiceRefNumber}%`
          },
          companyId: invoice.companyId
        },
        order: [['reference_number', 'ASC']]
      });

      if (glEntries.length > 0) {
        results.generalLedger.data = glEntries;
        results.generalLedger.status = 'FOUND';
        results.generalLedger.pass = true;

        console.log(`✅ Found ${glEntries.length} GL entries:\n`);
        glEntries.forEach((entry, index) => {
          console.log(`   Entry ${index + 1}: ${entry.reference_number}`);
          console.log(`      All Columns:`);
          console.log(`         id: ${entry.id}`);
          console.log(`         reference_number: ${entry.reference_number}`);
          console.log(`         account_id: ${entry.account_id}`);
          console.log(`         account_code: ${entry.account_code}`);
          console.log(`         account_name: ${entry.account_name}`);
          console.log(`         account_nature: ${entry.account_nature}`);
          console.log(`         amount: ${entry.amount}`);
          console.log(`         user_debit_amount: ${entry.user_debit_amount || 0}`);
          console.log(`         user_credit_amount: ${entry.user_credit_amount || 0}`);
          console.log(`         equivalent_debit_amount: ${entry.equivalent_debit_amount || 0}`);
          console.log(`         equivalent_credit_amount: ${entry.equivalent_credit_amount || 0}`);
          console.log(`         exchange_rate: ${entry.exchange_rate}`);
          console.log(`         description: ${entry.description || 'N/A'}`);
          console.log(`         transaction_date: ${entry.transaction_date || 'N/A'}`);
          console.log(`         financial_year_id: ${entry.financial_year_id || 'N/A'}`);
          console.log(`         companyId: ${entry.companyId || 'N/A'}`);
          console.log(`         created_at: ${entry.created_at || 'N/A'}`);
          console.log(`         updated_at: ${entry.updated_at || 'N/A'}`);
          console.log('');
        });
      } else {
        results.generalLedger.status = 'NOT FOUND';
        results.generalLedger.pass = false;
        console.log('❌ No GL entries found\n');
      }
    } catch (error) {
      results.generalLedger.status = 'ERROR';
      results.generalLedger.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 2. CUSTOMERS
    // ============================================
    console.log('2️⃣  CUSTOMER UPDATES');
    console.log('-'.repeat(80));
    try {
      const customer = await Customer.findByPk(invoice.customer_id);
      if (customer) {
        results.customers.data = customer;
        results.customers.status = 'FOUND';
        results.customers.pass = true;

        console.log('✅ Customer Data:');
        console.log(`   All Columns:`);
        console.log(`      id: ${customer.id}`);
        console.log(`      customer_id: ${customer.customer_id}`);
        console.log(`      full_name: ${customer.full_name}`);
        console.log(`      debt_balance: ${customer.debt_balance || 0}`);
        console.log(`      account_balance: ${customer.account_balance || 0}`);
        console.log(`      loyalty_points: ${customer.loyalty_points || 0}`);
        console.log(`      loyalty_card_number: ${customer.loyalty_card_number || 'N/A'}`);
        console.log(`      loyalty_card_config_id: ${customer.loyalty_card_config_id || 'N/A'}`);
        console.log(`      companyId: ${customer.companyId || 'N/A'}`);
        console.log(`      created_at: ${customer.created_at || 'N/A'}`);
        console.log(`      updated_at: ${customer.updated_at || 'N/A'}`);
        console.log('');
      } else {
        results.customers.status = 'NOT FOUND';
        results.customers.pass = false;
        console.log('❌ Customer not found\n');
      }
    } catch (error) {
      results.customers.status = 'ERROR';
      results.customers.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 3. LOYALTY TRANSACTIONS
    // ============================================
    console.log('3️⃣  LOYALTY TRANSACTIONS');
    console.log('-'.repeat(80));
    try {
      const loyaltyTransactions = await LoyaltyTransaction.findAll({
        where: {
          sales_invoice_id: invoice.id,
          companyId: invoice.companyId
        },
        order: [['transaction_date', 'DESC']]
      });

      if (loyaltyTransactions.length > 0) {
        results.loyaltyTransactions.data = loyaltyTransactions;
        results.loyaltyTransactions.status = 'FOUND';
        results.loyaltyTransactions.pass = true;

        console.log(`✅ Found ${loyaltyTransactions.length} loyalty transaction(s):\n`);
        loyaltyTransactions.forEach((tx, index) => {
          console.log(`   Transaction ${index + 1}:`);
          console.log(`      All Columns:`);
          console.log(`         id: ${tx.id}`);
          console.log(`         sales_invoice_id: ${tx.sales_invoice_id || 'N/A'}`);
          console.log(`         loyalty_card_id: ${tx.loyalty_card_id || 'N/A'}`);
          console.log(`         transaction_type: ${tx.transaction_type}`);
          console.log(`         points_amount: ${tx.points_amount}`);
          console.log(`         points_balance_before: ${tx.points_balance_before || 0}`);
          console.log(`         points_balance_after: ${tx.points_balance_after || 0}`);
          console.log(`         tier_before: ${tx.tier_before || 'N/A'}`);
          console.log(`         tier_after: ${tx.tier_after || 'N/A'}`);
          console.log(`         transaction_date: ${tx.transaction_date || 'N/A'}`);
          console.log(`         expiry_date: ${tx.expiry_date || 'N/A'}`);
          console.log(`         is_expired: ${tx.is_expired || false}`);
          console.log(`         description: ${tx.description || 'N/A'}`);
          console.log(`         transaction_reference: ${tx.transaction_reference || 'N/A'}`);
          console.log(`         companyId: ${tx.companyId || 'N/A'}`);
          console.log(`         created_at: ${tx.created_at || 'N/A'}`);
          console.log(`         updated_at: ${tx.updated_at || 'N/A'}`);
          console.log('');
        });
      } else {
        // Check if customer has loyalty card (might be expected)
        if (invoice.customer?.loyalty_card_number) {
          results.loyaltyTransactions.status = 'NOT FOUND (but customer has loyalty card)';
          results.loyaltyTransactions.pass = false;
          console.log('⚠️  No loyalty transaction found (customer has loyalty card, transaction may be missing)\n');
        } else {
          results.loyaltyTransactions.status = 'NOT APPLICABLE';
          results.loyaltyTransactions.pass = true;
          console.log('ℹ️  No loyalty transaction (customer does not have loyalty card)\n');
        }
      }
    } catch (error) {
      results.loyaltyTransactions.status = 'ERROR';
      results.loyaltyTransactions.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 4. PRICE HISTORY
    // ============================================
    console.log('4️⃣  PRICE CHANGE HISTORY');
    console.log('-'.repeat(80));
    try {
      const priceHistories = await PriceHistory.findAll({
        where: {
          reference_number: invoiceRefNumber,
          companyId: invoice.companyId
        },
        order: [['change_date', 'DESC']]
      });

      if (priceHistories.length > 0) {
        results.priceHistory.data = priceHistories;
        results.priceHistory.status = 'FOUND';
        results.priceHistory.pass = true;

        console.log(`✅ Found ${priceHistories.length} price history record(s):\n`);
        priceHistories.forEach((ph, index) => {
          console.log(`   Record ${index + 1}:`);
          console.log(`      All Columns:`);
          console.log(`         id: ${ph.id}`);
          console.log(`         entity_type: ${ph.entity_type || 'N/A'}`);
          console.log(`         entity_id: ${ph.entity_id || 'N/A'}`);
          console.log(`         entity_code: ${ph.entity_code || 'N/A'}`);
          console.log(`         entity_name: ${ph.entity_name || 'N/A'}`);
          console.log(`         module_name: ${ph.module_name || 'N/A'}`);
          console.log(`         old_selling_price: ${ph.old_selling_price || 0}`);
          console.log(`         new_selling_price: ${ph.new_selling_price || 0}`);
          console.log(`         reference_number: ${ph.reference_number || 'N/A'}`);
          console.log(`         transaction_date: ${ph.transaction_date || 'N/A'}`);
          console.log(`         change_date: ${ph.change_date || 'N/A'}`);
          console.log(`         quantity: ${ph.quantity || 'N/A'}`);
          console.log(`         currency_id: ${ph.currency_id || 'N/A'}`);
          console.log(`         exchange_rate: ${ph.exchange_rate || 'N/A'}`);
          console.log(`         companyId: ${ph.companyId || 'N/A'}`);
          console.log(`         created_at: ${ph.created_at || 'N/A'}`);
          console.log(`         updated_at: ${ph.updated_at || 'N/A'}`);
          console.log('');
        });
      } else {
        // Check if any items had price changes
        let hasPriceChange = false;
        if (invoice.items) {
          for (const item of invoice.items) {
            const product = await Product.findByPk(item.product_id);
            if (product && parseFloat(item.unit_price) !== parseFloat(product.selling_price || 0)) {
              hasPriceChange = true;
              break;
            }
          }
        }

        if (hasPriceChange) {
          results.priceHistory.status = 'NOT FOUND (but price changed)';
          results.priceHistory.pass = false;
          console.log('⚠️  No price history found (but invoice items have different prices than product)\n');
        } else {
          results.priceHistory.status = 'NOT APPLICABLE';
          results.priceHistory.pass = true;
          console.log('ℹ️  No price history (no price changes detected)\n');
        }
      }
    } catch (error) {
      results.priceHistory.status = 'ERROR';
      results.priceHistory.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 5. PRODUCT EXPIRY
    // ============================================
    console.log('5️⃣  PRODUCT EXPIRY (Batch Tracking)');
    console.log('-'.repeat(80));
    try {
      let expiryRecords = [];
      let hasBatchItems = false;

      if (invoice.items) {
        for (const item of invoice.items) {
          if (item.batch_number) {
            hasBatchItems = true;
            const expiry = await ProductExpiryDate.findOne({
              where: {
                product_id: item.product_id,
                batch_number: item.batch_number,
                companyId: invoice.companyId
              }
            });

            if (expiry) {
              expiryRecords.push({
                item: item,
                expiry: expiry
              });
            }
          }
        }
      }

      if (expiryRecords.length > 0) {
        results.productExpiry.data = expiryRecords;
        results.productExpiry.status = 'FOUND';
        results.productExpiry.pass = true;

        console.log(`✅ Found ${expiryRecords.length} expiry record(s):\n`);
        expiryRecords.forEach((record, index) => {
          const item = record.item;
          const expiry = record.expiry;
          console.log(`   Record ${index + 1}:`);
          console.log(`      All Columns:`);
          console.log(`         id: ${expiry.id}`);
          console.log(`         product_id: ${expiry.product_id}`);
          console.log(`         batch_number: ${expiry.batch_number}`);
          console.log(`         expiry_date: ${expiry.expiry_date || 'N/A'}`);
          console.log(`         store_id: ${expiry.store_id || 'N/A'}`);
          console.log(`         current_quantity: ${expiry.current_quantity || 0}`);
          console.log(`         original_quantity: ${expiry.original_quantity || 0}`);
          console.log(`         total_quantity_sold: ${expiry.total_quantity_sold || 0}`);
          console.log(`         status: ${expiry.status || 'N/A'}`);
          console.log(`         unit_cost: ${expiry.unit_cost || 'N/A'}`);
          console.log(`         companyId: ${expiry.companyId || 'N/A'}`);
          console.log(`         created_at: ${expiry.created_at || 'N/A'}`);
          console.log(`         updated_at: ${expiry.updated_at || 'N/A'}`);
          console.log(`      Invoice Item Quantity Sold: ${item.quantity}`);
          console.log('');
        });
      } else if (hasBatchItems) {
        results.productExpiry.status = 'NOT FOUND (but batch numbers exist)';
        results.productExpiry.pass = false;
        console.log('⚠️  No expiry records found (but invoice items have batch numbers)\n');
      } else {
        results.productExpiry.status = 'NOT APPLICABLE';
        results.productExpiry.pass = true;
        console.log('ℹ️  No expiry records (no batch numbers in invoice items)\n');
      }
    } catch (error) {
      results.productExpiry.status = 'ERROR';
      results.productExpiry.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 6. PRODUCT SERIAL NUMBERS
    // ============================================
    console.log('6️⃣  PRODUCT SERIAL NUMBERS');
    console.log('-'.repeat(80));
    try {
      let serialRecords = [];
      let hasSerialItems = false;

      if (invoice.items) {
        for (const item of invoice.items) {
          if (item.serial_numbers && Array.isArray(item.serial_numbers) && item.serial_numbers.length > 0) {
            hasSerialItems = true;
            for (const serialNumber of item.serial_numbers) {
              const serial = await ProductSerialNumber.findOne({
                where: {
                  product_id: item.product_id,
                  serial_number: serialNumber,
                  companyId: invoice.companyId
                }
              });

              if (serial) {
                serialRecords.push({
                  item: item,
                  serial: serial,
                  serialNumber: serialNumber
                });
              }
            }
          }
        }
      }

      if (serialRecords.length > 0) {
        results.productSerialNumbers.data = serialRecords;
        results.productSerialNumbers.status = 'FOUND';
        results.productSerialNumbers.pass = true;

        console.log(`✅ Found ${serialRecords.length} serial number record(s):\n`);
        serialRecords.forEach((record, index) => {
          console.log(`   Record ${index + 1}:`);
          console.log(`      All Columns:`);
          console.log(`         id: ${record.serial.id}`);
          console.log(`         uuid: ${record.serial.uuid || 'N/A'}`);
          console.log(`         product_id: ${record.serial.product_id}`);
          console.log(`         serial_number: ${record.serialNumber}`);
          console.log(`         store_id: ${record.serial.store_id || 'N/A'}`);
          console.log(`         current_quantity: ${record.serial.current_quantity || 0}`);
          console.log(`         total_quantity_received: ${record.serial.total_quantity_received || 0}`);
          console.log(`         total_quantity_sold: ${record.serial.total_quantity_sold || 0}`);
          console.log(`         total_quantity_adjusted: ${record.serial.total_quantity_adjusted || 0}`);
          console.log(`         status: ${record.serial.status || 'N/A'}`);
          console.log(`         unit_cost: ${record.serial.unit_cost || 'N/A'}`);
          console.log(`         companyId: ${record.serial.companyId || 'N/A'}`);
          console.log(`         last_updated: ${record.serial.last_updated || 'N/A'}`);
          console.log(`         created_at: ${record.serial.created_at || 'N/A'}`);
          console.log(`         updated_at: ${record.serial.updated_at || 'N/A'}`);
          console.log('');
        });
      } else if (hasSerialItems) {
        results.productSerialNumbers.status = 'NOT FOUND (but serial numbers exist)';
        results.productSerialNumbers.pass = false;
        console.log('⚠️  No serial number records found (but invoice items have serial numbers)\n');
      } else {
        results.productSerialNumbers.status = 'NOT APPLICABLE';
        results.productSerialNumbers.pass = true;
        console.log('ℹ️  No serial number records (no serial numbers in invoice items)\n');
      }
    } catch (error) {
      results.productSerialNumbers.status = 'ERROR';
      results.productSerialNumbers.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 7. PRODUCT TRANSACTIONS
    // ============================================
    console.log('7️⃣  PRODUCT TRANSACTIONS');
    console.log('-'.repeat(80));
    try {
      const productTransactions = await ProductTransaction.findAll({
        where: {
          reference_number: invoiceRefNumber,
          companyId: invoice.companyId
        },
        order: [['transaction_date', 'DESC']]
      });

      if (productTransactions.length > 0) {
        results.productTransactions.data = productTransactions;
        results.productTransactions.status = 'FOUND';
        results.productTransactions.pass = true;

        console.log(`✅ Found ${productTransactions.length} product transaction(s):\n`);
        productTransactions.forEach((pt, index) => {
          console.log(`   Transaction ${index + 1}:`);
          console.log(`      All Columns:`);
          console.log(`         id: ${pt.id}`);
          console.log(`         reference_number: ${pt.reference_number || 'N/A'}`);
          console.log(`         reference_type: ${pt.reference_type || 'N/A'}`);
          console.log(`         transaction_type_id: ${pt.transaction_type_id || 'N/A'}`);
          console.log(`         transaction_type_name: ${pt.transaction_type_name || 'N/A'}`);
          console.log(`         product_id: ${pt.product_id}`);
          console.log(`         store_id: ${pt.store_id || 'N/A'}`);
          console.log(`         quantity_in: ${pt.quantity_in || 0}`);
          console.log(`         quantity_out: ${pt.quantity_out || 0}`);
          console.log(`         transaction_date: ${pt.transaction_date || 'N/A'}`);
          console.log(`         financial_year_id: ${pt.financial_year_id || 'N/A'}`);
          console.log(`         currency_id: ${pt.currency_id || 'N/A'}`);
          console.log(`         exchange_rate: ${pt.exchange_rate || 'N/A'}`);
          console.log(`         user_unit_cost: ${pt.user_unit_cost || 'N/A'}`);
          console.log(`         product_average_cost: ${pt.product_average_cost || 'N/A'}`);
          console.log(`         serial_number: ${pt.serial_number || 'N/A'}`);
          console.log(`         expiry_date: ${pt.expiry_date || 'N/A'}`);
          console.log(`         customer_id: ${pt.customer_id || 'N/A'}`);
          console.log(`         companyId: ${pt.companyId || 'N/A'}`);
          console.log(`         created_at: ${pt.created_at || 'N/A'}`);
          console.log(`         updated_at: ${pt.updated_at || 'N/A'}`);
          console.log('');
        });
      } else {
        results.productTransactions.status = 'NOT FOUND';
        results.productTransactions.pass = false;
        console.log('❌ No product transactions found\n');
      }
    } catch (error) {
      results.productTransactions.status = 'ERROR';
      results.productTransactions.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 8. PRODUCT STORE QUANTITY
    // ============================================
    console.log('8️⃣  PRODUCT STORE QUANTITY');
    console.log('-'.repeat(80));
    try {
      let productStoreRecords = [];

      if (invoice.items) {
        for (const item of invoice.items) {
          const productStore = await ProductStore.findOne({
            where: {
              product_id: item.product_id,
              store_id: invoice.store_id,
              companyId: invoice.companyId
            }
          });

          if (productStore) {
            productStoreRecords.push({
              item: item,
              productStore: productStore
            });
          }
        }
      }

      if (productStoreRecords.length > 0) {
        results.productStore.data = productStoreRecords;
        results.productStore.status = 'FOUND';
        results.productStore.pass = true;

        console.log(`✅ Found ${productStoreRecords.length} ProductStore record(s):\n`);
        productStoreRecords.forEach((record, index) => {
          const item = record.item;
          const ps = record.productStore;
          console.log(`   Record ${index + 1}:`);
          console.log(`      All Columns:`);
          console.log(`         id: ${ps.id}`);
          console.log(`         product_id: ${ps.product_id}`);
          console.log(`         store_id: ${ps.store_id}`);
          console.log(`         quantity: ${ps.quantity || 0}`);
          console.log(`         average_cost: ${ps.average_cost || 'N/A'}`);
          console.log(`         is_active: ${ps.is_active || false}`);
          console.log(`         assigned_by: ${ps.assigned_by || 'N/A'}`);
          console.log(`         assigned_at: ${ps.assigned_at || 'N/A'}`);
          console.log(`         last_updated: ${ps.last_updated || 'N/A'}`);
          console.log(`         companyId: ${ps.companyId || 'N/A'}`);
          console.log(`         created_at: ${ps.created_at || 'N/A'}`);
          console.log(`         updated_at: ${ps.updated_at || 'N/A'}`);
          console.log(`      Invoice Item Quantity Sold: ${item.quantity || 0}`);
          console.log('');
        });
      } else {
        results.productStore.status = 'NOT FOUND';
        results.productStore.pass = false;
        console.log('❌ No ProductStore records found\n');
      }
    } catch (error) {
      results.productStore.status = 'ERROR';
      results.productStore.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 9. SALES TRANSACTION
    // ============================================
    console.log('9️⃣  SALES TRANSACTION');
    console.log('-'.repeat(80));
    try {
      const salesTransaction = await SalesTransaction.findOne({
        where: {
          source_invoice_id: invoice.id,
          companyId: invoice.companyId
        }
      });

      if (salesTransaction) {
        results.salesTransaction.data = salesTransaction;
        results.salesTransaction.status = 'FOUND';
        results.salesTransaction.pass = true;

        console.log('✅ Sales Transaction Found:');
        console.log(`   All Columns:`);
        console.log(`      id: ${salesTransaction.id}`);
        console.log(`      transaction_ref_number: ${salesTransaction.transaction_ref_number || 'N/A'}`);
        console.log(`      receipt_invoice_number: ${salesTransaction.receipt_invoice_number || 'N/A'}`);
        console.log(`      source_invoice_id: ${salesTransaction.source_invoice_id || 'N/A'}`);
        console.log(`      status: ${salesTransaction.status || 'N/A'}`);
        console.log(`      transaction_date: ${salesTransaction.transaction_date || 'N/A'}`);
        console.log(`      total_amount: ${salesTransaction.total_amount || 0}`);
        console.log(`      customer_id: ${salesTransaction.customer_id || 'N/A'}`);
        console.log(`      store_id: ${salesTransaction.store_id || 'N/A'}`);
        console.log(`      approved_by: ${salesTransaction.approved_by || 'N/A'}`);
        console.log(`      approved_at: ${salesTransaction.approved_at || 'N/A'}`);
        console.log(`      companyId: ${salesTransaction.companyId || 'N/A'}`);
        console.log(`      created_at: ${salesTransaction.created_at || 'N/A'}`);
        console.log(`      updated_at: ${salesTransaction.updated_at || 'N/A'}`);
        console.log('');
      } else {
        results.salesTransaction.status = 'NOT FOUND';
        results.salesTransaction.pass = false;
        console.log('❌ Sales transaction not found\n');
      }
    } catch (error) {
      results.salesTransaction.status = 'ERROR';
      results.salesTransaction.pass = false;
      console.log(`❌ Error: ${error.message}\n`);
    }

    // ============================================
    // SUMMARY
    // ============================================
    console.log('='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Invoice: ${invoiceRefNumber}`);
    console.log(`Status: ${invoice.status}`);
    console.log(`\nResults:\n`);

    const testResults = [
      { name: '1. General Ledger', result: results.generalLedger },
      { name: '2. Customers', result: results.customers },
      { name: '3. Loyalty Transactions', result: results.loyaltyTransactions },
      { name: '4. Price History', result: results.priceHistory },
      { name: '5. Product Expiry', result: results.productExpiry },
      { name: '6. Product Serial Numbers', result: results.productSerialNumbers },
      { name: '7. Product Transactions', result: results.productTransactions },
      { name: '8. Product Store', result: results.productStore },
      { name: '9. Sales Transaction', result: results.salesTransaction }
    ];

    let passCount = 0;
    let failCount = 0;

    testResults.forEach(test => {
      const status = test.result.pass ? '✅ PASS' : '❌ FAIL';
      const statusText = test.result.status;
      console.log(`   ${status} - ${test.name}: ${statusText}`);
      if (test.result.pass) {
        passCount++;
      } else {
        failCount++;
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log(`✅ Passed: ${passCount}/9`);
    console.log(`❌ Failed: ${failCount}/9`);
    console.log('='.repeat(80));

    if (failCount === 0) {
      console.log('\n🎉 All tests passed! Invoice approval affected all required tables correctly.');
    } else {
      console.log(`\n⚠️  ${failCount} test(s) failed. Please review the details above.`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference number from command line
const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.error('❌ Please provide an invoice reference number');
  console.error('Usage: node scripts/test-invoice-complete.js INV-20251110-0012');
  process.exit(1);
}

testInvoice(invoiceRefNumber);

