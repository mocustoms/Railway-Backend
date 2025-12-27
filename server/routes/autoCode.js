const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const AutoCode = require('../models/autoCode');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all auto code configurations with pagination and filtering
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const codeType = req.query.codeType || '';
        const sortBy = req.query.sort || 'created_at';
        const order = req.query.order || 'desc';
        const moduleFilter = req.query.module || '';

        // Build where clause
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { module_name: { [Op.iLike]: `%${search}%` } },
                { module_display_name: { [Op.iLike]: `%${search}%` } },
                { prefix: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        if (status) {
            whereClause.status = status;
        }
        
        if (codeType) {
            whereClause.code_type = codeType;
        }
        if (moduleFilter) {
            whereClause.module_name = moduleFilter;
        }

        // Get total count
        const totalCount = await AutoCode.count({ 
            where: buildCompanyWhere(req, whereClause)
        });

        // Get auto codes with pagination
        const autoCodes = await AutoCode.findAll({
            where: buildCompanyWhere(req, whereClause),
            order: [[sortBy, order.toUpperCase()]],
            limit: limit,
            offset: offset
        });

        // Add currentCode field to each config
        const withCurrentCode = autoCodes.map(config => {
            let currentCode = null;
            try {
                currentCode = generateCode(config);
            } catch (e) {
                currentCode = null;
            }
            return {
                ...config.toJSON(),
                currentCode: currentCode
            };
        });

        const totalPages = Math.ceil(totalCount / limit);

        res.json({
            success: true,
            data: withCurrentCode,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch auto code configurations',
            error: error.message
        });
    }
});

// Get auto code configuration by ID
router.get('/:id', async (req, res) => {
    try {
        const autoCode = await AutoCode.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!autoCode) {
            return res.status(404).json({
                success: false,
                message: 'Auto code configuration not found'
            });
        }

        res.json({
            success: true,
            data: autoCode
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch auto code configuration',
            error: error.message
        });
    }
});

// Create new auto code configuration
router.post('/', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const {
            module_name,
            module_display_name,
            code_type,
            prefix,
            format,
            next_number,
            number_padding,
            status,
            description
        } = req.body;

        // Check if module already exists
        const existingAutoCode = await AutoCode.findOne({
            where: buildCompanyWhere(req, { module_name: module_name })
        });

        if (existingAutoCode) {
            return res.status(400).json({
                success: false,
                message: 'Auto code configuration for this module already exists'
            });
        }

        const autoCode = await AutoCode.create({
            module_name,
            module_display_name,
            companyId: req.user.companyId,
            code_type,
            prefix,
            format,
            next_number: next_number || 1,
            number_padding: number_padding || 4,
            status: status || 'active',
            description,
            created_by: req.user.id
        });

        res.status(201).json({
            success: true,
            message: 'Auto code configuration created successfully',
            data: autoCode
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to create auto code configuration',
            error: error.message
        });
    }
});

// Update auto code configuration
router.put('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const autoCode = await AutoCode.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!autoCode) {
            return res.status(404).json({
                success: false,
                message: 'Auto code configuration not found'
            });
        }

        const {
            module_display_name,
            code_type,
            prefix,
            format,
            next_number,
            number_padding,
            status,
            description
        } = req.body;

        await autoCode.update({
            module_display_name,
            code_type,
            prefix,
            format,
            next_number,
            number_padding,
            status,
            description,
            updated_by: req.user.id
        });

        res.json({
            success: true,
            message: 'Auto code configuration updated successfully',
            data: autoCode
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update auto code configuration',
            error: error.message
        });
    }
});

// Delete auto code configuration
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const autoCode = await AutoCode.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!autoCode) {
            return res.status(404).json({
                success: false,
                message: 'Auto code configuration not found'
            });
        }

        await autoCode.destroy();

        res.json({
            success: true,
            message: 'Auto code configuration deleted successfully'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete auto code configuration',
            error: error.message
        });
    }
});

