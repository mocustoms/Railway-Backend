const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function checkAllSalesTransactionsData() {
  try {
    console.log('Checking all sales_transactions data...\n');
    
    // Get all transactions with their source types
    const allTransactions = await sequelize.query(`
      SELECT 
        st.id,
        st."transaction_ref_number",
        st."transaction_type",
        st."source_invoice_id",
        st."source_order_id",
        st."product_category_id",
        st."brand_name_id",
        st."manufacturer_id",
        st."model_id",
        st."color_id",
        st."packaging_id",
        st."store_location_id",
        st."product_type",
        st."price_category_id",
        si."invoice_ref_number",
        so."sales_order_ref_number"
      FROM sales_transactions st
      LEFT JOIN sales_invoices si ON si.id = st."source_invoice_id"
      LEFT JOIN sales_orders so ON so.id = st."source_order_id"
      ORDER BY st."created_at" DESC;
    `, { type: QueryTypes.SELECT });

    console.log(`=== ALL SALES TRANSACTIONS (${allTransactions.length} total) ===\n`);

    // Categorize by source type
    const bySourceType = {
      invoice: [],
      order: [],
      other: []
    };

    allTransactions.forEach(t => {
      if (t.source_invoice_id) {
        bySourceType.invoice.push(t);
      } else if (t.source_order_id) {
        bySourceType.order.push(t);
      } else {
        bySourceType.other.push(t);
      }
    });

    console.log(`📊 BREAKDOWN BY SOURCE TYPE:`);
    console.log(`   Invoices: ${bySourceType.invoice.length}`);
    console.log(`   Orders: ${bySourceType.order.length}`);
    console.log(`   Other: ${bySourceType.other.length}\n`);

    // Check product data completeness
    console.log(`\n${'='.repeat(80)}`);
    console.log('=== PRODUCT DATA COMPLETENESS ===');
    console.log(`${'='.repeat(80)}\n`);

    allTransactions.forEach((t, index) => {
      const hasAllAttributes = 
        t.product_category_id && 
        t.brand_name_id && 
        t.manufacturer_id && 
        t.model_id && 
        t.color_id && 
        t.product_type;

      const missingAttributes = [];
      if (!t.product_category_id) missingAttributes.push('category');
      if (!t.brand_name_id) missingAttributes.push('brand');
      if (!t.manufacturer_id) missingAttributes.push('manufacturer');
      if (!t.model_id) missingAttributes.push('model');
      if (!t.color_id) missingAttributes.push('color');
      if (!t.product_type) missingAttributes.push('product_type');

      console.log(`${index + 1}. ${t.transaction_ref_number} (${t.transaction_type})`);
      console.log(`   Source: ${t.source_invoice_id ? `Invoice: ${t.invoice_ref_number || 'N/A'}` : t.source_order_id ? `Order: ${t.sales_order_ref_number || 'N/A'}` : 'None'}`);
      console.log(`   Product Data: ${hasAllAttributes ? '✅ Complete' : `❌ Missing: ${missingAttributes.join(', ')}`}`);
      if (hasAllAttributes) {
        console.log(`   Category: ${t.product_category_id ? '✅' : '❌'}`);
        console.log(`   Brand: ${t.brand_name_id ? '✅' : '❌'}`);
        console.log(`   Manufacturer: ${t.manufacturer_id ? '✅' : '❌'}`);
        console.log(`   Model: ${t.model_id ? '✅' : '❌'}`);
        console.log(`   Color: ${t.color_id ? '✅' : '❌'}`);
        console.log(`   Product Type: ${t.product_type ? '✅' : '❌'}`);
        console.log(`   Packaging: ${t.packaging_id ? '✅' : '❌'}`);
        console.log(`   Store Location: ${t.store_location_id ? '✅' : '❌'}`);
        console.log(`   Price Category: ${t.price_category_id ? '✅' : '❌'}`);
      }
      console.log('');
    });

    // Summary statistics
    console.log(`\n${'='.repeat(80)}`);
    console.log('=== SUMMARY STATISTICS ===');
    console.log(`${'='.repeat(80)}\n`);

    const stats = await sequelize.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT "source_invoice_id") FILTER (WHERE "source_invoice_id" IS NOT NULL) as unique_invoices,
        COUNT(DISTINCT "source_order_id") FILTER (WHERE "source_order_id" IS NOT NULL) as unique_orders,
        SUM(CASE WHEN "product_category_id" IS NOT NULL THEN 1 ELSE 0 END) as has_category,
        SUM(CASE WHEN "brand_name_id" IS NOT NULL THEN 1 ELSE 0 END) as has_brand,
        SUM(CASE WHEN "manufacturer_id" IS NOT NULL THEN 1 ELSE 0 END) as has_manufacturer,
        SUM(CASE WHEN "model_id" IS NOT NULL THEN 1 ELSE 0 END) as has_model,
        SUM(CASE WHEN "color_id" IS NOT NULL THEN 1 ELSE 0 END) as has_color,
        SUM(CASE WHEN "product_type" IS NOT NULL THEN 1 ELSE 0 END) as has_product_type,
        SUM(CASE WHEN "packaging_id" IS NOT NULL THEN 1 ELSE 0 END) as has_packaging,
        SUM(CASE WHEN "store_location_id" IS NOT NULL THEN 1 ELSE 0 END) as has_store_location,
        SUM(CASE WHEN "price_category_id" IS NOT NULL THEN 1 ELSE 0 END) as has_price_category,
        SUM(CASE WHEN 
          "product_category_id" IS NOT NULL 
          AND "brand_name_id" IS NOT NULL 
          AND "manufacturer_id" IS NOT NULL 
          AND "model_id" IS NOT NULL 
          AND "color_id" IS NOT NULL 
          AND "product_type" IS NOT NULL 
        THEN 1 ELSE 0 END) as complete_product_data
      FROM sales_transactions;
    `, { type: QueryTypes.SELECT });

    if (stats[0]) {
      const s = stats[0];
      console.log(`Total Transactions: ${s.total}`);
      console.log(`From Invoices: ${s.unique_invoices}`);
      console.log(`From Orders: ${s.unique_orders}`);
      console.log(`\n📊 PRODUCT ATTRIBUTES:`);
      console.log(`   Category: ${s.has_category}/${s.total} (${((s.has_category/s.total)*100).toFixed(1)}%)`);
      console.log(`   Brand: ${s.has_brand}/${s.total} (${((s.has_brand/s.total)*100).toFixed(1)}%)`);
      console.log(`   Manufacturer: ${s.has_manufacturer}/${s.total} (${((s.has_manufacturer/s.total)*100).toFixed(1)}%)`);
      console.log(`   Model: ${s.has_model}/${s.total} (${((s.has_model/s.total)*100).toFixed(1)}%)`);
      console.log(`   Color: ${s.has_color}/${s.total} (${((s.has_color/s.total)*100).toFixed(1)}%)`);
      console.log(`   Product Type: ${s.has_product_type}/${s.total} (${((s.has_product_type/s.total)*100).toFixed(1)}%)`);
      console.log(`   Packaging: ${s.has_packaging}/${s.total} (${((s.has_packaging/s.total)*100).toFixed(1)}%)`);
      console.log(`   Store Location: ${s.has_store_location}/${s.total} (${((s.has_store_location/s.total)*100).toFixed(1)}%)`);
      console.log(`   Price Category: ${s.has_price_category}/${s.total} (${((s.has_price_category/s.total)*100).toFixed(1)}%)`);
      console.log(`\n✅ Complete Product Data: ${s.complete_product_data}/${s.total} (${((s.complete_product_data/s.total)*100).toFixed(1)}%)`);
    }

    // Check orders specifically
    if (bySourceType.order.length > 0) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('=== SALES ORDERS PRODUCT DATA ===');
      console.log(`${'='.repeat(80)}\n`);

      for (const orderTransaction of bySourceType.order) {
        console.log(`Order Transaction: ${orderTransaction.transaction_ref_number}`);
        console.log(`Order Ref: ${orderTransaction.sales_order_ref_number || 'N/A'}`);
        
        // Check if order has items with products
        const orderItems = await sequelize.query(`
          SELECT 
            soi."product_id",
            p."product_type",
            p."category_id",
            p."brand_id",
            p."manufacturer_id",
            p."model_id",
            p."color_id",
            p."store_location_id",
            p."default_packaging_id"
          FROM sales_order_items soi
          INNER JOIN sales_orders so ON so.id = soi."sales_order_id"
          LEFT JOIN products p ON p.id = soi."product_id"
          WHERE so.id = :orderId
            AND so."companyId" = :companyId
            AND p.id IS NOT NULL
          ORDER BY soi."created_at" ASC
          LIMIT 1;
        `, {
          type: QueryTypes.SELECT,
          replacements: { 
            orderId: orderTransaction.source_order_id, 
            companyId: orderTransaction.companyId || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3' 
          }
        });

        if (orderItems.length > 0) {
          const item = orderItems[0];
          console.log(`   Product ID: ${item.product_id}`);
          console.log(`   Product Type: ${item.product_type || 'NULL'}`);
          console.log(`   Category: ${item.category_id || 'NULL'}`);
          console.log(`   Brand: ${item.brand_id || 'NULL'}`);
          console.log(`   Manufacturer: ${item.manufacturer_id || 'NULL'}`);
          console.log(`   Model: ${item.model_id || 'NULL'}`);
          console.log(`   Color: ${item.color_id || 'NULL'}`);
          console.log(`\n   Transaction has:`);
          console.log(`   Category: ${orderTransaction.product_category_id || 'NULL'} ${orderTransaction.product_category_id === item.category_id ? '✅' : '❌'}`);
          console.log(`   Brand: ${orderTransaction.brand_name_id || 'NULL'} ${orderTransaction.brand_name_id === item.brand_id ? '✅' : '❌'}`);
          console.log(`   Manufacturer: ${orderTransaction.manufacturer_id || 'NULL'} ${orderTransaction.manufacturer_id === item.manufacturer_id ? '✅' : '❌'}`);
          console.log(`   Model: ${orderTransaction.model_id || 'NULL'} ${orderTransaction.model_id === item.model_id ? '✅' : '❌'}`);
          console.log(`   Color: ${orderTransaction.color_id || 'NULL'} ${orderTransaction.color_id === item.color_id ? '✅' : '❌'}`);
        } else {
          console.log(`   ⚠️  No product found in order items`);
        }
        console.log('');
      }
    }

    // Check proforma invoices (if they create transactions)
    console.log(`\n${'='.repeat(80)}`);
    console.log('=== CHECKING PROFORMA INVOICES ===');
    console.log(`${'='.repeat(80)}\n`);

    const proformaInvoices = await sequelize.query(`
      SELECT 
        pi.id,
        pi."proforma_ref_number",
        pi."companyId",
        COUNT(pi."id") as item_count
      FROM proforma_invoices pi
      WHERE pi."companyId" = :companyId
      GROUP BY pi.id, pi."proforma_ref_number", pi."companyId"
      ORDER BY pi."created_at" DESC
      LIMIT 10;
    `, {
      type: QueryTypes.SELECT,
      replacements: { companyId: '4e42f29c-4b11-48a3-a74a-ba4f26c138e3' }
    });

    console.log(`Found ${proformaInvoices.length} proforma invoices\n`);

    if (proformaInvoices.length > 0) {
      for (const proforma of proformaInvoices) {
        console.log(`Proforma Invoice: ${proforma.proforma_ref_number}`);
        
        // Check if proforma has items with products
        const proformaItems = await sequelize.query(`
          SELECT 
            pii."product_id",
            p."product_type",
            p."category_id",
            p."brand_id",
            p."manufacturer_id",
            p."model_id",
            p."color_id"
          FROM proforma_invoice_items pii
          INNER JOIN proforma_invoices pi ON pi.id = pii."proforma_invoice_id"
          LEFT JOIN products p ON p.id = pii."product_id"
          WHERE pi.id = :proformaId
            AND pi."companyId" = :companyId
            AND p.id IS NOT NULL
          ORDER BY pii."created_at" ASC
          LIMIT 1;
        `, {
          type: QueryTypes.SELECT,
          replacements: { 
            proformaId: proforma.id, 
            companyId: proforma.companyId 
          }
        });

        if (proformaItems.length > 0) {
          const item = proformaItems[0];
          console.log(`   Has Product: ✅`);
          console.log(`   Product ID: ${item.product_id}`);
          console.log(`   Category: ${item.category_id || 'NULL'}`);
          console.log(`   Brand: ${item.brand_id || 'NULL'}`);
          console.log(`   Manufacturer: ${item.manufacturer_id || 'NULL'}`);
          console.log(`   Model: ${item.model_id || 'NULL'}`);
          console.log(`   Color: ${item.color_id || 'NULL'}`);
        } else {
          console.log(`   Has Product: ❌`);
        }

        // Check if there's a related sales transaction
        const relatedTransaction = await sequelize.query(`
          SELECT 
            st.id,
            st."transaction_ref_number",
            st."product_category_id",
            st."brand_name_id",
            st."manufacturer_id",
            st."model_id",
            st."color_id"
          FROM sales_transactions st
          INNER JOIN sales_invoices si ON si.id = st."source_invoice_id"
          WHERE si."proforma_invoice_id" = :proformaId
            AND st."companyId" = :companyId
          LIMIT 1;
        `, {
          type: QueryTypes.SELECT,
          replacements: { 
            proformaId: proforma.id, 
            companyId: proforma.companyId 
          }
        });

        if (relatedTransaction.length > 0) {
          const t = relatedTransaction[0];
          console.log(`   Related Transaction: ${t.transaction_ref_number}`);
          console.log(`   Transaction has product data: ${t.product_category_id ? '✅' : '❌'}`);
        } else {
          console.log(`   Related Transaction: None (proforma not converted to invoice yet)`);
        }
        console.log('');
      }
    }

    await sequelize.close();
    console.log('\n=== ANALYSIS COMPLETE ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAllSalesTransactionsData();

