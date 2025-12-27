const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Receipt, ReceiptItem, SalesInvoice, SalesInvoiceItem, Customer, Currency, PaymentType, User, SalesAgent, FinancialYear, Account, BankDetail, Store, Product, sequelize } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');

router.use(auth); // Apply authentication to all routes
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Helper function to transform receipt data for frontend
const transformReceipt = (receipt) => {
  return {
    id: receipt.id,
    receiptReferenceNumber: receipt.receipt_reference_number || receipt.receiptReferenceNumber,
    salesInvoiceId: receipt.sales_invoice_id || receipt.salesInvoiceId,
    salesInvoiceRefNumber: receipt.salesInvoice?.invoice_ref_number || receipt.salesInvoiceRefNumber,
    customerId: receipt.customer_id || receipt.customerId,
    customerName: receipt.customer?.full_name || receipt.customerName,
    customerCode: receipt.customer?.customer_id || receipt.customerCode,
    salesAgentId: receipt.sales_agent_id || receipt.salesAgentId,
    salesAgentName: receipt.salesAgent?.full_name || receipt.salesAgentName,
    paymentAmount: parseFloat(receipt.payment_amount || receipt.paymentAmount || 0),
    currencyId: receipt.currency_id || receipt.currencyId,
    currencyName: receipt.currency?.name || receipt.currencyName,
    currencySymbol: receipt.currency?.symbol || receipt.currencySymbol,
    exchangeRate: parseFloat(receipt.exchange_rate || receipt.exchangeRate || 1),
    exchangeRateId: receipt.exchange_rate_id || receipt.exchangeRateId,
    systemDefaultCurrencyId: receipt.system_default_currency_id || receipt.systemDefaultCurrencyId,
    systemDefaultCurrencyName: receipt.systemDefaultCurrency?.name || receipt.systemDefaultCurrencyName,
    systemDefaultCurrencySymbol: receipt.systemDefaultCurrency?.symbol || receipt.systemDefaultCurrencySymbol,
    equivalentAmount: parseFloat(receipt.equivalent_amount || receipt.equivalentAmount || 0),
    paymentTypeId: receipt.payment_type_id || receipt.paymentTypeId,
    paymentTypeName: receipt.paymentType?.name || receipt.paymentTypeName,
    useCustomerDeposit: receipt.use_customer_deposit || receipt.useCustomerDeposit || false,
    depositAmount: parseFloat(receipt.deposit_amount || receipt.depositAmount || 0),
    useLoyaltyPoints: receipt.use_loyalty_points || receipt.useLoyaltyPoints || false,
    loyaltyPointsAmount: parseFloat(receipt.loyalty_points_amount || receipt.loyaltyPointsAmount || 0),
    loyaltyPointsValue: parseFloat(receipt.loyalty_points_value || receipt.loyaltyPointsValue || 0),
    chequeNumber: receipt.cheque_number || receipt.chequeNumber,
    bankDetailId: receipt.bank_detail_id || receipt.bankDetailId,
    bankDetailName: receipt.bankDetail?.bank_name || receipt.bankDetailName,
    branch: receipt.branch,
    receivableAccountId: receipt.receivable_account_id || receipt.receivableAccountId,
    receivableAccountName: receipt.receivableAccount?.name || receipt.receivableAccountName,
    receivableAccountCode: receipt.receivableAccount?.code || receipt.receivableAccountCode,
    assetAccountId: receipt.asset_account_id || receipt.assetAccountId,
    assetAccountName: receipt.assetAccount?.name || receipt.assetAccountName,
    assetAccountCode: receipt.assetAccount?.code || receipt.assetAccountCode,
    liabilityAccountId: receipt.liability_account_id || receipt.liabilityAccountId,
    liabilityAccountName: receipt.liabilityAccount?.name || receipt.liabilityAccountName,
    liabilityAccountCode: receipt.liabilityAccount?.code || receipt.liabilityAccountCode,
    transactionDate: receipt.transaction_date || receipt.transactionDate,
    financialYearId: receipt.financial_year_id || receipt.financialYearId,
    financialYearName: receipt.financialYear?.name || receipt.financialYearName,
    description: receipt.description,
    status: receipt.status,
    reversedAt: receipt.reversed_at || receipt.reversedAt,
    reversedBy: receipt.reversed_by || receipt.reversedBy,
    reversedByName: receipt.reversedByUser ? `${receipt.reversedByUser.first_name} ${receipt.reversedByUser.last_name}` : receipt.reversedByName,
    reversalReason: receipt.reversal_reason || receipt.reversalReason,
    createdBy: receipt.created_by || receipt.createdBy,
    createdByName: receipt.createdByUser ? `${receipt.createdByUser.first_name} ${receipt.createdByUser.last_name}` : receipt.createdByName,
    updatedBy: receipt.updated_by || receipt.updatedBy,
    updatedByName: receipt.updatedByUser ? `${receipt.updatedByUser.first_name} ${receipt.updatedByUser.last_name}` : receipt.updatedByName,
    createdAt: receipt.created_at || receipt.createdAt,
    updatedAt: receipt.updated_at || receipt.updatedAt,
    items: receipt.items?.map(item => ({
      id: item.id,
      receiptId: item.receipt_id || item.receiptId,
      salesInvoiceId: item.sales_invoice_id || item.salesInvoiceId,
      salesInvoiceItemId: item.sales_invoice_item_id || item.salesInvoiceItemId,
      salesAgentId: item.sales_agent_id || item.salesAgentId,
      paymentAmount: parseFloat(item.payment_amount || item.paymentAmount || 0),
      currencyId: item.currency_id || item.currencyId,
      exchangeRate: parseFloat(item.exchange_rate || item.exchangeRate || 1),
      equivalentAmount: parseFloat(item.equivalent_amount || item.equivalentAmount || 0),
      itemTotal: parseFloat(item.item_total || item.itemTotal || 0),
      itemRemaining: parseFloat(item.item_remaining || item.itemRemaining || 0),
      createdAt: item.created_at || item.createdAt,
      updatedAt: item.updated_at || item.updatedAt,
      product: item.salesInvoiceItem?.product ? {
        id: item.salesInvoiceItem.product.id,
        name: item.salesInvoiceItem.product.name,
        code: item.salesInvoiceItem.product.code
      } : null
    })) || []
  };
};

