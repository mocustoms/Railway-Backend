const express = require('express');
const router = express.Router();
const { Sequelize, Op } = require('sequelize');

const { 
    Account, 
    FinancialYear, 
    Currency, 
    GeneralLedger,
    AccountType
} = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const sequelize = require('../../config/database');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId);

/**
 * Helper: Build account tree with balances
 */
function buildAccountTreeWithBalances(accounts, balances, parentId = null, level = 0) {
    return accounts
        .filter(acc => {
            // Handle null/undefined parentId comparison
            const accParentId = acc.parentId ? String(acc.parentId) : null;
            const filterParentId = parentId ? String(parentId) : null;
            return accParentId === filterParentId;
        })
        .map(acc => {
            // Ensure we use string ID for Map lookup
            const accountId = String(acc.id);
            const accountBalance = balances.get(accountId) || {
                debit: 0,
                credit: 0
            };
            
            // Build children recursively
            const children = buildAccountTreeWithBalances(accounts, balances, acc.id, level + 1);
            
            // Calculate totals including children
            const childTotals = children.reduce((sum, child) => ({
                debit: sum.debit + child.totalDebit,
                credit: sum.credit + child.totalCredit
            }), { debit: 0, credit: 0 });
            
            const totalDebit = accountBalance.debit + childTotals.debit;
            const totalCredit = accountBalance.credit + childTotals.credit;
            
            return {
                id: acc.id,
                code: acc.code,
                name: acc.name,
                type: acc.type,
                nature: acc.nature,
                accountTypeId: acc.accountTypeId,
                parentId: acc.parentId,
                level: level,
                isLeaf: children.length === 0,
                accountBalance: {
                    debit: accountBalance.debit,
                    credit: accountBalance.credit
                },
                totalDebit: totalDebit,
                totalCredit: totalCredit,
                children: children
            };
        });
}

/**
 * GET /api/trial-balance-report
 * Returns trial balance with full hierarchical structure
 */
