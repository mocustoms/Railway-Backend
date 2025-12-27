const PriceHistory = require('../models/priceHistory');
const { Op } = require('sequelize');

class CostingCalculator {
    /**
     * Calculate cost using specified costing method
     * @param {string} entityType - Type of entity (product, service, etc.)
     * @param {string} entityId - ID of the entity
     * @param {string} method - Costing method (FIFO, LIFO, AVG, SPEC)
     * @param {Date} asOfDate - Date to calculate as of (default: current date)
     * @param {Object} options - Additional options
     * @returns {Object} Cost calculation result
     */
    static async calculateCost(entityType, entityId, method = 'AVG', asOfDate = new Date(), options = {}) {
        try {
            // Get price history up to the specified date
            const history = await PriceHistory.findAll({
                where: {
                    entity_type: entityType,
                    entity_id: entityId,
                    change_date: { [Op.lte]: asOfDate },
                    new_average_cost: { [Op.not]: null }
                },
                order: [['change_date', 'ASC']],
                include: [
                    {
                        model: require('../models/costingMethod'),
                        as: 'costingMethod',
                        attributes: ['code', 'name']
                    },
                    {
                        model: require('../models/priceChangeReason'),
                        as: 'priceChangeReason',
                        attributes: ['code', 'name', 'category']
                    }
                ]
            });

            if (history.length === 0) {
                return {
                    method,
                    entityType,
                    entityId,
                    asOfDate,
                    calculatedCost: null,
                    history: [],
                    message: 'No cost history found'
                };
            }

            let calculatedCost = null;
            let calculationDetails = {};

            switch (method.toUpperCase()) {
                case 'FIFO':
                    calculatedCost = this.calculateFIFO(history);
                    calculationDetails = this.getFIFODetails(history);
                    break;
                case 'LIFO':
                    calculatedCost = this.calculateLIFO(history);
                    calculationDetails = this.getLIFODetails(history);
                    break;
                case 'AVG':
                    calculatedCost = this.calculateAverage(history);
                    calculationDetails = this.getAverageDetails(history);
                    break;
                case 'SPEC':
                    calculatedCost = this.calculateSpecific(history, options);
                    calculationDetails = this.getSpecificDetails(history, options);
                    break;
                default:
                    calculatedCost = this.calculateAverage(history);
                    calculationDetails = this.getAverageDetails(history);
            }

            return {
                method: method.toUpperCase(),
                entityType,
                entityId,
                asOfDate,
                calculatedCost,
                calculationDetails,
                history: history.map(record => ({
                    id: record.id,
                    changeDate: record.change_date,
                    oldCost: record.old_average_cost,
                    newCost: record.new_average_cost,
                    quantity: record.quantity,
                    unit: record.unit,
                    module: record.module_name,
                    reason: record.priceChangeReason?.name,
                    referenceNumber: record.reference_number,
                    notes: record.notes
                })),
                totalRecords: history.length
            };

        } catch (error) {
            throw new Error(`Failed to calculate ${method} cost: ${error.message}`);
        }
    }

    /**
     * Calculate FIFO (First In, First Out) cost
     * Uses the oldest cost in the history
     */
    static calculateFIFO(history) {
        if (history.length === 0) return null;
        
        // Get the first (oldest) cost change
        const firstRecord = history[0];
        return firstRecord.new_average_cost;
    }

    /**
     * Get FIFO calculation details
     */
    static getFIFODetails(history) {
        if (history.length === 0) return {};

        const firstRecord = history[0];
        return {
            usedRecord: {
                date: firstRecord.change_date,
                cost: firstRecord.new_average_cost,
                reason: firstRecord.priceChangeReason?.name,
                module: firstRecord.module_name
            },
            explanation: `FIFO uses the oldest cost in the history (${firstRecord.change_date.toLocaleDateString()})`
        };
    }

    /**
     * Calculate LIFO (Last In, First Out) cost
     * Uses the most recent cost in the history
     */
    static calculateLIFO(history) {
        if (history.length === 0) return null;
        
        // Get the last (most recent) cost change
        const lastRecord = history[history.length - 1];
        return lastRecord.new_average_cost;
    }

