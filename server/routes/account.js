const express = require('express');
const router = express.Router();
const { Account, User, Company, GeneralLedger, AccountType } = require('../models');
const { Op, Sequelize } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ExportService = require('../utils/exportService');
const autoCodeService = require('../utils/autoCodeService');
const sequelize = require('../../config/database');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Helper: Transform Account to view model with camelCase creator/updater
function toAccountViewModel(account) {
    const accountData = account.get ? account.get({ plain: true }) : account;
    return {
        ...accountData,
        creator: accountData.creator ? {
            id: accountData.creator.id,
            firstName: accountData.creator.first_name,
            lastName: accountData.creator.last_name,
            username: accountData.creator.username
        } : null,
        updater: accountData.updater ? {
            id: accountData.updater.id,
            firstName: accountData.updater.first_name,
            lastName: accountData.updater.last_name,
            username: accountData.updater.username
        } : null
    };
}

// Helper: Build tree from flat list
function buildAccountTree(accounts, parentId = null) {
    return accounts
        .filter(acc => acc.parentId === parentId)
        .map(acc => {
            const accountData = toAccountViewModel(acc);
            return {
                ...accountData,
                children: buildAccountTree(accounts, acc.id)
            };
        });
}

// Get all leaf accounts (accounts without children) - MUST COME BEFORE MAIN ROUTE
router.get('/leaf', async (req, res) => {
    try {
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, {
                status: 'active'
            }),
            include: [{
                model: Account,
                as: 'children',
                where: buildCompanyWhere(req, { status: 'active' }),
                required: false
            }],
            order: [['code', 'ASC']]
        });

        // Filter to only include accounts without children (leaf accounts)
        // This includes both type nodes and child accounts that have no children
        const leafAccounts = accounts.filter(account => 
            (!account.children || account.children.length === 0)
        );

        res.json(leafAccounts.map(toAccountViewModel));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch leaf accounts' });
    }
});

// GET /api/accounts/all - Get all accounts as a flat list
router.get('/all', async (req, res) => {
    try {
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, {
                status: 'active'  // Only return active accounts
            }),
            order: [['code', 'ASC']]
        });
        res.json(accounts.map(toAccountViewModel));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
});

// GET /api/accounts - Get all accounts as a tree organized by type
router.get('/', async (req, res) => {
    try {
        const { limit, status } = req.query;
        
        // If query parameters are provided, return flat list for dropdowns (e.g., Tax Code module)
        if (limit || status) {
            const whereClause = {};
            if (status) {
                whereClause.status = status;
            }
            
            const accounts = await Account.findAll({
                where: buildCompanyWhere(req, whereClause),
                limit: limit ? parseInt(limit) : undefined,
                order: [['code', 'ASC']]
            });
            
            return res.json({ accounts: accounts.map(toAccountViewModel) });
        }
        
        // Default behavior: return tree structure
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, {
                status: 'active'  // Only return active accounts
            }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'updatedBy'
                }
            ]
        });

        // Get account types from database
        const { AccountType } = require('../models');
        const accountTypes = await AccountType.findAll({
            where: buildCompanyWhere(req),
            order: [['category', 'ASC'], ['name', 'ASC']]
        });
        
        accountTypes.forEach(at => {
            });

        // Create tree structure with account types as parent nodes
        const tree = accountTypes.map(accountType => {
            // Get accounts for this account type (by account_type_id, not category)
            // This ensures accounts only appear under their specific account type,
            // not all account types with the same category
            // Use get() to access the model attribute, or access directly if it's a plain object
            const typeAccounts = accounts.filter(acc => {
                const accountTypeId = acc.get ? acc.get('account_type_id') : acc.account_type_id;
                return accountTypeId === accountType.id;
            });
            
            // Build tree for accounts of this type
            const accountTree = buildAccountTree(typeAccounts);
            
            return {
                id: `type-${accountType.id}`, // Use account type ID instead of category
                name: accountType.name,
                code: accountType.code || accountType.category,
                type: accountType.category, // Use category for type
                description: accountType.description || `${accountType.category} accounts`,
                isAccountType: true, // Flag to identify account type nodes
                status: 'active',
                children: accountTree,
                accountCount: typeAccounts.length,
                accountTypeId: accountType.id // Include the actual account type ID
            };
        });
        
        tree.forEach(node => {
            });

        res.json(tree);
    } catch (err) {
        if (err && err.stack) {
            }
        res.status(500).json({ error: 'Failed to fetch accounts', details: err.message });
    }
});

