#!/usr/bin/env node

/**
 * Verify Restored Data on Railway
 * 
 * Checks that data was successfully restored to Railway
 */

require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');

function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  let normalizedUrl = databaseUrl.trim().replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalizedUrl);
  const databaseName = url.pathname ? url.pathname.slice(1) : '';
  if (!databaseName) throw new Error('Database name not found');
  
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: databaseName,
    username: url.username || 'postgres',
    password: url.password || ''
  };
}

async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  if (!railwayDbUrl) {
    console.error('❌ Railway DATABASE_URL required');
    process.exit(1);
  }

  const config = parseDatabaseUrl(railwayDbUrl);
  const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    port: config.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    }
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Railway database\n');

    // Check key tables
    const checks = [
      { table: 'Company', name: 'Companies' },
      { table: 'users', name: 'Users' },
      { table: 'accounts', name: 'Accounts' },
      { table: 'products', name: 'Products' },
      { table: 'customers', name: 'Customers' },
      { table: 'stores', name: 'Stores' },
      { table: 'currencies', name: 'Currencies' },
      { table: 'proforma_invoices', name: 'Proforma Invoices' }
    ];

    console.log('📊 Verifying restored data...\n');
    
    for (const { table, name } of checks) {
      try {
        const [result] = await sequelize.query(
          `SELECT COUNT(*) as count FROM "${table}"`,
          { type: QueryTypes.SELECT }
        );
        const count = result.count || 0;
        console.log(`${count > 0 ? '✅' : '⚠️ '} ${name}: ${count} records`);
      } catch (error) {
        // Try without quotes for snake_case tables
        try {
          const [result] = await sequelize.query(
            `SELECT COUNT(*) as count FROM ${table}`,
            { type: QueryTypes.SELECT }
          );
          const count = result.count || 0;
          console.log(`${count > 0 ? '✅' : '⚠️ '} ${name}: ${count} records`);
        } catch (e) {
          console.log(`❌ ${name}: Table not found or error - ${e.message.substring(0, 50)}`);
        }
      }
    }

    // Check migrations
    console.log('\n📦 Migration status:');
    const [migrations] = await sequelize.query(
      'SELECT COUNT(*) as count FROM "SequelizeMeta"',
      { type: QueryTypes.SELECT }
    );
    console.log(`   Migrations recorded: ${migrations.count}`);

    console.log('\n✅ Data verification complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

