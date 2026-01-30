const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer');
const pdf = require('html-pdf-node');
const { StoreRequest, StoreRequestItem, StoreRequestItemTransaction, Store, User, Product, Currency, ProductBrandName, ProductColor, ProductManufacturer, ProductCategory, ProductModel, Packaging, ProductStore, ProductTransaction, FinancialYear, TransactionType, ProductExpiryDate, ProductSerialNumber } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Helper function to generate reference number
const generateReferenceNumber = async (req) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  // Get count of requests for today
  const todayStart = new Date(year, now.getMonth(), now.getDate());
  const todayEnd = new Date(year, now.getMonth(), now.getDate() + 1);
  
  const count = await StoreRequest.count({
    where: buildCompanyWhere(req, {
      createdAt: {
        [require('sequelize').Op.between]: [todayStart, todayEnd]
      }
    })
  });
  
  const sequence = String(count + 1).padStart(4, '0');
  return `SR-${year}-${month}-${day}-${sequence}`;
};

// Helper function to log quantity changes
const logQuantityChange = async (itemId, transactionType, quantity, userId, notes = null, reason = null, transaction = null, companyId = null) => {
  try {
    const item = await StoreRequestItem.findByPk(itemId, { transaction });
    if (!item) return;
    
    // If companyId not provided, get it from the store request
    let finalCompanyId = companyId;
    if (!finalCompanyId) {
      const storeRequest = await StoreRequest.findByPk(item.store_request_id, { transaction });
      if (storeRequest) {
        finalCompanyId = storeRequest.companyId;
      }
    }
    
    // Map transaction types to actual database fields
    const fieldMapping = {
      'requested': 'requested_quantity',
      'available': 'available_quantity', 
      'approved': 'approved_quantity',
      'issued': 'issued_quantity',
      'received': 'received_quantity',
      'fulfilled': 'fulfilled_quantity'
    };
    
    const fieldName = fieldMapping[transactionType];
    
    if (!fieldName) {
      return;
    }
    
    const previousQuantity = parseInt(item[fieldName] || 0);
    const quantityToAdd = parseInt(quantity);
    
    // For 'received' transactions, add to existing quantity instead of replacing
    let newQuantity;
    if (transactionType === 'received') {
      newQuantity = previousQuantity + quantityToAdd;
    } else {
      newQuantity = quantityToAdd;
    }
    
    // Update the item field and calculate status
    const updateData = {
      [fieldName]: newQuantity
    };
    
    // Calculate status and remaining receiving quantity based on quantities
    if (transactionType === 'received') {
      const receivedQty = transactionType === 'received' ? newQuantity : parseInt(item.received_quantity || 0);
      const issuedQty = parseInt(item.issued_quantity || 0);
      const approvedQty = parseInt(item.approved_quantity || 0);
      
      // Update remaining receiving quantity (issued - received)
      updateData.remaining_receiving_quantity = Math.max(0, issuedQty - receivedQty);
      
      if (approvedQty === 0) {
        // No items approved yet
        updateData.status = item.status; // Keep current status
      } else if (receivedQty === 0) {
        // Items approved but nothing received yet
        updateData.status = 'issued';
      } else if (receivedQty < approvedQty) {
        // Partially received (received less than approved, regardless of issued quantity)
        updateData.status = 'partially_received';
      } else if (receivedQty === approvedQty) {
        // Fully received (received all approved items)
        updateData.status = 'fully_received';
      }
      
      } else if (transactionType === 'issued') {
      // When items are issued, add to remaining receiving quantity
      const currentRemainingReceivingQty = parseInt(item.remaining_receiving_quantity || 0);
      updateData.remaining_receiving_quantity = currentRemainingReceivingQty + quantityToAdd;
      
      }
    
    await item.update(updateData, { transaction });
    
    await StoreRequestItemTransaction.create({
      store_request_item_id: itemId,
      transaction_type: transactionType,
      quantity: quantityToAdd,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      performed_by: userId,
      notes: notes,
      reason: reason,
      companyId: finalCompanyId // Add companyId for multi-tenant isolation
    }, { transaction });
    
    return item;
  } catch (error) {
    throw error;
  }
};

// PDF Generation Helper Functions
const generateStockBalancePDFHTML = (data, filters, reportType = 'current') => {
  const reportTitle = reportType === 'current' ? 'Stock Balance Report' : 'Stock Balance as of Date Report';
  const reportDate = reportType === 'current' 
    ? new Date().toLocaleDateString() 
    : (filters.asOfDate ? new Date(filters.asOfDate).toLocaleDateString() : 'Date');
  
  const totalQuantity = data.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalValue = data.reduce((sum, item) => sum + (item.totalValue || 0), 0);
  
  // Escape HTML special characters
  const escapeHtml = (text) => {
    if (!text) return '--';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  
  // Data length in HTML generator
  // First data item
  
  if (!data || data.length === 0) {
    // No data available for PDF generation
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stock Balance Report</title>
</head>
<body>
  <h1>EasyMauzo Company - Stock Balance Report</h1>
  <p><strong>Generated on:</strong> ${escapeHtml(reportDate)}</p>
  <p><strong>No data available</strong></p>
</body>
</html>`;
  }
  
  const tableRows = data.map((item, index) => {
    try {
      const row = `
      <tr>
        <td style="border: 1px solid black; padding: 8px;">${escapeHtml(item.productCode)}</td>
        <td style="border: 1px solid black; padding: 8px;">${escapeHtml(item.productName)}</td>
        <td style="border: 1px solid black; padding: 8px;">${escapeHtml(item.category)}</td>
        <td style="border: 1px solid black; padding: 8px;">${escapeHtml(item.brandName)}</td>
        <td style="border: 1px solid black; padding: 8px;">${escapeHtml(item.storeName)}</td>
        <td style="border: 1px solid black; padding: 8px; text-align: right;">${item.quantity || 0}</td>
        <td style="border: 1px solid black; padding: 8px; text-align: right;">$${(item.unitCost || 0).toFixed(2)}</td>
        <td style="border: 1px solid black; padding: 8px; text-align: right;">$${(item.totalValue || 0).toFixed(2)}</td>
      </tr>
    `;
      if (index === 0) {
        // First row generated successfully
      }
      return row;
    } catch (error) {
      // Error generating table row for item
      return '<tr><td colspan="8">Error generating row</td></tr>';
    }
  }).join('');
  
  // Sample table row (full)
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stock Balance Report</title>
</head>
<body style="font-family: Arial, sans-serif; margin: 20px; color: black; font-size: 12px;">
  <h1 style="text-align: center; color: black; margin-bottom: 20px;">EasyMauzo Company - Stock Balance Report</h1>
  <p><strong>Generated on:</strong> ${escapeHtml(reportDate)}</p>
  <p><strong>Total Products:</strong> ${data.length}</p>
  
  <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
    <thead>
      <tr>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Product Code</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Product Name</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Category</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Brand</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Store</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Quantity</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Unit Cost</th>
        <th style="border: 1px solid black; padding: 8px; background-color: #f0f0f0; font-weight: bold;">Total Value</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  
  <div style="margin-top: 20px; padding: 10px; background-color: #f0f0f0; border: 1px solid black;">
    <h3>Summary Totals</h3>
    <p><strong>Total Products:</strong> ${data.length}</p>
    <p><strong>Total Quantity:</strong> ${totalQuantity.toLocaleString()}</p>
    <p><strong>Total Value:</strong> $${totalValue.toFixed(2)}</p>
  </div>
  
  <p style="margin-top: 30px; text-align: center; font-size: 10px;">
    Generated by EasyMauzo Inventory Management System
  </p>
</body>
</html>`;
};

// GET /api/store-requests - List all store requests
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, priority, search, request_type, exclude_status, include_partial_requests, requesting_store_id, issuing_store_id, date_from, date_to } = req.query;
    const offset = (page - 1) * limit;
    
    const whereClause = {};
    
    // Handle status filtering (support comma-separated values)
    if (status) {
      if (status.includes(',')) {
        // Multiple statuses (comma-separated)
        whereClause.status = {
          [require('sequelize').Op.in]: status.split(',').map(s => s.trim())
        };
      } else {
        // Single status
        whereClause.status = status;
      }
    }
    
    // Handle priority filtering (support comma-separated values)
    if (priority) {
      if (priority.includes(',')) {
        // Multiple priorities (comma-separated)
        whereClause.priority = {
          [require('sequelize').Op.in]: priority.split(',').map(p => p.trim())
        };
      } else {
        // Single priority
        whereClause.priority = priority;
      }
    }
    
    // Handle store filtering
    if (requesting_store_id) {
      if (requesting_store_id.includes(',')) {
        // Multiple store IDs (comma-separated)
        whereClause.requested_by_store_id = {
          [require('sequelize').Op.in]: requesting_store_id.split(',').map(id => id.trim())
        };
      } else {
        // Single store ID
        whereClause.requested_by_store_id = requesting_store_id;
      }
    }
    
    if (issuing_store_id) {
      if (issuing_store_id.includes(',')) {
        // Multiple store IDs (comma-separated)
        whereClause.requested_from_store_id = {
          [require('sequelize').Op.in]: issuing_store_id.split(',').map(id => id.trim())
        };
      } else {
        // Single store ID
        whereClause.requested_from_store_id = issuing_store_id;
      }
    }
    
    // Handle date filtering
    if (date_from || date_to) {
      if (date_from && date_to) {
        // Both dates provided - use between
        whereClause.request_date = {
          [require('sequelize').Op.between]: [date_from, date_to]
        };
        } else if (date_from) {
        // Only start date provided - from this date onwards
        whereClause.request_date = {
          [require('sequelize').Op.gte]: date_from
        };
        } else if (date_to) {
        // Only end date provided - up to this date
        whereClause.request_date = {
          [require('sequelize').Op.lte]: date_to
        };
        }
    }
    
    if (request_type) {
      if (include_partial_requests === 'true') {
        // For Store Issues: Show all requests (both issue and request types) except submitted and draft
        // Include cancelled orders for Store Issues (cancelled by issuer without issuing)
        // Include partial_issued_cancelled because it still has issued stock that can be received
        // For Store Receipts: Also include cancelled and partially_received_cancelled statuses
        const complexOrConditions = [
          { 
            request_type: 'issue',
            status: {
              [require('sequelize').Op.notIn]: ['submitted', 'draft']
            }
          },
          { 
            request_type: 'request',
            status: {
              [require('sequelize').Op.notIn]: ['submitted', 'draft']
            }
          },
          // Include partial_issued_cancelled for both request types as it has issued stock
          {
            status: 'partial_issued_cancelled'
          },
          // Include cancelled and partially_received_cancelled for Store Receipts
          // This includes orders that were fully issued (fulfilled) but then cancelled by receiver
          {
            request_type: 'request',
            status: 'cancelled'
          },
          {
            request_type: 'request',
            status: 'partially_received_cancelled'
          }
        ];

        // If there's a search term, combine it with the complex OR conditions
        if (search) {
          const searchConditions = [
            { reference_number: { [require('sequelize').Op.iLike]: `%${search}%` } },
            { notes: { [require('sequelize').Op.iLike]: `%${search}%` } }
          ];
          
          // Combine search conditions with each complex OR condition using AND
          whereClause[require('sequelize').Op.and] = [
            {
              [require('sequelize').Op.or]: complexOrConditions
            },
            {
              [require('sequelize').Op.or]: searchConditions
            }
          ];
        } else {
          whereClause[require('sequelize').Op.or] = complexOrConditions;
        }
      } else {
        whereClause.request_type = request_type;
        
        // Handle search for simple request_type filtering
        if (search) {
          whereClause[require('sequelize').Op.or] = [
            { reference_number: { [require('sequelize').Op.iLike]: `%${search}%` } },
            { notes: { [require('sequelize').Op.iLike]: `%${search}%` } }
          ];
        }
      }
    } else {
      // Handle search when no request_type filtering
      if (search) {
        whereClause[require('sequelize').Op.or] = [
          { reference_number: { [require('sequelize').Op.iLike]: `%${search}%` } },
          { notes: { [require('sequelize').Op.iLike]: `%${search}%` } }
        ];
      }
    }
    
    // Handle exclude_status - but only if we don't have complex OR conditions
    if (exclude_status && !whereClause[require('sequelize').Op.or]) {
      whereClause.status = {
        [require('sequelize').Op.ne]: exclude_status
      };
    }
    
    const { count, rows: storeRequests } = await StoreRequest.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Store, as: 'requestingStore', attributes: ['id', 'name'] },
        { model: Store, as: 'issuingStore', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'submittedByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'approvedByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'rejectedByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'fulfilledByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: Currency, as: 'storeRequestCurrency', attributes: ['id', 'name', 'symbol'] },
        {
          model: StoreRequestItem,
          as: 'storeRequestItems',
          attributes: [
            'id', 'store_request_id', 'product_id', 'requested_quantity', 'available_quantity',
            'approved_quantity', 'fulfilled_quantity', 'issued_quantity', 'received_quantity', 'remaining_quantity', 'remaining_receiving_quantity',
            'unit_cost', 'total_cost', 'currency_id', 'exchange_rate', 'equivalent_amount',
            'status', 'rejection_reason', 'notes', 'batch_number', 'expiry_date', 'serial_numbers',
            'fulfilled_at', 'fulfilled_by', 'created_by', 'updated_by', 'createdAt', 'updatedAt'
          ],
          include: [
            { model: Product, as: 'storeRequestProduct', attributes: ['id', 'name', 'code', 'unit_id'] },
            { model: Currency, as: 'currency', attributes: ['id', 'name', 'symbol'] },
            { model: User, as: 'createdByUser', attributes: ['id', 'first_name', 'last_name'] },
            { model: User, as: 'fulfilledByUser', attributes: ['id', 'first_name', 'last_name'] },
            { model: User, as: 'updatedByUser', attributes: ['id', 'first_name', 'last_name'] }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      data: storeRequests,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNextPage: parseInt(page) < Math.ceil(count / limit),
        hasPrevPage: parseInt(page) > 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch store requests' });
  }
});