router.get('/', async (req, res) => {
    try {
        const {
            financialYearId,
            includeZeroBalances = 'true',
            includeInactive = 'false',
            startDate,
            endDate,
            accountTypeId
        } = req.query;

        if (!financialYearId) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing required parameter: financialYearId' 
            });
        }

        // Get financial year
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: financialYearId })
        });
        if (!financialYear) {
            return res.status(404).json({ 
                success: false,
                error: 'Financial year not found' 
            });
        }

        // Build where clause for GL
        const whereClause = { financial_year_id: financialYearId };
        if (startDate || endDate) {
            whereClause.transaction_date = {};
            if (startDate) whereClause.transaction_date[Op.gte] = new Date(startDate);
            if (endDate) whereClause.transaction_date[Op.lte] = new Date(endDate);
        }

        // Query GL for account balances
        // Handle NULL values: SUM of NULL returns NULL, so we use COALESCE
        // equivalent_debit_amount and equivalent_credit_amount are nullable DECIMAL fields
        const glRows = await GeneralLedger.findAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: [
                'account_id',
                [
                    sequelize.fn(
                        'COALESCE',
                        sequelize.fn('SUM', sequelize.fn('COALESCE', sequelize.col('equivalent_debit_amount'), 0)),
                        0
                    ),
                    'total_debit'
                ],
                [
                    sequelize.fn(
                        'COALESCE',
                        sequelize.fn('SUM', sequelize.fn('COALESCE', sequelize.col('equivalent_credit_amount'), 0)),
                        0
                    ),
                    'total_credit'
                ]
            ],
            group: ['account_id'],
            raw: true
        });

        // Map accountId -> balance
        const accountBalances = new Map();
        const glAccountIds = []; // Collect all account IDs from GL
        glRows.forEach(row => {
            // Ensure we parse the values correctly (they come as strings from DECIMAL)
            const debit = parseFloat(row.total_debit) || 0;
            const credit = parseFloat(row.total_credit) || 0;
            
            // Store balance using account_id as key (UUID string)
            // Ensure we convert to string for consistent Map key matching
            const accountId = String(row.account_id);
            accountBalances.set(accountId, {
                debit: debit,
                credit: credit
            });
            glAccountIds.push(row.account_id); // Collect account IDs from GL
        });

        // Get all accounts with hierarchy
        // CRITICAL: Include accounts that are referenced in GL records, even if they're in a different company
        // This handles data integrity issues where GL records might reference accounts from other companies
        // We need accounts that are either:
        // 1. In the user's company (standard multi-tenant filtering), OR
        // 2. Referenced in GL records for this financial year (to show balances)
        const baseFilters = {};
        if (includeInactive === 'false') {
            baseFilters.status = 'active';
        }
        if (accountTypeId && accountTypeId !== 'all') {
            baseFilters.account_type_id = accountTypeId;
        }

        let finalAccountWhere;
        if (glAccountIds.length > 0) {
            // Build OR condition: (companyId match) OR (account ID in GL)
            const companyWhere = buildCompanyWhere(req, baseFilters);
            finalAccountWhere = {
                [Op.or]: [
                    companyWhere,
                    { 
                        id: { [Op.in]: glAccountIds },
                        ...baseFilters
                    }
                ]
            };
        } else {
            // No GL records, use standard company filtering
            finalAccountWhere = buildCompanyWhere(req, baseFilters);
        }

        const allAccounts = await Account.findAll({
            where: finalAccountWhere,
            include: [{
                model: AccountType,
                as: 'accountType',
                attributes: ['id', 'name', 'code', 'category', 'nature']
            }],
            order: [['code', 'ASC']],
            raw: false // Keep as Sequelize instances to access relationships
        });

        // Transform accounts to plain objects with all required fields
        // Account model: property 'account_type_id' maps to DB column 'accountTypeId'
        // When using Sequelize instances (raw: false), use model property name: account_type_id
        const transformedAccounts = allAccounts.map(account => {
            // Get accountTypeId - try multiple ways to access it from Sequelize instance
            // Model property is 'account_type_id', DB field is 'accountTypeId'
            const accountTypeId = account.account_type_id || 
                                  account.accountTypeId ||
                                  (account.get ? account.get('account_type_id') : null) ||
                                  (account.get ? account.get('accountTypeId') : null) ||
                                  (account.dataValues && account.dataValues.accountTypeId) ||
                                  (account.dataValues && account.dataValues.account_type_id) ||
                                  null;
            
            // Get parentId - model property is 'parentId', DB column is also 'parentId'
            const parentId = account.parentId || 
                            (account.get ? account.get('parentId') : null) ||
                            (account.dataValues && account.dataValues.parentId) ||
                            null;
            
            return {
                id: account.id,
                code: account.code,
                name: account.name,
                type: account.type,
                nature: account.nature,
                accountTypeId: accountTypeId,
                parentId: parentId,
                status: account.status,
                isAccountType: false
            };
        });

        // Add zero-balance accounts if requested
        if (includeZeroBalances === 'true') {
            transformedAccounts.forEach(account => {
                // Ensure we use string ID for Map lookup
                const accountId = String(account.id);
                if (!accountBalances.has(accountId)) {
                    accountBalances.set(accountId, {
                        debit: 0,
                        credit: 0
                    });
                }
            });
        }

        // Group accounts by Account Type
        const accountTypeMap = new Map();
        
        // First, get all account types
        const accountTypes = await AccountType.findAll({
            where: buildCompanyWhere(req, {
                ...(includeInactive === 'false' && { is_active: true })
            }),
            order: [['code', 'ASC']]
        });

        // Initialize account type map
        accountTypes.forEach(at => {
            if (!accountTypeMap.has(at.id)) {
                accountTypeMap.set(at.id, {
                    id: `account-type-${at.id}`, // Unique ID for account type
                    code: at.code || '',
                    name: at.name,
                    type: at.category || at.name,
                    category: at.category,
                    nature: at.nature,
                    accountTypeId: at.id,
                    parentId: null,
                    level: 0,
                    isLeaf: false,
                    isAccountType: true,
                    accountBalance: {
                        debit: 0,
                        credit: 0
                    },
                    totalDebit: 0,
                    totalCredit: 0,
                    children: []
                });
            }
        });

        // Group accounts by account type and build tree
        // Note: Accounts are already transformed above, so we use transformedAccounts

        // Build tree for each account type
        const result = [];
        for (const [typeId, accountType] of accountTypeMap) {
            // Get accounts for this type - compare with both UUID and string
            const typeAccounts = transformedAccounts.filter(acc => {
                if (!acc.accountTypeId) return false;
                // Compare as strings to handle UUID comparison
                // typeId is the account type ID from the map key
                return String(acc.accountTypeId) === String(typeId);
            });
            
            // Always include account types that have accounts, even if balances are zero
            // Only skip if includeZeroBalances is false AND no accounts exist for this type
            if (typeAccounts.length === 0 && includeZeroBalances === 'false') {
                continue;
            }
            
            // Build tree structure
            const accountTree = buildAccountTreeWithBalances(typeAccounts, accountBalances, null, 1);
            
            // Calculate totals for account type
            const typeTotals = accountTree.reduce((sum, account) => ({
                debit: sum.debit + account.totalDebit,
                credit: sum.credit + account.totalCredit
            }), { debit: 0, credit: 0 });
            
            accountType.totalDebit = typeTotals.debit;
            accountType.totalCredit = typeTotals.credit;
            accountType.children = accountTree;
            
            // Only include account types that have accounts OR if includeZeroBalances is true
            if (accountTree.length > 0 || includeZeroBalances === 'true') {
                result.push(accountType);
            }
        }

        // Calculate grand totals
        const grandTotals = result.reduce((sum, accountType) => ({
            debit: sum.debit + accountType.totalDebit,
            credit: sum.credit + accountType.totalCredit
        }), { debit: 0, credit: 0 });

        const difference = grandTotals.debit - grandTotals.credit;
        const isBalanced = Math.abs(difference) < 0.01;

        // Get default currency
        const defaultCurrency = await Currency.findOne({ 
            where: buildCompanyWhere(req, { is_default: true })
        });

        // Metadata
        const metadata = {
            financialYear: {
                id: financialYear.id,
                name: financialYear.name,
                code: financialYear.code,
                startDate: financialYear.startDate,
                endDate: financialYear.endDate
            },
            currency: defaultCurrency ? {
                id: defaultCurrency.id,
                code: defaultCurrency.code,
                name: defaultCurrency.name,
                symbol: defaultCurrency.symbol
            } : null,
            generatedAt: new Date().toISOString(),
            generatedBy: {
                id: req.user.id,
                name: `${req.user.first_name} ${req.user.last_name}`,
                username: req.user.username
            },
            filters: {
                financialYearId,
                includeZeroBalances: includeZeroBalances === 'true',
                includeInactive: includeInactive === 'true',
                startDate,
                endDate,
                accountTypeId
            }
        };

        res.json({
            success: true,
            data: result,
            summary: {
                totalDebit: grandTotals.debit,
                totalCredit: grandTotals.credit,
                difference: difference,
                isBalanced: isBalanced
            },
            metadata
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch trial balance report',
            details: error.message 
        });
    }
});

module.exports = router;

