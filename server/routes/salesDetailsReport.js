const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { 
  SalesInvoiceItem,
  SalesOrderItem,
  SalesInvoice,
  SalesOrder,
  Product,
  Store,
  Customer,
  SalesAgent,
  Currency,
  TaxCode,
  ProductCategory,
  ProductBrandName,
  ProductManufacturer,
  ProductModel,
  ProductColor,
  PriceCategory,
  User
} = require('../models');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId);

// GET /api/sales-details-report - Get Sales Details Report Data (Line Items - Individual Product Transactions)
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
      productId,
      productCategoryId,
      brandNameId,
      manufacturerId,
      modelId,
      colorId,
      priceCategoryId,
      currencyId,
      search,
      sortBy = 'transaction_date',
      sortOrder = 'DESC'
    } = req.query;

    const whereClause = {};
    const invoiceWhereClause = {};

    // Date range filter - apply to parent invoice
    if (dateFrom || dateTo) {
      invoiceWhereClause.invoice_date = {};
      if (dateFrom) {
        invoiceWhereClause.invoice_date[Op.gte] = dateFrom;
      }
      if (dateTo) {
        invoiceWhereClause.invoice_date[Op.lte] = dateTo;
      }
    }

    // Store filter
    if (storeId && storeId !== 'all') {
      invoiceWhereClause.store_id = storeId;
    }

    // Customer filter
    if (customerId && customerId !== 'all') {
      invoiceWhereClause.customer_id = customerId;
    }

    // Sales Agent filter
    if (salesAgentId && salesAgentId !== 'all') {
      invoiceWhereClause.sales_agent_id = salesAgentId;
    }

    // Status filter
    if (status && status !== 'all') {
      invoiceWhereClause.status = status;
    }

    // Currency filter
    if (currencyId && currencyId !== 'all') {
      invoiceWhereClause.currency_id = currencyId;
    }

    // Product filter
    if (productId && productId !== 'all') {
      whereClause.product_id = productId;
    }

    // Product Category filter
    if (productCategoryId && productCategoryId !== 'all') {
      whereClause.product_category_id = productCategoryId;
    }

    // Brand Name filter
    if (brandNameId && brandNameId !== 'all') {
      whereClause.brand_id = brandNameId;
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
      invoiceWhereClause.price_category_id = priceCategoryId;
    }

    // Search functionality - add before building company where clauses
    if (search) {
      invoiceWhereClause[Op.or] = [
        { invoice_ref_number: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

        // Build company where clauses
        const finalInvoiceWhere = buildCompanyWhere(req, invoiceWhereClause);
        const finalItemWhere = buildCompanyWhere(req, whereClause);

        // CRITICAL: Ensure companyId is always in the where clause
        if (!req.user.isSystemAdmin && req.user.companyId) {
          finalInvoiceWhere.companyId = req.user.companyId;
          finalItemWhere.companyId = req.user.companyId;
        }

    // Fetch invoice items - query without TaxCode includes first, then fetch tax codes separately if needed
    const invoiceItems = await SalesInvoiceItem.findAll({
      where: finalItemWhere,
      attributes: { exclude: [] }, // Get all attributes from SalesInvoiceItem
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          where: finalInvoiceWhere,
          attributes: ['id', 'invoice_ref_number', 'invoice_date', 'due_date', 'status', 'subtotal', 'discount_amount', 'tax_amount', 'total_amount', 'paid_amount', 'balance_amount', 'currency_id', 'notes'],
          required: true,
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
              model: Currency,
              as: 'currency',
              attributes: ['id', 'name', 'code', 'symbol'],
              required: false,
              where: buildCompanyWhere(req, {})
            }
          ]
        },
        {
          model: Product,
          as: 'product',
          attributes: { exclude: [] }, // Get all product catalog fields
          required: false,
          where: buildCompanyWhere(req, {}),
          include: [
            {
              model: ProductCategory,
              as: 'category',
              attributes: ['id', 'name', 'code'],
              required: false,
              where: buildCompanyWhere(req, {})
            },
            {
              model: ProductBrandName,
              as: 'brand',
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
            }
          ]
        }
      ],
      limit: 10000
    });

    // Fetch tax codes separately to avoid association conflicts
    const taxCodeIds = new Set();
    invoiceItems.forEach(item => {
      if (item.sales_tax_id) taxCodeIds.add(item.sales_tax_id);
      if (item.wht_tax_id) taxCodeIds.add(item.wht_tax_id);
    });

    const taxCodes = await TaxCode.findAll({
      where: buildCompanyWhere(req, { id: { [Op.in]: Array.from(taxCodeIds) } }),
      attributes: ['id', 'name', 'code', 'rate']
    });

    const taxCodeMap = {};
    taxCodes.forEach(tc => {
      taxCodeMap[tc.id] = tc;
    });

    // Transform invoice items
    const transformedInvoiceItems = invoiceItems.map(item => ({
      id: item.id,
      transactionType: 'invoice',
      transactionRefNumber: item.salesInvoice?.invoice_ref_number || '--',
      transactionDate: item.salesInvoice?.invoice_date || '--',
      dueDate: item.salesInvoice?.due_date || '--',
      storeId: item.salesInvoice?.store?.id || '--',
      storeName: item.salesInvoice?.store?.name || '--',
      customerId: item.salesInvoice?.customer?.id || '--',
      customerName: item.salesInvoice?.customer?.full_name || '--',
      customerCode: item.salesInvoice?.customer?.customer_id || '--',
      salesAgentId: item.salesInvoice?.salesAgent?.id || '--',
      salesAgentName: item.salesInvoice?.salesAgent?.full_name || '--',
      salesAgentNumber: item.salesInvoice?.salesAgent?.agent_number || '--',
      productId: item.product_id,
      productCode: item.product?.code || '--',
      productBarcode: item.product?.barcode || null,
      productPartNumber: item.product?.part_number || null,
      productName: item.product?.name || '--',
      productDescription: item.product?.description || null,
      productCategoryId: item.product?.category_id || '--',
      productCategoryName: item.product?.category?.name || '--',
      productCategoryCode: item.product?.category?.code || '--',
      brandId: item.product?.brand_id || '--',
      brandName: item.product?.brand?.name || '--',
      manufacturerId: item.product?.manufacturer_id || '--',
      manufacturerName: item.product?.manufacturer?.name || '--',
      modelId: item.product?.model_id || '--',
      modelName: item.product?.model?.name || '--',
      colorId: item.product?.color_id || '--',
      colorName: item.product?.color?.name || '--',
      quantity: parseFloat(item.quantity || 0),
      unitPrice: parseFloat(item.unit_price || 0),
      discountPercentage: parseFloat(item.discount_percentage || 0),
      discountAmount: parseFloat(item.discount_amount || 0),
      taxPercentage: parseFloat(item.tax_percentage || 0),
      taxAmount: parseFloat(item.tax_amount || 0),
      whtAmount: parseFloat(item.wht_amount || 0),
      lineTotal: parseFloat(item.line_total || 0),
      salesTaxId: item.sales_tax_id,
      salesTaxName: taxCodeMap[item.sales_tax_id]?.name || '--',
      salesTaxRate: parseFloat(taxCodeMap[item.sales_tax_id]?.rate || 0),
      whtTaxId: item.wht_tax_id,
      whtTaxName: taxCodeMap[item.wht_tax_id]?.name || '--',
      whtTaxRate: parseFloat(taxCodeMap[item.wht_tax_id]?.rate || 0),
      currencyId: item.salesInvoice?.currency_id || '--',
      currencyName: item.salesInvoice?.currency?.name || '--',
      currencyCode: item.salesInvoice?.currency?.code || '--',
      currencySymbol: item.salesInvoice?.currency?.symbol || '--',
      status: item.salesInvoice?.status || '--',
      transactionSubtotal: parseFloat(item.salesInvoice?.subtotal || 0),
      transactionDiscountAmount: parseFloat(item.salesInvoice?.discount_amount || 0),
      transactionTaxAmount: parseFloat(item.salesInvoice?.tax_amount || 0),
      transactionTotalAmount: parseFloat(item.salesInvoice?.total_amount || 0),
      transactionPaidAmount: parseFloat(item.salesInvoice?.paid_amount || 0),
      transactionBalanceAmount: parseFloat(item.salesInvoice?.balance_amount || 0),
      notes: item.notes || item.salesInvoice?.notes || '--',
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));

    // Use only invoice items (no order items)
    let allItems = transformedInvoiceItems;

    // Group by product and aggregate quantities and amounts
    const productMap = new Map();
    
    allItems.forEach(item => {
      const productKey = item.productId || 'unknown';
      
      if (!productMap.has(productKey)) {
        // First occurrence - store product details
        productMap.set(productKey, {
          id: `${productKey}-merged`,
          transactionType: 'merged', // Indicate this is a merged product
          transactionRefNumber: '--', // Not applicable for merged products
          transactionDate: '--',
          dueDate: '--',
          storeId: '--',
          storeName: '--',
          customerId: '--',
          customerName: '--',
          customerCode: '--',
          salesAgentId: '--',
          salesAgentName: '--',
          salesAgentNumber: '--',
          productId: item.productId,
          productCode: item.productCode,
          productBarcode: item.productBarcode,
          productPartNumber: item.productPartNumber,
          productName: item.productName,
          productDescription: item.productDescription,
          productCategoryId: item.productCategoryId,
          productCategoryName: item.productCategoryName,
          productCategoryCode: item.productCategoryCode,
          brandId: item.brandId,
          brandName: item.brandName,
          manufacturerId: item.manufacturerId,
          manufacturerName: item.manufacturerName,
          modelId: item.modelId,
          modelName: item.modelName,
          colorId: item.colorId,
          colorName: item.colorName,
          quantity: 0, // Will be summed
          unitPrice: 0, // Will be calculated as weighted average
          discountPercentage: 0,
          discountAmount: 0, // Will be summed
          taxPercentage: 0,
          taxAmount: 0, // Will be summed
          whtAmount: 0, // Will be summed
          lineTotal: 0, // Will be summed
          salesTaxId: item.salesTaxId,
          salesTaxName: item.salesTaxName,
          salesTaxRate: item.salesTaxRate,
          whtTaxId: item.whtTaxId,
          whtTaxName: item.whtTaxName,
          whtTaxRate: item.whtTaxRate,
          currencyId: item.currencyId,
          currencyName: item.currencyName,
          currencyCode: item.currencyCode,
          currencySymbol: item.currencySymbol,
          status: '--',
          transactionSubtotal: 0,
          transactionDiscountAmount: 0,
          transactionTaxAmount: 0,
          transactionTotalAmount: 0,
          transactionPaidAmount: 0,
          transactionBalanceAmount: 0,
          notes: '--',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        });
      }
      
      const mergedProduct = productMap.get(productKey);
      
      // Aggregate quantities and amounts
      mergedProduct.quantity += item.quantity || 0;
      mergedProduct.discountAmount += item.discountAmount || 0;
      mergedProduct.taxAmount += item.taxAmount || 0;
      mergedProduct.whtAmount += item.whtAmount || 0;
      mergedProduct.lineTotal += item.lineTotal || 0;
    });
    
    // Calculate weighted average unit price for each product
    productMap.forEach((mergedProduct, key) => {
      if (mergedProduct.quantity > 0) {
        // Calculate average unit price: total lineTotal / total quantity
        mergedProduct.unitPrice = mergedProduct.lineTotal / mergedProduct.quantity;
      }
    });
    
    // Convert map to array
    allItems = Array.from(productMap.values());

    // Apply sorting
    if (sortBy && sortOrder) {
      const sortField = sortBy === 'transactionDate' ? 'transactionDate' :
                       sortBy === 'transactionRefNumber' ? 'transactionRefNumber' :
                       sortBy === 'productName' ? 'productName' :
                       sortBy === 'quantity' ? 'quantity' :
                       sortBy === 'quantitySold' ? 'quantity' :
                       sortBy === 'lineTotal' ? 'lineTotal' :
                       'productName';

      allItems.sort((a, b) => {
        const aValue = a[sortField];
        const bValue = b[sortField];

        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortOrder.toUpperCase() === 'ASC' ? aValue - bValue : bValue - aValue;
        }
        
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        
        if (sortOrder.toUpperCase() === 'ASC') {
          return aStr.localeCompare(bStr);
        } else {
          return bStr.localeCompare(aStr);
        }
      });
    }

    res.json({
      success: true,
      data: allItems,
      total: allItems.length
    });
  } catch (error) {
    console.error('Error fetching sales details report:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch sales details report',
      details: error.message 
    });
  }
});

