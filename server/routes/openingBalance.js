const express = require('express');
const router = express.Router();
const { OpeningBalance, User, Account, AccountType, Currency, ExchangeRate, FinancialYear, TransactionType, Company, GeneralLedger } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { Op, Sequelize } = require('sequelize');
const sequelize = require('../../config/database');
const { createGeneralLedgerEntry, updateGeneralLedgerEntry, deleteGeneralLedgerEntry } = require('../utils/generalLedgerHelper');
const ExportService = require('../utils/exportService');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all opening balances with account details
router.get('/', async (req, res) => {
    try {
        // Ensure user has companyId (unless super-admin)
        if (!req.user || (!req.user.isSystemAdmin && !req.user.companyId)) {
            return res.status(403).json({ error: 'Company access required' });
        }

        const { 
            page = 1, 
            limit = 25, 
            search = '', 
            sortBy = 'createdAt', 
            sortOrder = 'DESC',
            financialYearId = null,
            accountType = null,
            type = null
        } = req.query;

        // Build where clause for search and filters
        const whereClause = {};
        
        // Add financial year filter
        if (financialYearId) {
            whereClause.financialYearId = financialYearId;
        }

        // Add account type filter
        if (accountType) {
            whereClause['$account.type$'] = accountType;
        }

        // Add balance type filter (debit/credit)
        if (type) {
            whereClause.type = type;
        }
        
        if (search) {
            whereClause[Op.or] = [
                { description: { [Op.iLike]: `%${search}%` } },
                { '$account.name$': { [Op.iLike]: `%${search}%` } },
                { '$account.code$': { [Op.iLike]: `%${search}%` } },
                { '$currency.code$': { [Op.iLike]: `%${search}%` } },
                { '$financialYear.name$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Build order clause for sorting
        let orderClause = [];
        const validSortFields = [
            'account', 'account_code', 'account_type', 'type', 'date', 'description', 'amount',
            'currency', 'exchange_rate', 'financial_year', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'
        ];

        if (validSortFields.includes(sortBy)) {
            // Map frontend sort fields to database fields
            const sortFieldMap = {
                'account': [['account', 'name', sortOrder]],
                'account_code': [['account', 'code', sortOrder]],
                'account_type': [['account', 'type', sortOrder]],
                'type': [['type', sortOrder]],
                'date': [['date', sortOrder]],
                'description': [['description', sortOrder]],
                'amount': [['amount', sortOrder]],
                'currency': [['currency', 'code', sortOrder]],
                'exchange_rate': [['exchangeRate', sortOrder]],
                'financial_year': [['financialYear', 'name', sortOrder]],
                'createdBy': [['creator', 'first_name', sortOrder]],
                'createdAt': [['createdAt', sortOrder]],
                'updatedBy': [['updater', 'first_name', sortOrder]],
                'updatedAt': [['updatedAt', sortOrder]]
            };

            orderClause = sortFieldMap[sortBy] || [['createdAt', 'DESC']];
        } else {
            orderClause = [['createdAt', 'DESC']];
        }

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: openingBalances } = await OpeningBalance.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['id', 'name', 'code', 'type']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: ExchangeRate,
                    as: 'exchangeRateRecord',
                    attributes: ['id', 'rate', 'effective_date']
                },
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                },
                {
                    model: AccountType,
                    as: 'accountType',
                    attributes: ['id', 'name', 'code', 'description']
                }
            ],
            order: orderClause,
            limit: parseInt(limit),
            offset: offset
        });

        const totalPages = Math.ceil(count / parseInt(limit));

        res.json({
            openingBalances,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems: count,
                itemsPerPage: parseInt(limit),
                hasNextPage: parseInt(page) < totalPages,
                hasPrevPage: parseInt(page) > 1
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch opening balances', details: error.message });
    }
});

// Get available currencies for opening balances
router.get('/currencies', async (req, res) => {
    try {
        const currencies = await Currency.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            attributes: ['id', 'code', 'name', 'symbol', 'is_default'],
            order: [['code', 'ASC']]
        });
        
        res.json(currencies);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch currencies' });
    }
});

// Get available financial years for opening balances
router.get('/financial-years', async (req, res) => {
    try {
        const financialYears = await FinancialYear.findAll({
            where: buildCompanyWhere(req, { isActive: true }),
            attributes: ['id', 'name', 'startDate', 'endDate', 'isCurrent'],
            order: [['startDate', 'DESC']]
        });
        
        res.json(financialYears);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch financial years' });
    }
});

// Get accounts without opening balances
router.get('/accounts/without-balances', async (req, res) => {
    try {
        const { financialYearId } = req.query;
        
        // Get leaf accounts without opening balances for the specified financial year
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, { status: 'active' }),
            order: [['name', 'ASC']]
        });

        // Get accounts that already have opening balances for the specified financial year
        const accountsWithBalances = await OpeningBalance.findAll({
            where: buildCompanyWhere(req, { 
                financialYearId: financialYearId || null
            }),
            attributes: ['accountId']
        });

        const accountIdsWithBalances = accountsWithBalances.map(ob => ob.accountId);
        
        // Filter accounts without opening balances
        const accountsWithoutBalances = accounts.filter(account => 
            !accountIdsWithBalances.includes(account.id)
        );
        
        // Get all account IDs that have children (parent accounts)
        const parentAccountIds = accounts
            .filter(account => account.parentId !== null)
            .map(account => account.parentId);
        
        // Filter for leaf accounts only (accounts without children)
        const leafAccountsWithoutBalances = accountsWithoutBalances.filter(account => 
            !parentAccountIds.includes(account.id)
        );
        
        res.json(leafAccountsWithoutBalances);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch accounts without balances' });
    }
});

