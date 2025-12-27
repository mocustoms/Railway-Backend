/**
 * Test script to check loyalty card calculations for a specific customer
 * Usage: node scripts/test-customer-loyalty.js CUST-20251110-0004
 */

const sequelize = require('../config/database');
const {
  Customer,
  LoyaltyCardConfig,
  LoyaltyCard,
  LoyaltyTransaction,
  Company
} = require('../server/models');

async function testCustomerLoyalty(customerId) {
  try {
    console.log('🔍 Testing Loyalty Card Calculation');
    console.log('='.repeat(60));
    console.log(`Customer ID: ${customerId}\n`);

    // Find customer
    const customer = await Customer.findOne({
      where: { customer_id: customerId },
      include: [
        { model: LoyaltyCardConfig, as: 'loyaltyCardConfig' }
      ]
    });

    if (!customer) {
      console.error(`❌ Customer ${customerId} not found`);
      process.exit(1);
    }

    console.log('✅ Customer Found:');
    console.log(`   Name: ${customer.full_name}`);
    console.log(`   Customer ID: ${customer.customer_id}`);
    console.log(`   Company ID: ${customer.companyId}`);
    console.log(`   Birthday: ${customer.birthday || 'Not set'}`);
    console.log(`   Loyalty Card Number: ${customer.loyalty_card_number || 'Not assigned'}`);
    console.log(`   Loyalty Card Config ID: ${customer.loyalty_card_config_id || 'Not assigned'}`);
    console.log(`   Current Loyalty Points: ${customer.loyalty_points || 0}\n`);

    // Check if loyalty card config exists
    if (!customer.loyalty_card_config_id) {
      console.log('⚠️  Customer does not have a loyalty card configuration assigned');
      process.exit(0);
    }

    const loyaltyConfig = await LoyaltyCardConfig.findByPk(customer.loyalty_card_config_id);
    
    if (!loyaltyConfig) {
      console.error(`❌ Loyalty config ${customer.loyalty_card_config_id} not found`);
      process.exit(1);
    }

    console.log('✅ Loyalty Card Config:');
    console.log(`   Name: ${loyaltyConfig.loyalty_card_name}`);
    console.log(`   Code: ${loyaltyConfig.loyalty_card_code}`);
    console.log(`   Welcome Bonus Points: ${loyaltyConfig.welcome_bonus_points || 0}`);
    console.log(`   Birthday Bonus Points: ${loyaltyConfig.birthday_bonus_points || 0}`);
    console.log(`   Gain Rate Type: ${loyaltyConfig.gain_rate_type || 'N/A'}`);
    console.log(`   Gain Rate Value: ${loyaltyConfig.gain_rate_value || 0}`);
    console.log(`   Gain Rate Lower Limit: ${loyaltyConfig.gain_rate_lower_limit || 0}`);
    console.log(`   Gain Rate Upper Limit: ${loyaltyConfig.gain_rate_upper_limit || 'Unlimited'}`);
    console.log(`   Allow Cash Sales: ${loyaltyConfig.allow_gaining_cash_sales}`);
    console.log(`   Allow Credit Sales: ${loyaltyConfig.allow_gaining_credit_sales}\n`);

    // Check if loyalty_cards table exists
    const loyaltyCardsTableExists = await sequelize.getQueryInterface().showAllTables()
      .then(tables => tables.includes('loyalty_cards'))
      .catch(() => false);

    if (loyaltyCardsTableExists && customer.loyalty_card_number) {
      const loyaltyCard = await LoyaltyCard.findOne({
        where: {
          card_number: customer.loyalty_card_number,
          companyId: customer.companyId
        }
      });

      if (loyaltyCard) {
        console.log('✅ Loyalty Card Record:');
        console.log(`   Card Number: ${loyaltyCard.card_number}`);
        console.log(`   Current Points: ${loyaltyCard.current_points || 0}`);
        console.log(`   Total Points Earned: ${loyaltyCard.total_points_earned || 0}`);
        console.log(`   Total Points Redeemed: ${loyaltyCard.total_points_redeemed || 0}`);
        console.log(`   Tier Level: ${loyaltyCard.tier_level || 'bronze'}`);
        console.log(`   Issued Date: ${loyaltyCard.issued_date || 'N/A'}\n`);
      } else {
        console.log('⚠️  Loyalty card record not found (card may need to be created)\n');
      }
    }

    // Get all loyalty transactions
    const transactions = await LoyaltyTransaction.findAll({
      where: {
        customer_id: customer.id,
        companyId: customer.companyId
      },
      order: [['transaction_date', 'DESC']],
      limit: 20
    });

    console.log(`📊 Loyalty Transactions (Last ${transactions.length}):`);
    if (transactions.length === 0) {
      console.log('   No transactions found\n');
    } else {
      transactions.forEach((tx, index) => {
        console.log(`\n   Transaction ${index + 1}:`);
        console.log(`   - Type: ${tx.transaction_type}`);
        console.log(`   - Points: ${tx.points_amount > 0 ? '+' : ''}${tx.points_amount}`);
        console.log(`   - Description: ${tx.description || 'N/A'}`);
        console.log(`   - Balance Before: ${tx.points_balance_before || 0}`);
        console.log(`   - Balance After: ${tx.points_balance_after || 0}`);
        console.log(`   - Date: ${tx.transaction_date || 'N/A'}`);
        console.log(`   - Reference: ${tx.transaction_reference || 'N/A'}`);
      });
      console.log('');
    }

    // Check birthday bonus eligibility
    if (customer.birthday && loyaltyConfig.birthday_bonus_points > 0) {
      const today = new Date();
      const customerBirthday = new Date(customer.birthday);
      const isBirthdayToday = 
        customerBirthday.getMonth() === today.getMonth() &&
        customerBirthday.getDate() === today.getDate();

      console.log('🎂 Birthday Bonus Check:');
      console.log(`   Customer Birthday: ${customer.birthday}`);
      console.log(`   Today: ${today.toISOString().split('T')[0]}`);
      console.log(`   Is Birthday Today: ${isBirthdayToday ? '✅ YES' : '❌ NO'}`);

      if (isBirthdayToday) {
        // Check if already awarded this year
        const currentYear = today.getFullYear();
        const yearStart = new Date(currentYear, 0, 1);
        const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

        const existingBirthdayBonus = await LoyaltyTransaction.findOne({
          where: {
            customer_id: customer.id,
            transaction_type: 'bonus',
            description: {
              [sequelize.Sequelize.Op.like]: '%birthday%'
            },
            transaction_date: {
              [sequelize.Sequelize.Op.between]: [yearStart, yearEnd]
            },
            companyId: customer.companyId
          }
        });

        if (existingBirthdayBonus) {
          console.log(`   Status: Already awarded this year (${existingBirthdayBonus.transaction_date})`);
        } else {
          console.log(`   Status: ✅ Eligible for ${loyaltyConfig.birthday_bonus_points} points`);
        }
      } else {
        const nextBirthday = new Date(today.getFullYear(), customerBirthday.getMonth(), customerBirthday.getDate());
        if (nextBirthday < today) {
          nextBirthday.setFullYear(today.getFullYear() + 1);
        }
        const daysUntilBirthday = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
        console.log(`   Next Birthday: ${nextBirthday.toISOString().split('T')[0]} (${daysUntilBirthday} days)`);
      }
      console.log('');
    }

    // Summary
    console.log('📈 Summary:');
    console.log(`   Total Loyalty Points: ${customer.loyalty_points || 0}`);
    console.log(`   Welcome Bonus Eligible: ${customer.loyalty_card_number && loyaltyConfig.welcome_bonus_points > 0 ? '✅ YES' : '❌ NO'}`);
    console.log(`   Birthday Bonus Eligible: ${customer.birthday && loyaltyConfig.birthday_bonus_points > 0 ? '✅ YES' : '❌ NO'}`);
    console.log(`   Total Transactions: ${transactions.length}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed successfully');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Get customer ID from command line
const customerId = process.argv[2];

if (!customerId) {
  console.error('❌ Please provide a customer ID');
  console.error('Usage: node scripts/test-customer-loyalty.js CUST-20251110-0004');
  process.exit(1);
}

testCustomerLoyalty(customerId);

