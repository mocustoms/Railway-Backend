const express = require('express');
const router = express.Router();
const { ProductCategory, TaxCode, Account, User, Product, ProductModel, ProductManufacturer } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all product categories with related data
router.get('/', async (req, res) => {
    try {

        const { page = 1, limit = 25, search = '', sortBy = 'code', sortOrder = 'asc', status } = req.query;
        
        const offset = (page - 1) * limit;
        const whereClause = {};
        
        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Add status filter
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const { count, rows: productCategories } = await ProductCategory.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
                {
                    model: TaxCode,
                    as: 'taxCode',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Transform data to include related names
        const transformedProductCategories = productCategories.map(productCategory => {
            const plainProductCategory = productCategory.get({ plain: true });
            return {
                ...plainProductCategory,
                tax_code_name: plainProductCategory.taxCode ? plainProductCategory.taxCode.name : null,
                purchases_tax_name: plainProductCategory.purchasesTax ? plainProductCategory.purchasesTax.name : null,
                cogs_account_name: plainProductCategory.cogsAccount ? plainProductCategory.cogsAccount.name : null,
                income_account_name: plainProductCategory.incomeAccount ? plainProductCategory.incomeAccount.name : null,
                asset_account_name: plainProductCategory.assetAccount ? plainProductCategory.assetAccount.name : null,
                created_by_name: plainProductCategory.createdByUser ? 
                    `${plainProductCategory.createdByUser.first_name} ${plainProductCategory.createdByUser.last_name}` : null,
                updated_by_name: plainProductCategory.updatedByUser ? 
                    `${plainProductCategory.updatedByUser.first_name} ${plainProductCategory.updatedByUser.last_name}` : null,
                createdAt: plainProductCategory.created_at || plainProductCategory.createdAt,
                updatedAt: plainProductCategory.updated_at || plainProductCategory.updatedAt
            };
        });

        res.json({
            productCategories: transformedProductCategories,
            pagination: {
                totalItems: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit),
                startIndex: offset,
                endIndex: Math.min(offset + parseInt(limit), count)
            }
        });
    } catch (error) {
        if (error && error.stack) {
            }
        res.status(500).json({ error: 'Failed to fetch product categories', details: error.message });
    }
});