// Get all accounts (for editing)
router.get('/accounts/all', async (req, res) => {
    try {
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, { status: 'active' }),
            order: [['name', 'ASC']]
        });
        
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
});

// Get exchange rates for a specific currency
router.get('/exchange-rates/:currencyId', async (req, res) => {
    try {
        const { currencyId } = req.params;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(currencyId)) {
            return res.status(400).json({ error: 'Invalid currencyId format' });
        }

        // Get the requested currency
        const fromCurrency = await Currency.findOne({
            where: buildCompanyWhere(req, { id: currencyId })
        });
        if (!fromCurrency) {
            return res.status(404).json({ error: 'Currency not found' });
        }

        // Get the default/base currency
        const baseCurrency = await Currency.findOne({
            where: buildCompanyWhere(req, { is_default: true })
        });
        if (!baseCurrency) {
            return res.status(404).json({ error: 'Base currency not found' });
        }

        // If the selected currency is the default, rate is 1
        if (fromCurrency.id === baseCurrency.id) {
            return res.json([{ rate: 1.0, from_currency_id: fromCurrency.id, to_currency_id: baseCurrency.id }]);
        }

        // Get exchange rates from the specified currency to base currency
        const exchangeRates = await ExchangeRate.findAll({
            where: buildCompanyWhere(req, {
                from_currency_id: fromCurrency.id,
                to_currency_id: baseCurrency.id,
                is_active: true
            }),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                }
            ],
            order: [['effective_date', 'DESC']]
        });

        res.json(exchangeRates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exchange rates' });
    }
});

// Get opening balance statistics
router.get('/statistics', async (req, res) => {
    try {
        // Get total count of opening balances
        const totalOpeningBalances = await OpeningBalance.count({
            where: buildCompanyWhere(req)
        });

        // Get total debit amount (equivalent amount in default currency)
        const debitStats = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { type: 'debit' }),
            attributes: [
                [Sequelize.fn('SUM', Sequelize.col('equivalentAmount')), 'totalDebitAmount']
            ],
            raw: true
        });

        // Get total credit amount (equivalent amount in default currency)
        const creditStats = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { type: 'credit' }),
            attributes: [
                [Sequelize.fn('SUM', Sequelize.col('equivalentAmount')), 'totalCreditAmount']
            ],
            raw: true
        });

        // Get count of active financial years (with company filter)
        const financialYearWhere = {
            isActive: true,
            ...buildCompanyWhere(req)
        };
        if (!req.user.isSystemAdmin && req.user.companyId) {
            financialYearWhere.companyId = req.user.companyId;
        }
        const activeFinancialYears = await FinancialYear.count({
            where: financialYearWhere
        });

        // Calculate amounts (handle null values)
        const totalDebitAmount = parseFloat(debitStats?.totalDebitAmount || 0);
        const totalCreditAmount = parseFloat(creditStats?.totalCreditAmount || 0);
        
        // Calculate delta (credit - debit)
        const delta = totalCreditAmount - totalDebitAmount;

        res.json({
            totalOpeningBalances,
            totalDebitAmount,
            totalCreditAmount,
            activeFinancialYears,
            delta
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Check if opening balance exists for account and financial year
router.get('/check-exists', async (req, res) => {
    try {
        const { accountId, financialYearId } = req.query;
        
        if (!accountId) {
            return res.status(400).json({ error: 'Account ID is required' });
        }

        const existingBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { 
                accountId,
                financialYearId: financialYearId || null
            }),
            attributes: ['id', 'accountId', 'financialYearId', 'amount', 'type', 'date']
        });

        res.json({ 
            exists: !!existingBalance,
            openingBalance: existingBalance || null
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check opening balance existence', details: error.message });
    }
});

// Get opening balance by ID
router.get('/:id', async (req, res) => {
    try {
        const openingBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['id', 'name', 'code', 'type']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: ExchangeRate,
                    as: 'exchangeRateRecord',
                    attributes: ['id', 'rate', 'effective_date']
                },
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                },
                {
                    model: AccountType,
                    as: 'accountType',
                    attributes: ['id', 'name', 'code', 'description']
                }
            ]
        });

        if (!openingBalance) {
            return res.status(404).json({ error: 'Opening balance not found' });
        }

        res.json(openingBalance);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch opening balance' });
    }
});

