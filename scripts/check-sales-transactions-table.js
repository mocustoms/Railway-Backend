const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function checkSalesTransactionsTable() {
  try {
    console.log('Connecting to database...\n');
    
    // Get table structure (columns)
    console.log('=== SALES_TRANSACTIONS TABLE STRUCTURE ===\n');
    const tableInfo = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'sales_transactions'
      ORDER BY ordinal_position;
    `, { type: QueryTypes.SELECT });

    console.log('Columns in sales_transactions table:');
    console.log('----------------------------------------');
    tableInfo.forEach((col, index) => {
      console.log(`${index + 1}. ${col.column_name.padEnd(35)} | ${col.data_type.padEnd(20)} | Nullable: ${col.is_nullable} | Default: ${col.column_default || 'NULL'}`);
    });

    // Get row count
    console.log('\n=== TABLE STATISTICS ===\n');
    const rowCount = await sequelize.query(`
      SELECT COUNT(*) as count FROM sales_transactions;
    `, { type: QueryTypes.SELECT });
    console.log(`Total rows: ${rowCount[0].count}`);

    // Get sample data (first 10 rows with key columns)
    console.log('\n=== SAMPLE DATA (First 10 Rows) ===\n');
    const sampleData = await sequelize.query(`
      SELECT 
        id,
        transaction_ref_number,
        transaction_type,
        transaction_date,
        total_amount,
        product_category_id,
        brand_name_id,
        manufacturer_id,
        model_id,
        color_id,
        store_id,
        customer_id,
        status,
        created_at
      FROM sales_transactions
      ORDER BY created_at DESC
      LIMIT 10;
    `, { type: QueryTypes.SELECT });

    if (sampleData.length > 0) {
      console.log('Sample records:');
      sampleData.forEach((row, index) => {
        console.log(`\n--- Record ${index + 1} ---`);
        console.log(`ID: ${row.id}`);
        console.log(`Transaction Ref: ${row.transaction_ref_number}`);
        console.log(`Type: ${row.transaction_type}`);
        console.log(`Date: ${row.transaction_date}`);
        console.log(`Total Amount: ${row.total_amount}`);
        console.log(`Product Category ID: ${row.product_category_id || 'NULL'}`);
        console.log(`Brand Name ID: ${row.brand_name_id || 'NULL'}`);
        console.log(`Manufacturer ID: ${row.manufacturer_id || 'NULL'}`);
        console.log(`Model ID: ${row.model_id || 'NULL'}`);
        console.log(`Color ID: ${row.color_id || 'NULL'}`);
        console.log(`Store ID: ${row.store_id}`);
        console.log(`Customer ID: ${row.customer_id}`);
        console.log(`Status: ${row.status}`);
        console.log(`Created: ${row.created_at}`);
      });
    } else {
      console.log('No data found in sales_transactions table.');
    }

    // Get product attribute distribution
    console.log('\n=== PRODUCT ATTRIBUTE DISTRIBUTION ===\n');
    const productStats = await sequelize.query(`
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(DISTINCT product_category_id) as unique_categories,
        COUNT(DISTINCT brand_name_id) as unique_brands,
        COUNT(DISTINCT manufacturer_id) as unique_manufacturers,
        COUNT(DISTINCT model_id) as unique_models,
        COUNT(DISTINCT color_id) as unique_colors,
        COUNT(CASE WHEN product_category_id IS NOT NULL THEN 1 END) as has_category,
        COUNT(CASE WHEN brand_name_id IS NOT NULL THEN 1 END) as has_brand,
        COUNT(CASE WHEN manufacturer_id IS NOT NULL THEN 1 END) as has_manufacturer,
        COUNT(CASE WHEN model_id IS NOT NULL THEN 1 END) as has_model,
        COUNT(CASE WHEN color_id IS NOT NULL THEN 1 END) as has_color
      FROM sales_transactions;
    `, { type: QueryTypes.SELECT });

    if (productStats[0]) {
      const stats = productStats[0];
      console.log(`Total Transactions: ${stats.total_transactions}`);
      console.log(`Unique Categories: ${stats.unique_categories}`);
      console.log(`Unique Brands: ${stats.unique_brands}`);
      console.log(`Unique Manufacturers: ${stats.unique_manufacturers}`);
      console.log(`Unique Models: ${stats.unique_models}`);
      console.log(`Unique Colors: ${stats.unique_colors}`);
      console.log(`\nTransactions with attributes:`);
      console.log(`  Has Category: ${stats.has_category}`);
      console.log(`  Has Brand: ${stats.has_brand}`);
      console.log(`  Has Manufacturer: ${stats.has_manufacturer}`);
      console.log(`  Has Model: ${stats.has_model}`);
      console.log(`  Has Color: ${stats.has_color}`);
    }

    // Get transaction reference numbers sample
    console.log('\n=== TRANSACTION REFERENCE NUMBERS (Sample) ===\n');
    const transactionRefs = await sequelize.query(`
      SELECT DISTINCT transaction_ref_number
      FROM sales_transactions
      ORDER BY transaction_ref_number
      LIMIT 10;
    `, { type: QueryTypes.SELECT });

    if (transactionRefs.length > 0) {
      console.log('Sample transaction reference numbers:');
      transactionRefs.forEach((row, index) => {
        console.log(`${index + 1}. ${row.transaction_ref_number}`);
      });
    }

    await sequelize.close();
    console.log('\n=== DONE ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSalesTransactionsTable();

