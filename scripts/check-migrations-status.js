/**
 * Diagnostic Script: Check Migration Status
 * Compares migration files with SequelizeMeta table
 */

const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');

async function checkMigrationStatus() {
  try {
    console.log('\n🔍 Checking Migration Status');
    console.log('='.repeat(60));
    
    // Get all migration files
    const migrationsPath = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort();
    
    console.log(`\n📋 Found ${migrationFiles.length} migration files in codebase`);
    
    // Test database connection
    try {
      await sequelize.authenticate();
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    }
    
    // Check if SequelizeMeta table exists
    const [tableExists] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SequelizeMeta'
      );
    `);
    
    if (!tableExists[0]?.exists) {
      console.log('\n⚠️  SequelizeMeta table does not exist');
      console.log('   This means no migrations have been run yet.');
      console.log('\n📦 All migrations are pending:');
      migrationFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file}`);
      });
      process.exit(0);
    }
    
    // Get already run migrations
    const runMigrations = await sequelize.query(
      'SELECT name FROM "SequelizeMeta" ORDER BY name',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const runMigrationNames = Array.isArray(runMigrations) 
      ? runMigrations.map(m => m.name) 
      : [];
    
    console.log(`\n📊 Found ${runMigrationNames.length} migrations in SequelizeMeta table`);
    
    // Find missing migrations (in code but not in DB)
    const missingMigrations = migrationFiles.filter(
      file => !runMigrationNames.includes(file)
    );
    
    // Find extra migrations (in DB but not in code - shouldn't happen)
    const extraMigrations = runMigrationNames.filter(
      name => !migrationFiles.includes(name)
    );
    
    // Display results
    console.log('\n' + '='.repeat(60));
    
    if (missingMigrations.length === 0 && extraMigrations.length === 0) {
      console.log('✅ PERFECT MATCH!');
      console.log('   All migration files are recorded in SequelizeMeta');
      console.log('   Your database is up to date with the codebase');
    } else {
      if (missingMigrations.length > 0) {
        console.log(`\n⚠️  ${missingMigrations.length} MISSING MIGRATIONS (not in SequelizeMeta):`);
        missingMigrations.forEach((file, index) => {
          console.log(`   ${index + 1}. ${file}`);
        });
        console.log('\n   Run: npm run migrate');
      }
      
      if (extraMigrations.length > 0) {
        console.log(`\n⚠️  ${extraMigrations.length} EXTRA MIGRATIONS (in DB but not in code):`);
        extraMigrations.forEach((name, index) => {
          console.log(`   ${index + 1}. ${name}`);
        });
        console.log('   These migrations were run but files are missing from codebase');
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📋 Summary:');
    console.log(`   Migration files: ${migrationFiles.length}`);
    console.log(`   Recorded in DB: ${runMigrationNames.length}`);
    console.log(`   Missing: ${missingMigrations.length}`);
    console.log(`   Extra: ${extraMigrations.length}`);
    
    if (missingMigrations.length === 0 && extraMigrations.length === 0) {
      console.log('\n✅ Your local database matches the current migration files!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error checking migration status:', error.message);
    console.error('   Details:', error);
    process.exit(1);
  }
}

// Run check
checkMigrationStatus();

