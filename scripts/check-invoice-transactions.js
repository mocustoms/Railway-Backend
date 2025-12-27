const { sequelize } = require('../server/models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    const invoiceRefNumber = process.argv[2] || 'INV-20251114-0001';
    console.log(`\n🔍 Checking invoice: ${invoiceRefNumber}\n`);

    // First, let's check if invoice exists (without company filter for now)
    const [allInvoices] = await sequelize.query(`
      SELECT 
        si.id, 
        si."invoice_ref_number",
        si."companyId"
      FROM sales_invoices si 
      WHERE si."invoice_ref_number" LIKE :pattern
      ORDER BY si."created_at" DESC
      LIMIT 10
    `, {
      replacements: { pattern: `%${invoiceRefNumber.split('-').pop()}%` },
      type: sequelize.QueryTypes.SELECT
    });

    if (allInvoices.length > 0) {
      console.log(`\n📋 Found ${allInvoices.length} invoice(s) matching pattern:`);
      allInvoices.forEach((inv, idx) => {
        console.log(`   ${idx + 1}. ${inv.invoice_ref_number} (Company: ${inv.companyId})`);
      });
    }

    // Get invoice with item count
    const [invoiceResults] = await sequelize.query(`
      SELECT 
        si.id, 
        si."invoice_ref_number", 
        COUNT(sii.id)::int as item_count
      FROM sales_invoices si 
      LEFT JOIN sales_invoice_items sii ON si.id = sii.sales_invoice_id 
      WHERE si."invoice_ref_number" = :invoiceRefNumber
      GROUP BY si.id, si."invoice_ref_number"
    `, {
      replacements: { invoiceRefNumber },
      type: sequelize.QueryTypes.SELECT
    });

    if (!invoiceResults || invoiceResults.length === 0) {
      console.log('❌ Invoice not found');
      process.exit(1);
    }

    const invoice = invoiceResults[0];
    if (!invoice) {
      console.log('❌ Invoice not found');
      process.exit(1);
    }
    
    console.log(`📄 Invoice: ${invoice.invoice_ref_number}`);
    console.log(`   Items: ${invoice.item_count}`);

    // Get all invoice items with product names
    const [items] = await sequelize.query(`
      SELECT 
        sii.id,
        sii.product_id,
        p.name as product_name,
        sii.quantity,
        sii.line_total
      FROM sales_invoice_items sii
      LEFT JOIN products p ON sii.product_id = p.id
      WHERE sii.sales_invoice_id = :invoiceId
      ORDER BY sii.created_at ASC
    `, {
      replacements: { invoiceId: invoice.id },
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`\n📦 Invoice Items (${items.length}):`);
    items.forEach((item, index) => {
      console.log(`   ${index + 1}. Product: ${item.product_name || 'N/A'} (ID: ${item.product_id})`);
      console.log(`      Quantity: ${item.quantity}, Line Total: ${item.line_total}`);
    });

    // Get sales transactions for this invoice
    const [transactions] = await sequelize.query(`
      SELECT 
        st.id,
        st.transaction_ref_number,
        st.product_id,
        p.name as product_name,
        st.product_type,
        st.product_category_id,
        st.brand_name_id,
        st.manufacturer_id,
        st.model_id
      FROM sales_transactions st
      LEFT JOIN products p ON st.product_id = p.id
      WHERE st.source_invoice_id = :invoiceId
      ORDER BY st.created_at ASC
    `, {
      replacements: { invoiceId: invoice.id },
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`\n💳 Sales Transactions (${transactions.length}):`);
    if (transactions.length === 0) {
      console.log('   ❌ No sales transactions found for this invoice');
    } else {
      transactions.forEach((tx, index) => {
        console.log(`   ${index + 1}. Transaction: ${tx.transaction_ref_number}`);
        console.log(`      Product: ${tx.product_name || 'N/A'} (ID: ${tx.product_id})`);
        console.log(`      Product Type: ${tx.product_type || 'N/A'}`);
      });
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Invoice Items: ${items.length}`);
    console.log(`   Sales Transactions: ${transactions.length}`);
    
    if (items.length !== transactions.length) {
      console.log(`\n⚠️  MISMATCH: Invoice has ${items.length} items but only ${transactions.length} transaction(s) in sales_transactions table!`);
      console.log(`\n   Missing products:`);
      items.forEach((item, index) => {
        const found = transactions.find(tx => tx.product_id === item.product_id);
        if (!found) {
          console.log(`   - ${item.product_name || 'N/A'} (ID: ${item.product_id})`);
        }
      });
    } else {
      console.log(`\n✅ All invoice items have corresponding sales transactions`);
    }

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();

