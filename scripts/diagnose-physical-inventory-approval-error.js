#!/usr/bin/env node

/**
 * Diagnose Physical Inventory Approval Error on Railway
 * 
 * This script tests the approval process and captures detailed error information
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

// Railway database connection
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

async function diagnoseApprovalError(refNumber) {
  try {
    console.log('🔍 DIAGNOSING PHYSICAL INVENTORY APPROVAL ERROR');
    console.log('='.repeat(60));
    console.log(`Reference Number: ${refNumber || 'Not provided'}\n`);

    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');

    // Find the physical inventory
    let inventory;
    if (refNumber) {
      const [inventories] = await railwaySequelize.query(`
        SELECT * FROM physical_inventories 
        WHERE reference_number = :refNumber
        ORDER BY created_at DESC
        LIMIT 1;
      `, {
        replacements: { refNumber },
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      if (inventories && inventories.length > 0) {
        inventory = inventories[0];
      } else {
        console.log('❌ Physical inventory not found with reference number:', refNumber);
        return;
      }
    } else {
      // Get the most recent submitted inventory
      const [inventories] = await railwaySequelize.query(`
        SELECT * FROM physical_inventories 
        WHERE status = 'submitted'
        ORDER BY created_at DESC
        LIMIT 1;
      `, {
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      if (inventories && inventories.length > 0) {
        inventory = inventories[0];
      } else {
        console.log('❌ No submitted physical inventory found');
        return;
      }
    }

    console.log('📋 Physical Inventory Details:');
    console.log(`   ID: ${inventory.id}`);
    console.log(`   Reference: ${inventory.reference_number}`);
    console.log(`   Status: ${inventory.status}`);
    console.log(`   Store ID: ${inventory.store_id}`);
    console.log(`   Company ID: ${inventory.companyId || inventory['companyId']}`);
    console.log(`   Exchange Rate: ${inventory.exchange_rate}`);
    console.log(`   Created At: ${inventory.created_at}`);
    console.log('');

    // Check items
    const [items] = await railwaySequelize.query(`
      SELECT * FROM physical_inventory_items 
      WHERE physical_inventory_id = :inventoryId
      ORDER BY id;
    `, {
      replacements: { inventoryId: inventory.id },
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log(`📦 Items (${items.length}):`);
    for (const item of items) {
      console.log(`   - Item ID: ${item.id}`);
      console.log(`     Product ID: ${item.product_id}`);
      console.log(`     Adjustment Type: ${item.adjustment_type}`);
      console.log(`     Quantity: ${item.quantity}`);
      console.log(`     System Quantity: ${item.system_quantity}`);
      console.log(`     Exchange Rate: ${item.exchange_rate}`);
      console.log(`     Unit Cost: ${item.unit_cost}`);
      console.log('');
    }

    // Check for required related records
    console.log('🔍 Checking Related Records:');
    
    // Check store
    const [stores] = await railwaySequelize.query(`
      SELECT id, name, "companyId" FROM stores WHERE id = :storeId::uuid;
    `, {
      replacements: { storeId: inventory.store_id },
      type: railwaySequelize.QueryTypes.SELECT
    });
    console.log(`   Store: ${stores.length > 0 ? `✅ Found (${stores[0].name})` : '❌ NOT FOUND'}`);

    // Check currency
    if (inventory.currency_id) {
      const [currencies] = await railwaySequelize.query(`
        SELECT id, code FROM currencies WHERE id = :currencyId;
      `, {
        replacements: { currencyId: inventory.currency_id },
        type: railwaySequelize.QueryTypes.SELECT
      });
      console.log(`   Currency: ${currencies.length > 0 ? `✅ Found (${currencies[0].code})` : '❌ NOT FOUND'}`);
    }

    // Check products for each item
    console.log('\n   Products:');
    for (const item of items) {
      const [products] = await railwaySequelize.query(`
        SELECT id, name, product_type FROM products WHERE id = :productId;
      `, {
        replacements: { productId: item.product_id },
        type: railwaySequelize.QueryTypes.SELECT
      });
      console.log(`     Product ${item.product_id}: ${products.length > 0 ? `✅ Found (${products[0].name})` : '❌ NOT FOUND'}`);
    }

    // Check for user to approve
    const companyId = inventory.companyId || inventory['companyId'];
    const [users] = await railwaySequelize.query(`
      SELECT id, username, name, "companyId" FROM users 
      WHERE "companyId" = :companyId::uuid
      LIMIT 1;
    `, {
      replacements: { companyId },
      type: railwaySequelize.QueryTypes.SELECT
    });
    console.log(`\n   User for approval: ${users.length > 0 ? `✅ Found (${users[0].username})` : '❌ NOT FOUND'}`);

    // Check for validation issues
    console.log('\n🔍 Checking for Validation Issues:');
    
    // Check exchange_rate format
    if (inventory.exchange_rate) {
      const rateStr = String(inventory.exchange_rate);
      const dotCount = (rateStr.match(/\./g) || []).length;
      if (dotCount > 1 || isNaN(parseFloat(rateStr))) {
        console.log(`   ⚠️  Malformed exchange_rate: ${rateStr}`);
      } else {
        console.log(`   ✅ Exchange rate format OK: ${rateStr}`);
      }
    }

    // Check item exchange_rates
    for (const item of items) {
      if (item.exchange_rate) {
        const rateStr = String(item.exchange_rate);
        const dotCount = (rateStr.match(/\./g) || []).length;
        if (dotCount > 1 || isNaN(parseFloat(rateStr))) {
          console.log(`   ⚠️  Item ${item.id} has malformed exchange_rate: ${rateStr}`);
        }
      }
    }

    // Check for null/undefined required fields
    const requiredFields = ['store_id', 'companyId', 'status'];
    for (const field of requiredFields) {
      if (inventory[field] === null || inventory[field] === undefined) {
        console.log(`   ⚠️  Missing required field: ${field}`);
      }
    }

    // Try to simulate the approval update
    console.log('\n🧪 Testing Approval Update:');
    if (users.length > 0) {
      const testTransaction = await railwaySequelize.transaction();
      try {
        // Try to update status
        const [updateResult] = await railwaySequelize.query(`
          UPDATE physical_inventories 
          SET 
            status = 'approved',
            approved_by = :userId::uuid,
            approved_at = NOW(),
            approval_notes = 'Test approval'
          WHERE id = :inventoryId::uuid
          RETURNING id, status, approved_by, approved_at;
        `, {
          replacements: { 
            inventoryId: inventory.id,
            userId: users[0].id
          },
          type: railwaySequelize.QueryTypes.SELECT,
          transaction: testTransaction
        });

        if (updateResult && updateResult.length > 0) {
          console.log('   ✅ Direct SQL update succeeded');
          console.log(`      Status: ${updateResult[0].status}`);
          console.log(`      Approved By: ${updateResult[0].approved_by}`);
        } else {
          console.log('   ❌ Direct SQL update returned no rows');
        }

        await testTransaction.rollback();
        console.log('   ✅ Transaction rolled back (test only)');
      } catch (updateError) {
        await testTransaction.rollback();
        console.log(`   ❌ Update failed: ${updateError.message}`);
        console.log(`      Code: ${updateError.code}`);
        if (updateError.detail) {
          console.log(`      Detail: ${updateError.detail}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Diagnosis complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
  } finally {
    await railwaySequelize.close();
  }
}

// Get reference number from command line
const refNumber = process.argv[2];

diagnoseApprovalError(refNumber).catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

