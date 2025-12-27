const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ProductTransaction = require('../models/productTransaction');
const Product = require('../models/product');
const Currency = require('../models/currency');
const Store = require('../models/store');
const TransactionType = require('../models/transactionType');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all product transactions with pagination and filtering
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            productId,
            storeId,
            transactionTypeId,
            startDate,
            endDate,
            referenceNumber,
            sortBy = 'transaction_date',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const whereClause = {};

        // Add filters
        if (productId) {
            whereClause.product_id = productId;
        }
        if (storeId) {
            whereClause.store_id = storeId;
        }
        if (transactionTypeId) {
            whereClause.transaction_type_id = transactionTypeId;
        }
        if (referenceNumber) {
            whereClause.reference_number = { [Op.iLike]: `%${referenceNumber}%` };
        }
        if (startDate && endDate) {
            whereClause.transaction_date = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        const { count, rows: transactions } = await ProductTransaction.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'code', 'description']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Currency,
                    as: 'originalCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name', 'location']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                }
            ],
            order: [[sortBy, sortOrder]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const totalPages = Math.ceil(count / limit);

        res.json({
            transactions,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems: count,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product transactions' });
    }
});

// Get product transactions for a specific product
router.get('/product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const {
            page = 1,
            limit = 50,
            startDate,
            endDate,
            sortBy = 'transaction_date',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const whereClause = { product_id: productId };

        if (startDate && endDate) {
            whereClause.transaction_date = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        const { count, rows: transactions } = await ProductTransaction.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'code', 'description']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Currency,
                    as: 'originalCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name', 'location']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                }
            ],
            order: [[sortBy, sortOrder]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const totalPages = Math.ceil(count / limit);

        res.json({
            transactions,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems: count,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product transactions' });
    }
});

// Get a specific product transaction by ID
router.get('/:id', async (req, res) => {
    try {
        const transaction = await ProductTransaction.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'code', 'description']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Currency,
                    as: 'originalCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name', 'location']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                }
            ]
        });

        if (!transaction) {
            return res.status(404).json({ error: 'Product transaction not found' });
        }

        res.json(transaction);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product transaction' });
    }
});

module.exports = router; 