// GET /api/store-requests/current-stock-balance - Get current stock balance from ProductStore table
router.get('/current-stock-balance', async (req, res) => {
  try {
    const {
      storeId,
      storeLocationIds,
      categoryIds,
      brandNameIds,
      manufacturerIds,
      modelIds,
      colorIds
    } = req.query;

    // Build where clause for filters
    const productStoreWhereClause = {};
    const productWhereClause = {};
    const storeWhereClause = {};

    // Store filter
    if (storeId) {
      productStoreWhereClause.store_id = storeId;
      storeWhereClause.id = storeId;
    }

    // Store Location filter - Note: Store model uses 'location' field, not 'location_id'
    if (storeLocationIds) {
      const locationIds = Array.isArray(storeLocationIds) ? storeLocationIds : storeLocationIds.split(',');
      // For now, we'll skip this filter as Store model doesn't have location_id
      // You may need to join with a separate store_locations table if you have one
    }

    // Category filter
    if (categoryIds) {
      const catIds = Array.isArray(categoryIds) ? categoryIds : categoryIds.split(',');
      productWhereClause.category_id = {
        [require('sequelize').Op.in]: catIds
      };
    }

    // Brand Name filter
    if (brandNameIds) {
      const brandIds = Array.isArray(brandNameIds) ? brandNameIds : brandNameIds.split(',');
      productWhereClause.brand_name_id = {
        [require('sequelize').Op.in]: brandIds
      };
    }

    // Manufacturer filter
    if (manufacturerIds) {
      const manuIds = Array.isArray(manufacturerIds) ? manufacturerIds : manufacturerIds.split(',');
      productWhereClause.manufacturer_id = {
        [require('sequelize').Op.in]: manuIds
      };
    }

    // Model filter
    if (modelIds) {
      const modIds = Array.isArray(modelIds) ? modelIds : modelIds.split(',');
      productWhereClause.model_id = {
        [require('sequelize').Op.in]: modIds
      };
    }

    // Color filter
    if (colorIds) {
      const colIds = Array.isArray(colorIds) ? colorIds : colorIds.split(',');
      productWhereClause.color_id = {
        [require('sequelize').Op.in]: colIds
      };
    }

    // Build final where clause with company filter for ProductStore
    const finalProductStoreWhere = buildCompanyWhere(req, productStoreWhereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalProductStoreWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Product with company filter
    const finalProductWhere = buildCompanyWhere(req, productWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalProductWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Store with company filter
    const finalStoreWhere = buildCompanyWhere(req, storeWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalStoreWhere.companyId = req.user.companyId;
    }

    // Get current stock balance data from ProductStore table
    const stockBalanceData = await ProductStore.findAll({
      where: finalProductStoreWhere,
      include: [
        {
          model: Product,
          as: 'product',
          where: finalProductWhere,
          required: true,
          include: [
            {
              model: ProductCategory,
              as: 'category',
              attributes: ['id', 'name']
            },
            {
              model: ProductBrandName,
              as: 'brand',
              attributes: ['id', 'name']
            },
            {
              model: ProductManufacturer,
              as: 'manufacturer',
              attributes: ['id', 'name']
            },
            {
              model: ProductModel,
              as: 'model',
              attributes: ['id', 'name']
            },
            {
              model: ProductColor,
              as: 'color',
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: Store,
          as: 'store',
          where: finalStoreWhere,
          required: false,
          attributes: ['id', 'name', 'location']
        }
      ],
      attributes: [
        'product_id',
        'store_id',
        'quantity',
        'min_quantity',
        'max_quantity',
        'reorder_point',
        'average_cost',
        'last_updated',
        'created_at',
        'updated_at'
      ],
      order: [
        ['store', 'name', 'ASC'],
        ['product', 'code', 'ASC']
      ]
    });

    // Aggregate data by product across all stores
    const productAggregation = {};
    
    stockBalanceData.forEach(item => {
      const productId = item.product_id;
      const quantity = parseFloat(item.quantity) || 0;
      const unitCost = parseFloat(item.product?.average_cost) || 0;
      
      if (!productAggregation[productId]) {
        // Initialize product aggregation
        productAggregation[productId] = {
          id: productId,
          productCode: item.product?.code || '--',
          productName: item.product?.name || '--',
          partNumber: item.product?.part_number || '--',
          category: item.product?.category?.name || '--',
          brandName: item.product?.brand?.name || '--',
          manufacturer: item.product?.manufacturer?.name || '--',
          model: item.product?.model?.name || '--',
          color: item.product?.color?.name || '--',
          totalQuantity: 0,
          totalValue: 0,
          averageUnitCost: 0,
          storeCount: 0,
          lastUpdated: item.last_updated ? new Date(item.last_updated).toLocaleDateString() : '--',
          stores: [] // Track which stores have this product
        };
      }
      
      // Aggregate quantities and values
      productAggregation[productId].totalQuantity += quantity;
      productAggregation[productId].totalValue += quantity * unitCost;
      productAggregation[productId].storeCount += 1;
      
      // Track store information
      if (item.store?.name) {
        productAggregation[productId].stores.push({
          name: item.store.name,
          location: item.store.location || '--',
          quantity: quantity
        });
      }
    });
    
    // Calculate average unit cost and transform to final format
    const transformedData = Object.values(productAggregation)
      .map(product => {
        // Calculate weighted average unit cost
        const averageUnitCost = product.totalQuantity > 0 ? product.totalValue / product.totalQuantity : 0;
        
        return {
          id: product.id,
          productCode: product.productCode,
          productName: product.productName,
          partNumber: product.partNumber,
          category: product.category,
          brandName: product.brandName,
          manufacturer: product.manufacturer,
          model: product.model,
          color: product.color,
          storeLocation: product.stores.length > 0 ? product.stores[0].location : '--', // Use first store's location
          quantity: product.totalQuantity,
          unitCost: averageUnitCost,
          totalValue: product.totalValue,
          lastUpdated: product.lastUpdated,
          storeCount: product.storeCount // Additional info about how many stores have this product
        };
      })
      .sort((a, b) => {
        // Sort by product code
        return a.productCode.localeCompare(b.productCode);
      });

    res.json({
      success: true,
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    // Error fetching current stock balance data
    res.status(500).json({
      success: false,
      message: 'Error fetching current stock balance data',
      error: error.message
    });
  }
});

// GET /api/store-requests/stock-balance - Get historical stock balance from ProductTransaction table
router.get('/stock-balance', async (req, res) => {
  try {
    const {
      asOfDate,
      storeId,
      storeLocationIds,
      categoryIds,
      brandNameIds,
      manufacturerIds,
      modelIds,
      colorIds
    } = req.query;

    // Build where clause for filters
    const transactionWhereClause = {};
    const productWhereClause = {};
    const storeWhereClause = {};

    // Date filter (as of date) - Use transaction_date for historical accuracy
    if (asOfDate) {
      transactionWhereClause.transaction_date = {
        [require('sequelize').Op.lte]: new Date(asOfDate + 'T23:59:59.999Z')
      };
    }

    // Store filter
    if (storeId) {
      transactionWhereClause.store_id = storeId;
      storeWhereClause.id = storeId;
    }

    // Store Location filter - Note: Store model uses 'location' field, not 'location_id'
    if (storeLocationIds) {
      const locationIds = Array.isArray(storeLocationIds) ? storeLocationIds : storeLocationIds.split(',');
      // For now, we'll skip this filter as Store model doesn't have location_id
      // You may need to join with a separate store_locations table if you have one
    }

    // Category filter
    if (categoryIds) {
      const catIds = Array.isArray(categoryIds) ? categoryIds : categoryIds.split(',');
      productWhereClause.category_id = {
        [require('sequelize').Op.in]: catIds
      };
    }

    // Brand Name filter
    if (brandNameIds) {
      const brandIds = Array.isArray(brandNameIds) ? brandNameIds : brandNameIds.split(',');
      productWhereClause.brand_name_id = {
        [require('sequelize').Op.in]: brandIds
      };
    }

    // Manufacturer filter
    if (manufacturerIds) {
      const manuIds = Array.isArray(manufacturerIds) ? manufacturerIds : manufacturerIds.split(',');
      productWhereClause.manufacturer_id = {
        [require('sequelize').Op.in]: manuIds
      };
    }

    // Model filter
    if (modelIds) {
      const modIds = Array.isArray(modelIds) ? modelIds : modelIds.split(',');
      productWhereClause.model_id = {
        [require('sequelize').Op.in]: modIds
      };
    }

    // Color filter
    if (colorIds) {
      const colIds = Array.isArray(colorIds) ? colorIds : colorIds.split(',');
      productWhereClause.color_id = {
        [require('sequelize').Op.in]: colIds
      };
    }

    // Get ProductTransaction model
    const { ProductTransaction } = require('../models');

    // Build final where clause with company filter for ProductTransaction
    const finalTransactionWhere = buildCompanyWhere(req, transactionWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalTransactionWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Product with company filter
    const finalProductWhere = buildCompanyWhere(req, productWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalProductWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Store with company filter
    const finalStoreWhere = buildCompanyWhere(req, storeWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalStoreWhere.companyId = req.user.companyId;
    }

    // Get stock balance data using transactions for historical accuracy
    const stockBalanceData = await ProductTransaction.findAll({
      where: finalTransactionWhere,
      include: [
        {
          model: Product,
          as: 'product',
          where: finalProductWhere,
          required: true,
          include: [
            {
              model: ProductCategory,
              as: 'category',
              attributes: ['id', 'name']
            },
            {
              model: ProductBrandName,
              as: 'brand',
              attributes: ['id', 'name']
            },
            {
              model: ProductManufacturer,
              as: 'manufacturer',
              attributes: ['id', 'name']
            },
            {
              model: ProductModel,
              as: 'model',
              attributes: ['id', 'name']
            },
            {
              model: ProductColor,
              as: 'color',
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: Store,
          as: 'store',
          where: finalStoreWhere,
          required: false,
          attributes: ['id', 'name', 'location']
        }
      ],
      attributes: [
        'product_id',
        'store_id',
        'quantity_in',
        'quantity_out',
        'product_average_cost',
        'transaction_date',
        'system_date'
      ],
      order: [
        ['store', 'name', 'ASC'],
        ['product', 'code', 'ASC'],
        ['transaction_date', 'ASC']
      ]
    });

    // Group transactions by product and store to calculate stock balance
    const stockBalanceMap = new Map();
    
    stockBalanceData.forEach(transaction => {
      const key = `${transaction.product_id}-${transaction.store_id}`;
      const quantityIn = parseFloat(transaction.quantity_in) || 0;
      const quantityOut = parseFloat(transaction.quantity_out) || 0;
      const unitCost = parseFloat(transaction.product?.average_cost) || 0;
      
      if (!stockBalanceMap.has(key)) {
        stockBalanceMap.set(key, {
          product_id: transaction.product_id,
          store_id: transaction.store_id,
          quantity: 0,
          totalValue: 0,
          totalQuantityIn: 0,
          lastTransactionDate: transaction.transaction_date,
          product: transaction.product,
          store: transaction.store
        });
      }
      
      const stockItem = stockBalanceMap.get(key);
      stockItem.quantity += (quantityIn - quantityOut);
      
      // Calculate weighted average cost for stock-in transactions
      if (quantityIn > 0) {
        const currentTotalValue = stockItem.totalValue;
        const currentTotalQuantity = stockItem.totalQuantityIn;
        const newTotalValue = currentTotalValue + (quantityIn * unitCost);
        const newTotalQuantity = currentTotalQuantity + quantityIn;
        
        stockItem.totalValue = newTotalValue;
        stockItem.totalQuantityIn = newTotalQuantity;
      }
      
      // Update last transaction date if this transaction is more recent
      if (new Date(transaction.transaction_date) > new Date(stockItem.lastTransactionDate)) {
        stockItem.lastTransactionDate = transaction.transaction_date;
      }
    });

    const productAggregation = {};
    
    Array.from(stockBalanceMap.values())
      .filter(item => item.quantity > 0) // Only include items with positive stock
      .forEach(item => {
        const productId = item.product_id;
        const quantity = item.quantity;
        const unitCost = item.totalQuantityIn > 0 ? item.totalValue / item.totalQuantityIn : 0;
        
        if (!productAggregation[productId]) {
          // Initialize product aggregation
          productAggregation[productId] = {
            id: productId,
            productCode: item.product?.code || '--',
            productName: item.product?.name || '--',
            partNumber: item.product?.part_number || '--',
            category: item.product?.category?.name || '--',
            brandName: item.product?.brand?.name || '--',
            manufacturer: item.product?.manufacturer?.name || '--',
            model: item.product?.model?.name || '--',
            color: item.product?.color?.name || '--',
            totalQuantity: 0,
            totalValue: 0,
            averageUnitCost: 0,
            storeCount: 0,
            lastUpdated: item.lastTransactionDate ? new Date(item.lastTransactionDate).toLocaleDateString() : '--',
            stores: [] // Track which stores have this product
          };
        }
        
        // Aggregate quantities and values
        productAggregation[productId].totalQuantity += quantity;
        productAggregation[productId].totalValue += quantity * unitCost;
        productAggregation[productId].storeCount += 1;
        
        // Track store information
        if (item.store?.name) {
          productAggregation[productId].stores.push({
            name: item.store.name,
            location: item.store.location || '--',
            quantity: quantity
          });
        }
        
        // Update last transaction date if this transaction is more recent
        if (item.lastTransactionDate) {
          const currentDate = new Date(item.lastTransactionDate);
          const existingDate = new Date(productAggregation[productId].lastUpdated);
          if (currentDate > existingDate) {
            productAggregation[productId].lastUpdated = currentDate.toLocaleDateString();
          }
        }
      });
    
    // Calculate average unit cost and transform to final format
    const transformedData = Object.values(productAggregation)
      .map(product => {
        // Calculate weighted average unit cost
        const averageUnitCost = product.totalQuantity > 0 ? product.totalValue / product.totalQuantity : 0;
        
        return {
          id: product.id,
          productCode: product.productCode,
          productName: product.productName,
          partNumber: product.partNumber,
          category: product.category,
          brandName: product.brandName,
          manufacturer: product.manufacturer,
          model: product.model,
          color: product.color,
          storeLocation: product.stores.length > 0 ? product.stores[0].location : '--', // Use first store's location
          quantity: product.totalQuantity,
          unitCost: averageUnitCost,
          totalValue: product.totalValue,
          lastUpdated: product.lastUpdated,
          storeCount: product.storeCount // Additional info about how many stores have this product
        };
      })
      .sort((a, b) => {
        // Sort by product code
        return a.productCode.localeCompare(b.productCode);
      });

    res.json({
      success: true,
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    // Error fetching stock balance data
    res.status(500).json({
      success: false,
      message: 'Error fetching stock balance data',
      error: error.message
    });
  }
});

// PDF Export Endpoints

// Test endpoint to verify Puppeteer is working
router.get('/test-pdf', async (req, res) => {
  let browser;
  try {
    // Testing Puppeteer...
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          p { margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>EasyMauzo PDF Test</h1>
        <p>This is a test PDF to verify Puppeteer is working correctly.</p>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        <p>If you can read this, the PDF generation is working!</p>
      </body>
      </html>
    `;
    
    await page.setContent(testHtml, { waitUntil: 'networkidle0' });
    
    const pdf = await page.pdf({
      format: 'A4',
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      printBackground: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="test.pdf"');
    res.send(pdf);
    
    // Puppeteer test successful, PDF size
  } catch (error) {
    // Puppeteer test failed
    res.status(500).json({
      success: false,
      message: 'Puppeteer test failed',
      error: error.message,
      stack: error.stack
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// GET /api/store-requests/pdf/test-simple - Test simple PDF generation with html-pdf-node
router.get('/pdf/test-simple', async (req, res) => {
  try {
    // Testing simple PDF generation with html-pdf-node...
    
    const simpleHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Test PDF</title>
      </head>
      <body style="font-family: Arial, sans-serif; margin: 20px;">
        <h1>Test PDF Generation</h1>
        <p>This is a simple test PDF to verify html-pdf-node is working correctly.</p>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        <table style="border-collapse: collapse; width: 100%;">
          <tr>
            <th style="border: 1px solid black; padding: 8px;">Column 1</th>
            <th style="border: 1px solid black; padding: 8px;">Column 2</th>
            <th style="border: 1px solid black; padding: 8px;">Column 3</th>
          </tr>
          <tr>
            <td style="border: 1px solid black; padding: 8px;">Test Data 1</td>
            <td style="border: 1px solid black; padding: 8px;">Test Data 2</td>
            <td style="border: 1px solid black; padding: 8px;">Test Data 3</td>
          </tr>
        </table>
      </body>
      </html>
    `;
    
    const options = {
      format: 'A4',
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      }
    };
    
    const pdfBuffer = await pdf.generatePdf({ content: simpleHTML }, options);
    
    // Simple PDF generated with html-pdf-node, size
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="test-simple.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
    
  } catch (error) {
    // Error generating simple test PDF with html-pdf-node
    res.status(500).json({ success: false, message: 'Error generating test PDF', error: error.message });
  }
});

// POST /api/store-requests/export-current-stock-balance-pdf - Export current stock balance as PDF
router.post('/export-current-stock-balance-pdf', csrfProtection, async (req, res) => {
  let browser;
  try {
    // Starting PDF export for current stock balance...
    const filters = req.body.filters || {};
    const searchTerm = req.body.searchTerm || '';
    
    // Filters received
    // Search term
    
    // Get the same data as the current stock balance endpoint
    const {
      storeId,
      storeLocationIds,
      categoryIds,
      brandNameIds,
      manufacturerIds,
      modelIds,
      colorIds
    } = filters;

    // Building where clauses...
    const productStoreWhereClause = {};
    const productWhereClause = {};
    const storeWhereClause = {};

    if (storeId) {
      productStoreWhereClause.store_id = storeId;
    }

    if (storeLocationIds && storeLocationIds.length > 0) {
      const locationIds = Array.isArray(storeLocationIds) ? storeLocationIds : storeLocationIds.split(',');
      storeWhereClause.location = {
        [require('sequelize').Op.in]: locationIds
      };
    }

    if (categoryIds && categoryIds.length > 0) {
      const catIds = Array.isArray(categoryIds) ? categoryIds : categoryIds.split(',');
      productWhereClause.category_id = {
        [require('sequelize').Op.in]: catIds
      };
    }

    if (brandNameIds && brandNameIds.length > 0) {
      const brandIds = Array.isArray(brandNameIds) ? brandNameIds : brandNameIds.split(',');
      productWhereClause.brand_name_id = {
        [require('sequelize').Op.in]: brandIds
      };
    }

    if (manufacturerIds && manufacturerIds.length > 0) {
      const manIds = Array.isArray(manufacturerIds) ? manufacturerIds : manufacturerIds.split(',');
      productWhereClause.manufacturer_id = {
        [require('sequelize').Op.in]: manIds
      };
    }

    if (modelIds && modelIds.length > 0) {
      const modIds = Array.isArray(modelIds) ? modelIds : modelIds.split(',');
      productWhereClause.model_id = {
        [require('sequelize').Op.in]: modIds
      };
    }

    if (colorIds && colorIds.length > 0) {
      const colIds = Array.isArray(colorIds) ? colorIds : colorIds.split(',');
      productWhereClause.color_id = {
        [require('sequelize').Op.in]: colIds
      };
    }

    // Build final where clause with company filter for ProductStore
    const finalProductStoreWhere = buildCompanyWhere(req, productStoreWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalProductStoreWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Product with company filter
    const finalProductWhere = buildCompanyWhere(req, productWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalProductWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Store with company filter
    const finalStoreWhere = buildCompanyWhere(req, storeWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalStoreWhere.companyId = req.user.companyId;
    }

    // Fetching stock balance data...
    // Get stock balance data
    const stockBalanceData = await ProductStore.findAll({
      where: finalProductStoreWhere,
      include: [
        {
          model: Product,
          as: 'product',
          where: finalProductWhere,
          required: true,
          include: [
            {
              model: ProductCategory,
              as: 'category',
              attributes: ['id', 'name']
            },
            {
              model: ProductBrandName,
              as: 'brand',
              attributes: ['id', 'name']
            },
            {
              model: ProductManufacturer,
              as: 'manufacturer',
              attributes: ['id', 'name']
            },
            {
              model: ProductModel,
              as: 'model',
              attributes: ['id', 'name']
            },
            {
              model: ProductColor,
              as: 'color',
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: Store,
          as: 'store',
          where: finalStoreWhere,
          required: false,
          attributes: ['id', 'name', 'location']
        }
      ],
      order: [
        ['store', 'name', 'ASC'],
        ['product', 'code', 'ASC']
      ]
    });

    // Stock balance data fetched

    const productAggregation = {};
    
    stockBalanceData.forEach(item => {
      const productId = item.product_id;
      const quantity = parseFloat(item.quantity) || 0;
      const unitCost = parseFloat(item.product?.average_cost) || 0;
      
      if (!productAggregation[productId]) {
        // Initialize product aggregation
        productAggregation[productId] = {
          id: productId,
          productCode: item.product?.code || '--',
          productName: item.product?.name || '--',
          partNumber: item.product?.part_number || '--',
          category: item.product?.category?.name || '--',
          brandName: item.product?.brand?.name || '--',
          manufacturer: item.product?.manufacturer?.name || '--',
          model: item.product?.model?.name || '--',
          color: item.product?.color?.name || '--',
          totalQuantity: 0,
          totalValue: 0,
          averageUnitCost: 0,
          storeCount: 0,
          lastUpdated: item.last_updated ? new Date(item.last_updated).toLocaleDateString() : '--',
          stores: [] // Track which stores have this product
        };
      }
      
      // Aggregate quantities and values
      productAggregation[productId].totalQuantity += quantity;
      productAggregation[productId].totalValue += quantity * unitCost;
      productAggregation[productId].storeCount += 1;
      
      // Track store information
      if (item.store?.name) {
        productAggregation[productId].stores.push({
          name: item.store.name,
          location: item.store.location || '--',
          quantity: quantity
        });
      }
    });
    
    // Calculate average unit cost and transform to final format
    const transformedData = Object.values(productAggregation)
      .map(product => {
        // Calculate weighted average unit cost
        const averageUnitCost = product.totalQuantity > 0 ? product.totalValue / product.totalQuantity : 0;
        
        return {
          id: product.id,
          productCode: product.productCode,
          productName: product.productName,
          partNumber: product.partNumber,
          category: product.category,
          brandName: product.brandName,
          manufacturer: product.manufacturer,
          model: product.model,
          color: product.color,
          storeLocation: product.stores.length > 0 ? product.stores[0].location : '--', // Use first store's location
          quantity: product.totalQuantity,
          unitCost: averageUnitCost,
          totalValue: product.totalValue,
          lastUpdated: product.lastUpdated,
          storeCount: product.storeCount // Additional info about how many stores have this product
        };
      })
      .sort((a, b) => {
        // Sort by product code
        return a.productCode.localeCompare(b.productCode);
      });

    // Data transformed

    // Apply search filter if provided
    let filteredData = transformedData;
    if (searchTerm && searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filteredData = transformedData.filter(item => 
        item.productCode.toLowerCase().includes(searchLower) ||
        item.productName.toLowerCase().includes(searchLower) ||
        item.category.toLowerCase().includes(searchLower) ||
        item.brandName.toLowerCase().includes(searchLower) ||
        item.manufacturer.toLowerCase().includes(searchLower) ||
        item.model.toLowerCase().includes(searchLower) ||
        item.color.toLowerCase().includes(searchLower) ||
        item.storeName.toLowerCase().includes(searchLower) ||
        item.storeLocation.toLowerCase().includes(searchLower)
      );
    }

    // Data filtered

    // Generate HTML for PDF
    // Generating HTML...
    // Sample data item
    const html = generateStockBalancePDFHTML(filteredData, filters, 'current');
    // HTML generated, length

    // Launch Puppeteer and generate PDF
    // Launching Puppeteer...
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    // Creating new page...
    const page = await browser.newPage();
    // Setting content...
    await page.setContent(html, { 
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    // Wait a bit more to ensure content is fully rendered
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    const pdf = await page.pdf({
      format: 'A4',
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      printBackground: false,
      displayHeaderFooter: false,
      preferCSSPageSize: false
    });

    // PDF generated, size

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="stock-balance-report-${new Date().toISOString().split('T')[0]}.pdf"`);
    res.setHeader('Content-Length', pdf.length);

    res.send(pdf);
    // PDF sent to client

  } catch (error) {
    // Error generating current stock balance PDF
    // Error stack
    res.status(500).json({
      success: false,
      message: 'Error generating PDF',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// POST /api/store-requests/export-stock-balance-as-of-date-pdf - Export historical stock balance as PDF
router.post('/export-stock-balance-as-of-date-pdf', csrfProtection, async (req, res) => {
  let browser;
  try {
    const filters = req.body.filters || {};
    const searchTerm = req.body.searchTerm || '';
    
    // Get the same data as the historical stock balance endpoint
    const {
      asOfDate,
      storeId,
      storeLocationIds,
      categoryIds,
      brandNameIds,
      manufacturerIds,
      modelIds,
      colorIds
    } = filters;

    const transactionWhereClause = {};
    const productWhereClause = {};
    const storeWhereClause = {};

    if (asOfDate) {
      transactionWhereClause.transaction_date = {
        [require('sequelize').Op.lte]: new Date(asOfDate)
      };
    }

    if (storeId) {
      transactionWhereClause.store_id = storeId;
    }

    if (storeLocationIds && storeLocationIds.length > 0) {
      const locationIds = Array.isArray(storeLocationIds) ? storeLocationIds : storeLocationIds.split(',');
      storeWhereClause.location = {
        [require('sequelize').Op.in]: locationIds
      };
    }

    if (categoryIds && categoryIds.length > 0) {
      const catIds = Array.isArray(categoryIds) ? categoryIds : categoryIds.split(',');
      productWhereClause.category_id = {
        [require('sequelize').Op.in]: catIds
      };
    }

    if (brandNameIds && brandNameIds.length > 0) {
      const brandIds = Array.isArray(brandNameIds) ? brandNameIds : brandNameIds.split(',');
      productWhereClause.brand_name_id = {
        [require('sequelize').Op.in]: brandIds
      };
    }

    if (manufacturerIds && manufacturerIds.length > 0) {
      const manIds = Array.isArray(manufacturerIds) ? manufacturerIds : manufacturerIds.split(',');
      productWhereClause.manufacturer_id = {
        [require('sequelize').Op.in]: manIds
      };
    }

    if (modelIds && modelIds.length > 0) {
      const modIds = Array.isArray(modelIds) ? modelIds : modelIds.split(',');
      productWhereClause.model_id = {
        [require('sequelize').Op.in]: modIds
      };
    }

    if (colorIds && colorIds.length > 0) {
      const colIds = Array.isArray(colorIds) ? colorIds : colorIds.split(',');
      productWhereClause.color_id = {
        [require('sequelize').Op.in]: colIds
      };
    }

    // Get ProductTransaction model
    const { ProductTransaction } = require('../models');

    // Build final where clause with company filter for ProductTransaction
    const finalTransactionWhere = buildCompanyWhere(req, transactionWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalTransactionWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Product with company filter
    const finalProductWhere = buildCompanyWhere(req, productWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalProductWhere.companyId = req.user.companyId;
    }

    // Build final where clause for Store with company filter
    const finalStoreWhere = buildCompanyWhere(req, storeWhereClause);
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalStoreWhere.companyId = req.user.companyId;
    }

    // Get stock balance data using transactions for historical accuracy
    const stockBalanceData = await ProductTransaction.findAll({
      where: finalTransactionWhere,
      include: [
        {
          model: Product,
          as: 'product',
          where: finalProductWhere,
          required: true,
          include: [
            {
              model: ProductCategory,
              as: 'category',
              attributes: ['id', 'name']
            },
            {
              model: ProductBrandName,
              as: 'brand',
              attributes: ['id', 'name']
            },
            {
              model: ProductManufacturer,
              as: 'manufacturer',
              attributes: ['id', 'name']
            },
            {
              model: ProductModel,
              as: 'model',
              attributes: ['id', 'name']
            },
            {
              model: ProductColor,
              as: 'color',
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: Store,
          as: 'store',
          where: finalStoreWhere,
          required: false,
          attributes: ['id', 'name', 'location']
        }
      ],
      order: [
        ['store', 'name', 'ASC'],
        ['product', 'code', 'ASC'],
        ['transaction_date', 'ASC']
      ]
    });

    // Group transactions by product and store to calculate stock balance
    const stockBalanceMap = new Map();

    stockBalanceData.forEach(transaction => {
      const key = `${transaction.product_id}-${transaction.store_id}`;
      
      if (!stockBalanceMap.has(key)) {
        stockBalanceMap.set(key, {
          product_id: transaction.product_id,
          store_id: transaction.store_id,
          quantity: 0,
          totalValue: 0,
          totalQuantityIn: 0,
          lastTransactionDate: transaction.transaction_date,
          product: transaction.product,
          store: transaction.store
        });
      }

      const stockItem = stockBalanceMap.get(key);
      
      // Calculate quantity based on transaction type
      if (transaction.transaction_type === 'in') {
        stockItem.quantity += transaction.quantity;
      } else if (transaction.transaction_type === 'out') {
        stockItem.quantity -= transaction.quantity;
      }

      // Calculate average cost and total value
      if (transaction.transaction_type === 'in') {
        const quantityIn = transaction.quantity;
        const unitCost = parseFloat(transaction.product?.average_cost) || 0;
        const currentTotalValue = stockItem.totalValue;
        const currentTotalQuantity = stockItem.totalQuantityIn;
        const newTotalValue = currentTotalValue + (quantityIn * unitCost);
        const newTotalQuantity = currentTotalQuantity + quantityIn;
        
        stockItem.totalValue = newTotalValue;
        stockItem.totalQuantityIn = newTotalQuantity;
      }
      
      // Update last transaction date if this transaction is more recent
      if (new Date(transaction.transaction_date) > new Date(stockItem.lastTransactionDate)) {
        stockItem.lastTransactionDate = transaction.transaction_date;
      }
    });

    const productAggregation = {};
    
    Array.from(stockBalanceMap.values())
      .filter(item => item.quantity > 0) // Only include items with positive stock
      .forEach(item => {
        const productId = item.product_id;
        const quantity = item.quantity;
        const unitCost = item.totalQuantityIn > 0 ? item.totalValue / item.totalQuantityIn : 0;
        
        if (!productAggregation[productId]) {
          // Initialize product aggregation
          productAggregation[productId] = {
            id: productId,
            productCode: item.product?.code || '--',
            productName: item.product?.name || '--',
            partNumber: item.product?.part_number || '--',
            category: item.product?.category?.name || '--',
            brandName: item.product?.brand?.name || '--',
            manufacturer: item.product?.manufacturer?.name || '--',
            model: item.product?.model?.name || '--',
            color: item.product?.color?.name || '--',
            totalQuantity: 0,
            totalValue: 0,
            averageUnitCost: 0,
            storeCount: 0,
            lastUpdated: item.lastTransactionDate ? new Date(item.lastTransactionDate).toLocaleDateString() : '--',
            stores: [] // Track which stores have this product
          };
        }
        
        // Aggregate quantities and values
        productAggregation[productId].totalQuantity += quantity;
        productAggregation[productId].totalValue += quantity * unitCost;
        productAggregation[productId].storeCount += 1;
        
        // Track store information
        if (item.store?.name) {
          productAggregation[productId].stores.push({
            name: item.store.name,
            location: item.store.location || '--',
            quantity: quantity
          });
        }
        
        // Update last transaction date if this transaction is more recent
        if (item.lastTransactionDate) {
          const currentDate = new Date(item.lastTransactionDate);
          const existingDate = new Date(productAggregation[productId].lastUpdated);
          if (currentDate > existingDate) {
            productAggregation[productId].lastUpdated = currentDate.toLocaleDateString();
          }
        }
      });
    
    // Calculate average unit cost and transform to final format
    const transformedData = Object.values(productAggregation)
      .map(product => {
        // Calculate weighted average unit cost
        const averageUnitCost = product.totalQuantity > 0 ? product.totalValue / product.totalQuantity : 0;
        
        return {
          id: product.id,
          productCode: product.productCode,
          productName: product.productName,
          partNumber: product.partNumber,
          category: product.category,
          brandName: product.brandName,
          manufacturer: product.manufacturer,
          model: product.model,
          color: product.color,
          storeLocation: product.stores.length > 0 ? product.stores[0].location : '--', // Use first store's location
          quantity: product.totalQuantity,
          unitCost: averageUnitCost,
          totalValue: product.totalValue,
          lastUpdated: product.lastUpdated,
          storeCount: product.storeCount // Additional info about how many stores have this product
        };
      })
      .sort((a, b) => {
        // Sort by product code
        return a.productCode.localeCompare(b.productCode);
      });

    // Apply search filter if provided
    let filteredData = transformedData;
    if (searchTerm && searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filteredData = transformedData.filter(item => 
        item.productCode.toLowerCase().includes(searchLower) ||
        item.productName.toLowerCase().includes(searchLower) ||
        item.category.toLowerCase().includes(searchLower) ||
        item.brandName.toLowerCase().includes(searchLower) ||
        item.manufacturer.toLowerCase().includes(searchLower) ||
        item.model.toLowerCase().includes(searchLower) ||
        item.color.toLowerCase().includes(searchLower) ||
        item.storeName.toLowerCase().includes(searchLower) ||
        item.storeLocation.toLowerCase().includes(searchLower)
      );
    }

    // Generate HTML for PDF
    // Generating HTML for historical report...
    // Sample data item (historical)
    const html = generateStockBalancePDFHTML(filteredData, filters, 'historical');

    // Launch Puppeteer and generate PDF
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdf = await page.pdf({
      format: 'A4',
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      printBackground: true,
      displayHeaderFooter: true
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="stock-balance-as-of-date-report-${new Date().toISOString().split('T')[0]}.pdf"`);
    res.setHeader('Content-Length', pdf.length);

    res.send(pdf);

  } catch (error) {
    // Error generating historical stock balance PDF
    // Error stack
    res.status(500).json({
      success: false,
      message: 'Error generating PDF',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// GET /api/store-requests/:id - Get specific store request
router.get('/:id', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    // Then get the items separately with full product details
    const items = await StoreRequestItem.findAll({
      where: { store_request_id: req.params.id },
      attributes: [
        'id', 'store_request_id', 'product_id', 'requested_quantity', 'available_quantity',
        'approved_quantity', 'fulfilled_quantity', 'issued_quantity', 'remaining_quantity',
        'unit_cost', 'total_cost', 'currency_id', 'exchange_rate', 'equivalent_amount',
        'status', 'rejection_reason', 'notes', 'batch_number', 'expiry_date', 'serial_numbers',
        'fulfilled_at', 'fulfilled_by', 'created_by', 'updated_by', 'createdAt', 'updatedAt'
      ],
      include: [
        { 
          model: Product, 
          as: 'storeRequestProduct', 
          attributes: [
            'id', 'name', 'code', 'part_number', 'average_cost',
            'brand_id', 'color_id', 'manufacturer_id', 'category_id', 'model_id', 'unit_id'
          ],
          include: [
            { model: require('../models').ProductBrandName, as: 'brand', attributes: ['id', 'name'] },
            { model: require('../models').ProductColor, as: 'color', attributes: ['id', 'name'] },
            { model: require('../models').ProductManufacturer, as: 'manufacturer', attributes: ['id', 'name'] },
            { model: require('../models').ProductCategory, as: 'category', attributes: ['id', 'name'] },
            { model: require('../models').ProductModel, as: 'model', attributes: ['id', 'name'] },
            { model: require('../models').Packaging, as: 'unit', attributes: ['id', 'name'] }
          ]
        },
        { model: User, as: 'createdByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'fulfilledByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'first_name', 'last_name'] }
      ]
    });
    
    // Get stores separately
    const requestingStore = await Store.findByPk(storeRequest.requested_by_store_id, {
      attributes: ['id', 'name']
    });
    
    const issuingStore = await Store.findByPk(storeRequest.requested_from_store_id, {
      attributes: ['id', 'name']
    });
    
    // Get currency separately
    const currency = await Currency.findByPk(storeRequest.currency_id, {
      attributes: ['id', 'name', 'symbol']
    });
    
    // Get all user relationships separately
    const createdByUser = await User.findByPk(storeRequest.created_by, {
      attributes: ['id', 'first_name', 'last_name']
    });
    
    const submittedByUser = storeRequest.submitted_by ? await User.findByPk(storeRequest.submitted_by, {
      attributes: ['id', 'first_name', 'last_name']
    }) : null;
    
    const approvedByUser = storeRequest.approved_by ? await User.findByPk(storeRequest.approved_by, {
      attributes: ['id', 'first_name', 'last_name']
    }) : null;
    
    const rejectedByUser = storeRequest.rejected_by ? await User.findByPk(storeRequest.rejected_by, {
      attributes: ['id', 'first_name', 'last_name']
    }) : null;
    
    const fulfilledByUser = storeRequest.fulfilled_by ? await User.findByPk(storeRequest.fulfilled_by, {
      attributes: ['id', 'first_name', 'last_name']
    }) : null;
    
    const updatedByUser = storeRequest.updated_by ? await User.findByPk(storeRequest.updated_by, {
      attributes: ['id', 'first_name', 'last_name']
    }) : null;
    
    // Combine the data
    const result = {
      ...storeRequest.toJSON(),
      requestingStore,
      issuingStore,
      storeRequestCurrency: currency,
      createdByUser,
      submittedByUser,
      approvedByUser,
      rejectedByUser,
      fulfilledByUser,
      updatedByUser,
      storeRequestItems: items
    };
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch store request' });
  }
});

// POST /api/store-requests - Create new store request
router.post('/', csrfProtection, async (req, res) => {
  try {
    const {
      requesting_store_id,
      requested_from_store_id,
      request_type = 'request',
      priority = 'medium',
      expected_delivery_date,
      notes,
      currency_id,
      exchange_rate = 1.0,
      items = []
    } = req.body;
    
    // Validate and format expected_delivery_date
    let formattedExpectedDate = null;
    if (expected_delivery_date && expected_delivery_date !== '' && expected_delivery_date !== 'Invalid date') {
      const date = new Date(expected_delivery_date);
      if (!isNaN(date.getTime())) {
        formattedExpectedDate = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      }
    }
    
    // Generate reference number
    const reference_number = await generateReferenceNumber(req);
    
    // Calculate totals
    const total_items = items.length;
    const total_value = items.reduce((sum, item) => sum + (parseFloat(item.requested_quantity || 0) * parseFloat(item.unit_cost || 0)), 0);
    
    // Create store request
    const storeRequest = await StoreRequest.create({
      reference_number,
      request_date: new Date(),
      requested_by_store_id: requesting_store_id,
      requested_from_store_id: requested_from_store_id,
      request_type,
      companyId: req.user.companyId,
      priority,
      expected_delivery_date: formattedExpectedDate,
      notes,
      total_items,
      total_value,
      currency_id,
      exchange_rate,
      created_by: req.user.id,
      updated_by: req.user.id
    });
    
    // Create store request items
    const createdItems = [];
    for (const item of items) {
      const totalCost = item.requested_quantity * item.unit_cost;
      const exchangeRate = item.exchange_rate || exchange_rate;
      const equivalentAmount = totalCost * exchangeRate;

      const storeRequestItem = await StoreRequestItem.create({
        store_request_id: storeRequest.id,
        product_id: item.product_id,
        requested_quantity: item.requested_quantity,
        unit_cost: item.unit_cost,
        total_cost: totalCost,
        currency_id: item.currency_id || currency_id,
        exchange_rate: exchangeRate,
        equivalent_amount: equivalentAmount,
        notes: item.notes,
        created_by: req.user.id,
        updated_by: req.user.id,
        companyId: req.user.companyId // Add companyId for multi-tenant isolation
      });
      
      await logQuantityChange(storeRequestItem.id, 'requested', item.requested_quantity, req.user.id, 'Initial request', null, null, req.user.companyId);
      
      createdItems.push(storeRequestItem);
    }
    
    // Fetch the created store request with all associations
    const createdStoreRequest = await StoreRequest.findByPk(storeRequest.id, {
      include: [
        { model: Store, as: 'requestingStore', attributes: ['id', 'name'] },
        { model: Store, as: 'issuingStore', attributes: ['id', 'name'] },
        { model: Currency, as: 'storeRequestCurrency', attributes: ['id', 'name', 'symbol'] },
        {
          model: StoreRequestItem,
          as: 'storeRequestItems',
          include: [
            { model: Product, as: 'storeRequestProduct', attributes: ['id', 'name', 'code'] }
          ]
        }
      ]
    });
    
    res.status(201).json({ success: true, data: createdStoreRequest });
  } catch (error) {
    if (error.name === 'SequelizeValidationError') {
      const errors = error.errors.map(e => ({
        field: e.path,
        message: e.message
      }));
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        errors: errors.map(e => e.message),
        errorDetails: errors
      });
    }
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        error: 'A store request with this information already exists'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create store request',
      message: error.message || 'Unknown error occurred'
    });
  }
});

// PUT /api/store-requests/:id - Update store request
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere });
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    // Check if request can be updated (only draft status)
    if (storeRequest.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Only draft requests can be updated' });
    }
    
    const {
      requesting_store_id,
      requested_from_store_id,
      request_type,
      priority,
      expected_delivery_date,
      notes,
      currency_id,
      exchange_rate,
      status,
      items = []
    } = req.body;
    
    // Validate and format expected_delivery_date
    let formattedExpectedDate = null;
    if (expected_delivery_date && expected_delivery_date !== '' && expected_delivery_date !== 'Invalid date') {
      const date = new Date(expected_delivery_date);
      if (!isNaN(date.getTime())) {
        formattedExpectedDate = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      }
    }
    
    // Prepare update data
    const updateData = {
      requested_by_store_id: requesting_store_id,
      requested_from_store_id: requested_from_store_id,
      request_type,
      priority,
      expected_delivery_date: formattedExpectedDate,
      notes,
      currency_id,
      exchange_rate,
      updated_by: req.user.id
    };

    // If status is being changed to 'submitted', add submission details
    if (status === 'submitted') {
      updateData.status = 'submitted';
      updateData.submitted_at = new Date();
      updateData.submitted_by = req.user.id;
    }

    // Update store request
    await storeRequest.update(updateData);
    
    // Update items (delete existing and create new ones)
    await StoreRequestItem.destroy({ where: { store_request_id: storeRequest.id } });
    
    const createdItems = [];
    for (const item of items) {
      const totalCost = item.requested_quantity * item.unit_cost;
      const exchangeRate = item.exchange_rate || exchange_rate;
      const equivalentAmount = totalCost * exchangeRate;

      const storeRequestItem = await StoreRequestItem.create({
        store_request_id: storeRequest.id,
        product_id: item.product_id,
        requested_quantity: item.requested_quantity,
        unit_cost: item.unit_cost,
        total_cost: totalCost,
        currency_id: item.currency_id || currency_id,
        exchange_rate: exchangeRate,
        equivalent_amount: equivalentAmount,
        notes: item.notes,
        created_by: req.user.id,
        updated_by: req.user.id,
        companyId: req.user.companyId // Add companyId for multi-tenant isolation
      });
      
      createdItems.push(storeRequestItem);
    }
    
    // Recalculate totals
    const total_items = createdItems.length;
    const total_value = createdItems.reduce((sum, item) => sum + parseFloat(item.total_cost || 0), 0);
    
    await storeRequest.update({
      total_items,
      total_value
    });
    
    res.json({ success: true, data: storeRequest });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update store request' });
  }
});

// DELETE /api/store-requests/:id - Delete store request
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere });
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    // Check if request can be deleted (only draft status)
    if (storeRequest.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Only draft requests can be deleted' });
    }
    
    await storeRequest.destroy();
    res.json({ success: true, message: 'Store request deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete store request' });
  }
});

// PATCH /api/store-requests/:id/submit - Submit for approval
router.patch('/:id/submit', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere });
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    if (storeRequest.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Only draft requests can be submitted' });
    }
    
    await storeRequest.update({
      status: 'submitted',
      submitted_at: new Date(),
      submitted_by: req.user.id,
      updated_by: req.user.id
    });
    
    res.json({ success: true, data: storeRequest });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to submit store request' });
  }
});

// PATCH /api/store-requests/:id/reject - Reject request
router.patch('/:id/reject', async (req, res) => {
  try {
    const { rejection_reason } = req.body;
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere });
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    if (storeRequest.status !== 'submitted') {
      return res.status(400).json({ success: false, error: 'Only submitted requests can be rejected' });
    }
    
    await storeRequest.update({
      status: 'rejected',
      rejected_at: new Date(),
      rejected_by: req.user.id,
      rejection_reason,
      updated_by: req.user.id
    });
    
    res.json({ success: true, data: storeRequest });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject store request' });
  }
});