// Create new opening balance
router.post('/', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { 
            accountId, 
            amount, 
            originalAmount,
            type, 
            nature, 
            date, 
            description,
            currencyId,
            exchangeRateId,
            exchangeRate,
            financialYearId
        } = req.body;

        // Validate required fields
        if (!accountId || amount === undefined || !type || !date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check if account exists and get account type
        const account = await Account.findOne({
            where: buildCompanyWhere(req, { id: accountId }),
            include: [{
                model: AccountType,
                as: 'accountType',
                attributes: ['id', 'name', 'code']
            }]
        });
        if (!account) {
            return res.status(400).json({ error: 'Account not found' });
        }

        // Check if opening balance already exists for this account and financial year
        const existingBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { 
                accountId,
                financialYearId: financialYearId || null
            })
        });

        if (existingBalance) {
            return res.status(400).json({ error: 'Opening balance already exists for this account and financial year' });
        }

        // Convert type to lowercase to match enum values
        const normalizedType = type.toLowerCase();
        
        // Use nature if provided, otherwise use type converted to uppercase
        const natureValue = nature || type.toUpperCase();

        // If currency is provided, validate it exists
        if (currencyId) {
            const currency = await Currency.findOne({
                where: buildCompanyWhere(req, { id: currencyId })
            });
            if (!currency) {
                return res.status(400).json({ error: 'Currency not found' });
            }
        }

        // If exchange rate is provided, validate it exists
        if (exchangeRateId) {
            const exchangeRateRecord = await ExchangeRate.findOne({
                where: buildCompanyWhere(req, { id: exchangeRateId })
            });
            if (!exchangeRateRecord) {
                return res.status(400).json({ error: 'Exchange rate not found' });
            }
        }

        // If financial year is provided, validate it exists
        if (financialYearId) {
            const financialYear = await FinancialYear.findOne({
                where: buildCompanyWhere(req, { id: financialYearId })
            });
            if (!financialYear) {
                return res.status(400).json({ error: 'Financial year not found' });
            }
        }

        // Get the "Opening Balances" transaction type (GLOBAL - no company filter)
        let transactionType = await TransactionType.findOne({
            where: { name: 'Opening Balances' }
        });
        
        // If not found, try alternative names
        if (!transactionType) {
            transactionType = await TransactionType.findOne({
                where: { 
                    [Op.or]: [
                        { name: 'Opening Balance' },
                        { name: 'Opening Balances' },
                        { name: 'OB' },
                        { name: 'Initial Balance' }
                    ]
                }
            });
        }
        
        // If still not found, create a default one (GLOBAL - no companyId required)
        if (!transactionType) {
            try {
                transactionType = await TransactionType.create({
                    name: 'Opening Balances',
                    description: 'Default transaction type for opening balance entries',
                    isActive: true,
                    companyId: null // Global - no company association
                });
            } catch (createError) {
                return res.status(500).json({ error: 'Failed to create Opening Balances transaction type', details: createError.message });
            }
        }

        // Get company info
        const company = await Company.findOne({
            where: { id: req.user.companyId }
        });
        let companyCode = 'EMZ';
        if (company && company.code) {
            companyCode = company.code.toUpperCase();
        } else if (company && company.name) {
            companyCode = company.name.substring(0, 3).toUpperCase();
        }

        // Get financial year info
        const finYearCode = financialYearId
            ? await FinancialYear.findOne({
                where: buildCompanyWhere(req, { id: financialYearId })
            })
            : null;
        let startDate = '0000-00-00';
        let endDate = '0000-00-00';
        let year = new Date().getFullYear().toString();
        
        if (finYearCode) {
            // Extract year from financial year start date or name
            if (finYearCode.startDate) {
                try {
                    let startDateObj;
                    if (finYearCode.startDate instanceof Date) {
                        startDateObj = finYearCode.startDate;
                    } else if (typeof finYearCode.startDate === 'string') {
                        startDateObj = new Date(finYearCode.startDate);
                    }
                    
                    if (startDateObj && !isNaN(startDateObj.getTime())) {
                        year = startDateObj.getFullYear().toString();
                        startDate = startDateObj.toISOString().split('T')[0];
                    }
                } catch (dateError) {
                    // Use current year if extraction fails
                }
            }
            
            // Extract end date
            if (finYearCode.endDate) {
                try {
                    let endDateObj;
                    if (finYearCode.endDate instanceof Date) {
                        endDateObj = finYearCode.endDate;
                    } else if (typeof finYearCode.endDate === 'string') {
                        endDateObj = new Date(finYearCode.endDate);
                    }
                    
                    if (endDateObj && !isNaN(endDateObj.getTime())) {
                        endDate = endDateObj.toISOString().split('T')[0];
                    }
                } catch (dateError) {
                    // Use default if conversion fails
                }
            }
        }

        // Get the next sequence number for this financial year (sequential per company)
        const lastBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { financialYearId }),
            order: [['createdAt', 'DESC']],
            attributes: ['referenceNumber']
        });
        
        let sequence = 1;
        if (lastBalance && lastBalance.referenceNumber) {
            // Extract sequence number from last reference number
            const match = lastBalance.referenceNumber.match(/\/(\d+)$/);
            if (match) {
                sequence = parseInt(match[1]) + 1;
            } else {
                // If pattern doesn't match, count existing records
                const count = await OpeningBalance.count({ 
                    where: buildCompanyWhere(req, { financialYearId })
                });
                sequence = count + 1;
            }
        } else {
            // First record for this financial year
            const count = await OpeningBalance.count({ 
                where: buildCompanyWhere(req, { financialYearId })
            });
            sequence = count + 1;
        }
        
        const sequenceStr = String(sequence).padStart(7, '0');

        // Format the reference number: YEAR/START_DATE_END_DATE/COMPANY_CODE/SEQUENCE
        const finalReferenceNumber = `${year}/${startDate}_${endDate}/${companyCode}/${sequenceStr}`;

        // Calculate equivalent amount
        const amountValue = parseFloat(amount) || 0;
        const rate = parseFloat(exchangeRate) || 1;
        const equivalentAmount = amountValue * rate;

        const createData = {
            accountId,
            accountTypeId: account.accountType ? account.accountType.id : account.accountTypeId, // Use accountType association if available, otherwise use direct field
            amount: amountValue,  // Store the original amount as entered
            originalAmount: originalAmount ? parseFloat(originalAmount) : amountValue, // Use originalAmount if provided, otherwise use amount
            type: normalizedType,
            nature: natureValue,
            date,
            description,
            currencyId,
            exchangeRateId,
            exchangeRate: exchangeRate ? parseFloat(exchangeRate) : null,
            financialYearId,
            transactionTypeId: transactionType.id,
            createdBy: req.user.id,
            equivalentAmount: equivalentAmount,
            referenceNumber: finalReferenceNumber
        };
        
        const openingBalance = await OpeningBalance.create({
            ...createData,
            companyId: req.user.companyId
        });

        const createdBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { id: openingBalance.id }),
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['id', 'name', 'code', 'type']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: ExchangeRate,
                    as: 'exchangeRateRecord',
                    attributes: ['id', 'rate', 'effective_date']
                },
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                },
                {
                    model: AccountType,
                    as: 'accountType',
                    attributes: ['id', 'name', 'code', 'description']
                }
            ]
        });

        // Create general ledger entry
        try {
            await createGeneralLedgerEntry(createdBalance, req.user);
            } catch (glError) {
            // Don't fail the opening balance creation if general ledger fails
        }

        res.status(201).json(createdBalance);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create opening balance' });
    }
});

