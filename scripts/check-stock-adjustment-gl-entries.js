#!/usr/bin/env node

/**
 * Check Stock Adjustment General Ledger entries to see if they have the same reference number issue
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

async function checkStockAdjustmentGL() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');

    // Find stock adjustments that have been approved
    const stockAdjustments = await railwaySequelize.query(`
      SELECT 
        id,
        reference_number,
        status,
        "companyId",
        created_at
      FROM stock_adjustments 
      WHERE status = 'approved'
      ORDER BY created_at DESC
      LIMIT 5;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log(`📋 Found ${stockAdjustments.length} approved stock adjustments:\n`);

    for (const sa of stockAdjustments) {
      console.log(`   Reference: ${sa.reference_number}`);
      console.log(`   Status: ${sa.status}`);
      console.log(`   Company ID: ${sa.companyId}`);
      
      // Check how many GL entries exist for this reference number
      const glEntries = await railwaySequelize.query(`
        SELECT 
          id,
          reference_number,
          account_nature,
          account_name,
          amount,
          "companyId"
        FROM general_ledger
        WHERE reference_number = :refNumber
          AND "companyId" = :companyId
        ORDER BY account_nature, id;
      `, {
        replacements: { 
          refNumber: sa.reference_number,
          companyId: sa.companyId
        },
        type: railwaySequelize.QueryTypes.SELECT
      });

      console.log(`   GL Entries: ${glEntries.length}`);
      
      if (glEntries.length > 1) {
        console.log(`   ✅ Multiple GL entries found (expected for double-entry):`);
        for (const gl of glEntries) {
          console.log(`      - ${gl.account_nature}: ${gl.account_name} (${gl.amount})`);
        }
      } else if (glEntries.length === 1) {
        console.log(`   ⚠️  Only 1 GL entry found (should be 2 for double-entry)`);
      } else {
        console.log(`   ⚠️  No GL entries found`);
      }
      
      console.log('');
    }

    // Check for any duplicate reference_number issues
    console.log('🔍 Checking for duplicate reference_number issues...\n');
    
    const duplicates = await railwaySequelize.query(`
      SELECT 
        reference_number,
        "companyId",
        COUNT(*) as entry_count
      FROM general_ledger
      WHERE transaction_type = 'STOCK_ADJUSTMENT'
      GROUP BY reference_number, "companyId"
      HAVING COUNT(*) > 2
      ORDER BY entry_count DESC
      LIMIT 10;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    if (duplicates.length > 0) {
      console.log(`   Found ${duplicates.length} reference numbers with more than 2 entries:`);
      for (const dup of duplicates) {
        console.log(`      - ${dup.reference_number} (${dup.companyId}): ${dup.entry_count} entries`);
      }
    } else {
      console.log('   ✅ No issues found - all reference numbers have 2 or fewer entries');
    }

    // Check if there are any constraint violations that might have occurred
    console.log('\n🔍 Checking for potential constraint issues...\n');
    
    // Get all unique reference numbers in GL for stock adjustments
    const allRefNumbers = await railwaySequelize.query(`
      SELECT DISTINCT reference_number, "companyId"
      FROM general_ledger
      WHERE transaction_type = 'STOCK_ADJUSTMENT'
      ORDER BY reference_number
      LIMIT 20;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log(`   Sample of ${allRefNumbers.length} stock adjustment reference numbers in GL:`);
    for (const ref of allRefNumbers.slice(0, 5)) {
      const count = await railwaySequelize.query(`
        SELECT COUNT(*) as count
        FROM general_ledger
        WHERE reference_number = :refNumber
          AND "companyId" = :companyId;
      `, {
        replacements: { 
          refNumber: ref.reference_number,
          companyId: ref.companyId
        },
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      console.log(`      - ${ref.reference_number}: ${count[0].count} entries`);
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

checkStockAdjustmentGL();

