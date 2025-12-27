const { Sequelize } = require('sequelize');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Parse DATABASE_URL or use individual variables
const parseDatabaseUrl = () => {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: url.port || 5432,
      database: url.pathname.slice(1),
      username: url.username,
      password: url.password,
      dialect: 'postgres',
      logging: false
    };
  }
  
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'easymauzo',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    dialect: 'postgres',
    logging: false
  };
};

const dbConfig = parseDatabaseUrl();

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
  host: dbConfig.host,
  port: dbConfig.port,
  dialect: 'postgres',
  logging: false
});

async function testPhysicalInventoryApproval() {
  const referenceNumber = 'PI-1763382086931-343';
  
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    // Find the physical inventory
    const physicalInventories = await sequelize.query(`
      SELECT 
        id,
        reference_number,
        status,
        inventory_account_id,
        gain_account_id,
        loss_account_id,
        inventory_in_account_id,
        inventory_in_corresponding_account_id,
        inventory_out_account_id,
        inventory_out_corresponding_account_id,
        store_id,
        inventory_date,
        "companyId"
      FROM physical_inventories
      WHERE reference_number = :referenceNumber
    `, {
      replacements: { referenceNumber },
      type: Sequelize.QueryTypes.SELECT
    });
    
    if (!physicalInventories || physicalInventories.length === 0) {
      console.log(`❌ Physical inventory with reference number ${referenceNumber} not found`);
      return;
    }
    
    const pi = physicalInventories[0];
    console.log('\n📋 Physical Inventory Details:');
    console.log('ID:', pi.id);
    console.log('Reference Number:', pi.reference_number);
    console.log('Status:', pi.status);
    console.log('Company ID:', pi.companyId);
    console.log('\n📊 Account IDs:');
    console.log('inventory_account_id:', pi.inventory_account_id || '❌ NOT SET');
    console.log('gain_account_id:', pi.gain_account_id || '❌ NOT SET');
    console.log('loss_account_id:', pi.loss_account_id || '❌ NOT SET');
    console.log('inventory_in_account_id:', pi.inventory_in_account_id || '❌ NOT SET');
    console.log('inventory_in_corresponding_account_id:', pi.inventory_in_corresponding_account_id || '❌ NOT SET');
    console.log('inventory_out_account_id:', pi.inventory_out_account_id || '❌ NOT SET');
    console.log('inventory_out_corresponding_account_id:', pi.inventory_out_corresponding_account_id || '❌ NOT SET');
    
    // Check if accounts exist
    if (pi.inventory_account_id) {
      const inventoryAccounts = await sequelize.query(`
        SELECT id, code, name FROM accounts WHERE id = :accountId
      `, {
        replacements: { accountId: pi.inventory_account_id },
        type: Sequelize.QueryTypes.SELECT
      });
      console.log('\n✅ Inventory Account:', inventoryAccounts.length > 0 ? `${inventoryAccounts[0].code} - ${inventoryAccounts[0].name}` : '❌ NOT FOUND');
    }
    
    if (pi.gain_account_id) {
      const gainAccounts = await sequelize.query(`
        SELECT id, code, name FROM accounts WHERE id = :accountId
      `, {
        replacements: { accountId: pi.gain_account_id },
        type: Sequelize.QueryTypes.SELECT
      });
      console.log('✅ Gain Account:', gainAccounts.length > 0 ? `${gainAccounts[0].code} - ${gainAccounts[0].name}` : '❌ NOT FOUND');
    }
    
    if (pi.loss_account_id) {
      const lossAccounts = await sequelize.query(`
        SELECT id, code, name FROM accounts WHERE id = :accountId
      `, {
        replacements: { accountId: pi.loss_account_id },
        type: Sequelize.QueryTypes.SELECT
      });
      console.log('✅ Loss Account:', lossAccounts.length > 0 ? `${lossAccounts[0].code} - ${lossAccounts[0].name}` : '❌ NOT FOUND');
    }
    
    // Check items
    const items = await sequelize.query(`
      SELECT 
        id,
        product_id,
        current_quantity,
        counted_quantity,
        delta_quantity,
        unit_cost,
        delta_value
      FROM physical_inventory_items
      WHERE physical_inventory_id = :piId
    `, {
      replacements: { piId: pi.id },
      type: Sequelize.QueryTypes.SELECT
    });
    
    console.log(`\n📦 Items: ${items.length}`);
    if (items.length > 0) {
      const gains = items.filter(item => parseFloat(item.delta_quantity) > 0);
      const losses = items.filter(item => parseFloat(item.delta_quantity) < 0);
      console.log(`  - Gains: ${gains.length}`);
      console.log(`  - Losses: ${losses.length}`);
      
      if (gains.length > 0 && !pi.gain_account_id) {
        console.log('⚠️  WARNING: Items with gains found but gain_account_id is not set!');
      }
      if (losses.length > 0 && !pi.loss_account_id) {
        console.log('⚠️  WARNING: Items with losses found but loss_account_id is not set!');
      }
    }
    
    // Check if we can find a user to use for approval
    const users = await sequelize.query(`
      SELECT id, username FROM users 
      WHERE "companyId" = :companyId 
      LIMIT 1
    `, {
      replacements: { companyId: pi.companyId },
      type: Sequelize.QueryTypes.SELECT
    });
    
    if (users.length === 0) {
      console.log('\n❌ No user found for this company');
      return;
    }
    
    const user = users[0];
    console.log(`\n👤 Test User: ${user.username}`);
    
    // Check if approval is possible
    console.log('\n🔍 Approval Status Check:');
    if (pi.status !== 'submitted') {
      console.log(`❌ Cannot approve: Status is "${pi.status}", must be "submitted"`);
      console.log('\n💡 To test approval, you need to:');
      console.log('   1. Ensure inventory_account_id, gain_account_id, and loss_account_id are set');
      console.log('   2. Submit the physical inventory (change status to "submitted")');
      console.log('   3. Then run the approval');
    } else {
      if (!pi.inventory_account_id) {
        console.log('❌ Cannot approve: inventory_account_id is not set');
      } else {
        console.log('✅ Status is "submitted"');
        console.log('✅ inventory_account_id is set');
        
        if (items.length > 0) {
          const hasGains = items.some(item => parseFloat(item.delta_quantity) > 0);
          const hasLosses = items.some(item => parseFloat(item.delta_quantity) < 0);
          
          if (hasGains && !pi.gain_account_id) {
            console.log('❌ Cannot approve: gain_account_id is required but not set');
          } else if (hasGains) {
            console.log('✅ gain_account_id is set');
          }
          
          if (hasLosses && !pi.loss_account_id) {
            console.log('❌ Cannot approve: loss_account_id is required but not set');
          } else if (hasLosses) {
            console.log('✅ loss_account_id is set');
          }
        }
        
        console.log('\n✅ All requirements met! Approval should work.');
      }
    }
    
    // If accounts are missing but reason accounts exist, suggest mapping
    if (!pi.inventory_account_id && pi.inventory_in_account_id) {
      console.log('\n💡 Suggestion: Map inventory_in_account_id to inventory_account_id');
      console.log('   UPDATE physical_inventories');
      console.log(`   SET inventory_account_id = '${pi.inventory_in_account_id}'`);
      console.log(`   WHERE id = '${pi.id}';`);
    }
    
    if (!pi.gain_account_id && pi.inventory_in_corresponding_account_id) {
      console.log('\n💡 Suggestion: Map inventory_in_corresponding_account_id to gain_account_id');
      console.log('   UPDATE physical_inventories');
      console.log(`   SET gain_account_id = '${pi.inventory_in_corresponding_account_id}'`);
      console.log(`   WHERE id = '${pi.id}';`);
    }
    
    if (!pi.loss_account_id && pi.inventory_out_corresponding_account_id) {
      console.log('\n💡 Suggestion: Map inventory_out_corresponding_account_id to loss_account_id');
      console.log('   UPDATE physical_inventories');
      console.log(`   SET loss_account_id = '${pi.inventory_out_corresponding_account_id}'`);
      console.log(`   WHERE id = '${pi.id}';`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

testPhysicalInventoryApproval();

