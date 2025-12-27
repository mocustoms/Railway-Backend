const express = require('express');
const router = express.Router();
const { JournalEntry, JournalEntryLine, User, Account, AccountType, Currency, ExchangeRate, FinancialYear, Company } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { Op, Sequelize } = require('sequelize');
const sequelize = require('../../config/database');
const { createJournalEntryGLEntries, deleteJournalEntryGLEntries, updateJournalEntryGLEntries, getAccountBalance } = require('../utils/journalEntryHelper');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all journal entries with pagination and filters
router.get('/', async (req, res) => {
    try {
        // Check authentication
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        // Allow system admins to access all entries, but regular users need companyId
        if (!req.user.isSystemAdmin && !req.user.companyId) {
            return res.status(403).json({ 
                error: 'Company access required',
                details: 'User account must be associated with a company'
            });
        }

        const { 
            page = 1, 
            limit = 25, 
            search = '', 
            sortBy = 'createdAt', 
            sortOrder = 'DESC',
            financialYearId = null,
            startDate = null,
            endDate = null,
            isPosted = null
        } = req.query;

        // Build where clause
        const whereClause = {};
        
        if (financialYearId) {
            whereClause.financialYearId = financialYearId;
        }

        if (isPosted !== null && isPosted !== '') {
            whereClause.isPosted = isPosted === 'true';
        }

        if (startDate || endDate) {
            whereClause.entryDate = {};
            if (startDate) whereClause.entryDate[Op.gte] = new Date(startDate);
            if (endDate) whereClause.entryDate[Op.lte] = new Date(endDate);
        }
        
        if (search) {
            whereClause[Op.or] = [
                { description: { [Op.iLike]: `%${search}%` } },
                { referenceNumber: { [Op.iLike]: `%${search}%` } },
                { '$financialYear.name$': { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        // Map camelCase sortBy to database column for where clause if needed
        // (Sequelize will handle the mapping via model field definitions)

        // Build order clause - map model attributes to database column names
        // When using pagination, Sequelize creates a subquery with alias "JournalEntry"
        // We need to use the actual database column names with this alias
        let orderClause = [];
        
        // Map model attribute names to actual database column names
        const columnMapping = {
            'entryDate': 'entry_date',
            'referenceNumber': 'reference_number',
            'description': 'description',
            'totalDebit': 'total_debit',
            'totalCredit': 'total_credit',
            'isPosted': 'is_posted',
            'createdAt': 'created_at',
            'updatedAt': 'updated_at'
        };
        
        const validSortFields = ['entryDate', 'referenceNumber', 'description', 'totalDebit', 'totalCredit', 'isPosted', 'createdAt', 'updatedAt'];

        if (validSortFields.includes(sortBy)) {
            // Use Sequelize.col() with model name (alias) and actual database column name
            const dbColumn = columnMapping[sortBy] || 'created_at';
            orderClause = [[Sequelize.col(`JournalEntry.${dbColumn}`), sortOrder]];
        } else {
            orderClause = [[Sequelize.col('JournalEntry.created_at'), 'DESC']];
        }

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: journalEntries } = await JournalEntry.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
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
                },
                {
                    model: User,
                    as: 'poster',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: JournalEntryLine,
                    as: 'lines',
                    include: [
                        {
                            model: Account,
                            as: 'account',
                            attributes: ['id', 'name', 'code', 'type']
                        },
                        {
                            model: AccountType,
                            as: 'accountType',
                            attributes: ['id', 'name', 'code']
                        },
                        {
                            model: Currency,
                            as: 'currency',
                            attributes: ['id', 'code', 'name', 'symbol'],
                            required: false
                        }
                    ]
                }
            ],
            order: orderClause,
            limit: parseInt(limit),
            offset: offset
        });

        const totalPages = Math.ceil(count / parseInt(limit));

        res.json({
            journalEntries,
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
        res.status(500).json({ 
            error: 'Failed to fetch journal entries', 
            details: error.message
        });
    }
});

// Get a single journal entry by ID
router.get('/:id', async (req, res) => {
    try {
        const journalEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
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
                },
                {
                    model: User,
                    as: 'poster',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: JournalEntryLine,
                    as: 'lines',
                    include: [
                        {
                            model: Account,
                            as: 'account',
                            attributes: ['id', 'name', 'code', 'type']
                        },
                        {
                            model: AccountType,
                            as: 'accountType',
                            attributes: ['id', 'name', 'code']
                        },
                        {
                            model: Currency,
                            as: 'currency',
                            attributes: ['id', 'code', 'name', 'symbol'],
                            required: false
                        },
                        {
                            model: ExchangeRate,
                            as: 'exchangeRateRecord',
                            attributes: ['id', 'rate', 'effective_date'],
                            required: false
                        }
                    ],
                    order: [['lineNumber', 'ASC']]
                }
            ]
        });

        if (!journalEntry) {
            return res.status(404).json({ error: 'Journal entry not found' });
        }

        res.json(journalEntry);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch journal entry', details: error.message });
    }
});

