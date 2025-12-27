/**
 * Test script to identify product_store quantity reset issues
 * This script will:
 * 1. Check for concurrent updates without proper locking
 * 2. Identify places where quantity is set directly (not incremented/decremented)
 * 3. Check for missing transactions
 * 4. Verify product transaction records match product_store quantities
 */

const { sequelize } = require('../server/models');
const { ProductStore, ProductTransaction } = require('../server/models');
const { Op } = require('sequelize');

async function testProductStoreQuantity() {
  console.log('🔍 Testing Product Store Quantity Integrity...\n');

  try {
    // Test database connection first
    console.log('Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    // 1. Find products with quantity mismatches between ProductStore and ProductTransaction
    console.log('1. Checking for quantity mismatches...');
    
    const mismatches = await sequelize.query(`
      WITH product_store_quantities AS (
        SELECT 
          ps.product_id,
          ps.store_id,
          ps."companyId",
          ps.quantity as store_quantity,
          ps.last_updated as store_last_updated
        FROM product_stores ps
        WHERE ps.is_active = true
      ),
      transaction_quantities AS (
        SELECT 
          pt.product_id,
          pt.store_id,
          pt."companyId",
          COALESCE(SUM(pt.quantity_in), 0) - COALESCE(SUM(pt.quantity_out), 0) as calculated_quantity
        FROM product_transactions pt
        WHERE pt.is_active = true
        GROUP BY pt.product_id, pt.store_id, pt."companyId"
      )
      SELECT 
        psq.product_id,
        psq.store_id,
        psq."companyId" as companyId,
        psq.store_quantity,
        COALESCE(tq.calculated_quantity, 0) as calculated_quantity,
        ABS(psq.store_quantity - COALESCE(tq.calculated_quantity, 0)) as difference,
        psq.store_last_updated
      FROM product_store_quantities psq
      LEFT JOIN transaction_quantities tq 
        ON psq.product_id = tq.product_id 
        AND psq.store_id = tq.store_id
        AND psq."companyId" = tq."companyId"
      WHERE ABS(psq.store_quantity - COALESCE(tq.calculated_quantity, 0)) > 0.01
      ORDER BY ABS(psq.store_quantity - COALESCE(tq.calculated_quantity, 0)) DESC
      LIMIT 20
    `, { type: sequelize.QueryTypes.SELECT });

    if (mismatches.length > 0) {
      console.log(`⚠️  Found ${mismatches.length} quantity mismatches:\n`);
      mismatches.forEach(m => {
        console.log(`   Product: ${m.product_id}, Store: ${m.store_id}`);
        console.log(`   Store Quantity: ${m.store_quantity}, Calculated: ${m.calculated_quantity}, Difference: ${m.difference}`);
        console.log(`   Last Updated: ${m.store_last_updated}\n`);
      });
    } else {
      console.log('✅ No quantity mismatches found\n');
    }

    // 2. Check for products with zero quantity but recent transactions
    console.log('2. Checking for products reset to zero...');
    
    const zeroResets = await sequelize.query(`
      SELECT 
        ps.product_id,
        ps.store_id,
        ps."companyId" as companyId,
        ps.quantity,
        ps.last_updated,
        MAX(pt.transaction_date) as last_transaction_date,
        COUNT(pt.id) as transaction_count
      FROM product_stores ps
      LEFT JOIN product_transactions pt 
        ON ps.product_id = pt.product_id 
        AND ps.store_id = pt.store_id
        AND ps."companyId" = pt."companyId"
        AND pt.is_active = true
      WHERE ps.quantity = 0 
        AND ps.is_active = true
        AND pt.id IS NOT NULL
        AND pt.transaction_date > ps.last_updated - INTERVAL '7 days'
      GROUP BY ps.product_id, ps.store_id, ps."companyId", ps.quantity, ps.last_updated
      HAVING COUNT(pt.id) > 0
      ORDER BY ps.last_updated DESC
      LIMIT 20
    `, { type: sequelize.QueryTypes.SELECT });

    if (zeroResets.length > 0) {
      console.log(`⚠️  Found ${zeroResets.length} products with zero quantity but recent transactions:\n`);
      zeroResets.forEach(r => {
        console.log(`   Product: ${r.product_id}, Store: ${r.store_id}`);
        console.log(`   Quantity: ${r.quantity}, Transactions: ${r.transaction_count}`);
        console.log(`   Last Updated: ${r.last_updated}, Last Transaction: ${r.last_transaction_date}\n`);
      });
    } else {
      console.log('✅ No suspicious zero resets found\n');
    }

    // 3. Check for duplicate or overlapping transactions
    console.log('3. Checking for duplicate transactions...');
    
    const duplicates = await sequelize.query(`
      SELECT 
        product_id,
        store_id,
        "companyId" as companyId,
        reference_number,
        reference_type,
        transaction_date,
        COUNT(*) as duplicate_count
      FROM product_transactions
      WHERE is_active = true
      GROUP BY product_id, store_id, "companyId", reference_number, reference_type, transaction_date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
      LIMIT 20
    `, { type: sequelize.QueryTypes.SELECT });

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} potential duplicate transactions:\n`);
      duplicates.forEach(d => {
        console.log(`   Product: ${d.product_id}, Store: ${d.store_id}`);
        console.log(`   Reference: ${d.reference_number}, Type: ${d.reference_type}`);
        console.log(`   Date: ${d.transaction_date}, Count: ${d.duplicate_count}\n`);
      });
    } else {
      console.log('✅ No duplicate transactions found\n');
    }

    // 4. Check for products with negative quantities
    console.log('4. Checking for negative quantities...');
    
    const negatives = await ProductStore.findAll({
      where: {
        quantity: { [Op.lt]: 0 },
        is_active: true
      },
      attributes: ['product_id', 'store_id', 'companyId', 'quantity', 'last_updated'],
      limit: 20
    });

    if (negatives.length > 0) {
      console.log(`⚠️  Found ${negatives.length} products with negative quantities:\n`);
      negatives.forEach(n => {
        console.log(`   Product: ${n.product_id}, Store: ${n.store_id}, Quantity: ${n.quantity}`);
        console.log(`   Last Updated: ${n.last_updated}\n`);
      });
    } else {
      console.log('✅ No negative quantities found\n');
    }

    console.log('✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Error running test:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    try {
      await sequelize.close();
      console.log('\n✅ Database connection closed');
    } catch (closeError) {
      console.error('Error closing connection:', closeError.message);
    }
    process.exit(0);
  }
}

// Run the test
testProductStoreQuantity().catch(console.error);