// Update opening balance
router.put('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { 
            amount, 
            originalAmount,
            type, 
            nature, 
            date, 
            description,
            currencyId,
            exchangeRateId,
            exchangeRate,
            financialYearId
        } = req.body;

        const openingBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [{ model: FinancialYear, as: 'financialYear' }]
        });
        if (!openingBalance) {
            return res.status(404).json({ error: 'Opening balance not found' });
        }
        
        // Get current financial year
        const currentFinancialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { isCurrent: true })
        });
        
        // Block update if not current year
        if (!currentFinancialYear || openingBalance.financialYearId !== currentFinancialYear.id) {
            return res.status(403).json({ error: 'Cannot edit opening balance for previous financial year' });
        }
        
        // Update fields with proper case conversion
        if (amount !== undefined) openingBalance.amount = parseFloat(amount);
        if (originalAmount !== undefined) openingBalance.originalAmount = originalAmount ? parseFloat(originalAmount) : null;
        if (type !== undefined) {
            openingBalance.type = type.toLowerCase();
            // Also update nature if not explicitly provided
            if (!nature) {
                openingBalance.nature = type.toUpperCase();
            }
        }
        if (nature !== undefined) openingBalance.nature = nature;
        if (date !== undefined) openingBalance.date = date;
        if (description !== undefined) openingBalance.description = description;
        if (currencyId !== undefined) openingBalance.currencyId = currencyId;
        if (exchangeRateId !== undefined) openingBalance.exchangeRateId = exchangeRateId;
        if (exchangeRate !== undefined) openingBalance.exchangeRate = exchangeRate ? parseFloat(exchangeRate) : null;
        if (financialYearId !== undefined) openingBalance.financialYearId = financialYearId;
        // Note: accountTypeId is not updated as it should remain consistent with the account
        openingBalance.updatedBy = req.user.id;

        // Calculate equivalent amount
        const amountValue = parseFloat(amount) || openingBalance.amount || 0;
        const rate = parseFloat(exchangeRate) || openingBalance.exchangeRate || 1;
        const equivalentAmount = amountValue * rate;
        openingBalance.equivalentAmount = equivalentAmount;

        await openingBalance.save();

        const updatedBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { id: openingBalance.id }),
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['id', 'name', 'code', 'type']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: ExchangeRate,
                    as: 'exchangeRateRecord',
                    attributes: ['id', 'rate', 'effective_date']
                },
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: AccountType,
                    as: 'accountType',
                    attributes: ['id', 'name', 'code', 'description']
                }
            ]
        });

        // Update general ledger entry
        try {
            await updateGeneralLedgerEntry(updatedBalance, req.user);
        } catch (glError) {
            // Don't fail the opening balance update if general ledger fails
        }

        res.json(updatedBalance);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update opening balance' });
    }
});

// Delete opening balance
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const openingBalance = await OpeningBalance.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [{ model: FinancialYear, as: 'financialYear' }]
        });
        if (!openingBalance) {
            return res.status(404).json({ error: 'Opening balance not found' });
        }
        
        // Get current financial year
        const currentFinancialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { isCurrent: true })
        });
        
        // Block delete if not current year
        if (!currentFinancialYear || openingBalance.financialYearId !== currentFinancialYear.id) {
            return res.status(403).json({ error: 'Cannot delete opening balance for previous financial year' });
        }
        
        // Delete general ledger entry first
        try {
            await deleteGeneralLedgerEntry(openingBalance.referenceNumber, req.user);
        } catch (glError) {
            // Continue with opening balance deletion even if general ledger fails
        }
        
        await openingBalance.destroy();
        res.json({ message: 'Opening balance deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete opening balance' });
    }
});

