const { GeneralLedger, Account, AccountType, Currency, FinancialYear } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');

/**
 * Create general ledger entries for a journal entry
 */
async function createJournalEntryGLEntries(journalEntry, lines, user, transaction = null) {
    try {
        // Validate inputs
        if (!journalEntry) {
            throw new Error('Journal entry is required');
        }
        
        if (!lines || !Array.isArray(lines) || lines.length === 0) {
            throw new Error('Journal entry must have at least one line item');
        }

        if (!user || !user.companyId) {
            throw new Error('User and company ID are required');
        }

        // Get financial year details (with company filter for security)
        const financialYear = await FinancialYear.findOne({
            where: {
                id: journalEntry.financialYearId,
                companyId: user.companyId
            },
            transaction
        });
        
        if (!financialYear) {
            throw new Error(`Financial year not found for ID: ${journalEntry.financialYearId}`);
        }
        
        // Get default currency (with company filter)
        const defaultCurrency = await Currency.findOne({ 
            where: {
                companyId: user.companyId,
                is_default: true
            },
            transaction
        });
        
        if (!defaultCurrency) {
            throw new Error(`Default currency not found for company: ${user.companyId}`);
        }

        const glEntries = [];

        // Create a GL entry for each line
        for (const line of lines) {
            if (!line || !line.accountId) {
                throw new Error(`Invalid line item: missing account ID at line ${line?.lineNumber || 'unknown'}`);
            }

            // Get account details (with company filter and transaction)
            const account = await Account.findOne({
                where: {
                    id: line.accountId,
                    companyId: user.companyId
                },
                include: [{ 
                    model: AccountType, 
                    as: 'accountType',
                    required: false
                }],
                transaction
            });

            if (!account) {
                throw new Error(`Account not found for line ${line.lineNumber || 'unknown'}. Account ID: ${line.accountId}`);
            }

            // Get original currency from journal entry (entry-level currency)
            let originalCurrency = null;
            if (journalEntry.currencyId) {
                originalCurrency = await Currency.findOne({
                    where: {
                        id: journalEntry.currencyId,
                        companyId: user.companyId
                    },
                    transaction
                });
            }

            // Calculate amounts
            const isDebit = line.type === 'debit';
            // originalAmount: amount in the entry's currency (if different from default)
            // If no originalAmount specified, use amount (assumes default currency)
            const originalAmount = line.originalAmount || line.amount;
            // equivalentAmount: amount converted to default currency
            // This is what gets posted to GL main amount field
            const equivalentAmount = line.equivalentAmount || line.amount;
            const exchangeRate = line.exchangeRate || 1.0;

            // Determine account nature - Account model has nature field (DEBIT/CREDIT)
            // GeneralLedger expects lowercase (debit/credit)
            let accountNature = 'debit'; // Default
            if (account.nature) {
                accountNature = account.nature.toLowerCase();
            } else if (account.accountType && account.accountType.nature) {
                accountNature = account.accountType.nature.toLowerCase();
            }
            
            // Validate account nature
            if (accountNature !== 'debit' && accountNature !== 'credit') {
                throw new Error(`Invalid account nature: ${accountNature}. Must be 'debit' or 'credit'`);
            }

            // Convert entryDate to Date object if it's a string
            let transactionDate = journalEntry.entryDate;
            if (typeof transactionDate === 'string') {
                transactionDate = new Date(transactionDate);
            }

            // Validate required fields
            if (!account.name || !account.code) {
                throw new Error(`Account ${account.id} is missing required fields (name or code)`);
            }

            // Prepare general ledger data
            const generalLedgerData = {
                financial_year_code: financialYear.name,
                financial_year_id: financialYear.id,
                system_date: new Date(),
                transaction_date: transactionDate,
                reference_number: journalEntry.referenceNumber,
                transaction_type: 'JOURNAL_ENTRY',
                transaction_type_name: 'Journal Entry',
                transaction_type_id: null,
                created_by_code: user.id,
                created_by_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
                description: line.description || journalEntry.description || `Journal entry line ${line.lineNumber || 'unknown'}`,
                account_type_code: account.accountType?.code || account.type || 'UNKNOWN',
                account_type_name: account.accountType?.name || account.type || 'Unknown',
                account_type_id: account.accountType ? account.accountType.id : (account.accountTypeId || null),
                account_id: account.id,
                account_name: account.name,
                account_code: account.code,
                account_nature: accountNature,
                exchange_rate: exchangeRate || 1.0,
                amount: equivalentAmount || 0,
                system_currency_id: defaultCurrency.id,
                user_debit_amount: isDebit ? (originalAmount || 0) : null,
                user_credit_amount: !isDebit ? (originalAmount || 0) : null,
                equivalent_debit_amount: isDebit ? (equivalentAmount || 0) : null,
                equivalent_credit_amount: !isDebit ? (equivalentAmount || 0) : null,
                username: user.username,
                companyId: user.companyId
            };
            
            // Create general ledger entry (use transaction if provided)
            try {
                const glEntry = await GeneralLedger.create(generalLedgerData, transaction ? { transaction } : {});
                glEntries.push(glEntry);
            } catch (createError) {
                throw new Error(`Failed to create GL entry for line ${line.lineNumber || 'unknown'}: ${createError.message}`);
            }
        }

        return glEntries;

    } catch (error) {
        throw error;
    }
}

