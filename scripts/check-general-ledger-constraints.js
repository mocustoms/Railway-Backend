#!/usr/bin/env node

/**
 * Check General Ledger unique constraints on Railway vs Local
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

// Local database
const localSequelize = new Sequelize(
  process.env.DB_DATABASE || 'easymauzo_pos',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

// Railway database
const railwayUrl = process.env.RAILWAY_DATABASE_URL || 'postgresql://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';
const railwaySequelize = new Sequelize(railwayUrl, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

async function checkConstraints(sequelize, name) {
  try {
    console.log(`\n📊 Checking ${name} database constraints...`);
    
    // Get unique constraints on general_ledger
    const constraints = await sequelize.query(`
      SELECT
        conname as constraint_name,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = (
        SELECT oid FROM pg_class WHERE relname = 'general_ledger'
      )
      AND contype = 'u'
      ORDER BY conname;
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`   Found ${constraints.length} unique constraint(s):`);
    for (const constraint of constraints) {
      console.log(`   - ${constraint.constraint_name}`);
      console.log(`     ${constraint.constraint_definition}`);
    }

    // Get indexes on general_ledger
    const indexes = await sequelize.query(`
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'general_ledger'
        AND indexdef LIKE '%UNIQUE%'
      ORDER BY indexname;
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`\n   Found ${indexes.length} unique index(es):`);
    for (const idx of indexes) {
      console.log(`   - ${idx.indexname}`);
      console.log(`     ${idx.indexdef}`);
    }

  } catch (error) {
    console.error(`   ❌ Error checking ${name}:`, error.message);
  }
}

async function main() {
  try {
    await localSequelize.authenticate();
    console.log('✅ Connected to local database');
    await checkConstraints(localSequelize, 'Local');

    await railwaySequelize.authenticate();
    console.log('\n✅ Connected to Railway database');
    await checkConstraints(railwaySequelize, 'Railway');

    console.log('\n' + '='.repeat(60));
    console.log('✅ Comparison complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

main();

