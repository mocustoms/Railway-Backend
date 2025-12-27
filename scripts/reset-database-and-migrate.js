/**
 * Reset Database and Run Migrations Fresh
 * 
 * This script:
 * 1. Drops all tables (except SequelizeMeta)
 * 2. Drops all ENUM types
 * 3. Clears SequelizeMeta
 * 4. Runs migrations fresh
 * 
 * WARNING: This will DELETE ALL DATA!
 * Use only on fresh/development databases or when you want to start over.
 */

const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');
const path = require('path');
const fs = require('fs');

async function resetAndMigrate() {
  try {
    console.log('\n🔄 Resetting Database and Running Migrations Fresh');
    console.log('='.repeat(60));
    
    // Test database connection
    try {
      await sequelize.authenticate();
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    }
    
    console.log('\n⚠️  WARNING: This will DELETE ALL TABLES AND DATA!');
    console.log('   Proceeding with reset...\n');
    
    // Drop all indexes first (CASCADE on tables should handle this, but let's be explicit)
    console.log('🗑️  Dropping all indexes...');
    try {
      await sequelize.query(`
        DO $$ 
        DECLARE
          r RECORD;
        BEGIN
          FOR r IN (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname != 'SequelizeMeta_pkey') 
          LOOP
            EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(r.indexname) || ' CASCADE;';
          END LOOP;
        END $$;
      `);
      console.log('   ✅ Dropped all indexes');
    } catch (error) {
      console.log(`   ⚠️  Error dropping indexes (continuing anyway):`, error.message);
    }
    
    // Get all table names (excluding SequelizeMeta and system tables)
    const [tables] = await sequelize.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename != 'SequelizeMeta'
      ORDER BY tablename;
    `);
    
    const tableNames = tables.map(t => t.tablename);
    console.log(`📊 Found ${tableNames.length} table(s) to drop`);
    
    if (tableNames.length > 0) {
      console.log('\n🗑️  Dropping tables...');
      // Drop tables in reverse dependency order (drop foreign keys first)
      for (const tableName of tableNames.reverse()) {
        try {
          await sequelize.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
          console.log(`   ✅ Dropped: ${tableName}`);
        } catch (error) {
          console.error(`   ⚠️  Error dropping ${tableName}:`, error.message);
        }
      }
    }
    
    // Get all ENUM types
    const [enums] = await sequelize.query(`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e' 
      AND typname NOT LIKE 'pg_%'
      ORDER BY typname;
    `);
    
    const enumNames = enums.map(e => e.typname);
    console.log(`\n📊 Found ${enumNames.length} ENUM type(s) to drop`);
    
    if (enumNames.length > 0) {
      console.log('\n🗑️  Dropping ENUM types...');
      for (const enumName of enumNames) {
        try {
          await sequelize.query(`DROP TYPE IF EXISTS "${enumName}" CASCADE;`);
          console.log(`   ✅ Dropped: ${enumName}`);
        } catch (error) {
          console.error(`   ⚠️  Error dropping ${enumName}:`, error.message);
        }
      }
    }
    
    // Clear SequelizeMeta
    console.log('\n🗑️  Clearing migration records...');
    try {
      await sequelize.query('TRUNCATE TABLE "SequelizeMeta";');
      console.log('   ✅ Cleared SequelizeMeta');
    } catch (error) {
      // Table might not exist, that's okay
      console.log('   ℹ️  SequelizeMeta table does not exist (will be created by migrations)');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Database Reset Complete!');
    console.log('='.repeat(60));
    console.log('\n🚀 Now running migrations...\n');
    
    // Run migrations (don't close connection - migrations use the same instance)
    let migrationSuccess = false;
    try {
      const { runMigrations } = require('./run-migrations');
      await runMigrations();
      migrationSuccess = true;
      console.log('\n' + '='.repeat(60));
      console.log('✅ Database Reset and Migration Complete!');
      console.log('='.repeat(60));
    } catch (migrationError) {
      console.error('\n⚠️  Migration errors occurred:', migrationError.message);
      console.error('   Some migrations may have failed, but continuing...');
      console.error('   The server will start, but you may need to fix migration issues manually.');
      console.log('='.repeat(60));
      // Don't exit - allow server to start even if migrations have issues
      // The migrations are now idempotent, so partial failures shouldn't break everything
    }
    
    // Close connection after migrations complete (or fail)
    await sequelize.close();
    
    // Exit with success code so server can start
    // Even if migrations had issues, the server should start
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Critical error resetting database:', error.message);
    console.error('   Details:', error);
    // Only exit with error code for critical errors (like database connection)
    process.exit(1);
  }
}

// Run reset
resetAndMigrate();

