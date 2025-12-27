const { ProductSerialNumber, ProductExpiryDate, Product } = require('../models');
const { Op } = require('sequelize');

class SerialExpiryTrackingService {
  /**
   * Validate and process serial numbers for a product
   * @param {string} productId - Product ID
   * @param {string} serialNumber - Serial number to validate
   * @param {string} storeId - Store ID
   * @param {boolean} isStockIn - Whether this is a stock in operation
   * @returns {Promise<Object>} Validation result
   */
  static async validateSerialNumber(productId, serialNumber, storeId, isStockIn = true) {
    try {
      // Check if product requires serial number tracking
      const product = await Product.findByPk(productId);
      if (!product) {
        return { valid: false, error: 'Product not found' };
      }

      if (!product.track_serial_number) {
        return { valid: true, requiresTracking: false };
      }

      if (!serialNumber) {
        return { valid: false, error: 'Serial number is required for this product' };
      }

      // Check if serial number already exists for stock in
      if (isStockIn) {
        const existingSerial = await ProductSerialNumber.findOne({
          where: {
            product_id: productId,
            serial_number: serialNumber,
            store_id: storeId,
            status: { [Op.in]: ['active', 'damaged'] }
          }
        });

        if (existingSerial) {
          return { 
            valid: false, 
            error: `Serial number ${serialNumber} already exists in this store`,
            existingSerial 
          };
        }
      } else {
        // For stock out, check if serial number exists and is available
        const existingSerial = await ProductSerialNumber.findOne({
          where: {
            product_id: productId,
            serial_number: serialNumber,
            store_id: storeId,
            status: 'active'
          }
        });

        if (!existingSerial) {
          return { 
            valid: false, 
            error: `Serial number ${serialNumber} not found or not available in this store` 
          };
        }

        if (existingSerial.current_quantity <= 0) {
          return { 
            valid: false, 
            error: `Serial number ${serialNumber} has no available quantity` 
          };
        }
      }

      return { valid: true, requiresTracking: true };
    } catch (error) {
      return { valid: false, error: 'Validation error occurred' };
    }
  }

  /**
   * Validate and process expiry date for a product
   * @param {string} productId - Product ID
   * @param {Date} expiryDate - Expiry date to validate
   * @param {string} batchNumber - Batch number
   * @param {string} storeId - Store ID
   * @param {boolean} isStockIn - Whether this is a stock in operation
   * @returns {Promise<Object>} Validation result
   */
  static async validateExpiryDate(productId, expiryDate, batchNumber, storeId, isStockIn = true) {
    try {
      // Check if product requires expiry date tracking
      const product = await Product.findByPk(productId);
      if (!product) {
        return { valid: false, error: 'Product not found' };
      }

      if (!product.expiry_notification_days) {
        return { valid: true, requiresTracking: false };
      }

      if (!expiryDate) {
        return { valid: false, error: 'Expiry date is required for this product' };
      }

      const expiryDateObj = new Date(expiryDate);
      const today = new Date();

      // Check if expiry date is in the past
      if (expiryDateObj < today) {
        return { 
          valid: false, 
          error: 'Expiry date cannot be in the past',
          daysUntilExpiry: Math.ceil((expiryDateObj - today) / (1000 * 60 * 60 * 24))
        };
      }

      // Calculate days until expiry
      const daysUntilExpiry = Math.ceil((expiryDateObj - today) / (1000 * 60 * 60 * 24));

      // Check if expiry date is within notification period
      const isNearExpiry = daysUntilExpiry <= product.expiry_notification_days;

      // For stock in, check if batch/expiry combination already exists
      if (isStockIn && batchNumber) {
        const existingBatch = await ProductExpiryDate.findOne({
          where: {
            product_id: productId,
            batch_number: batchNumber,
            expiry_date: expiryDateObj,
            store_id: storeId,
            status: { [Op.in]: ['active', 'expired'] }
          }
        });

        if (existingBatch) {
          return { 
            valid: false, 
            error: `Batch number ${batchNumber} with expiry date ${expiryDate} already exists in this store`,
            existingBatch 
          };
        }
      }

      return { 
        valid: true, 
        requiresTracking: true,
        daysUntilExpiry,
        isNearExpiry,
        isExpired: false
      };
    } catch (error) {
      return { valid: false, error: 'Validation error occurred' };
    }
  }

