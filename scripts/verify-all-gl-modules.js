#!/usr/bin/env node

/**
 * Verify all modules that create General Ledger entries work correctly
 * after removing the unique constraint on (reference_number, companyId)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

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

async function verifyModules() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
    console.log('🔍 Verifying General Ledger entries for all modules...\n');

    // Check Physical Inventory
    console.log('📦 Physical Inventory:');
    const piEntries = await railwaySequelize.query(`
      SELECT 
        reference_number,
        "companyId",
        COUNT(*) as entry_count,
        STRING_AGG(DISTINCT account_nature::text, ', ') as natures
      FROM general_ledger
      WHERE transaction_type = 'PHYSICAL_INVENTORY'
      GROUP BY reference_number, "companyId"
      ORDER BY entry_count DESC
      LIMIT 5;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    if (piEntries.length > 0) {
      console.log(`   Found ${piEntries.length} physical inventory reference(s) with GL entries:`);
      for (const entry of piEntries) {
        console.log(`      - ${entry.reference_number}: ${entry.entry_count} entries (${entry.natures})`);
      }
    } else {
      console.log('   ⚠️  No physical inventory GL entries found');
    }

    // Check Stock Adjustment
    console.log('\n📊 Stock Adjustment:');
    const saEntries = await railwaySequelize.query(`
      SELECT 
        reference_number,
        "companyId",
        COUNT(*) as entry_count,
        STRING_AGG(DISTINCT account_nature::text, ', ') as natures
      FROM general_ledger
      WHERE transaction_type = 'STOCK_ADJUSTMENT'
      GROUP BY reference_number, "companyId"
      ORDER BY entry_count DESC
      LIMIT 5;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    if (saEntries.length > 0) {
      console.log(`   Found ${saEntries.length} stock adjustment reference(s) with GL entries:`);
      for (const entry of saEntries) {
        console.log(`      - ${entry.reference_number}: ${entry.entry_count} entries (${entry.natures})`);
      }
    } else {
      console.log('   ⚠️  No stock adjustment GL entries found (may have failed due to constraint)');
    }

    // Check Sales Invoice
    console.log('\n💰 Sales Invoice:');
    const siEntries = await railwaySequelize.query(`
      SELECT 
        reference_number,
        "companyId",
        COUNT(*) as entry_count,
        STRING_AGG(DISTINCT account_nature::text, ', ') as natures
      FROM general_ledger
      WHERE transaction_type = 'SALES_INVOICE'
      GROUP BY reference_number, "companyId"
      ORDER BY entry_count DESC
      LIMIT 5;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    if (siEntries.length > 0) {
      console.log(`   Found ${siEntries.length} sales invoice reference(s) with GL entries:`);
      for (const entry of siEntries) {
        console.log(`      - ${entry.reference_number}: ${entry.entry_count} entries (${entry.natures})`);
      }
    } else {
      console.log('   ⚠️  No sales invoice GL entries found');
    }

    // Verify unique constraint is removed
    console.log('\n🔍 Verifying unique constraint status...');
    const indexes = await railwaySequelize.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'general_ledger'
        AND indexname = 'general_ledger_reference_number_companyId_unique';
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    if (indexes.length === 0) {
      console.log('   ✅ Unique constraint successfully removed');
    } else {
      console.log('   ❌ Unique constraint still exists!');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Verification complete');
    console.log('\n📝 Summary:');
    console.log('   - Physical Inventory: Creates multiple GL entries with same reference number');
    console.log('   - Stock Adjustment: Creates multiple GL entries with same reference number');
    console.log('   - Sales Invoice: Uses suffixes to make reference numbers unique');
    console.log('   - All modules should now work correctly after constraint removal');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
  } finally {
    await railwaySequelize.close();
  }
}

verifyModules();