// Get available accounts for journal entries
router.get('/accounts/list', async (req, res) => {
    try {
        if (!req.user || (!req.user.isSystemAdmin && !req.user.companyId)) {
            return res.status(403).json({ error: 'Company access required' });
        }

        const accounts = await Account.findAll({
            where: buildCompanyWhere(req, { status: 'active' }),
            include: [{
                model: AccountType,
                as: 'accountType',
                attributes: ['id', 'name', 'code', 'nature'],
                required: false
            }],
            attributes: ['id', 'code', 'name', 'type', 'nature', 'accountTypeId'],
            order: [['code', 'ASC']]
        });
        
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch accounts',
            details: error.message 
        });
    }
});

// Get available currencies
router.get('/currencies/list', async (req, res) => {
    try {
        if (!req.user || (!req.user.isSystemAdmin && !req.user.companyId)) {
            return res.status(403).json({ error: 'Company access required' });
        }

        const currencies = await Currency.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            attributes: ['id', 'code', 'name', 'symbol', 'is_default'],
            order: [['code', 'ASC']]
        });
        
        res.json(currencies);
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch currencies',
            details: error.message 
        });
    }
});

// Get available financial years
router.get('/financial-years/list', async (req, res) => {
    try {
        if (!req.user || (!req.user.isSystemAdmin && !req.user.companyId)) {
            return res.status(403).json({ error: 'Company access required' });
        }

        const financialYears = await FinancialYear.findAll({
            where: buildCompanyWhere(req, { isActive: true }),
            attributes: ['id', 'name', 'startDate', 'endDate', 'isCurrent', 'isActive'],
            order: [['startDate', 'DESC']]
        });
        
        res.json(financialYears);
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch financial years',
            details: error.message 
        });
    }
});

