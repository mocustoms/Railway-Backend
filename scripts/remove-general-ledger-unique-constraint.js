#!/usr/bin/env node

/**
 * Remove unique constraint on general_ledger (reference_number, companyId) on Railway
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

const railwayUrl = process.env.RAILWAY_DATABASE_URL || 'postgresql://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';

const railwaySequelize = new Sequelize(railwayUrl, {
  dialect: 'postgres',
  logging: console.log,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

async function removeConstraint() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');

    // Check for unique constraints
    const constraints = await railwaySequelize.query(`
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
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log(`Found ${constraints.length} unique constraint(s):`);
    for (const constraint of constraints) {
      console.log(`  - ${constraint.constraint_name}`);
      console.log(`    ${constraint.constraint_definition}`);
    }

    // Check for unique indexes
    const indexes = await railwaySequelize.query(`
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'general_ledger'
        AND (indexdef LIKE '%UNIQUE%' OR indexname LIKE '%unique%')
      ORDER BY indexname;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log(`\nFound ${indexes.length} unique index(es):`);
    for (const idx of indexes) {
      console.log(`  - ${idx.indexname}`);
      console.log(`    ${idx.indexdef}`);
    }

    // Try to drop the unique index
    console.log('\n🔄 Attempting to drop unique index...');
    try {
      await railwaySequelize.query(`
        DROP INDEX IF EXISTS "general_ledger_reference_number_companyId_unique" CASCADE;
      `);
      console.log('   ✅ Dropped index (if it existed)');
    } catch (error) {
      console.log(`   ⚠️  Error dropping index: ${error.message}`);
    }

    // Try to drop as constraint
    console.log('\n🔄 Attempting to drop unique constraint...');
    try {
      await railwaySequelize.query(`
        ALTER TABLE general_ledger 
        DROP CONSTRAINT IF EXISTS "general_ledger_reference_number_companyId_unique" CASCADE;
      `);
      console.log('   ✅ Dropped constraint (if it existed)');
    } catch (error) {
      console.log(`   ⚠️  Error dropping constraint: ${error.message}`);
    }

    // Verify it's gone
    console.log('\n🔍 Verifying removal...');
    const remainingIndexes = await railwaySequelize.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'general_ledger'
        AND indexname = 'general_ledger_reference_number_companyId_unique';
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    if (remainingIndexes.length === 0) {
      console.log('   ✅ Unique index/constraint successfully removed');
    } else {
      console.log('   ⚠️  Index still exists');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
  } finally {
    await railwaySequelize.close();
  }
}

removeConstraint();