// POST /api/accounts - Create account
router.post('/', csrfProtection, csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and account creation
    const transaction = await sequelize.transaction();
    
    try {
        const { name, parentId, type, accountTypeId } = req.body;
        
        // Validate required fields
        if (!name || typeof name !== 'string' || name.trim() === '') {
            await transaction.rollback();
            return res.status(400).json({ error: 'Account name is required.' });
        }
        
        // Validate account type
        if (!accountTypeId) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Account type is required.' });
        }
        
        // Get account type to determine nature
        const { AccountType } = require('../models');
        const accountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id: accountTypeId }),
            transaction
        });
        if (!accountType) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Invalid account type.' });
        }
        
        // Determine nature based on account type or parent account
        let nature = accountType.nature; // Use nature from account type
        
        if (parentId) {
            // If parent account exists, inherit nature from parent
            const parentAccount = await Account.findOne({ 
                where: buildCompanyWhere(req, { id: parentId }),
                transaction
            });
            if (parentAccount) {
                nature = parentAccount.nature;
            }
        }

        // Get company code for code generation
        let companyCode = 'EMZ';
        try {
            const company = await Company.findByPk(req.user.companyId, {
                attributes: ['code', 'name'],
                transaction
            });
            
            if (company?.code) {
                companyCode = company.code.toUpperCase();
            } else if (company?.name) {
                companyCode = company.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMZ';
            }
        } catch (companyError) {
            // Continue with default companyCode
        }

        // Auto-generate account code
        const code = await autoCodeService.generateNextCode(
            'accounts',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'ACC',
                fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
                companyCode: companyCode
            }
        );
        
        const accountData = {
            ...req.body,
            account_type_id: accountTypeId, // Explicitly map to the model field name
            type: accountType.category, // CRITICAL: Set type from account type's category to ensure correct tree placement
            code: code.trim(),
            nature: nature,
            createdBy: req.user.id,
            companyId: req.user.companyId
        };
        
        const account = await Account.create(accountData, { transaction });

        // Commit transaction
        await transaction.commit();
        
        // Fetch the created account with creator and updater info
        const createdAccount = await Account.findByPk(account.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'updatedBy'
                }
            ]
        });
        
        res.status(201).json(toAccountViewModel(createdAccount));
    } catch (err) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/accounts/:id - Update account
router.put('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { name, parentId, type, accountTypeId } = req.body;
        
        // Validate required fields
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Account name is required.' });
        }
        
        // Validate account type
        if (!accountTypeId) {
            return res.status(400).json({ error: 'Account type is required.' });
        }
        
        const account = await Account.findOne({ 
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!account) return res.status(404).json({ error: 'Account not found' });
        
        // Get account type to determine nature
        const { AccountType } = require('../models');
        const accountType = await AccountType.findOne({
            where: buildCompanyWhere(req, { id: accountTypeId })
        });
        if (!accountType) {
            return res.status(400).json({ error: 'Invalid account type.' });
        }
        
        // Determine nature based on account type or parent account
        let nature = accountType.nature; // Use nature from account type
        
        if (parentId !== account.parentId) {
            // Parent changed, recalculate nature
            if (parentId) {
                // If new parent account exists, inherit nature from parent
                const parentAccount = await Account.findOne({ 
                    where: buildCompanyWhere(req, { id: parentId })
                });
                if (parentAccount) {
                    nature = parentAccount.nature;
                }
            }
        }
        
        // Update account (code is auto-generated and cannot be changed)
        await account.update({ 
            name,
            parentId,
            type: accountType.category, // CRITICAL: Set type from account type's category to ensure correct tree placement
            account_type_id: accountTypeId, // Explicitly map to the model field name
            // Code is auto-generated and read-only - do not update it
            nature: nature,
            updatedBy: req.user.id
        });
        
        // Fetch the updated account with creator and updater info
        const updatedAccount = await Account.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'updatedBy'
                }
            ]
        });
        
        res.json(toAccountViewModel(updatedAccount));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/accounts/:id - Delete account
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const account = await Account.findOne({ 
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!account) return res.status(404).json({ error: 'Account not found' });
        await account.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Export endpoints
// GET /api/accounts/export/excel - Export accounts to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, type, status } = req.query;
        
        // Build where clause
        const whereClause = {};
        if (search) {
            whereClause[require('sequelize').Op.or] = [
                { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { code: { [require('sequelize').Op.iLike]: `%${search}%` } }
            ];
        }
        if (type) whereClause.type = type;
        if (status) whereClause.status = status;

        // Fetch accounts with associations
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'updatedBy'
                }
            ],
            order: [['code', 'ASC']]
        });

        // Build tree structure
        const accountTree = buildAccountTree(accounts);

        // Create export service instance
        const exportService = new ExportService();
        const buffer = await exportService.exportAccountsToExcel(accountTree, req.query);

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="chart-of-accounts.xlsx"');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export accounts to Excel' });
    }
});