// Import opening balances from CSV
router.post('/import', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { records, currencyId, exchangeRateId, financialYearId } = req.body;
        
        if (!records || !Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ error: 'No valid records provided' });
        }
        
        // Validate currency if provided
        if (currencyId) {
            const currency = await Currency.findByPk(currencyId);
            if (!currency) {
                return res.status(400).json({ error: 'Invalid currency ID' });
            }
        }
        
        // Validate exchange rate if provided
        if (exchangeRateId) {
            const exchangeRate = await ExchangeRate.findByPk(exchangeRateId);
            if (!exchangeRate) {
                return res.status(400).json({ error: 'Invalid exchange rate ID' });
            }
        }
        
        // Validate financial year if provided
        if (financialYearId) {
            const financialYear = await FinancialYear.findByPk(financialYearId);
            if (!financialYear) {
                return res.status(400).json({ error: 'Invalid financial year ID' });
            }
        }

        const results = [];
        const errors = [];

        for (const record of records) {
            try {
                // Validate required fields
                if (!record.accountCode) {
                    errors.push(`Record missing account code`);
                    continue;
                }
                
                if (!record.amount || record.amount <= 0) {
                    errors.push(`Invalid amount for account ${record.accountCode}`);
                    continue;
                }

                // Find account by code and get account type
                const account = await Account.findOne({
                    where: buildCompanyWhere(req, { 
                        code: record.accountCode,
                        status: 'active'
                    }),
                    include: [{
                        model: AccountType,
                        as: 'accountType',
                        attributes: ['id', 'name', 'code']
                    }]
                });
                
                if (!account) {
                    errors.push(`Account not found: ${record.accountCode}`);
                    continue;
                }

                // Determine type from account nature if not provided
                let type = record.type;
                if (!type) {
                    type = account.nature === 'DEBIT' ? 'debit' : 'credit';
                } else {
                    type = type.toLowerCase();
                    if (type !== 'debit' && type !== 'credit') {
                        errors.push(`Invalid type for account ${record.accountCode}: ${record.type}`);
                        continue;
                    }
                }
                
                // Set default date if not provided
                const date = record.date || new Date().toISOString().split('T')[0];
                
                // Check if opening balance already exists for this account and financial year
                const existingBalance = await OpeningBalance.findOne({
                    where: buildCompanyWhere(req, {
                        accountId: account.id,
                        financialYearId: financialYearId || null
                    })
                });

                if (existingBalance) {
                    errors.push(`Opening balance already exists for account ${record.accountCode} in this financial year`);
                    continue;
                }

                // Handle currency and financial year from CSV
                let recordCurrencyId = currencyId;
                let recordFinancialYearId = financialYearId;
                let recordExchangeRateId = exchangeRateId;
                let recordExchangeRate = record.exchangeRate || 1;
                
                // If currency code is provided in CSV, find the currency ID
                if (record.currencyCode && record.currencyCode.trim()) {
                    const currency = await Currency.findOne({
                        where: buildCompanyWhere(req, { 
                            code: record.currencyCode.trim().toUpperCase(),
                            is_active: true
                        })
                    });
                    if (currency) {
                        recordCurrencyId = currency.id;
                        } else {
                        }
                }
                
                // If financial year is provided in CSV, find the financial year ID
                if (record.financialYear && record.financialYear.trim()) {
                    const financialYear = await FinancialYear.findOne({
                        where: buildCompanyWhere(req, { 
                            name: record.financialYear.trim(),
                            isActive: true
                        })
                    });
                    if (financialYear) {
                        recordFinancialYearId = financialYear.id;
                        } else {
                        }
                }
                
                // Calculate amounts based on currency conversion
                let finalAmount = parseFloat(record.amount);
                let originalAmount = null;
                let exchangeRateValue = recordExchangeRate;
                
                // If we have a currency and exchange rate, handle conversion
                if (recordCurrencyId && recordExchangeRate) {
                    // Get the default currency
                    const defaultCurrency = await Currency.findOne({
                        where: buildCompanyWhere(req, { is_default: true })
                    });
                    
                    if (defaultCurrency && recordCurrencyId !== defaultCurrency.id) {
                        // This is a foreign currency transaction
                        originalAmount = finalAmount; // Store original amount in foreign currency
                        exchangeRateValue = recordExchangeRate;
                        
                        // Try to find the exchange rate record
                        const exchangeRateRecord = await ExchangeRate.findOne({
                            where: buildCompanyWhere(req, {
                                from_currency_id: recordCurrencyId,
                                to_currency_id: defaultCurrency.id,
                                rate: recordExchangeRate,
                                is_active: true
                            }),
                            order: [['effective_date', 'DESC']]
                        });
                        
                        if (exchangeRateRecord) {
                            recordExchangeRateId = exchangeRateRecord.id;
                            } else {
                            }
                        
                        // Convert to base currency for storage
                        finalAmount = originalAmount * recordExchangeRate;
                        
                        } else {
                        // This is in default currency
                        originalAmount = null;
                        exchangeRateValue = 1;
                        recordExchangeRateId = null;
                        }
                } else {
                    // No currency specified, treat as default currency
                    originalAmount = null;
                    exchangeRateValue = 1;
                    recordExchangeRateId = null;
                    }
                
                // Calculate equivalent amount (should be originalAmount * exchangeRate)
                const equivalentAmount = originalAmount ? originalAmount * recordExchangeRate : finalAmount;
                
                // Get default transaction type for opening balances (GLOBAL - no company filter)
                let transactionType = await TransactionType.findOne({
                    where: { name: 'Opening Balance' }
                });
                
                // If not found, try alternative names
                if (!transactionType) {
                    transactionType = await TransactionType.findOne({
                        where: { 
                            [Op.or]: [
                                { name: 'Opening Balance' },
                                { name: 'Opening Balances' },
                                { name: 'OB' },
                                { name: 'Initial Balance' }
                            ]
                        }
                    });
                }
                
                // If still not found, create a default one (GLOBAL - no companyId required)
                if (!transactionType) {
                    try {
                        transactionType = await TransactionType.create({
                            name: 'Opening Balance',
                            description: 'Default transaction type for opening balance entries',
                            isActive: true,
                            companyId: null // Global - no company association
                        });
                        } catch (createError) {
                        errors.push(`Failed to create transaction type for account ${record.accountCode}`);
                        continue;
                    }
                }
                
                // Generate reference number using same format as POST route
                // Get company info
                const company = await Company.findOne({
                    where: { id: req.user.companyId }
                });
                let companyCode = 'EMZ';
                if (company && company.code) {
                    companyCode = company.code.toUpperCase();
                } else if (company && company.name) {
                    companyCode = company.name.substring(0, 3).toUpperCase();
                }
                
                // Get financial year info for reference number
                const finYearForRef = recordFinancialYearId
                    ? await FinancialYear.findOne({
                        where: buildCompanyWhere(req, { id: recordFinancialYearId })
                    })
                    : null;
                
                let startDate = '0000-00-00';
                let endDate = '0000-00-00';
                let year = new Date().getFullYear().toString();
                
                if (finYearForRef) {
                    if (finYearForRef.startDate) {
                        try {
                            let startDateObj;
                            if (finYearForRef.startDate instanceof Date) {
                                startDateObj = finYearForRef.startDate;
                            } else if (typeof finYearForRef.startDate === 'string') {
                                startDateObj = new Date(finYearForRef.startDate);
                            }
                            
                            if (startDateObj && !isNaN(startDateObj.getTime())) {
                                year = startDateObj.getFullYear().toString();
                                startDate = startDateObj.toISOString().split('T')[0];
                            }
                        } catch (dateError) {
                            // Use current year if extraction fails
                        }
                    }
                    
                    if (finYearForRef.endDate) {
                        try {
                            let endDateObj;
                            if (finYearForRef.endDate instanceof Date) {
                                endDateObj = finYearForRef.endDate;
                            } else if (typeof finYearForRef.endDate === 'string') {
                                endDateObj = new Date(finYearForRef.endDate);
                            }
                            
                            if (endDateObj && !isNaN(endDateObj.getTime())) {
                                endDate = endDateObj.toISOString().split('T')[0];
                            }
                        } catch (dateError) {
                            // Use default if conversion fails
                        }
                    }
                }
                
                // Get the next sequence number for this financial year (sequential per company)
                const lastBalance = await OpeningBalance.findOne({
                    where: buildCompanyWhere(req, { financialYearId: recordFinancialYearId }),
                    order: [['createdAt', 'DESC']],
                    attributes: ['referenceNumber']
                });
                
                let sequence = 1;
                if (lastBalance && lastBalance.referenceNumber) {
                    // Extract sequence number from last reference number
                    const match = lastBalance.referenceNumber.match(/\/(\d+)$/);
                    if (match) {
                        sequence = parseInt(match[1]) + 1;
                    } else {
                        // If pattern doesn't match, count existing records
                        const count = await OpeningBalance.count({ 
                            where: buildCompanyWhere(req, { financialYearId: recordFinancialYearId })
                        });
                        sequence = count + 1;
                    }
                } else {
                    // First record for this financial year
                    const count = await OpeningBalance.count({ 
                        where: buildCompanyWhere(req, { financialYearId: recordFinancialYearId })
                    });
                    sequence = count + 1;
                }
                
                const sequenceStr = String(sequence).padStart(7, '0');
                const referenceNumber = `${year}/${startDate}_${endDate}/${companyCode}/${sequenceStr}`;
                const importCreateData = {
                    accountId: account.id,
                    accountTypeId: account.accountType ? account.accountType.id : account.accountTypeId, // Use accountType association if available, otherwise use direct field
                    amount: finalAmount,
                    originalAmount: originalAmount,
                    type: type,
                    nature: type.toUpperCase(),
                    date: date,
                    description: record.description || `Opening balance for ${account.name}`,
                    currencyId: recordCurrencyId || null,
                    exchangeRateId: recordExchangeRateId || null,
                    exchangeRate: exchangeRateValue,
                    financialYearId: recordFinancialYearId || null,
                    createdBy: req.user.id,
                    updatedBy: req.user.id,
                    equivalentAmount: equivalentAmount,
                    transactionTypeId: transactionType.id,
                    referenceNumber: referenceNumber
                };
                
                // Create opening balance
                const openingBalance = await OpeningBalance.create({
                    ...importCreateData,
                    companyId: req.user.companyId
                });

                // Create general ledger entry
                try {
                    await createGeneralLedgerEntry(openingBalance, req.user);
                    } catch (glError) {
                    errors.push(`Failed to create general ledger entry for account ${record.accountCode}: ${glError.message}`);
                    // Continue with the import even if GL entry fails
                }
                
                results.push({
                    accountCode: record.accountCode,
                    accountName: account.name,
                    amount: finalAmount,
                    originalAmount: originalAmount,
                    type: type,
                    currencyCode: record.currencyCode || null,
                    exchangeRate: exchangeRateValue,
                    financialYear: record.financialYear || null,
                    status: 'created',
                    id: openingBalance.id
                });
                
            } catch (error) {
                errors.push(`Error processing account ${record.accountCode}: ${error.message}`);
            }
        }
        
        res.json({
            success: true,
            created: results.length,
            errors: errors,
            results: results
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to import opening balances' });
    }
});

