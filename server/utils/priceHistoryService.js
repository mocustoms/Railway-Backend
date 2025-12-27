const PriceHistory = require('../models/priceHistory');
const CostingMethod = require('../models/costingMethod');
const PriceChangeReason = require('../models/priceChangeReason');
const TransactionType = require('../models/transactionType');
const Currency = require('../models/currency');
const ExchangeRate = require('../models/exchangeRate');

class PriceHistoryService {
  /**
   * Track a price change automatically
   * @param {Object} options - Price change options
   * @param {string} options.entityType - Type of entity (product, service, etc.)
   * @param {string} options.entityId - ID of the entity
   * @param {string} options.entityCode - Code of the entity
   * @param {string} options.entityName - Name of the entity
   * @param {string} options.moduleName - Module making the change
   * @param {number} options.oldAverageCost - Previous average cost
   * @param {number} options.newAverageCost - New average cost
   * @param {number} options.oldSellingPrice - Previous selling price
   * @param {number} options.newSellingPrice - New selling price
   * @param {string} options.costingMethodCode - Costing method code (FIFO, LIFO, AVG, etc.)
   * @param {string} options.priceChangeReasonCode - Reason for price change
   * @param {string} options.transactionTypeId - Transaction type ID if applicable
   * @param {number} options.quantity - Quantity involved
   * @param {string} options.unit - Unit of measurement
   * @param {string} options.currencyId - Currency ID (user selected currency)
   * @param {number} options.exchangeRate - Exchange rate
   * @param {string} options.referenceNumber - Reference number
   * @param {string} options.notes - Additional notes
   * @param {Date} options.transactionDate - Transaction date
   * @param {string} options.userId - User making the change
   * @param {Object} options.transaction - Sequelize transaction (optional)
   */
  static async trackPriceChange(options, transaction = null) {
    try {
      const {
        entityType,
        entityId,
        entityCode,
        entityName,
        moduleName,
        oldAverageCost,
        newAverageCost,
        oldSellingPrice,
        newSellingPrice,
        costingMethodCode = 'AVG',
        priceChangeReasonCode = 'ADJUSTMENT',
        transactionTypeId,
        quantity,
        unit,
        currencyId,
        exchangeRate = 1.0,
        exchangeRateId,
        referenceNumber,
        notes,
        transactionDate,
        userId,
        originalCurrencyId,
        exchange_rate,
        equivalent_amount,
        companyId // Add companyId support for multi-tenant isolation
      } = options;

      // Check if there's actually a price change
      // Convert to numbers for proper comparison
      const oldCost = parseFloat(oldAverageCost) || 0;
      const newCost = parseFloat(newAverageCost) || 0;
      const oldPrice = parseFloat(oldSellingPrice) || 0;
      const newPrice = parseFloat(newSellingPrice) || 0;
      
      const hasCostChange = oldCost !== newCost;
      const hasSellingChange = oldPrice !== newPrice;

      if (!hasCostChange && !hasSellingChange) {
        return null;
      }

      // Get default currency
      const defaultCurrency = await Currency.findOne({
        where: { is_default: true }
      });

      // Get user selected currency details
      let userCurrency = null;
      let actualExchangeRate = exchangeRate;
      
      if (currencyId) {
        userCurrency = await Currency.findByPk(currencyId);
        
        // If user currency is different from default, get the latest exchange rate
        if (userCurrency && defaultCurrency && userCurrency.id !== defaultCurrency.id) {
          const latestRate = await ExchangeRate.findOne({
            where: {
              from_currency_id: userCurrency.id,
              to_currency_id: defaultCurrency.id,
              is_active: true
            },
            order: [['effective_date', 'DESC']]
          });
          
          if (latestRate) {
            actualExchangeRate = parseFloat(latestRate.rate);
            // Use the exchange rate ID if not already provided
            if (!exchangeRateId) {
              exchangeRateId = latestRate.id;
            }
          }
        } else if (userCurrency && defaultCurrency && userCurrency.id === defaultCurrency.id) {
          // Same as default currency, rate is 1.0
          actualExchangeRate = 1.0;
        }
      }
      
      // If exchangeRateId is still not set and we have a currency, try to get it
      if (!exchangeRateId && currencyId && defaultCurrency && currencyId !== defaultCurrency.id) {
        const latestRate = await ExchangeRate.findOne({
          where: {
            from_currency_id: currencyId,
            to_currency_id: defaultCurrency.id,
            is_active: true
          },
          order: [['effective_date', 'DESC']]
        });
        if (latestRate) {
          exchangeRateId = latestRate.id;
        }
      }

      // Get costing method ID
      let costingMethodId = null;
      if (costingMethodCode) {
        const costingMethod = await CostingMethod.findOne({
          where: { code: costingMethodCode, is_active: true }
        });
        costingMethodId = costingMethod?.id;
      }

      // Get price change reason ID
      let priceChangeReasonId = null;
      if (priceChangeReasonCode) {
        const priceChangeReason = await PriceChangeReason.findOne({
          where: { code: priceChangeReasonCode, is_active: true }
        });
        priceChangeReasonId = priceChangeReason?.id;
      }

      // Get transaction type name if ID provided
      let transactionTypeName = null;
      if (transactionTypeId) {
        const transactionType = await TransactionType.findByPk(transactionTypeId);
        transactionTypeName = transactionType?.name;
      }

      // Calculate equivalent_amount if not provided
      let finalEquivalentAmount = equivalent_amount;
      if (finalEquivalentAmount === undefined || finalEquivalentAmount === null) {
        finalEquivalentAmount = (parseFloat(newAverageCost) || 0) * (parseFloat(actualExchangeRate) || 1);
      }

      // Create price history record
      const priceHistoryData = {
        entity_type: entityType,
        entity_id: entityId,
        entity_code: entityCode,
        entity_name: entityName,
        module_name: moduleName,
        transaction_type_id: transactionTypeId,
        transaction_type_name: transactionTypeName,
        old_average_cost: oldAverageCost,
        new_average_cost: newAverageCost,
        old_selling_price: oldSellingPrice,
        new_selling_price: newSellingPrice,
        product_average_cost_old: oldAverageCost, // Also populate product-specific fields
        product_average_cost_new: newAverageCost,
        costing_method_id: costingMethodId,
        price_change_reason_id: priceChangeReasonId,
        quantity,
        unit,
        currency_id: currencyId || (defaultCurrency ? defaultCurrency.id : null),
        exchange_rate: actualExchangeRate,
        exchange_rate_id: exchangeRateId,
        reference_number: referenceNumber,
        notes: notes || (userCurrency && defaultCurrency ? 
          `Currency: ${userCurrency.code} → ${defaultCurrency.code} (Rate: ${actualExchangeRate.toFixed(6)})` : 
          'Price change recorded'),
        change_date: new Date(),
        transaction_date: transactionDate,
        created_by: userId,
        original_currency_id: originalCurrencyId,
        exchange_rate: exchange_rate,
        equivalent_amount: finalEquivalentAmount,
        companyId: companyId // Add companyId for multi-tenant isolation
      };

      // Create with transaction if provided
      const priceHistory = await PriceHistory.create(priceHistoryData, transaction ? { transaction } : {});

      if (userCurrency && defaultCurrency) {
        }
      return priceHistory;

    } catch (error) {
      // Don't throw error to avoid breaking the main operation
      return null;
    }
  }

