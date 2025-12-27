#!/usr/bin/env node

/**
 * Verify Railway Database Schema
 * 
 * Checks Railway database schema against Sequelize models
 * Usage: node scripts/verify-railway-schema.js [railway-database-url]
 */

require('dotenv').config();
const { getRailwayDatabaseUrl, parseDatabaseUrl } = require('../config/railway-db');

async function main() {
  // Get Railway database URL
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  // Parse Railway database config
  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }

  // Temporarily set DATABASE_URL to Railway's URL for verification
  process.env.DATABASE_URL = railwayUrl;
  
  // Now run the verification script
  const { verifyDatabaseSchema } = require('../server/utils/databaseSchemaVerifier');
  
  console.log('');
  console.log('🔍 VERIFYING RAILWAY DATABASE SCHEMA');
  console.log('='.repeat(80));
  console.log(`Railway Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`Railway Database: ${railwayConfig.database}`);
  console.log('');
  
  const results = await verifyDatabaseSchema({
    verbose: false,  // Set to false for faster summary
    failOnError: false,
    skipExtraColumns: true
  });
  
  console.log('');
  console.log('='.repeat(80));
  if (results.verified) {
    console.log('✅ SCHEMA VERIFICATION PASSED');
  } else {
    console.log('❌ SCHEMA VERIFICATION FAILED');
    console.log(`   Errors: ${results.errors.length}`);
    console.log(`   Warnings: ${results.warnings.length}`);
    console.log(`   Missing Tables: ${results.tablesMissing.length}`);
  }
  console.log('='.repeat(80));
  console.log('');
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

