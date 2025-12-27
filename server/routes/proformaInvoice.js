const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const { ProformaInvoice, ProformaInvoiceItem, FinancialYear, User, Store, Customer, Currency, ExchangeRate, Product, TaxCode, SalesInvoice, SalesInvoiceItem, LinkedAccount, sequelize } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ExportService = require('../utils/exportService');
const { createTransactionFromInvoice } = require('../utils/salesTransactionHelper');

router.use(auth); // Apply authentication to all routes
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks // Apply company filtering to all routes

// Helper function to generate proforma reference number (sequential across dates)
// IMPORTANT: This is per-company sequential. The sequence continues across dates.
// Example: PF-20251106-0001 → PF-20251107-0002 → PF-20251107-0003 → PF-20251108-0004
// Different companies CAN have the same reference number (e.g., Company A and Company B can both have PF-20251107-0001)
// The unique constraint is composite: ['proforma_ref_number', 'companyId'], allowing duplicates across companies.
// Uses Sequelize ORM with buildCompanyWhere to ensure proper multi-tenant filtering
const generateProformaRefNumber = async (req) => {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  const companyId = req.user?.companyId;
  
  if (!companyId) {
    throw new Error('Company ID is required to generate proforma reference number');
  }
  
  // Get the LAST invoice for this company (regardless of date) to continue the sequence
  // Order by proforma_ref_number DESC to get the highest sequence number
  const lastInvoice = await ProformaInvoice.findOne({
    where: buildCompanyWhere(req, {
      proforma_ref_number: {
        [Op.like]: 'PF-%' // Match any date
      }
    }),
    attributes: ['proforma_ref_number'],
    order: [['proforma_ref_number', 'DESC']]
  });
  
  // Extract the sequence number from the last invoice
  let nextSequence = 1;
  if (lastInvoice && lastInvoice.proforma_ref_number) {
    const match = lastInvoice.proforma_ref_number.match(/PF-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }
  
  // Generate the reference number with today's date and the next sequence number
  const referenceNumber = `PF-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  
  // Double-check that this number doesn't exist (safety check, filtered by company)
  const existing = await ProformaInvoice.findOne({
    where: buildCompanyWhere(req, { proforma_ref_number: referenceNumber }),
    attributes: ['id']
  });
  
  if (existing) {
    // If it exists (shouldn't happen, but safety check), increment and try again
    nextSequence++;
    return `PF-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  }
  
  return referenceNumber;
};

