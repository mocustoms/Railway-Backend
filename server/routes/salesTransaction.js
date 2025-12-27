const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { SalesTransaction, SalesInvoice, SalesOrder, FinancialYear, User, Store, Customer, Currency, ExchangeRate, SalesAgent, ProductCategory, ProductBrandName, ProductManufacturer, ProductModel, ProductColor, Packaging, PriceCategory, ProductStoreLocation, sequelize } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');

router.use(auth); // Apply authentication to all routes
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Helper function to transform sales transaction data
const transformSalesTransaction = (transaction) => {
  return {
    id: transaction.id,
    transactionRefNumber: transaction.transaction_ref_number,
    transactionType: transaction.transaction_type,
    companyId: transaction.companyId,
    sourceInvoiceId: transaction.source_invoice_id,
    sourceOrderId: transaction.source_order_id,
    sourceTransactionId: transaction.source_transaction_id,
    parentTransactionId: transaction.parent_transaction_id,
    transactionDate: transaction.transaction_date,
    dueDate: transaction.due_date,
    validUntil: transaction.valid_until,
    deliveryDate: transaction.delivery_date,
    storeId: transaction.store_id,
    storeName: transaction.store?.name,
    customerId: transaction.customer_id,
    customerName: transaction.customer?.full_name,
    customerCode: transaction.customer?.customer_id,
    salesAgentId: transaction.sales_agent_id,
    salesAgentName: transaction.salesAgent?.full_name,
    financialYearId: transaction.financial_year_id,
    financialYearName: transaction.financialYear?.name,
    subtotal: parseFloat(transaction.subtotal || 0),
    discountAmount: parseFloat(transaction.discount_amount || 0),
    taxAmount: parseFloat(transaction.tax_amount || 0),
    totalWhtAmount: parseFloat(transaction.total_wht_amount || 0),
    amountAfterDiscount: parseFloat(transaction.amount_after_discount || 0),
    amountAfterWht: parseFloat(transaction.amount_after_wht || 0),
    totalAmount: parseFloat(transaction.total_amount || 0),
    paidAmount: parseFloat(transaction.paid_amount || 0),
    balanceAmount: parseFloat(transaction.balance_amount || 0),
    equivalentAmount: parseFloat(transaction.equivalent_amount || 0),
    currencyId: transaction.currency_id,
    currencyName: transaction.currency?.name,
    currencyCode: transaction.currency?.code,
    currencySymbol: transaction.currency?.symbol,
    exchangeRate: parseFloat(transaction.exchange_rate || 1),
    exchangeRateId: transaction.exchange_rate_id,
    systemDefaultCurrencyId: transaction.system_default_currency_id,
    status: transaction.status,
    isActive: transaction.is_active,
    isCancelled: transaction.is_cancelled,
    notes: transaction.notes,
    termsConditions: transaction.terms_conditions,
    shippingAddress: transaction.shipping_address,
    rejectionReason: transaction.rejection_reason,
    receiptInvoiceNumber: transaction.receipt_invoice_number,
    receiptNumber: transaction.receipt_number,
    // Product attributes
    productType: transaction.product_type,
    productCategoryId: transaction.product_category_id,
    productCategoryName: transaction.productCategory?.name,
    brandNameId: transaction.brand_name_id,
    brandName: transaction.brandName?.name,
    manufacturerId: transaction.manufacturer_id,
    manufacturerName: transaction.manufacturer?.name,
    modelId: transaction.model_id,
    modelName: transaction.model?.name,
    colorId: transaction.color_id,
    colorName: transaction.color?.name,
    packagingId: transaction.packaging_id,
    packagingName: transaction.packaging?.name,
    priceCategoryId: transaction.price_category_id,
    priceCategoryName: transaction.priceCategory?.name,
    priceCategoryCode: transaction.priceCategory?.code,
    storeLocationId: transaction.store_location_id,
    storeLocationName: transaction.storeLocation?.location_name,
    sourceInvoice: transaction.sourceInvoice ? {
      id: transaction.sourceInvoice.id,
      invoiceRefNumber: transaction.sourceInvoice.invoice_ref_number
    } : null,
    sourceOrder: transaction.sourceOrder ? {
      id: transaction.sourceOrder.id,
      salesOrderRefNumber: transaction.sourceOrder.sales_order_ref_number
    } : null,
    createdBy: transaction.created_by,
    createdByUser: transaction.createdByUser,
    updatedBy: transaction.updated_by,
    updatedByUser: transaction.updatedByUser,
    sentBy: transaction.sent_by,
    sentByUser: transaction.sentByUser,
    sentAt: transaction.sent_at,
    approvedBy: transaction.approved_by,
    approvedByUser: transaction.approvedByUser,
    approvedAt: transaction.approved_at,
    cancelledBy: transaction.cancelled_by,
    cancelledByUser: transaction.cancelledByUser,
    cancelledAt: transaction.cancelled_at,
    rejectedBy: transaction.rejected_by,
    rejectedByUser: transaction.rejectedByUser,
    rejectedAt: transaction.rejected_at,
    createdAt: transaction.created_at,
    updatedAt: transaction.updated_at
  };
};

