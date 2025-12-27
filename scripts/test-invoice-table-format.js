/**
 * Comprehensive test script to verify all related tables for a sales invoice
 * Outputs results in table format
 * 
 * Usage: node scripts/test-invoice-table-format.js INV-20251110-0019
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

// Helper function to format table output
function formatTable(title, headers, rows) {
  console.log('\n' + '='.repeat(100));
  console.log(title);
  console.log('='.repeat(100));
  
  if (rows.length === 0) {
    console.log('No records found');
    return;
  }

  // Calculate column widths
  const colWidths = headers.map((header, idx) => {
    const headerLen = header.length;
    const maxDataLen = Math.max(...rows.map(row => String(row[idx] || '').length));
    return Math.max(headerLen, maxDataLen, 10);
  });

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ');
  console.log(headerRow);
  console.log('-'.repeat(headerRow.length));

  // Print rows
  rows.forEach(row => {
    const dataRow = row.map((cell, i) => String(cell || '').padEnd(colWidths[i])).join(' | ');
    console.log(dataRow);
  });
}

async function testInvoice(invoiceRefNumber) {
  try {
    console.log('🧪 Comprehensive Invoice Test - Table Format');
    console.log('='.repeat(100));
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
    console.log(`   Customer: ${invoice.customer?.full_name || 'N/A'}`);
    console.log(`   Store: ${invoice.store?.name || 'N/A'}`);
    console.log(`   Total Amount: ${invoice.total_amount}`);
    console.log(`   Equivalent Amount: ${invoice.equivalent_amount}`);
    console.log(`   Exchange Rate: ${invoice.exchange_rate}`);
    console.log(`   Items: ${invoice.items?.length || 0}\n`);

    const results = [];

    // ============================================
    // 1. GENERAL LEDGER
    // ============================================
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
        const rows = glEntries.map((entry, idx) => [
          idx + 1,
          entry.id,
          entry.financial_year_code || 'N/A',
          entry.financial_year_id || 'N/A',
          entry.system_date ? new Date(entry.system_date).toLocaleString() : 'N/A',
          entry.transaction_date ? new Date(entry.transaction_date).toLocaleString() : 'N/A',
          entry.reference_number,
          entry.transaction_type || 'N/A',
          entry.transaction_type_name || 'N/A',
          entry.transaction_type_id || 'N/A',
          entry.created_by_code || 'N/A',
          entry.created_by_name || 'N/A',
          entry.description || 'N/A',
          entry.account_type_code || 'N/A',
          entry.account_type_name || 'N/A',
          entry.account_type_id || 'N/A',
          entry.account_id || 'N/A',
          entry.account_name,
          entry.account_code,
          entry.account_nature,
          parseFloat(entry.exchange_rate || 1).toFixed(6),
          parseFloat(entry.amount || 0).toLocaleString(),
          entry.system_currency_id || 'N/A',
          parseFloat(entry.user_debit_amount || 0).toLocaleString(),
          parseFloat(entry.user_credit_amount || 0).toLocaleString(),
          parseFloat(entry.equivalent_debit_amount || 0).toLocaleString(),
          parseFloat(entry.equivalent_credit_amount || 0).toLocaleString(),
          entry.username || 'N/A',
          entry.general_ledger_id || 'N/A',
          entry.companyId || 'N/A',
          entry.created_at ? new Date(entry.created_at).toLocaleString() : 'N/A',
          entry.updated_at ? new Date(entry.updated_at).toLocaleString() : 'N/A'
        ]);

        formatTable('1️⃣  GENERAL LEDGER ENTRIES', [
          '#', 'ID', 'FY Code', 'FY ID', 'System Date', 'Transaction Date', 'Reference', 'Txn Type',
          'Txn Type Name', 'Txn Type ID', 'Created By Code', 'Created By Name', 'Description',
          'Account Type Code', 'Account Type Name', 'Account Type ID', 'Account ID', 'Account Name',
          'Account Code', 'Account Nature', 'Exchange Rate', 'Amount', 'System Currency ID',
          'User Debit', 'User Credit', 'Equiv Debit', 'Equiv Credit', 'Username', 'GL ID',
          'Company ID', 'Created At', 'Updated At'
        ], rows);

        results.push({ table: 'General Ledger', status: 'PASS', records: glEntries.length });
      } else {
        console.log('\n1️⃣  GENERAL LEDGER ENTRIES');
        console.log('No records found');
        results.push({ table: 'General Ledger', status: 'FAIL', records: 0 });
      }
    } catch (error) {
      console.log(`\n1️⃣  GENERAL LEDGER ENTRIES - ERROR: ${error.message}`);
      results.push({ table: 'General Ledger', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 2. CUSTOMERS
    // ============================================
    try {
      const customer = await Customer.findByPk(invoice.customer_id);
      if (customer) {
        const rows = [[
          customer.id,
          customer.customer_id,
          customer.customer_group_id || 'N/A',
          customer.full_name,
          customer.address || 'N/A',
          customer.default_receivable_account_id || 'N/A',
          customer.fax || 'N/A',
          customer.loyalty_card_number || 'N/A',
          customer.loyalty_card_config_id || 'N/A',
          customer.birthday || 'N/A',
          customer.phone_number || 'N/A',
          customer.email || 'N/A',
          customer.website || 'N/A',
          customer.is_active ? 'Yes' : 'No',
          parseFloat(customer.account_balance || 0).toLocaleString(),
          parseFloat(customer.debt_balance || 0).toLocaleString(),
          parseFloat(customer.deposit_balance || 0).toLocaleString(),
          parseFloat(customer.loyalty_points || 0).toLocaleString(),
          customer.created_by || 'N/A',
          customer.updated_by || 'N/A',
          customer.companyId || 'N/A',
          customer.created_at ? new Date(customer.created_at).toLocaleString() : 'N/A',
          customer.updated_at ? new Date(customer.updated_at).toLocaleString() : 'N/A'
        ]];

        formatTable('2️⃣  CUSTOMER UPDATES', [
          'ID', 'Customer ID', 'Customer Group ID', 'Full Name', 'Address', 'Default Receivable Account ID',
          'Fax', 'Loyalty Card Number', 'Loyalty Card Config ID', 'Birthday', 'Phone Number', 'Email',
          'Website', 'Is Active', 'Account Balance', 'Debt Balance', 'Deposit Balance', 'Loyalty Points',
          'Created By', 'Updated By', 'Company ID', 'Created At', 'Updated At'
        ], rows);

        results.push({ table: 'Customers', status: 'PASS', records: 1 });
      } else {
        console.log('\n2️⃣  CUSTOMER UPDATES');
        console.log('Customer not found');
        results.push({ table: 'Customers', status: 'FAIL', records: 0 });
      }
    } catch (error) {
      console.log(`\n2️⃣  CUSTOMER UPDATES - ERROR: ${error.message}`);
      results.push({ table: 'Customers', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 3. LOYALTY TRANSACTIONS
    // ============================================
    try {
      const loyaltyTransactions = await LoyaltyTransaction.findAll({
        where: {
          sales_invoice_id: invoice.id,
          companyId: invoice.companyId
        },
        order: [['transaction_date', 'DESC']]
      });

      if (loyaltyTransactions.length > 0) {
        const rows = loyaltyTransactions.map((tx, idx) => [
          idx + 1,
          tx.id,
          tx.loyalty_card_id || 'N/A',
          tx.transaction_type,
          parseFloat(tx.points_amount || 0).toLocaleString(),
          tx.transaction_reference || 'N/A',
          tx.description || 'N/A',
          tx.order_id || 'N/A',
          tx.sales_invoice_id || 'N/A',
          tx.sales_order_id || 'N/A',
          tx.sales_transaction_id || 'N/A',
          tx.customer_id || 'N/A',
          tx.store_id || 'N/A',
          tx.loyalty_config_id || 'N/A',
          tx.financial_year_id || 'N/A',
          tx.transaction_ref_number || 'N/A',
          parseFloat(tx.amount || 0).toLocaleString(),
          parseFloat(tx.redemption_amount || 0).toLocaleString(),
          tx.currency_id || 'N/A',
          parseFloat(tx.exchange_rate || 1).toFixed(6),
          tx.status || 'N/A',
          tx.notes || 'N/A',
          parseFloat(tx.points_balance_before || 0).toLocaleString(),
          parseFloat(tx.points_balance_after || 0).toLocaleString(),
          tx.tier_before || 'N/A',
          tx.tier_after || 'N/A',
          tx.transaction_date ? new Date(tx.transaction_date).toLocaleString() : 'N/A',
          tx.expiry_date ? new Date(tx.expiry_date).toLocaleString() : 'N/A',
          tx.is_expired ? 'Yes' : 'No',
          tx.created_by || 'N/A',
          tx.updated_by || 'N/A',
          tx.companyId || 'N/A',
          tx.created_at ? new Date(tx.created_at).toLocaleString() : 'N/A',
          tx.updated_at ? new Date(tx.updated_at).toLocaleString() : 'N/A'
        ]);

        formatTable('3️⃣  LOYALTY TRANSACTIONS', [
          '#', 'ID', 'Loyalty Card ID', 'Transaction Type', 'Points Amount', 'Transaction Reference',
          'Description', 'Order ID', 'Sales Invoice ID', 'Sales Order ID', 'Sales Transaction ID',
          'Customer ID', 'Store ID', 'Loyalty Config ID', 'Financial Year ID', 'Transaction Ref Number',
          'Amount', 'Redemption Amount', 'Currency ID', 'Exchange Rate', 'Status', 'Notes',
          'Points Balance Before', 'Points Balance After', 'Tier Before', 'Tier After', 'Transaction Date',
          'Expiry Date', 'Is Expired', 'Created By', 'Updated By', 'Company ID', 'Created At', 'Updated At'
        ], rows);

        results.push({ table: 'Loyalty Transactions', status: 'PASS', records: loyaltyTransactions.length });
      } else {
        if (invoice.customer?.loyalty_card_number) {
          console.log('\n3️⃣  LOYALTY TRANSACTIONS');
          console.log('No records found (but customer has loyalty card)');
          results.push({ table: 'Loyalty Transactions', status: 'FAIL', records: 0 });
        } else {
          console.log('\n3️⃣  LOYALTY TRANSACTIONS');
          console.log('Not applicable (customer has no loyalty card)');
          results.push({ table: 'Loyalty Transactions', status: 'PASS', records: 0 });
        }
      }
    } catch (error) {
      console.log(`\n3️⃣  LOYALTY TRANSACTIONS - ERROR: ${error.message}`);
      results.push({ table: 'Loyalty Transactions', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 4. PRICE HISTORY
    // ============================================
    try {
      const priceHistories = await PriceHistory.findAll({
        where: {
          reference_number: invoiceRefNumber,
          companyId: invoice.companyId
        },
        order: [['change_date', 'DESC']]
      });

      if (priceHistories.length > 0) {
        const rows = priceHistories.map((ph, idx) => [
          idx + 1,
          ph.id,
          ph.entity_type || 'N/A',
          ph.entity_id || 'N/A',
          ph.entity_code || 'N/A',
          ph.entity_name || 'N/A',
          ph.module_name || 'N/A',
          ph.transaction_type_id || 'N/A',
          ph.transaction_type_name || 'N/A',
          parseFloat(ph.old_selling_price || 0).toLocaleString(),
          parseFloat(ph.new_selling_price || 0).toLocaleString(),
          ph.costing_method_id || 'N/A',
          ph.price_change_reason_id || 'N/A',
          parseFloat(ph.quantity || 0).toLocaleString(),
          ph.unit || 'N/A',
          ph.currency_id || 'N/A',
          parseFloat(ph.exchange_rate || 1).toFixed(6),
          ph.reference_number || 'N/A',
          ph.notes || 'N/A',
          ph.change_date ? new Date(ph.change_date).toLocaleString() : 'N/A',
          ph.transaction_date ? new Date(ph.transaction_date).toLocaleString() : 'N/A',
          ph.created_by || 'N/A',
          ph.conversion_notes || 'N/A',
          ph.system_currency_id || 'N/A',
          parseFloat(ph.product_average_cost_old || 0).toLocaleString(),
          parseFloat(ph.product_average_cost_new || 0).toLocaleString(),
          parseFloat(ph.user_unit_cost_old || 0).toLocaleString(),
          parseFloat(ph.user_unit_cost_new || 0).toLocaleString(),
          parseFloat(ph.equivalent_amount_old || 0).toLocaleString(),
          parseFloat(ph.equivalent_amount_new || 0).toLocaleString(),
          ph.companyId || 'N/A',
          ph.created_at ? new Date(ph.created_at).toLocaleString() : 'N/A'
        ]);

        formatTable('4️⃣  PRICE CHANGE HISTORY', [
          '#', 'ID', 'Entity Type', 'Entity ID', 'Entity Code', 'Entity Name', 'Module Name',
          'Transaction Type ID', 'Transaction Type Name', 'Old Selling Price', 'New Selling Price',
          'Costing Method ID', 'Price Change Reason ID', 'Quantity', 'Unit', 'Currency ID',
          'Exchange Rate', 'Reference Number', 'Notes', 'Change Date', 'Transaction Date',
          'Created By', 'Conversion Notes', 'System Currency ID', 'Product Avg Cost Old',
          'Product Avg Cost New', 'User Unit Cost Old', 'User Unit Cost New', 'Equiv Amount Old',
          'Equiv Amount New', 'Company ID', 'Created At'
        ], rows);

        results.push({ table: 'Price History', status: 'PASS', records: priceHistories.length });
      } else {
        console.log('\n4️⃣  PRICE CHANGE HISTORY');
        console.log('No records found (no price changes detected)');
        results.push({ table: 'Price History', status: 'PASS', records: 0 });
      }
    } catch (error) {
      console.log(`\n4️⃣  PRICE CHANGE HISTORY - ERROR: ${error.message}`);
      results.push({ table: 'Price History', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 5. PRODUCT EXPIRY
    // ============================================
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
              expiryRecords.push({ item, expiry });
            }
          }
        }
      }

      if (expiryRecords.length > 0) {
        const rows = expiryRecords.map((record, idx) => [
          idx + 1,
          record.expiry.id,
          record.expiry.uuid || 'N/A',
          record.item.product_id,
          record.item.batch_number,
          record.expiry.expiry_date ? new Date(record.expiry.expiry_date).toLocaleDateString() : 'N/A',
          record.expiry.store_id || 'N/A',
          parseFloat(record.expiry.current_quantity || 0).toLocaleString(),
          parseFloat(record.expiry.total_quantity_received || 0).toLocaleString(),
          parseFloat(record.expiry.total_quantity_sold || 0).toLocaleString(),
          parseFloat(record.expiry.total_quantity_adjusted || 0).toLocaleString(),
          parseFloat(record.expiry.unit_cost || 0).toLocaleString(),
          parseFloat(record.expiry.unit_cost_equivalent || 0).toLocaleString(),
          parseFloat(record.expiry.selling_price || 0).toLocaleString(),
          record.expiry.currency_id || 'N/A',
          parseFloat(record.expiry.exchange_rate || 1).toFixed(6),
          record.expiry.supplier_id || 'N/A',
          record.expiry.purchase_date ? new Date(record.expiry.purchase_date).toLocaleDateString() : 'N/A',
          record.expiry.purchase_reference || 'N/A',
          record.expiry.manufacturing_date ? new Date(record.expiry.manufacturing_date).toLocaleDateString() : 'N/A',
          record.expiry.status || 'N/A',
          record.expiry.days_until_expiry || 'N/A',
          record.expiry.is_expired ? 'Yes' : 'No',
          record.expiry.notes || 'N/A',
          record.expiry.created_by_id || 'N/A',
          record.expiry.updated_by_id || 'N/A',
          record.expiry.is_active ? 'Yes' : 'No',
          record.expiry.companyId || 'N/A',
          record.expiry.created_at ? new Date(record.expiry.created_at).toLocaleString() : 'N/A',
          record.expiry.updated_at ? new Date(record.expiry.updated_at).toLocaleString() : 'N/A',
          parseFloat(record.item.quantity || 0).toLocaleString()
        ]);

        formatTable('5️⃣  PRODUCT EXPIRY (Batch Tracking)', [
          '#', 'ID', 'UUID', 'Product ID', 'Batch Number', 'Expiry Date', 'Store ID', 'Current Qty',
          'Total Qty Received', 'Total Qty Sold', 'Total Qty Adjusted', 'Unit Cost', 'Unit Cost Equivalent',
          'Selling Price', 'Currency ID', 'Exchange Rate', 'Supplier ID', 'Purchase Date',
          'Purchase Reference', 'Manufacturing Date', 'Status', 'Days Until Expiry', 'Is Expired',
          'Notes', 'Created By ID', 'Updated By ID', 'Is Active', 'Company ID', 'Created At',
          'Updated At', 'Invoice Qty'
        ], rows);

        results.push({ table: 'Product Expiry', status: 'PASS', records: expiryRecords.length });
      } else if (hasBatchItems) {
        console.log('\n5️⃣  PRODUCT EXPIRY (Batch Tracking)');
        console.log('No records found (but invoice items have batch numbers)');
        results.push({ table: 'Product Expiry', status: 'FAIL', records: 0 });
      } else {
        console.log('\n5️⃣  PRODUCT EXPIRY (Batch Tracking)');
        console.log('Not applicable (no batch numbers in invoice items)');
        results.push({ table: 'Product Expiry', status: 'PASS', records: 0 });
      }
    } catch (error) {
      console.log(`\n5️⃣  PRODUCT EXPIRY - ERROR: ${error.message}`);
      results.push({ table: 'Product Expiry', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 6. PRODUCT SERIAL NUMBERS
    // ============================================
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
                serialRecords.push({ item, serial, serialNumber });
              }
            }
          }
        }
      }

      if (serialRecords.length > 0) {
        const rows = serialRecords.map((record, idx) => [
          idx + 1,
          record.serial.id,
          record.serial.uuid || 'N/A',
          record.item.product_id,
          record.serialNumber,
          record.serial.store_id || 'N/A',
          parseFloat(record.serial.current_quantity || 0).toLocaleString(),
          parseFloat(record.serial.total_quantity_received || 0).toLocaleString(),
          parseFloat(record.serial.total_quantity_sold || 0).toLocaleString(),
          parseFloat(record.serial.total_quantity_adjusted || 0).toLocaleString(),
          parseFloat(record.serial.unit_cost || 0).toLocaleString(),
          parseFloat(record.serial.unit_cost_equivalent || 0).toLocaleString(),
          parseFloat(record.serial.selling_price || 0).toLocaleString(),
          record.serial.currency_id || 'N/A',
          parseFloat(record.serial.exchange_rate || 1).toFixed(6),
          record.serial.supplier_id || 'N/A',
          record.serial.purchase_date ? new Date(record.serial.purchase_date).toLocaleDateString() : 'N/A',
          record.serial.purchase_reference || 'N/A',
          record.serial.warranty_expiry_date ? new Date(record.serial.warranty_expiry_date).toLocaleDateString() : 'N/A',
          record.serial.status || 'N/A',
          record.serial.notes || 'N/A',
          record.serial.created_by_id || 'N/A',
          record.serial.updated_by_id || 'N/A',
          record.serial.is_active ? 'Yes' : 'No',
          record.serial.companyId || 'N/A',
          record.serial.created_at ? new Date(record.serial.created_at).toLocaleString() : 'N/A',
          record.serial.updated_at ? new Date(record.serial.updated_at).toLocaleString() : 'N/A'
        ]);

        formatTable('6️⃣  PRODUCT SERIAL NUMBERS', [
          '#', 'ID', 'UUID', 'Product ID', 'Serial Number', 'Store ID', 'Current Qty', 'Total Qty Received',
          'Total Qty Sold', 'Total Qty Adjusted', 'Unit Cost', 'Unit Cost Equivalent', 'Selling Price',
          'Currency ID', 'Exchange Rate', 'Supplier ID', 'Purchase Date', 'Purchase Reference',
          'Warranty Expiry Date', 'Status', 'Notes', 'Created By ID', 'Updated By ID', 'Is Active',
          'Company ID', 'Created At', 'Updated At'
        ], rows);

        results.push({ table: 'Product Serial Numbers', status: 'PASS', records: serialRecords.length });
      } else if (hasSerialItems) {
        console.log('\n6️⃣  PRODUCT SERIAL NUMBERS');
        console.log('No records found (but invoice items have serial numbers)');
        results.push({ table: 'Product Serial Numbers', status: 'FAIL', records: 0 });
      } else {
        console.log('\n6️⃣  PRODUCT SERIAL NUMBERS');
        console.log('Not applicable (no serial numbers in invoice items)');
        results.push({ table: 'Product Serial Numbers', status: 'PASS', records: 0 });
      }
    } catch (error) {
      console.log(`\n6️⃣  PRODUCT SERIAL NUMBERS - ERROR: ${error.message}`);
      results.push({ table: 'Product Serial Numbers', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 7. PRODUCT TRANSACTIONS
    // ============================================
    try {
      const productTransactions = await ProductTransaction.findAll({
        where: {
          reference_number: invoiceRefNumber,
          companyId: invoice.companyId
        },
        order: [['transaction_date', 'DESC']]
      });

      if (productTransactions.length > 0) {
        const rows = productTransactions.map((pt, idx) => [
          idx + 1,
          pt.id,
          pt.uuid || 'N/A',
          pt.system_date ? new Date(pt.system_date).toLocaleString() : 'N/A',
          pt.transaction_date ? new Date(pt.transaction_date).toLocaleString() : 'N/A',
          pt.financial_year_id || 'N/A',
          pt.financial_year_name || 'N/A',
          pt.transaction_type_id || 'N/A',
          pt.transaction_type_name || 'N/A',
          pt.store_id || 'N/A',
          pt.product_id,
          pt.manufacturer_id || 'N/A',
          pt.model_id || 'N/A',
          pt.brand_name_id || 'N/A',
          pt.packaging_id || 'N/A',
          parseFloat(pt.packaging_issue_quantity || 0).toLocaleString(),
          pt.supplier_id || 'N/A',
          pt.customer_id || 'N/A',
          pt.customer_name || 'N/A',
          pt.created_by_id || 'N/A',
          pt.updated_by_id || 'N/A',
          parseFloat(pt.exchange_rate || 1).toFixed(6),
          parseFloat(pt.equivalent_amount || 0).toLocaleString(),
          parseFloat(pt.product_average_cost || 0).toLocaleString(),
          parseFloat(pt.user_unit_cost || 0).toLocaleString(),
          pt.system_currency_id || 'N/A',
          pt.currency_id || 'N/A',
          pt.expiry_date ? new Date(pt.expiry_date).toLocaleDateString() : 'N/A',
          pt.serial_number || 'N/A',
          parseFloat(pt.quantity_in || 0).toLocaleString(),
          parseFloat(pt.quantity_out || 0).toLocaleString(),
          pt.reference_number || 'N/A',
          pt.reference_type || 'N/A',
          pt.notes || 'N/A',
          pt.is_active ? 'Yes' : 'No',
          pt.conversion_notes || 'N/A',
          pt.companyId || 'N/A',
          pt.created_at ? new Date(pt.created_at).toLocaleString() : 'N/A',
          pt.updated_at ? new Date(pt.updated_at).toLocaleString() : 'N/A'
        ]);

        formatTable('7️⃣  PRODUCT TRANSACTIONS', [
          '#', 'ID', 'UUID', 'System Date', 'Transaction Date', 'Financial Year ID', 'Financial Year Name',
          'Transaction Type ID', 'Transaction Type Name', 'Store ID', 'Product ID', 'Manufacturer ID',
          'Model ID', 'Brand Name ID', 'Packaging ID', 'Packaging Issue Qty', 'Supplier ID',
          'Customer ID', 'Customer Name', 'Created By ID', 'Updated By ID', 'Exchange Rate',
          'Equivalent Amount', 'Product Avg Cost', 'User Unit Cost', 'System Currency ID', 'Currency ID',
          'Expiry Date', 'Serial Number', 'Quantity In', 'Quantity Out', 'Reference Number',
          'Reference Type', 'Notes', 'Is Active', 'Conversion Notes', 'Company ID', 'Created At', 'Updated At'
        ], rows);

        results.push({ table: 'Product Transactions', status: 'PASS', records: productTransactions.length });
      } else {
        console.log('\n7️⃣  PRODUCT TRANSACTIONS');
        console.log('No records found');
        results.push({ table: 'Product Transactions', status: 'FAIL', records: 0 });
      }
    } catch (error) {
      console.log(`\n7️⃣  PRODUCT TRANSACTIONS - ERROR: ${error.message}`);
      results.push({ table: 'Product Transactions', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 8. PRODUCT STORE
    // ============================================
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
            productStoreRecords.push({ item, productStore });
          }
        }
      }

      if (productStoreRecords.length > 0) {
        const rows = productStoreRecords.map((record, idx) => [
          idx + 1,
          record.productStore.id,
          record.item.product_id,
          record.productStore.store_id,
          record.productStore.is_active ? 'Yes' : 'No',
          parseFloat(record.productStore.quantity || 0).toLocaleString(),
          parseFloat(record.productStore.min_quantity || 0).toLocaleString(),
          record.productStore.max_quantity ? parseFloat(record.productStore.max_quantity).toLocaleString() : 'N/A',
          parseFloat(record.productStore.reorder_point || 0).toLocaleString(),
          parseFloat(record.productStore.average_cost || 0).toLocaleString(),
          record.productStore.last_updated ? new Date(record.productStore.last_updated).toLocaleString() : 'N/A',
          record.productStore.assigned_by || 'N/A',
          record.productStore.assigned_at ? new Date(record.productStore.assigned_at).toLocaleString() : 'N/A',
          record.productStore.companyId || 'N/A',
          record.productStore.created_at ? new Date(record.productStore.created_at).toLocaleString() : 'N/A',
          record.productStore.updated_at ? new Date(record.productStore.updated_at).toLocaleString() : 'N/A',
          parseFloat(record.item.quantity || 0).toLocaleString()
        ]);

        formatTable('8️⃣  PRODUCT STORE QUANTITY', [
          '#', 'ID', 'Product ID', 'Store ID', 'Is Active', 'Current Quantity', 'Min Quantity',
          'Max Quantity', 'Reorder Point', 'Average Cost', 'Last Updated', 'Assigned By',
          'Assigned At', 'Company ID', 'Created At', 'Updated At', 'Invoice Qty Sold'
        ], rows);

        results.push({ table: 'Product Store', status: 'PASS', records: productStoreRecords.length });
      } else {
        console.log('\n8️⃣  PRODUCT STORE QUANTITY');
        console.log('No records found');
        results.push({ table: 'Product Store', status: 'FAIL', records: 0 });
      }
    } catch (error) {
      console.log(`\n8️⃣  PRODUCT STORE - ERROR: ${error.message}`);
      results.push({ table: 'Product Store', status: 'FAIL', records: 0 });
    }

    // ============================================
    // 9. SALES TRANSACTION
    // ============================================
    try {
      const salesTransaction = await SalesTransaction.findOne({
        where: {
          source_invoice_id: invoice.id,
          companyId: invoice.companyId
        }
      });

      if (salesTransaction) {
        const rows = [[
          salesTransaction.id,
          salesTransaction.transaction_ref_number || 'N/A',
          salesTransaction.transaction_type || 'N/A',
          salesTransaction.companyId || 'N/A',
          salesTransaction.source_invoice_id || 'N/A',
          salesTransaction.source_order_id || 'N/A',
          salesTransaction.source_transaction_id || 'N/A',
          salesTransaction.parent_transaction_id || 'N/A',
          salesTransaction.transaction_date ? new Date(salesTransaction.transaction_date).toLocaleDateString() : 'N/A',
          salesTransaction.due_date ? new Date(salesTransaction.due_date).toLocaleDateString() : 'N/A',
          salesTransaction.valid_until ? new Date(salesTransaction.valid_until).toLocaleDateString() : 'N/A',
          salesTransaction.delivery_date ? new Date(salesTransaction.delivery_date).toLocaleDateString() : 'N/A',
          salesTransaction.store_id || 'N/A',
          salesTransaction.customer_id || 'N/A',
          salesTransaction.sales_agent_id || 'N/A',
          salesTransaction.financial_year_id || 'N/A',
          salesTransaction.product_type || 'N/A',
          salesTransaction.product_category_id || 'N/A',
          salesTransaction.brand_name_id || 'N/A',
          salesTransaction.manufacturer_id || 'N/A',
          salesTransaction.model_id || 'N/A',
          salesTransaction.color_id || 'N/A',
          salesTransaction.packaging_id || 'N/A',
          salesTransaction.price_category_id || 'N/A',
          salesTransaction.store_location_id || 'N/A',
          parseFloat(salesTransaction.subtotal || 0).toLocaleString(),
          parseFloat(salesTransaction.discount_amount || 0).toLocaleString(),
          parseFloat(salesTransaction.tax_amount || 0).toLocaleString(),
          parseFloat(salesTransaction.total_wht_amount || 0).toLocaleString(),
          parseFloat(salesTransaction.amount_after_discount || 0).toLocaleString(),
          parseFloat(salesTransaction.amount_after_wht || 0).toLocaleString(),
          parseFloat(salesTransaction.total_amount || 0).toLocaleString(),
          parseFloat(salesTransaction.paid_amount || 0).toLocaleString(),
          parseFloat(salesTransaction.balance_amount || 0).toLocaleString(),
          parseFloat(salesTransaction.equivalent_amount || 0).toLocaleString(),
          salesTransaction.currency_id || 'N/A',
          parseFloat(salesTransaction.exchange_rate || 1).toFixed(6),
          salesTransaction.exchange_rate_id || 'N/A',
          salesTransaction.system_default_currency_id || 'N/A',
          salesTransaction.status || 'N/A',
          salesTransaction.is_active ? 'Yes' : 'No',
          salesTransaction.is_cancelled ? 'Yes' : 'No',
          salesTransaction.notes || 'N/A',
          salesTransaction.terms_conditions || 'N/A',
          salesTransaction.shipping_address || 'N/A',
          salesTransaction.rejection_reason || 'N/A',
          salesTransaction.receipt_invoice_number || 'N/A',
          salesTransaction.receipt_number || 'N/A',
          salesTransaction.created_by || 'N/A',
          salesTransaction.updated_by || 'N/A',
          salesTransaction.sent_by || 'N/A',
          salesTransaction.sent_at ? new Date(salesTransaction.sent_at).toLocaleString() : 'N/A',
          salesTransaction.approved_by || 'N/A',
          salesTransaction.approved_at ? new Date(salesTransaction.approved_at).toLocaleString() : 'N/A',
          salesTransaction.cancelled_by || 'N/A',
          salesTransaction.cancelled_at ? new Date(salesTransaction.cancelled_at).toLocaleString() : 'N/A',
          salesTransaction.rejected_by || 'N/A',
          salesTransaction.rejected_at ? new Date(salesTransaction.rejected_at).toLocaleString() : 'N/A',
          salesTransaction.created_at ? new Date(salesTransaction.created_at).toLocaleString() : 'N/A',
          salesTransaction.updated_at ? new Date(salesTransaction.updated_at).toLocaleString() : 'N/A'
        ]];

        formatTable('9️⃣  SALES TRANSACTION', [
          'ID', 'Transaction Ref Number', 'Transaction Type', 'Company ID', 'Source Invoice ID',
          'Source Order ID', 'Source Transaction ID', 'Parent Transaction ID', 'Transaction Date',
          'Due Date', 'Valid Until', 'Delivery Date', 'Store ID', 'Customer ID', 'Sales Agent ID',
          'Financial Year ID', 'Product Type', 'Product Category ID', 'Brand Name ID',
          'Manufacturer ID', 'Model ID', 'Color ID', 'Packaging ID', 'Price Category ID',
          'Store Location ID', 'Subtotal', 'Discount Amount', 'Tax Amount', 'Total WHT Amount',
          'Amount After Discount', 'Amount After WHT', 'Total Amount', 'Paid Amount',
          'Balance Amount', 'Equivalent Amount', 'Currency ID', 'Exchange Rate', 'Exchange Rate ID',
          'System Default Currency ID', 'Status', 'Is Active', 'Is Cancelled', 'Notes',
          'Terms Conditions', 'Shipping Address', 'Rejection Reason', 'Receipt Invoice Number',
          'Receipt Number', 'Created By', 'Updated By', 'Sent By', 'Sent At', 'Approved By',
          'Approved At', 'Cancelled By', 'Cancelled At', 'Rejected By', 'Rejected At',
          'Created At', 'Updated At'
        ], rows);

        results.push({ table: 'Sales Transaction', status: 'PASS', records: 1 });
      } else {
        console.log('\n9️⃣  SALES TRANSACTION');
        console.log('No records found');
        results.push({ table: 'Sales Transaction', status: 'FAIL', records: 0 });
      }
    } catch (error) {
      console.log(`\n9️⃣  SALES TRANSACTION - ERROR: ${error.message}`);
      results.push({ table: 'Sales Transaction', status: 'FAIL', records: 0 });
    }

    // ============================================
    // SUMMARY TABLE
    // ============================================
    console.log('\n' + '='.repeat(100));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(100));

    const summaryRows = results.map(r => [
      r.table,
      r.records || 0,
      r.status === 'PASS' ? '✅ PASS' : '❌ FAIL'
    ]);

    formatTable('Test Results Summary', [
      'Table Name', 'Records Found', 'Status'
    ], summaryRows);

    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;

    console.log('\n' + '='.repeat(100));
    console.log(`✅ Passed: ${passCount}/${results.length}`);
    console.log(`❌ Failed: ${failCount}/${results.length}`);
    console.log('='.repeat(100));

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
  console.error('Usage: node scripts/test-invoice-table-format.js INV-20251110-0019');
  process.exit(1);
}

testInvoice(invoiceRefNumber);