  /**
   * Create or update serial number record
   * @param {Object} data - Serial number data
   * @returns {Promise<Object>} Created/updated serial number record
   */
  static async createOrUpdateSerialNumber(data) {
    try {
      const {
        product_id,
        serial_number,
        store_id,
        quantity_change,
        unit_cost,
        selling_price,
        currency_id,
        exchange_rate,
        purchase_date,
        purchase_reference,
        warranty_expiry_date,
        created_by_id,
        updated_by_id,
        notes
      } = data;

      // Check if serial number already exists
      let serialRecord = await ProductSerialNumber.findOne({
        where: {
          product_id,
          serial_number,
          store_id
        }
      });

      if (serialRecord) {
        // Update existing record
        const newQuantity = parseFloat(serialRecord.current_quantity || 0) + parseFloat(quantity_change || 0);
        
        // Calculate unit cost equivalent for updates
        const updatedUnitCost = unit_cost || serialRecord.unit_cost;
        const updatedExchangeRate = exchange_rate || serialRecord.exchange_rate;
        const unitCostEquivalent = updatedUnitCost && updatedExchangeRate ? parseFloat(updatedUnitCost) * parseFloat(updatedExchangeRate) : updatedUnitCost;
        
        await serialRecord.update({
          current_quantity: Math.max(0, newQuantity),
          total_quantity_adjusted: parseFloat(serialRecord.total_quantity_adjusted || 0) + Math.abs(parseFloat(quantity_change || 0)),
          unit_cost: updatedUnitCost,
          unit_cost_equivalent: unitCostEquivalent,
          selling_price: selling_price || serialRecord.selling_price,
          updated_by_id,
          notes: notes || serialRecord.notes,
          status: newQuantity <= 0 ? 'sold' : 'active'
        });

        } else {
        // Calculate unit cost equivalent
        const unitCostEquivalent = unit_cost && exchange_rate ? parseFloat(unit_cost) * parseFloat(exchange_rate) : unit_cost;
        
        // Create new record
        serialRecord = await ProductSerialNumber.create({
          product_id,
          serial_number,
          store_id,
          current_quantity: Math.max(0, parseFloat(quantity_change || 0)),
          total_quantity_received: quantity_change > 0 ? quantity_change : 0,
          total_quantity_sold: quantity_change < 0 ? Math.abs(quantity_change) : 0,
          total_quantity_adjusted: Math.abs(quantity_change || 0),
          unit_cost,
          unit_cost_equivalent: unitCostEquivalent,
          selling_price,
          currency_id,
          exchange_rate,
          purchase_date,
          purchase_reference,
          warranty_expiry_date,
          status: quantity_change > 0 ? 'active' : 'sold',
          notes,
          created_by_id,
          updated_by_id
        });

        }

      return serialRecord;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create or update expiry date record
   * @param {Object} data - Expiry date data
   * @returns {Promise<Object>} Created/updated expiry date record
   */
  static async createOrUpdateExpiryDate(data) {
    try {
      const {
        product_id,
        batch_number,
        expiry_date,
        store_id,
        quantity_change,
        unit_cost,
        selling_price,
        currency_id,
        exchange_rate,
        purchase_date,
        purchase_reference,
        manufacturing_date,
        created_by_id,
        updated_by_id,
        notes
      } = data;

      const expiryDateObj = new Date(expiry_date);
      const today = new Date();
      const daysUntilExpiry = Math.ceil((expiryDateObj - today) / (1000 * 60 * 60 * 24));
      const isExpired = daysUntilExpiry < 0;

      // Check if batch/expiry combination already exists
      let expiryRecord = await ProductExpiryDate.findOne({
        where: {
          product_id,
          batch_number,
          expiry_date: expiryDateObj,
          store_id
        }
      });

      if (expiryRecord) {
        // Update existing record
        const newQuantity = parseFloat(expiryRecord.current_quantity || 0) + parseFloat(quantity_change || 0);
        
        // Calculate unit cost equivalent for updates
        const updatedUnitCost = unit_cost || expiryRecord.unit_cost;
        const updatedExchangeRate = exchange_rate || expiryRecord.exchange_rate;
        const unitCostEquivalent = updatedUnitCost && updatedExchangeRate ? parseFloat(updatedUnitCost) * parseFloat(updatedExchangeRate) : updatedUnitCost;
        
        await expiryRecord.update({
          current_quantity: Math.max(0, newQuantity),
          total_quantity_adjusted: parseFloat(expiryRecord.total_quantity_adjusted || 0) + Math.abs(parseFloat(quantity_change || 0)),
          unit_cost: updatedUnitCost,
          unit_cost_equivalent: unitCostEquivalent,
          selling_price: selling_price || expiryRecord.selling_price,
          days_until_expiry: daysUntilExpiry,
          is_expired: isExpired,
          updated_by_id,
          notes: notes || expiryRecord.notes,
          status: isExpired ? 'expired' : (newQuantity <= 0 ? 'sold' : 'active')
        });

        } else {
        // Calculate unit cost equivalent
        const unitCostEquivalent = unit_cost && exchange_rate ? parseFloat(unit_cost) * parseFloat(exchange_rate) : unit_cost;
        
        // Create new record
        expiryRecord = await ProductExpiryDate.create({
          product_id,
          batch_number,
          expiry_date: expiryDateObj,
          store_id,
          current_quantity: Math.max(0, parseFloat(quantity_change || 0)),
          total_quantity_received: quantity_change > 0 ? quantity_change : 0,
          total_quantity_sold: quantity_change < 0 ? Math.abs(quantity_change) : 0,
          total_quantity_adjusted: Math.abs(quantity_change || 0),
          unit_cost,
          unit_cost_equivalent: unitCostEquivalent,
          selling_price,
          currency_id,
          exchange_rate,
          purchase_date,
          purchase_reference,
          manufacturing_date,
          days_until_expiry: daysUntilExpiry,
          is_expired: isExpired,
          status: isExpired ? 'expired' : (quantity_change > 0 ? 'active' : 'sold'),
          notes,
          created_by_id,
          updated_by_id
        });

        }

      return expiryRecord;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Process stock adjustment items with serial number and expiry date tracking
   * @param {Array} items - Stock adjustment items
   * @param {Object} adjustmentData - Stock adjustment header data
   * @returns {Promise<Object>} Processing result
   */
  static async processStockAdjustmentItems(items, adjustmentData) {
    const results = {
      success: [],
      errors: [],
      serialNumbers: [],
      expiryDates: []
    };

    // Import sequelize for raw queries
    const sequelize = require('../../config/database');

    for (const item of items) {
      try {
        const { product_id, serial_number, expiry_date, batch_number, quantity_change } = item;

        // Check if product requires serial number tracking
        if (serial_number) {
          // Get product to check if it requires serial tracking
          const productQuery = `SELECT track_serial_number FROM products WHERE id = $1`;
          const productResult = await sequelize.query(productQuery, {
            replacements: [product_id],
            type: sequelize.QueryTypes.SELECT
          });

          if (productResult.length > 0 && productResult[0].track_serial_number) {
            // Check if serial number already exists
            const existingSerialQuery = `
              SELECT id FROM product_serial_numbers 
              WHERE product_id = $1 AND serial_number = $2 AND store_id = $3
            `;
            
            const existingSerialResult = await sequelize.query(existingSerialQuery, {
              replacements: [product_id, serial_number, adjustmentData.store_id],
              type: sequelize.QueryTypes.SELECT
            });

            if (existingSerialResult.length > 0) {
              // Update existing record
              const updateSerialQuery = `
                UPDATE product_serial_numbers 
                SET 
                  current_quantity = current_quantity + $1,
                  total_quantity_adjusted = total_quantity_adjusted + ABS($1),
                  unit_cost = $2,
                  unit_cost_equivalent = $3,
                  updated_by_id = $4,
                  updated_at = NOW(),
                  notes = COALESCE(notes, '') || ' | Updated via stock adjustment ' || $5
                WHERE id = $6
              `;
              
              const unitCostEquivalent = item.unit_cost * adjustmentData.exchange_rate;
              
              await sequelize.query(updateSerialQuery, {
                replacements: [
                  quantity_change,
                  item.unit_cost,
                  unitCostEquivalent,
                  adjustmentData.created_by_id,
                  adjustmentData.reference_number,
                  existingSerialResult[0].id
                ]
              });
              
              } else {
              // Create new record
              const createSerialQuery = `
                INSERT INTO product_serial_numbers (
                  uuid, product_id, serial_number, store_id, current_quantity,
                  total_quantity_received, total_quantity_sold, total_quantity_adjusted,
                  unit_cost, unit_cost_equivalent, selling_price, currency_id, exchange_rate,
                  purchase_date, purchase_reference, status, notes, created_by_id, updated_by_id, is_active
                ) VALUES (
                  gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, true
                )
              `;
              
              const unitCostEquivalent = item.unit_cost * adjustmentData.exchange_rate;
              const currentQuantity = Math.max(0, parseFloat(quantity_change || 0));
              const totalQuantityReceived = quantity_change > 0 ? quantity_change : 0;
              const totalQuantitySold = quantity_change < 0 ? Math.abs(quantity_change) : 0;
              const totalQuantityAdjusted = Math.abs(quantity_change || 0);
              const status = quantity_change > 0 ? 'active' : 'sold';
              const notes = `Stock adjustment ${adjustmentData.reference_number}: ${serial_number}`;
              
              await sequelize.query(createSerialQuery, {
                replacements: [
                  product_id, serial_number, adjustmentData.store_id, currentQuantity,
                  totalQuantityReceived, totalQuantitySold, totalQuantityAdjusted,
                  item.unit_cost, unitCostEquivalent, null, adjustmentData.currency_id,
                  adjustmentData.exchange_rate, adjustmentData.adjustment_date, adjustmentData.reference_number,
                  status, notes, adjustmentData.created_by_id, adjustmentData.created_by_id
                ]
              });
              
              }
            
            results.serialNumbers.push({
              product_id,
              serial_number,
              status: 'processed'
            });
          }
        }

        // Check if product requires expiry date tracking
        if (expiry_date) {
          // Get product to check if it requires expiry tracking
          const productQuery = `SELECT expiry_notification_days FROM products WHERE id = $1`;
          const productResult = await sequelize.query(productQuery, {
            replacements: [product_id],
            type: sequelize.QueryTypes.SELECT
          });

          if (productResult.length > 0 && productResult[0].expiry_notification_days) {
            // Check if expiry record already exists
            const existingExpiryQuery = `
              SELECT id FROM product_expiry_dates 
              WHERE product_id = $1 AND batch_number = $2 AND expiry_date = $3 AND store_id = $4
            `;
            
            const existingExpiryResult = await sequelize.query(existingExpiryQuery, {
              replacements: [product_id, batch_number, expiry_date, adjustmentData.store_id],
              type: sequelize.QueryTypes.SELECT
            });

            if (existingExpiryResult.length > 0) {
              // Update existing record
              const updateExpiryQuery = `
                UPDATE product_expiry_dates 
                SET 
                  current_quantity = current_quantity + $1,
                  total_quantity_adjusted = total_quantity_adjusted + ABS($1),
                  unit_cost = $2,
                  unit_cost_equivalent = $3,
                  days_until_expiry = $4,
                  is_expired = $5,
                  updated_by_id = $6,
                  updated_at = NOW(),
                  notes = COALESCE(notes, '') || ' | Updated via stock adjustment ' || $7
                WHERE id = $8
              `;
              
              const unitCostEquivalent = item.unit_cost * adjustmentData.exchange_rate;
              const expiryDateObj = new Date(expiry_date);
              const today = new Date();
              const daysUntilExpiry = Math.ceil((expiryDateObj - today) / (1000 * 60 * 60 * 24));
              const isExpired = daysUntilExpiry < 0;
              
              await sequelize.query(updateExpiryQuery, {
                replacements: [
                  quantity_change,
                  item.unit_cost,
                  unitCostEquivalent,
                  daysUntilExpiry,
                  isExpired,
                  adjustmentData.created_by_id,
                  adjustmentData.reference_number,
                  existingExpiryResult[0].id
                ]
              });
              
              } else {
              // Create new record
              const createExpiryQuery = `
                INSERT INTO product_expiry_dates (
                  uuid, product_id, batch_number, expiry_date, store_id, current_quantity,
                  total_quantity_received, total_quantity_sold, total_quantity_adjusted,
                  unit_cost, unit_cost_equivalent, selling_price, currency_id, exchange_rate,
                  purchase_date, purchase_reference, status, days_until_expiry, is_expired,
                  notes, created_by_id, updated_by_id, is_active
                ) VALUES (
                  gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, true
                )
              `;
              
              const unitCostEquivalent = item.unit_cost * adjustmentData.exchange_rate;
              const currentQuantity = Math.max(0, parseFloat(quantity_change || 0));
              const totalQuantityReceived = quantity_change > 0 ? quantity_change : 0;
              const totalQuantitySold = quantity_change < 0 ? Math.abs(quantity_change) : 0;
              const totalQuantityAdjusted = Math.abs(quantity_change || 0);
              const status = quantity_change > 0 ? 'active' : 'sold';
              const expiryDateObj = new Date(expiry_date);
              const today = new Date();
              const daysUntilExpiry = Math.ceil((expiryDateObj - today) / (1000 * 60 * 60 * 24));
              const isExpired = daysUntilExpiry < 0;
              const notes = `Stock adjustment ${adjustmentData.reference_number}: Expiry ${expiry_date}`;
              
              await sequelize.query(createExpiryQuery, {
                replacements: [
                  product_id, batch_number, expiry_date, adjustmentData.store_id, currentQuantity,
                  totalQuantityReceived, totalQuantitySold, totalQuantityAdjusted,
                  item.unit_cost, unitCostEquivalent, null, adjustmentData.currency_id,
                  adjustmentData.exchange_rate, adjustmentData.adjustment_date, adjustmentData.reference_number,
                  status, daysUntilExpiry, isExpired, notes, adjustmentData.created_by_id, adjustmentData.created_by_id
                ]
              });
              
              }
            
            results.expiryDates.push({
              product_id,
              expiry_date,
              batch_number,
              status: 'processed'
            });
          }
        }

        results.success.push(item);
      } catch (error) {
        results.errors.push({
          product_id: item.product_id,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get serial number history for a product
   * @param {string} productId - Product ID
   * @param {string} storeId - Store ID (optional)
   * @returns {Promise<Array>} Serial number history
   */
  static async getSerialNumberHistory(productId, storeId = null) {
    const whereClause = { product_id: productId, is_active: true };
    if (storeId) whereClause.store_id = storeId;

    return await ProductSerialNumber.findAll({
      where: whereClause,
      include: [
        { model: require('../models/product'), as: 'product' },
        { model: require('../models/productStoreLocation'), as: 'store' },
        { model: require('../models/user'), as: 'createdByUser' }
      ],
      order: [['created_at', 'DESC']]
    });
  }

  /**
   * Get expiry date history for a product
   * @param {string} productId - Product ID
   * @param {string} storeId - Store ID (optional)
   * @returns {Promise<Array>} Expiry date history
   */
  static async getExpiryDateHistory(productId, storeId = null) {
    const whereClause = { product_id: productId, is_active: true };
    if (storeId) whereClause.store_id = storeId;

    return await ProductExpiryDate.findAll({
      where: whereClause,
      include: [
        { model: require('../models/product'), as: 'product' },
        { model: require('../models/productStoreLocation'), as: 'store' },
        { model: require('../models/user'), as: 'createdByUser' }
      ],
      order: [['expiry_date', 'ASC']]
    });
  }

  /**
   * Get products nearing expiry
   * @param {string} storeId - Store ID (optional)
   * @param {number} daysThreshold - Days threshold for expiry warning
   * @returns {Promise<Array>} Products nearing expiry
   */
  static async getProductsNearingExpiry(storeId = null, daysThreshold = 30) {
    const whereClause = { 
      is_active: true,
      is_expired: false,
      days_until_expiry: { [Op.lte]: daysThreshold }
    };
    if (storeId) whereClause.store_id = storeId;

    return await ProductExpiryDate.findAll({
      where: whereClause,
      include: [
        { model: require('../models/product'), as: 'product' },
        { model: require('../models/productStoreLocation'), as: 'store' }
      ],
      order: [['days_until_expiry', 'ASC']]
    });
  }
}

module.exports = SerialExpiryTrackingService; 