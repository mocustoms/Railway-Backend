const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { SalesOrder, SalesOrderItem, FinancialYear, User, Store, Customer, Currency, ExchangeRate, Product, TaxCode, SalesInvoice, SalesInvoiceItem, LinkedAccount, sequelize } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { createTransactionFromOrder, updateTransactionFromOrder, createTransactionFromInvoice } = require('../utils/salesTransactionHelper');
const ExportService = require('../utils/exportService');

router.use(auth); // Apply authentication to all routes
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks // Apply company filtering to all routes

// Helper function to generate sales order reference number (sequential across dates)
// IMPORTANT: This is per-company sequential. The sequence continues across dates.
// Example: SO-20251106-0001 → SO-20251107-0002 → SO-20251107-0003 → SO-20251108-0004
// Different companies CAN have the same reference number (e.g., Company A and Company B can both have SO-20251107-0001)
// The unique constraint is composite: ['sales_order_ref_number', 'companyId'], allowing duplicates across companies.
// Uses Sequelize ORM with buildCompanyWhere to ensure proper multi-tenant filtering
const generateSalesOrderRefNumber = async (req) => {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  const companyId = req.user?.companyId;
  
  if (!companyId) {
    throw new Error('Company ID is required to generate sales order reference number');
  }
  
  // Get the LAST order for this company (regardless of date) to continue the sequence
  // Order by sales_order_ref_number DESC to get the highest sequence number
  const lastOrder = await SalesOrder.findOne({
    where: buildCompanyWhere(req, {
      sales_order_ref_number: {
        [Op.like]: 'SO-%' // Match any date
      }
    }),
    attributes: ['sales_order_ref_number'],
    order: [['sales_order_ref_number', 'DESC']]
  });
  
  // Extract the sequence number from the last order
  let nextSequence = 1;
  if (lastOrder && lastOrder.sales_order_ref_number) {
    const match = lastOrder.sales_order_ref_number.match(/SO-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }
  
  // Generate the reference number with today's date and the next sequence number
  const referenceNumber = `SO-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  
  // Double-check that this number doesn't exist (safety check, filtered by company)
  const existing = await SalesOrder.findOne({
    where: buildCompanyWhere(req, { sales_order_ref_number: referenceNumber }),
    attributes: ['id']
  });
  
  if (existing) {
    // If it exists (shouldn't happen, but safety check), increment and try again
    nextSequence++;
    return `SO-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  }
  
  return referenceNumber;
};

