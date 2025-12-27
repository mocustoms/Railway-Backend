const Product = require('../models/product');
const ProductStore = require('../models/productStore');
const PriceHistory = require('../models/priceHistory');
const PriceChangeReason = require('../models/priceChangeReason');
const CostingMethod = require('../models/costingMethod');
const { Op } = require('sequelize');

class StockAdjustmentIntegrationService {
    /**
     * Update product store quantities (using product_stores table)
     * @param {Array} items - Stock adjustment items
     * @param {Object} adjustmentData - Adjustment header data
     * @returns {Promise<Array>} Updated product stores with log info
     */
    static async updateProductStores(items, adjustmentData) {
        const updatedProductStores = [];
        for (const item of items) {
            try {
                // Find existing product-store record
                let productStore = await ProductStore.findOne({
                    where: {
                        product_id: item.product_id,
                        store_id: adjustmentData.store_id
                    }
                });

                if (productStore) {
                    // Update existing record
                    const currentQuantity = parseFloat(productStore.quantity || 0);
                    const newQuantity = currentQuantity + parseFloat(item.quantity_change || 0);
                    
                    // Calculate store-specific average cost using weighted average
                    const currentCost = parseFloat(productStore.average_cost || 0);
                    const adjustmentQuantity = parseFloat(item.quantity_change || 0);
                    const adjustmentCost = parseFloat(item.unit_cost || 0);
                    
                    let newAverageCost = currentCost;
                    if (adjustmentQuantity > 0) {
                        // Stock in - weighted average for this store
                        const totalValue = (currentQuantity * currentCost) + (adjustmentQuantity * adjustmentCost);
                        const totalQuantity = currentQuantity + adjustmentQuantity;
                        newAverageCost = totalQuantity > 0 ? totalValue / totalQuantity : adjustmentCost;
                    } else if (adjustmentQuantity < 0 && Math.abs(adjustmentCost - currentCost) > 0.01) {
                        // Stock out with cost adjustment - update to new cost
                        newAverageCost = adjustmentCost;
                    }
                    
                    await productStore.update({
                        quantity: Math.max(0, newQuantity),
                        average_cost: newAverageCost,
                        last_updated: new Date()
                    });
                    updatedProductStores.push({
                        product_id: item.product_id,
                        store_id: adjustmentData.store_id,
                        action: 'updated',
                        old_quantity: currentQuantity,
                        new_quantity: newQuantity,
                        old_cost: currentCost,
                        new_cost: newAverageCost
                    });
                } else {
                    // Create new record if it doesn't exist and quantity is positive
                    if (parseFloat(item.quantity_change || 0) > 0) {
                        productStore = await ProductStore.create({
                            product_id: item.product_id,
                            store_id: adjustmentData.store_id,
                            quantity: Math.max(0, parseFloat(item.quantity_change || 0)),
                            average_cost: parseFloat(item.unit_cost || 0),
                            min_quantity: 0,
                            reorder_point: 0,
                            is_active: true,
                            assigned_by: adjustmentData.created_by_id,
                            assigned_at: new Date(),
                            last_updated: new Date()
                        });
                        updatedProductStores.push({
                            product_id: item.product_id,
                            store_id: adjustmentData.store_id,
                            action: 'created',
                            new_quantity: parseFloat(item.quantity_change || 0),
                            new_cost: parseFloat(item.unit_cost || 0)
                        });
                    } else {
                        // No record exists and adjustment is negative or zero
                        updatedProductStores.push({
                            product_id: item.product_id,
                            store_id: adjustmentData.store_id,
                            action: 'skipped',
                            reason: 'No record found and negative/zero quantity'
                        });
                    }
                }
            } catch (error) {
                updatedProductStores.push({
                    product_id: item.product_id,
                    store_id: adjustmentData.store_id,
                    action: 'error',
                    error: error.message
                });
            }
        }
        return updatedProductStores;
    }

