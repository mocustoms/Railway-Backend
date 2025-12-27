/**
 * Clean Malformed Numeric Values in Database
 * 
 * This script fixes malformed numeric strings like "1.0032.5" in the database
 * by cleaning them to proper numeric values (e.g., "1.00325").
 * 
 * Tables cleaned:
 * - physical_inventories (exchange_rate)
 * - physical_inventory_items (exchange_rate, unit_cost, unit_average_cost, etc.)
 * - stock_adjustments (exchange_rate)
 * - stock_adjustment_items (exchange_rate, unit_cost, etc.)
 * - product_transactions (exchange_rate, equivalent_amount, etc.)
 * - general_ledger (exchange_rate, amount, etc.)
 * 
 * WARNING: This script MODIFIES data in the database.
 * Make sure to backup your database before running this script.
 */

const sequelize = require('../config/database');

/**
 * Clean numeric string to remove multiple decimal points and invalid characters
 * Converts values like "1.0032.5" to "1.00325"
 */
function cleanNumericString(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  // Convert to string and remove all non-numeric characters except first decimal point and minus sign
  let cleaned = String(value).replace(/[^0-9.-]/g, '');
  
  // Handle negative sign - ensure it's only at the start
  const isNegative = cleaned.startsWith('-');
  cleaned = cleaned.replace(/-/g, '');
  if (isNegative) {
    cleaned = '-' + cleaned;
  }
  
  // Handle multiple decimal points by keeping only the first one
  if (cleaned.includes('.')) {
    const firstDotIndex = cleaned.indexOf('.');
    const beforeDot = cleaned.substring(0, firstDotIndex + 1);
    const afterDot = cleaned.substring(firstDotIndex + 1).replace(/\./g, '');
    cleaned = beforeDot + afterDot;
  }
  
  // If empty after cleaning, return null
  if (cleaned === '' || cleaned === '-') {
    return null;
  }
  
  return cleaned;
}

/**
 * Safely parse and clean a numeric value
 */
