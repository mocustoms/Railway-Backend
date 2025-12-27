const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { SalesInvoice, SalesInvoiceItem, SalesOrder, ProformaInvoice, SalesAgent, FinancialYear, User, Store, Customer, Currency, ExchangeRate, Product, TaxCode, PriceCategory, Account, GeneralLedger, TransactionType, Receipt, ReceiptItem, ReceiptTransaction, sequelize } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ExportService = require('../utils/exportService');
const { createTransactionFromInvoice, updateTransactionFromInvoice } = require('../utils/salesTransactionHelper');
const { approveSalesInvoice } = require('../utils/salesInvoiceApprovalHelper');

router.use(auth); // Apply authentication to all routes
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks // Apply company filtering to all routes

// Helper function to generate sales invoice reference number (sequential across dates)
// IMPORTANT: This is per-company sequential. The sequence continues across dates.
// Example: INV-20251106-0001 → INV-20251107-0002 → INV-20251107-0003 → INV-20251108-0004
// Different companies CAN have the same reference number (e.g., Company A and Company B can both have INV-20251107-0001)
// The unique constraint is composite: ['invoice_ref_number', 'companyId'], allowing duplicates across companies.
// Uses Sequelize ORM with buildCompanyWhere to ensure proper multi-tenant filtering
const generateInvoiceRefNumber = async (req) => {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  const companyId = req.user?.companyId;
  
  if (!companyId) {
    throw new Error('Company ID is required to generate invoice reference number');
  }
  
  // Get the LAST invoice for this company (regardless of date) to continue the sequence
  // Order by invoice_ref_number DESC to get the highest sequence number
  const lastInvoice = await SalesInvoice.findOne({
    where: buildCompanyWhere(req, {
      invoice_ref_number: {
        [Op.like]: 'INV-%' // Match any date
      }
    }),
    attributes: ['invoice_ref_number'],
    order: [['invoice_ref_number', 'DESC']]
  });
  
  // Extract the sequence number from the last invoice
  let nextSequence = 1;
  if (lastInvoice && lastInvoice.invoice_ref_number) {
    const match = lastInvoice.invoice_ref_number.match(/INV-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }
  
  // Generate the reference number with today's date and the next sequence number
  const referenceNumber = `INV-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  
  // Double-check that this number doesn't exist (safety check, filtered by company)
  const existing = await SalesInvoice.findOne({
    where: buildCompanyWhere(req, { invoice_ref_number: referenceNumber }),
    attributes: ['id']
  });
  
  if (existing) {
    // If it exists (shouldn't happen, but safety check), increment and try again
    nextSequence++;
    return `INV-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  }
  
  return referenceNumber;
};