// PATCH /api/store-requests/:id/fulfill - Mark as fulfilled
router.patch('/:id/fulfill', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere });
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    if (storeRequest.status !== 'approved') {
      return res.status(400).json({ success: false, error: 'Only approved requests can be fulfilled' });
    }
    
    await storeRequest.update({
      status: 'fulfilled',
      fulfilled_at: new Date(),
      fulfilled_by: req.user.id,
      updated_by: req.user.id
    });
    
    res.json({ success: true, data: storeRequest });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fulfill store request' });
  }
});

// PATCH /api/store-requests/:id/issue - Issue stock (from issuer form)
router.patch('/:id/issue', async (req, res) => {
  const transaction = await StoreRequest.sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { items = [], notes } = req.body;
    
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [{ model: StoreRequestItem, as: 'storeRequestItems' }],
      transaction
    });
    
    if (!storeRequest) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    if (!['approved', 'partial_issued', 'partially_received'].includes(storeRequest.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'Only approved, partially issued, or partially received requests can be issued' });
    }
    
    // Track if this is a partial issue
    let isPartialIssue = false;
    let totalRequestedQuantity = 0;
    let totalIssuedQuantity = 0;
    
    // Get current financial year for ProductTransaction records
    const currentFinancialYear = await FinancialYear.findOne({
      where: {
        isCurrent: true,
        isActive: true,
        companyId: req.user.companyId // Add company filter for multi-tenant isolation
      },
      transaction
    });
    
    if (!currentFinancialYear) {
      await transaction.rollback();
      return res.status(400).json({ error: 'No active financial year found' });
    }

    // Get system default currency
    const systemDefaultCurrency = await Currency.findOne({ 
      where: { 
        is_default: true,
        companyId: req.user.companyId // Add company filter for multi-tenant isolation
      },
      transaction 
    });
    
    if (!systemDefaultCurrency) {
      await transaction.rollback();
      return res.status(400).json({ error: 'No system default currency found' });
    }

    // Update each item with issuing quantity
    for (const itemData of items) {
      const item = storeRequest.storeRequestItems.find(i => i.id === itemData.id);
      if (!item) continue;
      
      const approvedQuantity = parseFloat(item.approved_quantity || 0);
      const issuingQuantity = parseFloat(itemData.issuing_quantity || 0);
      const remainingQuantity = parseFloat(item.remaining_quantity || 0);
      
      // Validate that issuing quantity doesn't exceed remaining quantity
      if (issuingQuantity > remainingQuantity) {
        await transaction.rollback();
        return res.status(400).json({ 
          success: false, 
          error: `Cannot issue ${issuingQuantity} units. Only ${remainingQuantity} units remaining for item ${item.id}` 
        });
      }
      
      totalRequestedQuantity += approvedQuantity;
      totalIssuedQuantity += issuingQuantity;
      
      // Always update the item, even with 0 quantity (for tracking purposes)
      // Determine item status based on quantity issued
      let itemStatus;
      if (issuingQuantity === 0) {
        itemStatus = 'partial_issued'; // 0 quantity means partial issue (no stock available)
      } else if (issuingQuantity >= approvedQuantity) {
        itemStatus = 'fulfilled';
      } else {
        itemStatus = 'partial_issued';
      }
      
      // Calculate new issued quantity (cumulative)
      const newIssuedQuantity = (item.issued_quantity || 0) + issuingQuantity;
      
      // Calculate new remaining quantity
      const newRemainingQuantity = Math.max(0, approvedQuantity - newIssuedQuantity);

      // Calculate new remaining receiving quantity (add to existing)
      const currentRemainingReceivingQty = parseInt(item.remaining_receiving_quantity || 0);
      const newRemainingReceivingQty = currentRemainingReceivingQty + issuingQuantity;

      // Update the item with fulfilled quantity, issued quantity, and remaining quantities
      await item.update({
        fulfilled_quantity: issuingQuantity,
        issued_quantity: newIssuedQuantity,
        remaining_quantity: newRemainingQuantity,
        remaining_receiving_quantity: newRemainingReceivingQty, // Add to existing remaining receiving quantity
        status: itemStatus,
        fulfilled_at: new Date(),
        fulfilled_by: req.user.id,
        notes: itemData.notes || notes,
        updated_by: req.user.id
      }, { transaction });
    
      await logQuantityChange(item.id, 'fulfilled', issuingQuantity, req.user.id, notes || 'Issued from issuer form', null, transaction, req.user.companyId);
      
      // Update inventory if issuing quantity > 0
      if (issuingQuantity > 0) {
        // Find the issuing store's inventory for this product WITH ROW LOCK
        // Use SELECT FOR UPDATE to prevent race conditions
        const productStore = await ProductStore.findOne({
          where: {
            product_id: item.product_id,
            store_id: storeRequest.requested_from_store_id,
            is_active: true,
            companyId: req.user.companyId // Add company filter for multi-tenant isolation
          },
          lock: transaction.LOCK.UPDATE, // Lock the row to prevent concurrent updates
          transaction
        });
        
        if (productStore) {
          // Check if issuing store has enough stock (read locked quantity)
          const currentQuantity = parseFloat(productStore.quantity || 0);
          if (currentQuantity < issuingQuantity) {
            await transaction.rollback();
            return res.status(400).json({ 
              success: false, 
              error: `Insufficient stock. Only ${currentQuantity} units available in issuing store for product ${item.product_id}` 
            });
          }
          
          // Use decrement to avoid race conditions (atomic operation)
          await productStore.decrement('quantity', { by: issuingQuantity, transaction });
          await productStore.update({
            last_updated: new Date()
          }, { transaction });
          
          // Fetch product to get product_type
          const Product = require('../models/product');
          const product = await Product.findByPk(item.product_id, { transaction });
          
          // Create product transaction record
          await ProductTransaction.create({
            uuid: require('crypto').randomUUID(),
            system_date: new Date(),
            transaction_date: new Date(),
            financial_year_id: currentFinancialYear.id,
            financial_year_name: currentFinancialYear.name,
            transaction_type_id: 'fce10dfd-2c96-4005-acd1-9f4bac8d1e59', // Store Issue transaction type ID
            transaction_type_name: 'Store Issue',
            store_id: storeRequest.requested_from_store_id,
            product_id: item.product_id,
            product_type: product?.product_type || null,
            created_by_id: req.user.id,
            updated_by_id: req.user.id,
            quantity_out: issuingQuantity,
            reference_number: storeRequest.reference_number,
            reference_type: 'STORE_REQUEST',
            notes: `Issued from store request ${storeRequest.reference_number}`,
            is_active: true,
            // Cost and currency fields
            exchange_rate: item.exchange_rate || 1.0,
            currency_id: item.currency_id || storeRequest.currency_id,
            system_currency_id: systemDefaultCurrency.id,
            product_average_cost: item.unit_cost || 0,
            user_unit_cost: item.unit_cost || 0,
            equivalent_amount: (item.unit_cost || 0) * (item.exchange_rate || 1.0),
            companyId: req.user.companyId // Add companyId for multi-tenant isolation
          }, { transaction });
        } else {
          await transaction.rollback();
          return res.status(400).json({ 
            success: false, 
            error: `Product not found in issuing store inventory for product ${item.product_id}` 
          });
        }
      }
      
      // Check if this item is partially issued
      if (issuingQuantity < approvedQuantity) {
        isPartialIssue = true;
      }
    }
    
    // Check if all items are fully fulfilled
    const allItemsFulfilled = storeRequest.storeRequestItems.every(item => {
      const approvedQuantity = parseFloat(item.approved_quantity || 0);
      const issuedQuantity = parseFloat(item.issued_quantity || 0);
      return issuedQuantity >= approvedQuantity;
    });
    
    // Determine overall request status
    const overallStatus = allItemsFulfilled ? 'fulfilled' : 'partial_issued';
    
    // Update the store request status
    await storeRequest.update({
      status: overallStatus,
      fulfilled_at: new Date(),
      fulfilled_by: req.user.id,
      updated_by: req.user.id
    }, { transaction });
    
    await transaction.commit();
    
    // Fetch updated data
    const updatedStoreRequest = await StoreRequest.findByPk(id, {
      include: [
        { model: Store, as: 'requestingStore', attributes: ['id', 'name'] },
        { model: Store, as: 'issuingStore', attributes: ['id', 'name'] },
        { model: Currency, as: 'storeRequestCurrency', attributes: ['id', 'name', 'symbol'] },
        {
          model: StoreRequestItem,
          as: 'storeRequestItems',
          attributes: [
            'id', 'store_request_id', 'product_id', 'requested_quantity', 'available_quantity',
            'approved_quantity', 'fulfilled_quantity', 'issued_quantity', 'received_quantity', 'remaining_quantity', 'remaining_receiving_quantity',
            'unit_cost', 'total_cost', 'currency_id', 'exchange_rate', 'equivalent_amount',
            'status', 'rejection_reason', 'notes', 'batch_number', 'expiry_date', 'serial_numbers',
            'fulfilled_at', 'fulfilled_by', 'created_by', 'updated_by', 'createdAt', 'updatedAt'
          ],
          include: [
            { model: Product, as: 'storeRequestProduct', attributes: ['id', 'name', 'code'] }
          ]
        }
      ]
    });
    
    res.json({ success: true, data: updatedStoreRequest });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ success: false, error: 'Failed to issue stock' });
  }
});

