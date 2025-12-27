#!/usr/bin/env node

/**
 * Backup Local Database using pg_dump
 * 
 * Creates a PostgreSQL-compatible SQL dump using pg_dump
 * This is the recommended method for creating backups that will be restored to Railway
 * 
 * Usage: 
 *   node scripts/backup-local-pgdump.js [output-file]
 * 
 * Examples:
 *   node scripts/backup-local-pgdump.js
 *   node scripts/backup-local-pgdump.js backups/my-backup.sql
 *   node scripts/backup-local-pgdump.js backups/production-backup-2025-01-25.sql
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get database config from env.js
const config = require('../env');

const dbConfig = {
  host: config.DB_HOST || 'localhost',
  port: config.DB_PORT || 5432,
  database: config.DB_NAME || 'easymauzo_pos',
  username: config.DB_USER || 'postgres',
  password: config.DB_PASSWORD || 'postgres'
};

// Output file - default to backups directory with timestamp
const defaultFileName = `local-backup-${new Date().toISOString().split('T')[0]}-${Date.now()}.sql`;
const outputFile = process.argv[2] || path.join(__dirname, '../backups', defaultFileName);

// Ensure backups directory exists
const backupsDir = path.dirname(outputFile);
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
  console.log(`📁 Created backups directory: ${backupsDir}`);
}

console.log('');
console.log('📦 BACKING UP LOCAL DATABASE (pg_dump)');
console.log('='.repeat(80));
console.log(`Database: ${dbConfig.database}`);
console.log(`Host: ${dbConfig.host}:${dbConfig.port}`);
console.log(`User: ${dbConfig.username}`);
console.log(`Output: ${outputFile}`);
console.log('');

// Check if pg_dump is available
try {
  const pgDumpVersion = execSync('pg_dump --version', { encoding: 'utf8' }).trim();
  console.log(`✅ Found pg_dump: ${pgDumpVersion}`);
  console.log('');
} catch (error) {
  console.error('❌ ERROR: pg_dump not found!');
  console.error('');
  console.error('pg_dump is required for this backup method.');
  console.error('It comes with PostgreSQL installation.');
  console.error('');
  console.error('💡 Solutions:');
  console.error('   1. Install PostgreSQL (includes pg_dump)');
  console.error('   2. Add PostgreSQL bin directory to your PATH');
  console.error('   3. Use the Node.js backup script instead:');
  console.error('      node scripts/backup-local-db-node.js');
  console.error('');
  process.exit(1);
}

// Build pg_dump command with optimal options for Railway restore
const pgDumpOptions = [
  'pg_dump',
  `--host=${dbConfig.host}`,
  `--port=${dbConfig.port}`,
  `--username=${dbConfig.username}`,
  `--dbname=${dbConfig.database}`,
  '--no-owner',              // Don't output commands to set ownership (Railway doesn't need this)
  '--no-acl',                // Don't output ACL (access control list) commands
  '--clean',                 // Include DROP statements before CREATE
  '--if-exists',             // Use IF EXISTS for DROP statements (safer)
  '--format=plain',          // Plain text SQL format (most compatible)
  '--verbose',                // Verbose output for progress
  '--encoding=UTF8',         // Explicit UTF-8 encoding
  '--no-password',           // Don't prompt for password (we'll use PGPASSWORD)
  `--file=${outputFile}`
];

const pgDumpCmd = pgDumpOptions.join(' ');

try {
  console.log('🔄 Running pg_dump...');
  console.log('   (This may take a few minutes depending on database size)');
  console.log('');
  
  // Set PGPASSWORD environment variable for pg_dump
  // This prevents password prompts
  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password
  };
  
  // Execute pg_dump
  execSync(pgDumpCmd, { 
    stdio: 'inherit',  // Show progress output
    env: env,
    cwd: __dirname
  });
  
  // Verify backup file was created
  if (!fs.existsSync(outputFile)) {
    throw new Error('Backup file was not created');
  }
  
  // Get file size
  const stats = fs.statSync(outputFile);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  const fileSizeKB = (stats.size / 1024).toFixed(2);
  
  // Get table count from backup file (rough estimate)
  const backupContent = fs.readFileSync(outputFile, 'utf8');
  const tableMatches = backupContent.match(/CREATE TABLE/g);
  const tableCount = tableMatches ? tableMatches.length : 0;
  
  console.log('');
  console.log('✅ BACKUP COMPLETE!');
  console.log('='.repeat(80));
  console.log(`📁 File: ${outputFile}`);
  console.log(`📊 Size: ${fileSizeMB} MB (${fileSizeKB} KB)`);
  console.log(`📋 Tables: ${tableCount}`);
  console.log('');
  console.log('💡 Next Steps:');
  console.log('');
  console.log('   To restore this backup to Railway:');
  console.log(`   node scripts/restore-to-railway.js "${outputFile}"`);
  console.log('');
  console.log('   Or using the Node.js restore (no psql required):');
  console.log(`   node scripts/restore-to-railway-node.js "${outputFile}"`);
  console.log('');
  console.log('   You can also restore directly with psql:');
  console.log(`   PGPASSWORD=<railway-password> psql --host=<railway-host> --port=<railway-port> --username=<railway-user> --dbname=<railway-db> --set=sslmode=require --file="${outputFile}"`);
  console.log('');
  
} catch (error) {
  console.error('');
  console.error('❌ BACKUP FAILED!');
  console.error('='.repeat(80));
  console.error('Error:', error.message);
  console.error('');
  console.error('💡 Troubleshooting:');
  console.error('');
  console.error('   1. Check PostgreSQL is running locally:');
  console.error('      - Windows: Check Services for "postgresql"');
  console.error('      - Mac/Linux: sudo systemctl status postgresql');
  console.error('');
  console.error('   2. Verify database credentials in backend/.env:');
  console.error(`      DB_HOST=${dbConfig.host}`);
  console.error(`      DB_PORT=${dbConfig.port}`);
  console.error(`      DB_NAME=${dbConfig.database}`);
  console.error(`      DB_USER=${dbConfig.username}`);
  console.error(`      DB_PASSWORD=${dbConfig.password ? '***' : 'not set'}`);
  console.error('');
  console.error('   3. Test connection manually:');
  console.error(`      psql --host=${dbConfig.host} --port=${dbConfig.port} --username=${dbConfig.username} --dbname=${dbConfig.database}`);
  console.error('');
  console.error('   4. Check pg_dump version:');
  console.error('      pg_dump --version');
  console.error('');
  console.error('   5. Try using the Node.js backup script (no pg_dump required):');
  console.error('      node scripts/backup-local-db-node.js');
  console.error('');
  process.exit(1);
}


