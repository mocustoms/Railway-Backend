#!/usr/bin/env node

/**
 * Interactive Backup and Restore Helper
 * 
 * Guides you through backing up local database and restoring to Railway
 * 
 * Usage: node scripts/backup-and-restore-helper.js
 */

const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     EasyMauzo Database Backup & Restore Helper                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('What would you like to do?');
  console.log('');
  console.log('  1. Backup local database (pg_dump)');
  console.log('  2. Backup local database (Node.js - no pg_dump required)');
  console.log('  3. Restore backup to Railway (Node.js)');
  console.log('  4. Restore backup to Railway (psql)');
  console.log('  5. Full workflow: Backup → Restore');
  console.log('  0. Exit');
  console.log('');
  
  const choice = await question('Enter your choice (0-5): ');
  console.log('');
  
  switch (choice.trim()) {
    case '1':
      await backupWithPgDump();
      break;
    case '2':
      await backupWithNode();
      break;
    case '3':
      await restoreWithNode();
      break;
    case '4':
      await restoreWithPsql();
      break;
    case '5':
      await fullWorkflow();
      break;
    case '0':
      console.log('👋 Goodbye!');
      rl.close();
      return;
    default:
      console.log('❌ Invalid choice. Please run the script again.');
      rl.close();
      return;
  }
  
  rl.close();
}

async function backupWithPgDump() {
  console.log('📦 BACKUP LOCAL DATABASE (pg_dump)');
  console.log('='.repeat(60));
  console.log('');
  
  // Check if pg_dump is available
  try {
    execSync('pg_dump --version', { stdio: 'ignore' });
  } catch (error) {
    console.log('❌ pg_dump not found!');
    console.log('');
    console.log('pg_dump is required for this backup method.');
    console.log('Please install PostgreSQL or use option 2 (Node.js backup).');
    console.log('');
    return;
  }
  
  const outputFile = await question('Backup file name (press Enter for default): ');
  const file = outputFile.trim() || undefined;
  
  console.log('');
  console.log('🔄 Running backup...');
  console.log('');
  
  try {
    if (file) {
      execSync(`node scripts/backup-local-pgdump.js "${file}"`, { stdio: 'inherit' });
    } else {
      execSync('node scripts/backup-local-pgdump.js', { stdio: 'inherit' });
    }
    console.log('');
    console.log('✅ Backup completed successfully!');
  } catch (error) {
    console.log('');
    console.log('❌ Backup failed. Check the error messages above.');
  }
}

async function backupWithNode() {
  console.log('📦 BACKUP LOCAL DATABASE (Node.js)');
  console.log('='.repeat(60));
  console.log('');
  
  const outputFile = await question('Backup file name (press Enter for default): ');
  const file = outputFile.trim() || undefined;
  
  console.log('');
  console.log('🔄 Running backup...');
  console.log('');
  
  try {
    if (file) {
      execSync(`node scripts/backup-local-db-node.js "${file}"`, { stdio: 'inherit' });
    } else {
      execSync('node scripts/backup-local-db-node.js', { stdio: 'inherit' });
    }
    console.log('');
    console.log('✅ Backup completed successfully!');
  } catch (error) {
    console.log('');
    console.log('❌ Backup failed. Check the error messages above.');
  }
}

async function restoreWithNode() {
  console.log('🔄 RESTORE TO RAILWAY (Node.js)');
  console.log('='.repeat(60));
  console.log('');
  
  // List available backup files
  const backupsDir = path.join(__dirname, '../backups');
  let backupFiles = [];
  
  if (fs.existsSync(backupsDir)) {
    backupFiles = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.sql'))
      .map(f => path.join(backupsDir, f));
  }
  
  if (backupFiles.length > 0) {
    console.log('Available backup files:');
    backupFiles.forEach((file, index) => {
      const stats = fs.statSync(file);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`  ${index + 1}. ${path.basename(file)} (${sizeMB} MB)`);
    });
    console.log('');
  }
  
  const backupFile = await question('Backup file path: ');
  
  if (!fs.existsSync(backupFile.trim())) {
    console.log('');
    console.log('❌ Backup file not found!');
    return;
  }
  
  console.log('');
  console.log('💡 Get Railway DATABASE_URL from Railway dashboard:');
  console.log('   1. Go to Railway project');
  console.log('   2. Click PostgreSQL service');
  console.log('   3. Go to Variables tab');
  console.log('   4. Copy DATABASE_URL');
  console.log('');
  
  const railwayUrl = await question('Railway DATABASE_URL (or press Enter to be prompted): ');
  
  console.log('');
  console.log('🔄 Running restore...');
  console.log('');
  
  try {
    if (railwayUrl.trim()) {
      execSync(`node scripts/restore-to-railway-node.js "${backupFile.trim()}" "${railwayUrl.trim()}"`, { stdio: 'inherit' });
    } else {
      execSync(`node scripts/restore-to-railway-node.js "${backupFile.trim()}"`, { stdio: 'inherit' });
    }
    console.log('');
    console.log('✅ Restore completed successfully!');
  } catch (error) {
    console.log('');
    console.log('❌ Restore failed. Check the error messages above.');
  }
}

