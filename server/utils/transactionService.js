const Transaction = require('../models/transaction');
const Product = require('../models/product');
const Store = require('../models/store');
const FinancialYear = require('../models/financialYear');
const User = require('../models/user');
const Account = require('../models/account');
const ProductCategory = require('../models/productCategory');
const Packaging = require('../models/packaging');
const ProductBrandName = require('../models/productBrandName');
const ProductManufacturer = require('../models/productManufacturer');
const ProductModel = require('../models/productModel');
const PriceCategory = require('../models/priceCategory');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');

class TransactionService {
    /**
     * Record a new transaction
     * @param {Object} transactionData - Transaction data
     * @returns {Promise<Object>} Created transaction
     */
    static async recordTransaction(transactionData) {
        try {
            // Validate required fields
            const requiredFields = [
                'financial_year_id',
                'transaction_date',
                'reference_number',
                'store_id',
                'product_id',
                'transaction_type',
                'transaction_type_name',
                'created_by_code',
                'transaction_amount',
                'equivalent_amount'
            ];

            for (const field of requiredFields) {
                if (!transactionData[field]) {
                    throw new Error(`Missing required field: ${field}`);
                }
            }

            // Get related data for validation and population
            const [
                financialYear,
                store,
                product,
                user
            ] = await Promise.all([
                FinancialYear.findByPk(transactionData.financial_year_id),
                Store.findByPk(transactionData.store_id),
                Product.findByPk(transactionData.product_id, {
                    include: [
                        { model: ProductCategory, as: 'category' },
                        { model: Packaging, as: 'packaging' },
                        { model: ProductBrandName, as: 'brandName' },
                        { model: ProductManufacturer, as: 'manufacturer' },
                        { model: ProductModel, as: 'productModel' },
                        { model: PriceCategory, as: 'priceCategory' }
                    ]
                }),
                User.findByPk(transactionData.created_by_code)
            ]);

            if (!financialYear) {
                throw new Error('Financial year not found');
            }
            if (!store) {
                throw new Error('Store not found');
            }
            if (!product) {
                throw new Error('Product not found');
            }
            if (!user) {
                throw new Error('User not found');
            }

            // Validate quantities based on transaction type
            if (transactionData.transaction_type === 'SALE' && transactionData.quantity_out <= 0) {
                throw new Error('Sale transactions must have quantity_out > 0');
            }
            if (transactionData.transaction_type === 'PURCHASE' && transactionData.quantity_in <= 0) {
                throw new Error('Purchase transactions must have quantity_in > 0');
            }

            // Create transaction
            const transaction = await Transaction.create({
                financial_year_id: transactionData.financial_year_id,
                financial_year_name: financialYear.name,
                system_date: new Date(),
                transaction_date: transactionData.transaction_date,
                reference_number: transactionData.reference_number,
                store_id: transactionData.store_id,
                store_code: store.code || store.name,
                product_id: transactionData.product_id,
                category_id: product.category_id,
                packaging_id: product.packaging_id,
                brand_name_id: product.brand_id,
                manufacturer_name_id: product.manufacturer_id,
                product_model_id: product.product_model_id,
                price_category_id: transactionData.price_category_id,
                transaction_type: transactionData.transaction_type,
                transaction_type_name: transactionData.transaction_type_name,
                created_by_code: transactionData.created_by_code,
                created_by_name: `${user.first_name} ${user.last_name}`,
                description: transactionData.description || '',
                supplier_id: transactionData.supplier_id,
                supplier_name: transactionData.supplier_name,
                packaging_code: product.packaging?.code,
                packaging_pieces: product.packaging?.pieces,
                customer_id: transactionData.customer_id,
                default_currency: transactionData.default_currency || 'TZS',
                exchange_rate: transactionData.exchange_rate || 1.000000,
                transaction_amount: transactionData.transaction_amount,
                equivalent_amount: transactionData.equivalent_amount,
                user_id: transactionData.created_by_code,
                username: user.username,
                account_id: transactionData.account_id,
                quantity_in: transactionData.quantity_in || 0,
                quantity_out: transactionData.quantity_out || 0,
                expiry_date: transactionData.expiry_date
            });

            return transaction;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get transactions with filtering and pagination
     * @param {Object} filters - Filter criteria
     * @param {Object} pagination - Pagination options
     * @returns {Promise<Object>} Paginated results
     */
    static async getTransactions(filters = {}, pagination = {}) {
        try {
            const {
                financial_year_id,
                store_id,
                product_id,
                transaction_type,
                start_date,
                end_date,
                reference_number,
                created_by_code,
                supplier_id,
                customer_id
            } = filters;

            const {
                page = 1,
                limit = 25,
                sortBy = 'transaction_date',
                sortOrder = 'DESC'
            } = pagination;

            const offset = (page - 1) * limit;

            // Build where clause
            const whereClause = {};

            if (financial_year_id) {
                whereClause.financial_year_id = financial_year_id;
            }

            if (store_id) {
                whereClause.store_id = store_id;
            }

            if (product_id) {
                whereClause.product_id = product_id;
            }

            if (transaction_type) {
                whereClause.transaction_type = transaction_type;
            }

            if (start_date && end_date) {
                whereClause.transaction_date = {
                    [Op.between]: [start_date, end_date]
                };
            } else if (start_date) {
                whereClause.transaction_date = {
                    [Op.gte]: start_date
                };
            } else if (end_date) {
                whereClause.transaction_date = {
                    [Op.lte]: end_date
                };
            }

            if (reference_number) {
                whereClause.reference_number = {
                    [Op.iLike]: `%${reference_number}%`
                };
            }

            if (created_by_code) {
                whereClause.created_by_code = created_by_code;
            }

            if (supplier_id) {
                whereClause.supplier_id = supplier_id;
            }

            if (customer_id) {
                whereClause.customer_id = customer_id;
            }

            // Build order clause
            let orderClause;
            if (sortBy === 'created_by_name') {
                orderClause = [[{ model: User, as: 'createdByUser' }, 'first_name', sortOrder]];
            } else if (sortBy === 'store_name') {
                orderClause = [[{ model: Store, as: 'store' }, 'name', sortOrder]];
            } else if (sortBy === 'product_name') {
                orderClause = [[{ model: Product, as: 'product' }, 'name', sortOrder]];
            } else {
                orderClause = [[sortBy, sortOrder]];
            }

            const { count, rows } = await Transaction.findAndCountAll({
                where: whereClause,
                include: [
                    {
                        model: FinancialYear,
                        as: 'financialYear',
                        attributes: ['id', 'name', 'code']
                    },
                    {
                        model: Store,
                        as: 'store',
                        attributes: ['id', 'name', 'code', 'location']
                    },
                    {
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'code', 'barcode']
                    },
                    {
                        model: ProductCategory,
                        as: 'category',
                        attributes: ['id', 'name', 'code']
                    },
                    {
                        model: Packaging,
                        as: 'packaging',
                        attributes: ['id', 'name', 'code', 'pieces']
                    },
                    {
                        model: ProductBrandName,
                        as: 'brandName',
                        attributes: ['id', 'name']
                    },
                    {
                        model: ProductManufacturer,
                        as: 'manufacturer',
                        attributes: ['id', 'name']
                    },
                    {
                        model: ProductModel,
                        as: 'productModel',
                        attributes: ['id', 'name']
                    },
                    {
                        model: PriceCategory,
                        as: 'priceCategory',
                        attributes: ['id', 'name', 'code']
                    },
                    {
                        model: User,
                        as: 'createdByUser',
                        attributes: ['id', 'first_name', 'last_name', 'username']
                    },
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'name', 'code']
                    }
                ],
                order: orderClause,
                limit: limit,
                offset: offset
            });

            return {
                data: rows,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(count / limit),
                    totalItems: count,
                    itemsPerPage: limit
                }
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get transaction summary statistics
     * @param {Object} filters - Filter criteria
     * @returns {Promise<Object>} Summary statistics
     */
    static async getTransactionSummary(filters = {}) {
        try {
            const {
                financial_year_id,
                store_id,
                start_date,
                end_date,
                transaction_type
            } = filters;

            const whereClause = {};

            if (financial_year_id) {
                whereClause.financial_year_id = financial_year_id;
            }

            if (store_id) {
                whereClause.store_id = store_id;
            }

            if (start_date && end_date) {
                whereClause.transaction_date = {
                    [Op.between]: [start_date, end_date]
                };
            }

            if (transaction_type) {
                whereClause.transaction_type = transaction_type;
            }

            const summary = await Transaction.findOne({
                where: whereClause,
                attributes: [
                    [sequelize.fn('COUNT', sequelize.col('id')), 'total_transactions'],
                    [sequelize.fn('SUM', sequelize.col('transaction_amount')), 'total_amount'],
                    [sequelize.fn('SUM', sequelize.col('equivalent_amount')), 'total_equivalent_amount'],
                    [sequelize.fn('SUM', sequelize.col('quantity_in')), 'total_quantity_in'],
                    [sequelize.fn('SUM', sequelize.col('quantity_out')), 'total_quantity_out']
                ]
            });

            return {
                total_transactions: parseInt(summary?.dataValues?.total_transactions || 0),
                total_amount: parseFloat(summary?.dataValues?.total_amount || 0),
                total_equivalent_amount: parseFloat(summary?.dataValues?.total_equivalent_amount || 0),
                total_quantity_in: parseFloat(summary?.dataValues?.total_quantity_in || 0),
                total_quantity_out: parseFloat(summary?.dataValues?.total_quantity_out || 0)
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get product movement report
     * @param {string} productId - Product ID
     * @param {string} storeId - Store ID (optional)
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Object>} Product movement data
     */
    static async getProductMovement(productId, storeId = null, startDate = null, endDate = null) {
        try {
            const whereClause = {
                product_id: productId
            };

            if (storeId) {
                whereClause.store_id = storeId;
            }

            if (startDate && endDate) {
                whereClause.transaction_date = {
                    [Op.between]: [startDate, endDate]
                };
            }

            const movements = await Transaction.findAll({
                where: whereClause,
                include: [
                    {
                        model: Store,
                        as: 'store',
                        attributes: ['id', 'name', 'code']
                    },
                    {
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'code']
                    }
                ],
                order: [['transaction_date', 'ASC']]
            });

            let openingBalance = 0;
            let closingBalance = 0;
            let totalIn = 0;
            let totalOut = 0;

            movements.forEach(movement => {
                totalIn += parseFloat(movement.quantity_in || 0);
                totalOut += parseFloat(movement.quantity_out || 0);
            });

            closingBalance = openingBalance + totalIn - totalOut;

            return {
                product_id: productId,
                movements: movements,
                summary: {
                    opening_balance: openingBalance,
                    total_in: totalIn,
                    total_out: totalOut,
                    closing_balance: closingBalance
                }
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Generate a unique reference number
     * @param {string} transactionType - Transaction type
     * @returns {string} Unique reference number
     */
    static generateReferenceNumber(transactionType = 'TXN') {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        return `${transactionType}-${timestamp}-${random}`;
    }

    /**
     * Validate transaction data
     * @param {Object} transactionData - Transaction data to validate
     * @returns {Promise<boolean>} Validation result
     */
    static async validateTransaction(transactionData) {
        try {
            // Check if financial year exists
            const financialYear = await FinancialYear.findByPk(transactionData.financial_year_id);
            if (!financialYear) {
                throw new Error('Financial year not found');
            }

            // Check if store exists
            const store = await Store.findByPk(transactionData.store_id);
            if (!store) {
                throw new Error('Store not found');
            }

            // Check if product exists
            const product = await Product.findByPk(transactionData.product_id);
            if (!product) {
                throw new Error('Product not found');
            }

            // Check if user exists
            const user = await User.findByPk(transactionData.created_by_code);
            if (!user) {
                throw new Error('User not found');
            }

            // Validate amounts
            if (!transactionData.transaction_amount || transactionData.transaction_amount <= 0) {
                throw new Error('Transaction amount must be greater than zero');
            }

            if (!transactionData.equivalent_amount || transactionData.equivalent_amount <= 0) {
                throw new Error('Equivalent amount must be greater than zero');
            }

            // Validate quantities based on transaction type
            if (transactionData.transaction_type === 'SALE') {
                if (!transactionData.quantity_out || transactionData.quantity_out <= 0) {
                    throw new Error('Sale transactions must have quantity_out > 0');
                }
            } else if (transactionData.transaction_type === 'PURCHASE') {
                if (!transactionData.quantity_in || transactionData.quantity_in <= 0) {
                    throw new Error('Purchase transactions must have quantity_in > 0');
                }
            }

            return true;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = TransactionService; 