#!/usr/bin/env node

/**
 * Verify Cash Customer Migration on Railway
 * 
 * Checks that the cash_customer enum value and customer_id column exist
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

async function main() {
  const railwayDbUrl = process.argv[2] || process.env.DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ DATABASE_URL is required');
    process.exit(1);
  }

  const sequelize = new Sequelize(railwayDbUrl, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    logging: false
  });

  try {
    console.log('');
    console.log('🔍 VERIFYING CASH CUSTOMER MIGRATION');
    console.log('='.repeat(80));
    
    await sequelize.authenticate();
    console.log('✅ Connected to database');
    console.log('');

    // Check enum values
    console.log('📋 Checking enum_linked_accounts_account_type enum...');
    const [enumValues] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'enum_linked_accounts_account_type'
      ) 
      ORDER BY enumsortorder;
    `);
    
    const enumLabels = enumValues.map(v => v.enumlabel);
    const hasCashCustomer = enumLabels.includes('cash_customer');
    
    console.log(`   Found ${enumLabels.length} enum values:`);
    enumLabels.forEach(label => {
      const marker = label === 'cash_customer' ? '✅' : '  ';
      console.log(`   ${marker} ${label}`);
    });
    
    if (hasCashCustomer) {
      console.log('   ✅ cash_customer enum value exists');
    } else {
      console.log('   ❌ cash_customer enum value NOT found');
    }
    console.log('');

    // Check customer_id column
    console.log('📋 Checking customer_id column in linked_accounts table...');
    const [columns] = await sequelize.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'linked_accounts' 
        AND column_name = 'customer_id';
    `);
    
    if (columns.length > 0) {
      const col = columns[0];
      console.log('   ✅ customer_id column exists:');
      console.log(`      - Type: ${col.data_type}`);
      console.log(`      - Nullable: ${col.is_nullable}`);
      if (col.column_default) {
        console.log(`      - Default: ${col.column_default}`);
      }
    } else {
      console.log('   ❌ customer_id column NOT found');
    }
    console.log('');

    // Check index
    console.log('📋 Checking index on customer_id...');
    const [indexes] = await sequelize.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename = 'linked_accounts' 
        AND indexname = 'linked_accounts_customer_id_idx';
    `);
    
    if (indexes.length > 0) {
      console.log('   ✅ Index exists:');
      console.log(`      - Name: ${indexes[0].indexname}`);
    } else {
      console.log('   ❌ Index NOT found');
    }
    console.log('');

    // Check foreign key constraint
    console.log('📋 Checking foreign key constraint...');
    const [constraints] = await sequelize.query(`
      SELECT 
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'linked_accounts'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'customer_id';
    `);
    
    if (constraints.length > 0) {
      const constraint = constraints[0];
      console.log('   ✅ Foreign key constraint exists:');
      console.log(`      - Name: ${constraint.constraint_name}`);
      console.log(`      - References: ${constraint.foreign_table_name}.${constraint.foreign_column_name}`);
    } else {
      console.log('   ⚠️  Foreign key constraint NOT found (may be defined differently)');
    }
    console.log('');

    // Summary
    console.log('='.repeat(80));
    if (hasCashCustomer && columns.length > 0 && indexes.length > 0) {
      console.log('✅ CASH CUSTOMER MIGRATION VERIFIED SUCCESSFULLY');
      console.log('');
      console.log('All required components are in place:');
      console.log('   ✅ cash_customer enum value');
      console.log('   ✅ customer_id column');
      console.log('   ✅ customer_id index');
    } else {
      console.log('❌ CASH CUSTOMER MIGRATION VERIFICATION FAILED');
      console.log('');
      if (!hasCashCustomer) console.log('   ❌ Missing: cash_customer enum value');
      if (columns.length === 0) console.log('   ❌ Missing: customer_id column');
      if (indexes.length === 0) console.log('   ❌ Missing: customer_id index');
    }
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

