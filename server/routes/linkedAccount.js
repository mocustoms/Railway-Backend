const express = require('express');
const router = express.Router();
const { LinkedAccount, Account, Customer, User, Company, sequelize } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');

router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Account type labels mapping
const ACCOUNT_TYPE_LABELS = {
  customer_deposits: 'Customer Deposits',
  payables: 'Payables',
  receivables: 'Receivables',
  cost_of_goods_sold: 'Cost of Goods Sold',
  inventory: 'Inventory',
  sales_revenue: 'Sales Revenue',
  discounts_allowed: 'Discounts Allowed',
  discounts_received: 'Discounts Received',
  opening_balance_equity: 'Opening Balance Equity',
  current_earnings: 'Current Earnings',
  retained_earnings: 'Retained Earnings',
  sales_returns_liability: 'Sales Returns Liability',
  account_balance: 'Account Balance',
  loyalty_cards: 'Loyalty Cards',
  withholding_tax_payable: 'Withholding Tax Payable',
  cash_customer: 'Cash Customer'
};

// All account types
const ALL_ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS);

// GET /api/linked-accounts - Get all linked accounts for the company
router.get('/', async (req, res) => {
  try {
    const linkedAccounts = await LinkedAccount.findAll({
      where: buildCompanyWhere(req, {}),
      include: [
        {
          model: Account,
          as: 'account',
          attributes: ['id', 'code', 'name', 'type'],
          required: false
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name'],
          required: false
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        },
        {
          model: User,
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ],
      order: [['account_type', 'ASC']]
    });

    // Transform to include all account types (even if not linked yet)
    const linkedAccountsMap = {};
    linkedAccounts.forEach(la => {
      linkedAccountsMap[la.account_type] = {
        id: la.id,
        accountType: la.account_type,
        accountTypeLabel: ACCOUNT_TYPE_LABELS[la.account_type],
        accountId: la.account_id,
        customerId: la.customer_id,
        account: la.account ? {
          id: la.account.id,
          code: la.account.code,
          name: la.account.name,
          type: la.account.type
        } : null,
        customer: la.customer ? {
          id: la.customer.id,
          customer_id: la.customer.customer_id,
          full_name: la.customer.full_name
        } : null,
        createdAt: la.created_at,
        updatedAt: la.updated_at,
        createdBy: la.created_by,
        updatedBy: la.updated_by
      };
    });

    // Ensure all account types are present
    const result = ALL_ACCOUNT_TYPES.map(accountType => {
      if (linkedAccountsMap[accountType]) {
        return linkedAccountsMap[accountType];
      }
      return {
        id: null,
        accountType: accountType,
        accountTypeLabel: ACCOUNT_TYPE_LABELS[accountType],
        accountId: null,
        customerId: null,
        account: null,
        customer: null,
        createdAt: null,
        updatedAt: null,
        createdBy: null,
        updatedBy: null
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching linked accounts:', error);
    res.status(500).json({ error: 'Failed to fetch linked accounts' });
  }
});

// PUT /api/linked-accounts - Update linked accounts (bulk update)
router.put('/', csrfProtection, async (req, res) => {
  try {
    const { linkedAccounts } = req.body; // Array of { accountType, accountId }

    if (!Array.isArray(linkedAccounts)) {
      return res.status(400).json({ error: 'linkedAccounts must be an array' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(403).json({ error: 'Company access required' });
    }

    // Validate account types
    for (const item of linkedAccounts) {
      if (!ALL_ACCOUNT_TYPES.includes(item.accountType)) {
        return res.status(400).json({ 
          error: `Invalid account type: ${item.accountType}` 
        });
      }

      // Validate account belongs to company if provided
      if (item.accountId) {
        const account = await Account.findOne({
          where: buildCompanyWhere(req, { id: item.accountId })
        });
        if (!account) {
          return res.status(400).json({ 
            error: `Account not found or does not belong to your company: ${item.accountType}` 
          });
        }
      }

      // Validate customer belongs to company if provided (for cash_customer type)
      if (item.accountType === 'cash_customer' && item.customerId) {
        const customer = await Customer.findOne({
          where: buildCompanyWhere(req, { id: item.customerId })
        });
        if (!customer) {
          return res.status(400).json({ 
            error: `Customer not found or does not belong to your company: ${item.accountType}` 
          });
        }
      }
    }

    // Update or create each linked account within a transaction
    const transaction = await sequelize.transaction();
    const results = [];
    
    try {
      for (const item of linkedAccounts) {
        try {
          const [linkedAccount, created] = await LinkedAccount.findOrCreate({
            where: buildCompanyWhere(req, { account_type: item.accountType }),
            defaults: {
              companyId: companyId,
              account_type: item.accountType,
              account_id: item.accountId || null,
              customer_id: item.customerId || null,
              created_by: req.user.id,
              updated_by: req.user.id
            },
            transaction
          });

          if (!created) {
            // Update existing
            await linkedAccount.update({
              account_id: item.accountId || null,
              customer_id: item.customerId || null,
              updated_by: req.user.id
            }, { transaction });
          }

          results.push({
            accountType: linkedAccount.account_type,
            accountId: linkedAccount.account_id,
            customerId: linkedAccount.customer_id
          });
        } catch (itemError) {
          console.error(`Error processing linked account ${item.accountType}:`, itemError);
          throw itemError; // Re-throw to trigger transaction rollback
        }
      }
      
      // Commit transaction if all updates succeed
      await transaction.commit();
    } catch (transactionError) {
      // Rollback transaction on any error
      await transaction.rollback();
      throw transactionError; // Re-throw to be caught by outer catch
    }

    res.json({ 
      message: 'Linked accounts updated successfully',
      linkedAccounts: results
    });
  } catch (error) {
    console.error('Error updating linked accounts:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to update linked accounts',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;

