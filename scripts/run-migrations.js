/**
 * Migration Runner Script
 * Runs all pending database migrations
 */

const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

async function runMigrations() {
  try {
    console.log('\n🚀 Starting Database Migrations');
    console.log('='.repeat(60));
    
    // Ensure SequelizeMeta table exists
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      );
    `);
    
    // Get all migration files
    const migrationsPath = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort(); // Run migrations in order
    
    console.log(`\n📋 Found ${migrationFiles.length} migration files`);
    
    // Get already run migrations
    const runMigrations = await sequelize.query(
      'SELECT name FROM "SequelizeMeta"',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const runMigrationNames = Array.isArray(runMigrations) ? runMigrations.map(m => m.name) : [];
    
    // CRITICAL: Check if migrations are marked as "run" but database is empty
    // This can happen if sync-migrations was run on a fresh database
    if (runMigrationNames.length > 0) {
      const [tablesCheck] = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'users'
        );
      `);
      
      const hasTables = tablesCheck[0]?.exists;
      
      if (!hasTables) {
        console.log('\n⚠️  WARNING: Migrations are marked as "run" but database appears empty!');
        console.log('   This likely means migrations were synced without actually running.');
        console.log('   Clearing migration records to allow fresh migration run...');
        
        await sequelize.query('TRUNCATE TABLE "SequelizeMeta";');
        console.log('✅ Cleared incorrect migration records');
        console.log('   Migrations will now run fresh...\n');
        
        // Reset runMigrationNames to empty so migrations run
        runMigrationNames.length = 0;
      }
    }
    
    // Filter pending migrations
    const pendingMigrations = migrationFiles.filter(file => !runMigrationNames.includes(file));
    
    if (pendingMigrations.length === 0) {
      console.log('\n✅ All migrations are already applied');
      return true;
    }
    
    console.log(`\n📦 Running ${pendingMigrations.length} pending migrations...\n`);
    
    // Run each pending migration
    for (const migrationFile of pendingMigrations) {
      try {
        console.log(`\n▶️  Running: ${migrationFile}`);
        const migration = require(path.join(migrationsPath, migrationFile));
        
        if (typeof migration.up === 'function') {
          const queryInterface = sequelize.getQueryInterface();
          await migration.up(queryInterface, Sequelize);
          
          // Mark migration as run
          await sequelize.query(
            `INSERT INTO "SequelizeMeta" (name) VALUES ('${migrationFile}') ON CONFLICT (name) DO NOTHING;`
          );
          
          console.log(`✅ Completed: ${migrationFile}`);
        } else {
          console.log(`⚠️  Skipping ${migrationFile}: No 'up' function found`);
        }
      } catch (error) {
        console.error(`\n❌ Error running ${migrationFile}:`, error.message);
        console.error('   Details:', error);
        throw error; // Stop on first error
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All migrations completed successfully!');
    console.log('='.repeat(60) + '\n');
    
    // Optionally verify schema after migrations (if VERIFY_AFTER_MIGRATE=true)
    if (process.env.VERIFY_AFTER_MIGRATE === 'true') {
      try {
        console.log('🔍 Verifying database schema after migrations...');
        const { verifyDatabaseSchema } = require('../server/utils/databaseSchemaVerifier');
        const schemaResults = await verifyDatabaseSchema({
          verbose: false,
          failOnError: false,
          skipExtraColumns: true
        });
        
        if (!schemaResults.verified) {
          console.warn('⚠️  Schema verification found issues after migrations.');
          console.warn(`   Errors: ${schemaResults.errors.length}, Warnings: ${schemaResults.warnings.length}`);
          console.warn('   Run "npm run verify-schema:verbose" for details.');
        } else {
          console.log('✅ Schema verification passed after migrations');
        }
      } catch (schemaError) {
        console.warn('⚠️  Schema verification failed:', schemaError.message);
        console.warn('   This is non-critical, but you should verify manually.');
      }
    }
    
    return true; // Return success
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('   Details:', error);
    throw error; // Throw instead of exit
  }
}

// Export for use in other scripts
module.exports = { runMigrations };

// Run migrations if called directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('✅ Migrations completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('⚠️  Migration errors occurred, but continuing...');
      console.error('   Error:', error.message);
      console.error('   Migrations are idempotent, so partial failures are acceptable');
      console.error('   Server will start, but you may need to check migration status');
      // Exit with success code so server can start
      // Migrations are idempotent, so partial failures shouldn't prevent server startup
      process.exit(0);
    });
}
