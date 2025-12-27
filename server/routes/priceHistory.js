const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const PriceHistoryService = require('../utils/priceHistoryService');
const CostingCalculator = require('../utils/costingCalculator');
const CostingMethod = require('../models/costingMethod');
const PriceChangeReason = require('../models/priceChangeReason');
const PriceHistory = require('../models/priceHistory');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all costing methods (GLOBAL - no company filter)
router.get('/costing-methods', async (req, res) => {
    try {
        const costingMethods = await CostingMethod.findAll({
            where: { is_active: true }, // Global - no company filtering
            order: [['name', 'ASC']]
        });

        res.json({
            success: true,
            data: costingMethods
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch costing methods',
            error: error.message
        });
    }
});

// Get all price change reasons
router.get('/price-change-reasons', async (req, res) => {
    try {
        const { category } = req.query;
        const whereClause = { is_active: true };
        
        if (category) {
            whereClause.category = category;
        }

        const priceChangeReasons = await PriceChangeReason.findAll({
            where: buildCompanyWhere(req, whereClause),
            order: [['name', 'ASC']]
        });

        res.json({
            success: true,
            data: priceChangeReasons
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch price change reasons',
            error: error.message
        });
    }
});

// Get price history for an entity
router.get('/entity/:entityType/:entityId', async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { 
            limit = 50, 
            offset = 0, 
            startDate, 
            endDate, 
            moduleName,
            includeAssociations = true 
        } = req.query;

        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset),
            includeAssociations: includeAssociations === 'true'
        };

        if (startDate) {
            options.startDate = new Date(startDate);
        }

        if (endDate) {
            options.endDate = new Date(endDate);
        }

        if (moduleName) {
            options.moduleName = moduleName;
        }

        const result = await PriceHistoryService.getEntityPriceHistory(
            entityType, 
            entityId, 
            options
        );

        res.json({
            success: true,
            data: result.rows,
            total: result.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch price history',
            error: error.message
        });
    }
});

// Get price history summary for costing analysis
router.get('/summary/:entityType/:entityId', async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Start date and end date are required'
            });
        }

        const summary = await PriceHistoryService.getPriceHistorySummary(
            entityType,
            entityId,
            new Date(startDate),
            new Date(endDate)
        );

        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch price history summary',
            error: error.message
        });
    }
});

// Calculate cost using dynamic costing methods
router.get('/calculate-cost/:entityType/:entityId', async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { method = 'AVG', asOfDate, referenceNumber, date, reason } = req.query;

        const options = {};
        if (referenceNumber) options.referenceNumber = referenceNumber;
        if (date) options.date = date;
        if (reason) options.reason = reason;

        const result = await CostingCalculator.calculateCost(
            entityType,
            entityId,
            method,
            asOfDate ? new Date(asOfDate) : new Date(),
            options
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to calculate cost',
            error: error.message
        });
    }
});

// Compare all costing methods for an entity
router.get('/compare-costing/:entityType/:entityId', async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { asOfDate } = req.query;

        const result = await CostingCalculator.compareCostingMethods(
            entityType,
            entityId,
            asOfDate ? new Date(asOfDate) : new Date()
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to compare costing methods',
            error: error.message
        });
    }
});

// Get cost trend analysis
router.get('/cost-trend/:entityType/:entityId', async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Start date and end date are required'
            });
        }

        const result = await CostingCalculator.getCostTrend(
            entityType,
            entityId,
            new Date(startDate),
            new Date(endDate)
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get cost trend',
            error: error.message
        });
    }
});

// Get price history by module
router.get('/by-module/:moduleName', async (req, res) => {
    try {
        const { moduleName } = req.params;
        const { 
            limit = 50, 
            offset = 0, 
            startDate, 
            endDate,
            entityType 
        } = req.query;

        const whereClause = {
            module_name: moduleName
        };

        if (startDate) {
            whereClause.change_date = {
                [require('sequelize').Op.gte]: new Date(startDate)
            };
        }

        if (endDate) {
            whereClause.change_date = {
                ...whereClause.change_date,
                [require('sequelize').Op.lte]: new Date(endDate)
            };
        }

        if (entityType) {
            whereClause.entity_type = entityType;
        }

        const priceHistory = await PriceHistory.findAndCountAll({
            where: whereClause,
            order: [['change_date', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset),
            include: [
                {
                    model: require('../models/costingMethod'),
                    as: 'costingMethod',
                    attributes: ['id', 'code', 'name']
                },
                {
                    model: require('../models/priceChangeReason'),
                    as: 'priceChangeReason',
                    attributes: ['id', 'code', 'name', 'category']
                },
                {
                    model: require('../models/transactionType'),
                    as: 'transactionType',
                    attributes: ['id', 'name', 'code']
                },
                {
                    model: require('../models/currency'),
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                }
            ]
        });

        res.json({
            success: true,
            data: priceHistory.rows,
            total: priceHistory.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch price history by module',
            error: error.message
        });
    }
});

// Get price history statistics
router.get('/statistics', async (req, res) => {
    try {
        const { startDate, endDate, entityType, moduleName } = req.query;

        const whereClause = {};

        if (startDate) {
            whereClause.change_date = {
                [require('sequelize').Op.gte]: new Date(startDate)
            };
        }

        if (endDate) {
            whereClause.change_date = {
                ...whereClause.change_date,
                [require('sequelize').Op.lte]: new Date(endDate)
            };
        }

        if (entityType) {
            whereClause.entity_type = entityType;
        }

        if (moduleName) {
            whereClause.module_name = moduleName;
        }

        // Get total count
        const totalCount = await PriceHistory.count({ 
            where: buildCompanyWhere(req, whereClause)
        });

        // Get count by entity type
        const entityTypeStats = await PriceHistory.findAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: [
                'entity_type',
                [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
            ],
            group: ['entity_type'],
            raw: true
        });

        // Get count by module
        const moduleStats = await PriceHistory.findAll({
            where: whereClause,
            attributes: [
                'module_name',
                [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
            ],
            group: ['module_name'],
            raw: true
        });

        // Get count by reason
        const reasonStats = await PriceHistory.findAll({
            where: whereClause,
            attributes: [
                'price_change_reason_id',
                [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
            ],
            group: ['price_change_reason_id'],
            include: [
                {
                    model: require('../models/priceChangeReason'),
                    as: 'priceChangeReason',
                    attributes: ['name']
                }
            ],
            raw: true
        });

        res.json({
            success: true,
            data: {
                totalCount,
                entityTypeStats,
                moduleStats,
                reasonStats
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch price history statistics',
            error: error.message
        });
    }
});

// Manual price change tracking (for testing or manual entries)
router.post('/track', csrfProtection, csrfProtection, async (req, res) => {
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
            costingMethodCode,
            priceChangeReasonCode,
            transactionTypeId,
            quantity,
            unit,
            currencyId,
            exchangeRate,
            referenceNumber,
            notes,
            transactionDate
        } = req.body;

        const priceHistory = await PriceHistoryService.trackPriceChange({
            entityType,
            entityId,
            entityCode,
            entityName,
            moduleName,
            oldAverageCost,
            newAverageCost,
            oldSellingPrice,
            newSellingPrice,
            costingMethodCode,
            priceChangeReasonCode,
            transactionTypeId,
            quantity,
            unit,
            currencyId,
            exchangeRate,
            referenceNumber,
            notes,
            transactionDate,
            userId: req.user.id
        });

        if (priceHistory) {
            res.json({
                success: true,
                message: 'Price change tracked successfully',
                data: priceHistory
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'No price change detected'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to track price change',
            error: error.message
        });
    }
});

module.exports = router; 