function safeParseNumeric(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  const cleaned = cleanNumericString(value);
  if (!cleaned) {
    return null;
  }
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Check if a value is malformed (has multiple decimal points)
 */
function isMalformed(value) {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  
  const str = String(value);
  const dotCount = (str.match(/\./g) || []).length;
  return dotCount > 1;
}

async function cleanPhysicalInventories() {
  console.log('\n📦 Cleaning physical_inventories table...');
  
  // Find all records with exchange_rate (we'll check each one)
  const [records] = await sequelize.query(`
    SELECT id, exchange_rate, reference_number
    FROM physical_inventories
    WHERE exchange_rate IS NOT NULL
  `);
  
  console.log(`   Checking ${records.length} records for malformed exchange_rate...`);
  
  let fixed = 0;
  for (const record of records) {
    const originalValue = record.exchange_rate;
    
    // Check if value is malformed
    if (!isMalformed(originalValue)) {
      continue;
    }
    
    const cleanedValue = safeParseNumeric(originalValue);
    
    if (cleanedValue !== null && cleanedValue !== originalValue) {
      try {
        await sequelize.query(`
          UPDATE physical_inventories
          SET exchange_rate = :cleanedValue
          WHERE id = :id
        `, {
          replacements: {
            id: record.id,
            cleanedValue: cleanedValue
          }
        });
        
        fixed++;
        console.log(`   ✅ Fixed ${record.reference_number}: "${originalValue}" → ${cleanedValue}`);
      } catch (error) {
        console.error(`   ❌ Error fixing ${record.reference_number}:`, error.message);
      }
    }
  }
  
  console.log(`   ✅ Fixed ${fixed} records in physical_inventories`);
  return fixed;
}

async function cleanPhysicalInventoryItems() {
  console.log('\n📦 Cleaning physical_inventory_items table...');
  
  const fields = [
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
  
  let totalFixed = 0;
  
  for (const field of fields) {
    // Get all records with this field (we'll check each one)
    const [records] = await sequelize.query(`
      SELECT id, ${field}, physical_inventory_id
      FROM physical_inventory_items
      WHERE ${field} IS NOT NULL
    `);
    
    if (records.length > 0) {
      console.log(`   Checking ${records.length} records for malformed ${field}...`);
      
      let fixed = 0;
      for (const record of records) {
        const originalValue = record[field];
        
        // Check if value is malformed
        if (!isMalformed(originalValue)) {
          continue;
        }
        
        const cleanedValue = safeParseNumeric(originalValue);
        
        if (cleanedValue !== null && cleanedValue !== originalValue) {
          try {
            await sequelize.query(`
              UPDATE physical_inventory_items
              SET ${field} = :cleanedValue
              WHERE id = :id
            `, {
              replacements: {
                id: record.id,
                cleanedValue: cleanedValue
              }
            });
            
            fixed++;
          } catch (error) {
            console.error(`   ❌ Error fixing ${field} for item ${record.id}:`, error.message);
          }
        }
      }
      
      if (fixed > 0) {
        console.log(`   ✅ Fixed ${fixed} records for ${field}`);
        totalFixed += fixed;
      }
    }
  }
  
  console.log(`   ✅ Total fixed: ${totalFixed} records in physical_inventory_items`);
  return totalFixed;
}

async function cleanStockAdjustments() {
  console.log('\n📦 Cleaning stock_adjustments table...');
  
  const [records] = await sequelize.query(`
    SELECT id, exchange_rate, reference_number
    FROM stock_adjustments
    WHERE exchange_rate IS NOT NULL
  `);
  
  console.log(`   Checking ${records.length} records for malformed exchange_rate...`);
  
  let fixed = 0;
  for (const record of records) {
    const originalValue = record.exchange_rate;
    
    // Check if value is malformed
    if (!isMalformed(originalValue)) {
      continue;
    }
    
    const cleanedValue = safeParseNumeric(originalValue);
    
    if (cleanedValue !== null && cleanedValue !== originalValue) {
      try {
        await sequelize.query(`
          UPDATE stock_adjustments
          SET exchange_rate = :cleanedValue
          WHERE id = :id
        `, {
          replacements: {
            id: record.id,
            cleanedValue: cleanedValue
          }
        });
        
        fixed++;
        console.log(`   ✅ Fixed ${record.reference_number}: "${originalValue}" → ${cleanedValue}`);
      } catch (error) {
        console.error(`   ❌ Error fixing ${record.reference_number}:`, error.message);
      }
    }
  }
  
  console.log(`   ✅ Fixed ${fixed} records in stock_adjustments`);
  return fixed;
}

async function cleanProductTransactions() {
  console.log('\n📦 Cleaning product_transactions table...');
  
  const fields = [
    'exchange_rate',
    'equivalent_amount',
    'product_average_cost',
    'user_unit_cost',
    'quantity_in',
    'quantity_out',
    'packaging_issue_quantity'
  ];
  
  let totalFixed = 0;
  
  for (const field of fields) {
    const [records] = await sequelize.query(`
      SELECT id, ${field}, reference_number
      FROM product_transactions
      WHERE ${field} IS NOT NULL
    `);
    
    if (records.length > 0) {
      console.log(`   Checking ${records.length} records for malformed ${field}...`);
      
      let fixed = 0;
      for (const record of records) {
        const originalValue = record[field];
        
        // Check if value is malformed
        if (!isMalformed(originalValue)) {
          continue;
        }
        
        const cleanedValue = safeParseNumeric(originalValue);
        
        if (cleanedValue !== null && cleanedValue !== originalValue) {
          try {
            await sequelize.query(`
              UPDATE product_transactions
              SET ${field} = :cleanedValue
              WHERE id = :id
            `, {
              replacements: {
                id: record.id,
                cleanedValue: cleanedValue
              }
            });
            
            fixed++;
          } catch (error) {
            console.error(`   ❌ Error fixing ${field} for transaction ${record.id}:`, error.message);
          }
        }
      }
      
      if (fixed > 0) {
        console.log(`   ✅ Fixed ${fixed} records for ${field}`);
        totalFixed += fixed;
      }
    }
  }
  
  console.log(`   ✅ Total fixed: ${totalFixed} records in product_transactions`);
  return totalFixed;
}

async function cleanGeneralLedger() {
  console.log('\n📦 Cleaning general_ledger table...');
  
  const fields = [
    'exchange_rate',
    'amount',
    'user_debit_amount',
    'user_credit_amount',
    'equivalent_debit_amount',
    'equivalent_credit_amount'
  ];
  
  let totalFixed = 0;
  
  for (const field of fields) {
    const [records] = await sequelize.query(`
      SELECT id, ${field}, reference_number
      FROM general_ledger
      WHERE ${field} IS NOT NULL
    `);
    
    if (records.length > 0) {
      console.log(`   Checking ${records.length} records for malformed ${field}...`);
      
      let fixed = 0;
      for (const record of records) {
        const originalValue = record[field];
        
        // Check if value is malformed
        if (!isMalformed(originalValue)) {
          continue;
        }
        
        const cleanedValue = safeParseNumeric(originalValue);
        
        if (cleanedValue !== null && cleanedValue !== originalValue) {
          try {
            await sequelize.query(`
              UPDATE general_ledger
              SET ${field} = :cleanedValue
              WHERE id = :id
            `, {
              replacements: {
                id: record.id,
                cleanedValue: cleanedValue
              }
            });
            
            fixed++;
          } catch (error) {
            console.error(`   ❌ Error fixing ${field} for GL entry ${record.id}:`, error.message);
          }
        }
      }
      
      if (fixed > 0) {
        console.log(`   ✅ Fixed ${fixed} records for ${field}`);
        totalFixed += fixed;
      }
    }
  }
  
  console.log(`   ✅ Total fixed: ${totalFixed} records in general_ledger`);
  return totalFixed;
}

async function main() {
  try {
    console.log('\n🧹 Cleaning Malformed Numeric Values in Database');
    console.log('='.repeat(60));
    console.log('⚠️  WARNING: This script will MODIFY data in your database!');
    console.log('   Make sure you have a backup before proceeding.\n');
    
    // Test database connection
    try {
      await sequelize.authenticate();
      console.log('✅ Database connection successful\n');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    }
    
    // Clean all tables
    const results = {
      physicalInventories: 0,
      physicalInventoryItems: 0,
      stockAdjustments: 0,
      productTransactions: 0,
      generalLedger: 0
    };
    
    results.physicalInventories = await cleanPhysicalInventories();
    results.physicalInventoryItems = await cleanPhysicalInventoryItems();
    results.stockAdjustments = await cleanStockAdjustments();
    results.productTransactions = await cleanProductTransactions();
    results.generalLedger = await cleanGeneralLedger();
    
    // Summary
    const totalFixed = Object.values(results).reduce((sum, count) => sum + count, 0);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Cleanup Summary:');
    console.log('='.repeat(60));
    console.log(`   Physical Inventories: ${results.physicalInventories} records fixed`);
    console.log(`   Physical Inventory Items: ${results.physicalInventoryItems} records fixed`);
    console.log(`   Stock Adjustments: ${results.stockAdjustments} records fixed`);
    console.log(`   Product Transactions: ${results.productTransactions} records fixed`);
    console.log(`   General Ledger: ${results.generalLedger} records fixed`);
    console.log(`   ──────────────────────────────────────────────`);
    console.log(`   TOTAL: ${totalFixed} records fixed`);
    console.log('='.repeat(60));
    
    if (totalFixed > 0) {
      console.log('\n✅ Cleanup completed successfully!');
      console.log('   All malformed numeric values have been cleaned.');
    } else {
      console.log('\n✅ No malformed values found. Database is clean!');
    }
    
    // Close connection
    await sequelize.close();
    
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  cleanNumericString,
  safeParseNumeric,
  isMalformed
};

