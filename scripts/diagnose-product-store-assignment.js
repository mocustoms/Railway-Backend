#!/usr/bin/env node

/**
 * Diagnose Product Store Assignment Issue
 * 
 * Compares local vs Railway for product_stores table constraints and tests assignment
 * Usage: node scripts/diagnose-product-store-assignment.js [railway-database-url]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');
const config = require('../env');

// Parse DATABASE_URL
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  
  try {
    let normalizedUrl = databaseUrl.trim();
    if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
    }
    
    normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
    const url = new URL(normalizedUrl);
    
    const databaseName = url.pathname ? url.pathname.slice(1) : '';
    if (!databaseName) {
      throw new Error('Database name not found in DATABASE_URL');
    }
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: databaseName,
      username: url.username || 'postgres',
      password: url.password || ''
    };
  } catch (error) {
    throw new Error(`Failed to parse DATABASE_URL: ${error.message}`);
  }
}

// Get table constraints
async function getTableConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns,
      ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = :tableName
    GROUP BY tc.constraint_name, tc.constraint_type, ccu.table_name
    ORDER BY tc.constraint_type, tc.constraint_name;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return constraints || [];
}

// Get table indexes
async function getTableIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(`
    SELECT
      indexname,
      indexdef,
      indisunique as is_unique
    FROM pg_indexes
    JOIN pg_index ON pg_indexes.indexname = (SELECT relname FROM pg_class WHERE oid = pg_index.indexrelid)
    WHERE schemaname = 'public' 
      AND tablename = :tableName
    ORDER BY indexname;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return indexes || [];
}

// Test creating a ProductStore record
async function testProductStoreCreation(sequelize, testData) {
  try {
    const [result] = await sequelize.query(`
      INSERT INTO product_stores (
        product_id, store_id, is_active, quantity, min_quantity, max_quantity, 
        reorder_point, average_cost, assigned_by, assigned_at, "companyId", created_at, updated_at
      ) VALUES (
        :product_id, :store_id, :is_active, :quantity, :min_quantity, :max_quantity,
        :reorder_point, :average_cost, :assigned_by, :assigned_at, :companyId, NOW(), NOW()
      ) RETURNING id, product_id, store_id, "companyId";
    `, {
      replacements: testData,
      type: sequelize.QueryTypes.SELECT
    });
    
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
}

// Main function
async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Error: Railway DATABASE_URL is required');
    console.error('');
    console.error('Usage: node scripts/diagnose-product-store-assignment.js <railway-database-url>');
    process.exit(1);
  }
  
  // Parse Railway config
  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayDbUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
  
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Product Store Assignment Diagnostic                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Local Database:');
  console.log(`  Host: ${config.DB_HOST}:${config.DB_PORT}`);
  console.log(`  Database: ${config.DB_NAME}`);
  console.log('');
  console.log('Railway Database:');
  console.log(`  Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`  Database: ${railwayConfig.database}`);
  console.log('');
  
  // Create connections
  const localSequelize = require('../config/database');
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  
  try {
    // Test connections
    console.log('🔄 Connecting to databases...');
    await localSequelize.authenticate();
    console.log('✅ Connected to local database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database');
    console.log('');
    
    // Get sample product and store IDs from both databases
    console.log('═'.repeat(80));
    console.log('📊 Getting Sample Data');
    console.log('═'.repeat(80));
    console.log('');
    
    // Local sample data
    const [localProducts] = await localSequelize.query(
      `SELECT id, code, name FROM products LIMIT 1;`,
      { type: localSequelize.QueryTypes.SELECT }
    );
    
    const [localStores] = await localSequelize.query(
      `SELECT id, name FROM stores LIMIT 1;`,
      { type: localSequelize.QueryTypes.SELECT }
    );
    
    const [localCompanies] = await localSequelize.query(
      `SELECT id, name FROM "Company" LIMIT 1;`,
      { type: localSequelize.QueryTypes.SELECT }
    );
    
    // Railway sample data
    const [railwayProducts] = await railwaySequelize.query(
      `SELECT id, code, name FROM products LIMIT 1;`,
      { type: railwaySequelize.QueryTypes.SELECT }
    );
    
    const [railwayStores] = await railwaySequelize.query(
      `SELECT id, name FROM stores LIMIT 1;`,
      { type: railwaySequelize.QueryTypes.SELECT }
    );
    
    const [railwayCompanies] = await railwaySequelize.query(
      `SELECT id, name FROM "Company" LIMIT 1;`,
      { type: railwaySequelize.QueryTypes.SELECT }
    );
    
    console.log('Local Sample Data:');
    console.log(`  Product: ${localProducts?.code || 'N/A'} (${localProducts?.id || 'N/A'})`);
    console.log(`  Store: ${localStores?.name || 'N/A'} (${localStores?.id || 'N/A'})`);
    console.log(`  Company: ${localCompanies?.name || 'N/A'} (${localCompanies?.id || 'N/A'})`);
    console.log('');
    
    console.log('Railway Sample Data:');
    console.log(`  Product: ${railwayProducts?.code || 'N/A'} (${railwayProducts?.id || 'N/A'})`);
    console.log(`  Store: ${railwayStores?.name || 'N/A'} (${railwayStores?.id || 'N/A'})`);
    console.log(`  Company: ${railwayCompanies?.name || 'N/A'} (${railwayCompanies?.id || 'N/A'})`);
    console.log('');
    
    // Compare constraints
    console.log('═'.repeat(80));
    console.log('🔗 Comparing Constraints');
    console.log('═'.repeat(80));
    console.log('');
    
    const localConstraints = await getTableConstraints(localSequelize, 'product_stores');
    const railwayConstraints = await getTableConstraints(railwaySequelize, 'product_stores');
    
    console.log(`Local: ${localConstraints.length} constraints`);
    localConstraints.forEach(c => {
      console.log(`  - ${c.constraint_name} (${c.constraint_type}): [${c.columns}]`);
    });
    console.log('');
    
    console.log(`Railway: ${railwayConstraints.length} constraints`);
    railwayConstraints.forEach(c => {
      console.log(`  - ${c.constraint_name} (${c.constraint_type}): [${c.columns}]`);
    });
    console.log('');
    
    // Compare indexes
    console.log('═'.repeat(80));
    console.log('📑 Comparing Indexes');
    console.log('═'.repeat(80));
    console.log('');
    
    const localIndexes = await getTableIndexes(localSequelize, 'product_stores');
    const railwayIndexes = await getTableIndexes(railwaySequelize, 'product_stores');
    
    console.log(`Local: ${localIndexes.length} indexes`);
    localIndexes.forEach(idx => {
      const unique = idx.is_unique ? 'UNIQUE' : '';
      console.log(`  - ${idx.indexname} ${unique}: ${idx.indexdef.substring(0, 100)}...`);
    });
    console.log('');
    
    console.log(`Railway: ${railwayIndexes.length} indexes`);
    railwayIndexes.forEach(idx => {
      const unique = idx.is_unique ? 'UNIQUE' : '';
      console.log(`  - ${idx.indexname} ${unique}: ${idx.indexdef.substring(0, 100)}...`);
    });
    console.log('');
    
    // Check for the critical unique constraint
    const localUniqueConstraint = localIndexes.find(idx => 
      idx.is_unique && 
      (idx.indexdef.includes('product_id') && idx.indexdef.includes('store_id') && idx.indexdef.includes('companyId'))
    );
    
    const railwayUniqueConstraint = railwayIndexes.find(idx => 
      idx.is_unique && 
      (idx.indexdef.includes('product_id') && idx.indexdef.includes('store_id') && idx.indexdef.includes('companyId'))
    );
    
    console.log('═'.repeat(80));
    console.log('🔍 Critical Unique Constraint Check');
    console.log('═'.repeat(80));
    console.log('');
    
    if (localUniqueConstraint) {
      console.log('✅ Local has composite unique constraint with companyId:');
      console.log(`   ${localUniqueConstraint.indexname}`);
      console.log(`   ${localUniqueConstraint.indexdef}`);
    } else {
      console.log('❌ Local MISSING composite unique constraint with companyId');
    }
    console.log('');
    
    if (railwayUniqueConstraint) {
      console.log('✅ Railway has composite unique constraint with companyId:');
      console.log(`   ${railwayUniqueConstraint.indexname}`);
      console.log(`   ${railwayUniqueConstraint.indexdef}`);
    } else {
      console.log('❌ Railway MISSING composite unique constraint with companyId');
      console.log('');
      console.log('⚠️  This is likely the issue! Railway needs the unique constraint on [product_id, store_id, companyId]');
    }
    console.log('');
    
    // Test assignment if we have sample data
    if (railwayProducts && railwayStores && railwayCompanies) {
      console.log('═'.repeat(80));
      console.log('🧪 Testing ProductStore Creation on Railway');
      console.log('═'.repeat(80));
      console.log('');
      
      // Check if assignment already exists
      const [existing] = await railwaySequelize.query(
        `SELECT id FROM product_stores 
         WHERE product_id = :product_id 
           AND store_id = :store_id 
           AND "companyId" = :companyId;`,
        {
          replacements: {
            product_id: railwayProducts.id,
            store_id: railwayStores.id,
            companyId: railwayCompanies.id
          },
          type: railwaySequelize.QueryTypes.SELECT
        }
      );
      
      if (existing) {
        console.log('⚠️  Test assignment already exists, skipping test insert');
        console.log(`   Existing ID: ${existing.id}`);
      } else {
        console.log('🔄 Attempting test ProductStore creation...');
        
        const testData = {
          product_id: railwayProducts.id,
          store_id: railwayStores.id,
          is_active: true,
          quantity: 0,
          min_quantity: 0,
          max_quantity: 0,
          reorder_point: 0,
          average_cost: 0,
          assigned_by: null,
          assigned_at: new Date(),
          companyId: railwayCompanies.id
        };
        
        const testResult = await testProductStoreCreation(railwaySequelize, testData);
        
        if (testResult.success) {
          console.log('✅ Test ProductStore creation SUCCESSFUL!');
          console.log(`   Created ID: ${testResult.result.id}`);
          console.log(`   Product: ${testResult.result.product_id}`);
          console.log(`   Store: ${testResult.result.store_id}`);
          console.log(`   Company: ${testResult.result.companyId}`);
          
          // Clean up test record
          await railwaySequelize.query(
            `DELETE FROM product_stores WHERE id = :id;`,
            {
              replacements: { id: testResult.result.id },
              type: railwaySequelize.QueryTypes.RAW
            }
          );
          console.log('   Test record cleaned up');
        } else {
          console.log('❌ Test ProductStore creation FAILED!');
          console.log(`   Error: ${testResult.error}`);
          console.log(`   Code: ${testResult.code || 'N/A'}`);
        }
      }
      console.log('');
    }
    
    console.log('═'.repeat(80));
    console.log('✅ Diagnostic Complete!');
    console.log('═'.repeat(80));
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ ERROR:');
    console.error('='.repeat(80));
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    console.error('');
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

// Run
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