  /**
   * Track product price changes specifically
   * @param {Object} product - Product object
   * @param {Object} oldData - Previous product data
   * @param {Object} newData - New product data
   * @param {string} moduleName - Module making the change
   * @param {string} reasonCode - Reason for change
   * @param {string} userId - User making the change
   * @param {Object} additionalData - Additional context data
   */
  static async trackProductPriceChange(product, oldData, newData, moduleName, reasonCode, userId, additionalData = {}) {
    // Patch: Use product.product_id if product.id is not set
    const resolvedId = product.id || product.product_id;
    if (!resolvedId) {
      } else {
      }
    // Determine system default currency
    const defaultCurrency = await require('../models/currency').findOne({ where: { is_default: true } });
    const options = {
      entityType: 'product',
      entityId: resolvedId,
      entityCode: product.code,
      entityName: product.name,
      moduleName,
      oldAverageCost: oldData?.average_cost,
      newAverageCost: newData?.average_cost,
      oldSellingPrice: oldData?.selling_price,
      newSellingPrice: newData?.selling_price,
      priceChangeReasonCode: reasonCode,
      userId,
      currencyId: additionalData.currencyId, // user-selected currency
      originalCurrencyId: defaultCurrency ? defaultCurrency.id : null, // system default currency
      exchange_rate: additionalData.exchangeRate, // store exchange rate
      equivalent_amount: additionalData.equivalentAmount, // store equivalent amount
      ...additionalData
    };

    return await this.trackPriceChange(options);
  }

  /**
   * Get price history for an entity
   * @param {string} entityType - Type of entity
   * @param {string} entityId - ID of the entity
   * @param {Object} options - Query options
   */
  static async getEntityPriceHistory(entityType, entityId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      startDate,
      endDate,
      moduleName,
      includeAssociations = true
    } = options;

    const whereClause = {
      entity_type: entityType,
      entity_id: entityId
    };

    if (startDate) {
      whereClause.change_date = {
        [require('sequelize').Op.gte]: startDate
      };
    }

    if (endDate) {
      whereClause.change_date = {
        ...whereClause.change_date,
        [require('sequelize').Op.lte]: endDate
      };
    }

    if (moduleName) {
      whereClause.module_name = moduleName;
    }

    const queryOptions = {
      where: whereClause,
      order: [['change_date', 'DESC']],
      limit,
      offset
    };