// PATCH /api/store-requests/:id/cancel - Cancel request with two scenarios
router.patch('/:id/cancel', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [
        { model: StoreRequestItem, as: 'storeRequestItems' }
      ]
    });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    // Check if request can be cancelled
    if (!['draft', 'submitted', 'approved', 'partial_issued'].includes(storeRequest.status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Only draft, submitted, approved, or partial_issued requests can be cancelled' 
      });
    }
    
    // Determine cancellation scenario based on issued quantities
    let newStatus = 'cancelled';
    let hasIssuedItems = false;
    
    // Check if any items have been issued
    for (const item of storeRequest.storeRequestItems) {
      const issuedQty = parseFloat(item.issued_quantity || 0);
      if (issuedQty > 0) {
        hasIssuedItems = true;
        break;
      }
    }
    
    // Scenario 2: Some items have been issued
    if (hasIssuedItems) {
      newStatus = 'partial_issued_cancelled';
      } else {
    }
    
    await storeRequest.update({
      status: newStatus,
      updated_by: req.user.id
    });
    
    res.json({ 
      success: true, 
      data: storeRequest,
      message: hasIssuedItems 
        ? 'Request cancelled - some items were already issued' 
        : 'Request cancelled successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to cancel store request' });
  }
});

// Helper function to handle automatic return of received items
const handleAutomaticReturn = async (storeRequest, userId) => {
  try {
    // Get Store Return transaction type
    const storeReturnType = await TransactionType.findOne({
      where: { name: 'Store Return' }
    });
    
    if (!storeReturnType) {
      throw new Error('Store Return transaction type not found');
    }
    
    // Process each item that was received
    for (const item of storeRequest.storeRequestItems) {
      const receivedQty = parseFloat(item.received_quantity || 0);
      const issuedQty = parseFloat(item.issued_quantity || 0);
      
      if (receivedQty > 0) {
        // Calculate remaining quantity to return (issued - received)
        const remainingQty = issuedQty - receivedQty;
        
        if (remainingQty > 0) {
          // Get product details
        const product = await Product.findByPk(item.product_id);
        if (!product) {
          continue;
        }
        
        // Get current financial year
        const currentFinancialYear = await FinancialYear.findOne({
          where: { 
            isCurrent: true,
            companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
          }
        });
        
        if (!currentFinancialYear) {
          throw new Error('No current financial year found');
        }
        
        // Receiver keeps the received quantity - no change to receiving store
        // Update issuing store (increase quantity)
        const issuingStore = await ProductStore.findOne({
          where: {
            product_id: item.product_id,
            store_id: storeRequest.requested_from_store_id,
            companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
          }
        });
        
        if (issuingStore) {
          const newIssuingQty = parseFloat(issuingStore.quantity) + remainingQty;
          await issuingStore.update({
            quantity: newIssuingQty,
            updated_by: userId
          });
          }
        
        // Get system default currency
        const systemDefaultCurrency = await Currency.findOne({
          where: { 
            is_default: true,
            companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
          }
        });
        
        // Create Store Return transaction
        const returnTransaction = await ProductTransaction.create({
          uuid: require('crypto').randomUUID(),
          system_date: new Date(),
          transaction_date: new Date(),
          financial_year_id: currentFinancialYear.id,
          financial_year_name: currentFinancialYear.name,
          transaction_type_id: storeReturnType.id,
          transaction_type_name: storeReturnType.name,
          store_id: storeRequest.requested_from_store_id, // Return to issuing store
          product_id: item.product_id,
          product_type: product?.product_type || null,
          created_by_id: userId,
          updated_by_id: userId,
          quantity_in: remainingQty, // Return remaining quantity to issuing store
          quantity_out: 0,
          reference_number: `RET-${storeRequest.reference_number}`,
          reference_type: 'Store Return',
          notes: `Automatic return of remaining quantity from cancelled receipt: ${storeRequest.reference_number} (Returned: ${remainingQty}, Receiver kept: ${receivedQty})`,
          // Cost and currency fields
          exchange_rate: item.exchange_rate || 1.0,
          currency_id: item.currency_id || storeRequest.currency_id,
          system_currency_id: systemDefaultCurrency?.id,
          product_average_cost: item.unit_cost || 0,
          user_unit_cost: item.unit_cost || 0,
          equivalent_amount: (item.unit_cost || 0) * (item.exchange_rate || 1.0),
          companyId: storeRequest.companyId // Add companyId for multi-tenant isolation
        });
        
        // Handle expiry dates and serial numbers
        await handleReturnExpiryAndSerial(item, remainingQty, userId, storeRequest);
        
        // Reset received quantity to 0
        await item.update({
          received_quantity: 0,
          remaining_receiving_quantity: parseFloat(item.issued_quantity || 0),
          updated_by: userId
        });
        
          } else {
          }
      }
    }
    
    } catch (error) {
    throw error;
  }
};