// GET /api/receipts - Get all receipts with pagination and search
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      customerId,
      salesInvoiceId,
      currencyId,
      paymentTypeId,
      dateFrom,
      dateTo,
      sortBy = 'transaction_date',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClause = {};

    // Build order clause - handle both direct fields and associated model fields
    let orderClause = [];
    
    // Direct fields that can be sorted directly
    const directFields = {
      'createdAt': 'created_at',
      'updatedAt': 'updated_at',
      'receiptRefNumber': 'receipt_reference_number',
      'transactionDate': 'transaction_date',
      'paymentAmount': 'payment_amount',
      'equivalentAmount': 'equivalent_amount',
      'status': 'status'
    };
    
    // Associated model fields that need special handling
    if (sortBy === 'customerName') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'full_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'customerCode') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'customer_id', sortOrder.toUpperCase()]];
    } else if (sortBy === 'salesInvoiceRefNumber') {
      orderClause = [[{ model: SalesInvoice, as: 'salesInvoice' }, 'invoice_ref_number', sortOrder.toUpperCase()]];
    } else if (directFields[sortBy]) {
      // Direct field - use the mapped database column name
      orderClause = [[directFields[sortBy], sortOrder.toUpperCase()]];
    } else {
      // Default to created_at if field not recognized
      orderClause = [['created_at', 'DESC']];
    }

    // Search functionality
    // Note: We can't use associated table fields in the WHERE clause when using findAndCountAll with subqueries
    // So we'll search only on direct Receipt fields here, and handle customer/invoice search separately if needed
    if (search) {
      whereClause[Op.or] = [
        { receipt_reference_number: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Filter by status
    if (status) {
      whereClause.status = status;
    }

    // Filter by customer
    if (customerId) {
      whereClause.customer_id = customerId;
    }

    // Filter by sales invoice
    if (salesInvoiceId) {
      whereClause.sales_invoice_id = salesInvoiceId;
    }

    // Filter by currency
    if (currencyId) {
      whereClause.currency_id = currencyId;
    }

    // Filter by payment type
    if (paymentTypeId) {
      whereClause.payment_type_id = paymentTypeId;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.transaction_date = {};
      if (dateFrom) whereClause.transaction_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.transaction_date[Op.lte] = dateTo;
    }

    const { count, rows } = await Receipt.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          attributes: ['id', 'invoice_ref_number', 'invoice_date', 'total_amount', 'paid_amount', 'balance_amount'],
          include: [
            {
              model: Store,
              as: 'store',
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'phone_number', 'email']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol']
        },
        {
          model: Currency,
          as: 'systemDefaultCurrency',
          attributes: ['id', 'name', 'code', 'symbol']
        },
        {
          model: PaymentType,
          as: 'paymentType',
          attributes: ['id', 'name', 'code']
        },
        {
          model: SalesAgent,
          as: 'salesAgent',
          attributes: ['id', 'agent_number', 'full_name'],
          required: false
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'reversedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: ReceiptItem,
          as: 'items',
          attributes: ['id', 'receipt_id', 'sales_invoice_id', 'sales_invoice_item_id', 'payment_amount', 'currency_id', 'exchange_rate', 'equivalent_amount'],
          required: false,
          include: [
            {
              model: SalesInvoiceItem,
              as: 'salesInvoiceItem',
              attributes: ['id'],
              required: false,
              include: [
                {
                  model: Product,
                  as: 'product',
                  attributes: ['id', 'name', 'code'],
                  required: false
                }
              ]
            }
          ]
        }
      ],
      distinct: true,
      order: orderClause,
      limit: parseInt(limit),
      offset: offset
    });

    const transformedReceipts = rows.map(transformReceipt);

    res.json({
      receipts: transformedReceipts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit)),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/receipts/stats - Get receipt statistics
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalCount,
      activeCount,
      reversedCount,
      cancelledCount,
      totalAmount,
      thisMonthCount,
      lastMonthCount
    ] = await Promise.all([
      Receipt.count({ where: buildCompanyWhere(req) }),
      Receipt.count({ where: buildCompanyWhere(req, { status: 'active' }) }),
      Receipt.count({ where: buildCompanyWhere(req, { status: 'reversed' }) }),
      Receipt.count({ where: buildCompanyWhere(req, { status: 'cancelled' }) }),
      Receipt.sum('equivalent_amount', { where: buildCompanyWhere(req) }),
      Receipt.count({
        where: buildCompanyWhere(req, {
          created_at: { [Op.gte]: startOfMonth }
        })
      }),
      Receipt.count({
        where: buildCompanyWhere(req, {
          created_at: {
            [Op.gte]: startOfLastMonth,
            [Op.lte]: endOfLastMonth
          }
        })
      })
    ]);

    res.json({
      total: totalCount || 0,
      active: activeCount || 0,
      reversed: reversedCount || 0,
      cancelled: cancelledCount || 0,
      totalAmount: totalAmount || 0,
      thisMonth: thisMonthCount || 0,
      lastMonth: lastMonthCount || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/receipts/:id - Get receipt by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await Receipt.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          attributes: ['id', 'invoice_ref_number', 'invoice_date', 'due_date', 'total_amount', 'paid_amount', 'balance_amount', 'status'],
          include: [
            {
              model: Store,
              as: 'store',
              attributes: ['id', 'name']
            },
            {
              model: Customer,
              as: 'customer',
              attributes: ['id', 'customer_id', 'full_name', 'address', 'phone_number', 'email']
            }
          ]
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'phone_number', 'email']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol']
        },
        {
          model: Currency,
          as: 'systemDefaultCurrency',
          attributes: ['id', 'name', 'code', 'symbol']
        },
        {
          model: PaymentType,
          as: 'paymentType',
          attributes: ['id', 'name', 'code']
        },
        {
          model: SalesAgent,
          as: 'salesAgent',
          attributes: ['id', 'agent_number', 'full_name'],
          required: false
        },
        {
          model: FinancialYear,
          as: 'financialYear',
          attributes: ['id', 'name', 'startDate', 'endDate'],
          required: false
        },
        {
          model: Account,
          as: 'receivableAccount',
          attributes: ['id', 'code', 'name']
        },
        {
          model: Account,
          as: 'assetAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'liabilityAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: BankDetail,
          as: 'bankDetail',
          attributes: ['id', 'bank_name', 'account_number'],
          required: false
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'reversedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: ReceiptItem,
          as: 'items',
          include: [
            {
              model: SalesInvoice,
              as: 'salesInvoice',
              attributes: ['id', 'invoice_ref_number']
            },
            {
              model: SalesInvoiceItem,
              as: 'salesInvoiceItem',
              attributes: ['id'],
              include: [
                {
                  model: Product,
                  as: 'product',
                  attributes: ['id', 'name', 'code'],
                  required: false
                }
              ],
              required: false
            }
          ]
        }
      ]
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    const transformedReceipt = transformReceipt(receipt);
    res.json(transformedReceipt);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT /api/receipts/:id/void - Void a receipt
