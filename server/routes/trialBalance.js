const express = require('express');
const router = express.Router();
const { Sequelize, Op } = require('sequelize');

const { 
    Account, 
    FinancialYear, 
    Currency, 
    User,
    GeneralLedger,
    AccountType
} = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const sequelize = require('../../config/database');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Simple ping route to test if the file is loaded (NO AUTH)
router.get('/ping', (req, res) => {
    res.json({ message: 'Trial balance ping successful!', timestamp: new Date().toISOString() });
});

// Simple test route without auth
router.get('/test-no-auth', (req, res) => {
    res.json({ message: 'Trial balance test-no-auth successful!', timestamp: new Date().toISOString() });
});

/**
 * GET /api/trial-balance
 * Returns trial balance data from GeneralLedger
 */
router.get('/', async (req, res) => {
    try {
        const {
            financialYearId,
            includeZeroBalances = 'true',
            includeInactive = 'false',
            startDate,
            endDate,
            format = 'tree'
        } = req.query;

        if (!financialYearId) {
            return res.status(400).json({ error: 'Missing required parameter: financialYearId' });
        }

        // Get financial year
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: financialYearId })
        });
        if (!financialYear) {
            return res.status(404).json({ error: 'Financial year not found' });
        }

        // Build where clause for GL
        const whereClause = { financial_year_id: financialYearId };
        if (startDate || endDate) {
            whereClause.transaction_date = {};
            if (startDate) whereClause.transaction_date[Op.gte] = new Date(startDate);
            if (endDate) whereClause.transaction_date[Op.lte] = new Date(endDate);
        }

        // Query GL for account balances
        const glRows = await GeneralLedger.findAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: [
                'account_id',
                'account_name',
                'account_code',
                'account_type_id',
                'account_type_code',
                'account_type_name',
                'account_nature',
                [sequelize.fn('SUM', sequelize.col('debit_amount_equivalent')), 'total_debit'],
                [sequelize.fn('SUM', sequelize.col('credit_amount_equivalent')), 'total_credit']
            ],
            group: [
                'account_id',
                'account_name',
                'account_code',
                'account_type_id',
                'account_type_code',
                'account_type_name',
                'account_nature'
            ],
            order: [['account_code', 'ASC']]
        });

        // Map accountId -> balance
        const accountBalances = new Map();
        glRows.forEach(row => {
            const totalDebit = parseFloat(row.dataValues.total_debit || 0);
            const totalCredit = parseFloat(row.dataValues.total_credit || 0);
            const net = totalDebit - totalCredit;
            accountBalances.set(row.account_id, {
                id: row.account_id,
                code: row.account_code,
                name: row.account_name,
                type: row.account_type_code,
                nature: row.account_nature,
                accountTypeId: row.account_type_id,
                totals: {
                    debit: totalDebit,
                    credit: totalCredit,
                    runningBalance: net,
                    normalBalance: net
                },
                children: []
            });
        });

        // Get all accounts for hierarchy
        const allAccounts = await Account.findAll({
            where: buildCompanyWhere(req, {
                ...(includeInactive === 'false' && { is_active: true })
            }),
            include: [{
                model: AccountType,
                as: 'accountType',
                attributes: ['id', 'name', 'code', 'type', 'nature']
            }],
            order: [['code', 'ASC']]
        });

        // Add zero-balance accounts if requested
        if (includeZeroBalances === 'true') {
            allAccounts.forEach(account => {
                if (!accountBalances.has(account.id)) {
                    accountBalances.set(account.id, {
                        id: account.id,
                        code: account.code,
                        name: account.name,
                        type: account.accountType?.code || 'UNKNOWN',
                        nature: account.accountType?.nature || 'debit',
                        accountTypeId: account.accountTypeId,
                        totals: {
                            debit: 0,
                            credit: 0,
                            runningBalance: 0,
                            normalBalance: 0
                        },
                        children: []
                    });
                }
            });
        }

        // Group by account type
        const accountTypeMap = new Map();
        allAccounts.forEach(account => {
            const acc = accountBalances.get(account.id);
            if (!acc) return;
            const typeId = account.accountTypeId;
            if (!typeId) return;
            if (!accountTypeMap.has(typeId)) {
                accountTypeMap.set(typeId, {
                    id: typeId,
                    code: account.accountType?.code || 'UNKNOWN',
                    name: account.accountType?.name || 'Unknown',
                    type: account.accountType?.type || 'UNKNOWN',
                    nature: account.accountType?.nature || 'debit',
                    totals: {
                        debit: 0,
                        credit: 0,
                        runningBalance: 0,
                        normalBalance: 0
                    },
                    children: []
                });
            }
            const typeObj = accountTypeMap.get(typeId);
            typeObj.children.push(acc);
            typeObj.totals.debit += acc.totals.debit;
            typeObj.totals.credit += acc.totals.credit;
            typeObj.totals.runningBalance += acc.totals.runningBalance;
            typeObj.totals.normalBalance += acc.totals.normalBalance;
        });
        const accounts = Array.from(accountTypeMap.values()).sort((a, b) => a.code.localeCompare(b.code));

        // Summary
        const summary = {
            totalDebit: accounts.reduce((sum, a) => sum + a.totals.debit, 0),
            totalCredit: accounts.reduce((sum, a) => sum + a.totals.credit, 0),
            difference: 0,
            isBalanced: true
        };
        summary.difference = summary.totalDebit - summary.totalCredit;
        summary.isBalanced = Math.abs(summary.difference) < 0.01;

        // Metadata
        const defaultCurrency = await Currency.findOne({ 
            where: buildCompanyWhere(req, { is_default: true })
        });
        const metadata = {
            financialYear: {
                id: financialYear.id,
                name: financialYear.name,
                startDate: financialYear.startDate,
                endDate: financialYear.endDate,
                currency: defaultCurrency ? {
                    code: defaultCurrency.code,
                    name: defaultCurrency.name,
                    symbol: defaultCurrency.symbol
                } : null
            },
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
                format
            }
        };

        res.json({ accounts, summary, metadata });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// Keep the /test route for diagnostics
router.get('/test', async (req, res) => {
    res.json({ 
        message: 'Trial balance test route is working!',
        timestamp: new Date().toISOString()
    });
});

module.exports = router; 