/**
 * Delete general ledger entries for a journal entry
 */
async function deleteJournalEntryGLEntries(referenceNumber, user = null) {
    try {
        // Build where clause with company filter if user provided
        const whereClause = { 
            reference_number: referenceNumber,
            transaction_type: 'JOURNAL_ENTRY'
        };
        if (user && user.companyId) {
            whereClause.companyId = user.companyId;
        }

        // Find and delete general ledger entries by reference number
        const deletedCount = await GeneralLedger.destroy({
            where: whereClause
        });

        return deletedCount;

    } catch (error) {
        throw error;
    }
}

/**
 * Update general ledger entries for a journal entry
 * This deletes old entries and creates new ones
 */
async function updateJournalEntryGLEntries(journalEntry, lines, user, transaction = null) {
    try {
        // Delete existing GL entries
        await deleteJournalEntryGLEntries(journalEntry.referenceNumber, user);
        
        // Create new GL entries (pass transaction if provided)
        return await createJournalEntryGLEntries(journalEntry, lines, user, transaction);

    } catch (error) {
        throw error;
    }
}

/**
 * Get account balance as of a specific date
 * @param {string} accountId - Account ID
 * @param {string} financialYearId - Financial year ID
 * @param {Date} asOfDate - As of date (optional, defaults to current date)
 * @param {string} companyId - Company ID for filtering
 * @param {Object} transaction - Sequelize transaction (optional)
 * @returns {Promise<Object>} Account balance with debit and credit totals
 */
async function getAccountBalance(accountId, financialYearId, asOfDate = null, companyId = null, transaction = null) {
    try {
        // Get financial year
        const financialYear = await FinancialYear.findOne({
            where: companyId ? { id: financialYearId, companyId } : { id: financialYearId },
            transaction
        });

        if (!financialYear) {
            throw new Error(`Financial year not found for ID: ${financialYearId}`);
        }

        // Build where clause
        const whereClause = {
            account_id: accountId,
            financial_year_id: financialYearId
        };

        if (companyId) {
            whereClause.companyId = companyId;
        }

        if (asOfDate) {
            whereClause.transaction_date = {
                [Op.lte]: new Date(asOfDate)
            };
        }

        // Get balance from General Ledger
        // Use findAll with group by account_id to ensure we get results even if no entries exist
        const result = await GeneralLedger.findAll({
            where: whereClause,
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
            raw: true,
            transaction
        });

        // If no entries found, balance is 0
        const balanceRow = result && result.length > 0 ? result[0] : null;
        const totalDebit = parseFloat(balanceRow?.total_debit || 0);
        const totalCredit = parseFloat(balanceRow?.total_credit || 0);
        const balance = totalDebit - totalCredit;

        return {
            accountId,
            financialYearId,
            asOfDate: asOfDate || new Date(),
            totalDebit,
            totalCredit,
            balance
        };
    } catch (error) {
        throw error;
    }
}

module.exports = {
    createJournalEntryGLEntries,
    deleteJournalEntryGLEntries,
    updateJournalEntryGLEntries,
    getAccountBalance
};

