/**
 * Railway Database Configuration
 * 
 * ⚠️ DEPRECATED: This file is being phased out in favor of the centralized connection.
 * 
 * Please use the centralized database connection from config/database.js:
 * - Main connection: require('../config/database')
 * - Custom connection: require('../config/database').createDatabaseConnection(databaseUrl)
 * 
 * The centralized connection uses DATABASE_URL from environment variables,
 * making it easy to switch between local and Railway by just changing DATABASE_URL.
 * 
 * This file is kept for backward compatibility with existing scripts.
 * New scripts should use the centralized connection.
 */

// ⚠️ SECURITY WARNING: Remove hardcoded credentials!
// This should be set via environment variables only
const DEFAULT_RAILWAY_DATABASE_URL = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL || null;

/**
 * Get Railway database URL from various sources (priority order):
 * 1. Command-line argument
 * 2. Environment variable (RAILWAY_DATABASE_URL or DATABASE_URL)
 * 3. Default URL from this config
 */
function getRailwayDatabaseUrl(cliArg = null) {
  // Priority 1: Command-line argument
  if (cliArg) {
    return cliArg.trim();
  }
  
  // Priority 2: Environment variable
  if (process.env.RAILWAY_DATABASE_URL) {
    return process.env.RAILWAY_DATABASE_URL.trim();
  }
  
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')) {
    return process.env.DATABASE_URL.trim();
  }
  
  // Priority 3: Default from config
  return DEFAULT_RAILWAY_DATABASE_URL;
}

/**
 * Parse database URL into connection config
 * 
 * ⚠️ DEPRECATED: Use config.parseDatabaseUrl() from env.js instead
 */
function parseDatabaseUrl(databaseUrl) {
  // Use centralized parser from env.js
  const config = require('../env');
  return config.parseDatabaseUrl(databaseUrl);
}

/**
 * Create Sequelize instance for Railway database
 * 
 * ⚠️ DEPRECATED: Use createDatabaseConnection() from config/database.js instead
 * 
 * Example:
 *   const { createDatabaseConnection } = require('../config/database');
 *   const railwaySequelize = createDatabaseConnection(railwayUrl);
 */
function createRailwaySequelize(databaseUrl = null) {
  // Use centralized connection creator
  const { createDatabaseConnection } = require('./database');
  const url = getRailwayDatabaseUrl(databaseUrl);
  
  if (!url) {
    throw new Error('Railway DATABASE_URL is required. Set RAILWAY_DATABASE_URL or DATABASE_URL environment variable.');
  }
  
  return createDatabaseConnection(url);
}

module.exports = {
  DEFAULT_RAILWAY_DATABASE_URL,
  getRailwayDatabaseUrl,
  parseDatabaseUrl,
  createRailwaySequelize
};

