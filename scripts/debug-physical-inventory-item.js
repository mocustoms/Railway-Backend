/**
 * Debug Physical Inventory Item to find malformed values
 */

const sequelize = require('../config/database');
const { PhysicalInventory, PhysicalInventoryItem } = require('../server/models');

async function debugPhysicalInventory(id) {
  try {
    console.log(`\n🔍 Debugging Physical Inventory: ${id}`);
    console.log('='.repeat(60));
    
    await sequelize.authenticate();
    
    const physicalInventory = await PhysicalInventory.findByPk(id, {
      include: [
        {
          model: PhysicalInventoryItem,
          as: 'items'
        }
      ]
    });
    
    if (!physicalInventory) {
      console.log('❌ Not found');
      return;
    }
    
    console.log(`\n📋 Physical Inventory:`);
    console.log(`   ID: ${physicalInventory.id}`);
    console.log(`   Reference: ${physicalInventory.reference_number}`);
    console.log(`   Exchange Rate: "${physicalInventory.exchange_rate}" (type: ${typeof physicalInventory.exchange_rate})`);
    
    // Check if exchange_rate is malformed
    const str = String(physicalInventory.exchange_rate);
    const dotCount = (str.match(/\./g) || []).length;
    console.log(`   Decimal points: ${dotCount}`);
    if (dotCount > 1) {
      console.log(`   ⚠️  MALFORMED!`);
    }
    
    console.log(`\n📦 Items (${physicalInventory.items?.length || 0}):`);
    for (const item of physicalInventory.items || []) {
      console.log(`\n   Item ${item.id}:`);
      console.log(`     - counted_quantity: "${item.counted_quantity}" (type: ${typeof item.counted_quantity})`);
      console.log(`     - unit_average_cost: "${item.unit_average_cost}" (type: ${typeof item.unit_average_cost})`);
      console.log(`     - exchange_rate: "${item.exchange_rate}" (type: ${typeof item.exchange_rate})`);
      console.log(`     - unit_cost: "${item.unit_cost}" (type: ${typeof item.unit_cost})`);
      
      // Check each field for malformed values
      const fields = ['counted_quantity', 'unit_average_cost', 'exchange_rate', 'unit_cost', 'equivalent_amount'];
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
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sequelize.close();
  }
}

const id = process.argv[2] || 'dc0284d7-b004-41e2-b088-3de518993391';
debugPhysicalInventory(id);

