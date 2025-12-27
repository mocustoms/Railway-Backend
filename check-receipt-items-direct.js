/**
 * Direct Database Query: Check ReceiptItems for invoice INV-20251111-0028
 * This bypasses Sequelize to check the raw database
 */

const { Pool } = require('pg');
const config = require('./env');

async function checkReceiptItemsDirect() {
  const pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD
  });

  try {
    console.log('🔍 Direct Database Query: Checking ReceiptItems...\n');

    // First, get the invoice ID
    const invoiceResult = await pool.query(
      `SELECT id, invoice_ref_number, total_amount, paid_amount, balance_amount 
       FROM sales_invoices 
       WHERE invoice_ref_number = $1`,
      ['INV-20251111-0028']
    );

    if (invoiceResult.rows.length === 0) {
      console.log('❌ Invoice not found');
      return;
    }

    const invoice = invoiceResult.rows[0];
    console.log('✅ Invoice Found:');
    console.log(`   ID: ${invoice.id}`);
    console.log(`   Total: ${invoice.total_amount}`);
    console.log(`   Paid: ${invoice.paid_amount}`);
    console.log(`   Balance: ${invoice.balance_amount}\n`);

    // Get invoice items
    const invoiceItemsResult = await pool.query(
      `SELECT id, product_id, quantity, line_total 
       FROM sales_invoice_items 
       WHERE sales_invoice_id = $1 
       ORDER BY created_at ASC`,
      [invoice.id]
    );

    console.log(`📦 Invoice Items: ${invoiceItemsResult.rows.length}`);
    invoiceItemsResult.rows.forEach((item, index) => {
      console.log(`   Item ${index + 1}: ID=${item.id}, Line Total=${item.line_total}`);
    });
    console.log('');

    // Get receipts for this invoice
    const receiptsResult = await pool.query(
      `SELECT id, receipt_reference_number, payment_amount, deposit_amount, loyalty_points_amount 
       FROM receipts 
       WHERE sales_invoice_id = $1 
       ORDER BY created_at ASC`,
      [invoice.id]
    );

    console.log(`💳 Receipts: ${receiptsResult.rows.length}`);
    receiptsResult.rows.forEach((receipt, index) => {
      console.log(`   Receipt ${index + 1}: ID=${receipt.id}, Ref=${receipt.receipt_reference_number}, Amount=${receipt.payment_amount}`);
    });
    console.log('');

    // Check ReceiptItems by receipt ID
    if (receiptsResult.rows.length > 0) {
      for (const receipt of receiptsResult.rows) {
        const receiptItemsResult = await pool.query(
          `SELECT ri.*, sii.line_total as invoice_item_total
           FROM receipt_items ri
           LEFT JOIN sales_invoice_items sii ON ri.sales_invoice_item_id = sii.id
           WHERE ri.receipt_id = $1
           ORDER BY ri.created_at ASC`,
          [receipt.id]
        );

        console.log(`📋 ReceiptItems for Receipt ${receipt.receipt_reference_number}: ${receiptItemsResult.rows.length}`);
        if (receiptItemsResult.rows.length > 0) {
          receiptItemsResult.rows.forEach((item, index) => {
            console.log(`   ReceiptItem ${index + 1}:`);
            console.log(`      ID: ${item.id}`);
            console.log(`      Invoice Item ID: ${item.sales_invoice_item_id}`);
            console.log(`      Payment Amount: ${item.payment_amount}`);
            console.log(`      Item Total: ${item.item_total}`);
            console.log(`      Item Remaining: ${item.item_remaining}`);
            console.log(`      Invoice Item Line Total: ${item.invoice_item_total}`);
          });
        } else {
          console.log(`   ❌ NO ReceiptItems found for this receipt!`);
        }
        console.log('');
      }
    }

    // Also check ReceiptItems by invoice ID (in case they're orphaned)
    const allReceiptItemsResult = await pool.query(
      `SELECT ri.*, r.receipt_reference_number
       FROM receipt_items ri
       LEFT JOIN receipts r ON ri.receipt_id = r.id
       WHERE ri.sales_invoice_id = $1
       ORDER BY ri.created_at ASC`,
      [invoice.id]
    );

    console.log(`🔍 Total ReceiptItems for Invoice (by invoice ID): ${allReceiptItemsResult.rows.length}`);
    if (allReceiptItemsResult.rows.length > 0) {
      allReceiptItemsResult.rows.forEach((item, index) => {
        console.log(`   ReceiptItem ${index + 1}:`);
        console.log(`      Receipt: ${item.receipt_reference_number || 'N/A'}`);
        console.log(`      Invoice Item ID: ${item.sales_invoice_item_id}`);
        console.log(`      Payment Amount: ${item.payment_amount}`);
      });
    } else {
      console.log('   ❌ NO ReceiptItems found for this invoice at all!');
      console.log('\n⚠️  ISSUE DETECTED:');
      console.log('   The payment was recorded but ReceiptItems were NOT created.');
      console.log('   This means the payment was NOT made at item level.');
      console.log('   According to the code, ReceiptItems are only created when');
      console.log('   itemPayments object is provided in the payment request.');
      console.log('\n   Possible causes:');
      console.log('   1. itemPayments was not sent in the payment request');
      console.log('   2. itemPayments was an empty object');
      console.log('   3. Payment was made through a different flow');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkReceiptItemsDirect();

