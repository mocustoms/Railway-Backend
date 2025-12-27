const express = require('express');
const router = express.Router();
const { AccountType, User, Company } = require('../models');
const auth = require('../middleware/auth');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const ExportService = require('../utils/exportService');
const AccountTypeService = require('../services/accountTypeService');
const sequelize = require('../../config/database');

// Apply authentication, company filtering, and strip companyId from user input
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Helper function to convert account type to view model
function toAccountTypeViewModel(accountType) {
    return {
        id: accountType.id,
        name: accountType.name,
        code: accountType.code,
        description: accountType.description,
        category: accountType.category,
        nature: accountType.nature,
        isActive: accountType.is_active,
        createdBy: accountType.created_by,
        updatedBy: accountType.updated_by,
        createdAt: accountType.created_at,
        updatedAt: accountType.updated_at,
        creator: accountType.creator ? {
            id: accountType.creator.id,
            firstName: accountType.creator.first_name,
            lastName: accountType.creator.last_name,
            username: accountType.creator.username
        } : null,
        updater: accountType.updater ? {
            id: accountType.updater.id,
            firstName: accountType.updater.first_name,
            lastName: accountType.updater.last_name,
            username: accountType.updater.username
        } : null
    };
}

// Account Types endpoints with pagination, search, and sorting
router.get('/account-types', async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', sort = 'name', order = 'asc' } = req.query;
        const offset = (page - 1) * limit;
        
        // Build where clause for search
        const whereClause = {};
        if (search) {
            whereClause[require('sequelize').Op.or] = [
                { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { code: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
            ];
        }

        // Build final where clause with company filter (AccountType doesn't have companyId, but we still apply middleware)
        const finalWhere = buildCompanyWhere(req, whereClause);
        // Note: AccountType doesn't have companyId, so filtering is handled at application level
        // For now, we'll skip company filtering for AccountType as per user's request

        // Validate sort column
        const allowedSortColumns = ['name', 'code', 'category', 'nature', 'is_active', 'created_at'];
        const sortColumn = allowedSortColumns.includes(sort) ? sort : 'name';
        const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

        // Get total count
        const total = await AccountType.count({ where: finalWhere });

        // Get paginated data
        const accountTypes = await AccountType.findAll({
            where: finalWhere,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                }
            ],
            order: [[sortColumn, sortOrder]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            data: accountTypes.map(toAccountTypeViewModel),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            },
            total
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/account-types/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const accountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                }
            ]
        });
        
        if (!accountType) {
            return res.status(404).json({ error: 'Account type not found' });
        }
        
        res.json(toAccountTypeViewModel(accountType));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/account-types', csrfProtection, csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and account type creation
    const transaction = await sequelize.transaction();
    
    try {
        const { name, description, category, nature, isActive } = req.body;

        // Use the service to create account type
        const accountType = await AccountTypeService.createAccountType(
            {
                name,
                description,
                category,
                nature,
                is_active: isActive
            },
            req.user.companyId,
            req.user.id,
            transaction
        );

        // Commit transaction
        await transaction.commit();

        // Fetch the created account type with associations
        const createdAccountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id: accountType.id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                }
            ]
        });

        if (!createdAccountType) {
            return res.status(500).json({ 
                error: 'Account type was created but could not be retrieved' 
            });
        }

        res.status(201).json(toAccountTypeViewModel(createdAccountType));
    } catch (error) {
        // Rollback transaction if it exists and hasn't been committed/rolled back
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                // Error rolling back - ignore
            }
        }
        
        if (error.name === 'SequelizeValidationError') {
            const errors = error.errors.map(e => ({
                field: e.path,
                message: e.message
            }));
            return res.status(400).json({
                error: 'Validation error',
                errors: errors.map(e => e.message),
                errorDetails: errors
            });
        }
        
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({
                error: 'An account type with this information already exists'
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Error creating account type',
            errorName: error.name
        });
    }
});