// Get next auto code for a specific module
router.get('/next/:moduleName', async (req, res) => {
    try {
        const { moduleName } = req.params;
        
        const autoCode = await AutoCode.findOne({
            where: buildCompanyWhere(req, { 
                module_name: moduleName,
                status: 'active'
            })
        });

        if (!autoCode) {
            return res.status(404).json({
                success: false,
                message: `No active auto code configuration found for module: ${moduleName}`
            });
        }

        // Generate the next code
        const nextCode = generateCode(autoCode);
        
        // Update the next number and last used date
        await autoCode.update({
            next_number: autoCode.next_number + 1,
            last_used: new Date(),
            updated_by: req.user.id
        });

        res.json({
            success: true,
            data: {
                nextCode: nextCode,
                configuration: autoCode
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to generate next auto code',
            error: error.message
        });
    }
});

// Get all available modules for auto code configuration
router.get('/modules/available', async (req, res) => {
    try {
        // Define all available modules in the system
        const availableModules = [
            {
                module_name: 'customers',
                module_display_name: 'Customers',
                code_type: 'code',
                default_prefix: 'CUST',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated customer codes'
            },
            {
                module_name: 'products',
                module_display_name: 'Product Catalog',
                code_type: 'code',
                default_prefix: 'PROD',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated product codes'
            },
            {
                module_name: 'products_barcode',
                module_display_name: 'Product Barcodes',
                code_type: 'barcode',
                default_prefix: 'BAR',
                default_format: '{NUMBER}',
                description: 'Auto-generated product barcodes'
            },
            {
                module_name: 'accounts',
                module_display_name: 'Chart of Accounts',
                code_type: 'code',
                default_prefix: 'ACC',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated account codes'
            },
            {
                module_name: 'stock_adjustments',
                module_display_name: 'Stock Adjustments',
                code_type: 'reference_number',
                default_prefix: 'ADJ',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated stock adjustment reference numbers'
            },
            {
                module_name: 'physical_inventory',
                module_display_name: 'Physical Inventory',
                code_type: 'reference_number',
                default_prefix: 'INV',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated physical inventory reference numbers'
            },
            {
                module_name: 'general_ledger',
                module_display_name: 'General Ledger',
                code_type: 'reference_number',
                default_prefix: 'GL',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated general ledger reference numbers'
            },
            {
                module_name: 'opening_balances',
                module_display_name: 'Opening Balances',
                code_type: 'reference_number',
                default_prefix: 'OB',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated opening balance reference numbers'
            },
            {
                module_name: 'product_categories',
                module_display_name: 'Product Categories',
                code_type: 'code',
                default_prefix: 'CAT',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated product category codes'
            },
            {
                module_name: 'product_manufacturers',
                module_display_name: 'Product Manufacturers',
                code_type: 'code',
                default_prefix: 'MFG',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated manufacturer codes'
            },
            {
                module_name: 'product_models',
                module_display_name: 'Product Models',
                code_type: 'code',
                default_prefix: 'MOD',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated product model codes'
            },
            {
                module_name: 'product_brand_names',
                module_display_name: 'Product Brand Names',
                code_type: 'code',
                default_prefix: 'BRD',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated brand name codes'
            },
            {
                module_name: 'product_colors',
                module_display_name: 'Product Colors',
                code_type: 'code',
                default_prefix: 'COL',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated product color codes'
            },
            {
                module_name: 'packaging',
                module_display_name: 'Packaging Types',
                code_type: 'code',
                default_prefix: 'PKG',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated packaging type codes'
            },
            {
                module_name: 'tax_codes',
                module_display_name: 'Tax Codes',
                code_type: 'code',
                default_prefix: 'TAX',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated tax codes'
            },
            {
                module_name: 'payment_methods',
                module_display_name: 'Payment Methods',
                code_type: 'code',
                default_prefix: 'PMT',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated payment method codes'
            },
            {
                module_name: 'payment_types',
                module_display_name: 'Payment Types',
                code_type: 'code',
                default_prefix: 'PTY',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated payment type codes'
            },
            {
                module_name: 'stores',
                module_display_name: 'Stores',
                code_type: 'code',
                default_prefix: 'STR',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated store codes'
            },
            {
                module_name: 'currencies',
                module_display_name: 'Currencies',
                code_type: 'code',
                default_prefix: 'CUR',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated currency codes'
            },
            {
                module_name: 'users',
                module_display_name: 'Users',
                code_type: 'code',
                default_prefix: 'USR',
                default_format: '{PREFIX}-{NUMBER}',
                description: 'Auto-generated user codes'
            },
            {
                module_name: 'opening-balance',
                module_display_name: 'Opening Balances',
                code_type: 'reference_number',
                default_prefix: 'OB',
                default_format: '{PREFIX}-{YEAR}-{NUMBER}',
                description: 'Auto-generated opening balance reference numbers'
            }
        ];

        // Check which modules already have auto code configurations
        const existingAutoCodes = await AutoCode.findAll({
            where: buildCompanyWhere(req),
            attributes: ['module_name', 'status']
        });

        const existingModuleNames = existingAutoCodes.map(ac => ac.module_name);

        // Add status information to available modules
        const modulesWithStatus = availableModules.map(module => {
            const existing = existingAutoCodes.find(ac => ac.module_name === module.module_name);
            return {
                ...module,
                is_configured: !!existing,
                current_status: existing ? existing.status : null
            };
        });

        res.json({
            success: true,
            data: modulesWithStatus
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available modules',
            error: error.message
        });
    }
});

// Helper function to generate codes based on format
function generateCode(autoCode) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const paddedNumber = String(autoCode.next_number).padStart(autoCode.number_padding, '0');

    let code = autoCode.format;
    
    code = code.replace(/{PREFIX}/g, autoCode.prefix);
    code = code.replace(/{YEAR}/g, year);
    code = code.replace(/{MONTH}/g, month);
    code = code.replace(/{DAY}/g, day);
    code = code.replace(/{NUMBER}/g, paddedNumber);

    return code;
}

module.exports = router; 