// Helper function to handle expiry dates and serial numbers for returned items
const handleReturnExpiryAndSerial = async (item, returnedQty, userId, storeRequest) => {
  try {
    // Get product details to check if it requires expiry/serial tracking
    const product = await Product.findByPk(item.product_id);
    if (!product) return;
    
    // Handle expiry dates if required
    if (product.requires_expiry_tracking) {
      // Get expiry dates for this item from the receiving store
      const expiryDates = await ProductExpiryDate.findAll({
        where: {
          product_id: item.product_id,
          store_id: storeRequest.requested_by_store_id,
          quantity: { [require('sequelize').Op.gt]: 0 },
          companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
        },
        order: [['expiry_date', 'ASC']]
      });
      
      let remainingQty = returnedQty;
      
      for (const expiry of expiryDates) {
        if (remainingQty <= 0) break;
        
        const qtyToReturn = Math.min(remainingQty, parseFloat(expiry.quantity));
        
        // Decrease quantity in receiving store
        await expiry.update({
          quantity: parseFloat(expiry.quantity) - qtyToReturn,
          updated_by: userId
        });
        
        // Increase quantity in issuing store (or create new record)
        const issuingExpiry = await ProductExpiryDate.findOne({
          where: {
            product_id: item.product_id,
            store_id: storeRequest.requested_from_store_id,
            expiry_date: expiry.expiry_date,
            batch_number: expiry.batch_number,
            companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
          }
        });
        
        if (issuingExpiry) {
          await issuingExpiry.update({
            quantity: parseFloat(issuingExpiry.quantity) + qtyToReturn,
            updated_by: userId
          });
        } else {
          await ProductExpiryDate.create({
            product_id: item.product_id,
            store_id: storeRequest.requested_from_store_id,
            expiry_date: expiry.expiry_date,
            batch_number: expiry.batch_number,
            quantity: qtyToReturn,
            created_by: userId,
            updated_by: userId,
            companyId: storeRequest.companyId // Add companyId for multi-tenant isolation
          });
        }
        
        remainingQty -= qtyToReturn;
      }
    }
    
    // Handle serial numbers if required
    if (product.requires_serial_tracking) {
      // Get serial numbers for this item from the receiving store
      const serialNumbers = await ProductSerialNumber.findAll({
        where: {
          product_id: item.product_id,
          store_id: storeRequest.requested_by_store_id,
          is_active: true,
          companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
        },
        limit: returnedQty
      });
      
      for (const serial of serialNumbers) {
        // Deactivate serial in receiving store
        await serial.update({
          is_active: false,
          updated_by: userId
        });
        
        // Activate serial in issuing store (or create new record)
        const issuingSerial = await ProductSerialNumber.findOne({
          where: {
            product_id: item.product_id,
            store_id: storeRequest.requested_from_store_id,
            serial_number: serial.serial_number,
            companyId: storeRequest.companyId // Add company filter for multi-tenant isolation
          }
        });
        
        if (issuingSerial) {
          await issuingSerial.update({
            is_active: true,
            updated_by: userId
          });
        } else {
          await ProductSerialNumber.create({
            product_id: item.product_id,
            store_id: storeRequest.requested_from_store_id,
            serial_number: serial.serial_number,
            is_active: true,
            created_by: userId,
            updated_by: userId,
            companyId: storeRequest.companyId // Add companyId for multi-tenant isolation
          });
        }
      }
    }
    
  } catch (error) {
    throw error;
  }
};

