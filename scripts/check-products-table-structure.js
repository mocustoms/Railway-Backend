const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function checkProductsTable() {
  try {
    console.log('Checking products table structure...\n');
    
    const columns = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'products'
      ORDER BY ordinal_position;
    `, { type: QueryTypes.SELECT });

    console.log('=== PRODUCTS TABLE COLUMNS ===\n');
    columns.forEach((col, index) => {
      console.log(`${index + 1}. ${col.column_name.padEnd(40)} | ${col.data_type.padEnd(20)} | Nullable: ${col.is_nullable}`);
    });

    // Now check invoice items directly
    console.log('\n\n=== CHECKING INVOICE ITEMS DIRECTLY ===\n');
    const invoiceItems = await sequelize.query(`
      SELECT 
        sii.id,
        si.invoice_ref_number,
        st.transaction_ref_number,
        sii.product_id,
        sii.quantity,
        sii.line_total
      FROM sales_transactions st
      INNER JOIN sales_invoices si ON si.id = st.source_invoice_id
      INNER JOIN sales_invoice_items sii ON sii.sales_invoice_id = si.id
      ORDER BY st.created_at DESC
      LIMIT 10;
    `, { type: QueryTypes.SELECT });

    console.log(`Found ${invoiceItems.length} invoice items:\n`);
    invoiceItems.forEach((item, index) => {
      console.log(`${index + 1}. Transaction: ${item.transaction_ref_number}, Invoice: ${item.invoice_ref_number}, Product ID: ${item.product_id || 'NULL'}, Quantity: ${item.quantity}, Total: ${item.line_total}`);
    });

    await sequelize.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkProductsTable();

