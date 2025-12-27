const express = require('express');
const { Op } = require('sequelize');
const { TaxCode, User, Account } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');

const router = express.Router();

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all tax codes with pagination, search, and sorting
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 25,
            search = '',
            sortBy = 'code',
            sortOrder = 'asc'
        } = req.query;

        const offset = (page - 1) * limit;
        const searchCondition = search ? {
            [Op.or]: [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { indicator: { [Op.iLike]: `%${search}%` } },
                { efd_department_code: { [Op.iLike]: `%${search}%` } }
            ]
        } : {};

        const { count, rows: taxCodes } = await TaxCode.findAndCountAll({
            where: buildCompanyWhere(req, searchCondition),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: Account,
                    as: 'salesTaxAccount',
                    attributes: ['id', 'code', 'name']
                },
                {
                    model: Account,
                    as: 'purchasesTaxAccount',
                    attributes: ['id', 'code', 'name']
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const totalPages = Math.ceil(count / limit);

        res.json({
            taxCodes,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tax codes' });
    }
});

// Get a single tax code by ID
router.get('/:id', async (req, res) => {
    try {
        const taxCode = await TaxCode.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: Account,
                    as: 'salesTaxAccount',
                    attributes: ['id', 'code', 'name']
                },
                {
                    model: Account,
                    as: 'purchasesTaxAccount',
                    attributes: ['id', 'code', 'name']
                }
            ]
        });

        if (!taxCode) {
            return res.status(404).json({ error: 'Tax code not found' });
        }

        res.json(taxCode);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tax code' });
    }
});

// Create a new tax code
router.post('/', csrfProtection, csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and tax code creation
    const transaction = await sequelize.transaction();
    
    try {
        const {
            name,
            rate,
            indicator,
            efd_department_code,
            sales_tax_account_id,
            purchases_tax_account_id,
            is_active = true,
            is_wht = false
        } = req.body;

        // Validate required fields
        if (!name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Name is required' });
        }

        // Auto-generate tax code
        const code = await autoCodeService.generateNextCode(
            'tax_codes',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'TAX',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );

        const taxCode = await TaxCode.create({
            companyId: req.user.companyId,
            code,
            name,
            rate: parseFloat(rate),
            indicator,
            efd_department_code,
            sales_tax_account_id: sales_tax_account_id || null,
            purchases_tax_account_id: purchases_tax_account_id || null,
            is_active,
            is_wht,
            created_by: req.user.id
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Fetch the created tax code with associations
        const createdTaxCode = await TaxCode.findByPk(taxCode.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: Account,
                    as: 'salesTaxAccount',
                    attributes: ['id', 'code', 'name']
                },
                {
                    model: Account,
                    as: 'purchasesTaxAccount',
                    attributes: ['id', 'code', 'name']
                }
            ]
        });

        res.status(201).json(createdTaxCode);
    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({ error: 'Failed to create tax code' });
    }
});

// Update a tax code
router.put('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const taxCode = await TaxCode.findByPk(req.params.id);
        if (!taxCode) {
            return res.status(404).json({ error: 'Tax code not found' });
        }

        const {
            code,
            name,
            rate,
            indicator,
            efd_department_code,
            sales_tax_account_id,
            purchases_tax_account_id,
            is_active,
            is_wht
        } = req.body;

        // Check if code already exists (excluding current record, within company scope)
        if (code && code !== taxCode.code) {
            const codeWhere = buildCompanyWhere(req, { code });
            if (!req.user.isSystemAdmin && req.user.companyId) {
                codeWhere.companyId = req.user.companyId;
            }
            const existingTaxCode = await TaxCode.findOne({ where: codeWhere });
            if (existingTaxCode) {
                return res.status(400).json({ error: 'Tax code with this code already exists in your company' });
            }
        }

        await taxCode.update({
            code,
            name,
            rate: rate ? parseFloat(rate) : taxCode.rate,
            indicator,
            efd_department_code,
            sales_tax_account_id: sales_tax_account_id || null,
            purchases_tax_account_id: purchases_tax_account_id || null,
            is_active,
            is_wht: is_wht !== undefined ? is_wht : taxCode.is_wht,
            updated_by: req.user.id
        });

        // Fetch the updated tax code with associations
        const updatedTaxCode = await TaxCode.findByPk(taxCode.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: Account,
                    as: 'salesTaxAccount',
                    attributes: ['id', 'code', 'name']
                },
                {
                    model: Account,
                    as: 'purchasesTaxAccount',
                    attributes: ['id', 'code', 'name']
                }
            ]
        });

        res.json(updatedTaxCode);
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({ error: 'Failed to update tax code' });
    }
});

// Delete a tax code
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const taxCode = await TaxCode.findByPk(req.params.id);
        if (!taxCode) {
            return res.status(404).json({ error: 'Tax code not found' });
        }

        await taxCode.destroy();
        res.json({ message: 'Tax code deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete tax code' });
    }
});

// Get all active tax codes (for dropdowns)
router.get('/active/all', async (req, res) => {
    try {
        const taxCodes = await TaxCode.findAll({
            where: { is_active: true },
            attributes: ['id', 'code', 'name', 'rate'],
            order: [['name', 'ASC']]
        });

        res.json(taxCodes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active tax codes' });
    }
});

// GET /api/tax-codes/stats/overview - Get tax code statistics
router.get('/stats/overview', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const totalTaxCodes = await TaxCode.count({ where: baseWhere });
        const activeTaxCodes = await TaxCode.count({ where: { ...baseWhere, is_active: true } });
        const inactiveTaxCodes = await TaxCode.count({ where: { ...baseWhere, is_active: false } });
        
        // Calculate average rate (with company filter)
        const taxCodesWithRates = await TaxCode.findAll({
            where: { 
                ...baseWhere,
                rate: { [Op.not]: null },
                is_active: true 
            },
            attributes: ['rate']
        });
        
        let averageRate = 0;
        if (taxCodesWithRates.length > 0) {
            const totalRate = taxCodesWithRates.reduce((sum, taxCode) => {
                const rate = parseFloat(taxCode.rate) || 0;
                return sum + rate;
            }, 0);
            averageRate = totalRate / taxCodesWithRates.length;
        }

        // Get last update time (with company filter)
        const lastUpdated = await TaxCode.findOne({
            where: baseWhere,
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });
        const lastUpdate = lastUpdated ? lastUpdated.updated_at : null;
        const lastUpdateFormatted = lastUpdate ? new Date(lastUpdate).toLocaleDateString() : 'Never';

        res.json({
            stats: {
                totalTaxCodes,
                activeTaxCodes,
                inactiveTaxCodes,
                averageRate: parseFloat(averageRate.toFixed(2)),
                lastUpdate: lastUpdateFormatted
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/tax-codes/check-code/availability - Check if tax code is available
router.get('/check-code/availability', async (req, res) => {
    try {
        const { code, exclude_id } = req.query;
        
        if (!code) {
            return res.status(400).json({ message: 'Tax code is required' });
        }

        const whereClause = { code: code.toUpperCase() };
        if (exclude_id) {
            whereClause.id = { [Op.ne]: exclude_id };
        }

        const existingTaxCode = await TaxCode.findOne({ where: whereClause });
        const available = !existingTaxCode;

        res.json({ available });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router; 