// GET /api/accounts/export/pdf - Export accounts to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, type, status } = req.query;
        
        // Build where clause
        const whereClause = {};
        if (search) {
            whereClause[require('sequelize').Op.or] = [
                { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
                { code: { [require('sequelize').Op.iLike]: `%${search}%` } }
            ];
        }
        if (type) whereClause.type = type;
        if (status) whereClause.status = status;

        // Fetch accounts with associations
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    foreignKey: 'updatedBy'
                }
            ],
            order: [['code', 'ASC']]
        });

        // Build tree structure
        const accountTree = buildAccountTree(accounts);

        // Create export service instance
        const exportService = new ExportService();
        const buffer = await exportService.exportAccountsToPDF(accountTree, req.query);

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="chart-of-accounts.pdf"');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export accounts to PDF' });
    }
});

// GET /api/accounts/dashboard-statistics - Get dashboard statistics from General Ledger
router.get('/dashboard-statistics', async (req, res) => {
    try {
        const companyWhere = buildCompanyWhere(req, {});
        
        // CRITICAL: Ensure companyId is always in the where clause
        if (!req.user.isSystemAdmin && req.user.companyId) {
            companyWhere.companyId = req.user.companyId;
        }

        // Get total debit and credit from General Ledger (using equivalent amounts)
        // Use raw query for aggregation to ensure correct results
        let glTotalsQuery = `
            SELECT 
                COALESCE(SUM(COALESCE(equivalent_debit_amount, 0)), 0) as "totalDebit",
                COALESCE(SUM(COALESCE(equivalent_credit_amount, 0)), 0) as "totalCredit"
            FROM general_ledger
        `;
        
        const glReplacements = {};
        if (!req.user.isSystemAdmin && req.user.companyId) {
            glTotalsQuery += ` WHERE "companyId" = :companyId`;
            glReplacements.companyId = req.user.companyId;
        }
        
        const [glTotals] = await sequelize.query(glTotalsQuery, {
            replacements: glReplacements,
            type: sequelize.QueryTypes.SELECT
        });

        const totalDebitAmount = parseFloat(glTotals?.totalDebit || 0);
        const totalCreditAmount = parseFloat(glTotals?.totalCredit || 0);
        const delta = totalDebitAmount - totalCreditAmount;

        // Get expense account type IDs
        const expenseAccountTypes = await AccountType.findAll({
            where: buildCompanyWhere(req, {
                category: 'EXPENSE',
                is_active: true
            }),
            attributes: ['id'],
            raw: true
        });

        const expenseAccountTypeIds = expenseAccountTypes.map(at => at.id);

        // Get total expenses from General Ledger for expense account types
        let totalExpenses = 0;
        if (expenseAccountTypeIds.length > 0) {
            // Use raw query for aggregation with IN clause
            const placeholders = expenseAccountTypeIds.map((_, index) => `:expenseId${index}`).join(', ');
            let expenseTotalsQuery = `
                SELECT 
                    COALESCE(SUM(COALESCE(equivalent_debit_amount, 0)), 0) as "totalExpenses"
                FROM general_ledger
            `;
            
            const expenseReplacements = {};
            const whereConditions = [];
            
            if (!req.user.isSystemAdmin && req.user.companyId) {
                whereConditions.push(`"companyId" = :companyId`);
                expenseReplacements.companyId = req.user.companyId;
            }
            
            whereConditions.push(`account_type_id IN (${placeholders})`);
            expenseAccountTypeIds.forEach((id, index) => {
                expenseReplacements[`expenseId${index}`] = id;
            });
            
            if (whereConditions.length > 0) {
                expenseTotalsQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            }
            
            const [expenseTotals] = await sequelize.query(expenseTotalsQuery, {
                replacements: expenseReplacements,
                type: sequelize.QueryTypes.SELECT
            });

            totalExpenses = parseFloat(expenseTotals?.totalExpenses || 0);
        }

        res.json({
            totalDebitAmount,
            totalCreditAmount,
            delta,
            totalExpenses
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch dashboard statistics',
            details: error.message 
        });
    }
});

module.exports = router; 