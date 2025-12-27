const { Op } = require('sequelize');
const {
  Customer,
  LoyaltyTransaction,
  LoyaltyCard,
  LoyaltyCardConfig,
  FinancialYear,
  Currency,
  Store,
  sequelize
} = require('../models');
const { buildCompanyWhere } = require('../middleware/companyFilter');

/**
 * Award welcome bonus points to a customer when they receive a loyalty card
 * @param {Object} customer - Customer instance
 * @param {Object} loyaltyConfig - LoyaltyCardConfig instance
 * @param {Object} options - Options object
 * @param {Object} options.transaction - Sequelize transaction
 * @param {Object} options.user - User object (for created_by)
 * @param {Object} options.companyId - Company ID
 * @param {String} options.reference - Reference number (e.g., invoice number or 'CUSTOMER_CREATION')
 * @param {Date} options.transactionDate - Transaction date (defaults to now)
 * @returns {Promise<Object|null>} - Created loyalty transaction or null
 */
async function awardWelcomeBonus(customer, loyaltyConfig, options = {}) {
  const {
    transaction,
    user,
    companyId,
    reference = 'CUSTOMER_CREATION',
    transactionDate = new Date()
  } = options;

  if (!loyaltyConfig || !loyaltyConfig.welcome_bonus_points || parseInt(loyaltyConfig.welcome_bonus_points) <= 0) {
    return null;
  }

  const welcomeBonusPoints = parseInt(loyaltyConfig.welcome_bonus_points || 0);
  if (welcomeBonusPoints <= 0) {
    return null;
  }

  // Check if loyalty_cards table exists
  const loyaltyCardsTableExists = await sequelize.getQueryInterface().showAllTables()
    .then(tables => tables.includes('loyalty_cards'))
    .catch(() => false);

  let loyaltyCardId = null;
  if (loyaltyCardsTableExists && customer.loyalty_card_number) {
    // Find or create loyalty card
    let loyaltyCard = await LoyaltyCard.findOne({
      where: { 
        card_number: customer.loyalty_card_number,
        companyId: companyId
      },
      transaction
    });

    if (!loyaltyCard) {
      loyaltyCard = await LoyaltyCard.create({
        card_number: customer.loyalty_card_number,
        loyalty_config_id: customer.loyalty_card_config_id,
        customer_name: customer.full_name,
        customer_email: customer.email,
        customer_phone: customer.phone_number,
        current_points: 0,
        total_points_earned: 0,
        total_points_redeemed: 0,
        tier_level: 'bronze',
        tier_points_threshold: 0,
        is_active: true,
        issued_date: transactionDate,
        companyId: companyId,
        created_by: user?.id || customer.created_by
      }, { transaction });
    }

    loyaltyCardId = loyaltyCard.id;
  }

  // Get current customer loyalty points
  const currentCustomerPoints = parseInt(customer.loyalty_points || 0);
  const pointsBalanceBefore = currentCustomerPoints;
  const pointsBalanceAfter = pointsBalanceBefore + welcomeBonusPoints;

  // Get tier information
  let tierBefore = 'bronze';
  let tierAfter = 'bronze';
  
  if (loyaltyCardsTableExists && loyaltyCardId) {
    const loyaltyCard = await LoyaltyCard.findByPk(loyaltyCardId, { transaction });
    if (loyaltyCard) {
      tierBefore = loyaltyCard.tier_level || 'bronze';
      tierAfter = tierBefore;
    }
  }

  // Get financial year
  const financialYear = await FinancialYear.findOne({
    where: { 
      companyId: companyId,
      isActive: true 
    },
    transaction
  });

  if (!financialYear) {
    throw new Error('Active financial year not found');
  }

  // Get default currency (first currency for the company)
  const defaultCurrency = await Currency.findOne({
    where: { companyId: companyId },
    transaction
  });

  // Get default store (first store for the company)
  const defaultStore = await Store.findOne({
    where: { companyId: companyId },
    transaction
  });

  // Create welcome bonus transaction
  const welcomeBonusTransaction = await LoyaltyTransaction.create({
    loyalty_card_id: loyaltyCardId,
    transaction_type: 'bonus',
    points_amount: welcomeBonusPoints,
    transaction_reference: reference,
    description: 'Welcome bonus points for new loyalty card',
    sales_invoice_id: null, // Not from an invoice
    customer_id: customer.id,
    store_id: defaultStore?.id || null,
    loyalty_config_id: customer.loyalty_card_config_id,
    financial_year_id: financialYear.id,
    transaction_ref_number: `LT-WELCOME-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    amount: 0,
    currency_id: defaultCurrency?.id || null,
    exchange_rate: 1,
    status: 'completed',
    notes: `Welcome bonus: ${welcomeBonusPoints} points awarded for new loyalty card`,
    points_balance_before: pointsBalanceBefore,
    points_balance_after: pointsBalanceAfter,
    tier_before: tierBefore,
    tier_after: tierAfter,
    transaction_date: transactionDate,
    expiry_date: null,
    is_expired: false,
    companyId: companyId,
    created_by: user?.id || customer.created_by,
    updated_by: user?.id || customer.created_by
  }, { transaction });

  // Update loyalty card points (only if loyalty_cards table exists)
  if (loyaltyCardsTableExists && loyaltyCardId) {
    await LoyaltyCard.increment('current_points', {
      by: welcomeBonusPoints,
      where: { id: loyaltyCardId },
      transaction
    });

    await LoyaltyCard.increment('total_points_earned', {
      by: welcomeBonusPoints,
      where: { id: loyaltyCardId },
      transaction
    });
  }

  // Update customer loyalty points
  await Customer.increment('loyalty_points', {
    by: welcomeBonusPoints,
    where: { id: customer.id, companyId: companyId },
    transaction
  });

  console.log(`✅ Welcome bonus awarded: ${welcomeBonusPoints} points for customer ${customer.full_name} (Balance: ${pointsBalanceBefore} → ${pointsBalanceAfter})`);

  return welcomeBonusTransaction;
}

/**
 * Award birthday bonus points to a customer on their birthday
 * @param {Object} customer - Customer instance
 * @param {Object} loyaltyConfig - LoyaltyCardConfig instance
 * @param {Object} options - Options object
 * @param {Object} options.transaction - Sequelize transaction
 * @param {Object} options.user - User object (for created_by)
 * @param {Object} options.companyId - Company ID
 * @param {Date} options.birthdayDate - The date to check (defaults to today)
 * @returns {Promise<Object|null>} - Created loyalty transaction or null
 */
async function awardBirthdayBonus(customer, loyaltyConfig, options = {}) {
  const {
    transaction,
    user,
    companyId,
    birthdayDate = new Date()
  } = options;

  if (!customer.birthday || !loyaltyConfig || !loyaltyConfig.birthday_bonus_points || parseInt(loyaltyConfig.birthday_bonus_points) <= 0) {
    return null;
  }

  const birthdayBonusPoints = parseInt(loyaltyConfig.birthday_bonus_points || 0);
  if (birthdayBonusPoints <= 0) {
    return null;
  }

  // Parse customer birthday
  const customerBirthday = new Date(customer.birthday);
  const checkDate = new Date(birthdayDate);
  
  // Check if the date matches customer's birthday (month and day)
  const isBirthdayToday = 
    customerBirthday.getMonth() === checkDate.getMonth() &&
    customerBirthday.getDate() === checkDate.getDate();

  if (!isBirthdayToday) {
    return null;
  }

  // Check if birthday bonus was already awarded this year
  const currentYear = checkDate.getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

  const existingBirthdayBonus = await LoyaltyTransaction.findOne({
    where: {
      customer_id: customer.id,
      transaction_type: 'bonus',
      description: {
        [Op.like]: '%birthday%'
      },
      transaction_date: {
        [Op.between]: [yearStart, yearEnd]
      },
      companyId: companyId
    },
    transaction
  });

  // Only award if not already awarded this year
  if (existingBirthdayBonus) {
    console.log(`ℹ️  Birthday bonus already awarded this year for customer ${customer.full_name}`);
    return null;
  }

  // Check if loyalty_cards table exists
  const loyaltyCardsTableExists = await sequelize.getQueryInterface().showAllTables()
    .then(tables => tables.includes('loyalty_cards'))
    .catch(() => false);

  let loyaltyCardId = null;
  if (loyaltyCardsTableExists && customer.loyalty_card_number) {
    const loyaltyCard = await LoyaltyCard.findOne({
      where: { 
        card_number: customer.loyalty_card_number,
        companyId: companyId
      },
      transaction
    });
    if (loyaltyCard) {
      loyaltyCardId = loyaltyCard.id;
    }
  }

  // Get current customer loyalty points
  const currentCustomerPoints = parseInt(customer.loyalty_points || 0);
  const pointsBalanceBefore = currentCustomerPoints;
  const pointsBalanceAfter = pointsBalanceBefore + birthdayBonusPoints;

  // Get tier information
  let tierBefore = 'bronze';
  let tierAfter = 'bronze';
  
  if (loyaltyCardsTableExists && loyaltyCardId) {
    const loyaltyCard = await LoyaltyCard.findByPk(loyaltyCardId, { transaction });
    if (loyaltyCard) {
      tierBefore = loyaltyCard.tier_level || 'bronze';
      tierAfter = tierBefore;
    }
  }

  // Get financial year
  const financialYear = await FinancialYear.findOne({
    where: { 
      companyId: companyId,
      isActive: true 
    },
    transaction
  });

  if (!financialYear) {
    throw new Error('Active financial year not found');
  }

  // Get default currency (first currency for the company)
  const defaultCurrency = await Currency.findOne({
    where: { companyId: companyId },
    transaction
  });

  // Get default store (first store for the company)
  const defaultStore = await Store.findOne({
    where: { companyId: companyId },
    transaction
  });

  // Create birthday bonus transaction
  const birthdayBonusTransaction = await LoyaltyTransaction.create({
    loyalty_card_id: loyaltyCardId,
    transaction_type: 'bonus',
    points_amount: birthdayBonusPoints,
    transaction_reference: 'BIRTHDAY_AUTOMATED',
    description: 'Birthday bonus points',
    sales_invoice_id: null, // Not from an invoice
    customer_id: customer.id,
    store_id: defaultStore?.id || null,
    loyalty_config_id: customer.loyalty_card_config_id,
    financial_year_id: financialYear.id,
    transaction_ref_number: `LT-BIRTHDAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    amount: 0,
    currency_id: defaultCurrency?.id || null,
    exchange_rate: 1,
    status: 'completed',
    notes: `Birthday bonus: ${birthdayBonusPoints} points awarded on customer's birthday`,
    points_balance_before: pointsBalanceBefore,
    points_balance_after: pointsBalanceAfter,
    tier_before: tierBefore,
    tier_after: tierAfter,
    transaction_date: checkDate,
    expiry_date: null,
    is_expired: false,
    companyId: companyId,
    created_by: user?.id || customer.created_by,
    updated_by: user?.id || customer.created_by
  }, { transaction });

  // Update loyalty card points (only if loyalty_cards table exists)
  if (loyaltyCardsTableExists && loyaltyCardId) {
    await LoyaltyCard.increment('current_points', {
      by: birthdayBonusPoints,
      where: { id: loyaltyCardId },
      transaction
    });

    await LoyaltyCard.increment('total_points_earned', {
      by: birthdayBonusPoints,
      where: { id: loyaltyCardId },
      transaction
    });
  }

  // Update customer loyalty points
  await Customer.increment('loyalty_points', {
    by: birthdayBonusPoints,
    where: { id: customer.id, companyId: companyId },
    transaction
  });

  console.log(`✅ Birthday bonus awarded: ${birthdayBonusPoints} points for customer ${customer.full_name} (Balance: ${pointsBalanceBefore} → ${pointsBalanceAfter})`);

  return birthdayBonusTransaction;
}

module.exports = {
  awardWelcomeBonus,
  awardBirthdayBonus
};

