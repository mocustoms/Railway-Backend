#!/usr/bin/env node

/**
 * Railway Database Manager
 * 
 * Master script to manage Railway database operations:
 * - Sync schema from local to Railway
 * - Verify Railway schema
 * - Compare local vs Railway schemas
 * - Run migrations on Railway
 * - Quick verification
 * 
 * Usage:
 *   node scripts/railway-db-manager.js [command] [options]
 * 
 * Commands:
 *   sync        - Sync schema from local to Railway
 *   verify      - Verify Railway database schema
 *   compare     - Compare local vs Railway schemas
 *   migrate     - Run migrations on Railway
 *   quick       - Quick verification of Railway database
 *   help        - Show this help message
 */

require('dotenv').config();
const readline = require('readline');
const { execSync } = require('child_process');
const path = require('path');

const { getRailwayDatabaseUrl } = require('../config/railway-db');

const COMMANDS = {
  sync: {
    description: 'Sync database schema from local to Railway',
    script: 'sync-schema-to-railway.js'
  },
  verify: {
    description: 'Verify Railway database schema against Sequelize models',
    script: 'verify-railway-schema.js'
  },
  compare: {
    description: 'Compare local and Railway database schemas',
    script: 'compare-local-railway-schema.js'
  },
  migrate: {
    description: 'Run migrations on Railway database',
    script: 'run-migrations-railway.js'
  },
  quick: {
    description: 'Quick verification of Railway database (key tables only)',
    script: 'quick-verify-railway.js'
  }
};

function showHelp() {
  console.log('\n🚂 Railway Database Manager\n');
  console.log('Usage: node scripts/railway-db-manager.js [command] [railway-db-url]\n');
  console.log('Commands:');
  Object.entries(COMMANDS).forEach(([cmd, info]) => {
    console.log(`  ${cmd.padEnd(10)} - ${info.description}`);
  });
  console.log('  help       - Show this help message\n');
  console.log('Examples:');
  console.log('  node scripts/railway-db-manager.js sync');
  console.log('  node scripts/railway-db-manager.js verify');
  console.log('  node scripts/railway-db-manager.js compare');
  console.log('  node scripts/railway-db-manager.js migrate');
  console.log('  node scripts/railway-db-manager.js quick\n');
  console.log('Note: Railway database URL can be provided as:');
  console.log('  - Command-line argument (second parameter)');
  console.log('  - RAILWAY_DATABASE_URL environment variable');
  console.log('  - Default URL from config/railway-db.js\n');
}

async function promptForUrl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Enter Railway DATABASE_URL (or press Enter to use default): ', (answer) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

async function main() {
  const command = process.argv[2];
  const railwayUrl = process.argv[3];
  
  // Show help
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }
  
  // Check if command exists
  if (!COMMANDS[command]) {
    console.error(`❌ Unknown command: ${command}`);
    console.log('');
    showHelp();
    process.exit(1);
  }
  
  // Get Railway URL
  let finalUrl = railwayUrl || getRailwayDatabaseUrl();
  
  // If no URL provided and not in env, prompt user
  if (!railwayUrl && !process.env.RAILWAY_DATABASE_URL && !process.env.DATABASE_URL) {
    const promptedUrl = await promptForUrl();
    if (promptedUrl) {
      finalUrl = promptedUrl;
    }
  }
  
  // Show command info
  console.log('\n🚂 Railway Database Manager');
  console.log('='.repeat(80));
  console.log(`Command: ${command}`);
  console.log(`Description: ${COMMANDS[command].description}`);
  console.log('='.repeat(80));
  console.log('');
  
  // Run the script
  const scriptPath = path.join(__dirname, COMMANDS[command].script);
  
  try {
    // Set Railway URL as environment variable for the script
    process.env.RAILWAY_DATABASE_URL = finalUrl;
    
    // Execute the script
    execSync(`node "${scriptPath}" "${finalUrl}"`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
  } catch (error) {
    console.error(`\n❌ Command failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

