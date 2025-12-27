const sequelize = require('../config/database');

async function explainPriceUsage() {
  try {
    console.log('\n📊 PRICE USAGE IN SALES INVOICE MODULE\n');
    console.log('='.repeat(80));

    console.log('\n💰 PRICE COMPARISON:\n');
    
    console.log('1️⃣  LOYALTY POINTS CALCULATION:');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ Price Used: Invoice SUBTOTAL                                │');
    console.log('   │ Source: fullInvoice.subtotal                                 │');
    console.log('   │ Meaning: Sum of all line items (quantity × unit_price)       │');
    console.log('   │            BEFORE discounts and taxes                        │');
    console.log('   │                                                              │');
    console.log('   │ Example:                                                    │');
    console.log('   │   Item 1: 10 × 5,000 = 50,000                               │');
    console.log('   │   Item 2: 5 × 2,000 = 10,000                               │');
    console.log('   │   Subtotal = 60,000 ← Used for loyalty points             │');
    console.log('   │   Discount = -5,000                                         │');
    console.log('   │   Tax = +3,100                                              │');
    console.log('   │   Total = 58,100                                            │');
    console.log('   │                                                              │');
    console.log('   │ Points = 60,000 × 0.01% = 6 points                         │');
    console.log('   └─────────────────────────────────────────────────────────────┘');

    console.log('\n2️⃣  PRICE CHANGE HISTORY:');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ OLD Price: Product → selling_price                          │');
    console.log('   │            (Master price stored in product catalog)          │');
    console.log('   │                                                              │');
    console.log('   │ NEW Price: Invoice Item → unit_price                        │');
    console.log('   │            (Actual price sold at in this invoice)            │');
    console.log('   │                                                              │');
    console.log('   │ Example:                                                    │');
    console.log('   │   Product Master Price: 45,871.82                           │');
    console.log('   │   Invoice Item Price: 60,000.00                              │');
    console.log('   │   Price Change: 45,871.82 → 60,000.00                      │');
    console.log('   │                                                              │');
    console.log('   │ Only logged if: oldPrice ≠ newPrice AND newPrice > 0        │');
    console.log('   └─────────────────────────────────────────────────────────────┘');

    console.log('\n3️⃣  KEY DIFFERENCES:\n');
    
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ LOYALTY POINTS:                                             │');
    console.log('   │   • Uses: Invoice SUBTOTAL (sum of all items)                │');
    console.log('   │   • Purpose: Calculate reward points                        │');
    console.log('   │   • Amount: Total purchase value before discounts/taxes     │');
    console.log('   │                                                              │');
    console.log('   │ PRICE CHANGE HISTORY:                                       │');
    console.log('   │   • Uses: Individual item unit_price                        │');
    console.log('   │   • Purpose: Track when product prices change               │');
    console.log('   │   • Compares: Product master price vs invoice item price   │');
    console.log('   └─────────────────────────────────────────────────────────────┘');

    console.log('\n4️⃣  EXAMPLE SCENARIO:\n');
    console.log('   Invoice: INV-20251110-0008');
    console.log('   ──────────────────────────────────────────────────────────────');
    console.log('   Item: AMX 250');
    console.log('   • Product Master Price (selling_price): 45,871.82');
    console.log('   • Invoice Item Price (unit_price): 60,000.00');
    console.log('   • Quantity: 1');
    console.log('   • Line Subtotal: 60,000.00');
    console.log('   ──────────────────────────────────────────────────────────────');
    console.log('   Invoice Totals:');
    console.log('   • Subtotal: 60,000.00 ← Used for LOYALTY POINTS');
    console.log('   • Discount: -5,000.00');
    console.log('   • Tax: +3,100.00');
    console.log('   • Total: 58,100.00');
    console.log('   ──────────────────────────────────────────────────────────────');
    console.log('   Results:');
    console.log('   • Loyalty Points: Calculated from 60,000 (subtotal)');
    console.log('   • Price History: Logs 45,871.82 → 60,000.00 (per item)');

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 SUMMARY:\n');
    console.log('   • Loyalty Points = Based on INVOICE SUBTOTAL (all items combined)');
    console.log('   • Price History = Based on ITEM UNIT_PRICE (per product comparison)');
    console.log('   • They serve different purposes and use different price values');
    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sequelize.close();
  }
}

explainPriceUsage();