// Save import as draft
router.post('/draft', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { balances } = req.body;

        if (!Array.isArray(balances) || balances.length === 0) {
            return res.status(400).json({ error: 'Invalid balances data' });
        }

        // For now, we'll just validate the data and return a draft ID
        // In a real implementation, you might want to store this in a separate draft table
        const draftId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const validationResults = [];
        const errors = [];

        for (const balance of balances) {
            const { accountCode, amount, type, date, description } = balance;
            
            // Validate required fields
            if (!accountCode || amount === undefined || !type || !date) {
                errors.push({ accountCode, error: 'Missing required fields' });
                continue;
            }

            // Check if account exists
            const account = await Account.findOne({
                where: { code: accountCode }
            });
            
            if (!account) {
                errors.push({ accountCode, error: 'Account not found' });
                continue;
            }

            // Check if opening balance already exists
            const existingBalance = await OpeningBalance.findOne({
                where: buildCompanyWhere(req, { accountId: account.id })
            });

            if (existingBalance) {
                errors.push({ accountCode, error: 'Opening balance already exists for this account' });
                continue;
            }

            validationResults.push({
                accountCode,
                accountName: account.name,
                amount: parseFloat(amount),
                type: type.toLowerCase(),
                date,
                description,
                isValid: true
            });
        }

        res.status(201).json({
            draftId,
            validRecords: validationResults.length,
            errors: errors,
            totalAmount: validationResults.reduce((sum, record) => sum + record.amount, 0)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save draft' });
    }
});

