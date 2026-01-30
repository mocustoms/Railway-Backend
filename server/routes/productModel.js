const express = require('express');
const router = express.Router();
const ProductModel = require('../models/productModel');
const ProductCategory = require('../models/productCategory');
const User = require('../models/user');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const multer = require('multer');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);

// Get active models only (for dropdowns) - No authentication required
router.get('/active/list', async (req, res) => {
    try {
        const models = await ProductModel.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            attributes: ['id', 'code', 'name'],
            order: [['name', 'ASC']]
        });

        res.json(models);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active models', details: error.message });
    }
});

// Apply authentication to all other routes
router.use(auth);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

const { getUploadDir } = require('../utils/uploadsPath');

// Multer storage config for temporary uploads (uses UPLOAD_PATH for Railway Volume / partition)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = getUploadDir('temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const uniqueName = `${base}-${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Get all product models with related data
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 25, search = '', sortBy = 'code', sortOrder = 'asc' } = req.query;
        
        const offset = (page - 1) * limit;
        const whereClause = {};
        
        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } },
                { brand: { [Op.iLike]: `%${search}%` } },
                { model_number: { [Op.iLike]: `%${search}%` } }
            ];
        }

        const { count, rows: productModels } = await ProductModel.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Transform data to include related names
        const transformedProductModels = productModels.map(productModel => {
            const plainProductModel = productModel.get({ plain: true });
            return {
                ...plainProductModel,
                category_name: plainProductModel.category ? plainProductModel.category.name : null,
                created_by_name: plainProductModel.createdByUser ? 
                    `${plainProductModel.createdByUser.first_name} ${plainProductModel.createdByUser.last_name}` : null,
                updated_by_name: plainProductModel.updatedByUser ? 
                    `${plainProductModel.updatedByUser.first_name} ${plainProductModel.updatedByUser.last_name}` : null,
                createdAt: plainProductModel.created_at || plainProductModel.createdAt,
                updatedAt: plainProductModel.updated_at || plainProductModel.updatedAt
            };
        });

        res.json({
            productModels: transformedProductModels,
            pagination: {
                totalItems: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit),
                startIndex: offset,
                endIndex: Math.min(offset + parseInt(limit), count)
            }
        });
    } catch (error) {
        if (error && error.stack) {
            }
        res.status(500).json({ error: 'Failed to fetch product models', details: error.message });
    }
});

// Get single product model by ID
router.get('/:id', async (req, res) => {
    try {
        const productModel = await ProductModel.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        if (!productModel) {
            return res.status(404).json({ message: 'Product model not found' });
        }

        const plainProductModel = productModel.get({ plain: true });
        const transformedProductModel = {
            ...plainProductModel,
            category_name: plainProductModel.category ? plainProductModel.category.name : null,
            created_by_name: plainProductModel.createdByUser ? 
                `${plainProductModel.createdByUser.first_name} ${plainProductModel.createdByUser.last_name}` : null,
            updated_by_name: plainProductModel.updatedByUser ? 
                `${plainProductModel.updatedByUser.first_name} ${plainProductModel.updatedByUser.last_name}` : null,
            createdAt: plainProductModel.created_at || plainProductModel.createdAt,
            updatedAt: plainProductModel.updated_at || plainProductModel.updatedAt
        };

        res.json(transformedProductModel);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product model', details: error.message });
    }
});

