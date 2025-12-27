#!/usr/bin/env node

/**
 * Add product_id column to sales_transactions table in Railway
 */

require('dotenv').config();
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function addProductIdColumn() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔄 Adding product_id column to sales_transactions in Railway\n');
    console.log('='.repeat(80));
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Check if column already exists
    const columnExists = await railwaySequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'sales_transactions'
        AND column_name = 'product_id'
      );
    `, { type: require('sequelize').QueryTypes.SELECT });

    const exists = Array.isArray(columnExists) && columnExists.length > 0 
      ? (Array.isArray(columnExists[0]) ? columnExists[0][0] : columnExists[0]).exists
      : columnExists.exists;

    if (exists) {
      console.log('✅ Column product_id already exists in Railway database');
      return;
    }

    // Add the column
    console.log('📝 Adding product_id column...');
    await railwaySequelize.query(`
      ALTER TABLE "sales_transactions" 
      ADD COLUMN "product_id" UUID 
      REFERENCES "products"("id") 
      ON UPDATE CASCADE 
      ON DELETE SET NULL;
    `);

    console.log('✅ Successfully added product_id column to sales_transactions');
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

addProductIdColumn().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

