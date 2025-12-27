#!/usr/bin/env node

/**
 * Add can_sale_products column to stores table in Railway
 */

require('dotenv').config();
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function addCanSaleProductsColumn() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔄 Adding can_sale_products column to stores table in Railway\n');
    console.log('='.repeat(80));
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Check if column already exists
    const columnExists = await railwaySequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'stores'
        AND column_name = 'can_sale_products'
      );
    `, { type: require('sequelize').QueryTypes.SELECT });

    const exists = Array.isArray(columnExists) && columnExists.length > 0 
      ? (Array.isArray(columnExists[0]) ? columnExists[0][0] : columnExists[0]).exists
      : columnExists.exists;

    if (exists) {
      console.log('✅ Column can_sale_products already exists in Railway database');
      return;
    }

    // Add the column
    console.log('📝 Adding can_sale_products column...');
    await railwaySequelize.query(`
      ALTER TABLE "stores" 
      ADD COLUMN "can_sale_products" BOOLEAN 
      NOT NULL 
      DEFAULT false;
    `);

    // Add comment to the column
    await railwaySequelize.query(`
      COMMENT ON COLUMN "stores"."can_sale_products" IS 'Can sale products';
    `);

    console.log('✅ Successfully added can_sale_products column to stores table');
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

addCanSaleProductsColumn().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