// Helper function to transform proforma invoice data
const transformProformaInvoice = (invoice) => {
  return {
    id: invoice.id,
    proformaRefNumber: invoice.proforma_ref_number,
    proformaDate: invoice.proforma_date,
    storeId: invoice.store_id,
    storeName: invoice.store?.name,
    customerId: invoice.customer_id,
    customerName: invoice.customer?.full_name,
    customerCode: invoice.customer?.customer_id,
    customerAddress: invoice.customer?.address,
    customerFax: invoice.customer?.fax,
    customerPhone: invoice.customer?.phone_number,
    customerEmail: invoice.customer?.email,
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
    status: invoice.status,
    isConverted: invoice.is_converted || false,
    validUntil: invoice.valid_until,
    notes: invoice.notes,
    termsConditions: invoice.terms_conditions,
    createdBy: invoice.created_by,
    createdByName: invoice.createdByUser ? `${invoice.createdByUser.first_name} ${invoice.createdByUser.last_name}` : 'System',
    updatedBy: invoice.updated_by,
    updatedByName: invoice.updatedByUser ? `${invoice.updatedByUser.first_name} ${invoice.updatedByUser.last_name}` : null,
    sentBy: invoice.sent_by,
    sentByName: invoice.sentByUser ? `${invoice.sentByUser.first_name} ${invoice.sentByUser.last_name}` : null,
    sentAt: invoice.sent_at,
    acceptedBy: invoice.accepted_by,
    acceptedByName: invoice.acceptedByUser ? `${invoice.acceptedByUser.first_name} ${invoice.acceptedByUser.last_name}` : null,
    acceptedAt: invoice.accepted_at,
    rejectedBy: invoice.rejected_by,
    rejectedByName: invoice.rejectedByUser ? `${invoice.rejectedByUser.first_name} ${invoice.rejectedByUser.last_name}` : null,
    rejectedAt: invoice.rejected_at,
    rejectionReason: invoice.rejection_reason,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
    items: invoice.items?.map(item => ({
      id: item.id,
      proformaInvoiceId: item.proforma_invoice_id,
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
    currency: invoice.currency,
    systemDefaultCurrency: invoice.systemDefaultCurrency,
    exchangeRate: invoice.exchangeRate,
    createdByUser: invoice.createdByUser,
    updatedByUser: invoice.updatedByUser,
    sentByUser: invoice.sentByUser,
    acceptedByUser: invoice.acceptedByUser,
    rejectedByUser: invoice.rejectedByUser
  };
};

// GET /api/proforma-invoices - Get all proforma invoices with pagination and search
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      storeId,
      customerId,
      currencyId,
      dateFrom,
      dateTo,
      converted, // New filter: 'true' to show only converted invoices, 'false' for non-converted
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
      'proformaRefNumber': 'proforma_ref_number',
      'proformaDate': 'proforma_date',
      'totalAmount': 'total_amount',
      'status': 'status',
      'sentAt': 'sent_at',
      'acceptedAt': 'accepted_at',
      'rejectedAt': 'rejected_at',
      'validUntil': 'valid_until'
    };
    
    // Associated model fields that need special handling
    // Use Sequelize.col() for ordering by associated fields to handle optional associations
    if (sortBy === 'customerName') {
      orderClause = [[Sequelize.col('customer.full_name'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'customerCode') {
      orderClause = [[Sequelize.col('customer.customer_id'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'storeName') {
      orderClause = [[Sequelize.col('store.name'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'sentByName') {
      orderClause = [[Sequelize.col('sentByUser.first_name'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'acceptedByName') {
      orderClause = [[Sequelize.col('acceptedByUser.first_name'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'rejectedByName') {
      orderClause = [[Sequelize.col('rejectedByUser.first_name'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'createdBy') {
      orderClause = [[Sequelize.col('createdByUser.first_name'), sortOrder.toUpperCase()]];
    } else if (sortBy === 'updatedBy') {
      orderClause = [[Sequelize.col('updatedByUser.first_name'), sortOrder.toUpperCase()]];
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
        { proforma_ref_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Filter by status
    if (status) {
      whereClause.status = status;
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
      whereClause.proforma_date = {};
      if (dateFrom) whereClause.proforma_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.proforma_date[Op.lte] = dateTo;
    }

    // Filter by conversion status
    if (converted === 'true') {
      // Only show proforma invoices that have been converted
      whereClause.is_converted = true;
    } else if (converted === 'false') {
      // Only show proforma invoices that have NOT been converted
      whereClause.is_converted = false;
    }

    const { count, rows } = await ProformaInvoice.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name'],
          required: false // LEFT JOIN to allow NULL stores
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'fax', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points'],
          required: false // LEFT JOIN to allow NULL customers
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
          model: require('../models').PriceCategory,
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
          as: 'acceptedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        }
      ],
      order: orderClause,
      limit: parseInt(limit),
      offset: offset
    });

    // Check and update expired status for invoices with valid_until date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const invoice of rows) {
      if (invoice.valid_until && invoice.status !== 'expired' && invoice.status !== 'accepted' && invoice.status !== 'rejected') {
        const validUntilDate = new Date(invoice.valid_until);
        validUntilDate.setHours(0, 0, 0, 0);
        
        if (validUntilDate < today) {
          // Invoice has expired, update status
          await invoice.update({ status: 'expired' });
          invoice.status = 'expired';
        }
      }
    }

    const transformedInvoices = rows.map(transformProformaInvoice);

    res.json({
      proformaInvoices: transformedInvoices,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit)),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/proforma-invoices/all - Get all active proforma invoices for dropdowns
router.get('/all', async (req, res) => {
  try {
    const invoices = await ProformaInvoice.findAll({
      where: buildCompanyWhere(req, {
        status: { [Op.in]: ['draft', 'sent', 'accepted'] }
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
      order: [['proforma_ref_number', 'DESC']],
      limit: 100
    });

    const transformedInvoices = invoices.map(transformProformaInvoice);
    res.json(transformedInvoices);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/proforma-invoices/stats/overview - Get proforma invoice statistics
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
      acceptedCount,
      rejectedCount,
      expiredCount,
      totalValue,
      thisMonthCount,
      lastMonthCount
    ] = await Promise.all([
      ProformaInvoice.count({ where: buildCompanyWhere(req) }),
      ProformaInvoice.count({ where: buildCompanyWhere(req, { status: 'draft' }) }),
      ProformaInvoice.count({ where: buildCompanyWhere(req, { status: 'sent' }) }),
      ProformaInvoice.count({ where: buildCompanyWhere(req, { status: 'accepted' }) }),
      ProformaInvoice.count({ where: buildCompanyWhere(req, { status: 'rejected' }) }),
      ProformaInvoice.count({ where: buildCompanyWhere(req, { status: 'expired' }) }),
      ProformaInvoice.sum('equivalent_amount', { where: buildCompanyWhere(req) }),
      ProformaInvoice.count({
        where: buildCompanyWhere(req, {
          created_at: { [Op.gte]: startOfMonth }
        })
      }),
      ProformaInvoice.count({
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
      accepted: acceptedCount || 0,
      rejected: rejectedCount || 0,
      expired: expiredCount || 0,
      totalValue: totalValue || 0,
      thisMonth: thisMonthCount || 0,
      lastMonth: lastMonthCount || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/proforma-invoices/:id - Get proforma invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await ProformaInvoice.findOne({
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
          model: require('../models').PriceCategory,
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
          as: 'acceptedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: ProformaInvoiceItem,
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
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    // Check and update expired status if needed
    if (invoice.valid_until && invoice.status !== 'expired' && invoice.status !== 'accepted' && invoice.status !== 'rejected') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const validUntilDate = new Date(invoice.valid_until);
      validUntilDate.setHours(0, 0, 0, 0);
      
      if (validUntilDate < today) {
        // Invoice has expired, update status
        await invoice.update({ status: 'expired' });
        invoice.status = 'expired';
      }
    }

    const transformedInvoice = transformProformaInvoice(invoice);
    res.json(transformedInvoice);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/proforma-invoices - Create new proforma invoice
router.post('/', csrfProtection, async (req, res) => {
  try {
    const {
      proforma_date: proformaDate,
      proformaDate: proformaDateAlt,
      store_id: storeId,
      storeId: storeIdAlt,
      customer_id: customerId,
      customerId: customerIdAlt,
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
      notes,
      terms_conditions: termsConditions,
      termsConditions: termsConditionsAlt,
      items
    } = req.body;
    
    // Use camelCase values if provided, otherwise fall back to snake_case
    const finalProformaDate = proformaDate || proformaDateAlt;
    const finalStoreId = storeId || storeIdAlt;
    const finalCustomerId = customerId || customerIdAlt;
    const finalCurrencyId = currencyId || currencyIdAlt;
    const finalExchangeRate = exchangeRate || exchangeRateAlt || exchangeRateAlt2 || 1.0;
    const finalSystemDefaultCurrencyId = systemDefaultCurrencyId || systemDefaultCurrencyIdAlt;
    const finalExchangeRateId = exchangeRateId || exchangeRateIdAlt;
    const finalValidUntil = validUntil || validUntilAlt;
    const finalNotes = notes;
    const finalTermsConditions = termsConditions || termsConditionsAlt;

    // Validate required fields
    if (!finalProformaDate) {
      return res.status(400).json({ message: 'Proforma date is required' });
    }
    if (!finalStoreId) {
      return res.status(400).json({ message: 'Store is required' });
    }
    if (!finalCustomerId) {
      return res.status(400).json({ message: 'Customer is required' });
    }
    if (!finalCurrencyId) {
      return res.status(400).json({ message: 'Currency is required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required' });
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

    if (finalCurrencyId) {
      const currency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: finalCurrencyId })
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
    // Get current financial year - use the same pattern as sales invoice (check isActive only)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true })
    });

    if (!currentFinancialYear) {
      return res.status(400).json({ message: 'No active financial year found. Please set up an active financial year before creating proforma invoices.' });
    }

    // Validate proforma date is within financial year range
    const proformaDateObj = new Date(finalProformaDate);
    const startDate = new Date(currentFinancialYear.startDate);
    const endDate = new Date(currentFinancialYear.endDate);
    
    if (proformaDateObj < startDate || proformaDateObj > endDate) {
      return res.status(400).json({ 
        message: `Proforma date must be within the active financial year range (${currentFinancialYear.startDate} to ${currentFinancialYear.endDate}).` 
      });
    }

    // Retry logic for handling race conditions in reference number generation
    // IMPORTANT: Generate reference number OUTSIDE transaction (same as customer deposits)
    // This prevents transaction isolation issues when checking for existing numbers
    let invoice;
    let proformaRefNumber;
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      // Generate proforma reference number OUTSIDE the transaction (same as customer deposits)
      // This ensures we see all committed invoices when checking for existing numbers
      // Add a small delay on retries to ensure we get fresh data
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      }
      
      proformaRefNumber = await generateProformaRefNumber(req);
      
      // Create transaction AFTER generating reference number
      const transaction = await sequelize.transaction();
      
      try {
    // Create proforma invoice
        invoice = await ProformaInvoice.create({
      proforma_ref_number: proformaRefNumber,
      proforma_date: finalProformaDate,
      store_id: finalStoreId,
      customer_id: finalCustomerId,
      currency_id: finalCurrencyId,
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
      equivalent_amount: finalExchangeRate ? totalAmount * finalExchangeRate : totalAmount,
      price_category_id: req.body.price_category_id || req.body.priceCategoryId || null,
      status: 'draft',
      valid_until: finalValidUntil,
      notes: finalNotes,
      terms_conditions: finalTermsConditions,
      created_by: req.user.id,
      updated_by: req.user.id
        }, { transaction });

    // Create proforma invoice items
    const invoiceItems = await Promise.all(
      items.map((item, index) => {
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

        return ProformaInvoiceItem.create({
          proforma_invoice_id: invoice.id,
          product_id: item.product_id || item.productId,
          quantity: quantity, // Quantity from frontend
          companyId: req.user.companyId,
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
          created_by: req.user.id,
          updated_by: req.user.id
            }, { transaction });
      })
    );

        // Commit transaction if everything succeeds
        await transaction.commit();
        
        // Break out of retry loop on success
        break;
      } catch (createError) {
        // Rollback transaction on error
        await transaction.rollback();
        
        // If it's a unique constraint error, retry with a new reference number
        if (createError.name === 'SequelizeUniqueConstraintError' && 
            createError.errors?.some(e => e.path === 'proforma_ref_number')) {
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
      throw new Error('Failed to create proforma invoice after multiple retry attempts');
    }

    // Fetch the created invoice with all relations
    const createdInvoice = await ProformaInvoice.findOne({
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
          model: require('../models').PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'code', 'name', 'price_change_type', 'percentage_change']
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: ProformaInvoiceItem,
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

    const transformedInvoice = transformProformaInvoice(createdInvoice);
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
        message: 'A proforma invoice with this reference number already exists',
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

// PUT /api/proforma-invoices/:id - Update proforma invoice
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      proforma_date: proformaDate,
      proformaDate: proformaDateAlt,
      store_id: storeId,
      storeId: storeIdAlt,
      customer_id: customerId,
      customerId: customerIdAlt,
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
      notes,
      terms_conditions: termsConditions,
      termsConditions: termsConditionsAlt,
      items
    } = req.body;
    
    // Use camelCase values if provided, otherwise fall back to snake_case
    const finalProformaDate = proformaDate || proformaDateAlt;
    const finalStoreId = storeId || storeIdAlt;
    const finalCustomerId = customerId || customerIdAlt;
    const finalCurrencyId = currencyId || currencyIdAlt;
    const finalExchangeRate = exchangeRate || exchangeRateAlt || exchangeRateAlt2 || 1.0;
    const finalSystemDefaultCurrencyId = systemDefaultCurrencyId || systemDefaultCurrencyIdAlt;
    const finalExchangeRateId = exchangeRateId || exchangeRateIdAlt;
    const finalValidUntil = validUntil || validUntilAlt;
    const finalNotes = notes;
    const finalTermsConditions = termsConditions || termsConditionsAlt;

    const invoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Proforma invoice not found' });
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

    if (finalCurrencyId) {
      const currency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: finalCurrencyId })
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

    // Get current financial year
    // Get current financial year - use the same pattern as sales invoice (check isActive only)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true })
    });

    if (!currentFinancialYear) {
      return res.status(400).json({ message: 'No active financial year found. Please set up an active financial year before updating proforma invoices.' });
    }

    // Validate proforma date is within financial year range
    const proformaDateObj = new Date(finalProformaDate);
    const startDate = new Date(currentFinancialYear.startDate);
    const endDate = new Date(currentFinancialYear.endDate);
    
    if (proformaDateObj < startDate || proformaDateObj > endDate) {
      return res.status(400).json({ 
        message: `Proforma date must be within the active financial year range (${currentFinancialYear.startDate} to ${currentFinancialYear.endDate}).` 
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

    // Update proforma invoice
    await invoice.update({
      proforma_date: finalProformaDate,
      store_id: finalStoreId,
      customer_id: finalCustomerId,
      currency_id: finalCurrencyId,
      exchange_rate: finalExchangeRate,
      system_default_currency_id: finalSystemDefaultCurrencyId,
      exchange_rate_id: finalExchangeRateId,
      price_category_id: req.body.price_category_id || req.body.priceCategoryId || null,
      subtotal: subtotal,
      tax_amount: totalTaxAmount,
      discount_amount: totalDiscountAmount,
      total_amount: totalAmount,
      amount_after_discount: amountAfterDiscount, // Calculated: subtotal - discount_amount
      total_wht_amount: totalWHTAmount, // Calculated: sum of all item wht_amount
      amount_after_wht: amountAfterWHT, // Calculated: amount_after_discount - total_wht_amount
      equivalent_amount: finalExchangeRate ? totalAmount * finalExchangeRate : totalAmount,
      valid_until: finalValidUntil,
      notes: finalNotes,
      terms_conditions: finalTermsConditions,
      updated_by: req.user.id
    });

    // Delete existing items (filtered by company)
    await ProformaInvoiceItem.destroy({
      where: buildCompanyWhere(req, { proforma_invoice_id: id })
    });

    // Create new items
    await Promise.all(
      items.map(item => {
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

        return ProformaInvoiceItem.create({
          proforma_invoice_id: id,
          product_id: item.product_id || item.productId,
          quantity: quantity, // Quantity from frontend
          companyId: req.user.companyId,
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
          created_by: req.user.id,
          updated_by: req.user.id
        });
      })
    );

    // Fetch the updated invoice with all relations
    const updatedInvoice = await ProformaInvoice.findOne({
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
          model: require('../models').PriceCategory,
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
          model: ProformaInvoiceItem,
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

    const transformedInvoice = transformProformaInvoice(updatedInvoice);
    res.json(transformedInvoice);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/proforma-invoices/:id - Delete proforma invoice (hard delete)
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    // Only allow deletion of draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft invoices can be deleted' });
    }

    // Delete items first (CASCADE should handle this, but being explicit and filtered by company)
    await ProformaInvoiceItem.destroy({
      where: buildCompanyWhere(req, { proforma_invoice_id: id })
    });

    // Delete the invoice
    await invoice.destroy();

    res.json({ message: 'Proforma invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/proforma-invoices/:id/send - Send proforma invoice
router.put('/:id/send', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft invoices can be sent' });
    }

    await invoice.update({
      status: 'sent',
      sent_by: req.user.id,
      sent_at: new Date()
    });

    res.json({ message: 'Proforma invoice sent successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/proforma-invoices/:id/accept - Accept proforma invoice
router.put('/:id/accept', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    if (invoice.status !== 'sent') {
      return res.status(400).json({ message: 'Only sent invoices can be accepted' });
    }

    await invoice.update({
      status: 'accepted',
      accepted_by: req.user.id,
      accepted_at: new Date()
    });

    res.json({ message: 'Proforma invoice accepted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/proforma-invoices/:id/reject - Reject proforma invoice
router.put('/:id/reject', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    // Validate rejection reason is provided
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const invoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    if (invoice.status !== 'sent') {
      return res.status(400).json({ message: 'Only sent invoices can be rejected' });
    }

    await invoice.update({
      status: 'rejected',
      rejected_by: req.user.id,
      rejected_at: new Date(),
      rejection_reason: rejectionReason.trim()
    });

    res.json({ message: 'Proforma invoice rejected successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/proforma-invoices/:id/reopen - Reopen expired proforma invoice
router.put('/:id/reopen', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { validUntil } = req.body;

    // Validate validUntil is provided
    if (!validUntil || !validUntil.trim()) {
      return res.status(400).json({ message: 'Valid until date is required to reopen the invoice' });
    }

    const invoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    if (invoice.status !== 'expired') {
      return res.status(400).json({ message: 'Only expired invoices can be reopened' });
    }

    // Validate that the new valid_until date is in the future
    const newValidUntil = new Date(validUntil);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    newValidUntil.setHours(0, 0, 0, 0);

    if (newValidUntil <= today) {
      return res.status(400).json({ message: 'Valid until date must be in the future' });
    }

    await invoice.update({
      status: 'draft',
      valid_until: validUntil,
      updated_by: req.user.id
    });

    const updatedInvoice = await ProformaInvoice.findByPk(invoice.id, {
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
          model: require('../models').PriceCategory,
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
        }
      ]
    });

    const transformedInvoice = transformProformaInvoice(updatedInvoice);
    res.json({ message: 'Proforma invoice reopened successfully', invoice: transformedInvoice });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/proforma-invoices/export/excel - Export proforma invoices to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search, status, storeId, customerId, currencyId, dateFrom, dateTo, converted } = req.query;

    const whereClause = {};
    
    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { proforma_ref_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status) whereClause.status = status;
    if (storeId) whereClause.store_id = storeId;
    if (customerId) whereClause.customer_id = customerId;
    if (currencyId) whereClause.currency_id = currencyId;
    if (converted === 'true') {
      whereClause.is_converted = true;
    } else if (converted === 'false') {
      whereClause.is_converted = false;
    }
    // Handle dateFrom and dateTo (frontend sends these as dateFrom/dateTo, but we also check for date_from/date_to)
    const startDate = dateFrom || req.query.date_from;
    const endDate = dateTo || req.query.date_to;
    if (startDate || endDate) {
      whereClause.proforma_date = {};
      if (startDate) whereClause.proforma_date[Op.gte] = startDate;
      if (endDate) whereClause.proforma_date[Op.lte] = endDate;
    }

    const invoices = await ProformaInvoice.findAll({
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
          as: 'acceptedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    const exportService = new ExportService();
    const buffer = await exportService.exportProformaInvoicesToExcel(invoices, req.query);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="proforma_invoices_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Helper function to generate sales invoice reference number (for conversion)
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

// PUT /api/proforma-invoices/:id/convert-to-sales-invoice - Convert proforma invoice to sales invoice
router.put('/:id/convert-to-sales-invoice', csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { invoice_date: invoiceDate, due_date: dueDate } = req.body;
    
    // Find the proforma invoice with all items
    const proformaInvoice = await ProformaInvoice.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: ProformaInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'default_receivable_account_id']
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol']
        }
      ],
      transaction
    });

    if (!proformaInvoice) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Proforma invoice not found' });
    }

    // Validate that proforma invoice is in a convertible state
    if (proformaInvoice.status !== 'sent' && proformaInvoice.status !== 'accepted') {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Only sent or accepted proforma invoices can be converted to sales invoices. Current status: ${proformaInvoice.status}` 
      });
    }

    // Check if this proforma invoice has already been converted
    const existingSalesInvoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { proforma_invoice_id: id }),
      attributes: ['id', 'invoice_ref_number'],
      transaction
    });

    if (existingSalesInvoice) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `This proforma invoice has already been converted to sales invoice: ${existingSalesInvoice.invoice_ref_number}` 
      });
    }

    // Validate that proforma invoice has items
    if (!proformaInvoice.items || proformaInvoice.items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Proforma invoice must have at least one item to convert' });
    }

    // Get current financial year - use the same pattern as sales invoice (check isActive only)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true }),
      transaction
    });

    if (!currentFinancialYear) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No active financial year found. Please set up an active financial year before converting proforma invoices.' });
    }

    // Use provided invoice date or default to today
    const finalInvoiceDate = invoiceDate || new Date().toISOString().split('T')[0];
    const finalDueDate = dueDate || proformaInvoice.valid_until || null;

    // Validate invoice date is within financial year range
    const invoiceDateStr = finalInvoiceDate.split('T')[0];
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (invoiceDateStr < startDateStr || invoiceDateStr > endDateStr) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Invoice date must be within the current financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Generate invoice reference number
    const invoiceRefNumber = await generateInvoiceRefNumber(req);

    // Fetch linked accounts to get default account IDs
    const linkedAccounts = await LinkedAccount.findAll({
      where: buildCompanyWhere(req, {}),
      transaction
    });

    // Find receivables account
    const receivablesAccount = linkedAccounts.find(
      la => la.account_type === 'receivables' && la.account_id
    );
    const defaultAccountReceivableId = receivablesAccount?.account_id || null;

    // Find discounts_allowed account
    const discountsAllowedAccount = linkedAccounts.find(
      la => la.account_type === 'discounts_allowed' && la.account_id
    );
    const defaultDiscountAllowedAccountId = discountsAllowedAccount?.account_id || null;

    // Create sales invoice from proforma invoice data
    const salesInvoice = await SalesInvoice.create({
      invoice_ref_number: invoiceRefNumber,
      invoice_date: finalInvoiceDate,
      due_date: finalDueDate,
      store_id: proformaInvoice.store_id,
      customer_id: proformaInvoice.customer_id,
      proforma_invoice_id: proformaInvoice.id, // Link to proforma invoice
      currency_id: proformaInvoice.currency_id,
      exchange_rate: proformaInvoice.exchange_rate,
      system_default_currency_id: proformaInvoice.system_default_currency_id,
      exchange_rate_id: proformaInvoice.exchange_rate_id,
      price_category_id: proformaInvoice.price_category_id,
      subtotal: proformaInvoice.subtotal,
      tax_amount: proformaInvoice.tax_amount,
      discount_amount: proformaInvoice.discount_amount,
      total_amount: proformaInvoice.total_amount,
      amount_after_discount: proformaInvoice.amount_after_discount,
      total_wht_amount: proformaInvoice.total_wht_amount,
      amount_after_wht: proformaInvoice.amount_after_wht,
      paid_amount: 0.00,
      balance_amount: proformaInvoice.total_amount,
      equivalent_amount: proformaInvoice.equivalent_amount,
      financial_year_id: currentFinancialYear.id,
      status: 'draft', // Start as draft - user can send/approve later
      notes: proformaInvoice.notes,
      terms_conditions: proformaInvoice.terms_conditions,
      account_receivable_id: defaultAccountReceivableId,
      discount_allowed_account_id: defaultDiscountAllowedAccountId,
      companyId: req.user.companyId,
      created_by: req.user.id,
      updated_by: req.user.id
    }, { transaction });

    // Create sales invoice items from proforma invoice items
    const salesInvoiceItems = await Promise.all(
      proformaInvoice.items.map(async (proformaItem) => {
        return await SalesInvoiceItem.create({
          sales_invoice_id: salesInvoice.id,
          product_id: proformaItem.product_id,
          quantity: proformaItem.quantity,
          unit_price: proformaItem.unit_price,
          discount_percentage: proformaItem.discount_percentage,
          discount_amount: proformaItem.discount_amount,
          tax_percentage: proformaItem.tax_percentage,
          tax_amount: proformaItem.tax_amount,
          price_tax_inclusive: proformaItem.price_tax_inclusive || false,
          sales_tax_id: proformaItem.sales_tax_id,
          wht_tax_id: proformaItem.wht_tax_id,
          wht_amount: proformaItem.wht_amount,
          currency_id: proformaItem.currency_id,
          exchange_rate: proformaItem.exchange_rate,
          equivalent_amount: proformaItem.equivalent_amount,
          amount_after_discount: proformaItem.amount_after_discount,
          amount_after_wht: proformaItem.amount_after_wht,
          line_total: proformaItem.line_total,
          notes: proformaItem.notes,
          // Note: serial_numbers, batch_number, expiry_date are not in proforma items
          // These can be added manually when editing the sales invoice
          companyId: req.user.companyId,
          financial_year_id: currentFinancialYear.id,
          created_by: req.user.id,
          updated_by: req.user.id
        }, { transaction });
      })
    );

    // Create sales transaction record
    try {
      await createTransactionFromInvoice(salesInvoice, req, { transaction });
    } catch (transactionError) {
      // Don't fail the conversion if transaction creation fails
    }

    // Update proforma invoice to mark it as converted
    await proformaInvoice.update({
      is_converted: true
    }, { transaction });

    // Commit transaction
    await transaction.commit();

    // Fetch the created sales invoice with all relations
    const createdSalesInvoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { id: salesInvoice.id }),
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
          model: ProformaInvoice,
          as: 'proformaInvoice',
          attributes: ['id', 'proforma_ref_number', 'proforma_date', 'status']
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

    // Transform the sales invoice (using the transform function from salesInvoice route)
    // For now, we'll return a simplified response
    res.json({ 
      message: 'Proforma invoice converted to sales invoice successfully',
      salesInvoice: {
        id: createdSalesInvoice.id,
        invoiceRefNumber: createdSalesInvoice.invoice_ref_number,
        invoiceDate: createdSalesInvoice.invoice_date,
        dueDate: createdSalesInvoice.due_date,
        status: createdSalesInvoice.status,
        totalAmount: parseFloat(createdSalesInvoice.total_amount),
        proformaInvoiceId: createdSalesInvoice.proforma_invoice_id,
        proformaRefNumber: createdSalesInvoice.proformaInvoice?.proforma_ref_number
      }
    });

  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ 
      message: 'Internal server error', 
      error: error.message 
    });
  }
});

// GET /api/proforma-invoices/export/pdf - Export proforma invoices to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search, status, storeId, customerId, currencyId, dateFrom, dateTo, converted } = req.query;

    const whereClause = {};
    
    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { proforma_ref_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status) whereClause.status = status;
    if (storeId) whereClause.store_id = storeId;
    if (customerId) whereClause.customer_id = customerId;
    if (currencyId) whereClause.currency_id = currencyId;
    if (converted === 'true') {
      whereClause.is_converted = true;
    } else if (converted === 'false') {
      whereClause.is_converted = false;
    }
    // Handle dateFrom and dateTo (frontend sends these as dateFrom/dateTo, but we also check for date_from/date_to)
    const startDate = dateFrom || req.query.date_from;
    const endDate = dateTo || req.query.date_to;
    if (startDate || endDate) {
      whereClause.proforma_date = {};
      if (startDate) whereClause.proforma_date[Op.gte] = startDate;
      if (endDate) whereClause.proforma_date[Op.lte] = endDate;
    }

    const invoices = await ProformaInvoice.findAll({
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
          as: 'acceptedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: User,
          as: 'rejectedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: 500 // Increased limit for PDF export
    });

    const exportService = new ExportService();
    const buffer = await exportService.exportProformaInvoicesToPDF(invoices, req.query);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proforma_invoices_export_${new Date().toISOString().split('T')[0]}.pdf"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
