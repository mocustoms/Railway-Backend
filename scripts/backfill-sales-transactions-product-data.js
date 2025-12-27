require('dotenv').config();
const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');

// Mock request object
let mockReq = {
  user: {
    companyId: process.env.COMPANY_ID || null
  }
};

async function backfillSalesTransactionsProductData() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('Starting backfill of sales_transactions product data...\n');

    // Get all sales transactions that are missing product attributes
    // Check both invoices and orders
    const transactionsToUpdate = await sequelize.query(`
      SELECT 
        st.id,
        st."transaction_ref_number",
        st."transaction_type",
        st."source_invoice_id",
        st."source_order_id",
        st."companyId"
      FROM sales_transactions st
      WHERE (
        st."source_invoice_id" IS NOT NULL
        OR st."source_order_id" IS NOT NULL
      )
        AND (
          st."product_category_id" IS NULL
          OR st."brand_name_id" IS NULL
          OR st."manufacturer_id" IS NULL
          OR st."model_id" IS NULL
          OR st."color_id" IS NULL
          OR st."product_type" IS NULL
        )
      ORDER BY st."created_at" DESC;
    `, { type: QueryTypes.SELECT, transaction });

    console.log(`Found ${transactionsToUpdate.length} transactions to update\n`);

    if (transactionsToUpdate.length === 0) {
      console.log('No transactions need updating.');
      await transaction.commit();
      await sequelize.close();
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const st of transactionsToUpdate) {
      try {
        // Set companyId from transaction if not already set
        if (!mockReq.user.companyId && st.companyId) {
          mockReq.user.companyId = st.companyId;
        }

        let product = null;

        // Get product data from invoice items if source is invoice
        if (st.source_invoice_id) {
          const invoiceItem = await sequelize.query(`
            SELECT 
              sii."product_id",
              p."product_type",
              p."category_id",
              p."brand_id",
              p."manufacturer_id",
              p."model_id",
              p."color_id",
              p."store_location_id",
              p."default_packaging_id"
            FROM sales_invoice_items sii
            INNER JOIN sales_invoices si ON si.id = sii."sales_invoice_id"
            LEFT JOIN products p ON p.id = sii."product_id"
            WHERE sii."sales_invoice_id" = :invoiceId
              AND si."companyId" = :companyId
              AND p.id IS NOT NULL
            ORDER BY sii."created_at" ASC
            LIMIT 1;
          `, {
            type: QueryTypes.SELECT,
            replacements: { invoiceId: st.source_invoice_id, companyId: st.companyId },
            transaction
          });

          if (invoiceItem.length > 0 && invoiceItem[0].product_id) {
            product = invoiceItem[0];
          }
        }
        // Get product data from order items if source is order
        else if (st.source_order_id) {
          const orderItem = await sequelize.query(`
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
            WHERE soi."sales_order_id" = :orderId
              AND so."companyId" = :companyId
              AND p.id IS NOT NULL
            ORDER BY soi."created_at" ASC
            LIMIT 1;
          `, {
            type: QueryTypes.SELECT,
            replacements: { orderId: st.source_order_id, companyId: st.companyId },
            transaction
          });

          if (orderItem.length > 0 && orderItem[0].product_id) {
            product = orderItem[0];
          }
        }

        if (!product || !product.product_id) {
          console.log(`⚠️  Skipping ${st.transaction_ref_number} (${st.transaction_type}): No product found`);
          skippedCount++;
          continue;
        }

        // Get price category if available
        let priceCategoryId = null;
        if (product.product_id) {
          const priceCategory = await sequelize.query(`
            SELECT "price_category_id"
            FROM product_price_categories
            WHERE "product_id" = :productId
              AND "companyId" = :companyId
            ORDER BY "created_at" ASC
            LIMIT 1;
          `, {
            type: QueryTypes.SELECT,
            replacements: { productId: product.product_id, companyId: st.companyId },
            transaction
          });

          if (priceCategory.length > 0) {
            priceCategoryId = priceCategory[0].price_category_id;
          }
        }

        // Update the sales transaction with product attributes
        await sequelize.query(`
          UPDATE sales_transactions
          SET 
            "product_type" = :productType,
            "product_category_id" = :categoryId,
            "brand_name_id" = :brandId,
            "manufacturer_id" = :manufacturerId,
            "model_id" = :modelId,
            "color_id" = :colorId,
            "packaging_id" = :packagingId,
            "store_location_id" = :storeLocationId,
            "price_category_id" = :priceCategoryId,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE id = :transactionId
            AND "companyId" = :companyId;
        `, {
          replacements: {
            transactionId: st.id,
            companyId: st.companyId,
            productType: product.product_type || null,
            categoryId: product.category_id || null,
            brandId: product.brand_id || null,
            manufacturerId: product.manufacturer_id || null,
            modelId: product.model_id || null,
            colorId: product.color_id || null,
            packagingId: product.default_packaging_id || null,
            storeLocationId: product.store_location_id || null,
            priceCategoryId: priceCategoryId
          },
          transaction
        });

        updatedCount++;
        console.log(`✅ Updated ${st.transaction_ref_number} with product data`);
      } catch (error) {
        console.error(`❌ Error updating ${st.transaction_ref_number}:`, error.message);
        skippedCount++;
      }
    }

    await transaction.commit();
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('=== BACKFILL COMPLETE ===');
    console.log(`${'='.repeat(80)}`);
    console.log(`Total transactions processed: ${transactionsToUpdate.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`${'='.repeat(80)}\n`);

    await sequelize.close();
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error in backfill:', error);
    process.exit(1);
  }
}

backfillSalesTransactionsProductData();