// PATCH /api/store-requests/:id/cancel-receipt - Cancel receipt with two scenarios
router.patch('/:id/cancel-receipt', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [
        { model: StoreRequestItem, as: 'storeRequestItems' }
      ]
    });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    // Check if request can be cancelled (for receipts)
    if (!['draft', 'submitted', 'approved', 'partial_issued', 'partially_received', 'fulfilled', 'partial_issued_cancelled'].includes(storeRequest.status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Only draft, submitted, approved, partial_issued, partially_received, fulfilled, or partial_issued_cancelled requests can be cancelled' 
      });
    }
    
    // Determine cancellation scenario based on received quantities
    let newStatus = 'cancelled';
    let hasReceivedItems = false;
    
    // Check if any items have been received
    for (const item of storeRequest.storeRequestItems) {
      const receivedQty = parseFloat(item.received_quantity || 0);
      if (receivedQty > 0) {
        hasReceivedItems = true;
        break;
      }
    }
    
    // Scenario 2: Some items have been received
    if (hasReceivedItems) {
      newStatus = 'partially_received_cancelled';
      // Handle automatic return of received items
      await handleAutomaticReturn(storeRequest, req.user.id);
    } else {
      }
    
    await storeRequest.update({
      status: newStatus,
      updated_by: req.user.id
    });
    
    res.json({ 
      success: true, 
      data: storeRequest,
      message: hasReceivedItems 
        ? 'Receipt cancelled - some items were already received' 
        : 'Receipt cancelled successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to cancel store request receipt' });
  }
});

// Item-level operations

// PATCH /api/store-requests/:id/items/:itemId/approve - Approve item
router.patch('/:id/items/:itemId/approve', async (req, res) => {
  try {
    const { approved_quantity, notes } = req.body;
    const storeRequestItem = await StoreRequestItem.findByPk(req.params.itemId);
    
    if (!storeRequestItem) {
      return res.status(404).json({ success: false, error: 'Store request item not found' });
    }
    
    if (storeRequestItem.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending items can be approved' });
    }
    
    if (approved_quantity > storeRequestItem.requested_quantity) {
      return res.status(400).json({ success: false, error: 'Approved quantity cannot exceed requested quantity' });
    }
    
    await logQuantityChange(storeRequestItem.id, 'approved', approved_quantity, req.user.id, notes);
    
    res.json({ success: true, data: storeRequestItem });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve item' });
  }
});

// PATCH /api/store-requests/:id/items/:itemId/issue - Issue item
router.patch('/:id/items/:itemId/issue', async (req, res) => {
  try {
    const { issued_quantity, notes } = req.body;
    const storeRequestItem = await StoreRequestItem.findByPk(req.params.itemId);
    
    if (!storeRequestItem) {
      return res.status(404).json({ success: false, error: 'Store request item not found' });
    }
    
    if (!['approved', 'partially_received'].includes(storeRequestItem.status)) {
      return res.status(400).json({ success: false, error: 'Only approved or partially received items can be issued' });
    }
    
    if (issued_quantity > storeRequestItem.approved_quantity) {
      return res.status(400).json({ success: false, error: 'Issued quantity cannot exceed approved quantity' });
    }
    
    await logQuantityChange(storeRequestItem.id, 'issued', issued_quantity, req.user.id, notes);
    
    res.json({ success: true, data: storeRequestItem });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to issue item' });
  }
});