// Create a new journal entry
router.post('/', csrfProtection, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { 
            entryDate,
            description,
            financialYearId,
            currencyId,
            lines
        } = req.body;

        // Validation
        if (!entryDate) {
            return res.status(400).json({ error: 'Entry date is required' });
        }

        if (!financialYearId) {
            return res.status(400).json({ error: 'Financial year is required' });
        }

        if (!lines || !Array.isArray(lines) || lines.length < 2) {
            return res.status(400).json({ error: 'At least two line items are required' });
        }

        // Validate that debits equal credits
        let totalDebit = 0;
        let totalCredit = 0;

        for (const line of lines) {
            const amount = parseFloat(line.amount) || 0;
            if (line.type === 'debit') {
                totalDebit += amount;
            } else if (line.type === 'credit') {
                totalCredit += amount;
            } else {
                return res.status(400).json({ error: `Invalid line type: ${line.type}. Must be 'debit' or 'credit'` });
            }
        }

        const difference = Math.abs(totalDebit - totalCredit);
        if (difference > 0.01) { // Allow for small rounding differences
            return res.status(400).json({ 
                error: 'Debits and credits must be equal', 
                totalDebit, 
                totalCredit, 
                difference 
            });
        }

        // Get financial year
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: financialYearId })
        });
        if (!financialYear) {
            return res.status(404).json({ error: 'Financial year not found' });
        }

        // Validate account balances - check if credits would exceed account balance
        for (const line of lines) {
            if (!line.accountId) {
                continue; // Skip if no account ID (will be caught by other validation)
            }

            // Get account details
            const account = await Account.findOne({
                where: buildCompanyWhere(req, { id: line.accountId }),
                include: [{ 
                    model: AccountType, 
                    as: 'accountType',
                    required: false
                }],
                transaction
            });

            if (!account) {
                return res.status(404).json({ 
                    error: `Account not found for line ${line.lineNumber || 'unknown'}`,
                    accountId: line.accountId
                });
            }

            // Determine account nature
            let accountNature = 'debit'; // Default
            if (account.nature) {
                accountNature = account.nature.toLowerCase();
            } else if (account.accountType && account.accountType.nature) {
                accountNature = account.accountType.nature.toLowerCase();
            }

            // Get current account balance as of entry date
            const accountBalanceData = await getAccountBalance(
                line.accountId,
                financialYearId,
                entryDate,
                req.user.companyId,
                transaction
            );

            const currentBalance = accountBalanceData.balance;
            const lineAmount = parseFloat(line.equivalentAmount || line.amount || 0);

            // For DEBIT accounts: Balance = Debits - Credits (positive balance is normal)
            // Credit decreases balance, so we can't credit more than the current balance
            if (accountNature === 'debit' && line.type === 'credit') {
                if (lineAmount > currentBalance) {
                    await transaction.rollback();
                    return res.status(400).json({
                        error: 'Insufficient account balance',
                        details: `Cannot credit ${lineAmount.toFixed(2)} to account "${account.name}" (${account.code}). Current balance: ${currentBalance.toFixed(2)}`,
                        accountId: account.id,
                        accountCode: account.code,
                        accountName: account.name,
                        accountNature: accountNature,
                        currentBalance: currentBalance,
                        creditAmount: lineAmount,
                        lineNumber: line.lineNumber || 'unknown'
                    });
                }
            }

            // For CREDIT accounts: In GL, balance = Debits - Credits
            // For credit accounts, normal balance is negative (credits > debits)
            // If balance is -100, that means we have a credit balance of 100
            // Debiting decreases the credit balance (makes it less negative)
            // We can't debit more than the absolute credit balance (can't make it positive)
            if (accountNature === 'credit' && line.type === 'debit') {
                // For credit accounts, if current balance is negative, that's the credit balance
                // We can't debit more than the absolute value (can't reverse to positive)
                const creditBalance = Math.abs(Math.min(currentBalance, 0)); // Get absolute credit balance
                if (creditBalance > 0 && lineAmount > creditBalance) {
                    await transaction.rollback();
                    return res.status(400).json({
                        error: 'Insufficient account balance',
                        details: `Cannot debit ${lineAmount.toFixed(2)} from account "${account.name}" (${account.code}). Current credit balance: ${creditBalance.toFixed(2)}`,
                        accountId: account.id,
                        accountCode: account.code,
                        accountName: account.name,
                        accountNature: accountNature,
                        currentBalance: currentBalance,
                        creditBalance: creditBalance,
                        debitAmount: lineAmount,
                        lineNumber: line.lineNumber || 'unknown'
                    });
                }
            }
        }

        // Get company code for reference number
        const company = await Company.findByPk(req.user.companyId);
        const companyCode = company?.code || 'COMP';

        // Generate reference number
        const year = new Date(entryDate).getFullYear();
        const dateStr = new Date(entryDate).toISOString().split('T')[0].replace(/-/g, '');
        
        // Get the next sequence number
        const lastEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { 
                financialYearId,
                entryDate: {
                    [Op.gte]: new Date(year, 0, 1),
                    [Op.lt]: new Date(year + 1, 0, 1)
                }
            }),
            order: [[Sequelize.col('created_at'), 'DESC']],
            attributes: ['referenceNumber']
        });
        
        let sequence = 1;
        if (lastEntry && lastEntry.referenceNumber) {
            const match = lastEntry.referenceNumber.match(/\/(\d+)$/);
            if (match) {
                sequence = parseInt(match[1]) + 1;
            } else {
                const count = await JournalEntry.count({ 
                    where: buildCompanyWhere(req, { financialYearId })
                });
                sequence = count + 1;
            }
        } else {
            const count = await JournalEntry.count({ 
                where: buildCompanyWhere(req, { financialYearId })
            });
            sequence = count + 1;
        }
        
        const sequenceStr = String(sequence).padStart(7, '0');
        const referenceNumber = `JE/${year}/${dateStr}/${companyCode}/${sequenceStr}`;

        // Create journal entry
        const journalEntry = await JournalEntry.create({
            referenceNumber,
            entryDate,
            description: description || null,
            financialYearId,
            currencyId: currencyId || null,
            totalDebit,
            totalCredit,
            isPosted: false,
            createdBy: req.user.id,
            companyId: req.user.companyId
        }, { transaction });

        // Create journal entry lines
        const createdLines = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const account = await Account.findByPk(line.accountId, {
                include: [{ model: AccountType, as: 'accountType' }]
            });

            if (!account) {
                await transaction.rollback();
                return res.status(404).json({ error: `Account not found for line ${i + 1}` });
            }

            const amount = parseFloat(line.amount) || 0;
            const originalAmount = line.originalAmount ? parseFloat(line.originalAmount) : amount;
            const exchangeRate = line.exchangeRate ? parseFloat(line.exchangeRate) : 1.0;
            const equivalentAmount = originalAmount * exchangeRate;

            const journalLine = await JournalEntryLine.create({
                journalEntryId: journalEntry.id,
                accountId: line.accountId,
                accountTypeId: account.accountType ? account.accountType.id : account.accountTypeId,
                type: line.type,
                amount: equivalentAmount, // Store in base currency
                originalAmount: originalAmount,
                equivalentAmount: equivalentAmount,
                currencyId: line.currencyId || null,
                exchangeRateId: line.exchangeRateId || null,
                exchangeRate: exchangeRate,
                description: line.description || null,
                lineNumber: i + 1,
                companyId: req.user.companyId
            }, { transaction });

            createdLines.push(journalLine);
        }

        await transaction.commit();

        // Fetch the created entry with all associations
        const createdEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: journalEntry.id }),
            include: [
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: JournalEntryLine,
                    as: 'lines',
                    include: [
                        {
                            model: Account,
                            as: 'account',
                            attributes: ['id', 'name', 'code', 'type']
                        },
                        {
                            model: AccountType,
                            as: 'accountType',
                            attributes: ['id', 'name', 'code']
                        },
                        {
                            model: Currency,
                            as: 'currency',
                            attributes: ['id', 'code', 'name', 'symbol'],
                            required: false
                        }
                    ],
                    order: [['lineNumber', 'ASC']]
                }
            ]
        });

        res.status(201).json(createdEntry);
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Failed to create journal entry', details: error.message });
    }
});

