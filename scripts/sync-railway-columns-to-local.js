#!/usr/bin/env node

/**
 * Sync Railway Database Columns to Match Local Database
 * 
 * Updates Railway database columns to match local database:
 * 1. Convert timestamp columns to timestamptz
 * 2. Make nullable columns NOT NULL
 * 3. Convert VARCHAR columns to ENUMs
 * 4. Update character length constraints
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(
    `SELECT 
      column_name, 
      data_type, 
      udt_name,
      is_nullable, 
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = :tableName
     ORDER BY ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

async function columnExists(sequelize, tableName, columnName) {
  const result = await sequelize.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = :tableName
      AND column_name = :columnName
    );
  `, {
    replacements: { tableName, columnName },
    type: QueryTypes.SELECT
  });
  return Array.isArray(result) && result.length > 0 && result[0].exists;
}

async function enumExists(sequelize, enumName) {
  const result = await sequelize.query(`
    SELECT EXISTS (
      SELECT FROM pg_type WHERE typname = :enumName
    );
  `, {
    replacements: { enumName },
    type: QueryTypes.SELECT
  });
  return Array.isArray(result) && result.length > 0 && result[0].exists;
}

async function syncRailwayToLocal() {
  const railwayDbUrl = process.argv[2];
  if (!railwayDbUrl) {
    console.error('❌ Please provide Railway database URL as argument');
    console.log('Usage: node scripts/sync-railway-columns-to-local.js <RAILWAY_DB_URL>');
    process.exit(1);
  }

  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔄 SYNCING RAILWAY COLUMNS TO MATCH LOCAL DATABASE\n');
    console.log('='.repeat(80));
    
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // 1. Convert timestamp columns to timestamptz
    console.log('📅 Converting timestamp columns to timestamptz...\n');
    
    const timestampColumns = [
      { table: 'auto_codes', columns: ['last_used', 'created_at', 'updated_at'] },
      { table: 'loyalty_card_configs', columns: ['created_at', 'updated_at'] },
      { table: 'price_categories', columns: ['scheduled_date'] },
      { table: 'product_dosages', columns: ['created_at', 'updated_at'] },
      { table: 'product_expiry_dates', columns: ['expiry_date', 'purchase_date', 'manufacturing_date', 'created_at', 'updated_at'] },
      { table: 'product_manufacturing_info', columns: ['created_at', 'updated_at'] },
      { table: 'product_pharmaceutical_info', columns: ['created_at', 'updated_at'] },
      { table: 'product_raw_materials', columns: ['created_at', 'updated_at'] },
      { table: 'product_serial_numbers', columns: ['purchase_date', 'warranty_expiry_date', 'created_at', 'updated_at'] },
      { table: 'product_stores', columns: ['assigned_at', 'created_at', 'updated_at', 'last_updated'] },
      { table: 'product_transactions', columns: ['system_date', 'transaction_date', 'expiry_date', 'created_at', 'updated_at'] },
      { table: 'stock_adjustments', columns: ['submitted_at', 'approved_at', 'created_at', 'updated_at'] },
      { table: 'stock_adjustment_items', columns: ['created_at', 'updated_at'] },
      { table: 'store_request_item_transactions', columns: ['performed_at', 'created_at'] }
    ];

    for (const { table, columns } of timestampColumns) {
      for (const column of columns) {
        const exists = await columnExists(railwaySequelize, table, column);
        if (exists) {
          try {
            // Check current type
            const localCols = await getTableColumns(localSequelize, table);
            const railwayCols = await getTableColumns(railwaySequelize, table);
            
            const localCol = localCols.find(c => c.column_name === column);
            const railwayCol = railwayCols.find(c => c.column_name === column);
            
            if (localCol && railwayCol && 
                localCol.data_type === 'timestamp with time zone' && 
                railwayCol.data_type === 'timestamp without time zone') {
              await railwaySequelize.query(`
                ALTER TABLE "${table}"
                ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE
                USING "${column}"::TIMESTAMP WITH TIME ZONE;
              `);
              console.log(`✅ Updated ${table}.${column} to timestamptz`);
            }
          } catch (error) {
            console.log(`⚠️  Could not update ${table}.${column}: ${error.message}`);
          }
        }
      }
    }

    // 2. Make nullable columns NOT NULL
    console.log('\n🔒 Making columns NOT NULL...\n');
    
    const notNullColumns = [
      { table: 'auto_codes', columns: ['created_at', 'updated_at'] },
      { table: 'customer_groups', columns: ['updated_at'] },
      { table: 'loyalty_card_configs', columns: ['updated_at'] },
      { table: 'physical_inventories', columns: ['created_at', 'updated_at'] },
      { table: 'physical_inventory_items', columns: ['created_at', 'updated_at'] },
      { table: 'product_stores', columns: ['created_at', 'updated_at'] },
      { table: 'stock_adjustment_items', columns: ['created_at', 'updated_at'] },
      { table: 'stock_adjustments', columns: ['created_at', 'updated_at'] }
    ];

    for (const { table, columns } of notNullColumns) {
      for (const column of columns) {
        const exists = await columnExists(railwaySequelize, table, column);
        if (exists) {
          try {
            const localCols = await getTableColumns(localSequelize, table);
            const railwayCols = await getTableColumns(railwaySequelize, table);
            
            const localCol = localCols.find(c => c.column_name === column);
            const railwayCol = railwayCols.find(c => c.column_name === column);
            
            if (localCol && railwayCol && 
                localCol.is_nullable === 'NO' && 
                railwayCol.is_nullable === 'YES') {
              // First, update any NULL values
              await railwaySequelize.query(`
                UPDATE "${table}"
                SET "${column}" = CURRENT_TIMESTAMP
                WHERE "${column}" IS NULL;
              `);
              
              // Then make it NOT NULL
              await railwaySequelize.query(`
                ALTER TABLE "${table}"
                ALTER COLUMN "${column}" SET NOT NULL;
              `);
              console.log(`✅ Made ${table}.${column} NOT NULL`);
            }
          } catch (error) {
            console.log(`⚠️  Could not make ${table}.${column} NOT NULL: ${error.message}`);
          }
        }
      }
    }

    // 3. Convert VARCHAR columns to ENUMs
    console.log('\n📝 Converting VARCHAR columns to ENUMs...\n');

    // physical_inventories.status
    const physicalInventoryStatusExists = await columnExists(railwaySequelize, 'physical_inventories', 'status');
    if (physicalInventoryStatusExists) {
      try {
        const localCols = await getTableColumns(localSequelize, 'physical_inventories');
        const railwayCols = await getTableColumns(railwaySequelize, 'physical_inventories');
        
        const localCol = localCols.find(c => c.column_name === 'status');
        const railwayCol = railwayCols.find(c => c.column_name === 'status');
        
        if (localCol && railwayCol && 
            localCol.data_type === 'USER-DEFINED' && 
            railwayCol.data_type === 'character varying') {
          const enumName = 'enum_physical_inventories_status';
          const enumValues = ['draft', 'submitted', 'approved', 'rejected', 'returned_for_correction'];
          
          // Create ENUM if it doesn't exist
          const exists = await enumExists(railwaySequelize, enumName);
          if (!exists) {
            await railwaySequelize.query(`
              CREATE TYPE ${enumName} AS ENUM (${enumValues.map(v => `'${v}'`).join(', ')});
            `);
            console.log(`✅ Created ENUM type: ${enumName}`);
          }
          
          // Drop default if exists
          await railwaySequelize.query(`
            ALTER TABLE "physical_inventories"
            ALTER COLUMN "status" DROP DEFAULT;
          `).catch(() => {}); // Ignore if no default
          
          // Convert column type
          await railwaySequelize.query(`
            ALTER TABLE "physical_inventories"
            ALTER COLUMN "status" TYPE ${enumName}
            USING "status"::text::${enumName};
          `);
          
          // Restore default
          await railwaySequelize.query(`
            ALTER TABLE "physical_inventories"
            ALTER COLUMN "status" SET DEFAULT 'draft'::${enumName};
          `);
          
          console.log('✅ Converted physical_inventories.status to ENUM');
        }
      } catch (error) {
        console.log(`⚠️  Could not convert physical_inventories.status: ${error.message}`);
      }
    }

    // price_categories.price_change_type
    const priceChangeTypeExists = await columnExists(railwaySequelize, 'price_categories', 'price_change_type');
    if (priceChangeTypeExists) {
      try {
        const localCols = await getTableColumns(localSequelize, 'price_categories');
        const railwayCols = await getTableColumns(railwaySequelize, 'price_categories');
        
        const localCol = localCols.find(c => c.column_name === 'price_change_type');
        const railwayCol = railwayCols.find(c => c.column_name === 'price_change_type');
        
        if (localCol && railwayCol && 
            localCol.data_type === 'USER-DEFINED' && 
            railwayCol.data_type === 'character varying') {
          const enumName = 'enum_price_categories_price_change_type';
          const enumValues = ['increase', 'decrease'];
          
          const exists = await enumExists(railwaySequelize, enumName);
          if (!exists) {
            await railwaySequelize.query(`
              CREATE TYPE ${enumName} AS ENUM (${enumValues.map(v => `'${v}'`).join(', ')});
            `);
            console.log(`✅ Created ENUM type: ${enumName}`);
          }
          
          await railwaySequelize.query(`
            ALTER TABLE "price_categories"
            ALTER COLUMN "price_change_type" DROP DEFAULT;
          `).catch(() => {});
          
          await railwaySequelize.query(`
            ALTER TABLE "price_categories"
            ALTER COLUMN "price_change_type" TYPE ${enumName}
            USING "price_change_type"::text::${enumName};
          `);
          
          await railwaySequelize.query(`
            ALTER TABLE "price_categories"
            ALTER COLUMN "price_change_type" SET DEFAULT 'increase'::${enumName};
          `);
          
          console.log('✅ Converted price_categories.price_change_type to ENUM');
        }
      } catch (error) {
        console.log(`⚠️  Could not convert price_categories.price_change_type: ${error.message}`);
      }
    }

    // price_categories.scheduled_type
    const scheduledTypeExists = await columnExists(railwaySequelize, 'price_categories', 'scheduled_type');
    if (scheduledTypeExists) {
      try {
        const localCols = await getTableColumns(localSequelize, 'price_categories');
        const railwayCols = await getTableColumns(railwaySequelize, 'price_categories');
        
        const localCol = localCols.find(c => c.column_name === 'scheduled_type');
        const railwayCol = railwayCols.find(c => c.column_name === 'scheduled_type');
        
        if (localCol && railwayCol && 
            localCol.data_type === 'USER-DEFINED' && 
            railwayCol.data_type === 'character varying') {
          const enumName = 'enum_price_categories_scheduled_type';
          const enumValues = ['not_scheduled', 'scheduled', 'recurring'];
          
          const exists = await enumExists(railwaySequelize, enumName);
          if (!exists) {
            await railwaySequelize.query(`
              CREATE TYPE ${enumName} AS ENUM (${enumValues.map(v => `'${v}'`).join(', ')});
            `);
            console.log(`✅ Created ENUM type: ${enumName}`);
          }
          
          await railwaySequelize.query(`
            ALTER TABLE "price_categories"
            ALTER COLUMN "scheduled_type" DROP DEFAULT;
          `).catch(() => {});
          
          await railwaySequelize.query(`
            ALTER TABLE "price_categories"
            ALTER COLUMN "scheduled_type" TYPE ${enumName}
            USING "scheduled_type"::text::${enumName};
          `);
          
          await railwaySequelize.query(`
            ALTER TABLE "price_categories"
            ALTER COLUMN "scheduled_type" SET DEFAULT 'not_scheduled'::${enumName};
          `);
          
          console.log('✅ Converted price_categories.scheduled_type to ENUM');
        }
      } catch (error) {
        console.log(`⚠️  Could not convert price_categories.scheduled_type: ${error.message}`);
      }
    }

    // store_request_item_transactions.transaction_type
    const transactionTypeExists = await columnExists(railwaySequelize, 'store_request_item_transactions', 'transaction_type');
    if (transactionTypeExists) {
      try {
        const localCols = await getTableColumns(localSequelize, 'store_request_item_transactions');
        const railwayCols = await getTableColumns(railwaySequelize, 'store_request_item_transactions');
        
        const localCol = localCols.find(c => c.column_name === 'transaction_type');
        const railwayCol = railwayCols.find(c => c.column_name === 'transaction_type');
        
        if (localCol && railwayCol && 
            localCol.data_type === 'USER-DEFINED' && 
            railwayCol.data_type === 'character varying') {
          // Get existing values from Railway
          const valuesResult = await railwaySequelize.query(`
            SELECT DISTINCT "transaction_type" FROM "store_request_item_transactions"
            WHERE "transaction_type" IS NOT NULL;
          `, { type: QueryTypes.SELECT });
          
          const values = Array.isArray(valuesResult) && valuesResult.length > 0 && Array.isArray(valuesResult[0])
            ? valuesResult[0]
            : valuesResult;
          
          const enumValues = values.map(v => v.transaction_type).filter(Boolean);
          const finalEnumValues = enumValues.length > 0 
            ? enumValues 
            : ['request', 'issue', 'receipt', 'transfer', 'adjustment'];
          
          const enumName = 'enum_store_request_item_transactions_transaction_type';
          
          const exists = await enumExists(railwaySequelize, enumName);
          if (!exists) {
            await railwaySequelize.query(`
              CREATE TYPE ${enumName} AS ENUM (${finalEnumValues.map(v => `'${v}'`).join(', ')});
            `);
            console.log(`✅ Created ENUM type: ${enumName}`);
          }
          
          await railwaySequelize.query(`
            ALTER TABLE "store_request_item_transactions"
            ALTER COLUMN "transaction_type" DROP DEFAULT;
          `).catch(() => {});
          
          await railwaySequelize.query(`
            ALTER TABLE "store_request_item_transactions"
            ALTER COLUMN "transaction_type" TYPE ${enumName}
            USING "transaction_type"::text::${enumName};
          `);
          
          console.log('✅ Converted store_request_item_transactions.transaction_type to ENUM');
        }
      } catch (error) {
        console.log(`⚠️  Could not convert store_request_item_transactions.transaction_type: ${error.message}`);
      }
    }

    // 4. Update character length constraints
    console.log('\n📏 Updating character length constraints...\n');

    const locationCodeExists = await columnExists(railwaySequelize, 'product_store_locations', 'location_code');
    if (locationCodeExists) {
      try {
        const localCols = await getTableColumns(localSequelize, 'product_store_locations');
        const railwayCols = await getTableColumns(railwaySequelize, 'product_store_locations');
        
        const localCol = localCols.find(c => c.column_name === 'location_code');
        const railwayCol = railwayCols.find(c => c.column_name === 'location_code');
        
        if (localCol && railwayCol && 
            localCol.character_maximum_length === 255 && 
            railwayCol.character_maximum_length !== 255) {
          await railwaySequelize.query(`
            ALTER TABLE "product_store_locations"
            ALTER COLUMN "location_code" TYPE VARCHAR(255);
          `);
          console.log('✅ Updated product_store_locations.location_code to VARCHAR(255)');
        }
      } catch (error) {
        console.log(`⚠️  Could not update product_store_locations.location_code: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Railway database columns synced successfully!');
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

syncRailwayToLocal().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

