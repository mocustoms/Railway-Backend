const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { 
  SalesTransaction,
  Store,
  Customer,
  SalesAgent,
  FinancialYear,
  Currency,
  ExchangeRate,
  ProductCategory,
  ProductBrandName,
  ProductManufacturer,
  ProductModel,
  ProductColor,
  Packaging,
  PriceCategory,
  ProductStoreLocation,
  SalesInvoice,
  SalesOrder,
  User,
  Product
} = require('../models');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId);

// GET /api/revenue-report - Get Revenue Report Data
router.get('/', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      storeId,
      customerId,
      salesAgentId,
      transactionType,
      status,
      productCategoryId,
      brandNameId,
      manufacturerId,
      modelId,
      colorId,
      priceCategoryId,
      financialYearId,
      currencyId,
      search,
      sortBy = 'transaction_date',
      sortOrder = 'DESC'
    } = req.query;

    const whereClause = {};

    // Only fetch approved invoices
    whereClause.transaction_type = 'invoice';
    whereClause.status = 'approved';

    // Payment status filter (based on paidAmount and balanceAmount)
    if (status && status !== 'all') {
      if (status === 'paid') {
        // Paid: balanceAmount is 0 or very close to 0
        whereClause.balance_amount = {
          [Op.lte]: 0.01
        };
      } else if (status === 'partial_paid') {
        // Partially paid: paidAmount > 0 and balanceAmount > 0
        whereClause.paid_amount = {
          [Op.gt]: 0
        };
        whereClause.balance_amount = {
          [Op.gt]: 0.01
        };
      } else if (status === 'unpaid') {
        // Unpaid: paidAmount is 0 or very close to 0, and balanceAmount > 0
        whereClause.paid_amount = {
          [Op.lte]: 0.01
        };
        whereClause.balance_amount = {
          [Op.gt]: 0.01
        };
      }
    }

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.transaction_date = {};
      if (dateFrom) whereClause.transaction_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.transaction_date[Op.lte] = dateTo;
    }

    // Store filter
    if (storeId && storeId !== 'all') {
      whereClause.store_id = storeId;
    }

    // Customer filter
    if (customerId && customerId !== 'all') {
      whereClause.customer_id = customerId;
    }

    // Sales Agent filter
    if (salesAgentId && salesAgentId !== 'all') {
      whereClause.sales_agent_id = salesAgentId;
    }

    // Product Category filter
    if (productCategoryId && productCategoryId !== 'all') {
      whereClause.product_category_id = productCategoryId;
    }

    // Brand Name filter
    if (brandNameId && brandNameId !== 'all') {
      whereClause.brand_name_id = brandNameId;
    }

    // Manufacturer filter
    if (manufacturerId && manufacturerId !== 'all') {
      whereClause.manufacturer_id = manufacturerId;
    }

    // Model filter
    if (modelId && modelId !== 'all') {
      whereClause.model_id = modelId;
    }

    // Color filter
    if (colorId && colorId !== 'all') {
      whereClause.color_id = colorId;
    }

    // Price Category filter
    if (priceCategoryId && priceCategoryId !== 'all') {
      whereClause.price_category_id = priceCategoryId;
    }

    // Financial Year filter
    if (financialYearId && financialYearId !== 'all') {
      whereClause.financial_year_id = financialYearId;
    }

    // Currency filter
    if (currencyId && currencyId !== 'all') {
      whereClause.currency_id = currencyId;
    }

    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { transaction_ref_number: { [Op.iLike]: `%${search}%` } },
        { receipt_number: { [Op.iLike]: `%${search}%` } },
        { receipt_invoice_number: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Build final where clause with company filter
    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    // Build order clause - handle both direct fields and associated model fields
    let orderClause = [];
    
    // Direct fields that can be sorted directly
    const directFields = {
      'transactionRefNumber': 'transaction_ref_number',
      'transactionDate': 'transaction_date',
      'dueDate': 'due_date',
      'transactionType': 'transaction_type',
      'status': 'status',
      'totalAmount': 'total_amount',
      'paidAmount': 'paid_amount',
      'balanceAmount': 'balance_amount',
      'subtotal': 'subtotal',
      'discountAmount': 'discount_amount',
      'taxAmount': 'tax_amount',
      'createdAt': 'created_at',
      'updatedAt': 'updated_at'
    };
    
    // Associated model fields that need special handling
    if (sortBy === 'storeName') {
      orderClause = [[{ model: Store, as: 'store' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'customerName') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'full_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'salesAgentName') {
      orderClause = [[{ model: SalesAgent, as: 'salesAgent' }, 'full_name', sortOrder.toUpperCase()]];
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
    } else if (sortBy === 'priceCategoryName') {
      orderClause = [[{ model: PriceCategory, as: 'priceCategory' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'currencyName') {
      orderClause = [[{ model: Currency, as: 'currency' }, 'name', sortOrder.toUpperCase()]];
    } else if (directFields[sortBy]) {
      // Direct field - use the mapped database column name
      orderClause = [[directFields[sortBy], sortOrder.toUpperCase()]];
    } else {
      // Default to transaction_date if field not recognized
      orderClause = [['transaction_date', 'DESC']];
    }

    // Fetch sales transactions with all required associations
    const transactions = await SalesTransaction.findAll({
      where: finalWhereClause,
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'customer_id', 'full_name', 'phone_number', 'email'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: SalesAgent,
          as: 'salesAgent',
          attributes: ['id', 'agent_number', 'full_name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: FinancialYear,
          as: 'financialYear',
          attributes: ['id', 'name', 'startDate', 'endDate'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'code', 'symbol'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: Currency,
          as: 'systemDefaultCurrency',
          attributes: ['id', 'name', 'code', 'symbol'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ExchangeRate,
          as: 'exchangeRate',
          attributes: ['id', 'from_currency_id', 'to_currency_id', 'rate', 'effective_date'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ProductCategory,
          as: 'productCategory',
          attributes: ['id', 'name', 'code'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ProductBrandName,
          as: 'brandName',
          attributes: ['id', 'name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ProductManufacturer,
          as: 'manufacturer',
          attributes: ['id', 'name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ProductModel,
          as: 'model',
          attributes: ['id', 'name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ProductColor,
          as: 'color',
          attributes: ['id', 'name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: Packaging,
          as: 'packaging',
          attributes: ['id', 'name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: PriceCategory,
          as: 'priceCategory',
          attributes: ['id', 'name', 'code'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: ProductStoreLocation,
          as: 'storeLocation',
          attributes: ['id', 'location_name'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: SalesInvoice,
          as: 'sourceInvoice',
          attributes: ['id', 'invoice_ref_number'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: SalesOrder,
          as: 'sourceOrder',
          attributes: ['id', 'sales_order_ref_number'],
          required: false,
          where: buildCompanyWhere(req, {})
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['id', 'username', 'first_name', 'last_name'],
          required: false
          // User model may not have companyId - users can belong to a company but the model structure may differ
          // Note: User filtering is typically handled at the application level, not via companyId
        }
      ],
      order: orderClause,
      limit: 10000
    });

    // Transform data to match frontend expectations
    const transformedTransactions = transactions.map(transaction => ({
      id: transaction.id,
      transactionRefNumber: transaction.transaction_ref_number,
      transactionType: transaction.transaction_type,
      transactionDate: transaction.transaction_date,
      dueDate: transaction.due_date || '--',
      validUntil: transaction.valid_until || '--',
      deliveryDate: transaction.delivery_date || '--',
      storeId: transaction.store_id,
      storeName: transaction.store?.name || '--',
      customerId: transaction.customer_id,
      customerName: transaction.customer?.full_name || '--',
      customerCode: transaction.customer?.customer_id || '--',
      salesAgentId: transaction.sales_agent_id,
      salesAgentName: transaction.salesAgent?.full_name || '--',
      salesAgentNumber: transaction.salesAgent?.agent_number || '--',
      financialYearId: transaction.financial_year_id,
      financialYearName: transaction.financialYear?.name || '--',
      financialYearCode: '--', // FinancialYear model doesn't have a code field
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
      currencyName: transaction.currency?.name || '--',
      currencyCode: transaction.currency?.code || '--',
      currencySymbol: transaction.currency?.symbol || '--',
      exchangeRate: parseFloat(transaction.exchange_rate || 1),
      systemDefaultCurrencyName: transaction.systemDefaultCurrency?.name || '--',
      status: transaction.status,
      isActive: transaction.is_active,
      isCancelled: transaction.is_cancelled,
      productType: transaction.product_type || '--',
      productCategoryName: transaction.productCategory?.name || '--',
      productCategoryCode: transaction.productCategory?.code || '--',
      brandName: transaction.brandName?.name || '--',
      manufacturerName: transaction.manufacturer?.name || '--',
      modelName: transaction.model?.name || '--',
      colorName: transaction.color?.name || '--',
      packagingName: transaction.packaging?.name || '--',
      priceCategoryName: transaction.priceCategory?.name || '--',
      priceCategoryCode: transaction.priceCategory?.code || '--',
      storeLocationName: transaction.storeLocation?.location_name || '--',
      sourceInvoiceNumber: transaction.sourceInvoice?.invoice_ref_number || '--',
      sourceOrderNumber: transaction.sourceOrder?.sales_order_ref_number || '--',
      receiptNumber: transaction.receipt_number || '--',
      receiptInvoiceNumber: transaction.receipt_invoice_number || '--',
      notes: transaction.notes || '--',
      createdBy: transaction.createdByUser ? `${transaction.createdByUser.first_name} ${transaction.createdByUser.last_name}` : '--',
      createdAt: transaction.created_at,
      updatedAt: transaction.updated_at
    }));

    res.json({
      success: true,
      data: transformedTransactions,
      total: transformedTransactions.length
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch revenue report',
      details: error.message 
    });
  }
});

// GET /api/revenue-report/stats - Get Revenue Report Statistics
router.get('/stats', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      storeId,
      customerId,
      salesAgentId,
      transactionType,
      status,
      productCategoryId,
      financialYearId,
      currencyId
    } = req.query;

    const whereClause = {};

    // Only fetch approved invoices
    whereClause.transaction_type = 'invoice';
    whereClause.status = 'approved';

    // Payment status filter (based on paidAmount and balanceAmount)
    if (status && status !== 'all') {
      if (status === 'paid') {
        // Paid: balanceAmount is 0 or very close to 0
        whereClause.balance_amount = {
          [Op.lte]: 0.01
        };
      } else if (status === 'partial_paid') {
        // Partially paid: paidAmount > 0 and balanceAmount > 0
        whereClause.paid_amount = {
          [Op.gt]: 0
        };
        whereClause.balance_amount = {
          [Op.gt]: 0.01
        };
      } else if (status === 'unpaid') {
        // Unpaid: paidAmount is 0 or very close to 0, and balanceAmount > 0
        whereClause.paid_amount = {
          [Op.lte]: 0.01
        };
        whereClause.balance_amount = {
          [Op.gt]: 0.01
        };
      }
    }

    if (dateFrom || dateTo) {
      whereClause.transaction_date = {};
      if (dateFrom) whereClause.transaction_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.transaction_date[Op.lte] = dateTo;
    }

    if (storeId && storeId !== 'all') whereClause.store_id = storeId;
    if (customerId && customerId !== 'all') whereClause.customer_id = customerId;
    if (salesAgentId && salesAgentId !== 'all') whereClause.sales_agent_id = salesAgentId;
    if (productCategoryId && productCategoryId !== 'all') whereClause.product_category_id = productCategoryId;
    if (financialYearId && financialYearId !== 'all') whereClause.financial_year_id = financialYearId;
    if (currencyId && currencyId !== 'all') whereClause.currency_id = currencyId;

    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    const totalTransactions = await SalesTransaction.count({ where: finalWhereClause });
    const totalAmount = await SalesTransaction.sum('total_amount', { where: finalWhereClause }) || 0;
    const totalPaidAmount = await SalesTransaction.sum('paid_amount', { where: finalWhereClause }) || 0;
    const totalBalanceAmount = await SalesTransaction.sum('balance_amount', { where: finalWhereClause }) || 0;
    const totalSubtotal = await SalesTransaction.sum('subtotal', { where: finalWhereClause }) || 0;
    const totalDiscountAmount = await SalesTransaction.sum('discount_amount', { where: finalWhereClause }) || 0;
    const totalTaxAmount = await SalesTransaction.sum('tax_amount', { where: finalWhereClause }) || 0;

    // Get transaction type distribution
    const transactionTypeDistribution = await SalesTransaction.findAll({
      where: finalWhereClause,
      attributes: [
        'transaction_type',
        [SalesTransaction.sequelize.fn('COUNT', SalesTransaction.sequelize.col('id')), 'count'],
        [SalesTransaction.sequelize.fn('SUM', SalesTransaction.sequelize.col('total_amount')), 'total']
      ],
      group: ['transaction_type']
    });

    // Get status distribution
    const statusDistribution = await SalesTransaction.findAll({
      where: finalWhereClause,
      attributes: [
        'status',
        [SalesTransaction.sequelize.fn('COUNT', SalesTransaction.sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    res.json({
      success: true,
      stats: {
        totalTransactions,
        totalAmount: parseFloat(totalAmount),
        totalPaidAmount: parseFloat(totalPaidAmount),
        totalBalanceAmount: parseFloat(totalBalanceAmount),
        totalSubtotal: parseFloat(totalSubtotal),
        totalDiscountAmount: parseFloat(totalDiscountAmount),
        totalTaxAmount: parseFloat(totalTaxAmount),
        transactionTypeDistribution: transactionTypeDistribution.map(item => ({
          type: item.transaction_type,
          count: parseInt(item.get('count')),
          total: parseFloat(item.get('total') || 0)
        })),
        statusDistribution: statusDistribution.map(item => ({
          status: item.status,
          count: parseInt(item.get('count'))
        })),
        lastUpdate: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch revenue report statistics',
      details: error.message 
    });
  }
});

// GET /api/revenue-report/top-products - Get Top/Bottom Products by Revenue directly from SalesTransaction
router.get('/top-products', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      storeId,
      customerId,
      type = 'top', // 'top' or 'bottom'
      limit = 5
    } = req.query;

    const whereClause = {};

    // Only fetch approved invoices
    whereClause.transaction_type = 'invoice';
    whereClause.status = 'approved';

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.transaction_date = {};
      if (dateFrom) whereClause.transaction_date[Op.gte] = dateFrom;
      if (dateTo) whereClause.transaction_date[Op.lte] = dateTo;
    }

    // Store filter
    if (storeId && storeId !== 'all') {
      whereClause.store_id = storeId;
    }

    // Customer filter
    if (customerId && customerId !== 'all') {
      whereClause.customer_id = customerId;
    }

    // Build final where clause with company filter
    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    finalWhereClause.is_cancelled = false;

    // Fetch sales transactions with product associations
    // Group by product_id to show actual products from the products table
    const transactions = await SalesTransaction.findAll({
      where: finalWhereClause,
      include: [
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name', 'code'],
          required: false,
          where: buildCompanyWhere(req, {})
        }
      ],
      attributes: [
        'id',
        'product_id',
        'transaction_ref_number',
        'total_amount'
      ]
    });

    // Group transactions by product_id
    const productMap = new Map();

    transactions.forEach((transaction) => {
      // Use product_id as the key
      const productId = transaction.product_id;
      
      // Skip if no product_id
      if (!productId) {
        return;
      }

      // Get product name and code from Product model, or use fallback
      const productName = transaction.product?.name || 'Unknown Product';
      const productCode = transaction.product?.code || undefined;

      // Direct column access: transaction_ref_number from SalesTransaction table
      const transactionRef = transaction.transaction_ref_number || null;
      // Direct column access: total_amount from SalesTransaction table (revenue)
      const revenue = parseFloat(transaction.total_amount || 0);

      if (productMap.has(productId)) {
        const existing = productMap.get(productId);
        existing.revenue += revenue;
        existing.quantity += 1;
        if (transactionRef && !existing.transactionRefNumbers.includes(transactionRef)) {
          existing.transactionRefNumbers.push(transactionRef);
        }
      } else {
        productMap.set(productId, {
          id: productId,
          name: productName,
          code: productCode,
          revenue: revenue,
          quantity: 1,
          transactionRefNumbers: transactionRef ? [transactionRef] : []
        });
      }
    });

    // Convert to array and sort
    const products = Array.from(productMap.values());
    products.sort((a, b) => {
      if (type === 'top') {
        return b.revenue - a.revenue; // Descending for top
      } else {
        return a.revenue - b.revenue; // Ascending for bottom
      }
    });

    // Return top/bottom N products
    const result = products.slice(0, parseInt(limit));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch top products',
      details: error.message
    });
  }
});

module.exports = router;