// Update a journal entry (only if not posted)
router.put('/:id', csrfProtection, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { 
            entryDate,
            description,
            financialYearId,
            currencyId,
            lines
        } = req.body;

        const journalEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!journalEntry) {
            return res.status(404).json({ error: 'Journal entry not found' });
        }

        // Cannot edit if already posted
        if (journalEntry.isPosted) {
            return res.status(403).json({ error: 'Cannot edit a posted journal entry' });
        }

        // Validation
        if (lines && Array.isArray(lines) && lines.length > 0) {
            if (lines.length < 2) {
                return res.status(400).json({ error: 'At least two line items are required' });
            }

            // Validate that debits equal credits
            let totalDebit = 0;
            let totalCredit = 0;

            for (const line of lines) {
                const amount = parseFloat(line.amount) || 0;
                if (line.type === 'debit') {
                    totalDebit += amount;
                } else if (line.type === 'credit') {
                    totalCredit += amount;
                } else {
                    return res.status(400).json({ error: `Invalid line type: ${line.type}. Must be 'debit' or 'credit'` });
                }
            }

            const difference = Math.abs(totalDebit - totalCredit);
            if (difference > 0.01) {
                return res.status(400).json({ 
                    error: 'Debits and credits must be equal', 
                    totalDebit, 
                    totalCredit, 
                    difference 
                });
            }

            // Get financial year for balance validation
            const financialYearForUpdate = await FinancialYear.findOne({
                where: buildCompanyWhere(req, { id: financialYearId || journalEntry.financialYearId })
            });
            if (!financialYearForUpdate) {
                return res.status(404).json({ error: 'Financial year not found' });
            }

            // Validate account balances - check if credits would exceed account balance
            // Note: Since the entry is not posted, the lines aren't in GL yet, so we can validate normally
            const entryDateForValidation = entryDate || journalEntry.entryDate;
            const financialYearIdForValidation = financialYearId || journalEntry.financialYearId;

            for (const line of lines) {
                if (!line.accountId) {
                    continue; // Skip if no account ID (will be caught by other validation)
                }

                // Get account details
                const account = await Account.findOne({
                    where: buildCompanyWhere(req, { id: line.accountId }),
                    include: [{ 
                        model: AccountType, 
                        as: 'accountType',
                        required: false
                    }],
                    transaction
                });

                if (!account) {
                    await transaction.rollback();
                    return res.status(404).json({ 
                        error: `Account not found for line ${line.lineNumber || 'unknown'}`,
                        accountId: line.accountId
                    });
                }

                // Determine account nature
                let accountNature = 'debit'; // Default
                if (account.nature) {
                    accountNature = account.nature.toLowerCase();
                } else if (account.accountType && account.accountType.nature) {
                    accountNature = account.accountType.nature.toLowerCase();
                }

                // Get current account balance as of entry date
                const accountBalanceData = await getAccountBalance(
                    line.accountId,
                    financialYearIdForValidation,
                    entryDateForValidation,
                    req.user.companyId,
                    transaction
                );

                const currentBalance = accountBalanceData.balance;
                const lineAmount = parseFloat(line.equivalentAmount || line.amount || 0);

                // For DEBIT accounts: Balance = Debits - Credits (positive balance is normal)
                // Credit decreases balance, so we can't credit more than the current balance
                if (accountNature === 'debit' && line.type === 'credit') {
                    if (lineAmount > currentBalance) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: 'Insufficient account balance',
                            details: `Cannot credit ${lineAmount.toFixed(2)} to account "${account.name}" (${account.code}). Current balance: ${currentBalance.toFixed(2)}`,
                            accountId: account.id,
                            accountCode: account.code,
                            accountName: account.name,
                            accountNature: accountNature,
                            currentBalance: currentBalance,
                            creditAmount: lineAmount,
                            lineNumber: line.lineNumber || 'unknown'
                        });
                    }
                }

                // For CREDIT accounts: In GL, balance = Debits - Credits
                // For credit accounts, normal balance is negative (credits > debits)
                // If balance is -100, that means we have a credit balance of 100
                // Debiting decreases the credit balance (makes it less negative)
                // We can't debit more than the absolute credit balance (can't make it positive)
                if (accountNature === 'credit' && line.type === 'debit') {
                    const creditBalance = Math.abs(Math.min(currentBalance, 0)); // Get absolute credit balance
                    if (creditBalance > 0 && lineAmount > creditBalance) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: 'Insufficient account balance',
                            details: `Cannot debit ${lineAmount.toFixed(2)} from account "${account.name}" (${account.code}). Current credit balance: ${creditBalance.toFixed(2)}`,
                            accountId: account.id,
                            accountCode: account.code,
                            accountName: account.name,
                            accountNature: accountNature,
                            currentBalance: currentBalance,
                            creditBalance: creditBalance,
                            debitAmount: lineAmount,
                            lineNumber: line.lineNumber || 'unknown'
                        });
                    }
                }
            }

            // Delete existing lines
            await JournalEntryLine.destroy({
                where: { journalEntryId: journalEntry.id },
                transaction
            });

            // Create new lines
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const account = await Account.findByPk(line.accountId, {
                    include: [{ model: AccountType, as: 'accountType' }]
                });

                if (!account) {
                    await transaction.rollback();
                    return res.status(404).json({ error: `Account not found for line ${i + 1}` });
                }

                const amount = parseFloat(line.amount) || 0;
                const originalAmount = line.originalAmount ? parseFloat(line.originalAmount) : amount;
                const exchangeRate = line.exchangeRate ? parseFloat(line.exchangeRate) : 1.0;
                const equivalentAmount = originalAmount * exchangeRate;

                await JournalEntryLine.create({
                    journalEntryId: journalEntry.id,
                    accountId: line.accountId,
                    accountTypeId: account.accountType ? account.accountType.id : account.accountTypeId,
                    type: line.type,
                    amount: equivalentAmount,
                    originalAmount: originalAmount,
                    equivalentAmount: equivalentAmount,
                    currencyId: line.currencyId || null,
                    exchangeRateId: line.exchangeRateId || null,
                    exchangeRate: exchangeRate,
                    description: line.description || null,
                    lineNumber: i + 1,
                    companyId: req.user.companyId
                }, { transaction });
            }

            journalEntry.totalDebit = totalDebit;
            journalEntry.totalCredit = totalCredit;
        }

        // Update other fields
        if (entryDate !== undefined) journalEntry.entryDate = entryDate;
        if (description !== undefined) journalEntry.description = description;
        if (financialYearId !== undefined) journalEntry.financialYearId = financialYearId;
        if (currencyId !== undefined) journalEntry.currencyId = currencyId || null;
        journalEntry.updatedBy = req.user.id;

        await journalEntry.save({ transaction });
        await transaction.commit();

        // Fetch updated entry
        const updatedEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: journalEntry.id }),
            include: [
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
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
                },
                {
                    model: JournalEntryLine,
                    as: 'lines',
                    include: [
                        {
                            model: Account,
                            as: 'account',
                            attributes: ['id', 'name', 'code', 'type']
                        },
                        {
                            model: AccountType,
                            as: 'accountType',
                            attributes: ['id', 'name', 'code']
                        },
                        {
                            model: Currency,
                            as: 'currency',
                            attributes: ['id', 'code', 'name', 'symbol'],
                            required: false
                        }
                    ],
                    order: [['lineNumber', 'ASC']]
                }
            ]
        });

        res.json(updatedEntry);
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Failed to update journal entry', details: error.message });
    }
});

