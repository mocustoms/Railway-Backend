const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { sequelize } = require('../models');
const { Op } = require('sequelize');
const autoCodeService = require('../utils/autoCodeService');
const PriceHistoryService = require('../utils/priceHistoryService');
const { getUploadDir } = require('../utils/uploadsPath');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Import models
const { Product, ProductCategory, ProductBrandName, ProductManufacturer, ProductModel, ProductColor, TaxCode, ProductStoreLocation, Packaging } = require('../models');

// Configure multer for file uploads (uses UPLOAD_PATH for Railway Volume / partition)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = getUploadDir('temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

// Download template
router.get('/template', csrfProtection, async (req, res) => {
  try {
    // Create workbook with template structure
    const workbook = XLSX.utils.book_new();
    
    // Define headers based on product model
    const headers = [
      'Product Type*',
      'Code', // Optional - will be auto-generated if not provided
      'Barcode',
      'Name*',
      'Part Number',
      'Description',
      'Category',
      'Brand Name',
      'Manufacturer',
      'Model',
      'Color',
      'Size',
      'Weight',
      'Unit',
      'Average Cost*',
      'Selling Price*',
      'Purchases Tax',
      'Sales Tax',
      'Min Quantity',
      'Max Quantity',
      'Reorder Point',
      'Default Quantity',
      'Price Tax Inclusive',
      'Expiry Notification Days',
      'Track Serial Number',
      'Store Location',
      'Status*'
    ];

    // Add sample data row (Code is optional - leave empty for auto-generation)
    const sampleData = [
      'resale',
      '', // Code will be auto-generated
      '1234567890123',
      'Sample Product',
      'PART001',
      'Sample product description',
      'Electronics',
      'Sample Brand',
      'Sample Manufacturer',
      'Sample Model',
      'Black',
      'Medium',
      '1.5',
      'PCS',
      '100.00',
      '150.00',
      'VAT',
      'VAT',
      '10',
      '100',
      '20',
      '1',
      'false',
      '30',
      'false',
      'Main Store',
      'active'
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([headers, sampleData]);
    
    // Set column widths
    const columnWidths = [
      { wch: 15 }, // Product Type
      { wch: 12 }, // Code
      { wch: 15 }, // Barcode
      { wch: 25 }, // Name
      { wch: 15 }, // Part Number
      { wch: 30 }, // Description
      { wch: 15 }, // Category
      { wch: 15 }, // Brand Name
      { wch: 20 }, // Manufacturer
      { wch: 15 }, // Model
      { wch: 10 }, // Color
      { wch: 10 }, // Size
      { wch: 10 }, // Weight
      { wch: 8 },  // Unit
      { wch: 12 }, // Average Cost
      { wch: 12 }, // Selling Price
      { wch: 12 }, // Purchases Tax
      { wch: 10 }, // Sales Tax
      { wch: 12 }, // Min Quantity
      { wch: 12 }, // Max Quantity
      { wch: 12 }, // Reorder Point
      { wch: 12 }, // Default Quantity
      { wch: 15 }, // Price Tax Inclusive
      { wch: 15 }, // Expiry Notification Days
      { wch: 15 }, // Track Serial Number
      { wch: 15 }, // Store Location
      { wch: 10 }  // Status
    ];
    worksheet['!cols'] = columnWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products Template');

    // Add instructions sheet
    const instructions = [
      ['Instructions for Product Import'],
      [''],
      ['Required Fields (marked with *):'],
      ['- Product Type: resale, raw_materials, manufactured, services, pharmaceuticals'],
      ['- Name: Product name'],
      ['- Average Cost: Product average cost'],
      ['- Selling Price: Product selling price'],
      ['- Status: active or inactive'],
      [''],
      ['Optional Fields:'],
      ['- Code: Product code (will be auto-generated if not provided)'],
      ['- All other fields are optional and can be left empty'],
      ['- Category, Brand Name, Manufacturer, Model, Color: Must exist in the system'],
      ['- Purchases Tax, Sales Tax: Must exist in the system (can be provided by code or name)'],
      ['- Store Location: Must exist in the system (use location name)'],
      ['- Unit: Must exist in the system (packaging name)'],
      ['- Min Quantity, Max Quantity, Reorder Point: Numeric values'],
      ['- Price Tax Inclusive, Track Serial Number: true or false'],
      ['- Expiry Notification Days: Number of days'],
      [''],
      ['Notes:'],
      ['- Do not modify the header row'],
      ['- Remove the sample data row before adding your data'],
      ['- Ensure all required fields are filled'],
      ['- Check that referenced data (categories, brands, etc.) exists in the system'],
      ['- Product codes will be auto-generated using the same format as manual creation']
    ];

    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
    res.send(buffer);

  } catch (error) {
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// Upload and validate file
router.post('/upload', csrfProtection, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (data.length < 2) {
      return res.status(400).json({ error: 'File is empty or missing data' });
    }

    const headers = data[0];
    const rows = data.slice(1);
    
    const errors = [];
    const validData = [];

    // Validate each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because we start from row 2 (after header)
      
      if (row.length === 0 || row.every(cell => !cell)) {
        continue; // Skip empty rows
      }

      const rowData = {};
      const rowErrors = [];

      // Map headers to data
      headers.forEach((header, index) => {
        rowData[header] = row[index] || '';
      });

      // Validate required fields
      if (!rowData['Product Type*']) {
        rowErrors.push('Product Type is required');
      } else if (!['resale', 'raw_materials', 'manufactured', 'services', 'pharmaceuticals'].includes(rowData['Product Type*'])) {
        rowErrors.push('Invalid Product Type. Must be one of: resale, raw_materials, manufactured, services, pharmaceuticals');
      }

      if (!rowData['Name*']) {
        rowErrors.push('Name is required');
      }

      if (!rowData['Average Cost*'] || isNaN(parseFloat(rowData['Average Cost*']))) {
        rowErrors.push('Valid Average Cost is required');
      }

      if (!rowData['Selling Price*'] || isNaN(parseFloat(rowData['Selling Price*']))) {
        rowErrors.push('Valid Selling Price is required');
      }

      if (!rowData['Status*'] || !['active', 'inactive'].includes(rowData['Status*'])) {
        rowErrors.push('Status must be either "active" or "inactive"');
      }

      // Validate optional references (with company filtering)
      if (rowData['Category']) {
        const category = await ProductCategory.findOne({ 
          where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Category'].trim() } })
        });
        if (!category) {
          rowErrors.push(`Category "${rowData['Category']}" does not exist`);
        }
      }

      if (rowData['Brand Name']) {
        const brand = await ProductBrandName.findOne({ 
          where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Brand Name'].trim() } })
        });
        if (!brand) {
          rowErrors.push(`Brand Name "${rowData['Brand Name']}" does not exist`);
        }
      }

      if (rowData['Manufacturer']) {
        const manufacturer = await ProductManufacturer.findOne({ 
          where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Manufacturer'].trim() } })
        });
        if (!manufacturer) {
          rowErrors.push(`Manufacturer "${rowData['Manufacturer']}" does not exist`);
        }
      }

      if (rowData['Purchases Tax']) {
        // Try both code and name for TaxCode lookup
        const purchasesTax = await TaxCode.findOne({ 
          where: buildCompanyWhere(req, {
            [Op.or]: [
              { code: rowData['Purchases Tax'] },
              { name: rowData['Purchases Tax'] }
            ]
          })
        });
        if (!purchasesTax) {
          rowErrors.push(`Purchases Tax "${rowData['Purchases Tax']}" does not exist`);
        }
      }

      if (rowData['Sales Tax']) {
        // Try both code and name for TaxCode lookup
        const salesTax = await TaxCode.findOne({ 
          where: buildCompanyWhere(req, {
            [Op.or]: [
              { code: rowData['Sales Tax'] },
              { name: rowData['Sales Tax'] }
            ]
          })
        });
        if (!salesTax) {
          rowErrors.push(`Sales Tax "${rowData['Sales Tax']}" does not exist`);
        }
      }

      if (rowData['Store Location']) {
        // Use case-insensitive matching for location name
        const storeLocation = await ProductStoreLocation.findOne({ 
          where: buildCompanyWhere(req, { 
            location_name: { [Op.iLike]: rowData['Store Location'].trim() }
          })
        });
        if (!storeLocation) {
          rowErrors.push(`Store Location "${rowData['Store Location']}" does not exist`);
        }
      }

      // Validate barcode uniqueness (if provided)
      if (rowData['Barcode'] && rowData['Barcode'].trim() !== '') {
        const existingProductWithBarcode = await Product.findOne({ 
          where: buildCompanyWhere(req, { barcode: rowData['Barcode'].trim() })
        });
        if (existingProductWithBarcode) {
          rowErrors.push(`Product barcode "${rowData['Barcode'].trim()}" already exists in your company`);
        }
      }

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
      } else {
        validData.push(rowData);
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      data: validData,
      errors: errors,
      totalRows: rows.length,
      validRows: validData.length,
      errorRows: errors.length
    });

  } catch (error) {
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'Failed to process uploaded file' });
  }
});