// Helper function to transform sales order data
const transformSalesOrder = (order) => {
  return {
    id: order.id,
    salesOrderRefNumber: order.sales_order_ref_number,
    salesOrderDate: order.sales_order_date,
    storeId: order.store_id,
    storeName: order.store?.name,
    customerId: order.customer_id,
    customerName: order.customer?.full_name,
    customerCode: order.customer?.customer_id,
    customerAddress: order.customer?.address,
    customerFax: order.customer?.fax,
    customerPhone: order.customer?.phone_number,
    customerEmail: order.customer?.email,
    currencyId: order.currency_id,
    currencyName: order.currency?.name,
    currencySymbol: order.currency?.symbol,
    exchangeRate: order.exchange_rate,
    exchangeRateValue: order.exchange_rate ? parseFloat(order.exchange_rate) : null,
    systemDefaultCurrencyId: order.system_default_currency_id,
    exchangeRateId: order.exchange_rate_id,
    priceCategoryId: order.price_category_id,
    priceCategory: order.priceCategory,
    subtotal: parseFloat(order.subtotal),
    taxAmount: parseFloat(order.tax_amount),
    discountAmount: parseFloat(order.discount_amount),
    totalAmount: parseFloat(order.total_amount),
    amountAfterDiscount: order.amount_after_discount ? parseFloat(order.amount_after_discount) : null,
    totalWhtAmount: order.total_wht_amount ? parseFloat(order.total_wht_amount) : null,
    amountAfterWht: order.amount_after_wht ? parseFloat(order.amount_after_wht) : null,
    equivalentAmount: order.equivalent_amount ? parseFloat(order.equivalent_amount) : null,
    status: order.status,
    isConverted: order.is_converted || false,
    validUntil: order.valid_until,
    deliveryDate: order.delivery_date,
    shippingAddress: order.shipping_address,
    notes: order.notes,
    termsConditions: order.terms_conditions,
    createdBy: order.created_by,
    createdByName: order.createdByUser ? `${order.createdByUser.first_name} ${order.createdByUser.last_name}` : 'System',
    updatedBy: order.updated_by,
    updatedByName: order.updatedByUser ? `${order.updatedByUser.first_name} ${order.updatedByUser.last_name}` : null,
    sentBy: order.sent_by,
    sentByName: order.sentByUser ? `${order.sentByUser.first_name} ${order.sentByUser.last_name}` : null,
    sentAt: order.sent_at,
    acceptedBy: order.accepted_by,
    acceptedByName: order.acceptedByUser ? `${order.acceptedByUser.first_name} ${order.acceptedByUser.last_name}` : null,
    acceptedAt: order.accepted_at,
    rejectedBy: order.rejected_by,
    rejectedByName: order.rejectedByUser ? `${order.rejectedByUser.first_name} ${order.rejectedByUser.last_name}` : null,
    rejectedAt: order.rejected_at,
    rejectionReason: order.rejection_reason,
    fulfilledBy: order.fulfilled_by,
    fulfilledByName: order.fulfilledByUser ? `${order.fulfilledByUser.first_name} ${order.fulfilledByUser.last_name}` : null,
    fulfilledAt: order.fulfilled_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: order.items?.map(item => ({
      id: item.id,
      salesOrderId: item.sales_order_id,
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
    store: order.store,
    customer: order.customer,
    currency: order.currency,
    systemDefaultCurrency: order.systemDefaultCurrency,
    exchangeRate: order.exchangeRate,
    createdByUser: order.createdByUser,
    updatedByUser: order.updatedByUser,
    sentByUser: order.sentByUser,
    acceptedByUser: order.acceptedByUser,
    rejectedByUser: order.rejectedByUser,
    fulfilledByUser: order.fulfilledByUser
  };
};

// GET /api/sales-orders - Get all sales orders with pagination and search
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
      converted, // New filter: 'true' to show only converted orders, 'false' for non-converted
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
      'salesOrderRefNumber': 'sales_order_ref_number',
      'salesOrderDate': 'sales_order_date',
      'totalAmount': 'total_amount',
      'status': 'status',
      'sentAt': 'sent_at',
      'acceptedAt': 'accepted_at',
      'rejectedAt': 'rejected_at',
      'validUntil': 'valid_until'
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
    } else if (sortBy === 'acceptedByName') {
      orderClause = [[{ model: User, as: 'acceptedByUser' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'rejectedByName') {
      orderClause = [[{ model: User, as: 'rejectedByUser' }, 'first_name', sortOrder.toUpperCase()]];
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
        { sales_order_ref_number: { [Op.iLike]: `%${search}%` } },
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
      whereClause.sales_order_date = {};
      if (dateFrom) whereClause.sales_order_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.sales_order_date[Op.lte] = dateTo;
    }

    // Filter by conversion status
    if (converted === 'true') {
      // Only show sales orders that have been converted
      whereClause.is_converted = true;
    } else if (converted === 'false') {
      // Only show sales orders that have NOT been converted
      whereClause.is_converted = false;
    }

    const { count, rows } = await SalesOrder.findAndCountAll({
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
          model: User,
          as: 'fulfilledByUser',
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
      if (invoice.valid_until && invoice.status !== 'expired' && invoice.status !== 'accepted' && invoice.status !== 'rejected' && invoice.status !== 'delivered') {
        const validUntilDate = new Date(invoice.valid_until);
        validUntilDate.setHours(0, 0, 0, 0);
        
        if (validUntilDate < today) {
          // Invoice has expired, update status
          await invoice.update({ status: 'expired' });
          invoice.status = 'expired';
        }
      }
    }

    const transformedInvoices = rows.map(transformSalesOrder);

    res.json({
      salesOrders: transformedInvoices,
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

// GET /api/sales-orders/all - Get all active sales orders for dropdowns
router.get('/all', async (req, res) => {
  try {
    const invoices = await SalesOrder.findAll({
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
      order: [['sales_order_ref_number', 'DESC']],
      limit: 100
    });

    const transformedInvoices = invoices.map(transformSalesOrder);
    res.json(transformedInvoices);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/sales-orders/stats/overview - Get sales order statistics
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
      fulfilledCount,
      totalValue,
      thisMonthCount,
      lastMonthCount
    ] = await Promise.all([
      SalesOrder.count({ where: buildCompanyWhere(req) }),
      SalesOrder.count({ where: buildCompanyWhere(req, { status: 'draft' }) }),
      SalesOrder.count({ where: buildCompanyWhere(req, { status: 'sent' }) }),
      SalesOrder.count({ where: buildCompanyWhere(req, { status: 'accepted' }) }),
      SalesOrder.count({ where: buildCompanyWhere(req, { status: 'rejected' }) }),
      SalesOrder.count({ where: buildCompanyWhere(req, { status: 'expired' }) }),
      SalesOrder.count({ where: buildCompanyWhere(req, { status: 'delivered' }) }),
      SalesOrder.sum('equivalent_amount', { where: buildCompanyWhere(req) }),
      SalesOrder.count({
        where: buildCompanyWhere(req, {
          created_at: { [Op.gte]: startOfMonth }
        })
      }),
      SalesOrder.count({
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
      fulfilled: fulfilledCount || 0,
      totalValue: totalValue || 0,
      thisMonth: thisMonthCount || 0,
      lastMonth: lastMonthCount || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/sales-orders/:id - Get sales order by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesOrder.findOne({
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
          model: User,
          as: 'fulfilledByUser',
          attributes: ['id', 'first_name', 'last_name', 'username']
        },
        {
          model: SalesOrderItem,
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
      return res.status(404).json({ message: 'Sales order not found' });
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

    const transformedInvoice = transformSalesOrder(invoice);
    res.json(transformedInvoice);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/sales-orders - Create new sales order
router.post('/', csrfProtection, async (req, res) => {
  try {
    const {
      sales_order_date: salesOrderDate,
      salesOrderDate: salesOrderDateAlt,
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
      delivery_date: deliveryDate,
      deliveryDate: deliveryDateAlt,
      shipping_address: shippingAddress,
      shippingAddress: shippingAddressAlt,
      notes,
      terms_conditions: termsConditions,
      termsConditions: termsConditionsAlt,
      items
    } = req.body;
    
    // Use camelCase values if provided, otherwise fall back to snake_case
    const finalSalesOrderDate = salesOrderDate || salesOrderDateAlt;
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

    // Validate required fields
    if (!finalSalesOrderDate) {
      return res.status(400).json({ message: 'Sales order date is required' });
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

    // Validate companyId exists (required for multi-tenant functionality)
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ 
        message: 'Company access required. Please ensure you are assigned to a company.' 
      });
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
    // Use the same pattern as sales invoice (check isActive only)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true })
    });

    if (!currentFinancialYear) {
      return res.status(400).json({ message: 'No active financial year found. Please set up an active financial year before creating sales orders.' });
    }

    // Validate sales order date is within financial year range
    // Use date-only comparison to avoid timezone issues
    const salesOrderDateStr = finalSalesOrderDate.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (salesOrderDateStr < startDateStr || salesOrderDateStr > endDateStr) {
      return res.status(400).json({ 
        message: `Sales order date must be within the current financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Retry logic for handling race conditions in reference number generation
    // IMPORTANT: Generate reference number OUTSIDE transaction (same as customer deposits)
    // This prevents transaction isolation issues when checking for existing numbers
    let invoice;
    let salesOrderRefNumber;
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      // Generate proforma reference number OUTSIDE the transaction (same as customer deposits)
      // This ensures we see all committed invoices when checking for existing numbers
      // Add a small delay on retries to ensure we get fresh data
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      }
      
      salesOrderRefNumber = await generateSalesOrderRefNumber(req);
      
      // Create transaction AFTER generating reference number
      const transaction = await sequelize.transaction();
      
      try {
    // Create sales order
        invoice = await SalesOrder.create({
      sales_order_ref_number: salesOrderRefNumber,
      sales_order_date: finalSalesOrderDate,
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
      financial_year_id: currentFinancialYear.id,
      status: 'draft',
      valid_until: finalValidUntil,
      delivery_date: finalDeliveryDate,
      shipping_address: finalShippingAddress,
      notes: finalNotes,
      terms_conditions: finalTermsConditions,
      created_by: req.user.id,
      updated_by: req.user.id
        }, { transaction });

    // Create sales order items
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
        const serialNumbers = Array.isArray(item.serial_numbers || item.serialNumbers) 
          ? (item.serial_numbers || item.serialNumbers).filter(sn => sn && typeof sn === 'string' && sn.trim() !== '')
          : [];
        
        // Normalize batch number: trim whitespace, convert empty string to null
        const batchNumber = (item.batch_number || item.batchNumber) 
          ? String(item.batch_number || item.batchNumber).trim() || null
          : null;
        
        // Normalize expiry date: ensure proper date format, convert empty string to null
        const expiryDate = (item.expiry_date || item.expiryDate) 
          ? (String(item.expiry_date || item.expiryDate).trim() || null)
          : null;

        // Ensure companyId is set (critical for multi-tenant)
        if (!req.user || !req.user.companyId) {
          throw new Error(`Company ID is required for item ${item.productId || item.product_id}. User: ${req.user?.id}, CompanyId: ${req.user?.companyId}`);
        }

        try {
          const createdItem = await SalesOrderItem.create({
            sales_order_id: invoice.id,
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
          await createTransactionFromOrder(invoice, req, { transaction });
        } catch (transactionError) {
          // Don't fail the order creation if transaction creation fails
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
            createError.errors?.some(e => e.path === 'sales_order_ref_number')) {
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
    const createdInvoice = await SalesOrder.findOne({
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
          model: SalesOrderItem,
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

    const transformedInvoice = transformSalesOrder(createdInvoice);
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

// PUT /api/sales-orders/:id - Update sales order
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      sales_order_date: salesOrderDate,
      salesOrderDate: salesOrderDateAlt,
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
      delivery_date: deliveryDate,
      deliveryDate: deliveryDateAlt,
      shipping_address: shippingAddress,
      shippingAddress: shippingAddressAlt,
      notes,
      terms_conditions: termsConditions,
      termsConditions: termsConditionsAlt,
      items
    } = req.body;
    
    // Use camelCase values if provided, otherwise fall back to snake_case
    const finalSalesOrderDate = salesOrderDate || salesOrderDateAlt;
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

    const invoice = await SalesOrder.findOne({
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

    // Get current financial year - use the same pattern as sales invoice (check isActive only)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true })
    });

    if (!currentFinancialYear) {
      return res.status(400).json({ message: 'No active financial year found. Please set up an active financial year before updating sales orders.' });
    }

    // Validate sales order date is within financial year range
    // Use date-only comparison to avoid timezone issues
    const salesOrderDateStr = finalSalesOrderDate.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (salesOrderDateStr < startDateStr || salesOrderDateStr > endDateStr) {
      return res.status(400).json({ 
        message: `Sales order date must be within the current financial year range (${startDateStr} to ${endDateStr}).` 
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

    // Update sales order
    await invoice.update({
      sales_order_date: finalSalesOrderDate,
      store_id: finalStoreId,
      customer_id: finalCustomerId,
      currency_id: finalCurrencyId,
      exchange_rate: finalExchangeRate,
      system_default_currency_id: finalSystemDefaultCurrencyId,
      exchange_rate_id: finalExchangeRateId,
      price_category_id: req.body.price_category_id || req.body.priceCategoryId || null,
      financial_year_id: currentFinancialYear.id,
      subtotal: subtotal,
      tax_amount: totalTaxAmount,
      discount_amount: totalDiscountAmount,
      total_amount: totalAmount,
      amount_after_discount: amountAfterDiscount, // Calculated: subtotal - discount_amount
      total_wht_amount: totalWHTAmount, // Calculated: sum of all item wht_amount
      amount_after_wht: amountAfterWHT, // Calculated: amount_after_discount - total_wht_amount
      equivalent_amount: finalExchangeRate ? totalAmount * finalExchangeRate : totalAmount,
      valid_until: finalValidUntil,
      delivery_date: finalDeliveryDate,
      shipping_address: finalShippingAddress,
      notes: finalNotes,
      terms_conditions: finalTermsConditions,
      updated_by: req.user.id
    });

    // Delete existing items (filtered by company)
    await SalesOrderItem.destroy({
      where: buildCompanyWhere(req, { sales_order_id: id })
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
        const serialNumbers = Array.isArray(item.serial_numbers || item.serialNumbers) 
          ? (item.serial_numbers || item.serialNumbers).filter(sn => sn && typeof sn === 'string' && sn.trim() !== '')
          : [];
        
        // Normalize batch number: trim whitespace, convert empty string to null
        const batchNumber = (item.batch_number || item.batchNumber) 
          ? String(item.batch_number || item.batchNumber).trim() || null
          : null;
        
        // Normalize expiry date: ensure proper date format, convert empty string to null
        const expiryDate = (item.expiry_date || item.expiryDate) 
          ? (String(item.expiry_date || item.expiryDate).trim() || null)
          : null;

        // Ensure companyId is set (critical for multi-tenant)
        if (!req.user || !req.user.companyId) {
          throw new Error(`Company ID is required for item ${item.productId || item.product_id}. User: ${req.user?.id}, CompanyId: ${req.user?.companyId}`);
        }


        try {
          const createdItem = await SalesOrderItem.create({
            sales_order_id: id,
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
    const orderForTransaction = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    
    if (orderForTransaction) {
      try {
        await updateTransactionFromOrder(orderForTransaction, req);
      } catch (transactionError) {
        // Don't fail the order update if transaction update fails
      }
    }

    // Fetch the updated invoice with all relations
    const updatedInvoice = await SalesOrder.findOne({
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
          model: SalesOrderItem,
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

    const transformedInvoice = transformSalesOrder(updatedInvoice);
    res.json(transformedInvoice);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/sales-orders/:id - Delete sales order (hard delete)
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales order not found' });
    }

    // Only allow deletion of draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft invoices can be deleted' });
    }

    // Delete items first (CASCADE should handle this, but being explicit and filtered by company)
    await SalesOrderItem.destroy({
      where: buildCompanyWhere(req, { sales_order_id: id })
    });

    // Delete the invoice
    await invoice.destroy();

    res.json({ message: 'Proforma invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/sales-orders/:id/send - Send sales order
router.put('/:id/send', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales order not found' });
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

// PUT /api/sales-orders/:id/accept - Accept sales order
router.put('/:id/accept', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales order not found' });
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

// PUT /api/sales-orders/:id/reject - Reject sales order
router.put('/:id/reject', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    // Validate rejection reason is provided
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const invoice = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales order not found' });
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

    res.json({ message: 'Sales order rejected successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/sales-orders/:id/fulfill - Fulfill sales order
router.put('/:id/fulfill', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryDate } = req.body;

    const order = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!order) {
      return res.status(404).json({ message: 'Sales order not found' });
    }

    if (order.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted orders can be fulfilled' });
    }

    await order.update({
      status: 'delivered',
      fulfilled_by: req.user.id,
      fulfilled_at: new Date(),
      delivery_date: deliveryDate || new Date().toISOString().split('T')[0]
    });

    res.json({ message: 'Sales order delivered successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/sales-orders/:id/reopen - Reopen expired sales order
router.put('/:id/reopen', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { validUntil } = req.body;

    // Validate validUntil is provided
    if (!validUntil || !validUntil.trim()) {
      return res.status(400).json({ message: 'Valid until date is required to reopen the order' });
    }

    const invoice = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!invoice) {
      return res.status(404).json({ message: 'Sales order not found' });
    }

    if (invoice.status !== 'expired') {
      return res.status(400).json({ message: 'Only expired orders can be reopened' });
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

    const updatedInvoice = await SalesOrder.findByPk(invoice.id, {
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

    const transformedInvoice = transformSalesOrder(updatedInvoice);
    res.json({ message: 'Sales order reopened successfully', order: transformedInvoice });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
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

// PUT /api/sales-orders/:id/convert-to-sales-invoice - Convert sales order to sales invoice
router.put('/:id/convert-to-sales-invoice', csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { invoice_date: invoiceDate, due_date: dueDate } = req.body;
    
    // Find the sales order with all items
    const salesOrder = await SalesOrder.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: SalesOrderItem,
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

    if (!salesOrder) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Sales order not found' });
    }

    // Validate that sales order is in a convertible state
    if (salesOrder.status !== 'sent' && salesOrder.status !== 'accepted' && salesOrder.status !== 'delivered') {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `Only sent, accepted, or delivered sales orders can be converted to sales invoices. Current status: ${salesOrder.status}` 
      });
    }

    // Check if this sales order has already been converted
    const existingSalesInvoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(req, { sales_order_id: id }),
      attributes: ['id', 'invoice_ref_number'],
      transaction
    });

    if (existingSalesInvoice) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: `This sales order has already been converted to sales invoice: ${existingSalesInvoice.invoice_ref_number}` 
      });
    }

    // Validate that sales order has items
    if (!salesOrder.items || salesOrder.items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Sales order must have at least one item to convert' });
    }

    // Get current financial year - use the same pattern as sales invoice (check isActive only)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true }),
      transaction
    });

    if (!currentFinancialYear) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No active financial year found. Please set up an active financial year before converting sales orders.' });
    }

    // Use provided invoice date or default to today
    const finalInvoiceDate = invoiceDate || new Date().toISOString().split('T')[0];
    const finalDueDate = dueDate || salesOrder.valid_until || null;

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

    // Create sales invoice from sales order data
    const salesInvoice = await SalesInvoice.create({
      invoice_ref_number: invoiceRefNumber,
      invoice_date: finalInvoiceDate,
      due_date: finalDueDate,
      store_id: salesOrder.store_id,
      customer_id: salesOrder.customer_id,
      sales_order_id: salesOrder.id, // Link to sales order
      currency_id: salesOrder.currency_id,
      exchange_rate: salesOrder.exchange_rate,
      system_default_currency_id: salesOrder.system_default_currency_id,
      exchange_rate_id: salesOrder.exchange_rate_id,
      price_category_id: salesOrder.price_category_id,
      subtotal: salesOrder.subtotal,
      tax_amount: salesOrder.tax_amount,
      discount_amount: salesOrder.discount_amount,
      total_amount: salesOrder.total_amount,
      amount_after_discount: salesOrder.amount_after_discount,
      total_wht_amount: salesOrder.total_wht_amount,
      amount_after_wht: salesOrder.amount_after_wht,
      paid_amount: 0.00,
      balance_amount: salesOrder.total_amount,
      equivalent_amount: salesOrder.equivalent_amount,
      financial_year_id: currentFinancialYear.id,
      status: 'draft', // Start as draft - user can send/approve later
      notes: salesOrder.notes,
      terms_conditions: salesOrder.terms_conditions,
      shipping_address: salesOrder.shipping_address,
      delivery_date: salesOrder.delivery_date,
      account_receivable_id: defaultAccountReceivableId,
      discount_allowed_account_id: defaultDiscountAllowedAccountId,
      companyId: req.user.companyId,
      created_by: req.user.id,
      updated_by: req.user.id
    }, { transaction });

    // Create sales invoice items from sales order items
    const salesInvoiceItems = await Promise.all(
      salesOrder.items.map(async (orderItem) => {
        return await SalesInvoiceItem.create({
          sales_invoice_id: salesInvoice.id,
          product_id: orderItem.product_id,
          quantity: orderItem.quantity,
          unit_price: orderItem.unit_price,
          discount_percentage: orderItem.discount_percentage,
          discount_amount: orderItem.discount_amount,
          tax_percentage: orderItem.tax_percentage,
          tax_amount: orderItem.tax_amount,
          price_tax_inclusive: orderItem.price_tax_inclusive || false,
          sales_tax_id: orderItem.sales_tax_id,
          wht_tax_id: orderItem.wht_tax_id,
          wht_amount: orderItem.wht_amount,
          currency_id: orderItem.currency_id,
          exchange_rate: orderItem.exchange_rate,
          equivalent_amount: orderItem.equivalent_amount,
          amount_after_discount: orderItem.amount_after_discount,
          amount_after_wht: orderItem.amount_after_wht,
          line_total: orderItem.line_total,
          notes: orderItem.notes,
          serial_numbers: orderItem.serial_numbers || [],
          batch_number: orderItem.batch_number,
          expiry_date: orderItem.expiry_date,
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

    // Update sales order to mark it as converted
    await salesOrder.update({
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
          model: SalesOrder,
          as: 'salesOrder',
          attributes: ['id', 'sales_order_ref_number', 'sales_order_date', 'status']
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
      message: 'Sales order converted to sales invoice successfully',
      salesInvoice: {
        id: createdSalesInvoice.id,
        invoiceRefNumber: createdSalesInvoice.invoice_ref_number,
        invoiceDate: createdSalesInvoice.invoice_date,
        dueDate: createdSalesInvoice.due_date,
        status: createdSalesInvoice.status,
        totalAmount: parseFloat(createdSalesInvoice.total_amount),
        salesOrderId: createdSalesInvoice.sales_order_id,
        salesOrderRefNumber: createdSalesInvoice.salesOrder?.sales_order_ref_number
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

// GET /api/sales-orders/export/excel - Export sales orders to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search, status, storeId, customerId, currencyId, dateFrom, dateTo, converted } = req.query;

    const whereClause = {};
    
    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { sales_order_ref_number: { [Op.iLike]: `%${search}%` } },
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
      whereClause.sales_order_date = {};
      if (startDate) whereClause.sales_order_date[Op.gte] = startDate;
      if (endDate) whereClause.sales_order_date[Op.lte] = endDate;
    }

    const invoices = await SalesOrder.findAll({
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

    // TODO: Add exportSalesOrdersToExcel method to ExportService
    // For now, return error or use proforma invoice export as fallback
    return res.status(501).json({ message: 'Excel export for sales orders not yet implemented' });
    // const exportService = new ExportService();
    // const buffer = await exportService.exportSalesOrdersToExcel(invoices, req.query);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sales_orders_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-orders/export/pdf - Export sales orders to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search, status, storeId, customerId, currencyId, dateFrom, dateTo, converted } = req.query;

    const whereClause = {};
    
    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { sales_order_ref_number: { [Op.iLike]: `%${search}%` } },
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
      whereClause.sales_order_date = {};
      if (startDate) whereClause.sales_order_date[Op.gte] = startDate;
      if (endDate) whereClause.sales_order_date[Op.lte] = endDate;
    }

    const invoices = await SalesOrder.findAll({
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

    // TODO: Add exportSalesOrdersToPDF method to ExportService
    // For now, return error or use proforma invoice export as fallback
    return res.status(501).json({ message: 'PDF export for sales orders not yet implemented' });
    // const exportService = new ExportService();
    // const buffer = await exportService.exportSalesOrdersToPDF(invoices, req.query);
    // res.setHeader('Content-Type', 'application/pdf');
    // res.setHeader('Content-Disposition', `attachment; filename="sales_orders_export_${new Date().toISOString().split('T')[0]}.pdf"`);
    // res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
