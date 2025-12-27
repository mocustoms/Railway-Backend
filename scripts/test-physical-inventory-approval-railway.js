#!/usr/bin/env node

/**
 * Test Physical Inventory Approval on Railway
 * 
 * Attempts to approve a physical inventory and shows the exact error
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

function parseDatabaseUrl(databaseUrl) {
  let normalizedUrl = databaseUrl.trim().replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalizedUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    username: url.username || 'postgres',
    password: url.password || ''
  };
}

async function main() {
  const refNumber = process.argv[2];
  const railwayDbUrl = process.argv[3] || process.env.RAILWAY_DATABASE_URL;
  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway\n');
    
    // Find the physical inventory by reference number or status
    let inventory;
    if (refNumber) {
      console.log(`🔍 Looking for inventory with reference: ${refNumber}\n`);
      const [found] = await railwaySequelize.query(`
        SELECT id, reference_number, status, "companyId"
        FROM physical_inventories 
        WHERE reference_number = :refNumber
        LIMIT 1;
      `, {
        replacements: { refNumber },
        type: railwaySequelize.QueryTypes.SELECT
      });
      inventory = found;
    } else {
      // Find a submitted physical inventory
      const [found] = await railwaySequelize.query(`
        SELECT id, reference_number, status, "companyId"
        FROM physical_inventories 
        WHERE status = 'submitted'
        LIMIT 1;
      `, {
        type: railwaySequelize.QueryTypes.SELECT
      });
      inventory = found;
    }
    
    if (!inventory) {
      if (refNumber) {
        console.log(`❌ Physical inventory with reference "${refNumber}" not found`);
      } else {
        console.log('⚠️  No submitted physical inventory found');
        console.log('   Checking for any physical inventories...\n');
        
        const [anyInventory] = await railwaySequelize.query(`
          SELECT id, reference_number, status, "companyId"
          FROM physical_inventories 
          LIMIT 1;
        `, {
          type: railwaySequelize.QueryTypes.SELECT
        });
        
        if (anyInventory) {
          console.log(`Found inventory with status: ${anyInventory.status}`);
          console.log(`  ID: ${anyInventory.id}`);
          console.log(`  Reference: ${anyInventory.reference_number}`);
          console.log(`  Company: ${anyInventory.companyId}`);
          console.log('\n💡 You may need to submit an inventory first, or change its status to "submitted" for testing.');
        } else {
          console.log('   No physical inventories found in Railway database');
        }
      }
      return;
    }
    
    console.log(`Found inventory:`);
    console.log(`  ID: ${inventory.id}`);
    console.log(`  Reference: ${inventory.reference_number}`);
    console.log(`  Status: ${inventory.status}`);
    console.log(`  Company: ${inventory.companyId}`);
    console.log('');
    
    // If inventory is not submitted, change it to submitted for testing
    if (inventory.status !== 'submitted') {
      console.log(`⚠️  Inventory status is "${inventory.status}", changing to "submitted" for testing...\n`);
      await railwaySequelize.query(`
        UPDATE physical_inventories 
        SET 
          status = 'submitted',
          approved_by = NULL,
          approved_at = NULL,
          approval_notes = NULL
        WHERE id = :id;
      `, {
        replacements: { id: inventory.id },
        type: railwaySequelize.QueryTypes.RAW
      });
      console.log('✅ Status changed to "submitted"\n');
      inventory.status = 'submitted';
    }
    
    // Get a user from the same company
    const [user] = await railwaySequelize.query(`
      SELECT id, username, "companyId"
      FROM users 
      WHERE "companyId" = :companyId::uuid
      LIMIT 1;
    `, {
      replacements: { companyId: inventory.companyId },
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    if (!user) {
      console.log('❌ No user found for this company');
      return;
    }
    
    console.log(`Using user for approval:`);
    console.log(`  ID: ${user.id}`);
    console.log(`  Username: ${user.username}`);
    console.log('');
    
    // Verify the inventory exists and is submitted
    console.log('🔍 Verifying inventory before approval...');
    const verify = await railwaySequelize.query(`
      SELECT id, status, "companyId"
      FROM physical_inventories 
      WHERE id = :id;
    `, {
      replacements: { id: inventory.id },
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    const verifyResult = Array.isArray(verify) ? verify : (verify && verify.length > 0 ? verify[0] : null);
    
    if (!verifyResult || (Array.isArray(verifyResult) && verifyResult.length === 0)) {
      console.log('❌ Inventory not found after status change!');
      return;
    }
    
    const verifyRow = Array.isArray(verifyResult) ? verifyResult[0] : verifyResult;
    console.log(`   Current status: ${verifyRow.status}`);
    console.log(`   ID: ${verifyRow.id}`);
    console.log('');
    
    // Try to update the inventory
    console.log('🔄 Attempting to approve...\n');
    console.log(`   Inventory ID: ${inventory.id}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Target status: approved\n`);
    
    try {
      // Try direct SQL first to see if it works
      const result = await railwaySequelize.query(`
        UPDATE physical_inventories 
        SET 
          status = 'approved',
          approved_by = '${user.id}'::uuid,
          approved_at = NOW(),
          approval_notes = 'Test approval'
        WHERE id = '${inventory.id}'::uuid
        RETURNING id, status, approved_by, approved_at;
      `, {
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      if (result && result.length > 0) {
        console.log('✅ Approval update SUCCESSFUL!');
        console.log(`   Updated ID: ${result[0].id}`);
        console.log(`   New Status: ${result[0].status}`);
        console.log(`   Approved By: ${result[0].approved_by}`);
        console.log(`   Approved At: ${result[0].approved_at}`);
        
        // Rollback the test
        console.log('\n🔄 Rolling back test update...');
        await railwaySequelize.query(`
          UPDATE physical_inventories 
          SET 
            status = 'submitted',
            approved_by = NULL,
            approved_at = NULL,
            approval_notes = NULL
          WHERE id = :id;
        `, {
          replacements: { id: inventory.id },
          type: railwaySequelize.QueryTypes.RAW
        });
        console.log('✅ Test rolled back');
      } else {
        console.log('❌ Update returned no rows');
        console.log('   This might indicate a WHERE clause issue or row-level security');
      }
    } catch (error) {
      console.log('❌ Approval update FAILED!');
      console.log(`   Error: ${error.message}`);
      console.log(`   Code: ${error.code || 'N/A'}`);
      console.log(`   Detail: ${error.detail || 'N/A'}`);
      console.log(`   Hint: ${error.hint || 'N/A'}`);
      
      if (error.original) {
        console.log(`\n   Original Error: ${error.original.message}`);
        console.log(`   Original Code: ${error.original.code || 'N/A'}`);
      }
      
      if (error.stack) {
        console.log(`\n   Stack: ${error.stack.substring(0, 500)}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

main().catch(console.error);

