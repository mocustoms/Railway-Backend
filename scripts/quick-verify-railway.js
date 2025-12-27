#!/usr/bin/env node

/**
 * Quick Railway Schema Verification
 * 
 * Quick summary of schema status
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function main() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  
  const sequelize = createRailwaySequelize(railwayUrl);

  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Railway database\n');

    // Check key tables
    const keyTables = ['users', 'Company', 'accounts', 'products', 'customers', 'stores', 'currencies'];
    console.log('📋 Checking key tables...\n');
    
    for (const table of keyTables) {
      const [result] = await sequelize.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :table)`,
        { replacements: { table }, type: QueryTypes.SELECT }
      );
      const exists = result.exists;
      console.log(`${exists ? '✅' : '❌'} ${table}: ${exists ? 'EXISTS' : 'MISSING'}`);
    }

    // Check migrations
    console.log('\n📦 Checking migrations...');
    const [migrations] = await sequelize.query(
      'SELECT COUNT(*) as count FROM "SequelizeMeta"',
      { type: QueryTypes.SELECT }
    );
    console.log(`   Migrations run: ${migrations.count}`);

    // Check total tables
    const [tables] = await sequelize.query(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      { type: QueryTypes.SELECT }
    );
    console.log(`   Total tables: ${tables.count}`);

    console.log('\n✅ Quick verification complete!');
    console.log('💡 Run "npm run verify:railway" for detailed verification\n');
    
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

