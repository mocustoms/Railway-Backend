const express = require('express');
const router = express.Router();
const { 
  PhysicalInventory, 
  PhysicalInventoryItem, 
  Store, 
  AdjustmentReason, 
  Product, 
  User, 
  Currency,
  Account
} = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const PhysicalInventoryService = require('../services/physicalInventoryService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getUploadDir } = require('../utils/uploadsPath');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for file uploads (uses UPLOAD_PATH for Railway Volume)
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadDir = getUploadDir('temp');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'physical-inventory-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx) and CSV files are allowed'), false);
    }
  }
});

// Validation middleware
const validatePhysicalInventory = (req, res, next) => {
  const { store_id, inventory_date } = req.body;
  
  if (!store_id) {
    return res.status(400).json({
      success: false,
      message: 'Store ID is required'
    });
  }
  
  if (!inventory_date) {
    return res.status(400).json({
      success: false,
      message: 'Inventory date is required'
    });
  }
  
  next();
};

// Validate imported items
router.post('/validate-items', upload.single('file'), csrfProtection, async (req, res) => {
  try {
    const xlsx = require('xlsx');
    const { Product } = require('../models');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Parse Excel file
    let workbook, data;
    
    try {
      workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = xlsx.utils.sheet_to_json(worksheet);
      } catch (parseError) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid Excel file format' 
      });
    }

    if (data.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'File is empty or invalid format' 
      });
    }

    // Validate required columns - be flexible with column names
    const requiredColumns = ['product_code', 'counted_quantity', 'unit_average_cost'];
    const optionalColumns = ['batch_number', 'expiry_date', 'serial_numbers'];
    const headers = Object.keys(data[0]);
    // Create a mapping for flexible column matching
    const columnMapping = {};
    const missingColumns = [];
    
    // Try to match columns with different possible names
    const possibleNames = {
      'product_code': ['product_code', 'Product Code', 'productcode', 'ProductCode'],
      'counted_quantity': ['counted_quantity', 'Counted Quantity', 'countedquantity', 'CountedQuantity'],
      'unit_average_cost': ['unit_average_cost', 'Unit Average Cost', 'unitaveragecost', 'UnitAverageCost'],
      'batch_number': ['batch_number', 'Batch Number', 'batchnumber', 'BatchNumber'],
      'expiry_date': ['expiry_date', 'Expiry Date', 'expirydate', 'ExpiryDate'],
      'serial_numbers': ['serial_numbers', 'Serial Numbers', 'serialnumbers', 'SerialNumbers']
    };
    
    // First, check only REQUIRED columns
    for (const requiredCol of requiredColumns) {
      const possibleColumnNames = possibleNames[requiredCol];
      const foundHeader = possibleColumnNames.find(name => headers.includes(name));
      if (foundHeader) {
        columnMapping[requiredCol] = foundHeader;
      } else {
        missingColumns.push(requiredCol);
      }
    }
    
    // Then, check OPTIONAL columns (don't add to missingColumns if not found)
    for (const optionalCol of optionalColumns) {
      const possibleColumnNames = possibleNames[optionalCol];
      const foundHeader = possibleColumnNames.find(name => headers.includes(name));
      if (foundHeader) {
        columnMapping[optionalCol] = foundHeader;
      }
      // If not found, that's okay - it's optional, so we don't add to missingColumns
    }
    
    if (missingColumns.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Missing required columns: ${missingColumns.join(', ')}` 
      });
    }

    const validationErrors = [];
    const validatedItems = [];

    // Get all products for validation (with company filter)
    let products, productMap;
    
    try {
      // Build company filter
      const { buildCompanyWhere } = require('../middleware/companyFilter');
      const baseWhere = buildCompanyWhere(req);
      if (!req.user.isSystemAdmin && req.user.companyId) {
        baseWhere.companyId = req.user.companyId;
      }

      products = await Product.findAll({
        where: baseWhere,
        attributes: ['id', 'code', 'name', 'average_cost', 'is_active'],
        // Remove the is_active filter to include all products
        // where: { is_active: true }  // ← Commented out to include inactive products
      });
      
      productMap = new Map();
      products.forEach(product => {
        productMap.set(product.code, product);
      });
      
      } catch (productError) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch products for validation', 
        details: productError.message 
      });
    }

    // Validate each row
    data.forEach((row, index) => {
      const rowNumber = index + 2; // Excel row number (accounting for header)
      const errors = [];

      // Use column mapping to get the correct field names
      const productCode = row[columnMapping.product_code];
      const countedQuantity = row[columnMapping.counted_quantity];
      const unitAverageCost = row[columnMapping.unit_average_cost];
      // Optional fields - get from mapping if exists, otherwise empty string
      const batchNumber = columnMapping.batch_number ? (row[columnMapping.batch_number] || '') : '';
      const expiryDate = columnMapping.expiry_date ? (row[columnMapping.expiry_date] || '') : '';
      const serialNumbers = columnMapping.serial_numbers ? (row[columnMapping.serial_numbers] || '') : '';
      const currentQuantity = row.current_quantity || row['Current Quantity'];

      // Validate product code
      if (!productCode || productCode.toString().trim() === '') {
        errors.push({ field: 'product_code', message: 'Product code is required' });
        } else {
        const trimmedCode = productCode.toString().trim();
        const product = productMap.get(trimmedCode);
        if (!product) {
          errors.push({ field: 'product_code', message: `Product with code '${productCode}' not found` });
          } else {
          // Check if product is active
          if (!product.is_active) {
            errors.push({ field: 'product_code', message: `Product with code '${productCode}' is inactive` });
            } else {
            // Add product info to validated item
            row.product_id = product.id;
            row.product_name = product.name;
            }
        }
      }

      // Validate counted quantity
      const countedQty = parseFloat(countedQuantity);
      if (isNaN(countedQty) || countedQty < 0) {
        errors.push({ field: 'counted_quantity', message: 'Counted quantity must be a valid non-negative number' });
      }

      // Validate unit average cost
      const unitCost = parseFloat(unitAverageCost);
      if (isNaN(unitCost) || unitCost < 0) {
        errors.push({ field: 'unit_average_cost', message: 'Unit average cost must be a valid non-negative number' });
      }

      // Validate batch number (optional)
      if (batchNumber && batchNumber.toString().trim() !== '') {
        const batchNumberStr = batchNumber.toString().trim();
        // Basic validation - batch number should not be empty if provided
        if (batchNumberStr.length === 0) {
          errors.push({ field: 'batch_number', message: 'Batch number cannot be empty if provided' });
        }
      }

      // Validate expiry date (optional)
      if (expiryDate && expiryDate.toString().trim() !== '') {
        const expiryDateStr = expiryDate.toString().trim();
        const expiryDateObj = new Date(expiryDateStr);
        if (isNaN(expiryDateObj.getTime())) {
          errors.push({ field: 'expiry_date', message: 'Expiry date must be in valid date format (YYYY-MM-DD)' });
        }
      }

      // Validate serial numbers (optional)
      if (serialNumbers && serialNumbers.toString().trim() !== '') {
        const serialNumbersStr = serialNumbers.toString().trim();
        // Basic validation - should be comma-separated
        if (serialNumbersStr.includes(',') && serialNumbersStr.split(',').some(sn => sn.trim() === '')) {
          errors.push({ field: 'serial_numbers', message: 'Serial numbers should not contain empty values when comma-separated' });
        }
      }

      if (errors.length > 0) {
        errors.forEach(error => {
          validationErrors.push({
            row: rowNumber,
            field: error.field,
            message: error.message
          });
        });
      } else {
        validatedItems.push({
          product_id: row.product_id,
          product_code: productCode.toString().trim(),
          product_name: row.product_name,
          current_quantity: parseFloat(currentQuantity) || 0,
          counted_quantity: countedQty,
          unit_average_cost: unitCost,
          // Optional fields - convert empty strings to null
          batch_number: batchNumber && batchNumber.toString().trim() !== '' ? batchNumber.toString().trim() : null,
          expiry_date: expiryDate && expiryDate.toString().trim() !== '' ? expiryDate.toString().trim() : null,
          serial_numbers: serialNumbers && serialNumbers.toString().trim() !== '' ? serialNumbers.toString().trim() : null,
          notes: row.notes || ''
        });
      }
    });

    // Clean up uploaded file
    const fs = require('fs');
    try {
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
        }
    } catch (cleanupError) {
      }

    // Auto-assign products to store if not already assigned
    const { store_id } = req.body;
    if (store_id && validatedItems.length > 0) {
      const ProductStore = require('../models/productStore');
      const productIds = validatedItems.map(item => item.product_id);
      
      try {
        // Check existing assignments
        const existingAssignments = await ProductStore.findAll({
            where: {
            product_id: productIds,
            store_id: store_id
          },
          attributes: ['product_id']
        });
        
        const existingProductIds = existingAssignments.map(assignment => assignment.product_id);
        const missingProductIds = productIds.filter(productId => !existingProductIds.includes(productId));
        
        if (missingProductIds.length > 0) {
          // Create missing ProductStore records (with company filter)
          const { buildCompanyWhere } = require('../middleware/companyFilter');
          const productStoreRecords = missingProductIds.map(productId => ({
            product_id: productId,
            store_id: store_id,
            quantity: 0,
            min_quantity: 0,
            reorder_point: 0,
            average_cost: 0,
            is_active: true,
            assigned_by: req.user.id,
            assigned_at: new Date(),
            companyId: req.user.companyId // Add companyId for multi-tenant support
          }));
          
          await ProductStore.bulkCreate(productStoreRecords);
          } else {
          }
      } catch (assignmentError) {
        // Don't fail the validation
      }
    }

    res.json({
      success: true,
      data: validatedItems,
      errors: validationErrors,
      summary: {
        totalRows: data.length,
        validRows: validatedItems.length,
        errorRows: validationErrors.length
      }
    });

  } catch (error) {
    // Clean up uploaded file in case of error
    try {
      if (req.file && req.file.path) {
        const fs = require('fs');
        fs.unlinkSync(req.file.path);
        }
    } catch (cleanupError) {
      }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to validate items', 
      details: error.message 
    });
  }
});

// Get all Physical Inventories with pagination and filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      store_id = '',
      start_date = '',
      end_date = '',
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    // Build company filter - CRITICAL: Ensure companyId is set
    const baseWhere = {};
    if (req.user.isSystemAdmin) {
      // Super-admin: no filter, leave baseWhere empty
    } else if (req.user.companyId) {
      // Regular user: filter by companyId
      baseWhere.companyId = req.user.companyId;
    } else {
      // No companyId - should not happen but handle gracefully
      return res.status(403).json({
        success: false,
        message: 'Company access required'
      });
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      status,
      storeId: store_id,
      startDate: start_date,
      endDate: end_date,
      sortBy: sort_by,
      sortOrder: sort_order.toUpperCase(),
      companyId: req.user.companyId
    };

    const result = await PhysicalInventoryService.getPhysicalInventories(options, baseWhere);
    
    res.json({ 
      success: true,
      data: result.physicalInventories,
      pagination: result.pagination
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch physical inventories',
      error: error.message
    });
  }
});

// Download import template
router.get('/import-template', async (req, res) => {
  try {
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();
    
    // Create template with sample data - including batch, expiry, and serial tracking
    const templateData = [
      {
        product_code: '0000199',
        counted_quantity: 95,
        unit_average_cost: 25.50,
        batch_number: 'BATCH001',
        expiry_date: '2025-12-31',
        serial_numbers: 'SN001,SN002,SN003',
        notes: 'Sample note'
      },
      {
        product_code: '0000198', 
        counted_quantity: 52,
        unit_average_cost: 15.75,
        batch_number: 'BATCH002',
        expiry_date: '2026-06-15',
        serial_numbers: 'SN004,SN005',
        notes: ''
      }
    ];

    const buffer = await exportService.exportPhysicalInventoryItemsTemplate(templateData);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="physical_inventory_items_template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    
    res.send(buffer);
    } catch (error) {
    res.status(500).json({ 
      error: 'Failed to download template', 
      details: error.message 
    });
  }
});

// Get Physical Inventory by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.getPhysicalInventoryById(id);

    res.json({
      success: true,
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventory',
      error: error.message
    });
  }
});

// Create Physical Inventory as Draft
router.post('/draft', validatePhysicalInventory, csrfProtection, async (req, res) => {
  try {
    const physicalInventory = await PhysicalInventoryService.createDraft(req.body, req.user.id, req.user.companyId);

    res.status(201).json({ 
      success: true,
      message: 'Physical inventory saved as draft successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to create physical inventory draft',
      error: error.message
    });
  }
});

// Update Physical Inventory
router.put('/:id', validatePhysicalInventory, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.updatePhysicalInventory(id, req.body, req.user.id, req.user.companyId);

      res.json({ 
        success: true, 
      message: 'Physical inventory updated successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to update physical inventory',
      error: error.message
    });
  }
});

// Submit Physical Inventory for approval
router.patch('/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.submitPhysicalInventory(id, req.user.id);

      res.json({ 
        success: true, 
      message: 'Physical inventory submitted for approval successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to submit physical inventory',
      error: error.message
    });
  }
});

// Approve Physical Inventory
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { approval_notes } = req.body;
    
    // Validate user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'User not authenticated'
      });
    }
    
    // Verify physical inventory exists and belongs to user's company
    const physicalInventory = await PhysicalInventory.findOne({
      where: buildCompanyWhere(req, { id }),
      include: [
        {
          model: PhysicalInventoryItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product'
            }
          ]
        }
      ]
    });
    
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found',
        error: 'Physical inventory not found or access denied'
      });
    }
    
    // CRITICAL: Clean exchange_rate immediately after fetching
    // Sequelize returns DECIMAL as strings, and malformed values like "1.0032.5" will be returned as-is
    const rawExchangeRate = physicalInventory.exchange_rate;
    
    // Clean exchange_rate if it's malformed (check for multiple decimal points)
    if (rawExchangeRate) {
      const rateStr = String(rawExchangeRate);
      const dotCount = (rateStr.match(/\./g) || []).length;
      if (dotCount > 1 || isNaN(parseFloat(rateStr))) {
        const cleaned = PhysicalInventoryService.cleanNumericString(rawExchangeRate);
        const cleanedNum = parseFloat(cleaned);
        if (!isNaN(cleanedNum) && isFinite(cleanedNum)) {
          await physicalInventory.update({ exchange_rate: cleanedNum });
        }
      }
    }
    
    // Also check and clean item exchange_rates
    if (physicalInventory.items && physicalInventory.items.length > 0) {
      for (const item of physicalInventory.items) {
        if (item.exchange_rate) {
          const itemRateStr = String(item.exchange_rate);
          const itemDotCount = (itemRateStr.match(/\./g) || []).length;
          if (itemDotCount > 1 || isNaN(parseFloat(itemRateStr))) {
            const cleaned = PhysicalInventoryService.cleanNumericString(item.exchange_rate);
            const cleanedNum = parseFloat(cleaned);
            if (!isNaN(cleanedNum) && isFinite(cleanedNum)) {
              await item.update({ exchange_rate: cleanedNum });
            }
          }
        }
      }
    }
    
    // Check if inventory can be approved
    if (physicalInventory.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Only submitted physical inventories can be approved',
        error: `Current status: ${physicalInventory.status}`
      });
    }
    
    const approvedInventory = await PhysicalInventoryService.approvePhysicalInventory(id, req.user, approval_notes);

    res.json({ 
      success: true, 
      message: 'Physical inventory approved successfully',
      data: approvedInventory
    });
  } catch (error) {
    // Enhanced error logging
    console.error('[Physical Inventory Approval Error]', {
      id: req.params.id,
      userId: req.user?.id,
      companyId: req.user?.companyId,
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      validationErrors: error.errors || (error.name === 'SequelizeValidationError' ? error.errors : null),
      stack: error.stack
    });
    
    // Provide more detailed error message for validation errors
    let errorMessage = error.message;
    if (error.name === 'SequelizeValidationError' && error.errors && error.errors.length > 0) {
      const validationDetails = error.errors.map(e => `${e.path}: ${e.message}`).join(', ');
      errorMessage = `Validation error: ${validationDetails}`;
      console.error('[Validation Error Details]', error.errors);
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Failed to approve physical inventory',
      error: errorMessage
    });
  }
});

// Reject Physical Inventory
router.patch('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    
    if (!rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const physicalInventory = await PhysicalInventoryService.rejectPhysicalInventory(id, rejection_reason, req.user.id);

    res.json({ 
      success: true,
      message: 'Physical inventory rejected successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to reject physical inventory',
      error: error.message
    });
  }
});

// Return Physical Inventory for Correction
router.patch('/:id/return', async (req, res) => {
  try {
    const { id } = req.params;
    const { return_reason } = req.body;
    
    if (!return_reason) {
      return res.status(400).json({
        success: false,
        message: 'Return reason is required'
      });
    }

    const physicalInventory = await PhysicalInventoryService.returnPhysicalInventoryForCorrection(id, return_reason, req.user.id);

    res.json({ 
      success: true,
      message: 'Physical inventory returned for correction successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to return physical inventory for correction',
      error: error.message
    });
  }
});

// Accept Variance for Physical Inventory
router.patch('/:id/accept-variance', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      totalDeltaValue, 
      positiveDeltaValue, 
      negativeDeltaValue, 
      notes 
    } = req.body;
    
    const varianceData = {
      totalDeltaValue: parseFloat(totalDeltaValue) || 0,
      positiveDeltaValue: parseFloat(positiveDeltaValue) || 0,
      negativeDeltaValue: parseFloat(negativeDeltaValue) || 0,
      notes: notes || null
    };

    const physicalInventory = await PhysicalInventoryService.acceptVariance(id, varianceData, req.user.id);

    res.json({ 
      success: true,
      message: 'Variance accepted successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to accept variance',
      error: error.message
    });
  }
});

// Delete Physical Inventory
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await PhysicalInventoryService.deletePhysicalInventory(id);

    res.json({ 
      success: true,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete physical inventory',
      error: error.message
    });
  }
});

// Get Physical Inventory Statistics
router.get('/stats/overview', async (req, res) => {
  try {
    // Pass companyId to the service method
    const companyId = req.user.isSystemAdmin ? null : req.user.companyId;
    const stats = await PhysicalInventoryService.getPhysicalInventoryStats(companyId);

    res.json({ 
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventory statistics',
      error: error.message
    });
  }
});

// Get Physical Inventory Items by Physical Inventory ID
router.get('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    
    // First verify the physical inventory belongs to the company
    const physicalInventory = await PhysicalInventory.findOne({
      where: buildCompanyWhere(req, { id })
    });
    
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }
    
    const items = await PhysicalInventoryItem.findAll({
      where: buildCompanyWhere(req, { physical_inventory_id: id }),
      include: [
        { model: Product, as: 'product' },
        { model: AdjustmentReason, as: 'adjustmentInReason' },
        { model: AdjustmentReason, as: 'adjustmentOutReason' }
      ],
      order: [['created_at', 'ASC']]
    });

    res.json({ 
      success: true,
      data: items
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventory items',
      error: error.message
    });
  }
});

// Add item to Physical Inventory
router.post('/:id/items', csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const itemData = req.body;

    // Check if physical inventory exists and is in draft or returned_for_correction status
    const physicalInventory = await PhysicalInventory.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }

    if (physicalInventory.status !== 'draft' && physicalInventory.status !== 'returned_for_correction') {
      return res.status(400).json({
        success: false,
        message: 'Items can only be added to draft or returned for correction physical inventories'
      });
    }

    // Calculate item values
    const calculatedValues = PhysicalInventoryService.calculateItemValues(itemData);

    // Helper function to safely parse numeric values
    const safeParseFloat = (value, defaultValue = 0) => {
      if (value === null || value === undefined || value === '') {
        return defaultValue;
      }
      // Remove all non-numeric characters except first decimal point and minus sign
      let cleaned = String(value).replace(/[^0-9.-]/g, '');
      // Handle negative sign
      const isNegative = cleaned.startsWith('-');
      cleaned = cleaned.replace(/-/g, '');
      if (isNegative) {
        cleaned = '-' + cleaned;
      }
      // Handle multiple decimal points
      if (cleaned.includes('.')) {
        const firstDotIndex = cleaned.indexOf('.');
        const beforeDot = cleaned.substring(0, firstDotIndex + 1);
        const afterDot = cleaned.substring(firstDotIndex + 1).replace(/\./g, '');
        cleaned = beforeDot + afterDot;
      }
      if (cleaned === '' || cleaned === '-') {
        return defaultValue;
      }
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? defaultValue : parsed;
    };

    // Create the item
    const item = await PhysicalInventoryItem.create({
      physical_inventory_id: id,
      product_id: itemData.product_id,
      current_quantity: safeParseFloat(itemData.current_quantity, 0),
      counted_quantity: safeParseFloat(itemData.counted_quantity, 0),
      adjustment_in_quantity: calculatedValues.adjustment_in_quantity,
      adjustment_out_quantity: calculatedValues.adjustment_out_quantity,
      adjustment_in_reason_id: itemData.adjustment_in_reason_id,
      adjustment_out_reason_id: itemData.adjustment_out_reason_id,
      unit_cost: safeParseFloat(itemData.unit_cost, 0),
      unit_average_cost: safeParseFloat(itemData.unit_average_cost, 0),
      new_stock: calculatedValues.new_stock,
      total_value: calculatedValues.total_value,
      exchange_rate: safeParseFloat(itemData.exchange_rate, 1.0),
      equivalent_amount: calculatedValues.equivalent_amount,
      expiry_date: itemData.expiry_date,
      batch_number: itemData.batch_number,
      serial_numbers: itemData.serial_numbers || [],
      notes: itemData.notes,
      companyId: req.user.companyId // Add companyId for multi-tenant isolation
    });

    // Update physical inventory totals
    const totalItems = await PhysicalInventoryItem.count({ where: { physical_inventory_id: id } });
    const totalValue = await PhysicalInventoryItem.sum('total_value', { where: { physical_inventory_id: id } });

    await physicalInventory.update({
      total_items: totalItems,
      total_value: totalValue || 0
    });

    // Return the created item with relations
    const createdItem = await PhysicalInventoryItem.findByPk(item.id, {
      include: [
        { model: Product, as: 'product' },
        { model: AdjustmentReason, as: 'adjustmentInReason' },
        { model: AdjustmentReason, as: 'adjustmentOutReason' }
      ]
    });

    res.status(201).json({
      success: true, 
      message: 'Item added to physical inventory successfully',
      data: createdItem
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add item to physical inventory',
      error: error.message
    });
  }
});

// Update Physical Inventory Item
router.put('/:id/items/:itemId', csrfProtection, async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const itemData = req.body;

    // Check if physical inventory exists and is in draft status
    const physicalInventory = await PhysicalInventory.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }

    if (physicalInventory.status !== 'draft' && physicalInventory.status !== 'returned_for_correction') {
      return res.status(400).json({
        success: false,
        message: 'Items can only be updated in draft or returned for correction physical inventories'
      });
    }

    // Find the item (with company filter)
    const item = await PhysicalInventoryItem.findOne({
      where: buildCompanyWhere(req, {
        id: itemId,
        physical_inventory_id: id 
      })
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory item not found'
      });
    }

    // Helper function to safely parse numeric values
    const safeParseFloat = (value, defaultValue = 0) => {
      if (value === null || value === undefined || value === '') {
        return defaultValue;
      }
      // Remove all non-numeric characters except first decimal point and minus sign
      let cleaned = String(value).replace(/[^0-9.-]/g, '');
      // Handle negative sign
      const isNegative = cleaned.startsWith('-');
      cleaned = cleaned.replace(/-/g, '');
      if (isNegative) {
        cleaned = '-' + cleaned;
      }
      // Handle multiple decimal points
      if (cleaned.includes('.')) {
        const firstDotIndex = cleaned.indexOf('.');
        const beforeDot = cleaned.substring(0, firstDotIndex + 1);
        const afterDot = cleaned.substring(firstDotIndex + 1).replace(/\./g, '');
        cleaned = beforeDot + afterDot;
      }
      if (cleaned === '' || cleaned === '-') {
        return defaultValue;
      }
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? defaultValue : parsed;
    };

    // Calculate updated values
    const calculatedValues = PhysicalInventoryService.calculateItemValues(itemData);

    // Update the item
    await item.update({
      current_quantity: safeParseFloat(itemData.current_quantity, 0),
      counted_quantity: safeParseFloat(itemData.counted_quantity, 0),
      adjustment_in_quantity: calculatedValues.adjustment_in_quantity,
      adjustment_out_quantity: calculatedValues.adjustment_out_quantity,
      adjustment_in_reason_id: itemData.adjustment_in_reason_id,
      adjustment_out_reason_id: itemData.adjustment_out_reason_id,
      unit_cost: safeParseFloat(itemData.unit_cost, 0),
      unit_average_cost: safeParseFloat(itemData.unit_average_cost, 0),
      new_stock: calculatedValues.new_stock,
      total_value: calculatedValues.total_value,
      exchange_rate: safeParseFloat(itemData.exchange_rate, 1.0),
      equivalent_amount: calculatedValues.equivalent_amount,
      expiry_date: itemData.expiry_date,
      batch_number: itemData.batch_number,
      serial_numbers: itemData.serial_numbers || [],
      notes: itemData.notes
    });

    // Update physical inventory totals
    const totalValue = await PhysicalInventoryItem.sum('total_value', { where: { physical_inventory_id: id } });
    await physicalInventory.update({
      total_value: totalValue || 0
    });

    // Return the updated item with relations
    const updatedItem = await PhysicalInventoryItem.findByPk(itemId, {
      include: [
        { model: Product, as: 'product' },
        { model: AdjustmentReason, as: 'adjustmentInReason' },
        { model: AdjustmentReason, as: 'adjustmentOutReason' }
      ]
    });

    res.json({ 
      success: true, 
      message: 'Physical inventory item updated successfully',
      data: updatedItem
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update physical inventory item',
      error: error.message
    });
  }
});

// Delete Physical Inventory Item
router.delete('/:id/items/:itemId', csrfProtection, async (req, res) => {
  try {
    const { id, itemId } = req.params;

    // Check if physical inventory exists and is in draft status
    const physicalInventory = await PhysicalInventory.findOne({
      where: buildCompanyWhere(req, { id })
    });
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }

    if (physicalInventory.status !== 'draft' && physicalInventory.status !== 'returned_for_correction') {
      return res.status(400).json({
        success: false,
        message: 'Items can only be deleted from draft or returned for correction physical inventories'
      });
    }

    // Find and delete the item (with company filter)
    const item = await PhysicalInventoryItem.findOne({
      where: buildCompanyWhere(req, { 
        id: itemId,
        physical_inventory_id: id 
      })
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory item not found'
      });
    }

    await item.destroy();

    // Update physical inventory totals
    const totalItems = await PhysicalInventoryItem.count({ where: { physical_inventory_id: id } });
    const totalValue = await PhysicalInventoryItem.sum('total_value', { where: { physical_inventory_id: id } });

    await physicalInventory.update({
      total_items: totalItems,
      total_value: totalValue || 0
    });

    res.json({ 
      success: true, 
      message: 'Physical inventory item deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete physical inventory item',
      error: error.message
    });
  }
});

// Export physical inventories to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { Op } = require('sequelize');
    
    // Build where clause for export filters
    const whereClause = {};
    
    if (req.query.search) {
      whereClause[Op.or] = [
        { reference_number: { [Op.iLike]: `%${req.query.search}%` } },
        { notes: { [Op.iLike]: `%${req.query.search}%` } }
      ];
    }
    
    if (req.query.status && req.query.status !== 'all') {
      whereClause.status = req.query.status;
    }
    
    if (req.query.store_id) {
      whereClause.store_id = req.query.store_id;
    }
    
    if (req.query.start_date && req.query.end_date) {
      whereClause.inventory_date = {
        [Op.between]: [req.query.start_date, req.query.end_date]
      };
    } else if (req.query.start_date) {
      whereClause.inventory_date = {
        [Op.gte]: req.query.start_date
      };
    } else if (req.query.end_date) {
      whereClause.inventory_date = {
        [Op.lte]: req.query.end_date
      };
    }

    // Fetch physical inventories with all necessary relations for export
    const physicalInventories = await PhysicalInventory.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'symbol'],
          required: false
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'submitter',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'approver',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'returner',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'varianceAcceptor',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Transform data for export
    const transformedPhysicalInventories = physicalInventories.map(inventory => ({
      ...inventory.toJSON(),
      store_name: inventory.store?.name || 'Unknown Store',
      currency_name: inventory.currency?.name || 'Unknown Currency',
      created_by_name: inventory.creator ? `${inventory.creator.first_name} ${inventory.creator.last_name}` : 'System',
      updated_by_name: inventory.updater ? `${inventory.updater.first_name} ${inventory.updater.last_name}` : null,
      submitted_by_name: inventory.submitter ? `${inventory.submitter.first_name} ${inventory.submitter.last_name}` : null,
      approved_by_name: inventory.approver ? `${inventory.approver.first_name} ${inventory.approver.last_name}` : null,
      returned_by_name: inventory.returner ? `${inventory.returner.first_name} ${inventory.returner.last_name}` : null,
      variance_accepted_by_name: inventory.varianceAcceptor ? `${inventory.varianceAcceptor.first_name} ${inventory.varianceAcceptor.last_name}` : null
    }));

    // Create export service instance
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();
    
    // Generate Excel file
    const buffer = await exportService.exportPhysicalInventoriesToExcel(transformedPhysicalInventories, req.query);
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="physical_inventories_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    
    // Send the file
    res.send(buffer);
    
    } catch (error) {
    res.status(500).json({ 
      error: 'Failed to export physical inventories to Excel', 
      details: error.message 
    });
  }
});

// Export physical inventories to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { Op } = require('sequelize');
    
    // Build where clause for export filters (same as Excel)
    const whereClause = {};
    
    if (req.query.search) {
      whereClause[Op.or] = [
        { reference_number: { [Op.iLike]: `%${req.query.search}%` } },
        { notes: { [Op.iLike]: `%${req.query.search}%` } }
      ];
    }
    
    if (req.query.status && req.query.status !== 'all') {
      whereClause.status = req.query.status;
    }
    
    if (req.query.store_id) {
      whereClause.store_id = req.query.store_id;
    }
    
    if (req.query.start_date && req.query.end_date) {
      whereClause.inventory_date = {
        [Op.between]: [req.query.start_date, req.query.end_date]
      };
    } else if (req.query.start_date) {
      whereClause.inventory_date = {
        [Op.gte]: req.query.start_date
      };
    } else if (req.query.end_date) {
      whereClause.inventory_date = {
        [Op.lte]: req.query.end_date
      };
    }

    // Fetch physical inventories with all necessary relations for export
    const physicalInventories = await PhysicalInventory.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Store,
          as: 'store',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Currency,
          as: 'currency',
          attributes: ['id', 'name', 'symbol'],
          required: false
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'submitter',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'approver',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'returner',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        },
        {
          model: User,
          as: 'varianceAcceptor',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          required: false
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Transform data for export
    const transformedPhysicalInventories = physicalInventories.map(inventory => ({
      ...inventory.toJSON(),
      store_name: inventory.store?.name || 'Unknown Store',
      currency_name: inventory.currency?.name || 'Unknown Currency',
      created_by_name: inventory.creator ? `${inventory.creator.first_name} ${inventory.creator.last_name}` : 'System',
      updated_by_name: inventory.updater ? `${inventory.updater.first_name} ${inventory.updater.last_name}` : null,
      submitted_by_name: inventory.submitter ? `${inventory.submitter.first_name} ${inventory.submitter.last_name}` : null,
      approved_by_name: inventory.approver ? `${inventory.approver.first_name} ${inventory.approver.last_name}` : null,
      returned_by_name: inventory.returner ? `${inventory.returner.first_name} ${inventory.returner.last_name}` : null,
      variance_accepted_by_name: inventory.varianceAcceptor ? `${inventory.varianceAcceptor.first_name} ${inventory.varianceAcceptor.last_name}` : null
    }));

    // Create export service instance
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();
    
    // Generate PDF file
    const buffer = await exportService.exportPhysicalInventoriesToPDF(transformedPhysicalInventories, req.query);
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="physical_inventories_export_${new Date().toISOString().split('T')[0]}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    
    // Send the file
    res.send(buffer);
    
    } catch (error) {
    res.status(500).json({ 
      error: 'Failed to export physical inventories to PDF', 
      details: error.message 
    });
  }
});

module.exports = router; 