    if (includeAssociations) {
      queryOptions.include = [
        {
          model: CostingMethod,
          as: 'costingMethod',
          attributes: ['id', 'code', 'name']
        },
        {
          model: PriceChangeReason,
          as: 'priceChangeReason',
          attributes: ['id', 'code', 'name', 'category']
        },
        {
          model: TransactionType,
          as: 'transactionType',
          attributes: ['id', 'name', 'code']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'code', 'name', 'symbol']
        }
      ];
    }

    return await PriceHistory.findAndCountAll(queryOptions);
  }

  /**
   * Get price history summary for costing analysis
   * @param {string} entityType - Type of entity
   * @param {string} entityId - ID of the entity
   * @param {Date} startDate - Start date for analysis
   * @param {Date} endDate - End date for analysis
   */
  static async getPriceHistorySummary(entityType, entityId, startDate, endDate) {
    const history = await PriceHistory.findAll({
      where: {
        entity_type: entityType,
        entity_id: entityId,
        change_date: {
          [require('sequelize').Op.between]: [startDate, endDate]
        }
      },
      order: [['change_date', 'ASC']],
      include: [
        {
          model: CostingMethod,
          as: 'costingMethod',
          attributes: ['code', 'name']
        },
        {
          model: PriceChangeReason,
          as: 'priceChangeReason',
          attributes: ['code', 'name', 'category']
        }
      ]
    });

    // Calculate summary statistics
    const summary = {
      totalChanges: history.length,
      costChanges: history.filter(h => h.old_average_cost !== h.new_average_cost).length,
      sellingChanges: history.filter(h => h.old_selling_price !== h.new_selling_price).length,
      averageCostHistory: [],
      sellingPriceHistory: [],
      byReason: {},
      byModule: {},
      byCostingMethod: {}
    };

    history.forEach(record => {
      // Track cost changes
      if (record.old_average_cost !== record.new_average_cost) {
        summary.averageCostHistory.push({
          date: record.change_date,
          oldCost: record.old_average_cost,
          newCost: record.new_average_cost,
          reason: record.priceChangeReason?.name,
          module: record.module_name
        });
      }

      // Track selling price changes
      if (record.old_selling_price !== record.new_selling_price) {
        summary.sellingPriceHistory.push({
          date: record.change_date,
          oldPrice: record.old_selling_price,
          newPrice: record.new_selling_price,
          reason: record.priceChangeReason?.name,
          module: record.module_name
        });
      }

      // Group by reason
      const reasonName = record.priceChangeReason?.name || 'Unknown';
      summary.byReason[reasonName] = (summary.byReason[reasonName] || 0) + 1;

      // Group by module
      summary.byModule[record.module_name] = (summary.byModule[record.module_name] || 0) + 1;

      // Group by costing method
      const methodName = record.costingMethod?.name || 'Unknown';
      summary.byCostingMethod[methodName] = (summary.byCostingMethod[methodName] || 0) + 1;
    });

    return summary;
  }

  /**
   * Calculate average cost using different costing methods
   * @param {string} entityType - Type of entity
   * @param {string} entityId - ID of the entity
   * @param {string} costingMethod - Costing method (FIFO, LIFO, AVG)
   * @param {Date} asOfDate - Date to calculate as of
   */
  static async calculateAverageCost(entityType, entityId, costingMethod = 'AVG', asOfDate = new Date()) {
    const history = await PriceHistory.findAll({
      where: {
        entity_type: entityType,
        entity_id: entityId,
        change_date: {
          [require('sequelize').Op.lte]: asOfDate
        }
      },
      order: [['change_date', 'ASC']]
    });

    if (history.length === 0) {
      return null;
    }

    switch (costingMethod.toUpperCase()) {
      case 'FIFO':
        return this.calculateFIFOCost(history);
      case 'LIFO':
        return this.calculateLIFOCost(history);
      case 'AVG':
      default:
        return this.calculateAverageCost(history);
    }
  }

  /**
   * Calculate FIFO cost
   */
  static calculateFIFOCost(history) {
    // For FIFO, we need to track inventory layers
    // This is a simplified implementation
    let totalCost = 0;
    let totalQuantity = 0;

    history.forEach(record => {
      if (record.quantity && record.new_average_cost) {
        totalCost += record.quantity * record.new_average_cost;
        totalQuantity += record.quantity;
      }
    });

    return totalQuantity > 0 ? totalCost / totalQuantity : null;
  }

  /**
   * Calculate LIFO cost
   */
  static calculateLIFOCost(history) {
    // For LIFO, we use the most recent cost
    const latestRecord = history[history.length - 1];
    return latestRecord?.new_average_cost || null;
  }

  /**
   * Calculate average cost
   */
  static calculateAverageCost(history) {
    // Simple average of all costs
    const costs = history
      .filter(record => record.new_average_cost)
      .map(record => record.new_average_cost);

    if (costs.length === 0) {
      return null;
    }

    const sum = costs.reduce((acc, cost) => acc + parseFloat(cost), 0);
    return sum / costs.length;
  }
}

module.exports = PriceHistoryService; 