router.put('/:id/void', csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { reversalReason } = req.body;

    // Find receipt with all necessary associations
    const receipt = await Receipt.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          attributes: ['id', 'invoice_ref_number', 'customer_id', 'paid_amount', 'total_amount', 'currency_id']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'full_name', 'debt_balance', 'deposit_balance', 'loyalty_points']
        },
        {
          model: Account,
          as: 'receivableAccount',
          attributes: ['id', 'code', 'name', 'type']
        },
        {
          model: Account,
          as: 'assetAccount',
          attributes: ['id', 'code', 'name', 'type'],
          required: false
        },
        {
          model: Account,
          as: 'liabilityAccount',
          attributes: ['id', 'code', 'name', 'type'],
          required: false
        },
        {
          model: FinancialYear,
          as: 'financialYear',
          attributes: ['id', 'name']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'code', 'name', 'symbol']
        },
        {
          model: PaymentType,
          as: 'paymentType',
          attributes: ['id', 'name'],
          required: false
        }
      ],
      transaction
    });

    if (!receipt) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Receipt not found' });
    }

    // Validate receipt can be voided
    if (receipt.status !== 'active') {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Receipt cannot be voided. Current status: ${receipt.status}` 
      });
    }

    // Get all GL entries for this receipt (using invoice reference number)
    const { GeneralLedger } = require('../models');
    const { TransactionType } = require('../models');
    
    // Get transaction type for reversals
    let reversalTransactionType = await TransactionType.findOne({ 
      where: { code: 'RECEIPT_REVERSAL' }
    });
    
    if (!reversalTransactionType) {
      reversalTransactionType = await TransactionType.create({
        companyId: null,
        code: 'RECEIPT_REVERSAL',
        name: 'Receipt Reversal',
        description: 'Receipt reversal transactions'
      }, { transaction });
    }

    // Find all GL entries for this payment (using invoice reference number and transaction type)
    // All GL entries for a payment are created with the same general_ledger_id
    // We'll find the receivable credit entry that matches this receipt, then get all entries with the same general_ledger_id
    const receivableGLEntry = await GeneralLedger.findOne({
      where: buildCompanyWhere(req, {
        reference_number: receipt.salesInvoice.invoice_ref_number,
        transaction_type: 'INVOICE_PAYMENT',
        account_id: receipt.receivableAccountId,
        account_nature: 'credit',
        user_credit_amount: {
          [Op.between]: [
            parseFloat(receipt.paymentAmount) - 0.01,
            parseFloat(receipt.paymentAmount) + 0.01
          ]
        }
      }),
      transaction
    });

    if (!receivableGLEntry || !receivableGLEntry.general_ledger_id) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Could not find General Ledger entry for this receipt. Cannot void receipt.' 
      });
    }

    // Get all GL entries with the same general_ledger_id (this includes all entries for this payment: asset, liability, WHT, receivable)
    const glEntriesToReverse = await GeneralLedger.findAll({
      where: buildCompanyWhere(req, {
        general_ledger_id: receivableGLEntry.general_ledger_id,
        transaction_type: 'INVOICE_PAYMENT'
      }),
      order: [['created_at', 'ASC']],
      transaction
    });

    if (glEntriesToReverse.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Could not find General Ledger entries for this receipt. Cannot void receipt.' 
      });
    }

    // Create reversal GL entries (opposite nature, same amounts)
    const reversalGLId = require('uuid').v4();
    const reversalDate = new Date();

    for (const glEntry of glEntriesToReverse) {
      // Reverse the nature (debit becomes credit, credit becomes debit)
      const reversedNature = glEntry.account_nature === 'debit' ? 'credit' : 'debit';
      
      await GeneralLedger.create({
        id: require('uuid').v4(),
        financial_year_code: receipt.financialYear.name,
        financial_year_id: receipt.financialYear.id,
        system_date: reversalDate,
        transaction_date: receipt.transactionDate,
        reference_number: receipt.receiptReferenceNumber, // Use receipt reference for reversal
        transaction_type: 'RECEIPT_REVERSAL',
        transaction_type_name: 'Receipt Reversal',
        transaction_type_id: reversalTransactionType.id,
        created_by_code: req.user.id,
        created_by_name: `${req.user.first_name} ${req.user.last_name}`,
        description: `Reversal: ${glEntry.description || 'Receipt reversal'}`,
        account_type_code: glEntry.account_type_code,
        account_type_name: glEntry.account_type_name,
        account_type_id: glEntry.account_type_id,
        account_id: glEntry.account_id,
        account_name: glEntry.account_name,
        account_code: glEntry.account_code,
        account_nature: reversedNature,
        exchange_rate: glEntry.exchange_rate,
        amount: glEntry.amount,
        system_currency_id: glEntry.system_currency_id,
        user_debit_amount: reversedNature === 'debit' ? glEntry.user_debit_amount || glEntry.user_credit_amount : null,
        user_credit_amount: reversedNature === 'credit' ? glEntry.user_credit_amount || glEntry.user_debit_amount : null,
        equivalent_debit_amount: reversedNature === 'debit' ? glEntry.equivalent_debit_amount || glEntry.equivalent_credit_amount : null,
        equivalent_credit_amount: reversedNature === 'credit' ? glEntry.equivalent_credit_amount || glEntry.equivalent_debit_amount : null,
        username: req.user.username,
        general_ledger_id: reversalGLId,
        companyId: req.user.companyId
      }, { transaction });
    }

    // Reverse customer balance changes
    // Increment debt_balance (reverse the decrement)
    await Customer.increment('debt_balance', {
      by: receipt.equivalentAmount,
      where: buildCompanyWhere(req, { id: receipt.customerId }),
      transaction
    });

    // Increment deposit_balance if deposit was used
    if (receipt.useCustomerDeposit && receipt.depositAmount > 0) {
      await Customer.increment('deposit_balance', {
        by: receipt.depositAmount * receipt.exchangeRate,
        where: buildCompanyWhere(req, { id: receipt.customerId }),
        transaction
      });
    }

    // Increment loyalty_points if loyalty points were used
    if (receipt.useLoyaltyPoints && receipt.loyaltyPointsAmount > 0) {
      await Customer.increment('loyalty_points', {
        by: receipt.loyaltyPointsAmount,
        where: buildCompanyWhere(req, { id: receipt.customerId }),
        transaction
      });
    }

    // Update receipt status
    await receipt.update({
      status: 'reversed',
      reversedAt: reversalDate,
      reversedBy: req.user.id,
      reversalReason: reversalReason || null,
      updatedBy: req.user.id
    }, { transaction });

    // Delete receipt items (this will cause invoice paid amounts to be recalculated)
    await ReceiptItem.destroy({
      where: buildCompanyWhere(req, { receiptId: receipt.id }),
      transaction
    });

    // Recalculate invoice paid amount from remaining receipt items
    const { ReceiptItem: ReceiptItemModel } = require('../models');
    const remainingReceiptItems = await ReceiptItemModel.findAll({
      where: buildCompanyWhere(req, { 
        salesInvoiceId: receipt.salesInvoiceId 
      }),
      attributes: [
        [sequelize.fn('SUM', sequelize.col('ReceiptItem.payment_amount')), 'total_paid']
      ],
      group: [],
      raw: true,
      transaction
    });

    const newPaidAmount = remainingReceiptItems.length > 0 
      ? parseFloat(remainingReceiptItems[0].total_paid || 0) 
      : 0;

    // Update invoice paid amount
    await SalesInvoice.update(
      { paid_amount: newPaidAmount },
      { 
        where: buildCompanyWhere(req, { id: receipt.salesInvoiceId }),
        transaction
      }
    );

    // Commit transaction
    await transaction.commit();

    // Fetch updated receipt
    const updatedReceipt = await Receipt.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          attributes: ['id', 'invoice_ref_number']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'full_name']
        },
        {
          model: User,
          as: 'reversedByUser',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ]
    });

    res.json({
      message: 'Receipt voided successfully',
      receipt: transformReceipt(updatedReceipt)
    });

  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ 
      message: 'Error voiding receipt', 
      error: error.message 
    });
  }
});

module.exports = router;

