#!/usr/bin/env node

/**
 * Fix Missing Primary Keys in Railway Database
 * 
 * Fixes primary keys for:
 * - receipt_items
 * - tax_codes
 * 
 * Usage: node scripts/fix-railway-primary-keys.js
 */

require('dotenv').config();
const railwayDbConfig = require('../config/railway-db');

const railwaySequelize = railwayDbConfig.createRailwaySequelize();

async function checkTableExists(sequelize, tableName) {
  const [result] = await sequelize.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = :tableName
    ) as exists;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return result.exists;
}

async function checkPrimaryKeyExists(sequelize, tableName) {
  const [result] = await sequelize.query(`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = :tableName 
    AND constraint_type = 'PRIMARY KEY';
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return result && result.constraint_name;
}

async function checkColumnExists(sequelize, tableName, columnName) {
  const [result] = await sequelize.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = :tableName 
    AND column_name = :columnName;
  `, {
    replacements: { tableName, columnName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return result;
}

async function fixPrimaryKey(sequelize, tableName, columnName) {
  console.log(`\n🔍 Checking ${tableName} table...`);
  
  const tableExists = await checkTableExists(sequelize, tableName);
  if (!tableExists) {
    console.log(`   ⚠️  Table ${tableName} does not exist. Skipping.`);
    return false;
  }
  
  const pkExists = await checkPrimaryKeyExists(sequelize, tableName);
  if (pkExists) {
    console.log(`   ✅ Primary key already exists: ${pkExists}`);
    return true;
  }
  
  const columnInfo = await checkColumnExists(sequelize, tableName, columnName);
  if (!columnInfo) {
    console.log(`   ❌ Column ${columnName} does not exist in ${tableName}. Cannot add primary key.`);
    return false;
  }
  
  console.log(`   📋 Found column: ${columnName} (${columnInfo.data_type}, nullable: ${columnInfo.is_nullable})`);
  
  // Check if column has NULL values
  const [nullCheck] = await sequelize.query(`
    SELECT COUNT(*) as null_count
    FROM "${tableName}"
    WHERE "${columnName}" IS NULL;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  if (nullCheck.null_count > 0) {
    console.log(`   ⚠️  Warning: Column has ${nullCheck.null_count} NULL values. Primary key requires NOT NULL.`);
    
    // Try to make column NOT NULL first
    try {
      await sequelize.query(`
        ALTER TABLE "${tableName}" 
        ALTER COLUMN "${columnName}" SET NOT NULL;
      `);
      console.log(`   ✅ Set column to NOT NULL`);
    } catch (error) {
      console.log(`   ❌ Cannot set column to NOT NULL: ${error.message}`);
      return false;
    }
  }
  
  // Add primary key
  try {
    const constraintName = `${tableName}_pkey`;
    
    // First, ensure the column is NOT NULL
    try {
      await sequelize.query(`
        ALTER TABLE "${tableName}" 
        ALTER COLUMN "${columnName}" SET NOT NULL;
      `, { raw: true });
    } catch (notNullError) {
      // Ignore if already NOT NULL or other errors
      if (!notNullError.message.includes('already')) {
        console.log(`   ⚠️  Warning setting NOT NULL: ${notNullError.message}`);
      }
    }
    
    // Check for duplicates before adding primary key
    const [duplicateCheck] = await sequelize.query(`
      SELECT COUNT(*) as total, COUNT(DISTINCT "${columnName}") as distinct_count
      FROM "${tableName}";
    `, { type: sequelize.QueryTypes.SELECT });
    
    if (duplicateCheck.total !== duplicateCheck.distinct_count) {
      console.log(`   ❌ Cannot add primary key: Found duplicate values in ${columnName}`);
      console.log(`      Total: ${duplicateCheck.total}, Distinct: ${duplicateCheck.distinct_count}`);
      return false;
    }
    
    // Add primary key using raw query
    await sequelize.query(`
      ALTER TABLE "${tableName}" 
      ADD CONSTRAINT "${constraintName}" 
      PRIMARY KEY ("${columnName}");
    `, { raw: true });
    console.log(`   ✅ Successfully added primary key: ${constraintName}`);
    return true;
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('duplicate key')) {
      console.log(`   ✅ Primary key already exists (this is fine)`);
      return true;
    } else {
      console.log(`   ❌ Error adding primary key: ${error.message}`);
      console.log(`   Error details:`, error);
      return false;
    }
  }
}

async function main() {
  console.log('🔧 FIXING MISSING PRIMARY KEYS IN RAILWAY DATABASE\n');
  console.log('='.repeat(80));
  
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
  } catch (error) {
    console.error('❌ Failed to connect to Railway database:', error.message);
    process.exit(1);
  }
  
  const results = {
    receipt_items: false,
    tax_codes: false
  };
  
  // Fix receipt_items
  results.receipt_items = await fixPrimaryKey(railwaySequelize, 'receipt_items', 'id');
  
  // Fix tax_codes
  results.tax_codes = await fixPrimaryKey(railwaySequelize, 'tax_codes', 'id');
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`receipt_items: ${results.receipt_items ? '✅ Fixed' : '❌ Failed'}`);
  console.log(`tax_codes: ${results.tax_codes ? '✅ Fixed' : '❌ Failed'}`);
  console.log('='.repeat(80));
  
  if (results.receipt_items && results.tax_codes) {
    console.log('\n✅ All primary keys fixed successfully!');
  } else {
    console.log('\n⚠️  Some primary keys could not be fixed. Please review the errors above.');
  }
  
  await railwaySequelize.close();
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

