const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function checkInvoiceItemsProductData() {
  try {
    console.log('Checking invoice items for product data...\n');
    
    // Get invoice items with product information
    const invoiceItems = await sequelize.query(`
      SELECT 
        sii.id as invoice_item_id,
        si.invoice_ref_number,
        st.transaction_ref_number,
        sii.product_id,
        p.name as product_name,
        p.code as product_code,
        pc.id as product_category_id,
        pc.name as product_category_name,
        pc.code as product_category_code,
        pbn.id as brand_name_id,
        pbn.name as brand_name,
        pmf.id as manufacturer_id,
        pmf.name as manufacturer_name,
        pm.id as model_id,
        pm.name as model_name,
        pcl.id as color_id,
        pcl.name as color_name,
        pkg.id as packaging_id,
        pkg.name as packaging_name,
        psl.id as store_location_id,
        psl.location_name as store_location_name,
        p.product_type,
        sii.quantity,
        sii.line_total
      FROM sales_transactions st
      INNER JOIN sales_invoices si ON si.id = st.source_invoice_id
      INNER JOIN sales_invoice_items sii ON sii.sales_invoice_id = si.id
      LEFT JOIN products p ON p.id = sii.product_id
      LEFT JOIN product_categories pc ON pc.id = p.product_category_id
      LEFT JOIN product_brand_names pbn ON pbn.id = p.brand_name_id
      LEFT JOIN product_manufacturers pmf ON pmf.id = p.manufacturer_id
      LEFT JOIN product_models pm ON pm.id = p.model_id
      LEFT JOIN product_colors pcl ON pcl.id = p.color_id
      LEFT JOIN packaging pkg ON pkg.id = p.packaging_id
      LEFT JOIN product_store_locations psl ON psl.id = p.store_location_id
      ORDER BY st.created_at DESC, sii.id
      LIMIT 20;
    `, { type: QueryTypes.SELECT });

    if (invoiceItems.length === 0) {
      console.log('No invoice items found.');
      await sequelize.close();
      return;
    }

    console.log(`=== INVOICE ITEMS WITH PRODUCT DATA (${invoiceItems.length} items) ===\n`);

    invoiceItems.forEach((item, index) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`INVOICE ITEM ${index + 1}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Transaction: ${item.transaction_ref_number}`);
      console.log(`Invoice: ${item.invoice_ref_number}`);
      console.log(`Invoice Item ID: ${item.invoice_item_id}`);
      console.log(`\n📦 PRODUCT INFORMATION:`);
      console.log(`   Product ID: ${item.product_id || 'NULL'}`);
      console.log(`   Product Name: ${item.product_name || 'NULL'}`);
      console.log(`   Product Code: ${item.product_code || 'NULL'}`);
      console.log(`   Product Type: ${item.product_type || 'NULL'}`);
      console.log(`\n🏷️  PRODUCT ATTRIBUTES:`);
      console.log(`   Category ID: ${item.product_category_id || 'NULL'} ${item.product_category_name ? `(${item.product_category_name})` : ''}`);
      console.log(`   Brand ID: ${item.brand_name_id || 'NULL'} ${item.brand_name ? `(${item.brand_name})` : ''}`);
      console.log(`   Manufacturer ID: ${item.manufacturer_id || 'NULL'} ${item.manufacturer_name ? `(${item.manufacturer_name})` : ''}`);
      console.log(`   Model ID: ${item.model_id || 'NULL'} ${item.model_name ? `(${item.model_name})` : ''}`);
      console.log(`   Color ID: ${item.color_id || 'NULL'} ${item.color_name ? `(${item.color_name})` : ''}`);
      console.log(`   Packaging ID: ${item.packaging_id || 'NULL'} ${item.packaging_name ? `(${item.packaging_name})` : ''}`);
      console.log(`   Store Location ID: ${item.store_location_id || 'NULL'} ${item.store_location_name ? `(${item.store_location_name})` : ''}`);
      console.log(`\n💰 FINANCIAL:`);
      console.log(`   Quantity: ${item.quantity}`);
      console.log(`   Line Total: ${item.line_total}`);
    });

    // Summary: What product attributes are available in invoice items?
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('=== SUMMARY: PRODUCT ATTRIBUTES AVAILABILITY IN INVOICE ITEMS ===');
    console.log(`${'='.repeat(80)}\n`);

    const summary = await sequelize.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(DISTINCT sii.product_id) as unique_products,
        COUNT(DISTINCT p.product_category_id) as unique_categories,
        COUNT(DISTINCT p.brand_name_id) as unique_brands,
        COUNT(DISTINCT p.manufacturer_id) as unique_manufacturers,
        COUNT(DISTINCT p.model_id) as unique_models,
        COUNT(DISTINCT p.color_id) as unique_colors,
        COUNT(DISTINCT p.packaging_id) as unique_packaging,
        COUNT(DISTINCT p.store_location_id) as unique_store_locations,
        SUM(CASE WHEN p.product_category_id IS NOT NULL THEN 1 ELSE 0 END) as has_category,
        SUM(CASE WHEN p.brand_name_id IS NOT NULL THEN 1 ELSE 0 END) as has_brand,
        SUM(CASE WHEN p.manufacturer_id IS NOT NULL THEN 1 ELSE 0 END) as has_manufacturer,
        SUM(CASE WHEN p.model_id IS NOT NULL THEN 1 ELSE 0 END) as has_model,
        SUM(CASE WHEN p.color_id IS NOT NULL THEN 1 ELSE 0 END) as has_color,
        SUM(CASE WHEN p.packaging_id IS NOT NULL THEN 1 ELSE 0 END) as has_packaging,
        SUM(CASE WHEN p.store_location_id IS NOT NULL THEN 1 ELSE 0 END) as has_store_location
      FROM sales_transactions st
      INNER JOIN sales_invoices si ON si.id = st.source_invoice_id
      INNER JOIN sales_invoice_items sii ON sii.sales_invoice_id = si.id
      LEFT JOIN products p ON p.id = sii.product_id;
    `, { type: QueryTypes.SELECT });

    if (summary[0]) {
      const stats = summary[0];
      console.log(`Total Invoice Items: ${stats.total_items}`);
      console.log(`Unique Products: ${stats.unique_products}`);
      console.log(`\n📊 PRODUCT ATTRIBUTES IN INVOICE ITEMS:`);
      console.log(`   Categories: ${stats.unique_categories} unique, ${stats.has_category} items have category`);
      console.log(`   Brands: ${stats.unique_brands} unique, ${stats.has_brand} items have brand`);
      console.log(`   Manufacturers: ${stats.unique_manufacturers} unique, ${stats.has_manufacturer} items have manufacturer`);
      console.log(`   Models: ${stats.unique_models} unique, ${stats.has_model} items have model`);
      console.log(`   Colors: ${stats.unique_colors} unique, ${stats.has_color} items have color`);
      console.log(`   Packaging: ${stats.unique_packaging} unique, ${stats.has_packaging} items have packaging`);
      console.log(`   Store Locations: ${stats.unique_store_locations} unique, ${stats.has_store_location} items have store location`);
    }

    await sequelize.close();
    console.log('\n\n=== ANALYSIS COMPLETE ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkInvoiceItemsProductData();

