const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ProductBrandName, User } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../uploads/product-brand-name-logos');
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

// Get all product brand names with pagination and search
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'code';
        const sortOrder = req.query.sortOrder || 'ASC';
        const status = req.query.status;

        const whereClause = {};

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

        // Handle sorting for user-related fields
        let orderClause;
        if (sortBy === 'created_by') {
            orderClause = [[{ model: User, as: 'createdByUser' }, 'first_name', sortOrder]];
        } else if (sortBy === 'updated_by') {
            orderClause = [[{ model: User, as: 'updatedByUser' }, 'first_name', sortOrder]];
        } else {
            orderClause = [[sortBy, sortOrder]];
        }

        const { count, rows } = await ProductBrandName.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name']
                }
            ],
            order: orderClause,
            limit: limit,
            offset: offset
        });

        // Transform the data to include user names
        const transformedRows = rows.map(brandName => {
            const plainBrandName = brandName.get({ plain: true });
            return {
                ...plainBrandName,
                created_by_name: brandName.createdByUser 
                    ? `${brandName.createdByUser.first_name || ''} ${brandName.createdByUser.last_name || ''}`.trim() || 'N/A'
                    : 'N/A',
                updated_by_name: brandName.updatedByUser 
                    ? `${brandName.updatedByUser.first_name || ''} ${brandName.updatedByUser.last_name || ''}`.trim() || 'N/A'
                    : 'N/A'
            };
        });

        res.json({
            data: transformedRows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(count / limit),
                totalItems: count,
                itemsPerPage: limit
            }
        });
    } catch (error) {
        if (error.errors) {
            error.errors.forEach((err, idx) => {
                });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Get product brand name by ID
router.get('/:id', async (req, res) => {
    try {
        const productBrandName = await ProductBrandName.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name']
                }
            ]
        });
        
        if (!productBrandName) {
            return res.status(404).json({ error: 'Product brand name not found' });
        }
        
        // Transform the data to include user names and ensure code is included
        const plainBrandName = productBrandName.get({ plain: true });
        const transformedData = {
            ...plainBrandName,
            code: plainBrandName.code, // Explicitly include code
            created_by_name: productBrandName.createdByUser 
                ? `${productBrandName.createdByUser.first_name || ''} ${productBrandName.createdByUser.last_name || ''}`.trim() || 'N/A'
                : 'N/A',
            updated_by_name: productBrandName.updatedByUser 
                ? `${productBrandName.updatedByUser.first_name || ''} ${productBrandName.updatedByUser.last_name || ''}`.trim() || 'N/A'
                : 'N/A'
        };
        
        res.json(transformedData);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new product brand name
router.post('/', upload.single('logo'), csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and brand creation
    const transaction = await sequelize.transaction();
    
    try {
        const { name, description, is_active } = req.body;
        
        // Validate required fields
        if (!name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Name is required' });
        }
        
        // Auto-generate brand code
        const code = await autoCodeService.generateNextCode(
            'product_brand_names',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'BRD',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        // Properly handle is_active field
        const isActiveBoolean = is_active === 'true' || is_active === true || is_active === '1' || is_active === 1;
        
        const logoPath = req.file ? `/uploads/product-brand-name-logos/${req.file.filename}` : null;
        
        const productBrandName = await ProductBrandName.create({
            companyId: req.user.companyId,
            code,
            name,
            description,
            logo: logoPath,
            is_active: isActiveBoolean,
            created_by: req.user.id,
            updated_by: req.user.id
        }, { transaction });
        
        // Commit transaction
        await transaction.commit();
        
        res.status(201).json(productBrandName);
    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        if (error.errors) {
            error.errors.forEach((err, idx) => {
                });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Product brand name code already exists' });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Update product brand name
router.put('/:id', upload.single('logo'), csrfProtection, async (req, res) => {
    try {
        const { code, name, description, is_active } = req.body;
        
        // Properly handle is_active field
        const isActiveBoolean = is_active === 'true' || is_active === true || is_active === '1' || is_active === 1;
        
        const productBrandName = await ProductBrandName.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productBrandName) {
            return res.status(404).json({ error: 'Product brand name not found' });
        }
        
        let logoPath = productBrandName.logo;
        if (req.file) {
            // Delete old logo if exists
            if (productBrandName.logo) {
                const oldLogoPath = path.join(__dirname, '../../', productBrandName.logo);
                if (fs.existsSync(oldLogoPath)) {
                    fs.unlinkSync(oldLogoPath);
                }
            }
            logoPath = `/uploads/product-brand-name-logos/${req.file.filename}`;
        }
        
        // Code cannot be updated - it's auto-generated and immutable
        // Remove code from update data if present
        await productBrandName.update({
            name,
            description,
            logo: logoPath,
            is_active: isActiveBoolean,
            updated_by: req.user.id
        });
        
        // Reload the instance to ensure we have the latest data including code
        await productBrandName.reload();
        
        // Return the updated brand name with code
        res.json(productBrandName);
    } catch (error) {
        if (error.errors) {
            error.errors.forEach((err, idx) => {
                });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Product brand name code already exists' });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Check if product brand name is being used
router.get('/:id/usage', async (req, res) => {
    try {
        const Product = require('../models/product');
        
        const usageCount = await Product.count({
            where: buildCompanyWhere(req, {
                brand_id: req.params.id
            })
        });
        
        res.json({
            isUsed: usageCount > 0,
            usageCount: usageCount,
            message: usageCount > 0 
                ? `This brand name is used by ${usageCount} product(s)` 
                : 'This brand name is not used by any products'
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete product brand name (only if not used)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const productBrandName = await ProductBrandName.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productBrandName) {
            return res.status(404).json({ error: 'Product brand name not found' });
        }
        
        // Check if brand name is being used
        const Product = require('../models/product');
        const usageCount = await Product.count({
            where: buildCompanyWhere(req, {
                brand_id: req.params.id
            })
        });
        
        if (usageCount > 0) {
            return res.status(400).json({
                error: 'Cannot delete brand name',
                message: `This brand name is used by ${usageCount} product(s). Please deactivate it instead.`,
                isUsed: true,
                usageCount: usageCount
            });
        }
        
        // Delete the logo file if it exists
        if (productBrandName.logo) {
            const logoPath = path.join(__dirname, '../../', productBrandName.logo);
            if (fs.existsSync(logoPath)) {
                fs.unlinkSync(logoPath);
            }
        }
        
        // If not used, perform hard delete
        await productBrandName.destroy();
        
        res.json({ 
            message: 'Product brand name deleted successfully',
            isUsed: false
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Deactivate product brand name (for used brand names)
router.put('/:id/deactivate', csrfProtection, async (req, res) => {
    try {
        const productBrandName = await ProductBrandName.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!productBrandName) {
            return res.status(404).json({ error: 'Product brand name not found' });
        }
        
        await productBrandName.update({
            is_active: false,
            updated_by: req.user.id
        });
        
        res.json({ 
            message: 'Product brand name deactivated successfully',
            brandName: productBrandName
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get product brand name statistics
router.get('/stats', async (req, res) => {
    try {
        const totalBrandNames = await ProductBrandName.count({
            where: buildCompanyWhere(req)
        });
        const activeBrandNames = await ProductBrandName.count({ 
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactiveBrandNames = await ProductBrandName.count({ 
            where: buildCompanyWhere(req, { is_active: false })
        });
        
        // Get the last updated brand name
        const lastUpdated = await ProductBrandName.findOne({
            where: buildCompanyWhere(req),
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });

        res.json({
            totalBrandNames,
            activeBrandNames,
            inactiveBrandNames,
            lastUpdate: lastUpdated ? lastUpdated.updated_at : null
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

        // Export to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, status } = req.query;
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

        const brandNames = await ProductBrandName.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name']
                }
            ],
            order: [['code', 'ASC']]
        });

        // Transform the data to include user names for export
        const transformedBrandNames = brandNames.map(brandName => {
            const plainBrandName = brandName.get({ plain: true });
            return {
                ...plainBrandName,
                created_by_name: brandName.createdByUser 
                    ? `${brandName.createdByUser.first_name || ''} ${brandName.createdByUser.last_name || ''}`.trim() || 'N/A'
                    : 'N/A',
                updated_by_name: brandName.updatedByUser 
                    ? `${brandName.updatedByUser.first_name || ''} ${brandName.updatedByUser.last_name || ''}`.trim() || 'N/A'
                    : 'N/A'
            };
        });

        // Use the export service to generate Excel
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        const excelBuffer = await exportService.exportBrandNamesToExcel(transformedBrandNames, { search, status });

        // Set response headers for Excel download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="product-brand-names-${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.setHeader('Content-Length', excelBuffer.length);
        
        res.send(excelBuffer);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, status } = req.query;
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

        const brandNames = await ProductBrandName.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name']
                }
            ],
            order: [['code', 'ASC']]
        });

        // Transform the data to include user names for export
        const transformedBrandNames = brandNames.map(brandName => {
            const plainBrandName = brandName.get({ plain: true });
            return {
                ...plainBrandName,
                created_by_name: brandName.createdByUser 
                    ? `${brandName.createdByUser.first_name || ''} ${brandName.createdByUser.last_name || ''}`.trim() || 'N/A'
                    : 'N/A',
                updated_by_name: brandName.updatedByUser 
                    ? `${brandName.updatedByUser.first_name || ''} ${brandName.updatedByUser.last_name || ''}`.trim() || 'N/A'
                    : 'N/A'
            };
        });

        // Use the export service to generate PDF
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        const pdfBuffer = await exportService.exportBrandNamesToPDF(transformedBrandNames, { search, status });

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="product-brand-names-${new Date().toISOString().split('T')[0]}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router; 