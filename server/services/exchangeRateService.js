/**
 * Exchange Rate Service
 * Reusable service functions for creating and managing exchange rates
 * Used by both API routes and initialization service
 */

const { ExchangeRate } = require('../models');

class ExchangeRateService {
  /**
   * Create an exchange rate with validation
   * @param {Object} data - Exchange rate data
   * @param {string} data.from_currency_id - Source currency ID
   * @param {string} data.to_currency_id - Target currency ID
   * @param {number|string} data.rate - Exchange rate
   * @param {string} data.effective_date - Effective date (YYYY-MM-DD)
   * @param {boolean} data.is_active - Active status (default: true)
   * @param {string} companyId - Company ID
   * @param {string} userId - User ID (for created_by/updated_by)
   * @param {Object} transaction - Sequelize transaction (optional)
   * @returns {Promise<ExchangeRate>} Created exchange rate
   */
  static async createExchangeRate(data, companyId, userId, transaction = null) {
    const { from_currency_id, to_currency_id, rate, effective_date, is_active } = data;

    // Validate required fields
    if (!from_currency_id || !to_currency_id || !rate || !effective_date) {
      throw new Error('All fields are required: from_currency_id, to_currency_id, rate, and effective_date');
    }

    // Validate rate is positive
    const rateValue = parseFloat(rate);
    if (isNaN(rateValue) || rateValue < 0) {
      throw new Error('Rate must be a positive number');
    }

    // Check if exchange rate already exists for this currency pair and effective date in this company
    // Always check within company, even for super-admins
    if (!companyId) {
      throw new Error('Company ID is required to create an exchange rate');
    }

    const { Op } = require('sequelize');
    const existingExchangeRate = await ExchangeRate.findOne({
      where: {
        companyId: companyId,
        from_currency_id: from_currency_id,
        to_currency_id: to_currency_id,
        effective_date: effective_date
      },
      transaction
    });

    if (existingExchangeRate) {
      throw new Error('An exchange rate for this currency pair and effective date already exists in your company');
    }

    // Create exchange rate
    const exchangeRate = await ExchangeRate.create({
      from_currency_id,
      to_currency_id,
      rate: rateValue,
      effective_date,
      is_active: is_active !== undefined ? is_active : true,
      created_by: userId,
      companyId: companyId
    }, { transaction });

    return exchangeRate;
  }
}

module.exports = ExchangeRateService;

