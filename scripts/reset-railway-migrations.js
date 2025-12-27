#!/usr/bin/env node

/**
 * Reset Railway Migrations
 * 
 * Clears migration records so migrations can be re-run
 * Usage: node scripts/reset-railway-migrations.js [railway-database-url]
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');
const readline = require('readline');

// Parse DATABASE_URL (same as other scripts)
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
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    railwayDbUrl = await new Promise((resolve) => {
      rl.question('Enter Railway DATABASE_URL: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
    
    if (!railwayDbUrl) {
      console.error('❌ DATABASE_URL is required');
      process.exit(1);
    }
  }

  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayDbUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }

  console.log('');
  console.log('🔄 RESETTING RAILWAY MIGRATIONS');
  console.log('='.repeat(80));
  console.log(`Railway Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`Railway Database: ${railwayConfig.database}`);
  console.log('');

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
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database');
    console.log('');

    // Get current migrations
    const [migrations] = await railwaySequelize.query(
      'SELECT name FROM "SequelizeMeta"',
      { type: Sequelize.QueryTypes.SELECT }
    );
    
    if (migrations.length === 0) {
      console.log('ℹ️  No migrations to reset');
      return;
    }

    console.log(`📋 Found ${migrations.length} migration records`);
    console.log('');

    // Confirm
    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise((resolve) => {
      rl2.question('⚠️  This will clear all migration records. Migrations will need to be re-run. Continue? (yes/no): ', (ans) => {
        rl2.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer !== 'yes' && answer !== 'y') {
      console.log('❌ Reset cancelled');
      return;
    }

    // Clear migrations
    await railwaySequelize.query('TRUNCATE TABLE "SequelizeMeta";');
    
    console.log('');
    console.log('✅ Migration records cleared');
    console.log('');
    console.log('💡 Next step: Run migrations again');
    console.log('   npm run migrate:railway "your-database-url"');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