// Post a journal entry (create GL entries)
router.post('/:id/post', csrfProtection, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const journalEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [{
                model: JournalEntryLine,
                as: 'lines',
                required: false
            }],
            transaction
        });

        if (!journalEntry) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Journal entry not found' });
        }

        if (journalEntry.isPosted) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Journal entry is already posted' });
        }

        // Validate that journal entry has lines
        if (!journalEntry.lines || journalEntry.lines.length === 0) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Journal entry must have at least one line item before posting' });
        }

        // Validate that debits equal credits
        const totalDebit = journalEntry.totalDebit || 0;
        const totalCredit = journalEntry.totalCredit || 0;
        const difference = Math.abs(totalDebit - totalCredit);
        if (difference > 0.01) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'Journal entry is not balanced. Debits and credits must be equal before posting.',
                totalDebit,
                totalCredit,
                difference
            });
        }

        // Create GL entries (pass transaction to ensure atomicity)
        await createJournalEntryGLEntries(journalEntry, journalEntry.lines, req.user, transaction);

        // Mark as posted
        journalEntry.isPosted = true;
        journalEntry.postedAt = new Date();
        journalEntry.postedBy = req.user.id;
        await journalEntry.save({ transaction });

        await transaction.commit();

        // Fetch updated entry
        const postedEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: journalEntry.id }),
            include: [
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'poster',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: JournalEntryLine,
                    as: 'lines',
                    include: [
                        {
                            model: Account,
                            as: 'account',
                            attributes: ['id', 'name', 'code', 'type']
                        }
                    ],
                    order: [['lineNumber', 'ASC']]
                }
            ]
        });

        res.json(postedEntry);
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ 
            error: 'Failed to post journal entry', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Delete a journal entry (only if not posted)
