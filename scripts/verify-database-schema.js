#!/usr/bin/env node

/**
 * Database Schema Verification Script
 * 
 * ⚠️  SAFETY: This script is 100% READ-ONLY and SAFE to run on production databases.
 * It only reads database metadata (information_schema) and NEVER modifies or deletes data.
 * 
 * This script verifies that all Sequelize models match the actual database schema.
 * Run this script:
 * - Before deploying to production
 * - After running migrations
 * - When you suspect schema drift
 * 
 * Usage:
 *   node scripts/verify-database-schema.js [options]
 * 
 * Options:
 *   --verbose, -v    Show detailed information for each table
 *   --fail-on-error Exit with error code if issues are found
 *   --skip-extra    Skip warnings for extra columns in database
 * 
 * What this script does:
 *   ✅ Reads table/column metadata from information_schema
 *   ✅ Compares models with database structure
 *   ✅ Reports mismatches
 * 
 * What this script does NOT do:
 *   ❌ Delete any data
 *   ❌ Drop any tables or columns
 *   ❌ Modify any data
 *   ❌ Run any DDL statements (CREATE, ALTER, DROP)
 */

require('dotenv').config();
const { verifyDatabaseSchema } = require('../server/utils/databaseSchemaVerifier');
const sequelize = require('../config/database');

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const failOnError = args.includes('--fail-on-error');
  const skipExtra = args.includes('--skip-extra');
  
  try {
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    const results = await verifyDatabaseSchema({
      verbose,
      failOnError,
      skipExtraColumns: skipExtra
    });
    
    // Exit with appropriate code
    process.exit(results.verified ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();

