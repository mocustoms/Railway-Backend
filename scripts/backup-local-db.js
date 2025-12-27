#!/usr/bin/env node

/**
 * Backup Local Database
 * 
 * Creates a SQL dump of your local PostgreSQL database
 * Usage: node scripts/backup-local-db.js [output-file]
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get database config
const config = require('../env');

const dbConfig = {
  host: config.DB_HOST || 'localhost',
  port: config.DB_PORT || 5432,
  database: config.DB_NAME || 'easymauzo_pos',
  username: config.DB_USER || 'postgres',
  password: config.DB_PASSWORD || 'postgres'
};

// Output file
const outputFile = process.argv[2] || path.join(__dirname, `../backups/local-backup-${new Date().toISOString().split('T')[0]}.sql`);

// Ensure backups directory exists
const backupsDir = path.dirname(outputFile);
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

console.log('📦 BACKING UP LOCAL DATABASE');
console.log('='.repeat(80));
console.log(`Database: ${dbConfig.database}`);
console.log(`Host: ${dbConfig.host}:${dbConfig.port}`);
console.log(`Output: ${outputFile}`);
console.log('');

// Build pg_dump command
const pgDumpCmd = [
  'pg_dump',
  `--host=${dbConfig.host}`,
  `--port=${dbConfig.port}`,
  `--username=${dbConfig.username}`,
  `--dbname=${dbConfig.database}`,
  '--no-owner',           // Don't output commands to set ownership
  '--no-acl',            // Don't output ACL (access control list) commands
  '--clean',             // Include DROP statements
  '--if-exists',         // Use IF EXISTS for DROP statements
  '--format=plain',       // Plain text SQL format
  '--verbose',           // Verbose output
  `--file=${outputFile}`
].join(' ');

try {
  // Set PGPASSWORD environment variable for pg_dump
  process.env.PGPASSWORD = dbConfig.password;
  
  console.log('🔄 Running pg_dump...');
  execSync(pgDumpCmd, { 
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: dbConfig.password }
  });
  
  // Get file size
  const stats = fs.statSync(outputFile);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log('');
  console.log('✅ BACKUP COMPLETE!');
  console.log('='.repeat(80));
  console.log(`📁 File: ${outputFile}`);
  console.log(`📊 Size: ${fileSizeMB} MB`);
  console.log('');
  console.log('💡 To restore this backup:');
  console.log(`   node scripts/restore-to-railway.js "${outputFile}"`);
  console.log('');
  
} catch (error) {
  console.error('');
  console.error('❌ BACKUP FAILED!');
  console.error('='.repeat(80));
  console.error('Error:', error.message);
  console.error('');
  console.error('💡 Troubleshooting:');
  console.error('   1. Make sure PostgreSQL is running locally');
  console.error('   2. Check your .env file has correct DB credentials');
  console.error('   3. Ensure pg_dump is installed (comes with PostgreSQL)');
  console.error('   4. Try running: pg_dump --version');
  process.exit(1);
}

