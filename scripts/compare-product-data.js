const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function compareProductData() {
  try {
    console.log('Comparing product data in products vs sales_transactions...\n');
    
    // Get product data from invoice items via products table
    const productData = await sequelize.query(`
      SELECT 
        st.id as transaction_id,
        st.transaction_ref_number,
        st.product_category_id as st_category_id,
        st.brand_name_id as st_brand_id,
        st.manufacturer_id as st_manufacturer_id,
        st.model_id as st_model_id,
        st.color_id as st_color_id,
        st.packaging_id as st_packaging_id,
        st.store_location_id as st_store_location_id,
        st.product_type as st_product_type,
        sii.product_id,
        p.category_id as p_category_id,
        p.brand_id as p_brand_id,
        p.manufacturer_id as p_manufacturer_id,
        p.model_id as p_model_id,
        p.color_id as p_color_id,
        p.default_packaging_id as p_packaging_id,
        p.store_location_id as p_store_location_id,
        p.product_type as p_product_type,
        pc.name as category_name,
        pbn.name as brand_name,
        pmf.name as manufacturer_name,
        pm.name as model_name,
        pcl.name as color_name
      FROM sales_transactions st
      INNER JOIN sales_invoices si ON si.id = st.source_invoice_id
      INNER JOIN sales_invoice_items sii ON sii.sales_invoice_id = si.id
      LEFT JOIN products p ON p.id = sii.product_id
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN product_brand_names pbn ON pbn.id = p.brand_id
      LEFT JOIN product_manufacturers pmf ON pmf.id = p.manufacturer_id
      LEFT JOIN product_models pm ON pm.id = p.model_id
      LEFT JOIN product_colors pcl ON pcl.id = p.color_id
      ORDER BY st.created_at DESC
      LIMIT 10;
    `, { type: QueryTypes.SELECT });

    console.log(`=== COMPARISON: PRODUCT DATA IN PRODUCTS TABLE vs SALES_TRANSACTIONS ===\n`);
    console.log(`Found ${productData.length} invoice items with product data\n`);

    productData.forEach((row, index) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`COMPARISON ${index + 1}: Transaction ${row.transaction_ref_number}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Product ID: ${row.product_id}`);
      
      console.log(`\n📊 PRODUCT ATTRIBUTES COMPARISON:`);
      console.log(`\nCategory:`);
      console.log(`  Products Table: ${row.p_category_id || 'NULL'} ${row.category_name ? `(${row.category_name})` : ''}`);
      console.log(`  Sales Transactions: ${row.st_category_id || 'NULL'}`);
      console.log(`  Match: ${row.p_category_id === row.st_category_id ? '✅' : '❌'}`);
      
      console.log(`\nBrand:`);
      console.log(`  Products Table: ${row.p_brand_id || 'NULL'} ${row.brand_name ? `(${row.brand_name})` : ''}`);
      console.log(`  Sales Transactions: ${row.st_brand_id || 'NULL'}`);
      console.log(`  Match: ${row.p_brand_id === row.st_brand_id ? '✅' : '❌'}`);
      
      console.log(`\nManufacturer:`);
      console.log(`  Products Table: ${row.p_manufacturer_id || 'NULL'} ${row.manufacturer_name ? `(${row.manufacturer_name})` : ''}`);
      console.log(`  Sales Transactions: ${row.st_manufacturer_id || 'NULL'}`);
      console.log(`  Match: ${row.p_manufacturer_id === row.st_manufacturer_id ? '✅' : '❌'}`);
      
      console.log(`\nModel:`);
      console.log(`  Products Table: ${row.p_model_id || 'NULL'} ${row.model_name ? `(${row.model_name})` : ''}`);
      console.log(`  Sales Transactions: ${row.st_model_id || 'NULL'}`);
      console.log(`  Match: ${row.p_model_id === row.st_model_id ? '✅' : '❌'}`);
      
      console.log(`\nColor:`);
      console.log(`  Products Table: ${row.p_color_id || 'NULL'} ${row.color_name ? `(${row.color_name})` : ''}`);
      console.log(`  Sales Transactions: ${row.st_color_id || 'NULL'}`);
      console.log(`  Match: ${row.p_color_id === row.st_color_id ? '✅' : '❌'}`);
      
      console.log(`\nPackaging:`);
      console.log(`  Products Table: ${row.p_packaging_id || 'NULL'}`);
      console.log(`  Sales Transactions: ${row.st_packaging_id || 'NULL'}`);
      console.log(`  Match: ${row.p_packaging_id === row.st_packaging_id ? '✅' : '❌'}`);
      
      console.log(`\nStore Location:`);
      console.log(`  Products Table: ${row.p_store_location_id || 'NULL'}`);
      console.log(`  Sales Transactions: ${row.st_store_location_id || 'NULL'}`);
      console.log(`  Match: ${row.p_store_location_id === row.st_store_location_id ? '✅' : '❌'}`);
      
      console.log(`\nProduct Type:`);
      console.log(`  Products Table: ${row.p_product_type || 'NULL'}`);
      console.log(`  Sales Transactions: ${row.st_product_type || 'NULL'}`);
      console.log(`  Match: ${row.p_product_type === row.st_product_type ? '✅' : '❌'}`);
    });

    // Summary
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('=== SUMMARY ===');
    console.log(`${'='.repeat(80)}\n`);

    const summary = await sequelize.query(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN p.category_id IS NOT NULL THEN 1 ELSE 0 END) as products_with_category,
        SUM(CASE WHEN st.product_category_id IS NOT NULL THEN 1 ELSE 0 END) as transactions_with_category,
        SUM(CASE WHEN p.brand_id IS NOT NULL THEN 1 ELSE 0 END) as products_with_brand,
        SUM(CASE WHEN st.brand_name_id IS NOT NULL THEN 1 ELSE 0 END) as transactions_with_brand,
        SUM(CASE WHEN p.manufacturer_id IS NOT NULL THEN 1 ELSE 0 END) as products_with_manufacturer,
        SUM(CASE WHEN st.manufacturer_id IS NOT NULL THEN 1 ELSE 0 END) as transactions_with_manufacturer,
        SUM(CASE WHEN p.model_id IS NOT NULL THEN 1 ELSE 0 END) as products_with_model,
        SUM(CASE WHEN st.model_id IS NOT NULL THEN 1 ELSE 0 END) as transactions_with_model,
        SUM(CASE WHEN p.color_id IS NOT NULL THEN 1 ELSE 0 END) as products_with_color,
        SUM(CASE WHEN st.color_id IS NOT NULL THEN 1 ELSE 0 END) as transactions_with_color
      FROM sales_transactions st
      INNER JOIN sales_invoices si ON si.id = st.source_invoice_id
      INNER JOIN sales_invoice_items sii ON sii.sales_invoice_id = si.id
      LEFT JOIN products p ON p.id = sii.product_id;
    `, { type: QueryTypes.SELECT });

    if (summary[0]) {
      const stats = summary[0];
      console.log(`Total Invoice Items: ${stats.total_items}`);
      console.log(`\n📊 DATA AVAILABILITY COMPARISON:`);
      console.log(`\nCategory:`);
      console.log(`  In Products: ${stats.products_with_category} items`);
      console.log(`  In Sales Transactions: ${stats.transactions_with_category} items`);
      console.log(`  Missing: ${stats.products_with_category - stats.transactions_with_category} items`);
      
      console.log(`\nBrand:`);
      console.log(`  In Products: ${stats.products_with_brand} items`);
      console.log(`  In Sales Transactions: ${stats.transactions_with_brand} items`);
      console.log(`  Missing: ${stats.products_with_brand - stats.transactions_with_brand} items`);
      
      console.log(`\nManufacturer:`);
      console.log(`  In Products: ${stats.products_with_manufacturer} items`);
      console.log(`  In Sales Transactions: ${stats.transactions_with_manufacturer} items`);
      console.log(`  Missing: ${stats.products_with_manufacturer - stats.transactions_with_manufacturer} items`);
      
      console.log(`\nModel:`);
      console.log(`  In Products: ${stats.products_with_model} items`);
      console.log(`  In Sales Transactions: ${stats.transactions_with_model} items`);
      console.log(`  Missing: ${stats.products_with_model - stats.transactions_with_model} items`);
      
      console.log(`\nColor:`);
      console.log(`  In Products: ${stats.products_with_color} items`);
      console.log(`  In Sales Transactions: ${stats.transactions_with_color} items`);
      console.log(`  Missing: ${stats.products_with_color - stats.transactions_with_color} items`);
    }

    await sequelize.close();
    console.log('\n\n=== ANALYSIS COMPLETE ===');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

compareProductData();