async function restoreWithPsql() {
  console.log('🔄 RESTORE TO RAILWAY (psql)');
  console.log('='.repeat(60));
  console.log('');
  
  // Check if psql is available
  try {
    execSync('psql --version', { stdio: 'ignore' });
  } catch (error) {
    console.log('❌ psql not found!');
    console.log('');
    console.log('psql is required for this restore method.');
    console.log('Please install PostgreSQL or use option 3 (Node.js restore).');
    console.log('');
    return;
  }
  
  const backupFile = await question('Backup file path: ');
  
  if (!fs.existsSync(backupFile.trim())) {
    console.log('');
    console.log('❌ Backup file not found!');
    return;
  }
  
  console.log('');
  console.log('💡 Get Railway DATABASE_URL from Railway dashboard');
  console.log('');
  
  const railwayUrl = await question('Railway DATABASE_URL: ');
  
  console.log('');
  console.log('🔄 Running restore...');
  console.log('');
  
  try {
    execSync(`node scripts/restore-to-railway.js "${backupFile.trim()}" "${railwayUrl.trim()}"`, { stdio: 'inherit' });
    console.log('');
    console.log('✅ Restore completed successfully!');
  } catch (error) {
    console.log('');
    console.log('❌ Restore failed. Check the error messages above.');
  }
}

async function fullWorkflow() {
  console.log('🔄 FULL WORKFLOW: BACKUP → RESTORE');
  console.log('='.repeat(60));
  console.log('');
  
  // Step 1: Backup
  console.log('📦 Step 1: Backup Local Database');
  console.log('');
  
  const backupMethod = await question('Backup method (1=pg_dump, 2=Node.js): ');
  
  let backupFile;
  try {
    if (backupMethod.trim() === '1') {
      console.log('');
      console.log('🔄 Running pg_dump backup...');
      execSync('node scripts/backup-local-pgdump.js', { stdio: 'inherit' });
      
      // Find the latest backup file
      const backupsDir = path.join(__dirname, '../backups');
      if (fs.existsSync(backupsDir)) {
        const files = fs.readdirSync(backupsDir)
          .filter(f => f.endsWith('.sql'))
          .map(f => ({
            name: f,
            path: path.join(backupsDir, f),
            time: fs.statSync(path.join(backupsDir, f)).mtime
          }))
          .sort((a, b) => b.time - a.time);
        
        if (files.length > 0) {
          backupFile = files[0].path;
          console.log('');
          console.log(`✅ Backup created: ${files[0].name}`);
        }
      }
    } else {
      console.log('');
      console.log('🔄 Running Node.js backup...');
      execSync('node scripts/backup-local-db-node.js', { stdio: 'inherit' });
      
      // Find the latest backup file
      const backupsDir = path.join(__dirname, '../backups');
      if (fs.existsSync(backupsDir)) {
        const files = fs.readdirSync(backupsDir)
          .filter(f => f.endsWith('.sql'))
          .map(f => ({
            name: f,
            path: path.join(backupsDir, f),
            time: fs.statSync(path.join(backupsDir, f)).mtime
          }))
          .sort((a, b) => b.time - a.time);
        
        if (files.length > 0) {
          backupFile = files[0].path;
          console.log('');
          console.log(`✅ Backup created: ${files[0].name}`);
        }
      }
    }
  } catch (error) {
    console.log('');
    console.log('❌ Backup failed!');
    return;
  }
  
  if (!backupFile) {
    console.log('');
    console.log('❌ Could not find backup file. Please check backup output.');
    return;
  }
  
  // Step 2: Restore
  console.log('');
  console.log('🔄 Step 2: Restore to Railway');
  console.log('');
  console.log('💡 Get Railway DATABASE_URL from Railway dashboard');
  console.log('');
  
  const railwayUrl = await question('Railway DATABASE_URL: ');
  
  if (!railwayUrl.trim()) {
    console.log('');
    console.log('❌ DATABASE_URL is required!');
    return;
  }
  
  console.log('');
  console.log('🔄 Running restore...');
  console.log('');
  
  try {
    execSync(`node scripts/restore-to-railway-node.js "${backupFile}" "${railwayUrl.trim()}"`, { stdio: 'inherit' });
    console.log('');
    console.log('✅ Full workflow completed successfully!');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Verify data in Railway dashboard');
    console.log('   2. Run: npm run verify-schema');
    console.log('   3. Test your application');
  } catch (error) {
    console.log('');
    console.log('❌ Restore failed. Check the error messages above.');
  }
}

// Run main function
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  rl.close();
  process.exit(1);
});


