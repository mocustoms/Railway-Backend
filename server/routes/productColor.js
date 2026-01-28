const express = require('express');
const router = express.Router();
const ProductColor = require('../models/productColor');
const User = require('../models/user');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);

// Get active colors only (for dropdowns) - No authentication required
router.get('/active/list', async (req, res) => {
    try {
        const colors = await ProductColor.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            attributes: ['id', 'code', 'name', 'hex_code'],
            order: [['name', 'ASC']]
        });

        res.json(colors);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active colors', details: error.message });
    }
});

// Apply authentication to all other routes
router.use(auth);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all product colors with related data
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 25, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        
        const offset = (page - 1) * limit;
        const whereClause = {};
        
        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }

        const { count, rows: productColors } = await ProductColor.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
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
        const transformedProductColors = productColors.map(color => {
            const plainColor = color.get({ plain: true });
            return {
                ...plainColor,
                created_by_name: plainColor.createdByUser ? 
                    `${plainColor.createdByUser.first_name} ${plainColor.createdByUser.last_name}` : null,
                updated_by_name: plainColor.updatedByUser ? 
                    `${plainColor.updatedByUser.first_name} ${plainColor.updatedByUser.last_name}` : null,
                createdAt: plainColor.created_at || plainColor.createdAt,
                updatedAt: plainColor.updated_at || plainColor.updatedAt
            };
        });

        res.json({
            productColors: transformedProductColors,
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
        res.status(500).json({ error: 'Failed to fetch product colors', details: error.message });
    }
});

// Get single product color by ID
router.get('/:id', async (req, res) => {
    try {
        const productColor = await ProductColor.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
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

        if (!productColor) {
            return res.status(404).json({ message: 'Product color not found' });
        }

        const plainColor = productColor.get({ plain: true });
        const transformedColor = {
            ...plainColor,
            created_by_name: plainColor.createdByUser ? 
                `${plainColor.createdByUser.first_name} ${plainColor.createdByUser.last_name}` : null,
            updated_by_name: plainColor.updatedByUser ? 
                `${plainColor.updatedByUser.first_name} ${plainColor.updatedByUser.last_name}` : null,
            createdAt: plainColor.created_at || plainColor.createdAt,
            updatedAt: plainColor.updated_at || plainColor.updatedAt
        };

        res.json(transformedColor);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product color', details: error.message });
    }
});

// Create new product color
router.post('/', csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and color creation
    const transaction = await sequelize.transaction();
    
    try {
        const userId = req.user.id;
        const { name, hex_code, description, is_active } = req.body;
        
        // Validate required fields (excluding code)
        if (!name || !hex_code) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'Validation error', 
                details: [{ field: 'name', message: 'Name is required' }, { field: 'hex_code', message: 'Hex code is required' }]
            });
        }
        
        // Auto-generate color code
        const code = await autoCodeService.generateNextCode(
            'product_colors',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'COL',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        const colorData = {
            code,
            name,
            hex_code,
            description,
            is_active: is_active !== undefined ? is_active : true,
            created_by: userId,
            updated_by: userId,
            companyId: req.user.companyId
        };

        const productColor = await ProductColor.create(colorData, { transaction });
        
        // Commit transaction
        await transaction.commit();
        
        // Fetch the created color with related data
        const createdColor = await ProductColor.findOne({
            where: buildCompanyWhere(req, { id: productColor.id }),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        const plainColor = createdColor.get({ plain: true });
        const transformedColor = {
            ...plainColor,
            created_by_name: plainColor.createdByUser ? 
                `${plainColor.createdByUser.first_name} ${plainColor.createdByUser.last_name}` : null,
            createdAt: plainColor.created_at || plainColor.createdAt,
            updatedAt: plainColor.updated_at || plainColor.updatedAt
        };

        res.status(201).json(transformedColor);
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
                details: 'A product color with this code already exists'
            });
        }
        res.status(500).json({ error: 'Failed to create product color', details: error.message });
    }
});

// Update product color
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const userId = req.user.id;
        const productColor = await ProductColor.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!productColor) {
            return res.status(404).json({ message: 'Product color not found' });
        }

        const updateData = {
            ...req.body,
            updated_by: userId
        };

        await productColor.update(updateData);
        
        // Fetch the updated color with related data
        const updatedColor = await ProductColor.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
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

        const plainColor = updatedColor.get({ plain: true });
        const transformedColor = {
            ...plainColor,
            created_by_name: plainColor.createdByUser ? 
                `${plainColor.createdByUser.first_name} ${plainColor.createdByUser.last_name}` : null,
            updated_by_name: plainColor.updatedByUser ? 
                `${plainColor.updatedByUser.first_name} ${plainColor.updatedByUser.last_name}` : null,
            createdAt: plainColor.created_at || plainColor.createdAt,
            updatedAt: plainColor.updated_at || plainColor.updatedAt
        };

        res.json(transformedColor);
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
                details: 'A product color with this code already exists'
            });
        }
        res.status(500).json({ error: 'Failed to update product color', details: error.message });
    }
});

// Delete product color
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const productColor = await ProductColor.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!productColor) {
            return res.status(404).json({ message: 'Product color not found' });
        }

        await productColor.destroy();
        res.json({ message: 'Product color deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete product color', details: error.message });
    }
});