    /**
     * Get LIFO calculation details
     */
    static getLIFODetails(history) {
        if (history.length === 0) return {};

        const lastRecord = history[history.length - 1];
        return {
            usedRecord: {
                date: lastRecord.change_date,
                cost: lastRecord.new_average_cost,
                reason: lastRecord.priceChangeReason?.name,
                module: lastRecord.module_name
            },
            explanation: `LIFO uses the most recent cost in the history (${lastRecord.change_date.toLocaleDateString()})`
        };
    }

    /**
     * Calculate Average cost
     * Weighted average based on quantities, or simple average if no quantities
     */
    static calculateAverage(history) {
        if (history.length === 0) return null;

        // Check if we have quantity information
        const hasQuantities = history.some(record => record.quantity && record.quantity > 0);

        if (hasQuantities) {
            // Weighted average based on quantities
            let totalCost = 0;
            let totalQuantity = 0;

            history.forEach(record => {
                if (record.quantity && record.new_average_cost) {
                    totalCost += record.quantity * record.new_average_cost;
                    totalQuantity += record.quantity;
                }
            });

            return totalQuantity > 0 ? totalCost / totalQuantity : null;
        } else {
            // Simple average of all costs
            const costs = history
                .filter(record => record.new_average_cost)
                .map(record => record.new_average_cost);

            if (costs.length === 0) return null;

            const sum = costs.reduce((acc, cost) => acc + parseFloat(cost), 0);
            return sum / costs.length;
        }
    }

    /**
     * Get Average calculation details
     */
    static getAverageDetails(history) {
        if (history.length === 0) return {};

        const hasQuantities = history.some(record => record.quantity && record.quantity > 0);
        const costs = history
            .filter(record => record.new_average_cost)
            .map(record => record.new_average_cost);

        if (hasQuantities) {
            let totalCost = 0;
            let totalQuantity = 0;
            const quantityDetails = [];

            history.forEach(record => {
                if (record.quantity && record.new_average_cost) {
                    const costContribution = record.quantity * record.new_average_cost;
                    totalCost += costContribution;
                    totalQuantity += record.quantity;
                    
                    quantityDetails.push({
                        date: record.change_date,
                        quantity: record.quantity,
                        cost: record.new_average_cost,
                        contribution: costContribution
                    });
                }
            });

            return {
                type: 'Weighted Average',
                totalCost,
                totalQuantity,
                averageCost: totalQuantity > 0 ? totalCost / totalQuantity : null,
                quantityDetails,
                explanation: `Weighted average based on quantities: Total Cost (${totalCost}) ÷ Total Quantity (${totalQuantity})`
            };
        } else {
            const sum = costs.reduce((acc, cost) => acc + parseFloat(cost), 0);
            const average = sum / costs.length;

            return {
                type: 'Simple Average',
                totalCosts: sum,
                numberOfCosts: costs.length,
                averageCost: average,
                allCosts: costs,
                explanation: `Simple average of ${costs.length} cost changes: Total (${sum}) ÷ Count (${costs.length})`
            };
        }
    }

    /**
     * Calculate Specific Identification cost
     * Uses specific cost based on criteria (e.g., batch number, reference)
     */
    static calculateSpecific(history, options = {}) {
        if (history.length === 0) return null;

        const { referenceNumber, date, reason } = options;

        // Find specific record based on criteria
        let specificRecord = null;

        if (referenceNumber) {
            specificRecord = history.find(record => 
                record.reference_number === referenceNumber
            );
        } else if (date) {
            specificRecord = history.find(record => 
                record.change_date.toDateString() === new Date(date).toDateString()
            );
        } else if (reason) {
            specificRecord = history.find(record => 
                record.priceChangeReason?.code === reason
            );
        }

        return specificRecord ? specificRecord.new_average_cost : null;
    }

