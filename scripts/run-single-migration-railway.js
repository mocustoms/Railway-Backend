/**
 * Run a single migration on Railway database
 * Usage: node scripts/run-single-migration-railway.js [migration-file-name]
 * Example: node scripts/run-single-migration-railway.js 20251121000000-add-withholding-tax-payable-to-linked-accounts-enum.js
 */

const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const config = require('../env');

// Parse database URL helper
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
      throw new Error('Database name not found in DATABASE_URL pathname');
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

async function runMigration() {
  const railwayDbUrl = process.argv[2] || 'postgres://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';
  const migrationFileName = process.argv[3] || '20251121000000-add-withholding-tax-payable-to-linked-accounts-enum.js';
  
  console.log('\n🚀 Running Migration on Railway Database');
  console.log('='.repeat(60));
  console.log(`📋 Migration: ${migrationFileName}\n`);
  
  // Parse Railway database URL
  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
  
  // Create Railway connection
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: console.log,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  
  try {
    // Test connection
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
    
    // Ensure SequelizeMeta table exists
    await railwaySequelize.query(`
      CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      );
    `);
    
    // Check if migration already ran
    const [runMigrations] = await railwaySequelize.query(
      `SELECT name FROM "SequelizeMeta" WHERE name = :migrationName`,
      {
        replacements: { migrationName: migrationFileName },
        type: Sequelize.QueryTypes.SELECT
      }
    );
    
    if (Array.isArray(runMigrations) && runMigrations.length > 0) {
      console.log(`⚠️  Migration ${migrationFileName} has already been run.`);
      console.log('   Skipping...');
      return;
    }
    
    // Load migration file
    const migrationsPath = path.join(__dirname, '../migrations');
    const migrationPath = path.join(migrationsPath, migrationFileName);
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    console.log(`📂 Loading migration from: ${migrationPath}`);
    const migration = require(migrationPath);
    
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration ${migrationFileName} does not have an 'up' function`);
    }
    
    // Run migration
    console.log(`\n▶️  Running migration: ${migrationFileName}`);
    const queryInterface = railwaySequelize.getQueryInterface();
    await migration.up(queryInterface, Sequelize);
    
    // Mark migration as run
    await railwaySequelize.query(
      `INSERT INTO "SequelizeMeta" (name) VALUES (:migrationName) ON CONFLICT (name) DO NOTHING;`,
      {
        replacements: { migrationName: migrationFileName }
      }
    );
    
    console.log(`\n✅ Successfully completed migration: ${migrationFileName}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error running migration:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    throw error;
  } finally {
    await railwaySequelize.close();
  }
}

runMigration().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