router.put('/account-types/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, category, nature, isActive } = req.body;

        // Find the account type
        const accountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!accountType) {
            return res.status(404).json({ error: 'Account type not found' });
        }

        // Validate required fields (code is auto-generated and cannot be changed)
        if (!name || !category || !nature) {
            return res.status(400).json({ 
                error: 'Missing required fields: name, category, and nature are required' 
            });
        }

        // Validate category
        if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(category)) {
            return res.status(400).json({ 
                error: 'category must be one of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE' 
            });
        }

        // Validate nature
        if (!['DEBIT', 'CREDIT'].includes(nature)) {
            return res.status(400).json({ 
                error: 'nature must be one of: DEBIT, CREDIT' 
            });
        }

        // Check if account type with same name already exists (excluding current)
        const existingTypeByName = await AccountType.findOne({ 
            where: buildCompanyWhere(req, { 
                name,
                id: { [require('sequelize').Op.ne]: id }
            })
        });
        if (existingTypeByName) {
            return res.status(400).json({ 
                error: 'An account type with this name already exists' 
            });
        }

        // Update account type (code is auto-generated and cannot be changed)
        await accountType.update({
            name,
            // Code is auto-generated and read-only - do not update it
            description,
            category,
            nature,
            is_active: isActive !== undefined ? isActive : accountType.is_active,
            updated_by: req.user.id
        });

        // Fetch the updated account type with associations
        const updatedAccountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                }
            ]
        });

        res.json(toAccountTypeViewModel(updatedAccountType));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/account-types/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        
        const accountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!accountType) {
            return res.status(404).json({ error: 'Account type not found' });
        }

        // Check if account type is being used by any accounts
        const accountCount = await require('../models/account').count({
            where: buildCompanyWhere(req, { account_type_id: id })
        });

        if (accountCount > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete account type. It is being used by existing accounts.' 
            });
        }

        await accountType.destroy();
        res.json({ message: 'Account type deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export endpoints for Account Types
// GET /api/administration/account-types/export/excel - Export account types to Excel
router.get('/account-types/export/excel', async (req, res) => {
    try {
        const { search, category, nature, is_active } = req.query;
        
        // Build where clause
        const whereClause = {};
        if (search) {
            whereClause[require('sequelize').Op.or] = [
                { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { code: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
            ];
        }
        if (category) whereClause.category = category;
        if (nature) whereClause.nature = nature;
        if (is_active !== undefined) whereClause.is_active = is_active === 'true';

        // Build final where clause with company filter (AccountType doesn't have companyId, but we still apply middleware)
        const finalWhere = buildCompanyWhere(req, whereClause);
        // Note: AccountType doesn't have companyId, so filtering is handled at application level
        // For now, we'll skip company filtering for AccountType as per user's request

        // Fetch account types with associations
        const accountTypes = await AccountType.findAll({
            where: finalWhere,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                }
            ],
            order: [['name', 'ASC']]
        });

        // Create export service instance
        const exportService = new ExportService();
        const buffer = await exportService.exportAccountTypesToExcel(accountTypes, req.query);

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="account-types.xlsx"');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export account types to Excel' });
    }
});

// GET /api/administration/account-types/export/pdf - Export account types to PDF
router.get('/account-types/export/pdf', async (req, res) => {
    try {
        const { search, category, nature, is_active } = req.query;
        
        // Build where clause
        const whereClause = {};
        if (search) {
            whereClause[require('sequelize').Op.or] = [
                { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { code: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
            ];
        }
        if (category) whereClause.category = category;
        if (nature) whereClause.nature = nature;
        if (is_active !== undefined) whereClause.is_active = is_active === 'true';

        // Build final where clause with company filter (AccountType doesn't have companyId, but we still apply middleware)
        const finalWhere = buildCompanyWhere(req, whereClause);
        // Note: AccountType doesn't have companyId, so filtering is handled at application level
        // For now, we'll skip company filtering for AccountType as per user's request

        // Fetch account types with associations
        const accountTypes = await AccountType.findAll({
            where: finalWhere,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                }
            ],
            order: [['name', 'ASC']]
        });

        // Create export service instance
        const exportService = new ExportService();
        const buffer = await exportService.exportAccountTypesToPDF(accountTypes, req.query);

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="account-types.pdf"');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export account types to PDF' });
    }
});

module.exports = router;