// Import validated data
router.post('/data', csrfProtection, async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      try {
        const rowData = data[i];
        
        // Start transaction for code generation and product creation
        const transaction = await sequelize.transaction();
        
        try {
          // Handle both 'Code' and 'Code*' headers for backward compatibility
          const providedCode = rowData['Code'] || rowData['Code*'] || '';
          
          // Check if product with same code already exists (if code provided)
          if (providedCode && providedCode.trim() !== '') {
            const existingProduct = await Product.findOne({ 
              where: buildCompanyWhere(req, { code: providedCode.trim() }),
              transaction
            });
            if (existingProduct) {
              await transaction.rollback();
              skipped++;
              continue;
            }
          }

          // Check if product with same barcode already exists (if barcode provided)
          const providedBarcode = rowData['Barcode'] || '';
          if (providedBarcode && providedBarcode.trim() !== '') {
            const existingProductWithBarcode = await Product.findOne({ 
              where: buildCompanyWhere(req, { barcode: providedBarcode.trim() }),
              transaction
            });
            if (existingProductWithBarcode) {
              await transaction.rollback();
              errors.push({
                row: i + 1,
                message: `Product barcode "${providedBarcode.trim()}" already exists in your company`
              });
              continue;
            }
          }

          // Auto-generate product code using the same service as create endpoint
          let code = providedCode.trim();
          if (!code || code === '') {
            code = await autoCodeService.generateNextCode(
              'products',
              req.user.companyId,
              {
                transaction,
                fallbackPrefix: 'PROD',
                fallbackFormat: '{PREFIX}-{YEAR}-{NUMBER}'
              }
            );
          }

          // Find related entities (with company filtering and case-insensitive matching)
          let categoryId = null;
          let cogsAccountId = null;
          let incomeAccountId = null;
          let assetAccountId = null;
          let categoryTaxCodeId = null;
          let categoryPurchasesTaxId = null;
          
          if (rowData['Category']) {
            const category = await ProductCategory.findOne({ 
              where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Category'].trim() } }),
              transaction
            });
            if (category) {
              categoryId = category.id;
              // Auto-populate accounts from category if they exist
              if (category.cogs_account_id) {
                cogsAccountId = category.cogs_account_id;
              }
              if (category.income_account_id) {
                incomeAccountId = category.income_account_id;
              }
              if (category.asset_account_id) {
                assetAccountId = category.asset_account_id;
              }
              // Auto-populate tax codes from category if they exist and not already provided
              if (category.tax_code_id && !rowData['Sales Tax']) {
                categoryTaxCodeId = category.tax_code_id;
              }
              if (category.purchases_tax_id && !rowData['Purchases Tax']) {
                categoryPurchasesTaxId = category.purchases_tax_id;
              }
            }
          }

          let brandNameId = null;
          if (rowData['Brand Name']) {
            const brand = await ProductBrandName.findOne({ 
              where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Brand Name'].trim() } }),
              transaction
            });
            brandNameId = brand?.id;
          }

          let manufacturerId = null;
          if (rowData['Manufacturer']) {
            const manufacturer = await ProductManufacturer.findOne({ 
              where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Manufacturer'].trim() } }),
              transaction
            });
            manufacturerId = manufacturer?.id;
          }

          let modelId = null;
          if (rowData['Model']) {
            const model = await ProductModel.findOne({ 
              where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Model'].trim() } }),
              transaction
            });
            modelId = model?.id;
          }

          let colorId = null;
          if (rowData['Color']) {
            const color = await ProductColor.findOne({ 
              where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Color'].trim() } }),
              transaction
            });
            colorId = color?.id;
          }

          let purchasesTaxId = categoryPurchasesTaxId; // Use category tax if not provided in import
          if (rowData['Purchases Tax']) {
            // Try both code and name for TaxCode lookup
            const purchasesTax = await TaxCode.findOne({ 
              where: buildCompanyWhere(req, {
                [Op.or]: [
                  { code: rowData['Purchases Tax'] },
                  { name: rowData['Purchases Tax'] }
                ]
              }),
              transaction
            });
            purchasesTaxId = purchasesTax?.id || purchasesTaxId; // Use provided tax if found, otherwise fall back to category tax
          }

          let salesTaxId = categoryTaxCodeId; // Use category tax if not provided in import
          if (rowData['Sales Tax']) {
            // Try both code and name for TaxCode lookup
            const salesTax = await TaxCode.findOne({ 
              where: buildCompanyWhere(req, {
                [Op.or]: [
                  { code: rowData['Sales Tax'] },
                  { name: rowData['Sales Tax'] }
                ]
              }),
              transaction
            });
            salesTaxId = salesTax?.id || salesTaxId; // Use provided tax if found, otherwise fall back to category tax
          }

          let storeLocationId = null;
          if (rowData['Store Location']) {
            // Use case-insensitive matching for location name
            const storeLocation = await ProductStoreLocation.findOne({ 
              where: buildCompanyWhere(req, { 
                location_name: { [Op.iLike]: rowData['Store Location'].trim() }
              }),
              transaction
            });
            storeLocationId = storeLocation?.id;
          }

          let unitId = null;
          if (rowData['Unit']) {
            // Use case-insensitive matching for unit/packaging name
            const unit = await Packaging.findOne({ 
              where: buildCompanyWhere(req, { name: { [Op.iLike]: rowData['Unit'].trim() } }),
              transaction
            });
            unitId = unit?.id;
          }

          // Create product within transaction
          const product = await Product.create({
            companyId: req.user.companyId,
            product_type: rowData['Product Type*'],
            code: code,
            barcode: rowData['Barcode'] || null,
            name: rowData['Name*'],
            part_number: rowData['Part Number'] || null,
            description: rowData['Description'] || null,
            category_id: categoryId,
            brand_id: brandNameId, // Use brand_id, not brand_name_id
            manufacturer_id: manufacturerId,
            model_id: modelId,
            color_id: colorId,
            unit_id: unitId, // Use unit_id, not unit
            store_location_id: storeLocationId,
            average_cost: parseFloat(rowData['Average Cost*']),
            selling_price: parseFloat(rowData['Selling Price*']),
            purchases_tax_id: purchasesTaxId,
            sales_tax_id: salesTaxId,
            // Auto-populate accounts from category if they exist
            cogs_account_id: cogsAccountId,
            income_account_id: incomeAccountId,
            asset_account_id: assetAccountId,
            min_quantity: rowData['Min Quantity'] ? parseFloat(rowData['Min Quantity']) : 0,
            max_quantity: rowData['Max Quantity'] ? parseFloat(rowData['Max Quantity']) : 0,
            reorder_point: rowData['Reorder Point'] ? parseFloat(rowData['Reorder Point']) : 0,
            default_quantity: rowData['Default Quantity'] ? parseInt(rowData['Default Quantity']) : null,
            price_tax_inclusive: rowData['Price Tax Inclusive'] === 'true',
            expiry_notification_days: rowData['Expiry Notification Days'] ? parseInt(rowData['Expiry Notification Days']) : null,
            track_serial_number: rowData['Track Serial Number'] === 'true',
            is_active: rowData['Status*'] === 'active',
            created_by: req.user.id,
            updated_by: req.user.id
          }, { transaction });

          // Track initial prices in price history for imported products (same as manual creation)
          try {
            const averageCost = parseFloat(rowData['Average Cost*']);
            const sellingPrice = parseFloat(rowData['Selling Price*']);
            
            if (averageCost || sellingPrice) {
              await PriceHistoryService.trackPriceChange({
                entityType: 'product',
                entityId: product.id,
                entityCode: product.code,
                entityName: product.name,
                moduleName: 'Product Catalog',
                oldAverageCost: null, // New product, no old cost
                newAverageCost: averageCost || null,
                oldSellingPrice: null, // New product, no old price
                newSellingPrice: sellingPrice || null,
                costingMethodCode: 'AVG', // Default to Average costing
                priceChangeReasonCode: 'INITIAL', // Initial setup
                userId: req.user.id,
                companyId: req.user.companyId,
                transactionDate: new Date(),
                notes: 'Initial product creation via Product Import'
              });
            }
          } catch (priceHistoryError) {
            // Don't fail the entire import if price history tracking fails
          }

          // Commit transaction
          await transaction.commit();
          
          imported++;
        } catch (rowError) {
          // Rollback transaction on error
          if (transaction && !transaction.finished) {
            await transaction.rollback();
          }
          throw rowError; // Re-throw to be caught by outer catch
        }

      } catch (error) {
        errors.push({
          row: i + 1,
          message: error.message
        });
      }
    }

    res.json({
      imported,
      skipped,
      errors,
      total: data.length
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to import data', details: error.message });
  }
});

module.exports = router;