// PATCH /api/store-requests/:id/items/:itemId/receive - Receive item
router.patch('/:id/items/:itemId/receive', async (req, res) => {
  const transaction = await StoreRequest.sequelize.transaction();
  
  try {
    const { received_quantity, notes } = req.body;
    const storeRequestItem = await StoreRequestItem.findByPk(req.params.itemId, { transaction });
    
    if (!storeRequestItem) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Store request item not found' });
    }
    
    if (!['issued', 'partially_received', 'partial_issued', 'fulfilled'].includes(storeRequestItem.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'Only issued, partially received, partial issued, or fulfilled items can be received' });
    }
    
    const alreadyReceived = parseInt(storeRequestItem.received_quantity || 0);
    const issuedQuantity = parseInt(storeRequestItem.issued_quantity || 0);
    const remainingQuantity = issuedQuantity - alreadyReceived;
    
    // For fulfilled items with 0 issued quantity, allow receiving up to the requested quantity
    let maxReceivableQuantity = remainingQuantity;
    if (storeRequestItem.status === 'fulfilled' && issuedQuantity === 0) {
      maxReceivableQuantity = parseInt(storeRequestItem.requested_quantity || 0) - alreadyReceived;
    }
    
    if (received_quantity > maxReceivableQuantity) {
      await transaction.rollback();
      return res.status(400).json({ 
        success: false, 
        error: `Cannot receive ${received_quantity} units. Maximum receivable: ${maxReceivableQuantity} units` 
      });
    }
    
    await logQuantityChange(storeRequestItem.id, 'received', received_quantity, req.user.id, notes, null, transaction, req.user.companyId);
    
    // Update receiving store's inventory if receiving quantity > 0
    if (received_quantity > 0) {
      // Use findOne with company filter instead of findByPk
      const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
      const storeRequest = await StoreRequest.findOne({ where: storeRequestWhere, transaction });
      const receivingStoreId = storeRequest?.requested_by_store_id;
      
      if (receivingStoreId) {
        // Get current financial year for ProductTransaction records
        const currentFinancialYear = await FinancialYear.findOne({
          where: {
            isCurrent: true,
            isActive: true,
            companyId: req.user.companyId // Add company filter for multi-tenant isolation
          },
          transaction
        });
        
        if (!currentFinancialYear) {
          await transaction.rollback();
          return res.status(400).json({ error: 'No active financial year found' });
        }
        
        // Get system default currency
        const systemDefaultCurrency = await Currency.findOne({ 
          where: { 
            is_default: true,
            companyId: req.user.companyId // Add company filter for multi-tenant isolation
          },
          transaction
        });
        
        if (!systemDefaultCurrency) {
          await transaction.rollback();
          return res.status(400).json({ error: 'No system default currency found' });
        }
        
        if (currentFinancialYear && systemDefaultCurrency) {
          // Find or create product store record for receiving store WITH ROW LOCK
          // Use SELECT FOR UPDATE to prevent race conditions
          let productStore = await ProductStore.findOne({
            where: {
              product_id: storeRequestItem.product_id,
              store_id: receivingStoreId,
              is_active: true,
              companyId: req.user.companyId // Add company filter for multi-tenant isolation
            },
            lock: transaction.LOCK.UPDATE, // Lock the row to prevent concurrent updates
            transaction
          });
          
          if (productStore) {
            // Use increment to avoid race conditions (atomic operation)
            const receivedQty = parseFloat(received_quantity || 0);
            await productStore.increment('quantity', { by: receivedQty, transaction });
            await productStore.update({
              last_updated: new Date()
            }, { transaction });
          } else {
            // Create new product store record
            const receivedQty = parseFloat(received_quantity || 0);
            productStore = await ProductStore.create({
              product_id: storeRequestItem.product_id,
              store_id: receivingStoreId,
              quantity: receivedQty,
              is_active: true,
              last_updated: new Date(),
              companyId: req.user.companyId // Add companyId for multi-tenant isolation
            }, { transaction });
          }
          
          // Fetch product to get product_type
          const Product = require('../models/product');
          const product = await Product.findByPk(storeRequestItem.product_id);
          
          // Create product transaction record for receiving
          const receivedQty = parseFloat(received_quantity || 0);
          await ProductTransaction.create({
            uuid: require('crypto').randomUUID(),
            system_date: new Date(),
            transaction_date: new Date(),
            financial_year_id: currentFinancialYear.id,
            financial_year_name: currentFinancialYear.name,
            transaction_type_id: 'b3690f53-18bb-41d8-95a1-a522b819e65d', // Store Receipt transaction type ID
            transaction_type_name: 'Store Receipt',
            store_id: receivingStoreId,
            product_id: storeRequestItem.product_id,
            product_type: product?.product_type || null,
            created_by_id: req.user.id,
            updated_by_id: req.user.id,
            quantity_in: receivedQty,
            reference_number: storeRequest.reference_number,
            reference_type: 'STORE_REQUEST',
            notes: `Received from store request ${storeRequest.reference_number}`,
            is_active: true,
            // Cost and currency fields
            exchange_rate: storeRequestItem.exchange_rate || 1.0,
            currency_id: storeRequestItem.currency_id || storeRequest.currency_id,
            system_currency_id: systemDefaultCurrency.id,
            product_average_cost: storeRequestItem.unit_cost || 0,
            user_unit_cost: storeRequestItem.unit_cost || 0,
            equivalent_amount: (storeRequestItem.unit_cost || 0) * (storeRequestItem.exchange_rate || 1.0),
            companyId: req.user.companyId // Add companyId for multi-tenant isolation
          }, { transaction });
          
          }
      }
    }
    
    // Update the item's received quantity
    const newReceivedQty = alreadyReceived + parseInt(received_quantity || 0);
    const newStatus = newReceivedQty >= issuedQuantity ? 'fully_received' : 'partially_received';
    
    await storeRequestItem.update({
      received_quantity: newReceivedQty,
      status: newStatus,
      updated_by: req.user.id
    }, { transaction });
    
    // Reload the item to get updated data
    const updatedItem = await StoreRequestItem.findByPk(req.params.itemId, { transaction });
    
    // Update the parent store request status based on all items
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequestForStatus = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [{ model: StoreRequestItem, as: 'storeRequestItems' }],
      transaction
    });
    
    if (storeRequestForStatus) {
      const allItems = storeRequestForStatus.storeRequestItems;
      const hasPartiallyReceived = allItems.some(item => item.status === 'partially_received');
      const hasFullyReceived = allItems.some(item => item.status === 'fully_received');
      
      // Check if all items are fully received (received_quantity === approved_quantity)
      const allFullyReceived = allItems.every(item => {
        const receivedQty = parseInt(item.received_quantity || 0);
        const approvedQty = parseInt(item.approved_quantity || 0);
        return receivedQty === approvedQty || item.status === 'rejected' || item.status === 'cancelled';
      });
      
      let newRequestStatus = storeRequestForStatus.status;
      
      if (hasPartiallyReceived && !allFullyReceived) {
        newRequestStatus = 'partially_received';
      } else if (allFullyReceived) {
        newRequestStatus = 'fully_received';
      }
      
      if (newRequestStatus !== storeRequestForStatus.status) {
        await storeRequestForStatus.update({
          status: newRequestStatus,
          updated_by: req.user.id
        }, { transaction });
      }
    }
    
    // Commit transaction
    await transaction.commit();
    
    res.json({ 
      success: true, 
      message: 'Item received successfully',
      data: updatedItem
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ success: false, error: error.message || 'Failed to receive item' });
  }
});

// PATCH /api/store-requests/:id/items/:itemId/fulfill - Fulfill item
router.patch('/:id/items/:itemId/fulfill', async (req, res) => {
  try {
    const { fulfilled_quantity, notes } = req.body;
    const storeRequestItem = await StoreRequestItem.findByPk(req.params.itemId);
    
    if (!storeRequestItem) {
      return res.status(404).json({ success: false, error: 'Store request item not found' });
    }
    
    if (storeRequestItem.status !== 'received') {
      return res.status(400).json({ success: false, error: 'Only received items can be fulfilled' });
    }
    
    if (fulfilled_quantity > storeRequestItem.received_quantity) {
      return res.status(400).json({ success: false, error: 'Fulfilled quantity cannot exceed received quantity' });
    }
    
    await logQuantityChange(storeRequestItem.id, 'fulfilled', fulfilled_quantity, req.user.id, notes);
    
    res.json({ success: true, data: storeRequestItem });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fulfill item' });
  }
});

// PATCH /api/store-requests/:id/items/:itemId/reject - Reject item
router.patch('/:id/items/:itemId/reject', async (req, res) => {
  try {
    const { reason, notes } = req.body;
    const storeRequestItem = await StoreRequestItem.findByPk(req.params.itemId);
    
    if (!storeRequestItem) {
      return res.status(404).json({ success: false, error: 'Store request item not found' });
    }
    
    if (!['pending', 'approved', 'issued', 'received'].includes(storeRequestItem.status)) {
      return res.status(400).json({ success: false, error: 'Item cannot be rejected in current status' });
    }
    
    await logQuantityChange(storeRequestItem.id, 'rejected', 0, req.user.id, notes, reason);
    
    res.json({ success: true, data: storeRequestItem });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject item' });
  }
});

// Bulk operations

// PATCH /api/store-requests/:id/approve-all - Approve all items
router.patch('/:id/approve-all', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [{ model: StoreRequestItem, as: 'storeRequestItems' }]
    });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    for (const item of storeRequest.storeRequestItems) {
      if (item.status === 'pending') {
        await logQuantityChange(item.id, 'approved', item.requested_quantity, req.user.id, 'Bulk approval');
      }
    }
    
    res.json({ success: true, message: 'All items approved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve all items' });
  }
});

// PATCH /api/store-requests/:id/issue-all - Issue all items
router.patch('/:id/issue-all', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [{ model: StoreRequestItem, as: 'storeRequestItems' }]
    });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    for (const item of storeRequest.storeRequestItems) {
      if (['approved', 'partially_received'].includes(item.status)) {
        await logQuantityChange(item.id, 'issued', item.approved_quantity, req.user.id, 'Bulk issue');
      }
    }
    
    res.json({ success: true, message: 'All items issued successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to issue all items' });
  }
});

// PATCH /api/store-requests/:id/receive-all - Receive all items
router.patch('/:id/receive-all', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [{ model: StoreRequestItem, as: 'storeRequestItems' }]
    });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    for (const item of storeRequest.storeRequestItems) {
      if (['issued', 'partially_received', 'partial_issued', 'fulfilled'].includes(item.status)) {
        // Calculate remaining quantity to receive
        const alreadyReceived = parseInt(item.received_quantity || 0);
        const issuedQuantity = parseInt(item.issued_quantity || 0);
        let remainingQuantity = issuedQuantity - alreadyReceived;
        
        // For fulfilled items with 0 issued quantity, use requested quantity
        if (item.status === 'fulfilled' && issuedQuantity === 0) {
          remainingQuantity = parseInt(item.requested_quantity || 0) - alreadyReceived;
        }
        
        if (remainingQuantity > 0) {
          await logQuantityChange(item.id, 'received', remainingQuantity, req.user.id, 'Bulk receive');
          
          // Update receiving store's inventory if receiving quantity > 0
          const receivingStoreId = storeRequest.requested_by_store_id;
          
          if (receivingStoreId) {
            // Get current financial year for ProductTransaction records
            const currentFinancialYear = await FinancialYear.findOne({
              where: {
                isCurrent: true,
                isActive: true,
                companyId: req.user.companyId // Add company filter for multi-tenant isolation
              }
            });
            
            if (!currentFinancialYear) {
              continue; // Skip this item if no financial year found
            }
            
            // Get system default currency
            const systemDefaultCurrency = await Currency.findOne({ 
              where: { 
                is_default: true,
                companyId: req.user.companyId // Add company filter for multi-tenant isolation
              }
            });
            
            if (!systemDefaultCurrency) {
              continue; // Skip this item if no currency found
            }
            
            if (currentFinancialYear && systemDefaultCurrency) {
              // Find or create product store record for receiving store
              let productStore = await ProductStore.findOne({
                where: {
                  product_id: item.product_id,
                  store_id: receivingStoreId,
                  is_active: true,
                  companyId: req.user.companyId // Add company filter for multi-tenant isolation
                }
              });
              
              if (productStore) {
                // Update existing product store quantity
                const currentQuantity = parseFloat(productStore.quantity || 0);
                await productStore.update({
                  quantity: currentQuantity + remainingQuantity,
                  last_updated: new Date()
                });
              } else {
                // Create new product store record
                productStore = await ProductStore.create({
                  product_id: item.product_id,
                  store_id: receivingStoreId,
                  quantity: remainingQuantity,
                  is_active: true,
                  last_updated: new Date(),
                  companyId: req.user.companyId // Add companyId for multi-tenant isolation
                });
              }
              
              // Fetch product to get product_type
              const Product = require('../models/product');
              const product = await Product.findByPk(item.product_id);
              
              // Create product transaction record for receiving
              await ProductTransaction.create({
                uuid: require('crypto').randomUUID(),
                system_date: new Date(),
                transaction_date: new Date(),
                financial_year_id: currentFinancialYear.id,
                financial_year_name: currentFinancialYear.name,
            transaction_type_id: 'b3690f53-18bb-41d8-95a1-a522b819e65d', // Store Receipt transaction type ID
            transaction_type_name: 'Store Receipt',
                store_id: receivingStoreId,
                product_id: item.product_id,
                product_type: product?.product_type || null,
                created_by_id: req.user.id,
                updated_by_id: req.user.id,
                quantity_in: remainingQuantity,
                reference_number: storeRequest.reference_number,
                reference_type: 'STORE_REQUEST',
                notes: `Bulk received from store request ${storeRequest.reference_number}`,
                is_active: true,
                // Cost and currency fields
                exchange_rate: item.exchange_rate || 1.0,
                currency_id: item.currency_id || storeRequest.currency_id,
                system_currency_id: systemDefaultCurrency.id,
                product_average_cost: item.unit_cost || 0,
                user_unit_cost: item.unit_cost || 0,
                equivalent_amount: (item.unit_cost || 0) * (item.exchange_rate || 1.0),
                companyId: req.user.companyId // Add companyId for multi-tenant isolation
              });
              
              }
          }
        }
      }
    }
    
    res.json({ success: true, message: 'All items received successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to receive all items' });
  }
});

// PATCH /api/store-requests/:id/fulfill-all - Fulfill all items
router.patch('/:id/fulfill-all', async (req, res) => {
  try {
    // Use findOne with company filter instead of findByPk
    const storeRequestWhere = buildCompanyWhere(req, { id: req.params.id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [{ model: StoreRequestItem, as: 'storeRequestItems' }]
    });
    
    if (!storeRequest) {
      return res.status(404).json({ success: false, error: 'Store request not found' });
    }
    
    for (const item of storeRequest.storeRequestItems) {
      if (item.status === 'received') {
        await logQuantityChange(item.id, 'fulfilled', item.received_quantity, req.user.id, 'Bulk fulfill');
      }
    }
    
    res.json({ success: true, message: 'All items fulfilled successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fulfill all items' });
  }
});

