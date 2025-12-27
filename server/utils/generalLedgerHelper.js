const { GeneralLedger, Account, AccountType, Currency, FinancialYear } = require('../models');

/**
 * Create a general ledger entry for an opening balance
 */
async function createGeneralLedgerEntry(openingBalance, user) {
    try {
        // Get account details
        const account = await Account.findByPk(openingBalance.accountId, {
            include: [{ model: AccountType, as: 'accountType' }]
        });

        if (!account) {
            throw new Error('Account not found');
        }
        
        // Get financial year details
        const financialYear = await FinancialYear.findByPk(openingBalance.financialYearId);
        if (!financialYear) {
            throw new Error('Financial year not found');
        }
        
        // Get default currency (with company filter)
        const defaultCurrency = await Currency.findOne({ 
            where: {
                companyId: user.companyId,
                is_default: true
            }
        });
        if (!defaultCurrency) {
            throw new Error('Default currency not found');
        }
        
        // Get original currency if specified
        let originalCurrency = null;
        if (openingBalance.currencyId) {
            originalCurrency = await Currency.findByPk(openingBalance.currencyId);
        }

        // Calculate amounts based on transaction type
        const isDebit = openingBalance.type === 'debit';
        const originalAmount = openingBalance.originalAmount || openingBalance.amount;
        const equivalentAmount = openingBalance.equivalentAmount || openingBalance.amount;
        const exchangeRate = openingBalance.exchangeRate || 1.0;

        // Prepare general ledger data with correct field names matching the model
        const generalLedgerData = {
            financial_year_code: financialYear.name,
            financial_year_id: financialYear.id,
            system_date: new Date(),
            transaction_date: openingBalance.date,
            reference_number: openingBalance.referenceNumber,
            transaction_type: 'OPENING_BALANCE',
            transaction_type_name: 'Opening Balances',
            transaction_type_id: openingBalance.transactionTypeId || null,
            created_by_code: user.id,
            created_by_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
            description: openingBalance.description || `Opening balance for ${account.name}`,
            account_type_code: account.accountType?.code || account.type || 'UNKNOWN',
            account_type_name: account.accountType?.name || account.type || 'Unknown',
            account_type_id: account.accountType ? account.accountType.id : account.accountTypeId,
            account_id: account.id,
            account_name: account.name,
            account_code: account.code,
            account_nature: openingBalance.type,
            exchange_rate: exchangeRate,
            amount: equivalentAmount,
            system_currency_id: defaultCurrency.id,
            user_debit_amount: isDebit ? originalAmount : null,
            user_credit_amount: !isDebit ? originalAmount : null,
            equivalent_debit_amount: isDebit ? equivalentAmount : null,
            equivalent_credit_amount: !isDebit ? equivalentAmount : null,
            username: user.username,
            companyId: user.companyId // Required for multi-tenant support
        };
        
        // Create general ledger entry
        const generalLedgerEntry = await GeneralLedger.create(generalLedgerData);
        
        return generalLedgerEntry;

    } catch (error) {
        throw error;
    }
}

/**
 * Update a general ledger entry for an opening balance
 */
async function updateGeneralLedgerEntry(openingBalance, user) {
    try {
        // Find existing general ledger entry by reference number (with company filter)
        const existingEntry = await GeneralLedger.findOne({
            where: {
                reference_number: openingBalance.referenceNumber,
                companyId: user.companyId
            }
        });

        if (!existingEntry) {
            // If entry doesn't exist, create it instead
            return await createGeneralLedgerEntry(openingBalance, user);
        }

        // Get account details
        const account = await Account.findByPk(openingBalance.accountId, {
            include: [{ model: AccountType, as: 'accountType' }]
        });

        if (!account) {
            throw new Error('Account not found');
        }

        // Get financial year details
        const financialYear = await FinancialYear.findByPk(openingBalance.financialYearId);
        if (!financialYear) {
            throw new Error('Financial year not found');
        }

        // Get default currency (with company filter)
        const defaultCurrency = await Currency.findOne({ 
            where: {
                companyId: user.companyId,
                is_default: true
            }
        });
        if (!defaultCurrency) {
            throw new Error('Default currency not found');
        }

        // Get original currency if specified
        let originalCurrency = null;
        if (openingBalance.currencyId) {
            originalCurrency = await Currency.findByPk(openingBalance.currencyId);
        }

        // Calculate amounts based on transaction type
        const isDebit = openingBalance.type === 'debit';
        const originalAmount = openingBalance.originalAmount || openingBalance.amount;
        const equivalentAmount = openingBalance.equivalentAmount || openingBalance.amount;
        const exchangeRate = openingBalance.exchangeRate || 1.0;

        // Update general ledger entry with correct field names
        await existingEntry.update({
            transaction_date: openingBalance.date,
            description: openingBalance.description || `Opening balance for ${account.name}`,
            account_type_code: account.accountType?.code || account.type || 'UNKNOWN',
            account_type_name: account.accountType?.name || account.type || 'Unknown',
            account_type_id: account.accountType ? account.accountType.id : account.accountTypeId,
            account_name: account.name,
            account_code: account.code,
            account_nature: openingBalance.type,
            exchange_rate: exchangeRate,
            amount: equivalentAmount,
            transaction_type_id: openingBalance.transactionTypeId || null,
            financial_year_id: financialYear.id,
            financial_year_code: financialYear.name,
            system_currency_id: defaultCurrency.id,
            user_debit_amount: isDebit ? originalAmount : null,
            user_credit_amount: !isDebit ? originalAmount : null,
            equivalent_debit_amount: isDebit ? equivalentAmount : null,
            equivalent_credit_amount: !isDebit ? equivalentAmount : null
        });

        return existingEntry;

    } catch (error) {
        throw error;
    }
}

/**
 * Delete a general ledger entry for an opening balance
 */
async function deleteGeneralLedgerEntry(referenceNumber, user = null) {
    try {
        // Build where clause with company filter if user provided
        const whereClause = { reference_number: referenceNumber };
        if (user && user.companyId) {
            whereClause.companyId = user.companyId;
        }

        // Find and delete general ledger entry by reference number
        const deletedCount = await GeneralLedger.destroy({
            where: whereClause
        });

        if (deletedCount > 0) {
            return true;
        } else {
            return false;
        }

    } catch (error) {
        throw error;
    }
}

module.exports = {
    createGeneralLedgerEntry,
    updateGeneralLedgerEntry,
    deleteGeneralLedgerEntry
};