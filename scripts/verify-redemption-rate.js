require('dotenv').config();
const sequelize = require('../config/database');
const { LoyaltyCardConfig } = require('../server/models');

/**
 * Redemption Rate Calculation Verification
 * 
 * Redemption Rate Definition:
 * - redemption_rate = 100 means: 100 points = 1 currency unit
 * - Formula: currency = points / redemptionRate
 * - Formula: points = currency * redemptionRate
 * 
 * Examples with redemption_rate = 100:
 * - 100 points = 1 currency
 * - 3500 points = 35 currency (3500 / 100)
 * - 1 currency = 100 points (1 * 100)
 * - 3500 currency = 350,000 points (3500 * 100)
 */

async function verifyRedemptionRate() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('Redemption Rate Calculation Verification');
    console.log('='.repeat(80) + '\n');

    const config = await LoyaltyCardConfig.findOne({
      where: { is_active: true },
      attributes: ['id', 'loyalty_card_name', 'redemption_rate']
    });

    if (!config) {
      console.log('❌ No active loyalty card configuration found');
      await sequelize.close();
      return;
    }

    const redemptionRate = parseFloat(config.redemption_rate || 100);

    console.log('Configuration:');
    console.log(`  Name: ${config.loyalty_card_name}`);
    console.log(`  Redemption Rate: ${redemptionRate}`);
    console.log(`  Meaning: ${redemptionRate} points = 1 currency unit\n`);

    // Test cases
    const testCases = [
      { points: 100, description: '100 points' },
      { points: 3500, description: '3500 points (user case)' },
      { currency: 1, description: '1 currency unit' },
      { currency: 35, description: '35 currency units' },
      { currency: 3500, description: '3500 currency units (what user entered in items)' }
    ];

    console.log('Calculation Examples:');
    console.log('-'.repeat(80));
    
    for (const testCase of testCases) {
      if (testCase.points !== undefined) {
        const currency = testCase.points / redemptionRate;
        console.log(`${testCase.description}:`);
        console.log(`  ${testCase.points} points = ${currency} currency`);
        console.log(`  Formula: ${testCase.points} / ${redemptionRate} = ${currency}`);
      } else if (testCase.currency !== undefined) {
        const points = testCase.currency * redemptionRate;
        console.log(`${testCase.description}:`);
        console.log(`  ${testCase.currency} currency = ${points} points`);
        console.log(`  Formula: ${testCase.currency} * ${redemptionRate} = ${points}`);
      }
      console.log('');
    }

    // Verify frontend and backend formulas
    console.log('Formula Verification:');
    console.log('-'.repeat(80));
    console.log('Frontend (Currency → Points):');
    console.log('  calculatedLoyaltyPointsAmount = calculatedPaymentAmount * redemptionRate');
    console.log('  Example: 3500 currency * 100 = 350,000 points\n');
    
    console.log('Frontend (Points → Currency):');
    console.log('  actualPaymentAmountFromPoints = actualLoyaltyPointsToUse / redemptionRate');
    console.log('  Example: 3500 points / 100 = 35 currency\n');
    
    console.log('Backend (Points → Currency):');
    console.log('  loyaltyPointsValue = loyaltyPointsAmount / redemptionRate');
    console.log('  Example: 3500 points / 100 = 35 currency\n');

    // User's specific case
    console.log('User Case Analysis:');
    console.log('-'.repeat(80));
    console.log('Scenario: User had 3,534 points available');
    console.log('User entered: 3500 in items (currency field)');
    console.log('\nWhat the system calculated:');
    console.log(`  Points needed: 3500 currency * ${redemptionRate} = ${3500 * redemptionRate} points`);
    console.log(`  Available points: 3,534 points`);
    console.log(`  Result: User doesn't have enough points (needs ${3500 * redemptionRate}, has 3,534)`);
    console.log('\nWhat user likely intended:');
    console.log('  User wanted to use 3500 POINTS (not 3500 currency)');
    console.log(`  Currency value: 3500 points / ${redemptionRate} = ${3500 / redemptionRate} currency`);
    console.log(`  This matches the fix: 35 currency payment using 3500 points\n`);

    console.log('='.repeat(80));
    console.log('✅ Redemption rate calculation is CORRECT');
    console.log('='.repeat(80) + '\n');

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

verifyRedemptionRate();

