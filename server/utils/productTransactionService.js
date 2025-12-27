const ProductTransaction = require('../models/productTransaction');
const { Op } = require('sequelize');

class ProductTransactionService {
    /**
     * Log a single product transaction
     * @param {Object} transactionData - Transaction data
     * @param {Object} dbTransaction - Sequelize transaction (optional)
     * @returns {Promise<Object>} Created transaction
     */
    static async logTransaction(transactionData, dbTransaction = null) {
        try {
            const {
                transaction_type_id,
                transaction_type_name,
                transaction_date,
                financial_year_id,
                financial_year_name,
                store_id,
                product_id,
                product_type,
                manufacturer_id,
                model_id,
                brand_name_id,
                packaging_id,
                packaging_issue_quantity,
                supplier_id,
                customer_id,
                customer_name,
                created_by_id,
                updated_by_id,
                reference_number,
                notes,
                exchange_rate,
                currency_id,
                quantity_in,
                quantity_out,
                user_unit_cost,
                product_average_cost,
                conversion_notes,
                serial_number,
                expiry_date,
                reference_type
            } = transactionData;

            // Calculate equivalent amount (user_unit_cost * exchange_rate)
            const unitCost = parseFloat(user_unit_cost || 0);
            const exchangeRate = parseFloat(exchange_rate || 1);
            const equivalentAmount = unitCost * exchangeRate;

            // Determine user entered currency ID (if different from default currency)
            const Currency = require('../models/currency');
            const defaultCurrency = await Currency.findOne({ 
                where: { is_default: true },
                transaction: dbTransaction
            });
            const userEnteredCurrencyId = currency_id && currency_id !== defaultCurrency?.id ? currency_id : null;

            // Get system default currency
            const systemDefaultCurrency = await Currency.findOne({ 
              where: { is_default: true },
              transaction: dbTransaction
            });
            
            // Get companyId from user if available (passed via transactionData)
            const companyId = transactionData.companyId || null;

            const transaction = await ProductTransaction.create({
                uuid: require('crypto').randomUUID(),
                system_date: new Date(),
                transaction_date,
                financial_year_id,
                financial_year_name,
                transaction_type_id,
                transaction_type_name,
                store_id,
                product_id,
                product_type: product_type || null,
                manufacturer_id,
                model_id,
                brand_name_id,
                packaging_id,
                packaging_issue_quantity,
                supplier_id,
                customer_id,
                customer_name,
                created_by_id,
                updated_by_id,
                reference_number,
                notes,
                exchange_rate,
                currency_id,
                system_currency_id: systemDefaultCurrency?.id,
                quantity_in: quantity_in || 0,
                quantity_out: quantity_out || 0,
                product_average_cost: parseFloat(product_average_cost || 0),
                user_unit_cost: unitCost, // User's original input
                equivalent_amount: equivalentAmount, // Calculated equivalent amount
                conversion_notes,
                serial_number,
                expiry_date,
                reference_type: reference_type || 'STOCK_ADJUSTMENT',
                is_active: true,
                companyId: companyId
            }, { transaction: dbTransaction });

            return transaction;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Log stock adjustment transactions
     * @param {Object} adjustmentData - Stock adjustment header data
     * @param {Array} items - Stock adjustment items
     * @returns {Promise<Array>} Created transactions
     */
    static async logStockAdjustment(adjustmentData, items) {
        const transactions = [];

        for (const item of items) {
            try {
                // Fetch product details to populate missing fields
                const Product = require('../models/product');
                const product = await Product.findByPk(item.product_id);
                
                if (!product) {
                    continue;
                }

                // Fetch the product's current average cost before the transaction
                const originalAverageCost = product.average_cost;

                // Determine quantity in/out based on quantity change
                const quantityChange = parseFloat(item.quantity_change || 0);
                const quantityIn = quantityChange > 0 ? quantityChange : 0;
                const quantityOut = quantityChange < 0 ? Math.abs(quantityChange) : 0;

                const transaction = await this.logTransaction({
                    transaction_type_id: adjustmentData.transaction_type_id,
                    transaction_type_name: adjustmentData.transaction_type_name,
                    transaction_date: adjustmentData.adjustment_date,
                    financial_year_id: adjustmentData.financial_year_id,
                    financial_year_name: adjustmentData.financial_year_name,
                    store_id: adjustmentData.store_id,
                    product_id: item.product_id,
                    product_type: product.product_type || null,
                    manufacturer_id: product.manufacturer_id,
                    model_id: product.model_id,
                    brand_name_id: product.brand_id,
                    packaging_id: product.default_packaging_id || product.unit_id,
                    packaging_issue_quantity: product.default_quantity || 0,
                    supplier_id: null, // Not available in stock adjustments
                    customer_id: null, // Not available in stock adjustments
                    customer_name: null, // Not available in stock adjustments
                    created_by_id: adjustmentData.created_by_id,
                    updated_by_id: adjustmentData.updated_by_id,
                    reference_number: adjustmentData.reference_number,
                    notes: adjustmentData.notes,
                    exchange_rate: adjustmentData.exchange_rate,
                    currency_id: adjustmentData.currency_id,
                    quantity_in: quantityIn,
                    quantity_out: quantityOut,
                    user_unit_cost: parseFloat(item.unit_cost || 0), // User's original input
                    product_average_cost: originalAverageCost, // Product's current average cost
                    conversion_notes: adjustmentData.conversion_notes,
                    serial_number: item.serial_number,
                    expiry_date: item.expiry_date,
                    reference_type: 'STOCK_ADJUSTMENT'
                });

                transactions.push(transaction);
            } catch (error) {
                // Continue with other items even if one fails
            }
        }

        return transactions;
    }

    /**
     * Get product transactions for a specific product
     * @param {string} productId - Product ID
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Product transactions
     */
    static async getProductTransactions(productId, options = {}) {
        const {
            startDate,
            endDate,
            transactionType,
            limit = 100,
            offset = 0
        } = options;

        const whereClause = {
            product_id: productId,
            is_active: true
        };

        if (startDate || endDate) {
            whereClause.transaction_date = {};
            if (startDate) whereClause.transaction_date[Op.gte] = startDate;
            if (endDate) whereClause.transaction_date[Op.lte] = endDate;
        }

        if (transactionType) {
            whereClause.transaction_type_name = transactionType;
        }

        return await ProductTransaction.findAll({
            where: whereClause,
            order: [['transaction_date', 'DESC'], ['created_at', 'DESC']],
            limit,
            offset
        });
    }

    /**
     * Get product balance as of a specific date
     * @param {string} productId - Product ID
     * @param {Date} asOfDate - As of date
     * @param {string} storeId - Store ID (optional)
     * @returns {Promise<Object>} Product balance
     */
    static async getProductBalance(productId, asOfDate, storeId = null) {
        const whereClause = {
            product_id: productId,
            is_active: true
        };

        if (storeId) {
            whereClause.store_id = storeId;
        }

        if (asOfDate) {
            whereClause.transaction_date = { [Op.lte]: asOfDate };
        }

        const result = await ProductTransaction.findOne({
            where: whereClause,
            attributes: [
                [sequelize.fn('SUM', sequelize.col('quantity_in')), 'total_in'],
                [sequelize.fn('SUM', sequelize.col('quantity_out')), 'total_out']
            ]
        });

        const totalIn = parseFloat(result?.dataValues?.total_in || 0);
        const totalOut = parseFloat(result?.dataValues?.total_out || 0);

        return {
            product_id: productId,
            store_id: storeId,
            as_of_date: asOfDate,
            total_in: totalIn,
            total_out: totalOut,
            balance: totalIn - totalOut
        };
    }
}

module.exports = ProductTransactionService; 