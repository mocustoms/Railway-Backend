/**
 * Test Approving Physical Inventory
 * Attempts to approve a physical inventory to find the exact error
 */

const sequelize = require('../config/database');
const { PhysicalInventory, User } = require('../server/models');
const PhysicalInventoryService = require('../server/services/physicalInventoryService');

async function testApprovePhysicalInventory(refNumber) {
  try {
    console.log(`\n🧪 Testing Approval for: ${refNumber}`);
    console.log('='.repeat(60));
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection successful\n');
    
    // Find the physical inventory
    const physicalInventory = await PhysicalInventory.findOne({
      where: { reference_number: refNumber }
    });
    
    if (!physicalInventory) {
      console.log(`❌ Physical Inventory "${refNumber}" not found`);
      return;
    }
    
    console.log(`✅ Found Physical Inventory: ${refNumber}`);
    console.log(`   ID: ${physicalInventory.id}`);
    console.log(`   Status: ${physicalInventory.status}`);
    console.log(`   Exchange Rate: ${physicalInventory.exchange_rate} (type: ${typeof physicalInventory.exchange_rate})`);
    
    // Get the user who created it
    const user = await User.findByPk(physicalInventory.created_by);
    if (!user) {
      console.log(`❌ User not found`);
      return;
    }
    
    console.log(`   User: ${user.username} (ID: ${user.id})`);
    console.log(`   Company ID: ${user.companyId || physicalInventory.companyId}\n`);
    
    // Try to approve
    console.log('🔄 Attempting to approve...\n');
    
    try {
      const result = await PhysicalInventoryService.approvePhysicalInventory(
        physicalInventory.id,
        user,
        'Test approval'
      );
      
      console.log('✅ Approval successful!');
      console.log(`   New Status: ${result.status}`);
      
    } catch (error) {
      console.log('❌ Approval failed with error:');
      console.log(`   Message: ${error.message}`);
      console.log(`   Stack: ${error.stack}\n`);
      
      // Check the exchange rate more carefully
      console.log('🔍 Detailed Exchange Rate Analysis:');
      const exchangeRate = physicalInventory.exchange_rate;
      console.log(`   Raw value: "${exchangeRate}"`);
      console.log(`   Type: ${typeof exchangeRate}`);
      console.log(`   String representation: "${String(exchangeRate)}"`);
      
      // Check if it's malformed
      const str = String(exchangeRate);
      const dotCount = (str.match(/\./g) || []).length;
      console.log(`   Decimal point count: ${dotCount}`);
      
      if (dotCount > 1) {
        console.log(`   ⚠️  MALFORMED: Multiple decimal points detected!`);
      }
      
      // Try to parse it
      try {
        const parsed = parseFloat(exchangeRate);
        console.log(`   Parsed as float: ${parsed}`);
        console.log(`   Is NaN: ${isNaN(parsed)}`);
      } catch (parseError) {
        console.log(`   ❌ Parse error: ${parseError.message}`);
      }
      
      // Check items
      const { PhysicalInventoryItem } = require('../server/models');
      const items = await PhysicalInventoryItem.findAll({
        where: { physical_inventory_id: physicalInventory.id }
      });
      
      console.log(`\n📦 Checking ${items.length} items for issues...`);
      for (const item of items) {
        console.log(`\n   Item ${item.id}:`);
        console.log(`     - counted_quantity: ${item.counted_quantity} (type: ${typeof item.counted_quantity})`);
        console.log(`     - unit_average_cost: ${item.unit_average_cost} (type: ${typeof item.unit_average_cost})`);
        console.log(`     - exchange_rate: ${item.exchange_rate} (type: ${typeof item.exchange_rate})`);
        
        // Check each for malformed values
        const fields = ['counted_quantity', 'unit_average_cost', 'exchange_rate'];
        for (const field of fields) {
          const value = item[field];
          if (value !== null && value !== undefined) {
            const str = String(value);
            const dotCount = (str.match(/\./g) || []).length;
            if (dotCount > 1) {
              console.log(`     ⚠️  ${field} is MALFORMED: "${value}" (${dotCount} decimal points)`);
            }
          }
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Get reference number from command line
const refNumber = process.argv[2] || 'PI-1762939076082-995';

testApprovePhysicalInventory(refNumber);

