#!/usr/bin/env node

/**
 * Run Migrations on Railway Database
 * 
 * Runs all pending migrations on Railway PostgreSQL database
 * Usage: node scripts/run-migrations-railway.js [railway-database-url]
 */

require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
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
    console.log('  1. As command argument: node scripts/run-migrations-railway.js <database-url>');
    console.log('  2. As environment variable: RAILWAY_DATABASE_URL=... node scripts/run-migrations-railway.js');
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
  console.log('🔄 RUNNING MIGRATIONS ON RAILWAY');
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
    logging: console.log,
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

    // Ensure SequelizeMeta table exists
    await railwaySequelize.query(`
      CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      );
    `);
    console.log('✅ SequelizeMeta table verified');
    console.log('');

    // Get all migration files
    const migrationsPath = path.join(__dirname, '../migrations');
    if (!fs.existsSync(migrationsPath)) {
      throw new Error(`Migrations directory not found: ${migrationsPath}`);
    }

    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort(); // Run migrations in order
    
    console.log(`📋 Found ${migrationFiles.length} migration files`);
    console.log('');

    // Get already run migrations
    const runMigrations = await railwaySequelize.query(
      'SELECT name FROM "SequelizeMeta"',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const runMigrationNames = Array.isArray(runMigrations) ? runMigrations.map(m => m.name) : [];
    
    // Filter pending migrations
    const pendingMigrations = migrationFiles.filter(file => !runMigrationNames.includes(file));
    
    if (pendingMigrations.length === 0) {
      console.log('✅ All migrations are already applied');
      console.log('');
      return;
    }

    // Show pending migrations
    console.log(`📝 Found ${pendingMigrations.length} pending migrations:`);
    pendingMigrations.forEach((migration, index) => {
      console.log(`   ${index + 1}. ${migration}`);
    });
    console.log('');

    // Confirm before proceeding
    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise((resolve) => {
      rl2.question('⚠️  This will modify the Railway database schema. Continue? (yes/no): ', (ans) => {
        rl2.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer !== 'yes' && answer !== 'y') {
      console.log('❌ Migrations cancelled');
      process.exit(0);
    }

    // Run migrations
    console.log('');
    console.log('🔄 Running migrations...');
    console.log('');
    
    for (const migrationFile of pendingMigrations) {
      try {
        console.log(`▶️  Running: ${migrationFile}`);
        const migration = require(path.join(migrationsPath, migrationFile));
        
        if (typeof migration.up === 'function') {
          const queryInterface = railwaySequelize.getQueryInterface();
          
          try {
            await migration.up(queryInterface, Sequelize);
          } catch (migrationError) {
            // Check if error is about object already existing (common when re-running migrations)
            const errorMsg = migrationError.message.toLowerCase();
            const ignorableErrors = [
              'already exists',
              'duplicate',
              'relation already exists',
              'constraint already exists',
              'index already exists',
              'type already exists'
            ];
            
            const isIgnorable = ignorableErrors.some(msg => errorMsg.includes(msg));
            
            if (isIgnorable) {
              console.log(`   ⚠️  Warning: ${migrationError.message.substring(0, 100)} (continuing...)`);
            } else {
              throw migrationError; // Re-throw if it's a real error
            }
          }
          
          // Mark migration as run (even if some parts already existed)
          await railwaySequelize.query(
            `INSERT INTO "SequelizeMeta" (name) VALUES ('${migrationFile}') ON CONFLICT (name) DO NOTHING;`
          );
          
          console.log(`✅ Completed: ${migrationFile}`);
        } else {
          console.log(`⚠️  Skipping ${migrationFile}: No 'up' function found`);
        }
      } catch (error) {
        console.error(`\n❌ Error running ${migrationFile}:`, error.message);
        if (error.stack) {
          console.error('   Stack:', error.stack.substring(0, 300));
        }
        throw error; // Stop on first real error
      }
    }
    
    console.log('');
    console.log('✅ MIGRATIONS COMPLETE!');
    console.log('='.repeat(80));
    console.log(`   Executed ${pendingMigrations.length} migrations`);
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Verify schema: npm run verify-schema');
    console.log('   2. Restore data: npm run restore <backup-file>');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ MIGRATIONS FAILED!');
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
