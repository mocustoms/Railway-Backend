#!/usr/bin/env node

/**
 * Check Railway Migration Status
 * 
 * Checks which migrations have been run on Railway vs which exist in codebase
 * Usage: node scripts/check-railway-migrations.js [railway-database-url]
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

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

async function main() {
  // Get Railway database URL
  let railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

  if (!railwayDbUrl) {
    console.log('');
    console.log('⚠️  Railway DATABASE_URL not provided');
    console.log('');
    console.log('You can provide it in one of these ways:');
    console.log('  1. As command argument: node scripts/check-railway-migrations.js <database-url>');
    console.log('  2. As environment variable: RAILWAY_DATABASE_URL=... node scripts/check-railway-migrations.js');
    console.log('');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    railwayDbUrl = await new Promise((resolve) => {
      rl.question('Enter Railway DATABASE_URL (or press Ctrl+C to cancel): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
    
    if (!railwayDbUrl) {
      console.error('❌ DATABASE_URL is required');
      process.exit(1);
    }
  }

  // Parse Railway database config
  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayDbUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }

  console.log('');
  console.log('🔍 CHECKING RAILWAY MIGRATION STATUS');
  console.log('='.repeat(80));
  console.log(`Railway Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`Railway Database: ${railwayConfig.database}`);
  console.log(`Railway User: ${railwayConfig.username}`);
  console.log('');

  // Create Sequelize connection to Railway
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false, // Suppress SQL logs for cleaner output
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Railway uses self-signed certificates
      }
    }
  });

  try {
    // Test connection
    console.log('🔄 Connecting to Railway database...');
    await railwaySequelize.authenticate();
    console.log('✅ Connected successfully');
    console.log('');

    // Get all migration files from codebase
    const migrationsPath = path.join(__dirname, '../migrations');
    if (!fs.existsSync(migrationsPath)) {
      throw new Error(`Migrations directory not found: ${migrationsPath}`);
    }

    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort(); // Sort migrations in order
    
    console.log(`📋 Found ${migrationFiles.length} migration files in codebase:`);
    migrationFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file}`);
    });
    console.log('');

    // Check if SequelizeMeta table exists
    const [tableExists] = await railwaySequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SequelizeMeta'
      );
    `);

    if (!tableExists[0]?.exists) {
      console.log('⚠️  SequelizeMeta table does not exist on Railway');
      console.log('   This means no migrations have been run yet.');
      console.log('\n📦 All migrations are pending:');
      migrationFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file}`);
      });
      console.log('\n💡 Run migrations with: npm run migrate:railway');
      await railwaySequelize.close();
      process.exit(0);
    }

    // Get already run migrations
    const runMigrations = await railwaySequelize.query(
      'SELECT name FROM "SequelizeMeta" ORDER BY name',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const runMigrationNames = Array.isArray(runMigrations) 
      ? runMigrations.map(m => m.name) 
      : [];
    
    console.log(`📊 Found ${runMigrationNames.length} migrations recorded in Railway SequelizeMeta:`);
    runMigrationNames.forEach((name, index) => {
      console.log(`   ${index + 1}. ${name}`);
    });
    console.log('');

    // Find missing migrations (in code but not in DB)
    const missingMigrations = migrationFiles.filter(
      file => !runMigrationNames.includes(file)
    );

    // Find extra migrations (in DB but not in code - shouldn't happen)
    const extraMigrations = runMigrationNames.filter(
      name => !migrationFiles.includes(name)
    );

    // Display results
    console.log('='.repeat(80));
    
    if (missingMigrations.length === 0 && extraMigrations.length === 0) {
      console.log('✅ PERFECT MATCH!');
      console.log('   All migration files are recorded in Railway SequelizeMeta');
      console.log('   Railway database is up to date with the codebase');
    } else {
      if (missingMigrations.length > 0) {
        console.log(`\n⚠️  ${missingMigrations.length} MISSING MIGRATIONS (not run on Railway):`);
        missingMigrations.forEach((file, index) => {
          console.log(`   ${index + 1}. ${file}`);
        });
        console.log('\n💡 Run missing migrations with: npm run migrate:railway');
      }
      
      if (extraMigrations.length > 0) {
        console.log(`\n⚠️  ${extraMigrations.length} EXTRA MIGRATIONS (in Railway but not in code):`);
        extraMigrations.forEach((name, index) => {
          console.log(`   ${index + 1}. ${name}`);
        });
        console.log('   These migrations were run but files are missing from codebase');
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📋 Summary:');
    console.log(`   Migration files in codebase: ${migrationFiles.length}`);
    console.log(`   Migrations run on Railway: ${runMigrationNames.length}`);
    console.log(`   Missing migrations: ${missingMigrations.length}`);
    console.log(`   Extra migrations: ${extraMigrations.length}`);
    
    if (missingMigrations.length > 0) {
      console.log('\n⚠️  ACTION REQUIRED:');
      console.log('   Run the missing migrations on Railway to sync the database schema.');
      console.log('   Command: npm run migrate:railway');
    }
    
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ CHECK FAILED!');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    console.error('');
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

// Run main function
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