// Helper function to generate receipt reference number (sequential across dates)
// IMPORTANT: This is per-company sequential. The sequence continues across dates.
// Example: RCP-20251106-0001 → RCP-20251107-0002 → RCP-20251107-0003 → RCP-20251108-0004
// Different companies CAN have the same reference number (e.g., Company A and Company B can both have RCP-20251107-0001)
// The unique constraint is composite: ['receipt_reference_number', 'companyId'], allowing duplicates across companies.
// Uses Sequelize ORM with buildCompanyWhere to ensure proper multi-tenant filtering
const generateReceiptRefNumber = async (req) => {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  const companyId = req.user?.companyId;
  
  if (!companyId) {
    throw new Error('Company ID is required to generate receipt reference number');
  }
  
  // Get the LAST receipt for this company (regardless of date) to continue the sequence
  // Order by receipt_reference_number DESC to get the highest sequence number
  // Only get receipts that have a non-null reference number
  const lastReceipt = await Receipt.findOne({
    where: {
      ...buildCompanyWhere(req, {}),
      receipt_reference_number: {
        [Op.not]: null,
        [Op.like]: 'RCP-%' // Match any date
      }
    },
    attributes: ['receipt_reference_number'],
    order: [['receipt_reference_number', 'DESC']]
  });
  
  // Extract the sequence number from the last receipt
  let nextSequence = 1;
  if (lastReceipt && lastReceipt.receipt_reference_number) {
    const match = lastReceipt.receipt_reference_number.match(/RCP-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }
  
  // Keep trying until we find a unique reference number
  // This handles race conditions where multiple requests generate the same number
  const maxAttempts = 100; // Safety limit to prevent infinite loops
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    // Generate the reference number with today's date and the next sequence number
    const referenceNumber = `RCP-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
    
    // Double-check that this number doesn't exist (safety check, filtered by company)
    try {
      const existing = await Receipt.findOne({
        where: buildCompanyWhere(req, { receipt_reference_number: referenceNumber }),
        attributes: ['id']
      });
      
      if (!existing) {
        return referenceNumber;
      }
    } catch (queryError) {
      // If query fails, try next sequence anyway
    }
    
    nextSequence++;
    attempts++;
  }
  
  // If we've exhausted all attempts, throw an error
  throw new Error(`Failed to generate unique receipt reference number after ${maxAttempts} attempts`);
};

// Helper function to transform sales invoice data
const transformSalesInvoice = (invoice) => {
  return {
    id: invoice.id,
    invoiceRefNumber: invoice.invoice_ref_number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    storeId: invoice.store_id,
    storeName: invoice.store?.name,
    customerId: invoice.customer_id,
    customerName: invoice.customer?.full_name,
    customerCode: invoice.customer?.customer_id,
    customerAddress: invoice.customer?.address,
    customerFax: invoice.customer?.fax,
    customerPhone: invoice.customer?.phone_number,
    customerEmail: invoice.customer?.email,
    salesOrderId: invoice.sales_order_id,
    salesOrderRefNumber: invoice.salesOrder?.sales_order_ref_number,
    proformaInvoiceId: invoice.proforma_invoice_id,
    proformaRefNumber: invoice.proformaInvoice?.proforma_ref_number,
    salesAgentId: invoice.sales_agent_id,
    salesAgentName: invoice.salesAgent?.full_name,
    salesAgentNumber: invoice.salesAgent?.agent_number,
    discountAllowedAccountId: invoice.discount_allowed_account_id,
    discountAllowedAccount: invoice.discountAllowedAccount ? {
      id: invoice.discountAllowedAccount.id,
      code: invoice.discountAllowedAccount.code,
      name: invoice.discountAllowedAccount.name
    } : null,
    accountReceivableId: invoice.account_receivable_id,
    accountReceivable: invoice.accountReceivable ? {
      id: invoice.accountReceivable.id,
      code: invoice.accountReceivable.code,
      name: invoice.accountReceivable.name
    } : null,
    currencyId: invoice.currency_id,
    currencyName: invoice.currency?.name,
    currencySymbol: invoice.currency?.symbol,
    exchangeRate: invoice.exchange_rate,
    exchangeRateValue: invoice.exchange_rate ? parseFloat(invoice.exchange_rate) : null,
    systemDefaultCurrencyId: invoice.system_default_currency_id,
    exchangeRateId: invoice.exchange_rate_id,
    priceCategoryId: invoice.price_category_id,
    priceCategory: invoice.priceCategory,
    subtotal: parseFloat(invoice.subtotal),
    taxAmount: parseFloat(invoice.tax_amount),
    discountAmount: parseFloat(invoice.discount_amount),
    totalAmount: parseFloat(invoice.total_amount),
    amountAfterDiscount: invoice.amount_after_discount ? parseFloat(invoice.amount_after_discount) : null,
    totalWhtAmount: invoice.total_wht_amount ? parseFloat(invoice.total_wht_amount) : null,
    amountAfterWht: invoice.amount_after_wht ? parseFloat(invoice.amount_after_wht) : null,
    equivalentAmount: invoice.equivalent_amount ? parseFloat(invoice.equivalent_amount) : null,
    paidAmount: invoice.paid_amount ? parseFloat(invoice.paid_amount) : null,
    balanceAmount: invoice.balance_amount ? parseFloat(invoice.balance_amount) : null,
    paymentStatus: invoice.payment_status || 'unpaid',
    status: invoice.status,
    scheduledType: invoice.scheduled_type || 'not_scheduled',
    recurringPeriod: invoice.recurring_period,
    scheduledDate: invoice.scheduled_date,
    recurringDayOfWeek: invoice.recurring_day_of_week,
    recurringDate: invoice.recurring_date,
    recurringMonth: invoice.recurring_month,
    startTime: invoice.start_time,
    endTime: invoice.end_time,
    parentInvoiceId: invoice.parent_invoice_id,
    notes: invoice.notes,
    termsConditions: invoice.terms_conditions,
    createdBy: invoice.created_by,
    createdByName: invoice.createdByUser ? `${invoice.createdByUser.first_name} ${invoice.createdByUser.last_name}` : 'System',
    updatedBy: invoice.updated_by,
    updatedByName: invoice.updatedByUser ? `${invoice.updatedByUser.first_name} ${invoice.updatedByUser.last_name}` : null,
    sentBy: invoice.sent_by,
    sentByName: invoice.sentByUser ? `${invoice.sentByUser.first_name} ${invoice.sentByUser.last_name}` : null,
    sentAt: invoice.sent_at,
    paidAt: invoice.paid_at,
    cancelledBy: invoice.cancelled_by,
    cancelledByName: invoice.cancelledByUser ? `${invoice.cancelledByUser.first_name} ${invoice.cancelledByUser.last_name}` : null,
    cancelledAt: invoice.cancelled_at,
    cancellationReason: invoice.cancellation_reason,
    rejectedBy: invoice.rejected_by,
    rejectedByName: invoice.rejectedByUser ? `${invoice.rejectedByUser.first_name} ${invoice.rejectedByUser.last_name}` : null,
    rejectedAt: invoice.rejected_at,
    rejectionReason: invoice.rejection_reason,
    approvedBy: invoice.approved_by,
    approvedByName: invoice.approvedByUser ? `${invoice.approvedByUser.first_name} ${invoice.approvedByUser.last_name}` : null,
    approvedAt: invoice.approved_at,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
    items: invoice.items?.map(item => ({
      id: item.id,
      salesInvoiceId: item.sales_invoice_id,
      productId: item.product_id,
      productName: item.product?.name,
      productCode: item.product?.code,
      quantity: parseFloat(item.quantity),
      unitPrice: parseFloat(item.unit_price),
      discountPercentage: item.discount_percentage ? parseFloat(item.discount_percentage) : null,
      discountAmount: item.discount_amount ? parseFloat(item.discount_amount) : null,
      taxPercentage: item.tax_percentage ? parseFloat(item.tax_percentage) : null,
      taxAmount: item.tax_amount ? parseFloat(item.tax_amount) : null,
      salesTaxId: item.sales_tax_id || null,
      salesTaxCode: item.salesTaxCode ? {
        id: item.salesTaxCode.id,
        code: item.salesTaxCode.code,
        name: item.salesTaxCode.name,
        rate: parseFloat(item.salesTaxCode.rate),
        indicator: item.salesTaxCode.indicator
      } : null,
      whtTaxId: item.wht_tax_id || null,
      whtTaxCode: item.whtTaxCode ? {
        id: item.whtTaxCode.id,
        code: item.whtTaxCode.code,
        name: item.whtTaxCode.name,
        rate: parseFloat(item.whtTaxCode.rate),
        indicator: item.whtTaxCode.indicator
      } : null,
      whtAmount: item.wht_amount ? parseFloat(item.wht_amount) : null,
      priceTaxInclusive: item.price_tax_inclusive || false,
      currencyId: item.currency_id || null,
      currency: item.currency ? {
        id: item.currency.id,
        name: item.currency.name,
        code: item.currency.code,
        symbol: item.currency.symbol
      } : null,
      exchangeRate: item.exchange_rate ? parseFloat(item.exchange_rate) : null,
      equivalentAmount: item.equivalent_amount ? parseFloat(item.equivalent_amount) : null,
      amountAfterDiscount: item.amount_after_discount ? parseFloat(item.amount_after_discount) : null,
      amountAfterWht: item.amount_after_wht ? parseFloat(item.amount_after_wht) : null,
      lineTotal: parseFloat(item.line_total),
      notes: item.notes,
      serialNumbers: item.serial_numbers || [],
      batchNumber: item.batch_number || null,
      expiryDate: item.expiry_date || null,
      createdBy: item.created_by,
      updatedBy: item.updated_by,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      product: item.product,
      createdByUser: item.createdByUser,
      updatedByUser: item.updatedByUser
    })) || [],
    store: invoice.store,
    customer: invoice.customer,
    salesOrder: invoice.salesOrder,
    proformaInvoice: invoice.proformaInvoice,
    currency: invoice.currency,
    systemDefaultCurrency: invoice.systemDefaultCurrency,
    exchangeRateRecord: invoice.exchangeRate,
    createdByUser: invoice.createdByUser,
    updatedByUser: invoice.updatedByUser,
    sentByUser: invoice.sentByUser,
    cancelledByUser: invoice.cancelledByUser,
    rejectedByUser: invoice.rejectedByUser,
    approvedByUser: invoice.approvedByUser
  };
};

// GET /api/sales-invoices - Get all sales invoices with pagination and search
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      paymentStatus, // New filter for payment status
      storeId,
      customerId,
      currencyId,
      dateFrom,
      dateTo,
      sortBy = 'created_at',
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
      'invoiceRefNumber': 'invoice_ref_number',
      'invoiceDate': 'invoice_date',
      'dueDate': 'due_date',
      'totalAmount': 'total_amount',
      'status': 'status',
      'paymentStatus': 'payment_status',
      'sentAt': 'sent_at',
      'paidAt': 'paid_at',
      'cancelledAt': 'cancelled_at',
      'approvedAt': 'approved_at'
    };
    
    // Associated model fields that need special handling
    if (sortBy === 'customerName') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'full_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'customerCode') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'customer_id', sortOrder.toUpperCase()]];
    } else if (sortBy === 'storeName') {
      orderClause = [[{ model: Store, as: 'store' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'sentByName') {
      orderClause = [[{ model: User, as: 'sentByUser' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'cancelledByName') {
      orderClause = [[{ model: User, as: 'cancelledByUser' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'createdBy') {
      orderClause = [[{ model: User, as: 'createdByUser' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'updatedBy') {
      orderClause = [[{ model: User, as: 'updatedByUser' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (directFields[sortBy]) {
      // Direct field - use the mapped database column name
      orderClause = [[directFields[sortBy], sortOrder.toUpperCase()]];
    } else {
      // Default to created_at if field not recognized
      orderClause = [['created_at', 'DESC']];
    }

    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { invoice_ref_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Filter by status
    if (status) {
      whereClause.status = status;
    }

    // Filter by payment status
    if (paymentStatus) {
      whereClause.payment_status = paymentStatus;
    }

    // Filter by store
    if (storeId) {
      whereClause.store_id = storeId;
    }

    // Filter by customer
    if (customerId) {
      whereClause.customer_id = customerId;
    }

    // Filter by currency
    if (currencyId) {
      whereClause.currency_id = currencyId;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.invoice_date = {};
      if (dateFrom) whereClause.invoice_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.invoice_date[Op.lte] = dateTo;
    }

    const { count, rows } = await SalesInvoice.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'fax', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points']
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
          model: ExchangeRate,
          as: 'exchangeRate',
          attributes: ['id', 'from_currency_id', 'to_currency_id', 'rate', 'effective_date'],
          required: false
        },
        {
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'code', 'name', 'price_change_type', 'percentage_change']
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
          as: 'sentByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'cancelledByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'approvedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: SalesOrder,
          as: 'salesOrder',
          attributes: ['id', 'sales_order_ref_number'],
          required: false
        },
        {
          model: ProformaInvoice,
          as: 'proformaInvoice',
          attributes: ['id', 'proforma_ref_number'],
          required: false
        },
        {
          model: SalesAgent,
          as: 'salesAgent',
          attributes: ['id', 'agent_number', 'full_name'],
          required: false
        },
        {
          model: Account,
          as: 'discountAllowedAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'accountReceivable',
          attributes: ['id', 'code', 'name'],
          required: false
        }
      ],
      order: orderClause,
      limit: parseInt(limit),
      offset: offset
    });

    // Check and update overdue status for invoices with due_date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const invoice of rows) {
      if (invoice.due_date && invoice.status !== 'paid' && invoice.status !== 'cancelled' && invoice.status !== 'overdue') {
        const dueDate = new Date(invoice.due_date);
        dueDate.setHours(0, 0, 0, 0);
        
        if (dueDate < today) {
          // Invoice is overdue, update status
          await invoice.update({ status: 'overdue' });
          invoice.status = 'overdue';
        }
      }
    }

    const transformedInvoices = rows.map(transformSalesInvoice);

    res.json({
      salesInvoices: transformedInvoices,
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

// GET /api/sales-invoices/all - Get all active sales orders for dropdowns
router.get('/all', async (req, res) => {
  try {
    const invoices = await SalesInvoice.findAll({
      where: buildCompanyWhere(req, {
        status: { [Op.in]: ['draft', 'sent', 'paid', 'partial_paid'] }
      }),
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name']
        },
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        }
      ],
      order: [['invoice_ref_number', 'DESC']],
      limit: 100
    });

    const transformedInvoices = invoices.map(transformSalesInvoice);
    res.json(transformedInvoices);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-invoices/stats - Get sales invoice statistics
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalCount,
      draftCount,
      sentCount,
      paidCount,
      partialPaidCount,
      overdueCount,
      cancelledCount,
      totalValue,
      thisMonthCount,
      lastMonthCount
    ] = await Promise.all([
      SalesInvoice.count({ where: buildCompanyWhere(req) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'draft' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'sent' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'paid' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'partial_paid' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'overdue' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'cancelled' }) }),
      SalesInvoice.sum('equivalent_amount', { where: buildCompanyWhere(req) }),
      SalesInvoice.count({
        where: buildCompanyWhere(req, {
          created_at: { [Op.gte]: startOfMonth }
        })
      }),
      SalesInvoice.count({
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
      draft: draftCount || 0,
      sent: sentCount || 0,
      paid: paidCount || 0,
      partialPaid: partialPaidCount || 0,
      overdue: overdueCount || 0,
      cancelled: cancelledCount || 0,
      totalValue: totalValue || 0,
      thisMonth: thisMonthCount || 0,
      lastMonth: lastMonthCount || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-invoices/stats/overview - Get sales invoice statistics (alias)
router.get('/stats/overview', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalCount,
      draftCount,
      sentCount,
      paidCount,
      partialPaidCount,
      overdueCount,
      cancelledCount,
      totalValue,
      thisMonthCount,
      lastMonthCount
    ] = await Promise.all([
      SalesInvoice.count({ where: buildCompanyWhere(req) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'draft' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'sent' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'paid' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'partial_paid' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'overdue' }) }),
      SalesInvoice.count({ where: buildCompanyWhere(req, { status: 'cancelled' }) }),
      SalesInvoice.sum('equivalent_amount', { where: buildCompanyWhere(req) }),
      SalesInvoice.count({
        where: buildCompanyWhere(req, {
          created_at: { [Op.gte]: startOfMonth }
        })
      }),
      SalesInvoice.count({
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
      draft: draftCount || 0,
      sent: sentCount || 0,
      paid: paidCount || 0,
      partialPaid: partialPaidCount || 0,
      overdue: overdueCount || 0,
      cancelled: cancelledCount || 0,
      totalValue: totalValue || 0,
      thisMonth: thisMonthCount || 0,
      lastMonth: lastMonthCount || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-invoices/:id - Get sales invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'fax', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points']
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
          model: ExchangeRate,
          as: 'exchangeRate',
          attributes: ['id', 'from_currency_id', 'to_currency_id', 'rate', 'effective_date'],
          required: false
        },
        {
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'code', 'name', 'price_change_type', 'percentage_change']
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
          as: 'sentByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'cancelledByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'approvedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: SalesOrder,
          as: 'salesOrder',
          attributes: ['id', 'sales_order_ref_number'],
          required: false
        },
        {
          model: ProformaInvoice,
          as: 'proformaInvoice',
          attributes: ['id', 'proforma_ref_number'],
          required: false
        },
        {
          model: SalesAgent,
          as: 'salesAgent',
          attributes: ['id', 'agent_number', 'full_name'],
          required: false
        },
        {
          model: Account,
          as: 'discountAllowedAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'accountReceivable',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'name', 'code', 'description']
            },
            {
              model: TaxCode,
              as: 'salesTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'indicator'],
              required: false
            },
            {
              model: TaxCode,
              as: 'whtTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'indicator'],
              required: false
            },
            {
              model: Currency,
              as: 'currency',
              attributes: ['id', 'name', 'code', 'symbol'],
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
            }
          ]
        }
      ]
    });

    if (!invoice) {
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    // Get receipt items grouped by invoice item to calculate paid amounts per item
    const receiptItems = await ReceiptItem.findAll({
      where: buildCompanyWhere(req, { 
        salesInvoiceId: invoice.id 
      }),
      attributes: [
        [sequelize.col('ReceiptItem.sales_invoice_item_id'), 'sales_invoice_item_id'],
        [sequelize.fn('SUM', sequelize.col('ReceiptItem.payment_amount')), 'total_paid']
      ],
      group: [sequelize.col('ReceiptItem.sales_invoice_item_id')],
      raw: true
    });

    // Create a map of invoice item ID to total paid amount
    const itemPaidAmounts = {};
    receiptItems.forEach((item) => {
      const itemId = item.sales_invoice_item_id;
      const totalPaid = parseFloat(item.total_paid || 0);
      itemPaidAmounts[itemId] = totalPaid;
    });

    // Check and update overdue status if needed
    if (invoice.due_date && invoice.status !== 'overdue' && invoice.status !== 'paid' && invoice.status !== 'cancelled') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);
      
      if (dueDate < today) {
        // Invoice is overdue, update status
        await invoice.update({ status: 'overdue' });
        invoice.status = 'overdue';
      }
    }

    const transformedInvoice = transformSalesInvoice(invoice);
    // Add item paid amounts to the response
    res.json({
      ...transformedInvoice,
      itemPaidAmounts // Map of invoice item ID to total paid amount
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// POST /api/sales-invoices - Create new sales invoice
router.post('/', csrfProtection, async (req, res) => {
  try {
    const {
      invoice_date: invoiceDate,
      salesInvoiceDate: salesInvoiceDateAlt,
      due_date: dueDate,
      dueDate: dueDateAlt,
      store_id: storeId,
      storeId: storeIdAlt,
      customer_id: customerId,
      customerId: customerIdAlt,
      sales_order_id: salesOrderId,
      salesOrderId: salesOrderIdAlt,
      proforma_invoice_id: proformaInvoiceId,
      proformaInvoiceId: proformaInvoiceIdAlt,
      sales_agent_id: salesAgentId,
      salesAgentId: salesAgentIdAlt,
      discount_allowed_account_id: discountAllowedAccountId,
      discountAllowedAccountId: discountAllowedAccountIdAlt,
      account_receivable_id: accountReceivableId,
      accountReceivableId: accountReceivableIdAlt,
      currency_id: currencyId,
      currencyId: currencyIdAlt,
      exchange_rate: exchangeRate,
      exchangeRateValue: exchangeRateAlt,
      exchangeRate: exchangeRateAlt2,
      system_default_currency_id: systemDefaultCurrencyId,
      systemDefaultCurrencyId: systemDefaultCurrencyIdAlt,
      exchange_rate_id: exchangeRateId,
      exchangeRateId: exchangeRateIdAlt,
      valid_until: validUntil,
      validUntil: validUntilAlt,
      delivery_date: deliveryDate,
      deliveryDate: deliveryDateAlt,
      shipping_address: shippingAddress,
      shippingAddress: shippingAddressAlt,
      notes,
      terms_conditions: termsConditions,
      termsConditions: termsConditionsAlt,
      scheduled_type: scheduledType,
      scheduledType: scheduledTypeAlt,
      recurring_period: recurringPeriod,
      recurringPeriod: recurringPeriodAlt,
      scheduled_date: scheduledDate,
      scheduledDate: scheduledDateAlt,
      recurring_day_of_week: recurringDayOfWeek,
      recurringDayOfWeek: recurringDayOfWeekAlt,
      recurring_date: recurringDate,
      recurringDate: recurringDateAlt,
      recurring_month: recurringMonth,
      recurringMonth: recurringMonthAlt,
      start_time: startTime,
      startTime: startTimeAlt,
      end_time: endTime,
      endTime: endTimeAlt,
      items
    } = req.body;
    
    // Use camelCase values if provided, otherwise fall back to snake_case
    const finalInvoiceDate = invoiceDate || invoiceDateAlt;
    const finalDueDate = dueDate || dueDateAlt;
    const finalSalesOrderId = salesOrderId || salesOrderIdAlt;
    const finalProformaInvoiceId = proformaInvoiceId || proformaInvoiceIdAlt;
    const finalStoreId = storeId || storeIdAlt;
    const finalCustomerId = customerId || customerIdAlt;
    const finalCurrencyId = currencyId || currencyIdAlt;
    const finalExchangeRate = exchangeRate || exchangeRateAlt || exchangeRateAlt2 || 1.0;
    const finalSystemDefaultCurrencyId = systemDefaultCurrencyId || systemDefaultCurrencyIdAlt;
    const finalExchangeRateId = exchangeRateId || exchangeRateIdAlt;
    // Handle empty strings by converting to null
    const finalSalesAgentId = (salesAgentId || salesAgentIdAlt) ? String(salesAgentId || salesAgentIdAlt).trim() || null : null;
    const finalDiscountAllowedAccountId = (discountAllowedAccountId || discountAllowedAccountIdAlt) ? String(discountAllowedAccountId || discountAllowedAccountIdAlt).trim() || null : null;
    const finalAccountReceivableId = (accountReceivableId || accountReceivableIdAlt) ? String(accountReceivableId || accountReceivableIdAlt).trim() || null : null;
    const finalScheduledType = (scheduledType || scheduledTypeAlt) || 'not_scheduled';
    const finalRecurringPeriod = (recurringPeriod || recurringPeriodAlt) || null;
    const finalScheduledDate = (scheduledDate || scheduledDateAlt) || null;
    const finalRecurringDayOfWeek = (recurringDayOfWeek || recurringDayOfWeekAlt) || null;
    const finalRecurringDate = (recurringDate || recurringDateAlt) ? parseInt(recurringDate || recurringDateAlt) || null : null;
    const finalRecurringMonth = (recurringMonth || recurringMonthAlt) || null;
    const finalStartTime = (startTime || startTimeAlt) || null;
    const finalEndTime = (endTime || endTimeAlt) || null;
    const finalNotes = notes;
    const finalTermsConditions = termsConditions || termsConditionsAlt;

    // Validate required fields
    if (!finalInvoiceDate) {
      return res.status(400).json({ message: 'Invoice date is required' });
    }
    if (!finalStoreId) {
      return res.status(400).json({ message: 'Store is required' });
    }
    if (!finalCustomerId) {
      return res.status(400).json({ message: 'Customer is required' });
    }
    
    // If currency_id is not provided, get the default currency for the company
    let currencyIdToUse = finalCurrencyId;
    if (!currencyIdToUse) {
      const defaultCurrency = await Currency.findOne({
        where: buildCompanyWhere(req, { is_default: true, is_active: true })
      });
      if (!defaultCurrency) {
        return res.status(400).json({ message: 'Currency is required. Please provide a currency or set a default currency for your company.' });
      }
      currencyIdToUse = defaultCurrency.id;
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required' });
    }

    // Validate companyId exists (required for multi-tenant functionality)
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ 
        message: 'Company access required. Please ensure you are assigned to a company.' 
      });
    }


    // Enhanced validation for recurring scheduling
    if (finalScheduledType === 'recurring') {
      if (!finalRecurringPeriod) {
        return res.status(400).json({ message: 'Recurring period is required for recurring invoices' });
      }
      if (finalRecurringPeriod === 'weekly' && !finalRecurringDayOfWeek) {
        return res.status(400).json({ message: 'Day of week is required for weekly recurring invoices' });
      }
      if ((finalRecurringPeriod === 'monthly' || finalRecurringPeriod === 'yearly') && !finalRecurringDate) {
        return res.status(400).json({ message: 'Date is required for monthly/yearly recurring invoices' });
      }
      if (finalRecurringPeriod === 'yearly' && !finalRecurringMonth) {
        return res.status(400).json({ message: 'Month is required for yearly recurring invoices' });
      }
      if (!finalStartTime || !finalEndTime) {
        return res.status(400).json({ message: 'Start time and end time are required for recurring invoices' });
      }
      if (finalStartTime >= finalEndTime) {
        return res.status(400).json({ message: 'End time must be after start time' });
      }
    }
    
    if (finalScheduledType === 'one_time' && !finalScheduledDate) {
      return res.status(400).json({ message: 'Scheduled date is required for one-time scheduled invoices' });
    }

    // Validate that related entities belong to the same company
    if (finalStoreId) {
      const store = await Store.findOne({
        where: buildCompanyWhere(req, { id: finalStoreId })
      });
      if (!store) {
        return res.status(400).json({ message: 'Store not found or does not belong to your company' });
      }
    }

    if (finalCustomerId) {
      const customer = await Customer.findOne({
        where: buildCompanyWhere(req, { id: finalCustomerId })
      });
      if (!customer) {
        return res.status(400).json({ message: 'Customer not found or does not belong to your company' });
      }
    }

    // Validate currency if provided, otherwise use the default currency we found earlier
    if (currencyIdToUse) {
      const currency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: currencyIdToUse })
      });
      if (!currency) {
        return res.status(400).json({ message: 'Currency not found or does not belong to your company' });
      }
    }

    if (finalSystemDefaultCurrencyId) {
      const systemCurrency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: finalSystemDefaultCurrencyId })
      });
      if (!systemCurrency) {
        return res.status(400).json({ message: 'System default currency not found or does not belong to your company' });
      }
    }

    // Calculate totals using frontend-calculated values (outside retry loop since they don't change)
    let subtotal = 0;
    let totalTaxAmount = 0;
    let totalDiscountAmount = 0;
    let totalWHTAmount = 0;

    items.forEach(item => {
      // Handle both camelCase and snake_case field names
      const quantity = parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unit_price || item.unitPrice || 0);
      const lineSubtotal = quantity * unitPrice;
      
      // Use discount_amount from frontend (already calculated correctly)
      const lineDiscountAmount = parseFloat(item.discount_amount || item.discountAmount || 0);
      
      // Use tax_amount (Sales Tax Amount) from frontend
      const lineTaxAmount = parseFloat(item.tax_amount || item.taxAmount || 0);
      
      // Use WHT amount from frontend
      const lineWHTAmount = parseFloat(item.wht_amount || item.whtAmount || 0);
      
      // Use line_total from frontend if provided, otherwise calculate
      const lineTotal = parseFloat(item.line_total || item.lineTotal || 0) || (lineSubtotal - lineDiscountAmount + lineTaxAmount);

      subtotal += lineSubtotal;
      totalDiscountAmount += lineDiscountAmount;
      totalTaxAmount += lineTaxAmount;
      totalWHTAmount += lineWHTAmount;
    });

    // Total amount = subtotal - discount + tax (WHT is already deducted from line totals if applicable)
    const totalAmount = subtotal - totalDiscountAmount + totalTaxAmount;

    // Calculate invoice-level calculated fields
    const amountAfterDiscount = subtotal - totalDiscountAmount;
    const amountAfterWHT = amountAfterDiscount - totalWHTAmount;

    // Get current financial year (outside retry loop since it doesn't change)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isCurrent: true, isActive: true })
    });

    if (!currentFinancialYear) {
      return res.status(400).json({ message: 'No current financial year found. Please set up a current financial year before creating invoices.' });
    }

    // Validate invoice date is within financial year range
    // Use date-only comparison to avoid timezone issues
    const invoiceDateStr = finalInvoiceDate.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (invoiceDateStr < startDateStr || invoiceDateStr > endDateStr) {
      return res.status(400).json({ 
        message: `Invoice date must be within the current financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Retry logic for handling race conditions in reference number generation
    // IMPORTANT: Generate reference number OUTSIDE transaction (same as customer deposits)
    // This prevents transaction isolation issues when checking for existing numbers
    let invoice;
    let salesInvoiceRefNumber;
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      // Generate proforma reference number OUTSIDE the transaction (same as customer deposits)
      // This ensures we see all committed invoices when checking for existing numbers
      // Add a small delay on retries to ensure we get fresh data
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      }
      
      salesInvoiceRefNumber = await generateInvoiceRefNumber(req);
      
      // Create transaction AFTER generating reference number
      const transaction = await sequelize.transaction();
      
      try {
    // Create sales invoice
        invoice = await SalesInvoice.create({
      invoice_ref_number: salesInvoiceRefNumber,
      invoice_date: finalInvoiceDate,
      due_date: finalDueDate,
      store_id: finalStoreId,
      customer_id: finalCustomerId,
      sales_order_id: finalSalesOrderId,
      proforma_invoice_id: finalProformaInvoiceId,
      currency_id: currencyIdToUse,
      exchange_rate: finalExchangeRate,
      system_default_currency_id: finalSystemDefaultCurrencyId,
      companyId: req.user.companyId,
      exchange_rate_id: finalExchangeRateId,
      subtotal: subtotal,
      tax_amount: totalTaxAmount,
      discount_amount: totalDiscountAmount,
      total_amount: totalAmount,
      amount_after_discount: amountAfterDiscount, // Calculated: subtotal - discount_amount
      total_wht_amount: totalWHTAmount, // Calculated: sum of all item wht_amount
      amount_after_wht: amountAfterWHT, // Calculated: amount_after_discount - total_wht_amount
      paid_amount: 0.00,
      balance_amount: totalAmount,
      equivalent_amount: finalExchangeRate ? totalAmount * finalExchangeRate : totalAmount,
      price_category_id: req.body.price_category_id || req.body.priceCategoryId || null,
      sales_agent_id: finalSalesAgentId,
      financial_year_id: currentFinancialYear.id,
      discount_allowed_account_id: finalDiscountAllowedAccountId,
      account_receivable_id: finalAccountReceivableId,
      status: 'draft',
      scheduled_type: finalScheduledType,
      recurring_period: finalRecurringPeriod,
      scheduled_date: finalScheduledDate,
      recurring_day_of_week: finalRecurringDayOfWeek,
      recurring_date: finalRecurringDate,
      recurring_month: finalRecurringMonth,
      start_time: finalStartTime,
      end_time: finalEndTime,
      notes: finalNotes,
      terms_conditions: finalTermsConditions,
      created_by: req.user.id,
      updated_by: req.user.id
        }, { transaction });

    // Create sales invoice items
    const invoiceItems = await Promise.all(
      items.map(async (item, index) => {
        // Handle both camelCase and snake_case field names
        // Use quantity exactly as sent from frontend
        const quantity = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.unit_price || item.unitPrice || 0);
        const lineSubtotal = quantity * unitPrice;
        
        // Use discount_amount from frontend (it already handles both amount and percentage modes)
        const lineDiscountAmount = parseFloat(item.discount_amount || item.discountAmount || 0);
        
        // Calculate amount after discount (used for tax and WHT calculations)
        const lineAfterDiscount = lineSubtotal - lineDiscountAmount;
        
        // Extract tax IDs and amounts from frontend (they're already calculated correctly)
        // User can override or remove the default VAT - we respect their choice
        const salesTaxId = item.sales_tax_id || item.salesTaxId || null;
        const whtTaxId = item.wht_tax_id || item.whtTaxId || null;
        
        // Use WHT amount from frontend (calculated based on afterDiscount and WHT rate)
        const whtAmount = parseFloat(item.wht_amount || item.whtAmount || 0);
        
        // Use tax_amount (Sales Tax Amount) from frontend (calculated based on afterDiscount and sales tax rate)
        // Fallback to calculation only if frontend didn't send it
        const salesTaxAmount = parseFloat(item.tax_amount || item.taxAmount || 0) || (lineAfterDiscount * (parseFloat(item.tax_percentage || item.taxPercentage || 0)) / 100);
        const lineTotal = parseFloat(item.line_total || item.lineTotal || 0) || (lineAfterDiscount + salesTaxAmount);

        // Calculate equivalent amount: lineTotal * exchangeRate
        const itemExchangeRate = parseFloat(item.exchange_rate || item.exchangeRate || 1.0);
        const equivalentAmount = parseFloat(item.equivalent_amount || item.equivalentAmount || 0) || (lineTotal * itemExchangeRate);

        // Calculate amount after discount (save this calculated field)
        const amountAfterDiscount = lineAfterDiscount;
        
        // Calculate amount after WHT (save this calculated field)
        const amountAfterWHT = amountAfterDiscount - whtAmount;

        // Normalize serial numbers: ensure it's an array, filter out empty strings and nulls
        const serialNumbers = (() => {
          const serials = Array.isArray(item.serial_numbers || item.serialNumbers) 
            ? (item.serial_numbers || item.serialNumbers).filter(sn => sn && typeof sn === 'string' && sn.trim() !== '')
            : [];
          return serials;
        })();
        
        // Normalize batch number: trim whitespace, convert empty string to null
        const batchNumber = (() => {
          const batch = (item.batch_number || item.batchNumber) 
            ? String(item.batch_number || item.batchNumber).trim() || null
            : null;
          return batch;
        })();
        
        // Normalize expiry date: ensure proper date format, convert empty string to null
        const expiryDate = (() => {
          const expiry = (item.expiry_date || item.expiryDate) 
            ? (String(item.expiry_date || item.expiryDate).trim() || null)
            : null;
          return expiry;
        })();

        // Ensure companyId is set (critical for multi-tenant)
        if (!req.user || !req.user.companyId) {
          throw new Error(`Company ID is required for item ${item.productId || item.product_id}. User: ${req.user?.id}, CompanyId: ${req.user?.companyId}`);
        }

        try {
          const createdItem = await SalesInvoiceItem.create({
            sales_invoice_id: invoice.id,
            product_id: item.product_id || item.productId,
            quantity: quantity, // Quantity from frontend
            companyId: req.user.companyId, // CRITICAL: Must be set for multi-tenant
            financial_year_id: currentFinancialYear.id,
            unit_price: unitPrice,
            discount_percentage: parseFloat(item.discount_percentage || item.discountPercentage || 0),
            discount_amount: lineDiscountAmount, // Discount amount from frontend (handles both amount and percentage modes)
            tax_percentage: parseFloat(item.tax_percentage || item.taxPercentage || 0),
            tax_amount: salesTaxAmount, // Sales Tax Amount (VAT amount) from frontend
            price_tax_inclusive: item.price_tax_inclusive !== undefined ? item.price_tax_inclusive : false,
            sales_tax_id: salesTaxId, // Sales Tax Code ID from frontend
            wht_tax_id: whtTaxId, // WHT Tax Code ID from frontend
            wht_amount: whtAmount, // WHT Amount from frontend (calculated based on afterDiscount)
            currency_id: item.currency_id || item.currencyId || null,
            exchange_rate: itemExchangeRate,
            equivalent_amount: equivalentAmount, // Equivalent amount from frontend or calculated
            amount_after_discount: amountAfterDiscount, // Calculated: lineSubtotal - discountAmount
            amount_after_wht: amountAfterWHT, // Calculated: amountAfterDiscount - whtAmount
            line_total: lineTotal, // Line total from frontend or calculated
            notes: item.notes,
            serial_numbers: serialNumbers,
            batch_number: batchNumber,
            expiry_date: expiryDate,
            created_by: req.user.id,
            updated_by: req.user.id
          }, { transaction });

          return createdItem;
        } catch (itemError) {
          throw itemError;
        }
      })
    );

        // Create sales transaction record
        try {
          await createTransactionFromInvoice(invoice, req, { transaction });
        } catch (transactionError) {
          // Don't fail the invoice creation if transaction creation fails
        }

        // Commit transaction if everything succeeds
        await transaction.commit();
        
        // Break out of retry loop on success
        break;
      } catch (createError) {
        // Rollback transaction on error
        await transaction.rollback();
        
        // If it's a unique constraint error, retry with a new reference number
        if (createError.name === 'SequelizeUniqueConstraintError' && 
            createError.errors?.some(e => e.path === 'invoice_ref_number')) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error('Failed to generate unique proforma reference number after multiple attempts');
          }
          // Wait a small random amount before retrying (helps avoid collisions)
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
          continue; // Retry with new reference number (new transaction will be created)
        }
        // For other errors, throw immediately
        throw createError;
      }
    }

    if (!invoice) {
      throw new Error('Failed to create sales order after multiple retry attempts');
    }

    // Fetch the created invoice with all relations
    const createdInvoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id: invoice.id }),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'fax', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points']
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
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'code', 'name', 'price_change_type', 'percentage_change']
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'name', 'code', 'description']
            },
            {
              model: TaxCode,
              as: 'salesTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'indicator'],
              required: false
            },
            {
              model: TaxCode,
              as: 'whtTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'indicator'],
              required: false
            },
            {
              model: Currency,
              as: 'currency',
              attributes: ['id', 'name', 'code', 'symbol'],
              required: false
            }
          ]
        }
      ]
    });

    const transformedInvoice = transformSalesInvoice(createdInvoice);
    res.status(201).json(transformedInvoice);
  } catch (error) {

    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        message: 'Validation error',
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }

    // Handle Sequelize unique constraint errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        message: 'A sales order with this reference number already exists',
        field: error.errors?.[0]?.path
      });
    }

    // Handle foreign key constraint errors
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({
        message: 'Invalid reference: One or more related records do not exist',
        detail: error.message
      });
    }

    res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /api/sales-invoices/:id - Update sales order
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      invoice_date: invoiceDate,
      salesInvoiceDate: salesInvoiceDateAlt,
      due_date: dueDate,
      dueDate: dueDateAlt,
      store_id: storeId,
      storeId: storeIdAlt,
      customer_id: customerId,
      customerId: customerIdAlt,
      sales_order_id: salesOrderId,
      salesOrderId: salesOrderIdAlt,
      proforma_invoice_id: proformaInvoiceId,
      proformaInvoiceId: proformaInvoiceIdAlt,
      currency_id: currencyId,
      currencyId: currencyIdAlt,
      exchange_rate: exchangeRate,
      exchangeRateValue: exchangeRateAlt,
      exchangeRate: exchangeRateAlt2,
      system_default_currency_id: systemDefaultCurrencyId,
      systemDefaultCurrencyId: systemDefaultCurrencyIdAlt,
      exchange_rate_id: exchangeRateId,
      exchangeRateId: exchangeRateIdAlt,
      valid_until: validUntil,
      validUntil: validUntilAlt,
      delivery_date: deliveryDate,
      deliveryDate: deliveryDateAlt,
      shipping_address: shippingAddress,
      shippingAddress: shippingAddressAlt,
      notes,
      terms_conditions: termsConditions,
      termsConditions: termsConditionsAlt,
      sales_agent_id: salesAgentId,
      salesAgentId: salesAgentIdAlt,
      discount_allowed_account_id: discountAllowedAccountId,
      discountAllowedAccountId: discountAllowedAccountIdAlt,
      account_receivable_id: accountReceivableId,
      accountReceivableId: accountReceivableIdAlt,
      scheduled_type: scheduledType,
      scheduledType: scheduledTypeAlt,
      recurring_period: recurringPeriod,
      recurringPeriod: recurringPeriodAlt,
      scheduled_date: scheduledDate,
      scheduledDate: scheduledDateAlt,
      recurring_day_of_week: recurringDayOfWeek,
      recurringDayOfWeek: recurringDayOfWeekAlt,
      recurring_date: recurringDate,
      recurringDate: recurringDateAlt,
      recurring_month: recurringMonth,
      recurringMonth: recurringMonthAlt,
      start_time: startTime,
      startTime: startTimeAlt,
      end_time: endTime,
      endTime: endTimeAlt,
      items
    } = req.body;
    
    // Use camelCase values if provided, otherwise fall back to snake_case
    const finalInvoiceDate = invoiceDate || salesInvoiceDateAlt;
    const finalDueDate = dueDate || dueDateAlt;
    const finalSalesOrderId = salesOrderId || salesOrderIdAlt;
    const finalProformaInvoiceId = proformaInvoiceId || proformaInvoiceIdAlt;
    // Handle empty strings by converting to null
    const finalSalesAgentId = (salesAgentId || salesAgentIdAlt) ? String(salesAgentId || salesAgentIdAlt).trim() || null : null;
    const finalDiscountAllowedAccountId = (discountAllowedAccountId || discountAllowedAccountIdAlt) ? String(discountAllowedAccountId || discountAllowedAccountIdAlt).trim() || null : null;
    const finalAccountReceivableId = (accountReceivableId || accountReceivableIdAlt) ? String(accountReceivableId || accountReceivableIdAlt).trim() || null : null;
    const finalScheduledType = (scheduledType || scheduledTypeAlt) || 'not_scheduled';
    const finalRecurringPeriod = (recurringPeriod || recurringPeriodAlt) || null;
    const finalScheduledDate = (scheduledDate || scheduledDateAlt) || null;
    const finalRecurringDayOfWeek = (recurringDayOfWeek || recurringDayOfWeekAlt) || null;
    const finalRecurringDate = (recurringDate || recurringDateAlt) ? parseInt(recurringDate || recurringDateAlt) || null : null;
    const finalRecurringMonth = (recurringMonth || recurringMonthAlt) || null;
    const finalStartTime = (startTime || startTimeAlt) || null;
    const finalEndTime = (endTime || endTimeAlt) || null;
    const finalStoreId = storeId || storeIdAlt;
    const finalCustomerId = customerId || customerIdAlt;
    const finalCurrencyId = currencyId || currencyIdAlt;
    const finalExchangeRate = exchangeRate || exchangeRateAlt || exchangeRateAlt2 || 1.0;
    const finalSystemDefaultCurrencyId = systemDefaultCurrencyId || systemDefaultCurrencyIdAlt;
    const finalExchangeRateId = exchangeRateId || exchangeRateIdAlt;
    const finalValidUntil = validUntil || validUntilAlt;
    const finalDeliveryDate = deliveryDate || deliveryDateAlt;
    const finalShippingAddress = shippingAddress || shippingAddressAlt;
    const finalNotes = notes;
    const finalTermsConditions = termsConditions || termsConditionsAlt;

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales order not found' });
    }

    // Only allow updates for draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft invoices can be updated' });
    }

    // Validate that related entities belong to the same company
    if (finalStoreId) {
      const store = await Store.findOne({
        where: buildCompanyWhere(req, { id: finalStoreId })
      });
      if (!store) {
        return res.status(400).json({ message: 'Store not found or does not belong to your company' });
      }
    }

    if (finalCustomerId) {
      const customer = await Customer.findOne({
        where: buildCompanyWhere(req, { id: finalCustomerId })
      });
      if (!customer) {
        return res.status(400).json({ message: 'Customer not found or does not belong to your company' });
      }
    }

    // Validate currency if provided, otherwise preserve existing invoice currency
    let currencyIdToUse = finalCurrencyId;
    if (currencyIdToUse) {
      const currency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: currencyIdToUse })
      });
      if (!currency) {
        return res.status(400).json({ message: 'Currency not found or does not belong to your company' });
      }
    } else {
      // If currency not provided, preserve existing currency from invoice
      currencyIdToUse = invoice.currency_id;
    }

    if (finalSystemDefaultCurrencyId) {
      const systemCurrency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: finalSystemDefaultCurrencyId })
      });
      if (!systemCurrency) {
        return res.status(400).json({ message: 'System default currency not found or does not belong to your company' });
      }
    }

    // Get current financial year
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isCurrent: true, isActive: true })
    });

    if (!currentFinancialYear) {
      return res.status(400).json({ message: 'No current financial year found. Please set up a current financial year before updating sales invoices.' });
    }

    // Validate invoice date is within financial year range
    // Use date-only comparison to avoid timezone issues
    const invoiceDateStr = finalInvoiceDate.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (invoiceDateStr < startDateStr || invoiceDateStr > endDateStr) {
      return res.status(400).json({ 
        message: `Invoice date must be within the current financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Calculate totals using frontend-calculated values
    let subtotal = 0;
    let totalTaxAmount = 0;
    let totalDiscountAmount = 0;
    let totalWHTAmount = 0;

    items.forEach(item => {
      // Handle both camelCase and snake_case field names
      const quantity = parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unit_price || item.unitPrice || 0);
      const lineSubtotal = quantity * unitPrice;
      
      // Use discount_amount from frontend (already calculated correctly)
      const lineDiscountAmount = parseFloat(item.discount_amount || item.discountAmount || 0);
      
      // Use tax_amount (Sales Tax Amount) from frontend
      const lineTaxAmount = parseFloat(item.tax_amount || item.taxAmount || 0);
      
      // Use WHT amount from frontend
      const lineWHTAmount = parseFloat(item.wht_amount || item.whtAmount || 0);
      
      // Use line_total from frontend if provided, otherwise calculate
      const lineTotal = parseFloat(item.line_total || item.lineTotal || 0) || (lineSubtotal - lineDiscountAmount + lineTaxAmount);

      subtotal += lineSubtotal;
      totalDiscountAmount += lineDiscountAmount;
      totalTaxAmount += lineTaxAmount;
      totalWHTAmount += lineWHTAmount;
    });

    // Total amount = subtotal - discount + tax (WHT is already deducted from line totals if applicable)
    const totalAmount = subtotal - totalDiscountAmount + totalTaxAmount;

    // Calculate invoice-level calculated fields
    const amountAfterDiscount = subtotal - totalDiscountAmount;
    const amountAfterWHT = amountAfterDiscount - totalWHTAmount;

    // Update sales invoice
    await invoice.update({
      invoice_date: finalInvoiceDate,
      due_date: finalDueDate,
      store_id: finalStoreId,
      customer_id: finalCustomerId,
      sales_order_id: finalSalesOrderId,
      proforma_invoice_id: finalProformaInvoiceId,
      currency_id: currencyIdToUse,
      exchange_rate: finalExchangeRate,
      system_default_currency_id: finalSystemDefaultCurrencyId,
      exchange_rate_id: finalExchangeRateId,
      price_category_id: req.body.price_category_id || req.body.priceCategoryId || null,
      sales_agent_id: finalSalesAgentId,
      financial_year_id: currentFinancialYear.id,
      discount_allowed_account_id: finalDiscountAllowedAccountId,
      account_receivable_id: finalAccountReceivableId,
      scheduled_type: finalScheduledType,
      recurring_period: finalRecurringPeriod,
      scheduled_date: finalScheduledDate,
      recurring_day_of_week: finalRecurringDayOfWeek,
      recurring_date: finalRecurringDate,
      recurring_month: finalRecurringMonth,
      start_time: finalStartTime,
      end_time: finalEndTime,
      subtotal: subtotal,
      tax_amount: totalTaxAmount,
      discount_amount: totalDiscountAmount,
      total_amount: totalAmount,
      amount_after_discount: amountAfterDiscount, // Calculated: subtotal - discount_amount
      total_wht_amount: totalWHTAmount, // Calculated: sum of all item wht_amount
      amount_after_wht: amountAfterWHT, // Calculated: amount_after_discount - total_wht_amount
      equivalent_amount: finalExchangeRate ? totalAmount * finalExchangeRate : totalAmount,
      notes: finalNotes,
      terms_conditions: finalTermsConditions,
      updated_by: req.user.id
    });

    // Delete existing items (filtered by company)
    await SalesInvoiceItem.destroy({
      where: buildCompanyWhere(req, { sales_invoice_id: id })
    });

    // Create new items
    await Promise.all(
      items.map(async item => {
        // Handle both camelCase and snake_case field names
        // Use quantity exactly as sent from frontend
        const quantity = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.unit_price || item.unitPrice || 0);
        const lineSubtotal = quantity * unitPrice;
        
        // Use discount_amount from frontend (it already handles both amount and percentage modes)
        const lineDiscountAmount = parseFloat(item.discount_amount || item.discountAmount || 0);
        
        // Calculate amount after discount (used for tax and WHT calculations)
        const lineAfterDiscount = lineSubtotal - lineDiscountAmount;
        
        // Extract tax IDs and amounts from frontend (they're already calculated correctly)
        // User can override or remove the default VAT - we respect their choice
        const salesTaxId = item.sales_tax_id || item.salesTaxId || null;
        const whtTaxId = item.wht_tax_id || item.whtTaxId || null;
        
        // Use WHT amount from frontend (calculated based on afterDiscount and WHT rate)
        const whtAmount = parseFloat(item.wht_amount || item.whtAmount || 0);
        
        // Use tax_amount (Sales Tax Amount) from frontend (calculated based on afterDiscount and sales tax rate)
        // Fallback to calculation only if frontend didn't send it
        const salesTaxAmount = parseFloat(item.tax_amount || item.taxAmount || 0) || (lineAfterDiscount * (parseFloat(item.tax_percentage || item.taxPercentage || 0)) / 100);
        const lineTotal = parseFloat(item.line_total || item.lineTotal || 0) || (lineAfterDiscount + salesTaxAmount);

        // Calculate equivalent amount: lineTotal * exchangeRate
        const itemExchangeRate = parseFloat(item.exchange_rate || item.exchangeRate || 1.0);
        const equivalentAmount = parseFloat(item.equivalent_amount || item.equivalentAmount || 0) || (lineTotal * itemExchangeRate);

        // Calculate amount after discount (save this calculated field)
        const amountAfterDiscount = lineAfterDiscount;
        
        // Calculate amount after WHT (save this calculated field)
        const amountAfterWHT = amountAfterDiscount - whtAmount;

        // Normalize serial numbers: ensure it's an array, filter out empty strings and nulls
        const serialNumbers = (() => {
          const serials = Array.isArray(item.serial_numbers || item.serialNumbers) 
            ? (item.serial_numbers || item.serialNumbers).filter(sn => sn && typeof sn === 'string' && sn.trim() !== '')
            : [];
          return serials;
        })();
        
        // Normalize batch number: trim whitespace, convert empty string to null
        const batchNumber = (() => {
          const batch = (item.batch_number || item.batchNumber) 
            ? String(item.batch_number || item.batchNumber).trim() || null
            : null;
          return batch;
        })();
        
        // Normalize expiry date: ensure proper date format, convert empty string to null
        const expiryDate = (() => {
          const expiry = (item.expiry_date || item.expiryDate) 
            ? (String(item.expiry_date || item.expiryDate).trim() || null)
            : null;
          return expiry;
        })();

        // Ensure companyId is set (critical for multi-tenant)
        if (!req.user || !req.user.companyId) {
          throw new Error(`Company ID is required for item ${item.productId || item.product_id}. User: ${req.user?.id}, CompanyId: ${req.user?.companyId}`);
        }

        try {
          const createdItem = await SalesInvoiceItem.create({
            sales_invoice_id: id,
            product_id: item.product_id || item.productId,
            quantity: quantity, // Quantity from frontend
            companyId: req.user.companyId, // CRITICAL: Must be set for multi-tenant
            financial_year_id: currentFinancialYear.id,
            unit_price: unitPrice,
            discount_percentage: parseFloat(item.discount_percentage || item.discountPercentage || 0),
            discount_amount: lineDiscountAmount, // Discount amount from frontend (handles both amount and percentage modes)
            tax_percentage: parseFloat(item.tax_percentage || item.taxPercentage || 0),
            tax_amount: salesTaxAmount, // Sales Tax Amount (VAT amount) from frontend
            price_tax_inclusive: item.price_tax_inclusive !== undefined ? item.price_tax_inclusive : false,
            sales_tax_id: salesTaxId, // Sales Tax Code ID from frontend
            wht_tax_id: whtTaxId, // WHT Tax Code ID from frontend
            wht_amount: whtAmount, // WHT Amount from frontend (calculated based on afterDiscount)
            currency_id: item.currency_id || item.currencyId || null,
            exchange_rate: itemExchangeRate,
            equivalent_amount: equivalentAmount, // Equivalent amount from frontend or calculated
            amount_after_discount: amountAfterDiscount, // Calculated: lineSubtotal - discountAmount
            amount_after_wht: amountAfterWHT, // Calculated: amountAfterDiscount - whtAmount
            line_total: lineTotal, // Line total from frontend or calculated
            notes: item.notes,
            serial_numbers: serialNumbers,
            batch_number: batchNumber,
            expiry_date: expiryDate,
            created_by: req.user.id,
            updated_by: req.user.id
          });

          return createdItem;
        } catch (itemError) {
          throw itemError;
        }
      })
    );

    // Update sales transaction record
    const invoiceForTransaction = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    
    if (invoiceForTransaction) {
      try {
        await updateTransactionFromInvoice(invoiceForTransaction, req);
      } catch (transactionError) {
        // Don't fail the invoice update if transaction update fails
      }
    }

    // Fetch the updated invoice with all relations
    const updatedInvoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'fax', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points']
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
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'code', 'name', 'price_change_type', 'percentage_change']
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
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'name', 'code', 'description']
            },
            {
              model: TaxCode,
              as: 'salesTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'indicator'],
              required: false
            },
            {
              model: TaxCode,
              as: 'whtTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'indicator'],
              required: false
            },
            {
              model: Currency,
              as: 'currency',
              attributes: ['id', 'name', 'code', 'symbol'],
              required: false
            }
          ]
        }
      ]
    });

    const transformedInvoice = transformSalesInvoice(updatedInvoice);
    res.json(transformedInvoice);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// DELETE /api/sales-invoices/:id - Delete sales invoice (hard delete)
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    // Only allow deletion of draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft invoices can be deleted' });
    }

    // Check if there are related sales_transactions
    const { SalesTransaction } = require('../models');
    const relatedTransactions = await SalesTransaction.count({
      where: buildCompanyWhere(req, { source_invoice_id: id })
    });

    if (relatedTransactions > 0) {
      return res.status(400).json({ 
        message: `Cannot delete invoice: ${relatedTransactions} related transaction(s) exist. Invoices with transactions cannot be deleted.` 
      });
    }

    // Check if there are related receipts
    const { Receipt } = require('../models');
    const relatedReceipts = await Receipt.count({
      where: buildCompanyWhere(req, { sales_invoice_id: id })
    });

    if (relatedReceipts > 0) {
      return res.status(400).json({ 
        message: `Cannot delete invoice: ${relatedReceipts} related receipt(s) exist. Invoices with payments cannot be deleted.` 
      });
    }

    // Delete items first (CASCADE should handle this, but being explicit and filtered by company)
    await SalesInvoiceItem.destroy({
      where: buildCompanyWhere(req, { sales_invoice_id: id })
    });

    // Delete the invoice
    await invoice.destroy();

    res.json({ message: 'Sales invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting sales invoice:', error);
    
    // Handle foreign key constraint errors
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      const constraintName = error.index || error.parent?.constraint || 'unknown';
      if (constraintName.includes('sales_transactions')) {
        return res.status(400).json({ 
          message: 'Cannot delete invoice: Related sales transactions exist. Invoices with transactions cannot be deleted.' 
        });
      }
      if (constraintName.includes('receipts')) {
        return res.status(400).json({ 
          message: 'Cannot delete invoice: Related receipts exist. Invoices with payments cannot be deleted.' 
        });
      }
      return res.status(400).json({ 
        message: 'Cannot delete invoice: Related records exist. Please remove all related records first.' 
      });
    }
    
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT /api/sales-invoices/:id/send - Send sales invoice
router.put('/:id/send', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft invoices can be sent' });
    }

    await invoice.update({
      status: 'sent',
      sent_by: req.user.id,
      sent_at: new Date()
    });

    res.json({ message: 'Sales invoice sent successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT /api/sales-invoices/:id/approve - Approve invoice
router.put('/:id/approve', csrfProtection, async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id }),
      transaction: dbTransaction
    });
    
    if (!invoice) {
      await dbTransaction.rollback();
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    if (invoice.status === 'approved' || invoice.status === 'paid' || invoice.status === 'cancelled') {
      await dbTransaction.rollback();
      return res.status(400).json({ message: 'Approved, paid, or cancelled invoices cannot be approved again' });
    }

    if (invoice.status !== 'sent' && invoice.status !== 'overdue' && invoice.status !== 'draft') {
      await dbTransaction.rollback();
      return res.status(400).json({ message: 'Only sent, overdue, or draft invoices can be approved' });
    }

    // Process all related table updates FIRST (before updating status)
    // This ensures validation happens before status change
    // Stock validation is performed inside approveSalesInvoice
    let approvalResults;
    try {
      approvalResults = await approveSalesInvoice(invoice, req, dbTransaction);
    } catch (approvalError) {
      await dbTransaction.rollback();
      
      // Check if error is related to stock validation
      const isStockError = approvalError.message && (
        approvalError.message.includes('no available stock') ||
        approvalError.message.includes('Insufficient stock') ||
        approvalError.message.includes('not available in the selected store')
      );
      
      // Return 400 (Bad Request) for stock validation errors, 500 for other errors
      const statusCode = isStockError ? 400 : 500;
      
      return res.status(statusCode).json({ 
        message: isStockError 
          ? 'Cannot approve invoice: Stock validation failed' 
          : 'Failed to approve invoice', 
        error: approvalError.message,
        errorName: approvalError.name,
        details: process.env.NODE_ENV === 'development' ? approvalError.stack : undefined
      });
    }

    // Only update invoice status after successful processing
    await invoice.update({
      status: 'approved',
      approved_by: req.user.id,
      approved_at: new Date(),
      updated_by: req.user.id
    }, { transaction: dbTransaction });

    // Check if there were critical errors
    if (approvalResults.errors.length > 0) {
      // Check for critical errors that should prevent approval
      const criticalErrors = approvalResults.errors.filter(err => 
        err.includes('Critical') || 
        err.includes('General Ledger') && (err.includes('not found') || err.includes('required'))
      );
      
      if (criticalErrors.length > 0) {
        await dbTransaction.rollback();
        return res.status(500).json({ 
          message: 'Invoice approval failed due to critical errors',
          errors: criticalErrors,
          warnings: approvalResults.errors.filter(err => !criticalErrors.includes(err))
        });
      }
    }

    // Commit transaction
    await dbTransaction.commit();

    res.json({ 
      message: 'Invoice approved successfully',
      details: {
        generalLedgerEntries: approvalResults.generalLedger.length,
        customerUpdated: approvalResults.customerUpdated,
        loyaltyTransactionCreated: !!approvalResults.loyaltyTransaction,
        priceHistoryEntries: approvalResults.priceHistory.length,
        productExpiryUpdated: approvalResults.productExpiry.length,
        productSerialUpdated: approvalResults.productSerial.length,
        productTransactionsCreated: approvalResults.productTransactions.length,
        salesTransactionUpdated: !!approvalResults.salesTransaction,
        warnings: approvalResults.errors
      }
    });
  } catch (error) {
    try {
      await dbTransaction.rollback();
    } catch (rollbackError) {
      // Error rolling back transaction
    }
    res.status(500).json({ 
      message: 'Internal server error', 
      error: error.message,
      errorName: error.name,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// PUT /api/sales-invoices/:id/reject - Reject sales invoice
router.put('/:id/reject', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    // Validate rejection reason is provided
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    if (invoice.status === 'paid' || invoice.status === 'cancelled' || invoice.status === 'rejected') {
      return res.status(400).json({ message: 'Paid, cancelled, or already rejected invoices cannot be rejected' });
    }

    await invoice.update({
      status: 'rejected',
      rejected_by: req.user.id,
      rejected_at: new Date(),
      rejection_reason: rejectionReason.trim()
    });

    // Update sales transaction if it exists
    try {
      await updateTransactionFromInvoice(invoice, req);
    } catch (transactionError) {
      // Don't fail the invoice update if transaction update fails
    }

    res.json({ message: 'Sales invoice rejected successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT /api/sales-invoices/:id/cancel - Cancel sales invoice
router.put('/:id/cancel', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;

    // Validate cancellation reason is provided
    if (!cancellationReason || !cancellationReason.trim()) {
      return res.status(400).json({ message: 'Cancellation reason is required' });
    }

    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    // Do not allow cancellation of paid invoices (check both status and payment_status)
    if (invoice.status === 'paid' || (invoice.payment_status && invoice.payment_status === 'paid')) {
      return res.status(400).json({ 
        message: 'Paid invoices cannot be cancelled. Please reverse the payments first.' 
      });
    }

    // Do not allow cancellation of already cancelled or rejected invoices
    if (invoice.status === 'cancelled' || invoice.status === 'rejected') {
      return res.status(400).json({ 
        message: 'Cancelled or rejected invoices cannot be cancelled again' 
      });
    }

    // Update invoice status to cancelled
    await invoice.update({
      status: 'cancelled',
      cancelled_by: req.user.id,
      cancelled_at: new Date(),
      cancellation_reason: cancellationReason.trim(),
      updated_by: req.user.id
    });

    // Update sales transaction if it exists
    try {
      await updateTransactionFromInvoice(invoice, req);
    } catch (transactionError) {
      // Don't fail the invoice update if transaction update fails
    }

    res.json({ message: 'Sales invoice cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-invoices/export/excel - Export sales invoices to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search, status, paymentStatus, storeId, customerId, currencyId, dateFrom, dateTo } = req.query;

    const whereClause = {};
    
    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { invoice_ref_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status) whereClause.status = status;
    if (paymentStatus) whereClause.payment_status = paymentStatus;
    if (storeId) whereClause.store_id = storeId;
    if (customerId) whereClause.customer_id = customerId;
    if (currencyId) whereClause.currency_id = currencyId;
    // Handle dateFrom and dateTo (frontend sends these as dateFrom/dateTo, but we also check for date_from/date_to)
    const startDate = dateFrom || req.query.date_from;
    const endDate = dateTo || req.query.date_to;
    if (startDate || endDate) {
      whereClause.invoice_date = {};
      if (startDate) whereClause.invoice_date[Op.gte] = startDate;
      if (endDate) whereClause.invoice_date[Op.lte] = endDate;
    }

    const invoices = await SalesInvoice.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points']
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
          as: 'sentByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'cancelledByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'approvedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // TODO: Add exportSalesInvoicesToExcel method to ExportService
    // For now, return error or use proforma invoice export as fallback
    return res.status(501).json({ message: 'Excel export for sales orders not yet implemented' });
    // const exportService = new ExportService();
    // const buffer = await exportService.exportSalesInvoicesToExcel(invoices, req.query);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sales_invoices_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-invoices/export/pdf - Export sales invoices to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search, status, paymentStatus, storeId, customerId, currencyId, dateFrom, dateTo } = req.query;

    const whereClause = {};
    
    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { invoice_ref_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status) whereClause.status = status;
    if (paymentStatus) whereClause.payment_status = paymentStatus;
    if (storeId) whereClause.store_id = storeId;
    if (customerId) whereClause.customer_id = customerId;
    if (currencyId) whereClause.currency_id = currencyId;
    // Handle dateFrom and dateTo (frontend sends these as dateFrom/dateTo, but we also check for date_from/date_to)
    const startDate = dateFrom || req.query.date_from;
    const endDate = dateTo || req.query.date_to;
    if (startDate || endDate) {
      whereClause.invoice_date = {};
      if (startDate) whereClause.invoice_date[Op.gte] = startDate;
      if (endDate) whereClause.invoice_date[Op.lte] = endDate;
    }

    const invoices = await SalesInvoice.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points']
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
          as: 'sentByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'cancelledByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'approvedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        }
      ],
      order: [['created_at', 'DESC']],
      limit: 500 // Increased limit for PDF export
    });

    // TODO: Add exportSalesInvoicesToPDF method to ExportService
    // For now, return error or use proforma invoice export as fallback
    return res.status(501).json({ message: 'PDF export for sales orders not yet implemented' });
    // const exportService = new ExportService();
    // const buffer = await exportService.exportSalesInvoicesToPDF(invoices, req.query);
    // res.setHeader('Content-Type', 'application/pdf');
    // res.setHeader('Content-Disposition', `attachment; filename="sales_invoices_export_${new Date().toISOString().split('T')[0]}.pdf"`);
    // res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT /api/sales-invoices/:id/record-payment - Record payment against invoice
router.put('/:id/record-payment', csrfProtection, async (req, res) => {
  let retryCount = 0;
  const maxRetries = 5;
  
  while (retryCount < maxRetries) {
    // Generate receipt reference number OUTSIDE the transaction
    // This ensures we see all committed receipts when checking for existing numbers
    // Add a small delay on retries to ensure we get fresh data
    if (retryCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
    }
    
    let receiptReferenceNumber;
    try {
      receiptReferenceNumber = await generateReceiptRefNumber(req);
    } catch (error) {
      if (retryCount < maxRetries - 1) {
        retryCount++;
        continue;
      }
      return res.status(500).json({ 
        message: 'Failed to generate receipt reference number after multiple attempts. Please try again.',
        error: error.message 
      });
    }
    
    // Create transaction AFTER generating reference number
    const transaction = await sequelize.transaction();
    
    try {
    const { id } = req.params;
    const {
      paymentAmount,
      paymentTypeId,
      useCustomerDeposit,
      depositAmount,
      useLoyaltyPoints,
      loyaltyPointsAmount,
      itemPayments, // Object with item_id/item_key as key and payment amount as value
      chequeNumber,
      bankDetailId,
      branch,
      currencyId,
      exchangeRate,
      exchangeRateId,
      description,
      transactionDate,
      receivableAccountId
    } = req.body;

    // Validate required fields
    if (!paymentAmount || paymentAmount <= 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Payment amount is required and must be greater than 0' });
    }

    if (!paymentTypeId && !useCustomerDeposit && !useLoyaltyPoints) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Payment type, customer deposit, or loyalty points is required' });
    }

    if (useCustomerDeposit && (!depositAmount || depositAmount <= 0)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Deposit amount is required when using customer deposit' });
    }

    if (useLoyaltyPoints && (!loyaltyPointsAmount || loyaltyPointsAmount <= 0)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Loyalty points amount is required when using loyalty points' });
    }

    if (!currencyId) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Currency is required' });
    }

    if (!transactionDate) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Transaction date is required' });
    }

    // Find the invoice
    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id }),
      transaction
    });

    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Sales invoice not found' });
    }

    // Validate payment amount doesn't exceed balance
    // Use a small tolerance (0.01) to account for floating point rounding errors
    const currentBalance = parseFloat(invoice.balance_amount || invoice.total_amount);
    const tolerance = 0.01; // Allow small rounding differences
    if (paymentAmount > currentBalance + tolerance) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Payment amount (${paymentAmount}) cannot exceed balance (${currentBalance})` 
      });
    }

    // Get system default currency - must belong to the company
    // Get this early as it's needed for deposit validation
    const { Currency } = require('../models');
    const systemCurrency = await Currency.findOne({
      where: buildCompanyWhere(req, { is_default: true }),
      transaction
    });

    if (!systemCurrency) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'System default currency not found. Please ensure your company has a default currency configured.' 
      });
    }

    // Get customer for deposit validation
    const { Customer } = require('../models');
    const customer = await Customer.findOne({
      where: buildCompanyWhere(req, { id: invoice.customer_id }),
      transaction
    });

    if (!customer) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Validate and handle customer deposit
    if (useCustomerDeposit) {
      const customerDepositBalance = parseFloat(customer.deposit_balance || 0);
      // Convert depositAmount to system currency for comparison
      // deposit_balance is stored in system currency, but depositAmount is in invoice currency
      const depositAmountInSystemCurrency = depositAmount * exchangeRate;
      
      if (depositAmountInSystemCurrency > customerDepositBalance) {
        await transaction.rollback();
        return res.status(400).json({ 
          message: `Deposit amount (${depositAmount}) cannot exceed available deposit balance (${customerDepositBalance})` 
        });
      }
    }

    // Validate and handle loyalty points
    let loyaltyPointsValue = 0;
    if (useLoyaltyPoints) {
      const customerLoyaltyPoints = parseFloat(customer.loyalty_points || 0);
      if (loyaltyPointsAmount > customerLoyaltyPoints) {
        await transaction.rollback();
        return res.status(400).json({ 
          message: `Loyalty points amount (${loyaltyPointsAmount}) cannot exceed available loyalty points (${customerLoyaltyPoints})` 
        });
      }

      // Get loyalty config to calculate value
      const { LoyaltyCardConfig } = require('../models');
      const loyaltyConfig = await LoyaltyCardConfig.findOne({
        where: buildCompanyWhere(req, { is_active: true }),
        transaction
      });

      if (!loyaltyConfig) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Loyalty configuration not found' });
      }

      const redemptionRate = parseFloat(loyaltyConfig.redemption_rate || 100);
      // Redemption rate is based on system currency
      // Convert loyalty points to system currency value first
      // Then convert to invoice currency if needed
      // Formula: loyaltyPointsValueInSystemCurrency = loyaltyPointsAmount / redemptionRate
      //          loyaltyPointsValue = loyaltyPointsValueInSystemCurrency (already in system currency for GL)
      // Note: For payment amount in invoice currency, we use the exchangeRate conversion
      loyaltyPointsValue = loyaltyPointsAmount / redemptionRate; // This is in system currency
    }

    // Validate payment type and get default account (only if not using deposit)
    let paymentType = null;
    if (paymentTypeId) {
      const { PaymentType } = require('../models');
      paymentType = await PaymentType.findOne({
        where: buildCompanyWhere(req, { id: paymentTypeId }),
        include: [
          {
            model: Account,
            as: 'defaultAccount',
            attributes: ['id', 'code', 'name', 'type']
          }
        ],
        transaction
      });

      if (!paymentType) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Payment type not found' });
      }

      // Validate payment type is allowed for debtor payments (invoice payments)
      if (!paymentType.used_in_debtor_payments) {
        await transaction.rollback();
        return res.status(400).json({ 
          message: 'This payment type is not allowed for invoice payments. Please select a payment type that is enabled for debtor payments.' 
        });
      }

      // Validate payment type is active
      if (!paymentType.is_active) {
        await transaction.rollback();
        return res.status(400).json({ message: 'This payment type is not active' });
      }
    }

    // Validate currency
    const currency = await Currency.findOne({
      where: buildCompanyWhere(req, { id: currencyId }),
      transaction
    });

    if (!currency) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Currency not found' });
    }

    // Validate payment currency matches invoice currency
    // This ensures consistent accounting and prevents exchange rate complications
    // Note: If you need to support different payment currencies, you'll need to:
    // 1. Remove this validation
    // 2. Add exchange rate gain/loss tracking
    // 3. Create FX gain/loss GL entries when rates differ
    if (currencyId !== invoice.currency_id) {
      await transaction.rollback();
      // Load invoice currency if not already loaded
      const invoiceCurrency = invoice.currency || await Currency.findOne({
        where: buildCompanyWhere(req, { id: invoice.currency_id }),
        transaction
      });
      return res.status(400).json({ 
        message: `Payment currency (${currency.code || currency.name}) must match invoice currency (${invoiceCurrency?.code || invoiceCurrency?.name || 'different currency'}). Please select the same currency as the invoice.` 
      });
    }

    // Validate exchange rate is reasonable (not zero or negative)
    if (!exchangeRate || exchangeRate <= 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Exchange rate must be greater than 0' 
      });
    }

    // Optional: Warn if exchange rate differs significantly from invoice rate
    // This helps catch potential errors while still allowing legitimate rate changes
    const invoiceExchangeRate = parseFloat(invoice.exchange_rate || 1.0);
    const rateDifference = Math.abs(exchangeRate - invoiceExchangeRate) / invoiceExchangeRate;
    if (rateDifference > 0.05) {
      // Exchange rates can legitimately change - no action needed
    }

    // Validate bank details if required
    if (bankDetailId) {
      const { BankDetail } = require('../models');
      const bankDetail = await BankDetail.findOne({
        where: buildCompanyWhere(req, { id: bankDetailId }),
        transaction
      });

      if (!bankDetail) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Bank detail not found' });
      }
    }

    // Validate transaction date is not earlier than invoice date
    const invoiceDateStr = invoice.invoice_date ? new Date(invoice.invoice_date).toISOString().split('T')[0] : null;
    const transactionDateStr = transactionDate.split('T')[0];
    
    if (invoiceDateStr && transactionDateStr < invoiceDateStr) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Transaction date (${transactionDateStr}) cannot be earlier than invoice date (${invoiceDateStr}).` 
      });
    }

    // Get current financial year - use the same pattern as financialYear.js stats route
    const currentYearWhere = {
      isCurrent: true,
      isActive: true,
      ...buildCompanyWhere(req)
    };
    if (!req.user.isSystemAdmin && req.user.companyId) {
      currentYearWhere.companyId = req.user.companyId;
    }
    
    const currentFinancialYear = await FinancialYear.findOne({
      where: currentYearWhere,
      transaction
    });

    if (!currentFinancialYear) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No current financial year found' });
    }

    // Validate transaction date is within financial year range
    const transactionDateStrForValidation = transactionDateStr;
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (transactionDateStrForValidation < startDateStr || transactionDateStrForValidation > endDateStr) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Transaction date must be within the current financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Calculate new paid amount and balance
    const currentPaidAmount = parseFloat(invoice.paid_amount || 0);
    const newPaidAmount = currentPaidAmount + paymentAmount;
    const newBalanceAmount = parseFloat(invoice.total_amount) - newPaidAmount;

    // Determine payment status
    let paymentStatus = 'unpaid';
    if (newPaidAmount >= parseFloat(invoice.total_amount)) {
      paymentStatus = newPaidAmount > parseFloat(invoice.total_amount) ? 'overpaid' : 'paid';
    } else if (newPaidAmount > 0) {
      paymentStatus = 'partial';
    }

    // Update invoice
    const updateData = {
      paid_amount: newPaidAmount,
      balance_amount: newBalanceAmount,
      payment_status: paymentStatus,
      updated_by: req.user.id
    };

    // Set paid_at if fully paid
    if (paymentStatus === 'paid' && !invoice.paid_at) {
      updateData.paid_at = new Date();
    }

    await invoice.update(updateData, { transaction });

    // Update sales transaction record to reflect payment changes
    try {
      // Reload invoice to get updated values
      await invoice.reload({ transaction });
      await updateTransactionFromInvoice(invoice, req, { transaction });
    } catch (transactionError) {
      // Don't fail the payment if transaction update fails
    }

    // Create General Ledger entries for payment
    // Get account receivable - use provided receivableAccountId or fall back to invoice's account_receivable_id
    const receivableAccountIdToUse = receivableAccountId || invoice.account_receivable_id;
    
    if (!receivableAccountIdToUse) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Account receivable is required. Please provide a receivable account or ensure the invoice has an account receivable assigned.' });
    }

    const accountReceivable = await Account.findOne({
      where: buildCompanyWhere(req, { id: receivableAccountIdToUse }),
      transaction
    });

    if (!accountReceivable) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Account receivable not found' });
    }

    // Get asset account, liability account, or loyalty account based on payment method
    let assetAccount = null;
    let liabilityAccount = null;
    let loyaltyAccount = null;

    // Get linked accounts for account_balance and loyalty_cards
    const { LinkedAccount } = require('../models');
    const linkedAccounts = await LinkedAccount.findAll({
      where: buildCompanyWhere(req, {}),
      transaction
    });

    if (useCustomerDeposit) {
      // For customer deposit, get linked account for account_balance
      const accountBalanceLinkedAccount = linkedAccounts.find(
        la => la.account_type === 'account_balance' && la.account_id
      );
      
      if (!accountBalanceLinkedAccount || !accountBalanceLinkedAccount.account_id) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Account balance account is not configured in Linked Accounts. Please configure a linked account for account balance.' });
      }

      liabilityAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: accountBalanceLinkedAccount.account_id }),
        transaction
      });

      if (!liabilityAccount) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Account balance account not found' });
      }
    } else if (useLoyaltyPoints) {
      // For loyalty points, get linked account for loyalty_cards
      const loyaltyLinkedAccount = linkedAccounts.find(
        la => la.account_type === 'loyalty_cards' && la.account_id
      );
      
      if (!loyaltyLinkedAccount || !loyaltyLinkedAccount.account_id) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Loyalty cards account is not configured in Linked Accounts' });
      }

      loyaltyAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: loyaltyLinkedAccount.account_id }),
        transaction
      });

      if (!loyaltyAccount) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Loyalty cards account not found' });
      }
    } else if (paymentType) {
      // For payment type, get default asset account
      if (paymentType.defaultAccount) {
        assetAccount = paymentType.defaultAccount;
      } else if (paymentType.default_account_id) {
        assetAccount = await Account.findOne({
          where: buildCompanyWhere(req, { id: paymentType.default_account_id }),
          transaction
        });
      }

      if (!assetAccount) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Payment type does not have a default account assigned' });
      }
    }

    // System currency already fetched earlier for deposit validation

    // Get or create transaction type for invoice payments
    let transactionType = await TransactionType.findOne({ 
      where: { code: 'INVOICE_PAYMENT' } // Global - no company filtering
    });
    
    if (!transactionType) {
      transactionType = await TransactionType.create({
        companyId: null, // Global - no company association
        code: 'INVOICE_PAYMENT',
        name: 'Invoice Payment',
        description: 'Sales invoice payment transactions'
      }, { transaction });
    }

    // Calculate equivalent amount in system currency
    const equivalentAmount = paymentAmount * exchangeRate;

    // Create General Ledger entries
    const generalLedgerId = require('uuid').v4();
    const paymentDescription = description || `Payment for invoice ${invoice.invoice_ref_number}`;
    
    if (useCustomerDeposit) {
      // Customer Deposit Payment: Debit Liability Account (reduce deposit), Credit Account Receivable
      
      // Liability Account Entry (Debit) - Reduce customer deposit
      await GeneralLedger.create({
        id: require('uuid').v4(),
        financial_year_code: currentFinancialYear.name,
        financial_year_id: currentFinancialYear.id,
        system_date: new Date(),
        transaction_date: transactionDate,
        reference_number: invoice.invoice_ref_number,
        transaction_type: 'INVOICE_PAYMENT',
        transaction_type_name: 'Invoice Payment (Customer Deposit)',
        transaction_type_id: transactionType.id,
        created_by_code: req.user.id,
        created_by_name: `${req.user.first_name} ${req.user.last_name}`,
        description: paymentDescription,
        account_type_code: liabilityAccount.type || 'LIABILITY',
        account_type_name: liabilityAccount.type || 'Liability',
        account_id: liabilityAccount.id,
        account_name: liabilityAccount.name,
        account_code: liabilityAccount.code,
        account_nature: 'debit',
        exchange_rate: exchangeRate,
        amount: depositAmount,
        system_currency_id: systemCurrency.id,
        user_debit_amount: depositAmount,
        equivalent_debit_amount: depositAmount * exchangeRate,
        username: req.user.username,
        general_ledger_id: generalLedgerId,
        companyId: req.user.companyId
      }, { transaction });
    }
    
    if (useLoyaltyPoints) {
      // Loyalty Points Payment: Debit Loyalty Account, Credit Account Receivable
      
      // Loyalty Account Entry (Debit) - Reduce loyalty points balance
      await GeneralLedger.create({
        id: require('uuid').v4(),
        financial_year_code: currentFinancialYear.name,
        financial_year_id: currentFinancialYear.id,
        system_date: new Date(),
        transaction_date: transactionDate,
        reference_number: invoice.invoice_ref_number,
        transaction_type: 'INVOICE_PAYMENT',
        transaction_type_name: 'Invoice Payment (Loyalty Points)',
        transaction_type_id: transactionType.id,
        created_by_code: req.user.id,
        created_by_name: `${req.user.first_name} ${req.user.last_name}`,
        description: paymentDescription,
        account_type_code: loyaltyAccount.type || 'ASSET',
        account_type_name: loyaltyAccount.type || 'Asset',
        account_id: loyaltyAccount.id,
        account_name: loyaltyAccount.name,
        account_code: loyaltyAccount.code,
        account_nature: 'debit',
        exchange_rate: exchangeRate,
        amount: loyaltyPointsValue,
        system_currency_id: systemCurrency.id,
        user_debit_amount: loyaltyPointsValue,
        equivalent_debit_amount: loyaltyPointsValue * exchangeRate,
        username: req.user.username,
        general_ledger_id: generalLedgerId,
        companyId: req.user.companyId
      }, { transaction });
    }
    
    if (paymentType) {
      // Payment Type Payment: Debit Asset Account (cash/bank), Credit Account Receivable
      // Calculate payment amount from payment type (total minus deposit and loyalty points)
      const paymentTypeAmount = paymentAmount - (depositAmount || 0) - (loyaltyPointsValue || 0);
      
      if (paymentTypeAmount > 0) {
        // Asset Account Entry (Debit) - Cash/Bank account receives payment
        await GeneralLedger.create({
          id: require('uuid').v4(),
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: transactionDate,
          reference_number: invoice.invoice_ref_number,
          transaction_type: 'INVOICE_PAYMENT',
          transaction_type_name: 'Invoice Payment',
          transaction_type_id: transactionType.id,
          created_by_code: req.user.id,
          created_by_name: `${req.user.first_name} ${req.user.last_name}`,
          description: paymentDescription,
          account_type_code: assetAccount.type || 'ASSET',
          account_type_name: assetAccount.type || 'Asset',
          account_id: assetAccount.id,
          account_name: assetAccount.name,
          account_code: assetAccount.code,
          account_nature: 'debit',
          exchange_rate: exchangeRate,
          amount: paymentTypeAmount,
          system_currency_id: systemCurrency.id,
          user_debit_amount: paymentTypeAmount,
          equivalent_debit_amount: paymentTypeAmount * exchangeRate,
          username: req.user.username,
          general_ledger_id: generalLedgerId,
          companyId: req.user.companyId
        }, { transaction });
      }
    }

    // Handle WHT (Withholding Tax) posting dynamically from invoice items
    // Get invoice items with WHT tax codes to determine WHT accounts dynamically
    const invoiceItemsWithWHT = await SalesInvoiceItem.findAll({
      where: buildCompanyWhere(req, { 
        sales_invoice_id: invoice.id,
        wht_tax_id: { [Op.ne]: null },
        wht_amount: { [Op.gt]: 0 }
      }),
      include: [
        {
          model: TaxCode,
          as: 'whtTaxCode',
          attributes: ['id', 'code', 'name', 'sales_tax_account_id'],
          include: [
            {
              model: Account,
              as: 'salesTaxAccount',
              attributes: ['id', 'code', 'name', 'type']
            }
          ],
          required: false
        }
      ],
      transaction
    });

    // Group WHT amounts by tax code account
    const whtByAccount = new Map();
    
    invoiceItemsWithWHT.forEach(item => {
      if (item.whtTaxCode && item.whtTaxCode.salesTaxAccount) {
        const accountId = item.whtTaxCode.sales_tax_account_id;
        const whtAmount = parseFloat(item.wht_amount || 0);
        
        if (whtAmount > 0) {
          if (whtByAccount.has(accountId)) {
            const existing = whtByAccount.get(accountId);
            existing.amount += whtAmount;
          } else {
            whtByAccount.set(accountId, {
              account: item.whtTaxCode.salesTaxAccount,
              amount: whtAmount,
              taxCode: item.whtTaxCode
            });
          }
        }
      }
    });

    // Post WHT entries for each unique account
    for (const [accountId, whtData] of whtByAccount.entries()) {
      const whtPayableAccount = whtData.account;
      const whtAmount = whtData.amount;
      const whtTaxCode = whtData.taxCode;
      
      if (!whtPayableAccount) {
        await transaction.rollback();
        return res.status(400).json({ 
          message: `Withholding Tax account is not configured for tax code ${whtTaxCode.code || whtTaxCode.name}. Please configure a sales tax account for this WHT tax code.` 
        });
      }
      
      // WHT Payable Entry (Credit) - Increase WHT liability
      const whtEquivalentAmount = whtAmount * exchangeRate;
      
      await GeneralLedger.create({
        id: require('uuid').v4(),
        financial_year_code: currentFinancialYear.name,
        financial_year_id: currentFinancialYear.id,
        system_date: new Date(),
        transaction_date: transactionDate,
        reference_number: invoice.invoice_ref_number,
        transaction_type: 'INVOICE_PAYMENT',
        transaction_type_name: `Invoice Payment (WHT - ${whtTaxCode.code || whtTaxCode.name})`,
        transaction_type_id: transactionType.id,
        created_by_code: req.user.id,
        created_by_name: `${req.user.first_name} ${req.user.last_name}`,
        description: `${paymentDescription} - Withholding Tax (${whtTaxCode.code || whtTaxCode.name})`,
        account_type_code: whtPayableAccount.type || 'LIABILITY',
        account_type_name: whtPayableAccount.type || 'Liability',
        account_id: whtPayableAccount.id,
        account_name: whtPayableAccount.name,
        account_code: whtPayableAccount.code,
        account_nature: 'credit',
        exchange_rate: exchangeRate,
        amount: whtAmount,
        system_currency_id: systemCurrency.id,
        user_credit_amount: whtAmount,
        equivalent_credit_amount: whtEquivalentAmount,
        username: req.user.username,
        general_ledger_id: generalLedgerId,
        companyId: req.user.companyId
      }, { transaction });
    }

    // Account Receivable Entry (Credit) - Reduce receivables
    // Credit amount is the total payment amount (items + deposit if applicable)
    // Note: If WHT exists, the receivable is reduced by the full payment amount
    // The WHT portion is separately credited to WHT Payable account above
    await GeneralLedger.create({
      id: require('uuid').v4(),
      financial_year_code: currentFinancialYear.name,
      financial_year_id: currentFinancialYear.id,
      system_date: new Date(),
      transaction_date: transactionDate,
      reference_number: invoice.invoice_ref_number,
      transaction_type: 'INVOICE_PAYMENT',
      transaction_type_name: useCustomerDeposit ? 'Invoice Payment (Customer Deposit)' : 'Invoice Payment',
      transaction_type_id: transactionType.id,
      created_by_code: req.user.id,
      created_by_name: `${req.user.first_name} ${req.user.last_name}`,
      description: paymentDescription,
      account_type_code: accountReceivable.type || 'ASSET',
      account_type_name: accountReceivable.type || 'Asset',
      account_id: accountReceivable.id,
      account_name: accountReceivable.name,
      account_code: accountReceivable.code,
      account_nature: 'credit',
      exchange_rate: exchangeRate,
      amount: paymentAmount,
      system_currency_id: systemCurrency.id,
      user_credit_amount: paymentAmount,
      equivalent_credit_amount: equivalentAmount,
      username: req.user.username,
      general_ledger_id: generalLedgerId,
      companyId: req.user.companyId
    }, { transaction });

    // ========== CREATE RECEIPT RECORDS ==========
    // Receipt reference number already generated before transaction (to avoid race conditions)

    // Determine payment method type
    let paymentMethodType = 'payment_type';
    if (useCustomerDeposit && useLoyaltyPoints) {
      paymentMethodType = 'mixed';
    } else if (useCustomerDeposit) {
      paymentMethodType = 'customer_deposit';
    } else if (useLoyaltyPoints) {
      paymentMethodType = 'loyalty_points';
    }

    // Get invoice items for receipt_items creation
    const invoiceItems = await SalesInvoiceItem.findAll({
      where: buildCompanyWhere(req, { sales_invoice_id: invoice.id }),
      transaction
    });

    // Get sales agent info
    let salesAgentName = null;
    if (invoice.sales_agent_id) {
      const salesAgent = await SalesAgent.findOne({
        where: buildCompanyWhere(req, { id: invoice.sales_agent_id }),
        attributes: ['id', 'full_name'],
        transaction
      });
      if (salesAgent) {
        salesAgentName = salesAgent.full_name;
      }
    }

    // Create receipt record
    const receiptData = {
      companyId: req.user.companyId,
      receiptReferenceNumber,
      salesInvoiceId: invoice.id,
      customerId: invoice.customer_id,
      salesAgentId: invoice.sales_agent_id,
      paymentAmount: parseFloat(paymentAmount),
      currencyId,
      exchangeRate: parseFloat(exchangeRate),
      exchangeRateId: exchangeRateId || null,
      systemDefaultCurrencyId: systemCurrency.id,
      equivalentAmount: equivalentAmount,
      paymentTypeId: paymentTypeId || null,
      useCustomerDeposit: useCustomerDeposit || false,
      depositAmount: depositAmount ? parseFloat(depositAmount) : null,
      useLoyaltyPoints: useLoyaltyPoints || false,
      loyaltyPointsAmount: loyaltyPointsAmount ? parseFloat(loyaltyPointsAmount) : null,
      loyaltyPointsValue: loyaltyPointsValue || null,
      chequeNumber: chequeNumber || null,
      bankDetailId: bankDetailId || null,
      branch: branch || null,
      receivableAccountId: receivableAccountIdToUse,
      assetAccountId: assetAccount ? assetAccount.id : null,
      liabilityAccountId: liabilityAccount ? liabilityAccount.id : null,
      transactionDate: transactionDate,
      financialYearId: currentFinancialYear.id,
      description: description || null,
      status: 'active',
      createdBy: req.user.id,
      updatedBy: req.user.id
    };
    
    // Double-check all required foreign keys exist in the company
    const requiredChecks = [
      { model: SalesInvoice, id: receiptData.salesInvoiceId, name: 'Sales Invoice' },
      { model: Customer, id: receiptData.customerId, name: 'Customer' },
      { model: Currency, id: receiptData.currencyId, name: 'Currency' },
      { model: Currency, id: receiptData.systemDefaultCurrencyId, name: 'System Currency' },
      { model: FinancialYear, id: receiptData.financialYearId, name: 'Financial Year' },
      { model: Account, id: receiptData.receivableAccountId, name: 'Receivable Account' }
    ];
    
    for (const check of requiredChecks) {
      const exists = await check.model.findOne({
        where: buildCompanyWhere(req, { id: check.id }),
        attributes: ['id'],
        transaction
      });
      if (!exists) {
        await transaction.rollback();
        return res.status(400).json({ 
          message: `${check.name} (${check.id}) not found or does not belong to your company` 
        });
      }
    }
    
    const receipt = await Receipt.create(receiptData, { transaction });

    // Create receipt_items records for each invoice item payment
    const receiptItems = [];
    if (itemPayments && typeof itemPayments === 'object') {
      // First, get all existing receipt items to calculate paid amounts per item
      const { ReceiptItem } = require('../models');
      const existingReceiptItems = await ReceiptItem.findAll({
        where: buildCompanyWhere(req, {
          salesInvoiceId: invoice.id
        }),
        attributes: [
          [sequelize.col('ReceiptItem.sales_invoice_item_id'), 'sales_invoice_item_id'],
          [sequelize.fn('SUM', sequelize.col('ReceiptItem.payment_amount')), 'total_paid']
        ],
        group: [sequelize.col('ReceiptItem.sales_invoice_item_id')],
        raw: true,
        transaction
      });

      // Create a map of item ID to total paid amount
      const itemPaidAmounts = {};
      existingReceiptItems.forEach((item) => {
        const itemId = item.sales_invoice_item_id;
        const totalPaid = parseFloat(item.total_paid || 0);
        itemPaidAmounts[itemId] = totalPaid;
      });

      for (const [itemKey, itemPaymentAmount] of Object.entries(itemPayments)) {
        if (itemPaymentAmount > 0) {
          // Find the invoice item by id or index
          let invoiceItem = null;
          if (itemKey.startsWith('item-')) {
            // Index-based key (e.g., "item-0")
            const index = parseInt(itemKey.replace('item-', ''));
            invoiceItem = invoiceItems[index];
          } else {
            // ID-based key
            invoiceItem = invoiceItems.find(item => item.id === itemKey);
          }

          if (invoiceItem) {
            const itemTotal = parseFloat(invoiceItem.line_total || 0);
            const itemPaidSoFar = itemPaidAmounts[invoiceItem.id] || 0;
            const itemRemaining = itemTotal - itemPaidSoFar;
            const itemPayment = parseFloat(itemPaymentAmount);

            // Validate that item payment doesn't exceed remaining balance
            if (itemPayment > itemRemaining) {
              await transaction.rollback();
              return res.status(400).json({ 
                message: `Payment amount for item "${invoiceItem.product?.name || 'N/A'}" (${itemPayment}) cannot exceed remaining balance (${itemRemaining})` 
              });
            }

            const newItemRemaining = Math.max(0, itemRemaining - itemPayment);

            const receiptItem = await ReceiptItem.create({
              companyId: req.user.companyId,
              receiptId: receipt.id,
              salesInvoiceId: invoice.id,
              salesInvoiceItemId: invoiceItem.id,
              salesAgentId: invoice.sales_agent_id,
              paymentAmount: itemPayment,
              currencyId,
              exchangeRate: parseFloat(exchangeRate),
              exchangeRateId: exchangeRateId || null,
              systemDefaultCurrencyId: systemCurrency.id,
              equivalentAmount: itemPayment * parseFloat(exchangeRate),
              itemTotal: itemTotal,
              itemRemaining: newItemRemaining,
              financialYearId: currentFinancialYear.id
            }, { transaction });

            receiptItems.push(receiptItem);
          }
        }
      }
    }
    
    // Validate that ReceiptItems were created if payment was made
    if (receiptItems.length === 0 && paymentAmount > 0) {
      // No receipt items created for payment
    }

    // Create receipt_transaction record
    const receiptTransaction = await ReceiptTransaction.create({
      companyId: req.user.companyId,
      systemDate: new Date(),
      transactionDate: transactionDate,
      financialYearId: currentFinancialYear.id,
      financialYearName: currentFinancialYear.name,
      transactionTypeId: transactionType.id,
      transactionTypeName: transactionType.name,
      receiptId: receipt.id,
      receiptReferenceNumber,
      salesInvoiceId: invoice.id,
      invoiceReferenceNumber: invoice.invoice_ref_number,
      storeId: invoice.store_id,
      customerId: invoice.customer_id,
      customerName: customer.full_name,
      salesAgentId: invoice.sales_agent_id,
      salesAgentName: salesAgentName,
      paymentTypeId: paymentTypeId || null,
      paymentTypeName: paymentType ? paymentType.name : null,
      paymentMethod: paymentMethodType,
      currencyId,
      systemCurrencyId: systemCurrency.id,
      exchangeRate: parseFloat(exchangeRate),
      exchangeRateId: exchangeRateId || null,
      paymentAmount: parseFloat(paymentAmount),
      equivalentAmount: equivalentAmount,
      depositAmount: depositAmount ? parseFloat(depositAmount) : null,
      loyaltyPointsAmount: loyaltyPointsAmount ? parseFloat(loyaltyPointsAmount) : null,
      loyaltyPointsValue: loyaltyPointsValue || null,
      receivableAccountId: receivableAccountIdToUse,
      assetAccountId: assetAccount ? assetAccount.id : null,
      liabilityAccountId: liabilityAccount ? liabilityAccount.id : null,
      loyaltyAccountId: loyaltyAccount ? loyaltyAccount.id : null,
      accountReceivableCode: accountReceivable.code,
      accountReceivableName: accountReceivable.name,
      assetAccountCode: assetAccount ? assetAccount.code : null,
      assetAccountName: assetAccount ? assetAccount.name : null,
      liabilityAccountCode: liabilityAccount ? liabilityAccount.code : null,
      liabilityAccountName: liabilityAccount ? liabilityAccount.name : null,
      loyaltyAccountCode: loyaltyAccount ? loyaltyAccount.code : null,
      loyaltyAccountName: loyaltyAccount ? loyaltyAccount.name : null,
      chequeNumber: chequeNumber || null,
      bankDetailId: bankDetailId || null,
      branch: branch || null,
      description: description || null,
      referenceNumber: receiptReferenceNumber,
      referenceType: 'receipt',
      transactionStatus: 'active',
      isReversal: false,
      createdById: req.user.id,
      createdByName: `${req.user.first_name} ${req.user.last_name}`,
      notes: description || null,
      isActive: true
    }, { transaction });

    // ========== UPDATE CUSTOMER BALANCES ==========
    // Update customer deposit balance (decrement if using deposit)
    if (useCustomerDeposit && depositAmount > 0) {
      await Customer.decrement('deposit_balance', {
        by: depositAmount * exchangeRate, // Use equivalent amount in system currency
        where: buildCompanyWhere(req, { id: customer.id }),
        transaction
      });
    }

    // Update customer loyalty points (decrement if using loyalty points)
    if (useLoyaltyPoints && loyaltyPointsAmount > 0) {
      await Customer.decrement('loyalty_points', {
        by: loyaltyPointsAmount,
        where: buildCompanyWhere(req, { id: customer.id }),
        transaction
      });
    }

    // Update customer debt balance (decrement by payment amount in system currency)
    // This reduces the customer's outstanding debt
    await Customer.decrement('debt_balance', {
      by: equivalentAmount, // Payment amount in system currency
      where: buildCompanyWhere(req, { id: customer.id }),
      transaction
    });

    // Commit transaction
    await transaction.commit();

    // Fetch updated invoice with all relations
    const updatedInvoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id: invoice.id }),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'fax', 'phone_number', 'email']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol']
        },
        {
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'name', 'code']
            }
          ]
        }
      ]
    });

    res.json(transformSalesInvoice(updatedInvoice));
    
    // Break out of retry loop on success
    break;
    
    } catch (createError) {
      // Rollback transaction on error
      await transaction.rollback();
      
      const constraintName = createError.parent?.constraint || createError.index || '';
      const errorDetail = createError.parent?.detail || createError.parent?.message || '';
      const errorMessage = createError.message || '';
      
      // Handle SequelizeValidationError - don't retry, return detailed error
      if (createError.name === 'SequelizeValidationError') {
        return res.status(400).json({ 
          message: 'Validation error', 
          error: createError.message,
          details: createError.errors?.map(e => ({ 
            field: e.path, 
            message: e.message,
            value: e.value
          }))
        });
      }
      
      // Check if it's a unique constraint error on receipt_reference_number
      // Only retry for unique constraint errors on receipt_reference_number
      const isReceiptRefNumberError = 
        createError.name === 'SequelizeUniqueConstraintError' &&
        (constraintName.includes('receipt_reference_number') ||
         constraintName.includes('receiptReferenceNumber') ||
         constraintName.includes('receipts_receipt_reference_number_companyId_unique') ||
         errorDetail.includes('receipt_reference_number') ||
         errorDetail.includes('receiptReferenceNumber') ||
         createError.errors?.some(e => 
           (e.path === 'receipt_reference_number' || e.path === 'receiptReferenceNumber') &&
           e.type === 'unique violation'
         ));
      
      if (isReceiptRefNumberError) {
        retryCount++;
        if (retryCount >= maxRetries) {
          return res.status(500).json({ 
            message: 'Failed to generate unique receipt reference number after multiple attempts. Please try again.',
            error: createError.message
          });
        }
        // Continue to retry with new reference number (will be generated at top of loop)
        continue;
      }
      
      // For other errors, return detailed error information
      return res.status(500).json({ 
        message: 'Error recording payment', 
        error: createError.message,
        details: process.env.NODE_ENV === 'development' ? {
          name: createError.name,
          errors: createError.errors?.map(e => ({ 
            path: e.path, 
            message: e.message, 
            type: e.type 
          })),
          constraint: constraintName
        } : undefined
      });
    }
  }
  
  // If we exhausted all retries without success
  if (retryCount >= maxRetries) {
    return res.status(500).json({ 
      message: 'Failed to record payment after multiple attempts. Please try again.',
    });
  }
});

module.exports = router;

