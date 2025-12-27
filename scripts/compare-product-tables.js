#!/usr/bin/env node

/**
 * Compare Product Stores and Product Catalog between Local and Railway
 * 
 * Usage: node scripts/compare-product-tables.js [railway-database-url]
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

// Get table schema
async function getTableSchema(sequelize, tableName) {
  const columns = await sequelize.query(`
    SELECT 
      column_name,
      data_type,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      is_nullable,
      column_default,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = :tableName
    ORDER BY ordinal_position;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return columns || [];
}

// Get table constraints
async function getTableConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = :tableName
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
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' 
      AND tablename = :tableName
    ORDER BY indexname;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return indexes || [];
}

// Get row count and sample data
async function getTableStats(sequelize, tableName) {
  const countResult = await sequelize.query(
    `SELECT COUNT(*) as count FROM "${tableName}";`,
    { type: sequelize.QueryTypes.SELECT }
  );
  
  const count = parseInt(countResult[0]?.count || 0);
  
  // Get sample rows (first 5)
  let sampleRows = [];
  if (count > 0) {
    sampleRows = await sequelize.query(
      `SELECT * FROM "${tableName}" LIMIT 5;`,
      { type: sequelize.QueryTypes.SELECT }
    );
  }
  
  return { count, sampleRows: sampleRows || [] };
}

// Compare schemas
function compareSchemas(localSchema, railwaySchema, tableName) {
  const differences = {
    missingInRailway: [],
    missingInLocal: [],
    typeDifferences: [],
    nullableDifferences: [],
    defaultDifferences: []
  };
  
  const localColumns = new Map(localSchema.map(col => [col.column_name, col]));
  const railwayColumns = new Map(railwaySchema.map(col => [col.column_name, col]));
  
  // Check columns in local but not in Railway
  for (const [colName, col] of localColumns) {
    if (!railwayColumns.has(colName)) {
      differences.missingInRailway.push({
        column: colName,
        type: col.data_type,
        nullable: col.is_nullable
      });
    } else {
      // Compare column properties
      const railwayCol = railwayColumns.get(colName);
      
      // Type comparison
      if (col.data_type !== railwayCol.data_type || 
          col.udt_name !== railwayCol.udt_name) {
        differences.typeDifferences.push({
          column: colName,
          local: `${col.data_type} (${col.udt_name})`,
          railway: `${railwayCol.data_type} (${railwayCol.udt_name})`
        });
      }
      
      // Nullable comparison
      if (col.is_nullable !== railwayCol.is_nullable) {
        differences.nullableDifferences.push({
          column: colName,
          local: col.is_nullable,
          railway: railwayCol.is_nullable
        });
      }
      
      // Default comparison
      if (col.column_default !== railwayCol.column_default) {
        differences.defaultDifferences.push({
          column: colName,
          local: col.column_default || 'NULL',
          railway: railwayCol.column_default || 'NULL'
        });
      }
    }
  }
  
  // Check columns in Railway but not in local
  for (const [colName, col] of railwayColumns) {
    if (!localColumns.has(colName)) {
      differences.missingInLocal.push({
        column: colName,
        type: col.data_type,
        nullable: col.is_nullable
      });
    }
  }
  
  return differences;
}

// Main function
async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Error: Railway DATABASE_URL is required');
    console.error('');
    console.error('Usage: node scripts/compare-product-tables.js <railway-database-url>');
    console.error('   Or set RAILWAY_DATABASE_URL environment variable');
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
  console.log('║  Product Stores & Product Catalog Comparison                  ║');
  console.log('║  Local vs Railway Database                                    ║');
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
    
    // Tables to compare
    const tables = [
      { name: 'product_stores', displayName: 'Product Stores' },
      { name: 'products', displayName: 'Products (Product Catalog)' }
    ];
    
    for (const table of tables) {
      console.log('═'.repeat(80));
      console.log(`📊 Comparing: ${table.displayName} (${table.name})`);
      console.log('═'.repeat(80));
      console.log('');
      
      // Get schemas
      console.log('📋 Comparing Schema...');
      const localSchema = await getTableSchema(localSequelize, table.name);
      const railwaySchema = await getTableSchema(railwaySequelize, table.name);
      
      console.log(`   Local: ${localSchema.length} columns`);
      console.log(`   Railway: ${railwaySchema.length} columns`);
      console.log('');
      
      // Compare schemas
      const schemaDiff = compareSchemas(localSchema, railwaySchema, table.name);
      
      if (schemaDiff.missingInRailway.length > 0) {
        console.log('❌ Columns missing in Railway:');
        schemaDiff.missingInRailway.forEach(col => {
          console.log(`   - ${col.column} (${col.type}, nullable: ${col.nullable})`);
        });
        console.log('');
      }
      
      if (schemaDiff.missingInLocal.length > 0) {
        console.log('⚠️  Columns in Railway but not in Local:');
        schemaDiff.missingInLocal.forEach(col => {
          console.log(`   - ${col.column} (${col.type}, nullable: ${col.nullable})`);
        });
        console.log('');
      }
      
      if (schemaDiff.typeDifferences.length > 0) {
        console.log('⚠️  Type differences:');
        schemaDiff.typeDifferences.forEach(diff => {
          console.log(`   - ${diff.column}: Local=${diff.local}, Railway=${diff.railway}`);
        });
        console.log('');
      }
      
      if (schemaDiff.nullableDifferences.length > 0) {
        console.log('⚠️  Nullable differences:');
        schemaDiff.nullableDifferences.forEach(diff => {
          console.log(`   - ${diff.column}: Local=${diff.local}, Railway=${diff.railway}`);
        });
        console.log('');
      }
      
      if (schemaDiff.missingInRailway.length === 0 && 
          schemaDiff.missingInLocal.length === 0 && 
          schemaDiff.typeDifferences.length === 0 &&
          schemaDiff.nullableDifferences.length === 0) {
        console.log('✅ Schema matches perfectly!');
        console.log('');
      }
      
      // Get constraints
      console.log('🔗 Comparing Constraints...');
      const localConstraints = await getTableConstraints(localSequelize, table.name);
      const railwayConstraints = await getTableConstraints(railwaySequelize, table.name);
      
      console.log(`   Local: ${localConstraints.length} constraints`);
      console.log(`   Railway: ${railwayConstraints.length} constraints`);
      
      if (localConstraints.length !== railwayConstraints.length) {
        console.log('⚠️  Constraint count mismatch');
      }
      console.log('');
      
      // Get indexes
      console.log('📑 Comparing Indexes...');
      const localIndexes = await getTableIndexes(localSequelize, table.name);
      const railwayIndexes = await getTableIndexes(railwaySequelize, table.name);
      
      console.log(`   Local: ${localIndexes.length} indexes`);
      console.log(`   Railway: ${railwayIndexes.length} indexes`);
      
      if (localIndexes.length !== railwayIndexes.length) {
        console.log('⚠️  Index count mismatch');
        console.log('   Local indexes:', localIndexes.map(i => i.indexname).join(', '));
        console.log('   Railway indexes:', railwayIndexes.map(i => i.indexname).join(', '));
      }
      console.log('');
      
      // Get data stats
      console.log('📊 Comparing Data...');
      const localStats = await getTableStats(localSequelize, table.name);
      const railwayStats = await getTableStats(railwaySequelize, table.name);
      
      console.log(`   Local: ${localStats.count} rows`);
      console.log(`   Railway: ${railwayStats.count} rows`);
      
      if (localStats.count !== railwayStats.count) {
        const diff = localStats.count - railwayStats.count;
        console.log(`   ⚠️  Row count difference: ${diff > 0 ? '+' : ''}${diff}`);
      } else {
        console.log('   ✅ Row counts match');
      }
      console.log('');
      
      // Show sample data comparison
      if (localStats.count > 0 || railwayStats.count > 0) {
        console.log('📝 Sample Data (first 3 rows):');
        console.log('');
        
        if (localStats.count > 0) {
          console.log('   Local:');
          localStats.sampleRows.slice(0, 3).forEach((row, idx) => {
            const keys = Object.keys(row).slice(0, 5); // Show first 5 columns
            const preview = keys.map(k => `${k}: ${row[k]}`).join(', ');
            console.log(`     Row ${idx + 1}: ${preview}${keys.length < Object.keys(row).length ? '...' : ''}`);
          });
        } else {
          console.log('   Local: (empty)');
        }
        
        console.log('');
        
        if (railwayStats.count > 0) {
          console.log('   Railway:');
          railwayStats.sampleRows.slice(0, 3).forEach((row, idx) => {
            const keys = Object.keys(row).slice(0, 5); // Show first 5 columns
            const preview = keys.map(k => `${k}: ${row[k]}`).join(', ');
            console.log(`     Row ${idx + 1}: ${preview}${keys.length < Object.keys(row).length ? '...' : ''}`);
          });
        } else {
          console.log('   Railway: (empty)');
        }
        console.log('');
      }
      
      console.log('');
    }
    
    console.log('═'.repeat(80));
    console.log('✅ Comparison Complete!');
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

