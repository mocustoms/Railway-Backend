#!/usr/bin/env node

/**
 * Fix Product Categories Unique Constraint
 * 
 * Removes old unique constraint on 'code' only and ensures
 * composite unique constraint on (code, companyId) exists
 */

require('dotenv').config();
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function fixUniqueConstraint() {
  const railwayDbUrl = process.argv[2];
  if (!railwayDbUrl) {
    console.error('❌ Please provide Railway database URL as argument');
    console.log('Usage: node scripts/fix-product-categories-unique-constraint.js <RAILWAY_DB_URL>');
    process.exit(1);
  }

  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔄 Fixing product_categories unique constraint...');
    console.log('='.repeat(80));
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Check existing constraints/indexes
    const constraints = await railwaySequelize.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'product_categories'::regclass
      AND contype IN ('u', 'x'); -- 'u' = unique, 'x' = exclusion
    `, { type: require('sequelize').QueryTypes.SELECT });

    console.log('📋 Existing constraints:');
    constraints.forEach(c => {
      console.log(`   - ${c.constraint_name}: ${c.constraint_definition}`);
    });

    // Check indexes
    const indexes = await railwaySequelize.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'product_categories'
      AND schemaname = 'public';
    `, { type: require('sequelize').QueryTypes.SELECT });

    console.log('\n📋 Existing indexes:');
    indexes.forEach(idx => {
      console.log(`   - ${idx.indexname}: ${idx.indexdef}`);
    });

    // Drop ALL old unique indexes/constraints on just 'code' (without companyId)
    const oldIndexes = indexes.filter(idx => 
      (idx.indexname.includes('code') && idx.indexdef.includes('UNIQUE') && !idx.indexdef.includes('companyId')) ||
      idx.indexname === 'product_categories_code_idx' ||
      idx.indexname === 'product_categories_code_idx1'
    );

    if (oldIndexes.length > 0) {
      console.log(`\n🗑️  Dropping ${oldIndexes.length} old unique index(es) on 'code' only...`);
      for (const oldIndex of oldIndexes) {
        try {
          console.log(`   Dropping: ${oldIndex.indexname}`);
          await railwaySequelize.query(`
            DROP INDEX IF EXISTS "${oldIndex.indexname}";
          `);
          console.log(`   ✅ Dropped ${oldIndex.indexname}`);
        } catch (error) {
          console.log(`   ⚠️  Could not drop ${oldIndex.indexname}: ${error.message}`);
        }
      }
    }

    // Also try dropping as constraints
    const oldConstraints = constraints.filter(c => 
      (c.constraint_definition.includes('UNIQUE') && c.constraint_definition.includes('code') && !c.constraint_definition.includes('companyId')) ||
      c.constraint_name === 'product_categories_code_idx' ||
      c.constraint_name === 'product_categories_code_idx1'
    );

    if (oldConstraints.length > 0) {
      console.log(`\n🗑️  Dropping ${oldConstraints.length} old unique constraint(s) on 'code' only...`);
      for (const oldConstraint of oldConstraints) {
        try {
          console.log(`   Dropping constraint: ${oldConstraint.constraint_name}`);
          await railwaySequelize.query(`
            ALTER TABLE "product_categories"
            DROP CONSTRAINT IF EXISTS "${oldConstraint.constraint_name}";
          `);
          console.log(`   ✅ Dropped constraint ${oldConstraint.constraint_name}`);
        } catch (error) {
          console.log(`   ⚠️  Could not drop constraint ${oldConstraint.constraint_name}: ${error.message}`);
        }
      }
    }

    // Check if composite unique constraint exists
    const compositeConstraint = constraints.find(c => 
      c.constraint_name === 'product_categories_code_companyId_unique' ||
      (c.constraint_definition.includes('UNIQUE') && c.constraint_definition.includes('code') && c.constraint_definition.includes('companyId'))
    );

    if (!compositeConstraint) {
      console.log('\n➕ Creating composite unique constraint (code, companyId)...');
      await railwaySequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "product_categories_code_companyId_unique"
        ON "product_categories" ("code", "companyId");
      `);
      console.log('✅ Created composite unique constraint');
    } else {
      console.log('\n✅ Composite unique constraint already exists');
    }

    // Verify final state
    const finalConstraints = await railwaySequelize.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'product_categories'::regclass
      AND contype IN ('u', 'x');
    `, { type: require('sequelize').QueryTypes.SELECT });

    console.log('\n📋 Final constraints:');
    finalConstraints.forEach(c => {
      console.log(`   ✅ ${c.constraint_name}: ${c.constraint_definition}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ Unique constraint fixed successfully!');
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

fixUniqueConstraint().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

