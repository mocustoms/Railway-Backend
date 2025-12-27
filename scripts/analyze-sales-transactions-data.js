const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function analyzeSalesTransactionsData() {
  try {
    console.log('Connecting to database...\n');
    
    // Get all columns in the table
    const allColumns = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'sales_transactions'
      ORDER BY ordinal_position;
    `, { type: QueryTypes.SELECT });

    console.log('=== ALL COLUMNS IN SALES_TRANSACTIONS TABLE ===\n');
    const columnNames = allColumns.map(col => col.column_name);
    console.log(`Total columns: ${columnNames.length}\n`);

    // Get actual data from the table
    const transactions = await sequelize.query(`
      SELECT * FROM sales_transactions
      ORDER BY created_at DESC
      LIMIT 5;
    `, { type: QueryTypes.SELECT });

    if (transactions.length === 0) {
      console.log('No transactions found in the table.');
      await sequelize.close();
      return;
    }

    console.log(`=== ANALYZING ${transactions.length} TRANSACTIONS ===\n`);

    // Analyze each transaction
    transactions.forEach((transaction, index) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`TRANSACTION ${index + 1}: ${transaction.transaction_ref_number || 'N/A'}`);
      console.log(`${'='.repeat(80)}\n`);

      // Categorize columns
      const populated = [];
      const nullValues = [];
      const zeroValues = [];
      const emptyStrings = [];
      const defaultValues = [];

      columnNames.forEach(col => {
        const value = transaction[col];
        
        if (value === null) {
          nullValues.push(col);
        } else if (value === 0 || value === '0' || value === '0.00') {
          zeroValues.push(col);
        } else if (value === '' || value === ' ') {
          emptyStrings.push(col);
        } else if (value === true || value === false || value === 'true' || value === 'false') {
          // Boolean values are considered populated
          populated.push(`${col} = ${value}`);
        } else if (value !== undefined && value !== null) {
          // Truncate long values for display
          const displayValue = typeof value === 'string' && value.length > 50 
            ? value.substring(0, 50) + '...' 
            : value;
          populated.push(`${col} = ${displayValue}`);
        }
      });

      console.log(`✅ POPULATED COLUMNS (${populated.length}):`);
      if (populated.length > 0) {
        populated.forEach(col => console.log(`   ${col}`));
      } else {
        console.log('   (none)');
      }

      console.log(`\n❌ NULL VALUES (${nullValues.length}):`);
      if (nullValues.length > 0) {
        // Group null values by category
        const categories = {
          'Product Attributes': nullValues.filter(c => 
            c.includes('product_') || c.includes('brand_') || c.includes('manufacturer_') || 
            c.includes('model_') || c.includes('color_') || c.includes('packaging_') || 
            c.includes('price_category') || c.includes('store_location')
          ),
          'Source References': nullValues.filter(c => 
            c.includes('source_') || c.includes('parent_')
          ),
          'Dates': nullValues.filter(c => 
            c.includes('_date') || c.includes('_at') && !c.includes('created_at') && !c.includes('updated_at')
          ),
          'User References': nullValues.filter(c => 
            c.includes('_by') && c !== 'created_by' && c !== 'updated_by'
          ),
          'Receipt Info': nullValues.filter(c => 
            c.includes('receipt_')
          ),
          'Other': nullValues.filter(c => 
            !c.includes('product_') && !c.includes('brand_') && !c.includes('manufacturer_') && 
            !c.includes('model_') && !c.includes('color_') && !c.includes('packaging_') && 
            !c.includes('price_category') && !c.includes('store_location') &&
            !c.includes('source_') && !c.includes('parent_') &&
            !c.includes('_date') && !c.includes('_at') &&
            !c.includes('_by') && !c.includes('receipt_')
          )
        };

        Object.keys(categories).forEach(category => {
          if (categories[category].length > 0) {
            console.log(`\n   ${category}:`);
            categories[category].forEach(col => console.log(`      - ${col}`));
          }
        });
      } else {
        console.log('   (none)');
      }

      console.log(`\n⚠️  ZERO VALUES (${zeroValues.length}):`);
      if (zeroValues.length > 0 && zeroValues.length <= 20) {
        zeroValues.forEach(col => console.log(`   ${col}`));
      } else if (zeroValues.length > 20) {
        console.log(`   (showing first 20 of ${zeroValues.length})`);
        zeroValues.slice(0, 20).forEach(col => console.log(`   ${col}`));
      } else {
        console.log('   (none)');
      }
    });

    // Summary statistics
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('=== SUMMARY STATISTICS ===');
    console.log(`${'='.repeat(80)}\n`);

    const summary = await sequelize.query(`
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT transaction_ref_number) as unique_refs,
        COUNT(DISTINCT store_id) as unique_stores,
        COUNT(DISTINCT customer_id) as unique_customers,
        COUNT(DISTINCT product_category_id) as unique_categories,
        COUNT(DISTINCT brand_name_id) as unique_brands,
        COUNT(DISTINCT manufacturer_id) as unique_manufacturers,
        COUNT(DISTINCT model_id) as unique_models,
        COUNT(DISTINCT color_id) as unique_colors,
        SUM(CASE WHEN product_category_id IS NOT NULL THEN 1 ELSE 0 END) as has_category,
        SUM(CASE WHEN brand_name_id IS NOT NULL THEN 1 ELSE 0 END) as has_brand,
        SUM(CASE WHEN manufacturer_id IS NOT NULL THEN 1 ELSE 0 END) as has_manufacturer,
        SUM(CASE WHEN model_id IS NOT NULL THEN 1 ELSE 0 END) as has_model,
        SUM(CASE WHEN color_id IS NOT NULL THEN 1 ELSE 0 END) as has_color,
        SUM(CASE WHEN source_invoice_id IS NOT NULL THEN 1 ELSE 0 END) as has_source_invoice,
        SUM(CASE WHEN source_order_id IS NOT NULL THEN 1 ELSE 0 END) as has_source_order,
        SUM(CASE WHEN sales_agent_id IS NOT NULL THEN 1 ELSE 0 END) as has_sales_agent,
        SUM(CASE WHEN due_date IS NOT NULL THEN 1 ELSE 0 END) as has_due_date,
        SUM(CASE WHEN delivery_date IS NOT NULL THEN 1 ELSE 0 END) as has_delivery_date,
        SUM(CASE WHEN notes IS NOT NULL THEN 1 ELSE 0 END) as has_notes,
        SUM(CASE WHEN receipt_number IS NOT NULL THEN 1 ELSE 0 END) as has_receipt_number,
        SUM(CASE WHEN receipt_invoice_number IS NOT NULL THEN 1 ELSE 0 END) as has_receipt_invoice_number
      FROM sales_transactions;
    `, { type: QueryTypes.SELECT });

    if (summary[0]) {
      const stats = summary[0];
      console.log(`Total Rows: ${stats.total_rows}`);
      console.log(`Unique Transaction References: ${stats.unique_refs}`);
      console.log(`Unique Stores: ${stats.unique_stores}`);
      console.log(`Unique Customers: ${stats.unique_customers}`);
      
      console.log(`\n📊 PRODUCT ATTRIBUTES:`);
      console.log(`   Categories: ${stats.unique_categories} unique, ${stats.has_category} rows have category`);
      console.log(`   Brands: ${stats.unique_brands} unique, ${stats.has_brand} rows have brand`);
      console.log(`   Manufacturers: ${stats.unique_manufacturers} unique, ${stats.has_manufacturer} rows have manufacturer`);
      console.log(`   Models: ${stats.unique_models} unique, ${stats.has_model} rows have model`);
      console.log(`   Colors: ${stats.unique_colors} unique, ${stats.has_color} rows have color`);
      
      console.log(`\n📊 SOURCE REFERENCES:`);
      console.log(`   Source Invoice: ${stats.has_source_invoice} rows`);
      console.log(`   Source Order: ${stats.has_source_order} rows`);
      
      console.log(`\n📊 OTHER DATA:`);
      console.log(`   Sales Agent: ${stats.has_sales_agent} rows`);
      console.log(`   Due Date: ${stats.has_due_date} rows`);
      console.log(`   Delivery Date: ${stats.has_delivery_date} rows`);
      console.log(`   Notes: ${stats.has_notes} rows`);
      console.log(`   Receipt Number: ${stats.has_receipt_number} rows`);
      console.log(`   Receipt Invoice Number: ${stats.has_receipt_invoice_number} rows`);
    }

    // Check if there are related invoice items that might have product data
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('=== CHECKING RELATED INVOICE ITEMS FOR PRODUCT DATA ===');
    console.log(`${'='.repeat(80)}\n`);

    const invoiceItemsCheck = await sequelize.query(`
      SELECT 
        st.id as transaction_id,
        st.transaction_ref_number,
        st.source_invoice_id,
        COUNT(sii.id) as invoice_item_count,
        COUNT(DISTINCT sii.product_id) as unique_products,
        COUNT(DISTINCT sii.product_id) FILTER (WHERE sii.product_id IS NOT NULL) as non_null_products
      FROM sales_transactions st
      LEFT JOIN sales_invoices si ON si.id = st.source_invoice_id
      LEFT JOIN sales_invoice_items sii ON sii.sales_invoice_id = si.id
      GROUP BY st.id, st.transaction_ref_number, st.source_invoice_id
      ORDER BY st.created_at DESC
      LIMIT 5;
    `, { type: QueryTypes.SELECT });

    if (invoiceItemsCheck.length > 0) {
      console.log('Transaction -> Invoice -> Invoice Items relationship:');
      invoiceItemsCheck.forEach(row => {
        console.log(`\n   Transaction: ${row.transaction_ref_number}`);
        console.log(`   Source Invoice ID: ${row.source_invoice_id || 'NULL'}`);
        console.log(`   Invoice Items: ${row.invoice_item_count}`);
        console.log(`   Unique Products: ${row.unique_products}`);
        console.log(`   Non-Null Products: ${row.non_null_products}`);
      });
    }

    await sequelize.close();
    console.log('\n\n=== ANALYSIS COMPLETE ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

analyzeSalesTransactionsData();

