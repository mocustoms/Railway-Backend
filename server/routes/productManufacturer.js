const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const ProductManufacturer = require('../models/productManufacturer');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { getUploadDir } = require('../utils/uploadsPath');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for file uploads (uses UPLOAD_PATH for Railway Volume / partition)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = getUploadDir('productManufacturerLogos');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// Validation middleware
const validateManufacturer = [
    body('name')
        .trim()
        .isLength({ min: 1, max: 255 })
        .withMessage('Name must be between 1 and 255 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Description must not exceed 1000 characters'),
    body('website')
        .optional()
        .isURL()
        .withMessage('Website must be a valid URL'),
    body('contact_email')
        .optional()
        .isEmail()
        .withMessage('Contact email must be a valid email address'),
    body('contact_phone')
        .optional()
        .matches(/^[\+]?[1-9][\d]{0,15}$/)
        .withMessage('Contact phone must be a valid phone number'),
    body('address')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Address must not exceed 500 characters'),
    body('country')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Country must not exceed 100 characters'),
    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean value')
];

// Get all product manufacturers with pagination and search
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'name';
        const sortOrder = req.query.sortOrder || 'ASC';
        const status = req.query.status;
        const country = req.query.country;

        const whereClause = {};

        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Add status filter
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        // Add country filter
        if (country) {
            whereClause.country = { [Op.iLike]: `%${country}%` };
        }

        const { count, rows } = await ProductManufacturer.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: require('../models/user'),
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: require('../models/user'),
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name']
                }
            ],
            order: [[sortBy, sortOrder]],
            limit: limit,
            offset: offset
        });

        // Transform the data to include user names
        const transformedData = rows.map(manufacturer => {
            const plainManufacturer = manufacturer.get({ plain: true });
            return {
                ...plainManufacturer,
                created_by_name: manufacturer.createdByUser 
                    ? `${manufacturer.createdByUser.first_name} ${manufacturer.createdByUser.last_name}`
                    : null,
                updated_by_name: manufacturer.updatedByUser 
                    ? `${manufacturer.updatedByUser.first_name} ${manufacturer.updatedByUser.last_name}`
                    : null
            };
        });

        res.json({
            data: transformedData,
            total: count,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
            itemsPerPage: limit
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/product-manufacturers/stats - Get product manufacturer statistics
router.get('/stats', async (req, res) => {
    try {
        const totalManufacturers = await ProductManufacturer.count({
            where: buildCompanyWhere(req)
        });
        const activeManufacturers = await ProductManufacturer.count({ 
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactiveManufacturers = await ProductManufacturer.count({ 
            where: buildCompanyWhere(req, { is_active: false })
        });
        
        // Get last update time
        const lastUpdate = await ProductManufacturer.findOne({
            where: buildCompanyWhere(req),
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });
        const lastUpdateFormatted = lastUpdate ? new Date(lastUpdate.updated_at).toLocaleDateString() : 'Never';

        res.json({
            totalManufacturers,
            activeManufacturers,
            inactiveManufacturers,
            lastUpdate: lastUpdateFormatted
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get active manufacturers for dropdowns
router.get('/active', async (req, res) => {
    try {
        const manufacturers = await ProductManufacturer.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            attributes: ['id', 'code', 'name'],
            order: [['name', 'ASC']]
        });
        
        res.json(manufacturers);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get product manufacturer by ID
router.get('/:id', async (req, res) => {
    try {
        const productManufacturer = await ProductManufacturer.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: require('../models/user'),
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: require('../models/user'),
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name']
                }
            ]
        });
        
        if (!productManufacturer) {
            return res.status(404).json({ error: 'Product manufacturer not found' });
        }

        // Transform the data to include user names
        const plainManufacturer = productManufacturer.get({ plain: true });
        const transformedData = {
            ...plainManufacturer,
            created_by_name: productManufacturer.createdByUser 
                ? `${productManufacturer.createdByUser.first_name} ${productManufacturer.createdByUser.last_name}`
                : null,
            updated_by_name: productManufacturer.updatedByUser 
                ? `${productManufacturer.updatedByUser.first_name} ${productManufacturer.updatedByUser.last_name}`
                : null
        };
        
        res.json(transformedData);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new product manufacturer
router.post('/', upload.single('logo'), validateManufacturer, async (req, res) => {
    // Start transaction for atomic code generation and manufacturer creation
    const transaction = await sequelize.transaction();
    
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { name, description, website, contact_email, contact_phone, address, country, is_active } = req.body;
        
        // Validate required fields
        if (!name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Name is required' });
        }
        
        // Auto-generate manufacturer code
        const code = await autoCodeService.generateNextCode(
            'product_manufacturers',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'MFG',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        // Sanitize inputs
        const sanitizedData = {
            code: code.trim(),
            name: name.trim(),
            description: description ? description.trim() : null,
            website: website ? website.trim() : null,
            contact_email: contact_email ? contact_email.trim().toLowerCase() : null,
            contact_phone: contact_phone ? contact_phone.trim() : null,
            address: address ? address.trim() : null,
            country: country ? country.trim() : null,
            is_active: is_active !== undefined ? (is_active === 'true' || is_active === true) : true
        };
        
        const logoPath = req.file ? `/uploads/product-manufacturer-logos/${req.file.filename}` : null;
        
        const productManufacturer = await ProductManufacturer.create({
            ...sanitizedData,
            logo: logoPath,
            companyId: req.user.companyId,
            created_by: req.user.id,
            updated_by: req.user.id
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Fetch the created manufacturer with associations
        const createdManufacturer = await ProductManufacturer.findByPk(productManufacturer.id, {
            include: [
                {
                    model: require('../models/user'),
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: require('../models/user'),
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name']
                }
            ]
        });

        // Transform the data to include user names
        const plainManufacturer = createdManufacturer.get({ plain: true });
        const transformedData = {
            ...plainManufacturer,
            created_by_name: createdManufacturer.createdByUser 
                ? `${createdManufacturer.createdByUser.first_name} ${createdManufacturer.createdByUser.last_name}`
                : null,
            updated_by_name: createdManufacturer.updatedByUser 
                ? `${createdManufacturer.updatedByUser.first_name} ${createdManufacturer.updatedByUser.last_name}`
                : null
        };
        
        res.status(201).json(transformedData);
    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Product manufacturer code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update product manufacturer
router.put('/:id', upload.single('logo'), validateManufacturer, async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { code, name, description, website, contact_email, contact_phone, address, country, is_active } = req.body;
        
        const productManufacturer = await ProductManufacturer.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productManufacturer) {
            return res.status(404).json({ error: 'Product manufacturer not found' });
        }
        
        // Sanitize inputs
        const sanitizedData = {
            code: code.trim(),
            name: name.trim(),
            description: description ? description.trim() : null,
            website: website ? website.trim() : null,
            contact_email: contact_email ? contact_email.trim().toLowerCase() : null,
            contact_phone: contact_phone ? contact_phone.trim() : null,
            address: address ? address.trim() : null,
            country: country ? country.trim() : null,
            is_active: is_active !== undefined ? (is_active === 'true' || is_active === true) : productManufacturer.is_active
        };
        
        let logoPath = productManufacturer.logo;
        if (req.file) {
            // Delete old logo if exists
            if (productManufacturer.logo) {
                const oldLogoPath = path.join(__dirname, '../../', productManufacturer.logo);
                if (fs.existsSync(oldLogoPath)) {
                    fs.unlinkSync(oldLogoPath);
                }
            }
            logoPath = `/uploads/product-manufacturer-logos/${req.file.filename}`;
        }
        
        await productManufacturer.update({
            ...sanitizedData,
            logo: logoPath,
            updated_by: req.user.id
        });

        // Fetch the updated manufacturer with associations
        const updatedManufacturer = await ProductManufacturer.findByPk(req.params.id, {
            include: [
                {
                    model: require('../models/user'),
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: require('../models/user'),
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name']
                }
            ]
        });

        // Transform the data to include user names
        const plainManufacturer = updatedManufacturer.get({ plain: true });
        const transformedData = {
            ...plainManufacturer,
            created_by_name: updatedManufacturer.createdByUser 
                ? `${updatedManufacturer.createdByUser.first_name} ${updatedManufacturer.createdByUser.last_name}`
                : null,
            updated_by_name: updatedManufacturer.updatedByUser 
                ? `${updatedManufacturer.updatedByUser.first_name} ${updatedManufacturer.updatedByUser.last_name}`
                : null
        };
        
        res.json(transformedData);
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Product manufacturer code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check if product manufacturer is being used
router.get('/:id/usage', async (req, res) => {
    try {
        const Product = require('../models/product');
        
        const usageCount = await Product.count({
            where: {
                manufacturer_id: req.params.id
            }
        });
        
        res.json({
            isUsed: usageCount > 0,
            usageCount: usageCount,
            message: usageCount > 0 
                ? `This manufacturer is used by ${usageCount} product(s)` 
                : 'This manufacturer is not used by any products'
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete product manufacturer (only if not used)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const productManufacturer = await ProductManufacturer.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productManufacturer) {
            return res.status(404).json({ error: 'Product manufacturer not found' });
        }
        
        // Check if manufacturer is being used
        const Product = require('../models/product');
        const usageCount = await Product.count({
            where: {
                manufacturer_id: req.params.id
            }
        });
        
        if (usageCount > 0) {
            return res.status(400).json({
                error: 'Cannot delete manufacturer',
                message: `This manufacturer is used by ${usageCount} product(s). Please deactivate it instead.`,
                isUsed: true,
                usageCount: usageCount
            });
        }
        
        // If not used, perform hard delete
        await productManufacturer.destroy();
        
        res.json({ 
            message: 'Product manufacturer deleted successfully',
            isUsed: false
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Deactivate product manufacturer (for used manufacturers)
router.put('/:id/deactivate', csrfProtection, async (req, res) => {
    try {
        const productManufacturer = await ProductManufacturer.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productManufacturer) {
            return res.status(404).json({ error: 'Product manufacturer not found' });
        }
        
        await productManufacturer.update({
            is_active: false,
            updated_by: req.user.id
        });
        
        res.json({ 
            message: 'Product manufacturer deactivated successfully',
            manufacturer: productManufacturer
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export manufacturers to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, status, country } = req.query;
        
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }
        
        if (country) {
            whereClause.country = { [Op.iLike]: `%${country}%` };
        }
        
        const manufacturers = await ProductManufacturer.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: require('../models/user'),
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name']
                },
                {
                    model: require('../models/user'),
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name']
                }
            ],
            order: [['name', 'ASC']]
        });
        
        // Use the export service to generate Excel file
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        const buffer = await exportService.exportManufacturersToExcel(manufacturers, req.query);
        
        // Set proper headers for Excel download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=product-manufacturers.xlsx');
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export manufacturers to Excel' });
    }
});

// Export manufacturers to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, status, country } = req.query;
        
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }
        
        if (country) {
            whereClause.country = { [Op.iLike]: `%${country}%` };
        }
        
        const manufacturers = await ProductManufacturer.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: require('../models/user'),
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name']
                },
                {
                    model: require('../models/user'),
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name']
                }
            ],
            order: [['name', 'ASC']]
        });
        
        // Use the export service to generate PDF file
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        const buffer = await exportService.exportManufacturersToPDF(manufacturers, req.query);
        
        // Set proper headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=product-manufacturers.pdf');
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export manufacturers to PDF' });
    }
});

module.exports = router; 