// GET /api/product-colors/stats/overview - Get product color statistics
router.get('/stats/overview', async (req, res) => {
    try {
        const totalProductColors = await ProductColor.count({
            where: buildCompanyWhere(req)
        });
        const activeProductColors = await ProductColor.count({ 
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactiveProductColors = await ProductColor.count({ 
            where: buildCompanyWhere(req, { is_active: false })
        });
        
        // Get last update time
        const lastUpdate = await ProductColor.findOne({
            where: buildCompanyWhere(req),
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });
        const lastUpdateFormatted = lastUpdate ? new Date(lastUpdate.updated_at).toLocaleDateString() : 'Never';

        res.json({
            stats: {
                totalProductColors,
                activeProductColors,
                inactiveProductColors,
                lastUpdate: lastUpdateFormatted
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
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
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const productColors = await ProductColor.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
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
            order: [['name', 'ASC']]
        });

        // Transform data
        const transformedColors = productColors.map(color => {
            const plainColor = color.get({ plain: true });
            return {
                ...plainColor,
                created_by_name: plainColor.createdByUser ? 
                    `${plainColor.createdByUser.first_name} ${plainColor.createdByUser.last_name}` : null,
                updated_by_name: plainColor.updatedByUser ? 
                    `${plainColor.updatedByUser.first_name} ${plainColor.updatedByUser.last_name}` : null
            };
        });

        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Product Colors');
        
        // Define columns
        worksheet.columns = [
            { header: 'Color Name', key: 'name', width: 25 },
            { header: 'Color Code', key: 'code', width: 15 },
            { header: 'Hex Code', key: 'hex_code', width: 15 },
            { header: 'Description', key: 'description', width: 40 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Created By', key: 'createdBy', width: 20 },
            { header: 'Created Date', key: 'createdAt', width: 15 },
            { header: 'Updated By', key: 'updatedBy', width: 20 },
            { header: 'Updated Date', key: 'updatedAt', width: 15 }
        ];

        // Style the header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Add data rows
        transformedColors.forEach(color => {
            worksheet.addRow({
                name: color.name,
                code: color.code,
                hex_code: color.hex_code,
                description: color.description || '',
                status: color.is_active ? 'Active' : 'Inactive',
                createdBy: color.created_by_name || 'N/A',
                createdAt: color.created_at ? new Date(color.created_at).toLocaleDateString() : 'N/A',
                updatedBy: color.updated_by_name || 'N/A',
                updatedAt: color.updated_at ? new Date(color.updated_at).toLocaleDateString() : 'N/A'
            });
        });

        // Add filters info if any
        if (search || status !== 'all') {
            worksheet.addRow([]);
            worksheet.addRow(['Filters Applied:']);
            if (search) {
                worksheet.addRow([`Search: ${search}`]);
            }
            if (status !== 'all') {
                worksheet.addRow([`Status: ${status}`]);
            }
        }

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=product-colors-${new Date().toISOString().split('T')[0]}.xlsx`);

        // Generate buffer and send
        const buffer = await workbook.xlsx.writeBuffer();
        res.send(buffer);

    } catch (error) {
        res.status(500).json({ error: 'Failed to export product colors', details: error.message });
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
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        const productColors = await ProductColor.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
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
            order: [['name', 'ASC']]
        });

        // Transform data
        const transformedColors = productColors.map(color => {
            const plainColor = color.get({ plain: true });
            return {
                ...plainColor,
                created_by_name: plainColor.createdByUser ? 
                    `${plainColor.createdByUser.first_name} ${plainColor.createdByUser.last_name}` : null,
                updated_by_name: plainColor.updatedByUser ? 
                    `${plainColor.updatedByUser.first_name} ${plainColor.updatedByUser.last_name}` : null
            };
        });

        // Create PDF document
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const buffer = Buffer.concat(chunks);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=product-colors-${new Date().toISOString().split('T')[0]}.pdf`);
            res.send(buffer);
        });

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Product Colors', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (search || status !== 'all') {
            doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
            if (search) {
                doc.fontSize(10).font('Helvetica').text(`Search: ${search}`);
            }
            if (status !== 'all') {
                doc.fontSize(10).font('Helvetica').text(`Status: ${status}`);
            }
            doc.moveDown();
        }

        // Add table headers
        const headers = ['Color Name', 'Code', 'Hex Code', 'Status', 'Created By'];
        const columnWidths = [120, 60, 80, 60, 100];
        let yPosition = doc.y;

        // Draw header row
        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, index) => {
            doc.text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveDown();

        // Draw data rows
        doc.fontSize(9).font('Helvetica');
        transformedColors.forEach((color, index) => {
            // Check if we need a new page
            if (yPosition > 700) {
                doc.addPage();
                yPosition = 50;
            }

            const rowData = [
                color.name,
                color.code,
                color.hex_code,
                color.is_active ? 'Active' : 'Inactive',
                color.created_by_name || 'N/A'
            ];

            rowData.forEach((cell, cellIndex) => {
                const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
                doc.text(cell, x, yPosition);
            });

            yPosition += 15;
        });

        doc.end();

    } catch (error) {
        res.status(500).json({ error: 'Failed to export product colors', details: error.message });
    }
});

module.exports = router; 