// GET /api/sales-transactions - Get all sales transactions with pagination and search
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      transactionType,
      status,
      storeId,
      customerId,
      salesAgentId,
      financialYearId,
      currencyId,
      productType,
      productCategoryId,
      brandNameId,
      manufacturerId,
      modelId,
      colorId,
      packagingId,
      priceCategoryId,
      storeLocationId,
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
      'transactionRefNumber': 'transaction_ref_number',
      'transactionType': 'transaction_type',
      'transactionDate': 'transaction_date',
      'dueDate': 'due_date',
      'totalAmount': 'total_amount',
      'productType': 'product_type',
      'receiptInvoiceNumber': 'receipt_invoice_number',
      'receiptNumber': 'receipt_number',
      'status': 'status'
    };
    
    // Associated model fields that need special handling
    if (sortBy === 'customerName') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'full_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'customerCode') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'customer_id', sortOrder.toUpperCase()]];
    } else if (sortBy === 'storeName') {
      orderClause = [[{ model: Store, as: 'store' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'productCategoryName') {
      orderClause = [[{ model: ProductCategory, as: 'productCategory' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'brandName') {
      orderClause = [[{ model: ProductBrandName, as: 'brandName' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'manufacturerName') {
      orderClause = [[{ model: ProductManufacturer, as: 'manufacturer' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'modelName') {
      orderClause = [[{ model: ProductModel, as: 'model' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'colorName') {
      orderClause = [[{ model: ProductColor, as: 'color' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'packagingName') {
      orderClause = [[{ model: Packaging, as: 'packaging' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'priceCategoryName') {
      orderClause = [[{ model: PriceCategory, as: 'priceCategory' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'storeLocationName') {
      orderClause = [[{ model: ProductStoreLocation, as: 'storeLocation' }, 'location_name', sortOrder.toUpperCase()]];
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
        { transaction_ref_number: { [Op.iLike]: `%${search}%` } },
        { receipt_invoice_number: { [Op.iLike]: `%${search}%` } },
        { receipt_number: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$customer.customer_id$': { [Op.iLike]: `%${search}%` } },
        { '$store.name$': { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Filter by transaction type
    if (transactionType) {
      whereClause.transaction_type = transactionType;
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

    // Filter by sales agent
    if (salesAgentId) {
      whereClause.sales_agent_id = salesAgentId;
    }

    // Filter by financial year
    if (financialYearId) {
      whereClause.financial_year_id = financialYearId;
    }

    // Filter by currency
    if (currencyId) {
      whereClause.currency_id = currencyId;
    }

    // Filter by product attributes
    if (productType) {
      whereClause.product_type = productType;
    }
    if (productCategoryId) {
      whereClause.product_category_id = productCategoryId;
    }
    if (brandNameId) {
      whereClause.brand_name_id = brandNameId;
    }
    if (manufacturerId) {
      whereClause.manufacturer_id = manufacturerId;
    }
    if (modelId) {
      whereClause.model_id = modelId;
    }
    if (colorId) {
      whereClause.color_id = colorId;
    }
    if (packagingId) {
      whereClause.packaging_id = packagingId;
    }
    if (priceCategoryId) {
      whereClause.price_category_id = priceCategoryId;
    }
    if (storeLocationId) {
      whereClause.store_location_id = storeLocationId;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.transaction_date = {};
      if (dateFrom) whereClause.transaction_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.transaction_date[Op.lte] = dateTo;
    }

    const { count, rows } = await SalesTransaction.findAndCountAll({
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
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol'],
          required: false
        },
        {
          model: Currency,
          as: 'systemDefaultCurrency',
          attributes: ['id', 'name', 'code', 'symbol'],
          required: false
        },
        {
          model: ExchangeRate,
          as: 'exchangeRate',
          attributes: ['id', 'from_currency_id', 'to_currency_id', 'rate', 'effective_date'],
          required: false
        },
        {
          model: SalesInvoice,
          as: 'sourceInvoice',
          attributes: ['id', 'invoice_ref_number'],
          required: false
        },
        {
          model: SalesOrder,
          as: 'sourceOrder',
          attributes: ['id', 'sales_order_ref_number'],
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
          as: 'sentByUser',
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
          model: ProductCategory,
          as: 'productCategory',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: ProductBrandName,
          as: 'brandName',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductManufacturer,
          as: 'manufacturer',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductModel,
          as: 'model',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductColor,
          as: 'color',
          attributes: ['id', 'name', 'code', 'hex_code'],
          required: false
        },
        {
          model: Packaging,
          as: 'packaging',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: ProductStoreLocation,
          as: 'storeLocation',
          attributes: ['id', 'location_name'],
          required: false
        }
      ],
      order: orderClause,
      limit: parseInt(limit),
      offset: offset
    });

    const transformedTransactions = rows.map(transformSalesTransaction);

    res.json({
      salesTransactions: transformedTransactions,
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

// GET /api/sales-transactions/:id - Get a single sales transaction by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await SalesTransaction.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name', 'location']
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'address', 'phone_number', 'email']
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
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol'],
          required: false
        },
        {
          model: Currency,
          as: 'systemDefaultCurrency',
          attributes: ['id', 'name', 'code', 'symbol'],
          required: false
        },
        {
          model: ExchangeRate,
          as: 'exchangeRate',
          attributes: ['id', 'from_currency_id', 'to_currency_id', 'rate', 'effective_date'],
          required: false
        },
        {
          model: SalesInvoice,
          as: 'sourceInvoice',
          attributes: ['id', 'invoice_ref_number', 'invoice_date', 'total_amount'],
          required: false
        },
        {
          model: SalesOrder,
          as: 'sourceOrder',
          attributes: ['id', 'sales_order_ref_number', 'sales_order_date', 'total_amount'],
          required: false
        },
        {
          model: SalesTransaction,
          as: 'sourceTransaction',
          attributes: ['id', 'transaction_ref_number', 'transaction_type'],
          required: false
        },
        {
          model: SalesTransaction,
          as: 'parentTransaction',
          attributes: ['id', 'transaction_ref_number', 'transaction_type'],
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
          as: 'sentByUser',
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
          model: ProductCategory,
          as: 'productCategory',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: ProductBrandName,
          as: 'brandName',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductManufacturer,
          as: 'manufacturer',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductModel,
          as: 'model',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductColor,
          as: 'color',
          attributes: ['id', 'name', 'code', 'hex_code'],
          required: false
        },
        {
          model: Packaging,
          as: 'packaging',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: ProductStoreLocation,
          as: 'storeLocation',
          attributes: ['id', 'location_name'],
          required: false
        }
      ]
    });

    if (!transaction) {
      return res.status(404).json({ message: 'Sales transaction not found' });
    }

    res.json({
      salesTransaction: transformSalesTransaction(transaction)
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-transactions/stats/summary - Get summary statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const { dateFrom, dateTo, transactionType, storeId, financialYearId } = req.query;

    const whereClause = {};

    // Filter by transaction type
    if (transactionType) {
      whereClause.transaction_type = transactionType;
    }

    // Filter by store
    if (storeId) {
      whereClause.store_id = storeId;
    }

    // Filter by financial year
    if (financialYearId) {
      whereClause.financial_year_id = financialYearId;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.transaction_date = {};
      if (dateFrom) whereClause.transaction_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.transaction_date[Op.lte] = dateTo;
    }

    const companyWhere = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      companyWhere.companyId = req.user.companyId;
    }

    // Revenue should only include approved Sales Invoices
    // Exclude proforma invoices and sales orders
    companyWhere.transaction_type = 'invoice';
    companyWhere.status = 'approved';
    companyWhere.is_cancelled = false;
    companyWhere.is_active = true;

    // Get statistics
    // Note: Sequelize.sum() returns null when no rows match or all values are null
    // Use COALESCE in raw query to ensure we get 0 instead of null
    const [
      totalCount,
      totalAmount,
      totalEquivalentAmount,
      totalPaid,
      totalBalance,
      invoiceCount,
      orderCount,
      statusCounts
    ] = await Promise.all([
      SalesTransaction.count({ where: companyWhere }),
      SalesTransaction.sum('total_amount', { where: companyWhere }),
      SalesTransaction.sum('equivalent_amount', { where: companyWhere }),
      SalesTransaction.sum('paid_amount', { where: companyWhere }),
      SalesTransaction.sum('balance_amount', { where: companyWhere }),
      (async () => {
        const invoiceWhere = buildCompanyWhere(req, { ...whereClause, transaction_type: 'invoice' });
        if (!req.user.isSystemAdmin && req.user.companyId) {
          invoiceWhere.companyId = req.user.companyId;
        }
        // Exclude cancelled/rejected for invoice count
        invoiceWhere.status = { [Op.notIn]: ['cancelled', 'rejected'] };
        invoiceWhere.is_cancelled = false;
        invoiceWhere.is_active = true;
        return SalesTransaction.count({ where: invoiceWhere });
      })(),
      (async () => {
        const orderWhere = buildCompanyWhere(req, { ...whereClause, transaction_type: 'order' });
        if (!req.user.isSystemAdmin && req.user.companyId) {
          orderWhere.companyId = req.user.companyId;
        }
        // Exclude cancelled/rejected for order count
        orderWhere.status = { [Op.notIn]: ['cancelled', 'rejected'] };
        orderWhere.is_cancelled = false;
        orderWhere.is_active = true;
        return SalesTransaction.count({ where: orderWhere });
      })(),
      SalesTransaction.findAll({
        where: companyWhere,
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('total_amount')), 'total']
        ],
        group: ['status'],
        raw: true
      })
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalTransactions: totalCount || 0,
          totalAmount: totalAmount != null ? parseFloat(totalAmount) : 0,
          totalEquivalentAmount: totalEquivalentAmount != null ? parseFloat(totalEquivalentAmount) : 0,
          totalPaid: totalPaid != null ? parseFloat(totalPaid) : 0,
          totalBalance: totalBalance != null ? parseFloat(totalBalance) : 0,
          invoiceCount: invoiceCount || 0,
          orderCount: orderCount || 0,
          statusBreakdown: statusCounts.map(item => ({
            status: item.status,
            count: parseInt(item.count),
            total: parseFloat(item.total || 0)
          }))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// GET /api/sales-transactions/by-financial-year/:financialYearId - Get transactions by financial year
router.get('/by-financial-year/:financialYearId', async (req, res) => {
  try {
    const { financialYearId } = req.params;
    const { page = 1, limit = 10, transactionType, status } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClause = {
      financial_year_id: financialYearId
    };

    if (transactionType) {
      whereClause.transaction_type = transactionType;
    }

    if (status) {
      whereClause.status = status;
    }

    const { count, rows } = await SalesTransaction.findAndCountAll({
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
          attributes: ['id', 'customer_id', 'full_name']
        },
        {
          model: FinancialYear,
          as: 'financialYear',
          attributes: ['id', 'code', 'name']
        },
        {
          model: ProductCategory,
          as: 'productCategory',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: ProductBrandName,
          as: 'brandName',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductManufacturer,
          as: 'manufacturer',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductModel,
          as: 'model',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: ProductColor,
          as: 'color',
          attributes: ['id', 'name', 'code', 'hex_code'],
          required: false
        },
        {
          model: Packaging,
          as: 'packaging',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: ProductStoreLocation,
          as: 'storeLocation',
          attributes: ['id', 'location_name'],
          required: false
        }
      ],
      order: [['transaction_date', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    const transformedTransactions = rows.map(transformSalesTransaction);

    res.json({
      salesTransactions: transformedTransactions,
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

module.exports = router;