// Create new product model
router.post('/', csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and model creation
    const transaction = await sequelize.transaction();
    
    try {
        const userId = req.user.id;
        const { name, description, category_id, brand, model_number, logo, is_active } = req.body;
        
        // Validate required fields
        if (!name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Name is required' });
        }
        
        // Auto-generate model code
        const code = await autoCodeService.generateNextCode(
            'product_models',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'MOD',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        const productModelData = {
            code,
            name,
            description,
            category_id,
            brand,
            model_number,
            logo,
            is_active: is_active !== undefined ? is_active : true,
            created_by: userId,
            updated_by: userId,
            companyId: req.user.companyId
        };

        const productModel = await ProductModel.create(productModelData, { transaction });
        
        // Commit transaction
        await transaction.commit();
        
        // Fetch the created product model with related data
        const createdProductModel = await ProductModel.findByPk(productModel.id, {
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        const plainProductModel = createdProductModel.get({ plain: true });
        const transformedProductModel = {
            ...plainProductModel,
            category_name: plainProductModel.category ? plainProductModel.category.name : null,
            created_by_name: plainProductModel.createdByUser ? 
                `${plainProductModel.createdByUser.first_name} ${plainProductModel.createdByUser.last_name}` : null,
            createdAt: plainProductModel.created_at || plainProductModel.createdAt,
            updatedAt: plainProductModel.updated_at || plainProductModel.updatedAt
        };

        res.status(201).json(transformedProductModel);
    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                error: 'Validation error', 
                details: error.errors.map(e => ({ field: e.path, message: e.message }))
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                error: 'Duplicate entry', 
                details: 'A product model with this code already exists'
            });
        }
        res.status(500).json({ error: 'Failed to create product model', details: error.message });
    }
});

// Update product model
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const userId = req.user.id;
        const productModel = await ProductModel.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!productModel) {
            return res.status(404).json({ message: 'Product model not found' });
        }

        const updateData = {
            ...req.body,
            updated_by: userId
        };

        await productModel.update(updateData);
        
        // Fetch the updated product model with related data
        const updatedProductModel = await ProductModel.findByPk(req.params.id, {
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        const plainProductModel = updatedProductModel.get({ plain: true });
        const transformedProductModel = {
            ...plainProductModel,
            category_name: plainProductModel.category ? plainProductModel.category.name : null,
            created_by_name: plainProductModel.createdByUser ? 
                `${plainProductModel.createdByUser.first_name} ${plainProductModel.createdByUser.last_name}` : null,
            updated_by_name: plainProductModel.updatedByUser ? 
                `${plainProductModel.updatedByUser.first_name} ${plainProductModel.updatedByUser.last_name}` : null,
            createdAt: plainProductModel.created_at || plainProductModel.createdAt,
            updatedAt: plainProductModel.updated_at || plainProductModel.updatedAt
        };

        res.json(transformedProductModel);
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                error: 'Validation error', 
                details: error.errors.map(e => ({ field: e.path, message: e.message }))
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                error: 'Duplicate entry', 
                details: 'A product model with this code already exists'
            });
        }
        res.status(500).json({ error: 'Failed to update product model', details: error.message });
    }
});

// Delete product model
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const productModel = await ProductModel.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!productModel) {
            return res.status(404).json({ message: 'Product model not found' });
        }

        await productModel.destroy();
        res.json({ message: 'Product model deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete product model', details: error.message });
    }
});

