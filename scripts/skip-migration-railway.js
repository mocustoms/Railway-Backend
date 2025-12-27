#!/usr/bin/env node

/**
 * Skip a specific migration on Railway
 * 
 * Marks a migration as complete without running it
 * Usage: node scripts/skip-migration-railway.js <migration-file> [railway-database-url]
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');
const readline = require('readline');

function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  
  let normalizedUrl = databaseUrl.trim();
  if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  }
  
  normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalizedUrl);
  
  const databaseName = url.pathname ? url.pathname.slice(1) : '';
  if (!databaseName) throw new Error('Database name not found in DATABASE_URL');
  
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: databaseName,
    username: url.username || 'postgres',
    password: url.password || ''
  };
}

async function main() {
  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error('❌ Error: Migration file name is required');
    console.error('Usage: node scripts/skip-migration-railway.js <migration-file> [railway-database-url]');
    process.exit(1);
  }

  let railwayDbUrl = process.argv[3] || process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;
  if (!railwayDbUrl) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    railwayDbUrl = await new Promise((resolve) => {
      rl.question('Enter Railway DATABASE_URL: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    }
  });

  try {
    await railwaySequelize.authenticate();
    await railwaySequelize.query(
      `INSERT INTO "SequelizeMeta" (name) VALUES ('${migrationFile}') ON CONFLICT (name) DO NOTHING;`
    );
    console.log(`✅ Marked ${migrationFile} as complete`);
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

