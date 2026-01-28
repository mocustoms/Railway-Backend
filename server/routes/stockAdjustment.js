const express = require('express');
const { Op } = require('sequelize');
const { StockAdjustment, StockAdjustmentItem, Store, AdjustmentReason, Account, AccountType, Currency, Product, User, ProductStore, ProductSerialNumber, ProductExpiryDate, GeneralLedger, PriceHistory, FinancialYear, TransactionType } = require('../models');
const PriceHistoryService = require('../utils/priceHistoryService');
const sequelize = require('../../config/database');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ExportService = require('../utils/exportService');
// Simple reference number generation
const generateReferenceNumber = (prefix) => {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${timestamp}-${random}`;
};
const router = express.Router();

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all stock adjustments with pagination and filtering
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = '',
            store_id = '',
            adjustment_reason_id = '',
            start_date = '',
            end_date = '',
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const whereClause = {};

        // Add search conditions
        if (search) {
            whereClause[Op.or] = [
                { reference_number: { [Op.iLike]: `%${search}%` } },
                { document_number: { [Op.iLike]: `%${search}%` } },
                { notes: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Add status filter
        if (status) {
            whereClause.status = status;
        }

        // Add store filter
        if (store_id) {
            whereClause.store_id = store_id;
        }

        // Add adjustment reason filter
        if (adjustment_reason_id) {
            whereClause.adjustment_reason_id = adjustment_reason_id;
        }

        // Add date range filter
        if (start_date && end_date) {
            whereClause.adjustment_date = {
                [Op.between]: [start_date, end_date]
            };
        } else if (start_date) {
            whereClause.adjustment_date = {
                [Op.gte]: start_date
            };
        } else if (end_date) {
            whereClause.adjustment_date = {
                [Op.lte]: end_date
            };
        }

        // Map frontend field names to database field names for ordering
        let order;
        if (sortBy === 'store_name') {
            order = [[{ model: Store, as: 'store' }, 'name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'created_by_name') {
            order = [[{ model: User, as: 'creator' }, 'first_name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'updated_by_name') {
            order = [[{ model: User, as: 'updater' }, 'first_name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'submitted_by_name') {
            order = [[{ model: User, as: 'submitter' }, 'first_name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'approved_by_name') {
            order = [[{ model: User, as: 'approver' }, 'first_name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'adjustment_reason_name') {
            order = [[{ model: AdjustmentReason, as: 'adjustmentReason' }, 'name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'inventory_account_name') {
            order = [[{ model: Account, as: 'inventoryAccount' }, 'name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'adjustment_date') {
            order = [['adjustment_date', sortOrder.toUpperCase()]];
        } else if (sortBy === 'created_at') {
            order = [['created_at', sortOrder.toUpperCase()]];
        } else if (sortBy === 'updated_at') {
            order = [['updated_at', sortOrder.toUpperCase()]];
        } else if (sortBy === 'submitted_at') {
            order = [['submitted_at', sortOrder.toUpperCase()]];
        } else if (sortBy === 'approved_at') {
            order = [['approved_at', sortOrder.toUpperCase()]];
        } else {
            order = [[sortBy, sortOrder.toUpperCase()]];
        }

        const { count, rows } = await StockAdjustment.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name']
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason',
                    attributes: ['id', 'name', 'code', 'adjustment_type']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'submitter',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'approver',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ],
            order: order,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Transform the data to match frontend expectations
        const transformedStockAdjustments = rows.map(adjustment => ({
            ...adjustment.toJSON(),
            store_name: adjustment.store?.name || 'Unknown Store',
            adjustment_reason_name: adjustment.adjustmentReason?.name || 'Unknown Reason',
            inventory_account_name: adjustment.inventoryAccount?.name || 'Unknown Account',
            inventory_corresponding_account_name: adjustment.correspondingAccount?.name || 'Unknown Account',
            currency_name: adjustment.currency?.name || 'Unknown Currency',
            currency_symbol: adjustment.currency?.symbol || '$',
            created_by_name: adjustment.creator ? `${adjustment.creator.first_name} ${adjustment.creator.last_name}` : 'System',
            updated_by_name: adjustment.updater ? `${adjustment.updater.first_name} ${adjustment.updater.last_name}` : null,
            submitted_by_name: adjustment.submitter ? `${adjustment.submitter.first_name} ${adjustment.submitter.last_name}` : null,
            approved_by_name: adjustment.approver ? `${adjustment.approver.first_name} ${adjustment.approver.last_name}` : null
        }));

        res.json({
            stockAdjustments: transformedStockAdjustments,
            pagination: {
                totalItems: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
                pageSize: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stock adjustments' });
    }
});

// Get stock adjustment by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const stockAdjustment = await StockAdjustment.findByPk(id, {
            include: [
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name']
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason',
                    attributes: ['id', 'name', 'code', 'adjustment_type']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: StockAdjustmentItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: ['id', 'name', 'code', 'average_cost']
                        }
                    ]
                }
            ]
        });

        if (!stockAdjustment) {
            return res.status(404).json({ error: 'Stock adjustment not found' });
        }

        // Transform the data to match frontend expectations
        const transformedStockAdjustment = {
            ...stockAdjustment.toJSON(),
            store_name: stockAdjustment.store?.name || 'Unknown Store',
            adjustment_reason_name: stockAdjustment.adjustmentReason?.name || 'Unknown Reason',
            inventory_account_name: stockAdjustment.inventoryAccount?.name || 'Unknown Account',
            inventory_corresponding_account_name: stockAdjustment.correspondingAccount?.name || 'Unknown Account',
            currency_name: stockAdjustment.currency?.name || 'Unknown Currency',
            currency_symbol: stockAdjustment.currency?.symbol || '$',
            created_by_name: stockAdjustment.creator ? `${stockAdjustment.creator.first_name} ${stockAdjustment.creator.last_name}` : 'System',
            updated_by_name: stockAdjustment.updater ? `${stockAdjustment.updater.first_name} ${stockAdjustment.updater.last_name}` : null,
            submitted_by_name: stockAdjustment.submitter ? `${stockAdjustment.submitter.first_name} ${stockAdjustment.submitter.last_name}` : null,
            approved_by_name: stockAdjustment.approver ? `${stockAdjustment.approver.first_name} ${stockAdjustment.approver.last_name}` : null
        };

        res.json(transformedStockAdjustment);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stock adjustment' });
    }
});

// Create new stock adjustment (draft)
router.post('/', csrfProtection, async (req, res) => {
    const transaction = await StockAdjustment.sequelize.transaction();
    
    try {
        const {
            adjustment_date,
            store_id,
            reason_id,
            adjustment_type,
            inventory_account_id,
            inventory_corresponding_account_id,
            currency_id,
            exchange_rate,
            system_default_currency_id,
            exchange_rate_id,
            document_type,
            document_number,
            notes,
            items = []
        } = req.body;

        // Generate reference number
        const reference_number = generateReferenceNumber('SA');

        // Calculate totals
        const totalValue = items.reduce((sum, item) => sum + (item.adjusted_stock * item.user_unit_cost), 0);
        const exchangeRate = exchange_rate || 1.000000;
        const equivalentAmount = totalValue * exchangeRate;

        // Create stock adjustment
        const stockAdjustment = await StockAdjustment.create({
            reference_number,
            adjustment_date,
            companyId: req.user.companyId,
            store_id,
            reason_id,
            adjustment_type,
            account_id: inventory_account_id,
            corresponding_account_id: inventory_corresponding_account_id,
            currency_id,
            exchange_rate: exchangeRate,
            system_default_currency_id,
            exchange_rate_id: exchange_rate_id || null,
            document_type,
            document_number,
            notes,
            status: 'draft',
            total_items: items.length,
            total_value: totalValue,
            equivalent_amount: equivalentAmount,
            created_by: req.user.id
        }, { transaction });

        // Create stock adjustment items
        if (items && items.length > 0) {
            const adjustmentItems = items.map(item => {
                const currentStock = parseFloat(item.current_stock || 0);
                const adjustedStock = parseFloat(item.adjusted_stock || 0);
                
                // Calculate new stock based on adjustment type
                let newStock = 0;
                if (adjustment_type === 'add') {
                    // For stock in: new_stock = current_stock + adjusted_stock
                    newStock = currentStock + adjustedStock;
                } else if (adjustment_type === 'deduct') {
                    // For stock out: new_stock = current_stock - adjusted_stock
                    newStock = currentStock - adjustedStock;
                }
                
                return {
                    stock_adjustment_id: stockAdjustment.id,
                    product_id: item.product_id,
                    current_stock: currentStock,
                    adjusted_stock: adjustedStock,
                    new_stock: newStock,
                    user_unit_cost: item.user_unit_cost || 0,
                    serial_numbers: item.serial_numbers || [],
                    expiry_date: item.expiry_date || null,
                    batch_number: item.batch_number || null,
                    notes: item.notes,
                    companyId: req.user.companyId // Add companyId for multi-tenant isolation
                };
            });

            await StockAdjustmentItem.bulkCreate(adjustmentItems, { transaction });
        }

        await transaction.commit();

        // Fetch the created stock adjustment with all associations
        const createdStockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id: stockAdjustment.id }),
            include: [
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name']
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason',
                    attributes: ['id', 'name', 'code', 'adjustment_type']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: StockAdjustmentItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: ['id', 'name', 'code', 'average_cost']
                        }
                    ]
                }
            ]
        });

        res.status(201).json(createdStockAdjustment);
    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        res.status(500).json({ error: 'Failed to create stock adjustment' });
    }
});

// Update stock adjustment
router.put('/:id', csrfProtection, async (req, res) => {
    const transaction = await StockAdjustment.sequelize.transaction();
    
    try {
        const { id } = req.params;
        const {
            adjustment_date,
            store_id,
            reason_id,
            adjustment_type,
            inventory_account_id,
            inventory_corresponding_account_id,
            currency_id,
            exchange_rate,
            system_default_currency_id,
            exchange_rate_id,
            document_type,
            document_number,
            notes,
            status,
            items = []
        } = req.body;

        const stockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!stockAdjustment) {
            return res.status(404).json({ error: 'Stock adjustment not found' });
        }

        // Check if adjustment can be edited (only drafts can be edited)
        if (stockAdjustment.status !== 'draft') {
            return res.status(400).json({ error: 'Only draft adjustments can be edited' });
        }

        // Prepare update data
        const updateData = {
            adjustment_date,
            store_id,
            reason_id,
            adjustment_type,
            account_id: inventory_account_id,
            corresponding_account_id: inventory_corresponding_account_id,
            currency_id,
            exchange_rate: exchange_rate || 1.000000,
            system_default_currency_id,
            exchange_rate_id: exchange_rate_id || null,
            document_type,
            document_number,
            notes,
            updated_by: req.user.id
        };

        // If status is being changed to 'submitted', add submission details
        if (status === 'submitted') {
            updateData.status = 'submitted';
            updateData.submitted_at = new Date();
            updateData.submitted_by = req.user.id;
        }

        // Update stock adjustment
        await stockAdjustment.update(updateData, { transaction });

        // Delete existing items
        await StockAdjustmentItem.destroy({
            where: { stock_adjustment_id: id },
            transaction
        });

        // Create new items
        if (items && items.length > 0) {
            const adjustmentItems = items.map(item => {
                const currentStock = parseFloat(item.current_stock || 0);
                const adjustedStock = parseFloat(item.adjusted_stock || 0);
                
                // Calculate new stock based on adjustment type
                let newStock = 0;
                if (adjustment_type === 'add') {
                    // For stock in: new_stock = current_stock + adjusted_stock
                    newStock = currentStock + adjustedStock;
                } else if (adjustment_type === 'deduct') {
                    // For stock out: new_stock = current_stock - adjusted_stock
                    newStock = currentStock - adjustedStock;
                }
                
                return {
                    stock_adjustment_id: id,
                    product_id: item.product_id,
                    current_stock: currentStock,
                    adjusted_stock: adjustedStock,
                    new_stock: newStock,
                    user_unit_cost: item.user_unit_cost || 0,
                    serial_numbers: item.serial_numbers || [],
                    expiry_date: item.expiry_date || null,
                    batch_number: item.batch_number || null,
                    notes: item.notes,
                    companyId: req.user.companyId // Add companyId for multi-tenant isolation
                };
            });

            await StockAdjustmentItem.bulkCreate(adjustmentItems, { transaction });

            // Calculate totals
            const totalValue = adjustmentItems.reduce((sum, item) => sum + (item.adjusted_stock * item.user_unit_cost), 0);
            const exchangeRate = exchange_rate || 1.000000;
            const equivalentAmount = totalValue * exchangeRate;

            await stockAdjustment.update({
                total_items: adjustmentItems.length,
                total_value: totalValue,
                equivalent_amount: equivalentAmount
            }, { transaction });
        } else {
            await stockAdjustment.update({
                total_items: 0,
                total_value: 0,
                equivalent_amount: 0
            }, { transaction });
        }

        await transaction.commit();

        // Fetch the updated stock adjustment with all associations
        const updatedStockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id }),
            include: [
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name']
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason',
                    attributes: ['id', 'name', 'code', 'adjustment_type']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: StockAdjustmentItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: ['id', 'name', 'code', 'average_cost']
                        }
                    ]
                }
            ]
        });

        res.json(updatedStockAdjustment);
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Failed to update stock adjustment' });
    }
});

// Submit stock adjustment (change status from draft to submitted)
router.patch('/:id/submit', async (req, res) => {
    try {
        const { id } = req.params;

        const stockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!stockAdjustment) {
            return res.status(404).json({ error: 'Stock adjustment not found' });
        }

        if (stockAdjustment.status !== 'draft') {
            return res.status(400).json({ error: 'Only draft adjustments can be submitted' });
        }

        // Check if adjustment has items
        const itemCount = await StockAdjustmentItem.count({
            where: { stock_adjustment_id: id }
        });

        if (itemCount === 0) {
            return res.status(400).json({ error: 'Cannot submit adjustment without items' });
        }

        await stockAdjustment.update({
            status: 'submitted',
            submitted_at: new Date(),
            submitted_by: req.user.id,
            updated_by: req.user.id
        });

        res.json({ message: 'Stock adjustment submitted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to submit stock adjustment' });
    }
});

// Approve stock adjustment (change status from submitted to approved)
router.patch('/:id/approve', async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const { id } = req.params;

        // Fetch the stock adjustment with all related data (with company filter)
        const stockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id }),
            include: [
                {
                    model: StockAdjustmentItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product'
                        }
                    ]
                },
                {
                    model: Store,
                    as: 'store'
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    include: [
                        {
                            model: AccountType,
                            as: 'accountType'
                        }
                    ]
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    include: [
                        {
                            model: AccountType,
                            as: 'accountType'
                        }
                    ]
                },
                {
                    model: Currency,
                    as: 'currency'
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason'
                }
            ],
            transaction
        });

        if (!stockAdjustment) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Stock adjustment not found' });
        }

        if (stockAdjustment.status !== 'submitted') {
            await transaction.rollback();
            return res.status(400).json({ error: 'Only submitted adjustments can be approved' });
        }

        // Get current financial year for ProductTransaction records (with company filter)
        // Use the same pattern as sales invoice approval - check isActive only
        const FinancialYear = require('../models/financialYear');
        const currentFinancialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { isActive: true }),
            transaction
        });
        
        if (!currentFinancialYear) {
            await transaction.rollback();
            return res.status(400).json({ error: 'No active financial year found' });
        }

        // Get system default currency (with company filter)
        const currencyWhere = {
            is_default: true
        };
        if (req.user.companyId) {
            currencyWhere.companyId = req.user.companyId;
        }
        
        const systemDefaultCurrency = await Currency.findOne({
            where: currencyWhere,
            transaction
        });
        
        if (!systemDefaultCurrency) {
            await transaction.rollback();
            return res.status(400).json({ error: 'No system default currency found' });
        }
        
        const defaultCurrencyCode = systemDefaultCurrency.code;

        // Update stock adjustment status
        await stockAdjustment.update({
            status: 'approved',
            approved_at: new Date(),
            approved_by: req.user.id,
            updated_by: req.user.id
        }, { transaction });

        // Process each item in the adjustment
        for (const item of stockAdjustment.items) {
            const product = item.product;
            const adjustmentQuantity = parseFloat(item.adjusted_stock);
            const unitCost = parseFloat(item.user_unit_cost);
            const isStockIn = stockAdjustment.adjustment_type === 'add';

            // 1. Update ProductStore quantities WITH ROW LOCK to prevent race conditions
            let productStore = await ProductStore.findOne({
                where: {
                    product_id: item.product_id,
                    store_id: stockAdjustment.store_id,
                    companyId: req.user.companyId // Add company filter for multi-tenant isolation
                },
                lock: transaction.LOCK.UPDATE, // Lock the row to prevent concurrent updates
                transaction
            });

            if (!productStore) {
                productStore = await ProductStore.create({
                    product_id: item.product_id,
                    store_id: stockAdjustment.store_id,
                    quantity: 0,
                    is_active: true,
                    assigned_by: req.user.id,
                    assigned_at: new Date(),
                    companyId: req.user.companyId // Add companyId for multi-tenant isolation
                }, { transaction });
            }

            // Capture old quantity before update (needed for average cost calculation)
            const oldQuantity = parseFloat(productStore.quantity || 0);
            
            // Use increment/decrement to avoid race conditions (atomic operations)
            if (isStockIn) {
                await productStore.increment('quantity', { by: adjustmentQuantity, transaction });
            } else {
                await productStore.decrement('quantity', { by: adjustmentQuantity, transaction });
            }
            await productStore.update({
                last_updated: new Date()
            }, { transaction });
            
            // Reload to get the updated quantity
            await productStore.reload({ transaction });
            const newQuantity = parseFloat(productStore.quantity || 0);

            // 2. Create ProductTransaction record for audit trail
            const ProductTransaction = require('../models/productTransaction');
            const Currency = require('../models/currency');
            
            // Get system default currency (with company filter)
            const currencyWhereTx = {
                is_default: true
            };
            if (req.user.companyId) {
                currencyWhereTx.companyId = req.user.companyId;
            }
            
            const systemDefaultCurrency = await Currency.findOne({ 
                where: currencyWhereTx,
                transaction 
            });
            
            await ProductTransaction.create({
                uuid: require('crypto').randomUUID(),
                system_date: new Date(),
                transaction_date: stockAdjustment.adjustment_date,
                financial_year_id: currentFinancialYear.id,
                financial_year_name: currentFinancialYear.name,
                transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type ID
                transaction_type_name: 'Stock Adjustment',
                store_id: stockAdjustment.store_id,
                product_id: item.product_id,
                product_type: product?.product_type || null,
                manufacturer_id: product?.manufacturer_id,
                model_id: product?.model_id,
                brand_name_id: product?.brand_id,
                packaging_id: product?.unit_id,
                packaging_issue_quantity: adjustmentQuantity,
                created_by_id: req.user.id,
                updated_by_id: req.user.id,
                product_average_cost: unitCost,
                user_unit_cost: unitCost,
                equivalent_amount: unitCost * (stockAdjustment.exchange_rate || 1),
                exchange_rate: stockAdjustment.exchange_rate || 1,
                currency_id: stockAdjustment.currency_id,
                system_currency_id: systemDefaultCurrency?.id,
                expiry_date: item.expiry_date,
                serial_number: item.serial_numbers ? item.serial_numbers.join(', ') : null,
                quantity_in: isStockIn ? adjustmentQuantity : 0,
                quantity_out: !isStockIn ? adjustmentQuantity : 0,
                reference_number: stockAdjustment.reference_number,
                reference_type: 'Stock Adjustment',
                notes: item.notes || `Stock adjustment: ${stockAdjustment.adjustment_type}`,
                conversion_notes: `Approved by ${req.user.name || req.user.username}`,
                is_active: true,
                companyId: req.user.companyId // Add companyId for multi-tenant isolation
            }, { 
                transaction,
                fields: [
                    'uuid', 'system_date', 'transaction_date', 'financial_year_id', 'financial_year_name',
                    'transaction_type_id', 'transaction_type_name', 'store_id', 'product_id', 'product_type',
                    'manufacturer_id', 'model_id', 'brand_name_id', 'packaging_id',
                    'packaging_issue_quantity', 'created_by_id', 'updated_by_id',
                    'product_average_cost', 'user_unit_cost', 'equivalent_amount',
                    'exchange_rate', 'currency_id', 'system_currency_id', 'expiry_date',
                    'serial_number', 'quantity_in', 'quantity_out', 'reference_number',
                    'reference_type', 'notes', 'conversion_notes', 'is_active', 'companyId'
                ],
                returning: false
            });

            // 3. Handle Product Serial Numbers (if product requires serial tracking)
            if (product?.track_serial_number && item.serial_numbers && item.serial_numbers.length > 0) {
                for (const serialNumber of item.serial_numbers) {
                    let serialRecord = await ProductSerialNumber.findOne({
                        where: {
                            product_id: item.product_id,
                            serial_number: serialNumber,
                            store_id: stockAdjustment.store_id,
                            companyId: req.user.companyId // Add company filter for multi-tenant isolation
                        },
                        transaction
                    });

                    if (isStockIn) {
                        // Stock In: Create or update serial number record
                        if (!serialRecord) {
                            await ProductSerialNumber.create({
                                product_id: item.product_id,
                                serial_number: serialNumber,
                                store_id: stockAdjustment.store_id,
                                current_quantity: 1,
                                total_quantity_received: 1,
                                total_quantity_adjusted: 1,
                                unit_cost: unitCost,
                                unit_cost_equivalent: unitCost * (stockAdjustment.exchange_rate || 1),
                                currency_id: systemDefaultCurrency.id,
                                system_currency_id: systemDefaultCurrency.id,
                                exchange_rate: stockAdjustment.exchange_rate || 1,
                                product_average_cost: unitCost,
                                user_unit_cost: unitCost,
                                equivalent_amount: unitCost * (stockAdjustment.exchange_rate || 1),
                                status: 'active',
                                notes: `Stock adjustment: ${stockAdjustment.reference_number}`,
                                created_by_id: req.user.id,
                                updated_by_id: req.user.id,
                                is_active: true,
                                companyId: req.user.companyId // Add companyId for multi-tenant isolation
                            }, { transaction });
                        } else {
                            await serialRecord.update({
                                current_quantity: serialRecord.current_quantity + 1,
                                total_quantity_received: serialRecord.total_quantity_received + 1,
                                total_quantity_adjusted: serialRecord.total_quantity_adjusted + 1,
                                status: 'active'
                            }, { transaction });
                        }
                    } else {
                        // Stock Out: Update serial number record
                        if (serialRecord) {
                            await serialRecord.update({
                                current_quantity: Math.max(0, serialRecord.current_quantity - 1),
                                total_quantity_sold: serialRecord.total_quantity_sold + 1,
                                total_quantity_adjusted: serialRecord.total_quantity_adjusted + 1,
                                status: serialRecord.current_quantity <= 1 ? 'sold' : 'active'
                            }, { transaction });
                        }
                    }
                }
            }

            // 4. Handle Product Expiry Dates (if expiry date or batch number provided)
            if (item.expiry_date || item.batch_number) {
                let expiryRecord = await ProductExpiryDate.findOne({
                    where: {
                        product_id: item.product_id,
                        store_id: stockAdjustment.store_id,
                        expiry_date: item.expiry_date,
                        batch_number: item.batch_number || null,
                        companyId: req.user.companyId // Add company filter for multi-tenant isolation
                    },
                    transaction
                });

                if (isStockIn) {
                    // Stock In: Create or update expiry record
                    if (!expiryRecord) {
                        const daysUntilExpiry = item.expiry_date ? 
                            Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                        
                        await ProductExpiryDate.create({
                            product_id: item.product_id,
                            batch_number: item.batch_number,
                            expiry_date: item.expiry_date,
                            store_id: stockAdjustment.store_id,
                            current_quantity: adjustmentQuantity,
                            total_quantity_received: adjustmentQuantity,
                            total_quantity_adjusted: adjustmentQuantity,
                            unit_cost: unitCost,
                            unit_cost_equivalent: unitCost * (stockAdjustment.exchange_rate || 1),
                            currency_id: systemDefaultCurrency.id,
                            system_currency_id: systemDefaultCurrency.id,
                            exchange_rate: stockAdjustment.exchange_rate || 1,
                            product_average_cost: unitCost,
                            user_unit_cost: unitCost,
                            equivalent_amount: unitCost * (stockAdjustment.exchange_rate || 1),
                            status: 'active',
                            days_until_expiry: daysUntilExpiry,
                            is_expired: daysUntilExpiry < 0,
                            notes: `Stock adjustment: ${stockAdjustment.reference_number}`,
                            created_by_id: req.user.id,
                            updated_by_id: req.user.id,
                            is_active: true,
                            companyId: req.user.companyId // Add companyId for multi-tenant isolation
                        }, { transaction });
                    } else {
                        await expiryRecord.update({
                            current_quantity: expiryRecord.current_quantity + adjustmentQuantity,
                            total_quantity_received: expiryRecord.total_quantity_received + adjustmentQuantity,
                            total_quantity_adjusted: expiryRecord.total_quantity_adjusted + adjustmentQuantity,
                            status: 'active'
                        }, { transaction });
                    }
                } else {
                    // Stock Out: Update expiry record
                    if (expiryRecord) {
                        await expiryRecord.update({
                            current_quantity: Math.max(0, expiryRecord.current_quantity - adjustmentQuantity),
                            total_quantity_sold: expiryRecord.total_quantity_sold + adjustmentQuantity,
                            total_quantity_adjusted: expiryRecord.total_quantity_adjusted + adjustmentQuantity,
                            status: expiryRecord.current_quantity <= adjustmentQuantity ? 'sold' : 'active'
                        }, { transaction });
                    }
                }
            }

            // 5. Create General Ledger entries (Double Entry Bookkeeping)
            const adjustmentAmount = adjustmentQuantity * unitCost;
            const equivalentAmount = adjustmentAmount * (stockAdjustment.exchange_rate || 1);

            // Stock Adjustment uses Adjustment IN/OUT accounts with their corresponding accounts
            // This ensures proper double-entry bookkeeping
            
            if (isStockIn) {
                // Stock In: Debit Adjustment IN Account, Credit Corresponding Account
                
                // Debit: Adjustment IN Account (account_id)
                await GeneralLedger.create({
                    financial_year_code: currentFinancialYear.name,
                    financial_year_id: currentFinancialYear.id,
                    system_date: new Date(),
                    transaction_date: stockAdjustment.adjustment_date,
                    reference_number: stockAdjustment.reference_number,
                    transaction_type: 'STOCK_ADJUSTMENT',
                    transaction_type_name: 'Stock Adjustment',
                    transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type
                    created_by_code: req.user.id,
                    created_by_name: req.user.name || req.user.username,
                    description: `Stock adjustment IN - ${product?.name} (${stockAdjustment.reference_number})`,
                    account_type_code: stockAdjustment.inventoryAccount?.accountType?.code || 'ASSET',
                    account_type_name: stockAdjustment.inventoryAccount?.accountType?.name || 'Asset',
                    account_type_id: stockAdjustment.inventoryAccount?.accountType?.id,
                    account_id: stockAdjustment.account_id,
                    account_name: stockAdjustment.inventoryAccount?.name || 'Adjustment IN Account',
                    account_code: stockAdjustment.inventoryAccount?.code || 'ADJ_IN',
                    account_nature: 'debit',
                    exchange_rate: stockAdjustment.exchange_rate || 1,
                    amount: equivalentAmount,
                    user_debit_amount: equivalentAmount,
                    user_credit_amount: 0,
                    equivalent_debit_amount: equivalentAmount,
                    equivalent_credit_amount: 0,
                    system_currency_id: systemDefaultCurrency.id,
                    username: req.user.username,
                    companyId: req.user.companyId // Add companyId for multi-tenant support
                }, { transaction });

                // Credit: Corresponding Account (corresponding_account_id)
                if (stockAdjustment.corresponding_account_id) {
                    await GeneralLedger.create({
                        financial_year_code: currentFinancialYear.name,
                        financial_year_id: currentFinancialYear.id,
                        system_date: new Date(),
                        transaction_date: stockAdjustment.adjustment_date,
                        reference_number: stockAdjustment.reference_number,
                        transaction_type: 'STOCK_ADJUSTMENT',
                        transaction_type_name: 'Stock Adjustment',
                        transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type
                        created_by_code: req.user.id,
                        created_by_name: req.user.name || req.user.username,
                        description: `Stock adjustment IN - ${product?.name} (${stockAdjustment.reference_number})`,
                        account_type_code: stockAdjustment.correspondingAccount?.accountType?.code || 'LIABILITY',
                        account_type_name: stockAdjustment.correspondingAccount?.accountType?.name || 'Liability',
                        account_type_id: stockAdjustment.correspondingAccount?.accountType?.id,
                        account_id: stockAdjustment.corresponding_account_id,
                        account_name: stockAdjustment.correspondingAccount?.name || 'Corresponding Account',
                        account_code: stockAdjustment.correspondingAccount?.code || 'CORR',
                        account_nature: 'credit',
                        exchange_rate: stockAdjustment.exchange_rate || 1,
                        amount: equivalentAmount,
                        user_debit_amount: 0,
                        user_credit_amount: equivalentAmount,
                        equivalent_debit_amount: 0,
                        equivalent_credit_amount: equivalentAmount,
                        system_currency_id: systemDefaultCurrency.id,
                        username: req.user.username,
                        companyId: req.user.companyId // Add companyId for multi-tenant support
                    }, { transaction });
                }
            } else {
                // Stock Out: Debit Corresponding Account, Credit Adjustment OUT Account
                
                // Debit: Corresponding Account (corresponding_account_id)
                if (stockAdjustment.corresponding_account_id) {
                    await GeneralLedger.create({
                        financial_year_code: currentFinancialYear.name,
                        financial_year_id: currentFinancialYear.id,
                        system_date: new Date(),
                        transaction_date: stockAdjustment.adjustment_date,
                        reference_number: stockAdjustment.reference_number,
                        transaction_type: 'STOCK_ADJUSTMENT',
                        transaction_type_name: 'Stock Adjustment',
                        transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type
                        created_by_code: req.user.id,
                        created_by_name: req.user.name || req.user.username,
                        description: `Stock adjustment OUT - ${product?.name} (${stockAdjustment.reference_number})`,
                        account_type_code: stockAdjustment.correspondingAccount?.accountType?.code || 'EXPENSE',
                        account_type_name: stockAdjustment.correspondingAccount?.accountType?.name || 'Expense',
                        account_type_id: stockAdjustment.correspondingAccount?.accountType?.id,
                        account_id: stockAdjustment.corresponding_account_id,
                        account_name: stockAdjustment.correspondingAccount?.name || 'Corresponding Account',
                        account_code: stockAdjustment.correspondingAccount?.code || 'CORR',
                        account_nature: 'debit',
                        exchange_rate: stockAdjustment.exchange_rate || 1,
                        amount: equivalentAmount,
                        user_debit_amount: equivalentAmount,
                        user_credit_amount: 0,
                        equivalent_debit_amount: equivalentAmount,
                        equivalent_credit_amount: 0,
                        system_currency_id: systemDefaultCurrency.id,
                        username: req.user.username,
                        companyId: req.user.companyId // Add companyId for multi-tenant support
                    }, { transaction });
                }

                // Credit: Adjustment OUT Account (account_id)
                await GeneralLedger.create({
                    financial_year_code: currentFinancialYear.name,
                    financial_year_id: currentFinancialYear.id,
                    system_date: new Date(),
                    transaction_date: stockAdjustment.adjustment_date,
                    reference_number: stockAdjustment.reference_number,
                    transaction_type: 'STOCK_ADJUSTMENT',
                    transaction_type_name: 'Stock Adjustment',
                    transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type
                    created_by_code: req.user.id,
                    created_by_name: req.user.name || req.user.username,
                    description: `Stock adjustment OUT - ${product?.name} (${stockAdjustment.reference_number})`,
                    account_type_code: stockAdjustment.inventoryAccount?.accountType?.code || 'ASSET',
                    account_type_name: stockAdjustment.inventoryAccount?.accountType?.name || 'Asset',
                    account_type_id: stockAdjustment.inventoryAccount?.accountType?.id,
                    account_id: stockAdjustment.account_id,
                    account_name: stockAdjustment.inventoryAccount?.name || 'Adjustment OUT Account',
                    account_code: stockAdjustment.inventoryAccount?.code || 'ADJ_OUT',
                    account_nature: 'credit',
                    exchange_rate: stockAdjustment.exchange_rate || 1,
                    amount: equivalentAmount,
                    user_debit_amount: 0,
                    user_credit_amount: equivalentAmount,
                    equivalent_debit_amount: 0,
                    equivalent_credit_amount: equivalentAmount,
                    system_currency_id: systemDefaultCurrency.id,
                    username: req.user.username,
                    companyId: req.user.companyId // Add companyId for multi-tenant support
                }, { transaction });
            }

            // 6. Track Price History for cost changes
            const oldAverageCost = parseFloat(productStore.average_cost || 0);
            // Calculate new average cost for stock IN: weighted average
            // For stock OUT: average cost remains the same
            const newAverageCost = isStockIn && newQuantity > 0 ? 
                ((oldAverageCost * oldQuantity) + (unitCost * adjustmentQuantity)) / newQuantity :
                oldAverageCost;

            // Track cost changes using PriceHistoryService
            // For stock IN: Track if average cost changes OR if unit cost is different from current average
            // For stock OUT: Track if average cost changes (shouldn't happen, but track for completeness)
            const shouldTrackCostChange = isStockIn 
                ? (Math.abs(newAverageCost - oldAverageCost) > 0.0001 || Math.abs(unitCost - oldAverageCost) > 0.0001)
                : Math.abs(newAverageCost - oldAverageCost) > 0.0001;

            if (shouldTrackCostChange) {
                try {
                    await PriceHistoryService.trackPriceChange({
                        entityType: 'product',
                        entityId: item.product_id,
                        entityCode: product?.code,
                        entityName: product?.name,
                        moduleName: 'Stock Adjustment',
                        oldAverageCost: oldAverageCost,
                        newAverageCost: newAverageCost,
                        oldSellingPrice: parseFloat(product?.selling_price || 0),
                        newSellingPrice: parseFloat(product?.selling_price || 0),
                        costingMethodCode: 'AVG',
                        priceChangeReasonCode: 'ADJUSTMENT',
                        transactionTypeId: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type
                        quantity: adjustmentQuantity,
                        unit: product?.unit?.name || 'units',
                        currencyId: stockAdjustment.currency_id,
                        exchangeRate: stockAdjustment.exchange_rate || 1,
                        exchangeRateId: stockAdjustment.exchange_rate_id || null,
                        referenceNumber: stockAdjustment.reference_number,
                        notes: `Stock adjustment ${stockAdjustment.adjustment_type}: ${adjustmentQuantity} units at ${unitCost} per unit`,
                        transactionDate: stockAdjustment.adjustment_date,
                        userId: req.user.id,
                        companyId: req.user.companyId
                    }, transaction);

                    // Update ProductStore average cost
                    await productStore.update({
                        average_cost: newAverageCost
                    }, { transaction });
                } catch (priceHistoryError) {
                    // Log error but don't fail the approval
                    console.error('Error tracking price history for stock adjustment:', priceHistoryError);
                    // Still update the average cost even if price history tracking fails
                    await productStore.update({
                        average_cost: newAverageCost
                    }, { transaction });
                }
            } else {
                // Even if we don't track price history, update the average cost for stock IN
                if (isStockIn) {
                    await productStore.update({
                        average_cost: newAverageCost
                    }, { transaction });
                }
            }
        }

        await transaction.commit();
        res.json({ message: 'Stock adjustment approved successfully' });
    } catch (error) {
        try {
            await transaction.rollback();
        } catch (rollbackError) {
            console.error('❌ Error rolling back transaction:', rollbackError);
        }
        console.error('❌ Error in PATCH /api/stock-adjustments/:id/approve:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        if (error.errors) {
            console.error('Validation errors:', error.errors);
        }
        res.status(500).json({ 
            error: 'Failed to approve stock adjustment',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Reject stock adjustment (change status from submitted to rejected)
router.patch('/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === '') {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        const stockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!stockAdjustment) {
            return res.status(404).json({ error: 'Stock adjustment not found' });
        }

        if (stockAdjustment.status !== 'submitted') {
            return res.status(400).json({ error: 'Only submitted adjustments can be rejected' });
        }

        await stockAdjustment.update({
            status: 'rejected',
            rejection_reason: reason.trim(),
            updated_by: req.user.id
        });

        res.json({ message: 'Stock adjustment rejected successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject stock adjustment' });
    }
});

// Delete stock adjustment (only drafts can be deleted)
router.delete('/:id', csrfProtection, async (req, res) => {
    const transaction = await StockAdjustment.sequelize.transaction();
    
    try {
        const { id } = req.params;

        const stockAdjustment = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!stockAdjustment) {
            return res.status(404).json({ error: 'Stock adjustment not found' });
        }

        if (stockAdjustment.status !== 'draft') {
            return res.status(400).json({ error: 'Only draft adjustments can be deleted' });
        }

        // Delete items first (due to foreign key constraint)
        await StockAdjustmentItem.destroy({
            where: { stock_adjustment_id: id },
            transaction
        });

        // Delete the stock adjustment
        await stockAdjustment.destroy({ transaction });

        await transaction.commit();

        res.json({ message: 'Stock adjustment deleted successfully' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Failed to delete stock adjustment' });
    }
});

// Get stock adjustment statistics
router.get('/stats/overview', async (req, res) => {
    try {
        // Get counts by status
        const totalAdjustments = await StockAdjustment.count({
            where: buildCompanyWhere(req)
        });
        const draftAdjustments = await StockAdjustment.count({ 
            where: buildCompanyWhere(req, { status: 'draft' })
        });
        const submittedAdjustments = await StockAdjustment.count({ 
            where: buildCompanyWhere(req, { status: 'submitted' })
        });
        const approvedAdjustments = await StockAdjustment.count({ 
            where: buildCompanyWhere(req, { status: 'approved' })
        });
        const rejectedAdjustments = await StockAdjustment.count({ 
            where: buildCompanyWhere(req, { status: 'rejected' })
        });

        // Get equivalent values by adjustment type (only for approved adjustments)
        const stockInValueResult = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { 
                status: 'approved',
                adjustment_type: 'add' 
            }),
            attributes: [
                [sequelize.fn('SUM', sequelize.col('equivalent_amount')), 'stockInValue']
            ],
            raw: true
        });
        const stockInValue = stockInValueResult?.stockInValue || 0;

        const stockOutValueResult = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { 
                status: 'approved',
                adjustment_type: 'deduct' 
            }),
            attributes: [
                [sequelize.fn('SUM', sequelize.col('equivalent_amount')), 'stockOutValue']
            ],
            raw: true
        });
        const stockOutValue = stockOutValueResult?.stockOutValue || 0;

        // Get total equivalent value of approved adjustments (system default currency)
        const totalValueResult = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { status: 'approved' }),
            attributes: [
                [sequelize.fn('SUM', sequelize.col('equivalent_amount')), 'totalValue']
            ],
            raw: true
        });

        const totalValue = totalValueResult?.totalValue || 0;

        // Get last update timestamp
        const lastUpdateResult = await StockAdjustment.findOne({
            where: buildCompanyWhere(req, { status: 'approved' }),
            attributes: ['updated_at'],
            order: [['updated_at', 'DESC']],
            raw: true
        });

        const lastUpdate = lastUpdateResult?.updated_at || new Date().toISOString();

        res.json({
            totalAdjustments,
            draftAdjustments,
            submittedAdjustments,
            approvedAdjustments,
            rejectedAdjustments,
            
            // Frontend-expected stats
            total: totalAdjustments,
            stockIn: parseFloat(stockInValue) || 0,
            stockOut: parseFloat(stockOutValue) || 0,
            totalValue: parseFloat(totalValue) || 0,
            lastUpdate: lastUpdate
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stock adjustment statistics' });
    }
});

// Export stock adjustments to Excel
router.get('/export/excel', async (req, res) => {
    try {
        // Build where clause for export filters
        const whereClause = {};
        
        if (req.query.search) {
            whereClause[Op.or] = [
                { reference_number: { [Op.iLike]: `%${req.query.search}%` } },
                { document_number: { [Op.iLike]: `%${req.query.search}%` } },
                { notes: { [Op.iLike]: `%${req.query.search}%` } }
            ];
        }
        
        if (req.query.status && req.query.status !== 'all') {
            whereClause.status = req.query.status;
        }
        
        if (req.query.store_id) {
            whereClause.store_id = req.query.store_id;
        }
        
        if (req.query.start_date && req.query.end_date) {
            whereClause.adjustment_date = {
                [Op.between]: [req.query.start_date, req.query.end_date]
            };
        } else if (req.query.start_date) {
            whereClause.adjustment_date = {
                [Op.gte]: req.query.start_date
            };
        } else if (req.query.end_date) {
            whereClause.adjustment_date = {
                [Op.lte]: req.query.end_date
            };
        }

        // Fetch stock adjustments with all necessary relations for export
        const stockAdjustments = await StockAdjustment.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name']
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason',
                    attributes: ['id', 'name', 'code', 'adjustment_type']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'submitter',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'approver',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Transform data for export
        const transformedStockAdjustments = stockAdjustments.map(adjustment => ({
            ...adjustment.toJSON(),
            store_name: adjustment.store?.name || 'Unknown Store',
            adjustment_reason_name: adjustment.adjustmentReason?.name || 'Unknown Reason',
            inventory_account_name: adjustment.inventoryAccount?.name || 'Unknown Account',
            inventory_corresponding_account_name: adjustment.correspondingAccount?.name || 'Unknown Account',
            currency_name: adjustment.currency?.name || 'Unknown Currency',
            currency_symbol: adjustment.currency?.symbol || '$',
            created_by_name: adjustment.creator ? `${adjustment.creator.first_name} ${adjustment.creator.last_name}` : 'System',
            updated_by_name: adjustment.updater ? `${adjustment.updater.first_name} ${adjustment.updater.last_name}` : null,
            submitted_by_name: adjustment.submitter ? `${adjustment.submitter.first_name} ${adjustment.submitter.last_name}` : null,
            approved_by_name: adjustment.approver ? `${adjustment.approver.first_name} ${adjustment.approver.last_name}` : null
        }));

        // Create export service instance
        const exportService = new ExportService();
        
        // Generate Excel file
        const buffer = await exportService.exportStockAdjustmentsToExcel(transformedStockAdjustments, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="stock_adjustments_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
        } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export stock adjustments to Excel', 
            details: error.message 
        });
    }
});

// Export stock adjustments to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        // Build where clause for export filters (same as Excel)
        const whereClause = {};
        
        if (req.query.search) {
            whereClause[Op.or] = [
                { reference_number: { [Op.iLike]: `%${req.query.search}%` } },
                { document_number: { [Op.iLike]: `%${req.query.search}%` } },
                { notes: { [Op.iLike]: `%${req.query.search}%` } }
            ];
        }
        
        if (req.query.status && req.query.status !== 'all') {
            whereClause.status = req.query.status;
        }
        
        if (req.query.store_id) {
            whereClause.store_id = req.query.store_id;
        }
        
        if (req.query.start_date && req.query.end_date) {
            whereClause.adjustment_date = {
                [Op.between]: [req.query.start_date, req.query.end_date]
            };
        } else if (req.query.start_date) {
            whereClause.adjustment_date = {
                [Op.gte]: req.query.start_date
            };
        } else if (req.query.end_date) {
            whereClause.adjustment_date = {
                [Op.lte]: req.query.end_date
            };
        }

        // Fetch stock adjustments with all necessary relations for export
        const stockAdjustments = await StockAdjustment.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Store,
                    as: 'store',
                    attributes: ['id', 'name']
                },
                {
                    model: AdjustmentReason,
                    as: 'adjustmentReason',
                    attributes: ['id', 'name', 'code', 'adjustment_type']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'submitter',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                },
                {
                    model: User,
                    as: 'approver',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Transform data for export
        const transformedStockAdjustments = stockAdjustments.map(adjustment => ({
            ...adjustment.toJSON(),
            store_name: adjustment.store?.name || 'Unknown Store',
            adjustment_reason_name: adjustment.adjustmentReason?.name || 'Unknown Reason',
            inventory_account_name: adjustment.inventoryAccount?.name || 'Unknown Account',
            inventory_corresponding_account_name: adjustment.correspondingAccount?.name || 'Unknown Account',
            currency_name: adjustment.currency?.name || 'Unknown Currency',
            currency_symbol: adjustment.currency?.symbol || '$',
            created_by_name: adjustment.creator ? `${adjustment.creator.first_name} ${adjustment.creator.last_name}` : 'System',
            updated_by_name: adjustment.updater ? `${adjustment.updater.first_name} ${adjustment.updater.last_name}` : null,
            submitted_by_name: adjustment.submitter ? `${adjustment.submitter.first_name} ${adjustment.submitter.last_name}` : null,
            approved_by_name: adjustment.approver ? `${adjustment.approver.first_name} ${adjustment.approver.last_name}` : null
        }));

        // Create export service instance
        const exportService = new ExportService();
        
        // Generate PDF file
        const buffer = await exportService.exportStockAdjustmentsToPDF(transformedStockAdjustments, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="stock_adjustments_export_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
        } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export stock adjustments to PDF', 
            details: error.message 
        });
    }
});

module.exports = router;
