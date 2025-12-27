#!/usr/bin/env node

/**
 * Restore Database Backup to Railway
 * 
 * Restores a SQL backup file to Railway PostgreSQL database
 * Usage: node scripts/restore-to-railway.js [backup-file] [railway-db-url]
 * 
 * If Railway DATABASE_URL is not provided, it will prompt or use RAILWAY_DATABASE_URL env var
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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

// Main async function
async function main() {
  // Get backup file
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('❌ Error: Backup file is required');
    console.error('');
    console.error('Usage: node scripts/restore-to-railway.js <backup-file> [railway-database-url]');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/restore-to-railway.js backups/local-backup-2025-01-25.sql');
    console.error('  node scripts/restore-to-railway.js backups/local-backup-2025-01-25.sql "postgresql://user:pass@host:port/db"');
    process.exit(1);
  }

  if (!fs.existsSync(backupFile)) {
    console.error(`❌ Error: Backup file not found: ${backupFile}`);
    process.exit(1);
  }

  // Get Railway database URL
  let railwayDbUrl = process.argv[3] || process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

  if (!railwayDbUrl) {
    console.log('');
    console.log('⚠️  Railway DATABASE_URL not provided');
    console.log('');
    console.log('You can provide it in one of these ways:');
    console.log('  1. As command argument: node scripts/restore-to-railway.js <backup-file> <database-url>');
    console.log('  2. As environment variable: RAILWAY_DATABASE_URL=... node scripts/restore-to-railway.js <backup-file>');
    console.log('  3. Get it from Railway dashboard:');
    console.log('     - Go to your Railway project');
    console.log('     - Click on PostgreSQL service');
    console.log('     - Go to "Variables" tab');
    console.log('     - Copy the DATABASE_URL value');
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
  console.log('🔄 RESTORING DATABASE TO RAILWAY');
  console.log('='.repeat(80));
  console.log(`Backup File: ${backupFile}`);
  console.log(`Railway Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`Railway Database: ${railwayConfig.database}`);
  console.log(`Railway User: ${railwayConfig.username}`);
  console.log('');

  // Confirm before proceeding
  const rl2 = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise((resolve) => {
    rl2.question('⚠️  WARNING: This will overwrite data in Railway database. Continue? (yes/no): ', (ans) => {
      rl2.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (answer !== 'yes' && answer !== 'y') {
    console.log('❌ Restore cancelled');
    process.exit(0);
  }

  // Build psql command
  const psqlCmd = [
    'psql',
    `--host=${railwayConfig.host}`,
    `--port=${railwayConfig.port}`,
    `--username=${railwayConfig.username}`,
    `--dbname=${railwayConfig.database}`,
    '--set=sslmode=require',  // Railway requires SSL
    '--file=' + backupFile,
    '--echo-errors',          // Show errors
    '--quiet'                 // Suppress success messages
  ].join(' ');

  try {
    console.log('');
    console.log('🔄 Running psql restore...');
    console.log('   (This may take a few minutes depending on database size)');
    console.log('');
    
    // Set PGPASSWORD environment variable
    process.env.PGPASSWORD = railwayConfig.password;
    
    execSync(psqlCmd, { 
      stdio: 'inherit',
      env: { 
        ...process.env, 
        PGPASSWORD: railwayConfig.password,
        PGSSLMODE: 'require'  // Railway requires SSL
      }
    });
    
    console.log('');
    console.log('✅ RESTORE COMPLETE!');
    console.log('='.repeat(80));
    console.log('Your local database has been restored to Railway.');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Verify the data in Railway dashboard');
    console.log('   2. Run migrations if needed: npm run migrate');
    console.log('   3. Verify schema: npm run verify-schema');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ RESTORE FAILED!');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   1. Check Railway DATABASE_URL is correct');
    console.error('   2. Ensure Railway database is accessible');
    console.error('   3. Check if backup file is valid SQL');
    console.error('   4. Ensure psql is installed (comes with PostgreSQL)');
    console.error('   5. Try running: psql --version');
    console.error('   6. Railway requires SSL - make sure connection supports SSL');
    console.error('');
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