// Stats endpoint
router.get('/stats/summary', async (req, res) => {
  try {
    // Build base where clause for filtering
    const baseWhere = {};
    if (req.query.request_type) {
      baseWhere.request_type = req.query.request_type;
    }
    if (req.query.exclude_status) {
      baseWhere.status = {
        [require('sequelize').Op.ne]: req.query.exclude_status
      };
    }

    const totalRequests = await StoreRequest.count({ where: buildCompanyWhere(req, baseWhere) });
    const draftRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'draft' }) });
    const submittedRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'submitted' }) });
    const approvedRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'approved' }) });
    const fulfilledRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'fulfilled' }) });
    const partialIssuedRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'partial_issued' }) });
    const partiallyReceivedRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'partially_received' }) });
    const fullyReceivedRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'fully_received' }) });
    const rejectedRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'rejected' }) });
    const cancelledRequests = await StoreRequest.count({ where: buildCompanyWhere(req, { ...baseWhere, status: 'cancelled' }) });
    
    res.json({
      success: true,
      data: {
        totalRequests,
        draftRequests,
        submittedRequests,
        approvedRequests,
        fulfilledRequests,
        partialIssuedRequests,
        partiallyReceivedRequests,
        fullyReceivedRequests,
        rejectedRequests,
        cancelledRequests
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Approve Store Request (change status from submitted to approved)
router.patch('/:id/approve', async (req, res) => {
  const transaction = await StoreRequest.sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { approval_notes, approved_items } = req.body; // approved_items contains quantity adjustments

    // Fetch the store request with all related data - use findOne with company filter
    const storeRequestWhere = buildCompanyWhere(req, { id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [
        {
          model: StoreRequestItem,
          as: 'storeRequestItems',
          include: [
            {
              model: Product,
              as: 'storeRequestProduct'
            }
          ]
        },
        {
          model: Store,
          as: 'requestingStore'
        },
        {
          model: Store,
          as: 'issuingStore'
        },
        {
          model: Currency,
          as: 'storeRequestCurrency'
        }
      ],
      transaction
    });

    if (!storeRequest) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Store request not found' });
    }

    if (storeRequest.status !== 'submitted') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Only submitted store requests can be approved' });
    }

    // Update store request status
    await storeRequest.update({
      status: 'approved',
      approved_at: new Date(),
      approved_by: req.user.id,
      approval_notes: approval_notes || null,
      updated_by: req.user.id
    }, { transaction });

    // Process each item with approval quantities
    for (const item of storeRequest.storeRequestItems) {
      const approvedItem = approved_items?.find(ai => ai.item_id === item.id);
      if (approvedItem) {
        const approvedQuantity = parseFloat(approvedItem.approved_quantity) || 0;
        const originalQuantity = parseFloat(item.requested_quantity) || 0;
        
        // Calculate remaining quantity (initially equals approved quantity)
        const remainingQuantity = approvedQuantity;

        // Update item with approved quantity, issued quantity, and remaining quantity
        await item.update({
          approved_quantity: approvedQuantity,
          issued_quantity: 0, // Reset issued quantity on approval
          remaining_quantity: remainingQuantity,
          total_cost: approvedQuantity * parseFloat(item.unit_cost || 0), // Update total cost based on approved quantity
          status: approvedQuantity > 0 ? 'approved' : 'rejected',
          updated_by: req.user.id
        }, { transaction });

        await logQuantityChange(
          item.id, 
          'approved', 
          approvedQuantity, 
          req.user.id, 
          `Approved: ${originalQuantity} → ${approvedQuantity}`,
          approval_notes,
          transaction
        );
      }
    }

    // Recalculate total value based on approved quantities
    const updatedItems = await StoreRequestItem.findAll({
      where: { store_request_id: id },
      transaction
    });
    
    const newTotalValue = updatedItems.reduce((sum, item) => {
      return sum + parseFloat(item.total_cost || 0);
    }, 0);
    
    // Update the store request with new total value
    await storeRequest.update({
      total_value: newTotalValue,
      updated_by: req.user.id
    }, { transaction });

    await transaction.commit();
    // Return updated store request - use findOne with company filter
    const updatedRequestWhere = buildCompanyWhere(req, { id });
    const updatedRequest = await StoreRequest.findOne({
      where: updatedRequestWhere,
      include: [
        {
          model: StoreRequestItem,
          as: 'storeRequestItems',
          include: [
            {
              model: Product,
              as: 'storeRequestProduct'
            }
          ]
        },
        {
          model: Store,
          as: 'requestingStore'
        },
        {
          model: Store,
          as: 'issuingStore'
        },
        {
          model: Currency,
          as: 'storeRequestCurrency'
        }
      ]
    });

    res.json({
      success: true,
      message: 'Store request approved successfully',
      data: updatedRequest
    });

  } catch (error) {
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: 'Failed to approve store request',
      error: error.message
    });
  }
});

// Reject Store Request (change status from submitted to rejected)
router.patch('/:id/reject', async (req, res) => {
  const transaction = await StoreRequest.sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason || !rejection_reason.trim()) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    // Fetch the store request - use findOne with company filter
    const storeRequestWhere = buildCompanyWhere(req, { id });
    const storeRequest = await StoreRequest.findOne({
      where: storeRequestWhere,
      include: [
        {
          model: StoreRequestItem,
          as: 'storeRequestItems'
        }
      ],
      transaction
    });

    if (!storeRequest) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Store request not found' });
    }

    if (storeRequest.status !== 'submitted') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Only submitted store requests can be rejected' });
    }

    // Update store request status
    await storeRequest.update({
      status: 'rejected',
      rejected_at: new Date(),
      rejected_by: req.user.id,
      rejection_reason: rejection_reason,
      updated_by: req.user.id
    }, { transaction });

    // Update all items to rejected status
    for (const item of storeRequest.storeRequestItems) {
      await item.update({
        status: 'rejected',
        rejection_reason: rejection_reason,
        rejected_at: new Date(),
        rejected_by: req.user.id
      }, { transaction });

      await logQuantityChange(
        item.id, 
        'rejected', 
        0, 
        req.user.id, 
        `Store request rejected: ${rejection_reason}`,
        'Store request rejection'
      );
    }

    await transaction.commit();

    // Return updated store request - use findOne with company filter
    const updatedStoreRequestWhere = buildCompanyWhere(req, { id });
    const updatedStoreRequest = await StoreRequest.findOne({
      where: updatedStoreRequestWhere,
      include: [
        {
          model: StoreRequestItem,
          as: 'storeRequestItems',
          include: [
            {
              model: Product,
              as: 'storeRequestProduct',
              include: [
                { model: ProductBrandName, as: 'brand' },
                { model: ProductColor, as: 'color' },
                { model: ProductManufacturer, as: 'manufacturer' },
                { model: ProductCategory, as: 'category' },
                { model: ProductModel, as: 'model' },
                { model: Packaging, as: 'unit' }
              ]
            }
          ]
        },
        {
          model: Store,
          as: 'requestingStore'
        },
        {
          model: Store,
          as: 'issuingStore'
        },
        {
          model: Currency,
          as: 'storeRequestCurrency'
        },
        {
          model: User,
          as: 'createdByUser'
        },
        {
          model: User,
          as: 'rejectedByUser'
        }
      ]
    });

    res.json({
      success: true,
      message: 'Store request rejected successfully',
      data: updatedStoreRequest
    });

  } catch (error) {
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: 'Failed to reject store request',
      error: error.message
    });
  }
});

// Export store requests to Excel
router.get('/export/excel', async (req, res) => {
  try {
    // Build where clause for export filters
    const whereClause = {};
    
    if (req.query.request_type) {
      whereClause.request_type = req.query.request_type;
    }
    if (req.query.status && req.query.status !== 'all') {
      whereClause.status = req.query.status;
    }
    if (req.query.exclude_status) {
      whereClause.status = {
        [require('sequelize').Op.ne]: req.query.exclude_status
      };
    }
    if (req.query.priority && req.query.priority !== 'all') {
      whereClause.priority = req.query.priority;
    }
    if (req.query.requesting_store_id) {
      whereClause.requested_by_store_id = req.query.requesting_store_id;
    }
    if (req.query.issuing_store_id) {
      whereClause.requested_from_store_id = req.query.issuing_store_id;
    }
    if (req.query.date_from || req.query.date_to) {
    if (req.query.date_from && req.query.date_to) {
        // Both dates provided - use between
      whereClause.request_date = {
        [require('sequelize').Op.between]: [req.query.date_from, req.query.date_to]
      };
      } else if (req.query.date_from) {
        // Only start date provided - from this date onwards
        whereClause.request_date = {
          [require('sequelize').Op.gte]: req.query.date_from
        };
      } else if (req.query.date_to) {
        // Only end date provided - up to this date
        whereClause.request_date = {
          [require('sequelize').Op.lte]: req.query.date_to
        };
      }
    }
    if (req.query.search) {
      whereClause[require('sequelize').Op.or] = [
        { reference_number: { [require('sequelize').Op.iLike]: `%${req.query.search}%` } },
        { notes: { [require('sequelize').Op.iLike]: `%${req.query.search}%` } }
      ];
    }

    // Handle include_partial_requests for Store Receipts
    if (req.query.include_partial_requests === 'true') {
      // Include partial_issued requests even if request_type is 'request'
      const complexOrConditions = [
        { request_type: 'issue' },
        { 
          request_type: 'request',
          status: {
            [require('sequelize').Op.in]: ['partial_issued', 'partially_received', 'fully_received', 'partial_issued_cancelled', 'partially_received_cancelled']
          }
        }
      ];

      if (whereClause[require('sequelize').Op.or]) {
        // Combine with existing search conditions
        whereClause[require('sequelize').Op.and] = [
          { [require('sequelize').Op.or]: whereClause[require('sequelize').Op.or] },
          { [require('sequelize').Op.or]: complexOrConditions }
        ];
        delete whereClause[require('sequelize').Op.or];
      } else {
        whereClause[require('sequelize').Op.or] = complexOrConditions;
      }
    }

    // Fetch store requests with all necessary relations for export
    const storeRequests = await StoreRequest.findAll({
      where: whereClause,
      include: [
        { model: Store, as: 'requestingStore', attributes: ['id', 'name'] },
        { model: Store, as: 'issuingStore', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: Currency, as: 'storeRequestCurrency', attributes: ['id', 'name', 'symbol'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Transform data for export
    const transformedStoreRequests = storeRequests.map(request => ({
      ...request.toJSON(),
      requesting_store_name: request.requestingStore?.name || '',
      issuing_store_name: request.issuingStore?.name || '',
      currency_symbol: request.storeRequestCurrency?.symbol || '',
      created_by_name: request.createdByUser ? `${request.createdByUser.first_name || ''} ${request.createdByUser.last_name || ''}`.trim() : '',
      updated_by_name: request.updatedByUser ? `${request.updatedByUser.first_name || ''} ${request.updatedByUser.last_name || ''}`.trim() : ''
    }));

    // Create export service instance
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();

    // Generate Excel buffer
    const buffer = await exportService.exportStoreRequestsToExcel(transformedStoreRequests, req.query);

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="store_requests_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to export store requests to Excel',
      details: error.message
    });
  }
});

// Export store requests to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    // Build where clause for export filters (same as Excel)
    const whereClause = {};
    
    if (req.query.request_type) {
      whereClause.request_type = req.query.request_type;
    }
    if (req.query.status && req.query.status !== 'all') {
      whereClause.status = req.query.status;
    }
    if (req.query.exclude_status) {
      whereClause.status = {
        [require('sequelize').Op.ne]: req.query.exclude_status
      };
    }
    if (req.query.priority && req.query.priority !== 'all') {
      whereClause.priority = req.query.priority;
    }
    if (req.query.requesting_store_id) {
      whereClause.requested_by_store_id = req.query.requesting_store_id;
    }
    if (req.query.issuing_store_id) {
      whereClause.requested_from_store_id = req.query.issuing_store_id;
    }
    if (req.query.date_from || req.query.date_to) {
    if (req.query.date_from && req.query.date_to) {
        // Both dates provided - use between
      whereClause.request_date = {
        [require('sequelize').Op.between]: [req.query.date_from, req.query.date_to]
      };
      } else if (req.query.date_from) {
        // Only start date provided - from this date onwards
        whereClause.request_date = {
          [require('sequelize').Op.gte]: req.query.date_from
        };
      } else if (req.query.date_to) {
        // Only end date provided - up to this date
        whereClause.request_date = {
          [require('sequelize').Op.lte]: req.query.date_to
        };
      }
    }
    if (req.query.search) {
      whereClause[require('sequelize').Op.or] = [
        { reference_number: { [require('sequelize').Op.iLike]: `%${req.query.search}%` } },
        { notes: { [require('sequelize').Op.iLike]: `%${req.query.search}%` } }
      ];
    }

    // Handle include_partial_requests for Store Receipts
    if (req.query.include_partial_requests === 'true') {
      // Include partial_issued requests even if request_type is 'request'
      const complexOrConditions = [
        { request_type: 'issue' },
        { 
          request_type: 'request',
          status: {
            [require('sequelize').Op.in]: ['partial_issued', 'partially_received', 'fully_received', 'partial_issued_cancelled', 'partially_received_cancelled']
          }
        }
      ];

      if (whereClause[require('sequelize').Op.or]) {
        // Combine with existing search conditions
        whereClause[require('sequelize').Op.and] = [
          { [require('sequelize').Op.or]: whereClause[require('sequelize').Op.or] },
          { [require('sequelize').Op.or]: complexOrConditions }
        ];
        delete whereClause[require('sequelize').Op.or];
      } else {
        whereClause[require('sequelize').Op.or] = complexOrConditions;
      }
    }

    // Fetch store requests with all necessary relations for export
    const storeRequests = await StoreRequest.findAll({
      where: whereClause,
      include: [
        { model: Store, as: 'requestingStore', attributes: ['id', 'name'] },
        { model: Store, as: 'issuingStore', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'first_name', 'last_name'] },
        { model: Currency, as: 'storeRequestCurrency', attributes: ['id', 'name', 'symbol'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Transform data for export
    const transformedStoreRequests = storeRequests.map(request => ({
      ...request.toJSON(),
      requesting_store_name: request.requestingStore?.name || '',
      issuing_store_name: request.issuingStore?.name || '',
      currency_symbol: request.storeRequestCurrency?.symbol || '',
      created_by_name: request.createdByUser ? `${request.createdByUser.first_name || ''} ${request.createdByUser.last_name || ''}`.trim() : '',
      updated_by_name: request.updatedByUser ? `${request.updatedByUser.first_name || ''} ${request.updatedByUser.last_name || ''}`.trim() : ''
    }));

    // Create export service instance
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();

    // Generate PDF buffer
    const buffer = await exportService.exportStoreRequestsToPDF(transformedStoreRequests, req.query);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="store_requests_export_${new Date().toISOString().split('T')[0]}.pdf"`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to export store requests to PDF',
      details: error.message
    });
  }
});

module.exports = router;