// Upload and process logo image
router.post('/upload-logo', upload.single('logo'), csrfProtection, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const outputDir = getUploadDir('productModelLogos');
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate output filename (always .jpg)
    const baseName = path.parse(req.file.originalname).name;
    const outputFilename = `${baseName}-${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, outputFilename);

    // Process image with sharp: resize, convert to JPG, optimize
    await sharp(inputPath)
      .resize(256, 256, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
      })
      .jpeg({ 
        quality: 80,
        progressive: true,
        mozjpeg: true
      })
      .toFile(outputPath);

    // Delete the original uploaded file (async to avoid blocking)
    fs.promises.unlink(inputPath).catch((unlinkError) => {
      // Ignore EBUSY and ENOENT errors - file might be locked or already deleted
      if (unlinkError.code !== 'EBUSY' && unlinkError.code !== 'ENOENT') {
        console.error('Error deleting temporary file:', unlinkError.message);
      }
    });

    // Return the processed file path
    const fileUrl = `/uploads/product-model-logos/${outputFilename}`;
    res.json({ 
      success: true,
      filePath: fileUrl,
      message: 'Logo uploaded and processed successfully'
    });

  } catch (error) {
    // Clean up uploaded file if it exists (async to avoid blocking and handle EBUSY errors)
    if (req.file && fs.existsSync(req.file.path)) {
      // Use async deletion with error handling to avoid EBUSY errors
      fs.promises.unlink(req.file.path).catch((unlinkError) => {
        // Ignore EBUSY errors - file might be locked by another process
        if (unlinkError.code !== 'EBUSY' && unlinkError.code !== 'ENOENT') {
          console.error('Error deleting temporary file:', unlinkError.message);
        }
      });
    }
    
    res.status(500).json({ 
      error: 'Logo upload failed',
      details: error.message 
    });
  }
});

// GET /api/product-models/check-code/availability - Check if code is available
router.get('/check-code/availability', async (req, res) => {
    try {
        const { code, exclude_id } = req.query;
        
        if (!code) {
            return res.status(400).json({ error: 'Code parameter is required' });
        }

        const whereClause = { code: { [Op.iLike]: code } };
        
        if (exclude_id) {
            whereClause.id = { [Op.ne]: exclude_id };
        }

        const existingModel = await ProductModel.findOne({ 
            where: buildCompanyWhere(req, whereClause)
        });
        
        res.json({ available: !existingModel });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check code availability', details: error.message });
    }
});

// GET /api/product-models/stats/overview - Get product model statistics
router.get('/stats/overview', async (req, res) => {
    try {
        const totalProductModels = await ProductModel.count({
            where: buildCompanyWhere(req)
        });
        const activeProductModels = await ProductModel.count({
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactiveProductModels = await ProductModel.count({
            where: buildCompanyWhere(req, { is_active: false })
        });

        // Get the most recent update
        const lastUpdate = await ProductModel.findOne({
            where: buildCompanyWhere(req),
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });

        res.json({
            totalProductModels,
            activeProductModels,
            inactiveProductModels,
            lastUpdate: lastUpdate?.updated_at || null
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product model stats', details: error.message });
    }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search = '', status = 'all' } = req.query;
        
        // Build where clause
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } },
                { brand: { [Op.iLike]: `%${search}%` } },
                { model_number: { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const productModels = await ProductModel.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Product Models');

        // Add title and filter info
        worksheet.addRow(['Product Models Report']);
        worksheet.addRow([`Generated on: ${new Date().toLocaleString()}`]);
        if (search) worksheet.addRow([`Filter: Search "${search}"`]);
        if (status !== 'all') worksheet.addRow([`Filter: Status "${status}"`]);
        worksheet.addRow([]); // Empty row

        // Add headers
        const headers = [
            'Model Name', 'Model Code', 'Description', 'Category', 'Brand', 
            'Model Number', 'Status', 'Created By', 'Created Date', 
            'Updated By', 'Updated Date'
        ];
        worksheet.addRow(headers);

        // Style the header row
        const headerRow = worksheet.getRow(worksheet.rowCount);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Add data rows
        productModels.forEach(model => {
            worksheet.addRow([
                model.name,
                model.code,
                model.description || '',
                model.category?.name || '',
                model.brand || '',
                model.model_number || '',
                model.is_active ? 'Active' : 'Inactive',
                model.createdByUser ? 
                    `${model.createdByUser.first_name} ${model.createdByUser.last_name}` : '',
                model.created_at ? new Date(model.created_at).toLocaleDateString() : '',
                model.updatedByUser ? 
                    `${model.updatedByUser.first_name} ${model.updatedByUser.last_name}` : '',
                model.updated_at ? new Date(model.updated_at).toLocaleDateString() : ''
            ]);
        });

        // Auto-fit columns
        worksheet.columns.forEach(column => {
            column.width = Math.max(
                column.header ? column.header.length : 10,
                ...column.values.map(v => v ? v.toString().length : 0)
            ) + 2;
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=product-models-${new Date().toISOString().split('T')[0]}.xlsx`);

        // Write to response
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        res.status(500).json({ error: 'Failed to export to Excel', details: error.message });
    }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search = '', status = 'all' } = req.query;
        
        // Build where clause
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } },
                { brand: { [Op.iLike]: `%${search}%` } },
                { model_number: { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const productModels = await ProductModel.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        // Create PDF document
        const doc = new PDFDocument({ margin: 50 });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=product-models-${new Date().toISOString().split('T')[0]}.pdf`);

        // Pipe PDF to response
        doc.pipe(res);

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Product Models Report', { align: 'center' });
        doc.moveDown();

        // Add generation info
        doc.fontSize(10).font('Helvetica').text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
        if (search) doc.text(`Filter: Search "${search}"`, { align: 'center' });
        if (status !== 'all') doc.text(`Filter: Status "${status}"`, { align: 'center' });
        doc.moveDown();

        // Add table headers
        const headers = ['Name', 'Code', 'Category', 'Brand', 'Status', 'Created By'];
        const columnWidths = [120, 80, 80, 80, 60, 100];
        let yPosition = doc.y;

        // Draw header background
        doc.rect(50, yPosition, 520, 20).fill('#f0f0f0');
        
        // Add header text
        doc.fontSize(9).font('Helvetica-Bold').fillColor('black');
        let xPosition = 50;
        headers.forEach((header, index) => {
            doc.text(header, xPosition + 5, yPosition + 5, { width: columnWidths[index] - 10 });
            xPosition += columnWidths[index];
        });

        yPosition += 25;

        // Add data rows
        productModels.forEach((model, index) => {
            if (yPosition > 700) {
                doc.addPage();
                yPosition = 50;
            }

            const rowData = [
                model.name,
                model.code,
                model.category?.name || '',
                model.brand || '',
                model.is_active ? 'Active' : 'Inactive',
                model.createdByUser ? 
                    `${model.createdByUser.first_name} ${model.createdByUser.last_name}` : ''
            ];

            // Draw row background (alternating)
            if (index % 2 === 0) {
                doc.rect(50, yPosition, 520, 15).fill('#fafafa');
            }

            // Add row text
            doc.fontSize(8).font('Helvetica').fillColor('black');
            xPosition = 50;
            rowData.forEach((cell, cellIndex) => {
                doc.text(cell, xPosition + 5, yPosition + 3, { width: columnWidths[cellIndex] - 10 });
                xPosition += columnWidths[cellIndex];
            });

            yPosition += 20;
        });

        // Add summary
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica-Bold').text(`Total Product Models: ${productModels.length}`);

        // Finalize PDF
        doc.end();

    } catch (error) {
        res.status(500).json({ error: 'Failed to export to PDF', details: error.message });
    }
});

// Check if product model is being used
router.get('/:id/usage', async (req, res) => {
    try {
        const Product = require('../models/product'); // Dynamically require Product model
        const usageCount = await Product.count({
            where: {
                model_id: req.params.id
            }
        });
        res.json({
            isUsed: usageCount > 0,
            usageCount: usageCount,
            message: usageCount > 0
                ? `This product model is used by ${usageCount} product(s)`
                : 'This product model is not used by any products'
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Deactivate product model (for used models)
router.put('/:id/deactivate', csrfProtection, async (req, res) => {
    try {
        const productModel = await ProductModel.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productModel) {
            return res.status(404).json({ error: 'Product model not found' });
        }

        await productModel.update({
            is_active: false,
            updated_by: req.user.id
        });

        res.json({
            message: 'Product model deactivated successfully',
            productModel: productModel
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete product model (only if not used)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const productModel = await ProductModel.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productModel) {
            return res.status(404).json({ error: 'Product model not found' });
        }

        // Check if model is being used
        const Product = require('../models/product'); // Dynamically require Product model
        const usageCount = await Product.count({
            where: {
                model_id: req.params.id
            }
        });

        if (usageCount > 0) {
            return res.status(400).json({
                error: 'Cannot delete product model',
                message: `This product model is used by ${usageCount} product(s). Please deactivate it instead.`,
                isUsed: true,
                usageCount: usageCount
            });
        }

        // Delete the logo file if it exists
        if (productModel.logo) {
            const logoPath = path.join(__dirname, '../../', productModel.logo);
            if (fs.existsSync(logoPath)) {
                fs.unlinkSync(logoPath);
            }
        }

        // If not used, perform hard delete
        await productModel.destroy();

        res.json({
            message: 'Product model deleted successfully',
            isUsed: false
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router; 