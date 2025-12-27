/**
 * Test Physical Inventory by Reference Number
 * Tests a specific physical inventory to find and fix issues
 */

const sequelize = require('../config/database');
const { PhysicalInventory, PhysicalInventoryItem } = require('../server/models');

// Import the cleaning functions
const { cleanNumericString, safeParseNumeric, isMalformed } = require('./clean-malformed-numeric-values');

async function testPhysicalInventory(refNumber) {
  try {
    console.log(`\n🔍 Testing Physical Inventory: ${refNumber}`);
    console.log('='.repeat(60));
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection successful\n');
    
    // Find the physical inventory
    const physicalInventory = await PhysicalInventory.findOne({
      where: { reference_number: refNumber },
      include: [
        {
          model: PhysicalInventoryItem,
          as: 'items',
          required: false
        }
      ]
    });
    
    if (!physicalInventory) {
      console.log(`❌ Physical Inventory "${refNumber}" not found`);
      return;
    }
    
    console.log(`✅ Found Physical Inventory: ${refNumber}`);
    console.log(`   ID: ${physicalInventory.id}`);
    console.log(`   Status: ${physicalInventory.status}`);
    console.log(`   Store ID: ${physicalInventory.store_id}`);
    console.log(`   Currency ID: ${physicalInventory.currency_id}`);
    console.log(`   Exchange Rate: ${physicalInventory.exchange_rate} (type: ${typeof physicalInventory.exchange_rate})`);
    
    // Check for malformed exchange_rate
    if (isMalformed(physicalInventory.exchange_rate)) {
      console.log(`\n⚠️  MALFORMED EXCHANGE RATE DETECTED!`);
      console.log(`   Original: "${physicalInventory.exchange_rate}"`);
      const cleaned = safeParseNumeric(physicalInventory.exchange_rate);
      console.log(`   Cleaned: ${cleaned}`);
      
      // Fix it
      console.log(`\n🔧 Fixing exchange_rate...`);
      await physicalInventory.update({
        exchange_rate: cleaned
      });
      console.log(`   ✅ Fixed exchange_rate: ${cleaned}`);
    } else {
      console.log(`   ✅ Exchange rate is valid`);
    }
    
    // Check items
    console.log(`\n📦 Checking ${physicalInventory.items?.length || 0} items...`);
    
    let itemIssues = 0;
    for (const item of physicalInventory.items || []) {
      const issues = [];
      
      // Check all numeric fields
      const numericFields = [
        'exchange_rate',
        'unit_cost',
        'unit_average_cost',
        'current_quantity',
        'counted_quantity',
        'adjustment_in_quantity',
        'adjustment_out_quantity',
        'delta_quantity',
        'new_stock',
        'total_value',
        'delta_value',
        'equivalent_amount'
      ];
      
      for (const field of numericFields) {
        const value = item[field];
        if (value !== null && value !== undefined && isMalformed(value)) {
          issues.push({
            field,
            original: value,
            cleaned: safeParseNumeric(value)
          });
        }
      }
      
      if (issues.length > 0) {
        itemIssues++;
        console.log(`\n   ⚠️  Item ${item.id} (Product: ${item.product_id}) has ${issues.length} malformed field(s):`);
        for (const issue of issues) {
          console.log(`      - ${issue.field}: "${issue.original}" → ${issue.cleaned}`);
        }
        
        // Fix the item
        console.log(`   🔧 Fixing item ${item.id}...`);
        const updateData = {};
        for (const issue of issues) {
          updateData[issue.field] = issue.cleaned;
        }
        
        await item.update(updateData);
        console.log(`   ✅ Fixed item ${item.id}`);
      }
    }
    
    if (itemIssues === 0) {
      console.log(`   ✅ All items are valid`);
    }
    
    // Try to get the full inventory with all associations
    console.log(`\n📋 Fetching full inventory details...`);
    const PhysicalInventoryService = require('../server/services/physicalInventoryService');
    
    try {
      const fullInventory = await PhysicalInventoryService.getPhysicalInventoryById(physicalInventory.id);
      console.log(`   ✅ Successfully fetched full inventory`);
      console.log(`   Items: ${fullInventory.items?.length || 0}`);
      console.log(`   Store: ${fullInventory.store?.name || 'N/A'}`);
      console.log(`   Currency: ${fullInventory.currency?.code || 'N/A'}`);
    } catch (error) {
      console.log(`   ❌ Error fetching full inventory: ${error.message}`);
    }
    
    // Test approval process (if status is 'submitted')
    if (physicalInventory.status === 'submitted') {
      console.log(`\n🧪 Testing approval process...`);
      console.log(`   Status is 'submitted', testing if approval would work...`);
      
      // Check if we can process items
      try {
        // Just validate, don't actually approve
        const testUser = { id: physicalInventory.created_by, username: 'test', companyId: physicalInventory.companyId };
        
        // Check exchange rate one more time
        const exchangeRate = PhysicalInventoryService.getSafeExchangeRate(physicalInventory, 1.0);
        console.log(`   Exchange rate (cleaned): ${exchangeRate}`);
        
        // Check each item
        for (const item of physicalInventory.items || []) {
          const countedQty = PhysicalInventoryService.safeParseFloat(item.counted_quantity, 0);
          const unitCost = PhysicalInventoryService.safeParseFloat(item.unit_average_cost, 0);
          
          console.log(`   Item ${item.id}:`);
          console.log(`     - Counted Qty: ${countedQty}`);
          console.log(`     - Unit Cost: ${unitCost}`);
          console.log(`     - Exchange Rate: ${exchangeRate}`);
          
          if (isNaN(countedQty) || isNaN(unitCost) || isNaN(exchangeRate)) {
            console.log(`     ❌ Invalid numeric values detected!`);
          } else {
            console.log(`     ✅ All values are valid`);
          }
        }
        
      } catch (error) {
        console.log(`   ❌ Error testing approval: ${error.message}`);
        console.log(`   Stack: ${error.stack}`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Testing complete!');
    console.log('='.repeat(60));
    
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

testPhysicalInventory(refNumber);

