/**
 * View Receipt Tables in Database
 * Shows structure and data from receipts, receipt_items, and receipt_transactions tables
 */

const { Pool } = require('pg');
const config = require('./env');

async function viewReceiptTables() {
  const pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD
  });

  try {
    console.log('📊 VIEWING RECEIPT TABLES IN DATABASE\n');
    console.log('='.repeat(80));
    
    // 1. Check receipts table structure
    console.log('\n1️⃣  RECEIPTS TABLE STRUCTURE');
    console.log('-'.repeat(80));
    const receiptsStructure = await pool.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'receipts'
      ORDER BY ordinal_position;
    `);
    
    console.table(receiptsStructure.rows);
    
    // 2. Count receipts
    console.log('\n2️⃣  RECEIPTS TABLE - RECORD COUNT');
    console.log('-'.repeat(80));
    const receiptsCount = await pool.query('SELECT COUNT(*) as total FROM receipts');
    console.log(`Total Receipts: ${receiptsCount.rows[0].total}`);
    
    // 3. Show sample receipts data
    console.log('\n3️⃣  RECEIPTS TABLE - SAMPLE DATA (First 10 records)');
    console.log('-'.repeat(80));
    const receiptsData = await pool.query(`
      SELECT 
        id,
        receipt_reference_number,
        sales_invoice_id,
        customer_id,
        payment_amount,
        currency_id,
        exchange_rate,
        equivalent_amount,
        payment_type_id,
        transaction_date,
        status,
        created_at,
        "companyId"
      FROM receipts
      ORDER BY created_at DESC
      LIMIT 10;
    `);
    
    if (receiptsData.rows.length > 0) {
      console.table(receiptsData.rows);
    } else {
      console.log('No receipts found in the database.');
    }
    
    // 4. Check receipt_items table structure
    console.log('\n4️⃣  RECEIPT_ITEMS TABLE STRUCTURE');
    console.log('-'.repeat(80));
    const receiptItemsStructure = await pool.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'receipt_items'
      ORDER BY ordinal_position;
    `);
    
    console.table(receiptItemsStructure.rows);
    
    // 5. Count receipt items
    console.log('\n5️⃣  RECEIPT_ITEMS TABLE - RECORD COUNT');
    console.log('-'.repeat(80));
    const receiptItemsCount = await pool.query('SELECT COUNT(*) as total FROM receipt_items');
    console.log(`Total Receipt Items: ${receiptItemsCount.rows[0].total}`);
    
    // 6. Show sample receipt items data
    console.log('\n6️⃣  RECEIPT_ITEMS TABLE - SAMPLE DATA (First 10 records)');
    console.log('-'.repeat(80));
    const receiptItemsData = await pool.query(`
      SELECT 
        id,
        receipt_id,
        sales_invoice_id,
        sales_invoice_item_id,
        payment_amount,
        currency_id,
        exchange_rate,
        equivalent_amount,
        created_at,
        "companyId"
      FROM receipt_items
      ORDER BY created_at DESC
      LIMIT 10;
    `);
    
    if (receiptItemsData.rows.length > 0) {
      console.table(receiptItemsData.rows);
    } else {
      console.log('No receipt items found in the database.');
    }
    
    // 7. Check receipt_transactions table structure
    console.log('\n7️⃣  RECEIPT_TRANSACTIONS TABLE STRUCTURE');
    console.log('-'.repeat(80));
    const receiptTransactionsStructure = await pool.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'receipt_transactions'
      ORDER BY ordinal_position;
    `);
    
    console.table(receiptTransactionsStructure.rows);
    
    // 8. Count receipt transactions
    console.log('\n8️⃣  RECEIPT_TRANSACTIONS TABLE - RECORD COUNT');
    console.log('-'.repeat(80));
    const receiptTransactionsCount = await pool.query('SELECT COUNT(*) as total FROM receipt_transactions');
    console.log(`Total Receipt Transactions: ${receiptTransactionsCount.rows[0].total}`);
    
    // 9. Show sample receipt transactions data
    console.log('\n9️⃣  RECEIPT_TRANSACTIONS TABLE - SAMPLE DATA (First 10 records)');
    console.log('-'.repeat(80));
    const receiptTransactionsData = await pool.query(`
      SELECT 
        id,
        receipt_id,
        receipt_reference_number,
        sales_invoice_id,
        invoice_reference_number,
        customer_id,
        customer_name,
        transaction_type_name,
        payment_amount,
        transaction_date,
        created_at,
        "companyId"
      FROM receipt_transactions
      ORDER BY created_at DESC
      LIMIT 10;
    `);
    
    if (receiptTransactionsData.rows.length > 0) {
      console.table(receiptTransactionsData.rows);
    } else {
      console.log('No receipt transactions found in the database.');
    }
    
    // 10. Show relationships - Receipts with their items
    console.log('\n🔟 RECEIPTS WITH ITEMS COUNT');
    console.log('-'.repeat(80));
    const receiptsWithItems = await pool.query(`
      SELECT 
        r.receipt_reference_number,
        r.payment_amount,
        r.status,
        COUNT(ri.id) as item_count,
        SUM(ri.payment_amount) as items_total
      FROM receipts r
      LEFT JOIN receipt_items ri ON r.id = ri.receipt_id
      GROUP BY r.id, r.receipt_reference_number, r.payment_amount, r.status
      ORDER BY r.created_at DESC
      LIMIT 10;
    `);
    
    if (receiptsWithItems.rows.length > 0) {
      console.table(receiptsWithItems.rows);
    } else {
      console.log('No receipts with items found.');
    }
    
    // 11. Show status distribution
    console.log('\n1️⃣1️⃣  RECEIPTS STATUS DISTRIBUTION');
    console.log('-'.repeat(80));
    const statusDistribution = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(payment_amount) as total_amount
      FROM receipts
      GROUP BY status
      ORDER BY count DESC;
    `);
    
    console.table(statusDistribution.rows);
    
    // 12. Show company distribution
    console.log('\n1️⃣2️⃣  RECEIPTS BY COMPANY');
    console.log('-'.repeat(80));
    const companyDistribution = await pool.query(`
      SELECT 
        "companyId",
        COUNT(*) as receipt_count,
        SUM(payment_amount) as total_amount
      FROM receipts
      GROUP BY "companyId"
      ORDER BY receipt_count DESC;
    `);
    
    console.table(companyDistribution.rows);
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Database query completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error querying database:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the script
viewReceiptTables().catch(console.error);

