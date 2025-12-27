#!/usr/bin/env node

/**
 * Sync Database Schema from Local to Railway
 * 
 * This script compares the local database schema with Railway database schema
 * and updates Railway to match local (adds missing tables, columns, constraints, etc.)
 * 
 * Usage: node scripts/sync-schema-to-railway.js [railway-database-url]
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const readline = require('readline');
const { getRailwayDatabaseUrl, parseDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(
    `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = :tableName
     ORDER BY ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

async function getTables(sequelize) {
  const tables = await sequelize.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
     AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    { type: QueryTypes.SELECT }
  );
  const tablesArray = Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0])
    ? tables[0]
    : tables;
  return tablesArray.map(t => t.table_name);
}

async function syncSchemaToRailway() {
  // Get Railway database URL
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  // Connect to local database
  const localSequelize = require('../config/database');
  
  // Connect to Railway database
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  const railwayConfig = parseDatabaseUrl(railwayUrl);

  try {
    console.log('\n🔄 SYNCING DATABASE SCHEMA FROM LOCAL TO RAILWAY\n');
    console.log('='.repeat(80));
    
    // Test connections
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Get tables from both databases
    const localTables = await getTables(localSequelize);
    const railwayTables = await getTables(railwaySequelize);
    
    console.log(`📊 Local tables: ${localTables.length}`);
    console.log(`📊 Railway tables: ${railwayTables.length}\n`);

    // Find missing tables
    const missingInRailway = localTables.filter(t => !railwayTables.includes(t));
    const extraInRailway = railwayTables.filter(t => !localTables.includes(t));

    if (missingInRailway.length > 0) {
      console.log('❌ Tables missing in Railway:');
      missingInRailway.forEach(t => console.log(`   - ${t}`));
      console.log('');
    }

    if (extraInRailway.length > 0) {
      console.log('⚠️  Extra tables in Railway (not in local):');
      extraInRailway.forEach(t => console.log(`   - ${t}`));
      console.log('');
    }

    // Compare columns for common tables
    const commonTables = localTables.filter(t => railwayTables.includes(t));
    console.log(`\n📋 Comparing columns in ${commonTables.length} common tables...\n`);

    let totalDifferences = 0;
    const differences = [];

    for (const table of commonTables) {
      const localColumns = await getTableColumns(localSequelize, table);
      const railwayColumns = await getTableColumns(railwaySequelize, table);

      const localColNames = new Set(localColumns.map(c => c.column_name));
      const railwayColNames = new Set(railwayColumns.map(c => c.column_name));

      const missingInRailway = localColumns.filter(c => !railwayColNames.has(c.column_name));
      const extraInRailway = railwayColumns.filter(c => !localColNames.has(c.column_name));

      if (missingInRailway.length > 0 || extraInRailway.length > 0) {
        totalDifferences++;
        differences.push({
          table,
          missing: missingInRailway,
          extra: extraInRailway.map(c => c.column_name)
        });
      }
    }

    // Summary before sync
    console.log('='.repeat(80));
    console.log('📊 SUMMARY BEFORE SYNC:');
    console.log(`   Local tables: ${localTables.length}`);
    console.log(`   Railway tables: ${railwayTables.length}`);
    console.log(`   Common tables: ${commonTables.length}`);
    console.log(`   Missing in Railway: ${missingInRailway.length} tables`);
    console.log(`   Column differences: ${totalDifferences} tables`);
    console.log('='.repeat(80));
    console.log('');

    if (missingInRailway.length === 0 && totalDifferences === 0) {
      console.log('✅ Schemas are already in sync! No changes needed.\n');
      return;
    }

    // Ask for confirmation
    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise((resolve) => {
      rl2.question('⚠️  This will modify the Railway database schema to match local. Continue? (yes/no): ', (ans) => {
        rl2.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer !== 'yes' && answer !== 'y') {
      console.log('❌ Sync cancelled');
      process.exit(0);
    }

    console.log('');
    console.log('🔄 Starting schema sync using pg_dump --schema-only...\n');
    console.log('   This will dump the local schema and apply it to Railway.\n');

    // Use pg_dump --schema-only to dump local schema, then restore to Railway
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    // Get local database config from env
    const env = require('../env');
    const localConfig = {
      host: env.DB_HOST || 'localhost',
      port: env.DB_PORT || 5432,
      username: env.DB_USER || 'postgres',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'easymauzo_pos'
    };
    
    // Create temporary schema dump file
    const tempSchemaFile = path.join(os.tmpdir(), `schema-sync-${Date.now()}.sql`);
    
    try {
      // Step 1: Dump local schema
      console.log('📤 Dumping local database schema...');
      const pgDumpCmd = [
        'pg_dump',
        `--host=${localConfig.host || 'localhost'}`,
        `--port=${localConfig.port || 5432}`,
        `--username=${localConfig.username || 'postgres'}`,
        `--dbname=${localConfig.database}`,
        '--schema-only',
        '--no-owner',
        '--no-acl',
        '--file=' + tempSchemaFile
      ].join(' ');

      // Set PGPASSWORD for local database
      process.env.PGPASSWORD = localConfig.password || '';
      
      execSync(pgDumpCmd, { 
        stdio: 'inherit',
        env: { 
          ...process.env, 
          PGPASSWORD: localConfig.password || ''
        }
      });
      
      console.log('✅ Local schema dumped\n');

      // Step 2: Restore schema to Railway
      console.log('📥 Applying schema to Railway database...');
      const psqlCmd = [
        'psql',
        `--host=${railwayConfig.host}`,
        `--port=${railwayConfig.port}`,
        `--username=${railwayConfig.username}`,
        `--dbname=${railwayConfig.database}`,
        '--set=sslmode=require',
        '--file=' + tempSchemaFile,
        '--echo-errors',
        '--quiet'
      ].join(' ');

      // Set PGPASSWORD for Railway database
      process.env.PGPASSWORD = railwayConfig.password;
      
      execSync(psqlCmd, { 
        stdio: 'inherit',
        env: { 
          ...process.env, 
          PGPASSWORD: railwayConfig.password,
          PGSSLMODE: 'require'
        }
      });
      
      console.log('\n✅ Schema applied to Railway\n');
      
    } catch (error) {
      console.error('\n❌ Error during schema sync:', error.message);
      throw error;
    } finally {
      // Clean up temporary file
      if (fs.existsSync(tempSchemaFile)) {
        fs.unlinkSync(tempSchemaFile);
      }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ SCHEMA SYNC COMPLETE!');
    console.log('='.repeat(80));
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Verify the schema in Railway dashboard');
    console.log('   2. Run: node scripts/compare-local-railway-schema.js to verify');
    console.log('   3. Test your application');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

// Run sync
syncSchemaToRailway().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