    /**
     * Track price changes in price history
     * @param {Array} items - Stock adjustment items
     * @param {Object} adjustmentData - Adjustment header data
     * @returns {Promise<Array>} Created price history records
     */
    static async trackPriceChanges(items, adjustmentData) {
        const priceHistoryRecords = [];

        for (const item of items) {
            try {
                const product = await Product.findByPk(item.product_id);
                if (!product) {
                    continue;
                }

                // Get default costing method
                const defaultCostingMethod = await CostingMethod.findOne({
                    where: { code: 'AVG' }
                });

                // Get adjustment reason for price change reason
                const adjustmentReason = await require('../models/adjustmentReason').findByPk(adjustmentData.reason_id);
                
                // Map adjustment reason to price change reason
                let priceChangeReason = null;
                if (adjustmentReason) {
                    const reasonName = adjustmentReason.name.toLowerCase();
                    if (reasonName.includes('purchase') || reasonName.includes('buy')) {
                        priceChangeReason = await PriceChangeReason.findOne({ where: { code: 'PURCHASE' } });
                    } else if (reasonName.includes('sale') || reasonName.includes('sell')) {
                        priceChangeReason = await PriceChangeReason.findOne({ where: { code: 'SALE' } });
                    } else {
                        priceChangeReason = await PriceChangeReason.findOne({ where: { code: 'ADJUSTMENT' } });
                    }
                }

                // Check if there's a significant price change
                // Get store-specific current cost
                const productStore = await ProductStore.findOne({
                    where: {
                        product_id: item.product_id,
                        store_id: adjustmentData.store_id
                    }
                });
                
                const oldAverageCost = parseFloat(productStore?.average_cost || product.average_cost || 0);
                const newAverageCost = parseFloat(item.unit_cost || 0);
                const oldSellingPrice = parseFloat(product.selling_price || 0);
                const newSellingPrice = oldSellingPrice; // Keep selling price unchanged during stock adjustment

                // Only track price changes if there's a significant difference (more than 0.01)
                const costChanged = Math.abs(oldAverageCost - newAverageCost) > 0.01;
                const sellingPriceChanged = false; // Selling price should not change during stock adjustment

                if (costChanged) {
                    const priceHistoryRecord = await PriceHistory.create({
                        entity_type: 'product',
                        entity_id: item.product_id,
                        entity_code: product.code,
                        entity_name: product.name,
                        module_name: 'Stock Adjustment',
                        transaction_type_id: adjustmentData.transaction_type_id,
                        transaction_type_name: 'Stock Adjustment',
                        old_average_cost: oldAverageCost,
                        new_average_cost: newAverageCost,
                        old_selling_price: oldSellingPrice,
                        new_selling_price: newSellingPrice,
                        costing_method_id: defaultCostingMethod?.id,
                        price_change_reason_id: priceChangeReason?.id,
                        quantity: Math.abs(parseFloat(item.quantity_change || 0)),
                        unit: product.unit_of_measure || 'PCS',
                        currency_id: adjustmentData.currency_id,
                        exchange_rate: parseFloat(item.exchange_rate || 1),
                        equivalent_amount: parseFloat(item.equivalent_amount || 0),
                        original_currency_id: adjustmentData.original_currency_id,
                        original_old_price: parseFloat(item.unit_cost || 0),
                        original_new_price: parseFloat(item.unit_cost || 0),
                        conversion_notes: adjustmentData.conversion_notes,
                        reference_number: adjustmentData.reference_number,
                        notes: `Stock adjustment: ${adjustmentData.adjustment_type} - ${adjustmentReason?.name || 'No reason'} (Store-specific cost update)`,
                        change_date: new Date(),
                        transaction_date: adjustmentData.adjustment_date,
                        created_by: adjustmentData.created_by_id
                    });

                    priceHistoryRecords.push(priceHistoryRecord);
                } else {
                    }
            } catch (error) {
                }
        }

        return priceHistoryRecords;
    }

    /**
     * Comprehensive integration for stock adjustment
     * @param {Array} items - Stock adjustment items
     * @param {Object} adjustmentData - Adjustment header data
     * @returns {Promise<Object>} Integration results
     */
    static async performComprehensiveIntegration(items, adjustmentData) {
        const results = {
            productStores: [],
            priceHistory: [],
            errors: []
        };

        try {
            // 1. Update product stores (store-specific stock and costs)
            results.productStores = await this.updateProductStores(items, adjustmentData);

            // 2. Track price changes
            results.priceHistory = await this.trackPriceChanges(items, adjustmentData);

            } catch (error) {
            results.errors.push(error.message);
        }

        return results;
    }

    /**
     * Get integration summary for a stock adjustment
     * @param {string} adjustmentId - Stock adjustment ID
     * @returns {Promise<Object>} Integration summary
     */
    static async getIntegrationSummary(adjustmentId) {
        try {
            const adjustment = await require('../models/stockAdjustment').findByPk(adjustmentId, {
                include: [
                    {
                        model: require('../models/stockAdjustmentItem'),
                        as: 'items',
                        include: [
                            {
                                model: Product,
                                as: 'product'
                            }
                        ]
                    }
                ]
            });

            if (!adjustment) {
                throw new Error('Stock adjustment not found');
            }

            const summary = {
                adjustment: {
                    id: adjustment.id,
                    reference_number: adjustment.reference_number,
                    adjustment_date: adjustment.adjustment_date,
                    adjustment_type: adjustment.adjustment_type,
                    total_items: adjustment.total_items,
                    total_value: adjustment.total_value
                },
                items: adjustment.items.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product?.name,
                    quantity_change: item.quantity_change,
                    unit_cost: item.unit_cost,
                    total_value: item.total_value
                })),
                integrations: {
                    products_updated: adjustment.items.length,
                    product_stores_updated: adjustment.items.length,
                    price_history_records: 0, // Would need to count from price_history table
                    serial_numbers_processed: 0, // Would need to count from product_serial_numbers table
                    expiry_dates_processed: 0, // Would need to count from product_expiry_dates table
                    transactions_created: 0, // Would need to count from product_transactions table
                    gl_entries_created: 0 // Would need to count from general_ledger table
                }
            };

            return summary;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = StockAdjustmentIntegrationService; 