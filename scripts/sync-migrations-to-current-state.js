/**
 * Sync Migrations to Current Database State
 * 
 * This script updates SequelizeMeta to match the current migration files.
 * Since the database structure is already correct, we just need to mark
 * all current migration files as "run" in SequelizeMeta.
 * 
 * Designed to run on Railway and local environments.
 * Handles DATABASE_URL and individual DB environment variables.
 */

const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');

async function syncMigrations() {
  try {
    console.log('\n🔄 Syncing Migrations to Current Database State');
    console.log('='.repeat(60));
    
    // Test database connection with retry logic for Railway
    let connected = false;
    let retries = 3;
    while (!connected && retries > 0) {
      try {
        await sequelize.authenticate();
        console.log('✅ Database connection successful');
        connected = true;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error('❌ Database connection failed after retries:', error.message);
          // On Railway (detected by DATABASE_URL), don't exit with error - migrations will handle it
          if (process.env.DATABASE_URL || process.env.RAILWAY_ENVIRONMENT_NAME) {
            console.log('⚠️  Running in Railway - continuing anyway (migrations will handle connection)');
            return; // Exit gracefully, don't block deployment
          } else {
            process.exit(1);
          }
        } else {
          console.log(`⚠️  Database connection failed, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        }
      }
    }
    
    // Ensure SequelizeMeta table exists
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      );
    `);
    console.log('✅ SequelizeMeta table verified');
    
    // CRITICAL: Check if database has actual tables before syncing
    // This prevents marking migrations as "run" on fresh/empty databases
    const [tablesCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    const hasTables = tablesCheck[0]?.exists;
    
    if (!hasTables) {
      console.log('\n⚠️  Database appears to be empty (no users table found)');
      console.log('   This sync script should only be used when the database structure already exists.');
      console.log('   Skipping sync - migrations will run normally.');
      console.log('   If this is a fresh database, migrations will create all tables.');
      return; // Exit without syncing
    }
    
    console.log('✅ Database has existing tables - safe to sync migrations');
    
    // Get all migration files from codebase
    const migrationsPath = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort();
    
    console.log(`\n📋 Found ${migrationFiles.length} migration files in codebase`);
    
    // Get already run migrations
    const runMigrations = await sequelize.query(
      'SELECT name FROM "SequelizeMeta"',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const runMigrationNames = Array.isArray(runMigrations) 
      ? runMigrations.map(m => m.name) 
      : [];
    
    console.log(`📊 Found ${runMigrationNames.length} migrations already recorded in SequelizeMeta`);
    
    // Find migrations that need to be added
    const migrationsToAdd = migrationFiles.filter(
      file => !runMigrationNames.includes(file)
    );
    
    if (migrationsToAdd.length === 0) {
      console.log('\n✅ All current migration files are already recorded in SequelizeMeta');
      console.log('   No sync needed!');
      return; // Exit successfully
    }
    
    console.log(`\n📦 Adding ${migrationsToAdd.length} migration(s) to SequelizeMeta:`);
    
    // Add each missing migration to SequelizeMeta
    for (const migrationFile of migrationsToAdd) {
      try {
        // Use parameterized query to prevent SQL injection
        await sequelize.query(
          `INSERT INTO "SequelizeMeta" (name) VALUES (:name) ON CONFLICT (name) DO NOTHING;`,
          {
            replacements: { name: migrationFile },
            type: Sequelize.QueryTypes.INSERT
          }
        );
        console.log(`   ✅ Added: ${migrationFile}`);
      } catch (error) {
        console.error(`   ❌ Failed to add ${migrationFile}:`, error.message);
        // Continue with other migrations even if one fails
      }
    }
    
    // Verify final state
    const finalRunMigrations = await sequelize.query(
      'SELECT name FROM "SequelizeMeta" ORDER BY name',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const finalRunMigrationNames = Array.isArray(finalRunMigrations) 
      ? finalRunMigrations.map(m => m.name) 
      : [];
    
    // Check which migration files are now recorded
    const recordedFiles = migrationFiles.filter(
      file => finalRunMigrationNames.includes(file)
    );
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Sync Complete!');
    console.log('='.repeat(60));
    console.log(`\n📋 Summary:`);
    console.log(`   Migration files in codebase: ${migrationFiles.length}`);
    console.log(`   Migration files now recorded: ${recordedFiles.length}`);
    console.log(`   Total migrations in SequelizeMeta: ${finalRunMigrationNames.length}`);
    
    if (recordedFiles.length === migrationFiles.length) {
      console.log('\n✅ Perfect! All current migration files are now recorded.');
      console.log('   Your SequelizeMeta matches your current migration files.');
      console.log('   The database structure is already correct, so no migrations need to run.');
    } else {
      console.log('\n⚠️  Some migration files are still not recorded.');
      const stillMissing = migrationFiles.filter(
        file => !finalRunMigrationNames.includes(file)
      );
      console.log('   Missing:', stillMissing.join(', '));
    }
    
    // Close database connection
    await sequelize.close();
  } catch (error) {
    console.error('\n❌ Error syncing migrations:', error.message);
    console.error('   Details:', error);
    // On Railway (detected by DATABASE_URL), don't exit with error - let migrations handle it
    if (!process.env.DATABASE_URL && !process.env.RAILWAY_ENVIRONMENT_NAME) {
      process.exit(1);
    }
  }
}

// Run sync
syncMigrations();