    /**
     * Get Specific calculation details
     */
    static getSpecificDetails(history, options = {}) {
        if (history.length === 0) return {};

        const { referenceNumber, date, reason } = options;
        let specificRecord = null;
        let criteria = '';

        if (referenceNumber) {
            specificRecord = history.find(record => 
                record.reference_number === referenceNumber
            );
            criteria = `Reference Number: ${referenceNumber}`;
        } else if (date) {
            specificRecord = history.find(record => 
                record.change_date.toDateString() === new Date(date).toDateString()
            );
            criteria = `Date: ${date}`;
        } else if (reason) {
            specificRecord = history.find(record => 
                record.priceChangeReason?.code === reason
            );
            criteria = `Reason: ${reason}`;
        }

        if (!specificRecord) {
            return {
                found: false,
                criteria,
                explanation: `No specific record found matching criteria: ${criteria}`
            };
        }

        return {
            found: true,
            criteria,
            usedRecord: {
                date: specificRecord.change_date,
                cost: specificRecord.new_average_cost,
                reason: specificRecord.priceChangeReason?.name,
                module: specificRecord.module_name,
                referenceNumber: specificRecord.reference_number
            },
            explanation: `Specific identification using criteria: ${criteria}`
        };
    }

    /**
     * Compare different costing methods for an entity
     * @param {string} entityType - Type of entity
     * @param {string} entityId - ID of the entity
     * @param {Date} asOfDate - Date to calculate as of
     * @returns {Object} Comparison of all costing methods
     */
    static async compareCostingMethods(entityType, entityId, asOfDate = new Date()) {
        const methods = ['FIFO', 'LIFO', 'AVG'];
        const results = {};

        for (const method of methods) {
            try {
                results[method] = await this.calculateCost(entityType, entityId, method, asOfDate);
            } catch (error) {
                results[method] = {
                    error: error.message,
                    method,
                    calculatedCost: null
                };
            }
        }

        return {
            entityType,
            entityId,
            asOfDate,
            comparison: results,
            summary: {
                fifoCost: results.FIFO?.calculatedCost,
                lifoCost: results.LIFO?.calculatedCost,
                averageCost: results.AVG?.calculatedCost,
                costRange: {
                    min: Math.min(...Object.values(results).map(r => r.calculatedCost).filter(c => c !== null)),
                    max: Math.max(...Object.values(results).map(r => r.calculatedCost).filter(c => c !== null))
                }
            }
        };
    }

    /**
     * Get cost trend analysis for an entity
     * @param {string} entityType - Type of entity
     * @param {string} entityId - ID of the entity
     * @param {Date} startDate - Start date for analysis
     * @param {Date} endDate - End date for analysis
     * @returns {Object} Cost trend analysis
     */
    static async getCostTrend(entityType, entityId, startDate, endDate) {
        const history = await PriceHistory.findAll({
            where: {
                entity_type: entityType,
                entity_id: entityId,
                change_date: {
                    [Op.between]: [startDate, endDate]
                },
                new_average_cost: { [Op.not]: null }
            },
            order: [['change_date', 'ASC']]
        });

        const costChanges = history.map(record => ({
            date: record.change_date,
            oldCost: record.old_average_cost,
            newCost: record.new_average_cost,
            change: record.new_average_cost - (record.old_average_cost || 0),
            percentageChange: record.old_average_cost ? 
                ((record.new_average_cost - record.old_average_cost) / record.old_average_cost) * 100 : null,
            reason: record.priceChangeReason?.name,
            module: record.module_name
        }));

        const totalChanges = costChanges.length;
        const costIncrease = costChanges.filter(change => change.change > 0).length;
        const costDecrease = costChanges.filter(change => change.change < 0).length;
        const noChange = costChanges.filter(change => change.change === 0).length;

        const averageChange = costChanges.length > 0 ? 
            costChanges.reduce((sum, change) => sum + change.change, 0) / costChanges.length : 0;

        return {
            entityType,
            entityId,
            period: { startDate, endDate },
            summary: {
                totalChanges,
                costIncrease,
                costDecrease,
                noChange,
                averageChange
            },
            costChanges,
            trend: costChanges.length > 1 ? {
                direction: averageChange > 0 ? 'increasing' : averageChange < 0 ? 'decreasing' : 'stable',
                volatility: this.calculateVolatility(costChanges.map(c => c.newCost))
            } : null
        };
    }

    /**
     * Calculate volatility (standard deviation) of costs
     */
    static calculateVolatility(costs) {
        if (costs.length < 2) return 0;

        const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
        const variance = costs.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) / costs.length;
        return Math.sqrt(variance);
    }
}

module.exports = CostingCalculator; 