// Generate CSV template for opening balances
router.get('/template/csv', async (req, res) => {
    try {
        const { financialYearId } = req.query;
        
        // Get leaf accounts without opening balances for the specified financial year
        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, { status: 'active' }),
            order: [['name', 'ASC']]
        });

        // Get accounts that already have opening balances for the specified financial year
        const accountsWithBalances = await OpeningBalance.findAll({
            where: buildCompanyWhere(req, { 
                financialYearId: financialYearId || null
            }),
            attributes: ['accountId']
        });

        const accountIdsWithBalances = accountsWithBalances.map(ob => ob.accountId);
        
        // Filter accounts without opening balances
        const accountsWithoutBalances = accounts.filter(account => 
            !accountIdsWithBalances.includes(account.id)
        );
        
        // Get all account IDs that have children (parent accounts)
        const parentAccountIds = accounts
            .filter(account => account.parentId !== null)
            .map(account => account.parentId);
        
        // Filter for leaf accounts only (accounts without children)
        const leafAccountsWithoutBalances = accountsWithoutBalances.filter(account => 
            !parentAccountIds.includes(account.id)
        );
        
        // Get available currencies
        const currencies = await Currency.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['code', 'ASC']]
        });

        // Get available financial years
        const financialYears = await FinancialYear.findAll({
            where: buildCompanyWhere(req, { isActive: true }),
            order: [['startDate', 'DESC']]
        });

        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        
        // Create CSV content
        const headers = [
            'Account Code', 
            'Account Name', 
            'Amount', 
            'Type', 
            'Date', 
            'Description',
            'Currency Code',
            'Exchange Rate',
            'Financial Year'
        ];
        
        let csvContent = headers.join(',') + '\n';
        
        leafAccountsWithoutBalances.forEach(account => {
            // Determine type from nature
            let type = '';
            if (account.nature) {
                type = account.nature.toLowerCase(); // 'debit' or 'credit'
            }
            
            const row = [
                account.code,
                `"${account.name}"`,
                '', // Amount left blank for user
                type,
                today,
                '', // Description left blank
                '', // Currency code left blank
                '', // Exchange rate left blank
                '' // Financial year left blank
            ];
            csvContent += row.join(',') + '\n';
        });

        // Add sample data row
        if (leafAccountsWithoutBalances.length > 0) {
            const sampleAccount = leafAccountsWithoutBalances[0];
            const sampleCurrency = currencies.length > 0 ? currencies[0].code : 'USD';
            const sampleFinancialYear = financialYears.length > 0 ? financialYears[0].name : '2024-2025';
            
            const sampleRow = [
                sampleAccount.code,
                `"${sampleAccount.name}"`,
                '1000.00', // Sample amount
                sampleAccount.nature ? sampleAccount.nature.toLowerCase() : 'debit',
                today,
                'Sample opening balance',
                sampleCurrency,
                '1.00', // Sample exchange rate
                sampleFinancialYear
            ];
            csvContent += sampleRow.join(',') + '\n';
        }

        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="opening_balances_template.csv"');
        
        // Send CSV content
        res.send(csvContent);
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate CSV template' });
    }
});