// GET /api/sales-details-report/stats - Get Sales Details Report Statistics
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
      currencyId
    } = req.query;

    const whereClause = {};
    const invoiceWhereClause = {};

    if (dateFrom || dateTo) {
      invoiceWhereClause.invoice_date = {};
      if (dateFrom) {
        invoiceWhereClause.invoice_date[Op.gte] = dateFrom;
      }
      if (dateTo) {
        invoiceWhereClause.invoice_date[Op.lte] = dateTo;
      }
    }

    if (storeId && storeId !== 'all') {
      invoiceWhereClause.store_id = storeId;
    }

    if (customerId && customerId !== 'all') {
      invoiceWhereClause.customer_id = customerId;
    }

    if (salesAgentId && salesAgentId !== 'all') {
      invoiceWhereClause.sales_agent_id = salesAgentId;
    }

    if (status && status !== 'all') {
      invoiceWhereClause.status = status;
    }

    if (currencyId && currencyId !== 'all') {
      invoiceWhereClause.currency_id = currencyId;
    }

    if (productCategoryId && productCategoryId !== 'all') {
      whereClause.product_category_id = productCategoryId;
    }

        const finalInvoiceWhere = buildCompanyWhere(req, invoiceWhereClause);
        const finalItemWhere = buildCompanyWhere(req, whereClause);

        if (!req.user.isSystemAdmin && req.user.companyId) {
          finalInvoiceWhere.companyId = req.user.companyId;
          finalItemWhere.companyId = req.user.companyId;
        }

    // Count invoice items
    const invoiceItemCount = await SalesInvoiceItem.count({
      where: finalItemWhere,
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          where: finalInvoiceWhere,
          required: true
        }
      ]
    });

    // Sum totals from invoice items
    const invoiceTotals = await SalesInvoiceItem.findAll({
      where: finalItemWhere,
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          where: finalInvoiceWhere,
          required: true,
          attributes: [] // Don't select any columns from SalesInvoice to avoid ambiguity
        }
      ],
      attributes: [
        [SalesInvoiceItem.sequelize.literal('SUM("SalesInvoiceItem"."quantity")'), 'totalQuantity'],
        [SalesInvoiceItem.sequelize.literal('SUM("SalesInvoiceItem"."line_total")'), 'totalLineTotal'],
        [SalesInvoiceItem.sequelize.literal('SUM("SalesInvoiceItem"."discount_amount")'), 'totalDiscount'],
        [SalesInvoiceItem.sequelize.literal('SUM("SalesInvoiceItem"."tax_amount")'), 'totalTax']
      ],
      raw: true
    });

    const invoiceTotalQuantity = parseFloat(invoiceTotals[0]?.totalQuantity || 0);
    const invoiceTotalLineTotal = parseFloat(invoiceTotals[0]?.totalLineTotal || 0);
    const invoiceTotalDiscount = parseFloat(invoiceTotals[0]?.totalDiscount || 0);
    const invoiceTotalTax = parseFloat(invoiceTotals[0]?.totalTax || 0);
    const invoiceTotalWht = parseFloat(invoiceTotals[0]?.totalWht || 0);

    // Only invoice items are included
    const totalItems = invoiceItemCount;
    const totalQuantity = invoiceTotalQuantity;
    const totalLineTotal = invoiceTotalLineTotal;
    const totalDiscount = invoiceTotalDiscount;
    const totalTax = invoiceTotalTax;
    const totalWht = invoiceTotalWht;

    res.json({
      success: true,
      stats: {
        totalItems,
        totalQuantity,
        totalLineTotal,
        totalDiscount,
        totalTax,
        totalWht,
        invoiceItems: invoiceItemCount,
        orderItems: 0, // No order items included
        lastUpdate: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching sales details report statistics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch sales details report statistics',
      details: error.message 
    });
  }
});

module.exports = router;
