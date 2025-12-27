const GeneralLedger = require('../models/generalLedger');
const Account = require('../models/account');
const AccountType = require('../models/accountType');
const User = require('../models/user');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');

class GeneralLedgerService {
    /**
     * Record a transaction in the general ledger
     * @param {Object} transactionData - Transaction data
     * @returns {Promise<Object>} Created GL entry
     */
    static async recordTransaction(transactionData) {
        try {
            const {
                financial_year_code,
                financial_year_id,
                system_date,
                transaction_date,
                reference_number,
                transaction_type,
                transaction_type_name,
                transaction_type_id,
                created_by_code,
                created_by_name,
                username,
                description,
                account_type_code,
                account_type_name,
                account_type_id,
                account_id,
                account_name,
                account_code,
                account_nature,
                exchange_rate,
                amount,
                system_currency_id,
                user_debit_amount,
                user_credit_amount,
                equivalent_debit_amount,
                equivalent_credit_amount
            } = transactionData;

            // Calculate debit and credit amounts based on account nature
            const isDebit = account_nature === 'debit';
            const isCredit = account_nature === 'credit';
            
            // Use the provided amounts directly
            const finalUserDebitAmount = user_debit_amount || 0;
            const finalUserCreditAmount = user_credit_amount || 0;
            const finalEquivalentDebitAmount = equivalent_debit_amount || 0;
            const finalEquivalentCreditAmount = equivalent_credit_amount || 0;

            const glEntry = await GeneralLedger.create({
                financial_year_code,
                financial_year_id,
                system_date: system_date || new Date(),
                transaction_date,
                reference_number,
                transaction_type,
                transaction_type_name,
                transaction_type_id,
                created_by_code,
                created_by_name,
                username,
                description,
                account_type_code,
                account_type_name,
                account_type_id,
                account_id,
                account_name,
                account_code,
                account_nature,
                exchange_rate,
                amount,
                system_currency_id,
                user_debit_amount,
                user_credit_amount,
                equivalent_debit_amount,
                equivalent_credit_amount
            });

            return glEntry;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Create double-entry GL entries for stock adjustment
     * @param {Object} adjustmentData - Stock adjustment data
     * @returns {Promise<Array>} Created GL entries
     */
    static async createStockAdjustmentEntries(adjustmentData) {
        const entries = [];

        try {
            // Debit entry (inventory account)
            const debitEntry = await this.recordTransaction({
                ...adjustmentData,
                account_nature: 'debit',
                amount: adjustmentData.amount
            });
            entries.push(debitEntry);

            // Credit entry (adjustment reason account)
            if (adjustmentData.credit_account_id && adjustmentData.credit_account_id !== adjustmentData.account_id) {
                const creditEntry = await this.recordTransaction({
                    ...adjustmentData,
                    account_id: adjustmentData.credit_account_id,
                    account_name: adjustmentData.credit_account_name,
                    account_code: adjustmentData.credit_account_code,
                    account_nature: 'credit',
                    amount: adjustmentData.amount
                });
                entries.push(creditEntry);
            }

            return entries;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get GL entries for a specific reference
     * @param {string} referenceNumber - Reference number
     * @param {string} transactionType - Transaction type (optional)
     * @returns {Promise<Array>} GL entries
     */
    static async getEntriesByReference(referenceNumber, transactionType = null) {
        const whereClause = { reference_number: referenceNumber };
        
        if (transactionType) {
            whereClause.transaction_type = transactionType;
        }

        return await GeneralLedger.findAll({
            where: whereClause,
            order: [['transaction_date', 'DESC'], ['created_at', 'DESC']]
        });
    }

    /**
     * Get account balance for a specific period
     * @param {string} accountId - Account ID
     * @param {string} financialYearCode - Financial year code
     * @param {Date} startDate - Start date (optional)
     * @param {Date} endDate - End date (optional)
     * @returns {Promise<Object>} Account balance
     */
    static async getAccountBalance(accountId, financialYearCode, startDate = null, endDate = null) {
        const whereClause = {
            account_id: accountId,
            financial_year_code: financialYearCode
        };

        if (startDate || endDate) {
            whereClause.transaction_date = {};
            if (startDate) whereClause.transaction_date[Op.gte] = startDate;
            if (endDate) whereClause.transaction_date[Op.lte] = endDate;
        }

        const result = await GeneralLedger.findOne({
            where: whereClause,
            attributes: [
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN account_nature = 'debit' THEN amount ELSE 0 END")), 'total_debits'],
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN account_nature = 'credit' THEN amount ELSE 0 END")), 'total_credits']
            ]
        });

        const totalDebits = parseFloat(result.dataValues.total_debits || 0);
        const totalCredits = parseFloat(result.dataValues.total_credits || 0);

        return {
            account_id: accountId,
            financial_year_code: financialYearCode,
            period: { start_date: startDate, end_date: endDate },
            total_debits: totalDebits,
            total_credits: totalCredits,
            net_balance: totalDebits - totalCredits
        };
    }

    /**
     * Get trial balance for a financial year
     * @param {string} financialYearCode - Financial year code
     * @param {Date} asOfDate - As of date (optional)
     * @returns {Promise<Array>} Trial balance
     */
    static async getTrialBalance(financialYearCode, asOfDate = null) {
        const whereClause = {
            financial_year_code: financialYearCode
        };

        if (asOfDate) {
            whereClause.transaction_date = { [Op.lte]: asOfDate };
        }

        const result = await GeneralLedger.findAll({
            where: whereClause,
            attributes: [
                'account_id',
                'account_name',
                'account_code',
                'account_type_code',
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN account_nature = 'debit' THEN amount ELSE 0 END")), 'total_debits'],
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN account_nature = 'credit' THEN amount ELSE 0 END")), 'total_credits']
            ],
            group: ['account_id', 'account_name', 'account_code', 'account_type_code'],
            order: [['account_code', 'ASC']]
        });

        return result.map(row => ({
            account_id: row.account_id,
            account_name: row.account_name,
            account_code: row.account_code,
            account_type_code: row.account_type_code,
            total_debits: parseFloat(row.dataValues.total_debits || 0),
            total_credits: parseFloat(row.dataValues.total_credits || 0),
            net_balance: parseFloat(row.dataValues.total_debits || 0) - parseFloat(row.dataValues.total_credits || 0)
        }));
    }
}

module.exports = GeneralLedgerService; 