// Helper function to validate date
function isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && dateString.match(/^\d{4}-\d{2}-\d{2}$/);
}

// Get latest exchange rate for a currency code to default currency
router.get('/exchange-rates/latest', async (req, res) => {
    try {
        const { currencyId } = req.query;
        
        if (!currencyId) {
            return res.status(400).json({ error: 'CurrencyId is required' });
        }

        // Validate currencyId is a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(currencyId)) {
            return res.status(400).json({ error: 'Invalid currencyId format' });
        }

        // Get the currency object by ID
        const fromCurrency = await Currency.findOne({
            where: buildCompanyWhere(req, { id: currencyId })
        });
        if (!fromCurrency) {
            return res.status(404).json({ error: 'Currency not found' });
        }

        // Validate fromCurrency.id is a valid UUID
        if (!uuidRegex.test(fromCurrency.id)) {
            return res.status(500).json({ error: 'Invalid currency data' });
        }

        // Get the default currency
        const toCurrency = await Currency.findOne({ 
            where: buildCompanyWhere(req, { is_default: true })
        });
        if (!toCurrency) {
            return res.status(404).json({ error: 'Default currency not found' });
        }

        // Validate toCurrency.id is a valid UUID
        if (!uuidRegex.test(toCurrency.id)) {
            return res.status(500).json({ error: 'Invalid default currency data' });
        }

        // If the selected currency is the default, rate is 1
        if (fromCurrency.id === toCurrency.id) {
            
            return res.json({ rate: 1.0 });
        }

        // Get the latest exchange rate from selected currency to default currency
        const latestRate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, {
                from_currency_id: fromCurrency.id,
                to_currency_id: toCurrency.id,
                is_active: true
            }),
            order: [['effective_date', 'DESC']]
        });

        if (!latestRate) {
            return res.status(404).json({ error: 'No exchange rate found' });
        }

        res.json({ rate: parseFloat(latestRate.rate) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch latest exchange rate', details: error.message });
    }
});

// Export endpoints
// GET /api/opening-balances/export/excel - Export opening balances to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, financialYearId, accountId, currencyId, type } = req.query;
        
        // Build where clause
        const whereClause = {};
        if (search) {
            whereClause[Op.or] = [
                { description: { [Op.iLike]: `%${search}%` } },
                { referenceNumber: { [Op.iLike]: `%${search}%` } }
            ];
        }
        if (financialYearId) whereClause.financialYearId = financialYearId;
        if (accountId) whereClause.accountId = accountId;
        if (currencyId) whereClause.currencyId = currencyId;
        if (type) whereClause.type = type;

        // Fetch opening balances with associations
        const openingBalances = await OpeningBalance.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['id', 'name', 'code', 'type', 'status']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate', 'isActive']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                },
                {
                    model: AccountType,
                    as: 'accountType',
                    attributes: ['id', 'name', 'code', 'description']
                },
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
            order: [['createdAt', 'DESC']]
        });

        // Create export service instance
        const exportService = new ExportService();
        const buffer = await exportService.exportOpeningBalancesToExcel(openingBalances, req.query);

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="opening-balances.xlsx"');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export opening balances to Excel' });
    }
});

// GET /api/opening-balances/export/pdf - Export opening balances to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, financialYearId, accountId, currencyId, type } = req.query;
        
        // Build where clause
        const whereClause = {};
        if (search) {
            whereClause[Op.or] = [
                { description: { [Op.iLike]: `%${search}%` } },
                { referenceNumber: { [Op.iLike]: `%${search}%` } }
            ];
        }
        if (financialYearId) whereClause.financialYearId = financialYearId;
        if (accountId) whereClause.accountId = accountId;
        if (currencyId) whereClause.currencyId = currencyId;
        if (type) whereClause.type = type;

        // Fetch opening balances with associations
        const openingBalances = await OpeningBalance.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['id', 'name', 'code', 'type', 'status']
                },
                {
                    model: Currency,
                    as: 'currency',
                    attributes: ['id', 'name', 'code', 'symbol']
                },
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate', 'isActive']
                },
                {
                    model: TransactionType,
                    as: 'transactionType',
                    attributes: ['id', 'name', 'description']
                },
                {
                    model: AccountType,
                    as: 'accountType',
                    attributes: ['id', 'name', 'code', 'description']
                },
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
            order: [['createdAt', 'DESC']]
        });

        // Create export service instance
        const exportService = new ExportService();
        const buffer = await exportService.exportOpeningBalancesToPDF(openingBalances, req.query);

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="opening-balances.pdf"');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export opening balances to PDF' });
    }
});

module.exports = router; 