// Get product category statistics
router.get('/stats', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const total = await ProductCategory.count({ where: baseWhere });
        const active = await ProductCategory.count({ where: { ...baseWhere, is_active: true } });
        const inactive = await ProductCategory.count({ where: { ...baseWhere, is_active: false } });
        
        // Get last update time (with company filter)
        const lastUpdated = await ProductCategory.findOne({
            where: baseWhere,
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });
        const lastUpdate = lastUpdated ? lastUpdated.updated_at : null;
        const lastUpdateFormatted = lastUpdate ? new Date(lastUpdate).toLocaleDateString() : 'Never';

        res.json({
            total,
            active,
            inactive,
            lastUpdate: lastUpdateFormatted
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Export product categories to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search = '', status } = req.query;
        const whereClause = {};

        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Add status filter
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const productCategories = await ProductCategory.findAll({
            where: whereClause,
            include: [
                {
                    model: TaxCode,
                    as: 'taxCode',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ],
            order: [['code', 'ASC']]
        });

        // Transform data to include related names
        const transformedData = productCategories.map(productCategory => {
            const plainCategory = productCategory.get({ plain: true });
            return {
                ...plainCategory,
                tax_code_name: plainCategory.taxCode ? plainCategory.taxCode.name : null,
                purchases_tax_name: plainCategory.purchasesTax ? plainCategory.purchasesTax.name : null,
                cogs_account_name: plainCategory.cogsAccount ? plainCategory.cogsAccount.name : null,
                income_account_name: plainCategory.incomeAccount ? plainCategory.incomeAccount.name : null,
                asset_account_name: plainCategory.assetAccount ? plainCategory.assetAccount.name : null,
                created_by_name: plainCategory.createdByUser ? 
                    `${plainCategory.createdByUser.first_name} ${plainCategory.createdByUser.last_name}` : null,
                updated_by_name: plainCategory.updatedByUser ? 
                    `${plainCategory.updatedByUser.first_name} ${plainCategory.updatedByUser.last_name}` : null,
            };
        });

        const exportService = new ExportService();
        const buffer = await exportService.exportCategoriesToExcel(transformedData);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=product-categories.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Export product categories to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search = '', status } = req.query;
        const whereClause = {};

        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Add status filter
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const productCategories = await ProductCategory.findAll({
            where: whereClause,
            include: [
                {
                    model: TaxCode,
                    as: 'taxCode',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ],
            order: [['code', 'ASC']]
        });

        // Transform data to include related names
        const transformedData = productCategories.map(productCategory => {
            const plainCategory = productCategory.get({ plain: true });
            return {
                ...plainCategory,
                tax_code_name: plainCategory.taxCode ? plainCategory.taxCode.name : null,
                purchases_tax_name: plainCategory.purchasesTax ? plainCategory.purchasesTax.name : null,
                cogs_account_name: plainCategory.cogsAccount ? plainCategory.cogsAccount.name : null,
                income_account_name: plainCategory.incomeAccount ? plainCategory.incomeAccount.name : null,
                asset_account_name: plainCategory.assetAccount ? plainCategory.assetAccount.name : null,
                created_by_name: plainCategory.createdByUser ? 
                    `${plainCategory.createdByUser.first_name} ${plainCategory.createdByUser.last_name}` : null,
                updated_by_name: plainCategory.updatedByUser ? 
                    `${plainCategory.updatedByUser.first_name} ${plainCategory.updatedByUser.last_name}` : null,
            };
        });

        const exportService = new ExportService();
        const buffer = await exportService.exportCategoriesToPDF(transformedData);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=product-categories.pdf');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get single product category by ID
router.get('/:id', async (req, res) => {
    try {
        const productCategory = await ProductCategory.findByPk(req.params.id, {
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
                {
                    model: TaxCode,
                    as: 'taxCode',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        if (!productCategory) {
            return res.status(404).json({ message: 'Product category not found' });
        }

        const plainProductCategory = productCategory.get({ plain: true });
        const transformedProductCategory = {
            ...plainProductCategory,
            description: plainProductCategory.description,
            tax_code_name: plainProductCategory.taxCode ? plainProductCategory.taxCode.name : null,
            purchases_tax_name: plainProductCategory.purchasesTax ? plainProductCategory.purchasesTax.name : null,
            cogs_account_name: plainProductCategory.cogsAccount ? plainProductCategory.cogsAccount.name : null,
            income_account_name: plainProductCategory.incomeAccount ? plainProductCategory.incomeAccount.name : null,
            asset_account_name: plainProductCategory.assetAccount ? plainProductCategory.assetAccount.name : null,
            created_by_name: plainProductCategory.createdByUser ? 
                `${plainProductCategory.createdByUser.first_name} ${plainProductCategory.createdByUser.last_name}` : null,
            updated_by_name: plainProductCategory.updatedByUser ? 
                `${plainProductCategory.updatedByUser.first_name} ${plainProductCategory.updatedByUser.last_name}` : null,
            createdAt: plainProductCategory.created_at || plainProductCategory.createdAt,
            updatedAt: plainProductCategory.updated_at || plainProductCategory.updatedAt
        };

        res.json(transformedProductCategory);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create new product category
router.post('/', csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and category creation
    const transaction = await sequelize.transaction();
    
    try {
        const {
            name,
            description,
            tax_code_id,
            purchases_tax_id,
            cogs_account_id,
            income_account_id,
            asset_account_id,
            is_active,
            color
        } = req.body;

        // Validate required fields
        if (!name) {
            await transaction.rollback();
            return res.status(400).json({ message: 'Name is required' });
        }

        // Check if product category name already exists in this company
        // Always check within company, even for super-admins
        if (!req.user.companyId) {
            await transaction.rollback();
            return res.status(400).json({ 
                message: 'Company ID is required to create a product category' 
            });
        }

        const existingProductCategory = await ProductCategory.findOne({
            where: {
                name: name.trim(),
                companyId: req.user.companyId
            },
            transaction
        });

        if (existingProductCategory) {
            await transaction.rollback();
            return res.status(400).json({ 
                message: 'A product category with this name already exists in your company' 
            });
        }

        // Auto-generate category code
        // Retry logic to handle race conditions with unique constraint
        let code;
        let attempts = 0;
        const maxAttempts = 5;
        
        while (attempts < maxAttempts) {
            try {
                code = await autoCodeService.generateNextCode(
            'product_categories',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'CAT',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
                
                // Verify code doesn't already exist for this company
                const existingCode = await ProductCategory.findOne({
                    where: {
                        code: code,
                        companyId: req.user.companyId
                    },
                    transaction
                });
                
                if (!existingCode) {
                    break; // Code is available, exit retry loop
                }
                
                // Code exists, increment and try again
                attempts++;
                if (attempts >= maxAttempts) {
                    await transaction.rollback();
                    return res.status(500).json({ 
                        message: 'Failed to generate unique category code. Please try again.' 
                    });
                }
                
                // Small delay before retry
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                if (error.message.includes('unique') || error.message.includes('duplicate')) {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        await transaction.rollback();
                        return res.status(500).json({ 
                            message: 'Failed to generate unique category code. Please try again.',
                            details: error.message
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    throw error; // Re-throw non-unique errors
                }
            }
        }

        const productCategory = await ProductCategory.create({
            companyId: req.user.companyId,
            code,
            name,
            description: description || null,
            tax_code_id: tax_code_id || null,
            purchases_tax_id: purchases_tax_id || null,
            cogs_account_id: cogs_account_id || null,
            income_account_id: income_account_id || null,
            asset_account_id: asset_account_id || null,
            is_active: is_active !== undefined ? is_active : true,
            color: color || '#2196f3',
            created_by: req.user.id
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        res.status(201).json(productCategory);
    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                message: error.errors[0].message,
                details: error.errors 
            });
        }
        
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                message: 'A product category with this code already exists',
                details: error.message 
            });
        }
        
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ 
                message: 'Invalid reference (tax code, account, etc.)',
                details: error.message 
            });
        }
        
        res.status(500).json({ 
            message: 'Internal server error',
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Update product category
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const productCategory = await ProductCategory.findByPk(req.params.id);
        if (!productCategory) {
            return res.status(404).json({ message: 'Product category not found' });
        }

        const {
            code,
            name,
            description,
            tax_code_id,
            purchases_tax_id,
            cogs_account_id,
            income_account_id,
            asset_account_id,
            is_active,
            color
        } = req.body;

        // Validate required fields - code is auto-generated, don't require it
        if (!name) {
            return res.status(400).json({ message: 'Name is required' });
        }

        // Code cannot be updated - it's auto-generated and immutable
        // If code is provided and different, reject the update
        if (code && code.trim() !== '' && code !== productCategory.code) {
            return res.status(400).json({ 
                message: 'Product category code cannot be changed. It is automatically generated and immutable.' 
            });
        }

        const updateData = {
            name,
            description: description || null,
            tax_code_id: tax_code_id || null,
            purchases_tax_id: purchases_tax_id || null,
            cogs_account_id: cogs_account_id || null,
            income_account_id: income_account_id || null,
            asset_account_id: asset_account_id || null,
            is_active: is_active !== undefined ? is_active : productCategory.is_active,
            color: color || productCategory.color,
            updated_by: req.user.id
        };

        await productCategory.update(updateData);

        // Fetch the updated category with all fields
        const updatedCategory = await ProductCategory.findByPk(req.params.id);
        res.json(updatedCategory);
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ message: error.errors[0].message });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Check product category usage before deletion
router.get('/:id/usage', async (req, res) => {
    try {
        const productCategory = await ProductCategory.findByPk(req.params.id);
        if (!productCategory) {
            return res.status(404).json({ message: 'Product category not found' });
        }

        // Check usage in related models
        const productCount = await Product.count({ where: { category_id: req.params.id } });
        const modelCount = await ProductModel.count({ where: { category_id: req.params.id } });
        const manufacturerCount = await ProductManufacturer.count({ where: { category_id: req.params.id } });

        const totalUsage = productCount + modelCount + manufacturerCount;
        const isUsed = totalUsage > 0;

        let message = '';
        if (isUsed) {
            const usageParts = [];
            if (productCount > 0) usageParts.push(`${productCount} product${productCount > 1 ? 's' : ''}`);
            if (modelCount > 0) usageParts.push(`${modelCount} model${modelCount > 1 ? 's' : ''}`);
            if (manufacturerCount > 0) usageParts.push(`${manufacturerCount} manufacturer${manufacturerCount > 1 ? 's' : ''}`);
            
            message = `This category is being used by ${usageParts.join(', ')}.`;
        } else {
            message = 'This category is not being used and can be safely deleted.';
        }

        res.json({
            isUsed,
            usageCount: totalUsage,
            productCount,
            modelCount,
            manufacturerCount,
            message
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Deactivate product category instead of deleting
router.put('/:id/deactivate', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const productCategory = await ProductCategory.findByPk(req.params.id);
        if (!productCategory) {
            return res.status(404).json({ message: 'Product category not found' });
        }

        await productCategory.update({
            is_active: false,
            updated_by: req.user.id
        });

        res.json(productCategory);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete product category (with usage check)
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const productCategory = await ProductCategory.findByPk(req.params.id);
        if (!productCategory) {
            return res.status(404).json({ message: 'Product category not found' });
        }

        // Check usage before deletion
        const productCount = await Product.count({ where: { category_id: req.params.id } });
        const modelCount = await ProductModel.count({ where: { category_id: req.params.id } });
        const manufacturerCount = await ProductManufacturer.count({ where: { category_id: req.params.id } });

        const totalUsage = productCount + modelCount + manufacturerCount;
        if (totalUsage > 0) {
            return res.status(400).json({ 
                message: 'Cannot delete category as it is being used by other records. Please deactivate instead.',
                isUsed: true,
                usageCount: totalUsage,
                productCount,
                modelCount,
                manufacturerCount
            });
        }

        await productCategory.destroy();
        res.json({ message: 'Product category deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router; 