router.delete('/:id', csrfProtection, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const journalEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!journalEntry) {
            return res.status(404).json({ error: 'Journal entry not found' });
        }

        // Cannot delete if already posted
        if (journalEntry.isPosted) {
            return res.status(403).json({ error: 'Cannot delete a posted journal entry. Unpost it first.' });
        }

        // Delete lines first
        await JournalEntryLine.destroy({
            where: { journalEntryId: journalEntry.id },
            transaction
        });

        // Delete journal entry
        await journalEntry.destroy({ transaction });

        await transaction.commit();

        res.json({ message: 'Journal entry deleted successfully' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Failed to delete journal entry', details: error.message });
    }
});

// Unpost a journal entry (delete GL entries)
router.post('/:id/unpost', csrfProtection, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const journalEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!journalEntry) {
            return res.status(404).json({ error: 'Journal entry not found' });
        }

        if (!journalEntry.isPosted) {
            return res.status(400).json({ error: 'Journal entry is not posted' });
        }

        // Delete GL entries
        await deleteJournalEntryGLEntries(journalEntry.referenceNumber, req.user);

        // Mark as unposted
        journalEntry.isPosted = false;
        journalEntry.postedAt = null;
        journalEntry.postedBy = null;
        await journalEntry.save({ transaction });

        await transaction.commit();

        // Fetch updated entry
        const unpostedEntry = await JournalEntry.findOne({
            where: buildCompanyWhere(req, { id: journalEntry.id }),
            include: [
                {
                    model: FinancialYear,
                    as: 'financialYear',
                    attributes: ['id', 'name', 'startDate', 'endDate']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: JournalEntryLine,
                    as: 'lines',
                    include: [
                        {
                            model: Account,
                            as: 'account',
                            attributes: ['id', 'name', 'code', 'type']
                        }
                    ],
                    order: [['lineNumber', 'ASC']]
                }
            ]
        });

        res.json(unpostedEntry);
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Failed to unpost journal entry', details: error.message });
    }
});

module.exports = router;

