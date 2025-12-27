const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { Packaging, User } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all packaging with pagination and search
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const search = req.query.search || '';
        const status = req.query.status;
        const sortBy = req.query.sortBy || 'code';
        const sortOrder = req.query.sortOrder || 'ASC';

        const offset = (page - 1) * limit;

        // Build where clause
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (status) {
            whereClause.status = status;
        }

        // Build order clause
        let orderClause;
        
        // Map snake_case to camelCase for database columns
        const columnMapping = {
            'created_at': 'createdAt',
            'updated_at': 'updatedAt',
            'created_by': 'createdBy',
            'updated_by': 'updatedBy'
        };
        
        const actualSortBy = columnMapping[sortBy] || sortBy;
        
        // Handle sorting for user-related fields
        if (sortBy === 'createdBy' || sortBy === 'created_by') {
            orderClause = [['creator', 'first_name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'updatedBy' || sortBy === 'updated_by') {
            orderClause = [['updater', 'first_name', sortOrder.toUpperCase()]];
        } else {
            orderClause = [[actualSortBy, sortOrder.toUpperCase()]];
        }

        const { count, rows } = await Packaging.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                }
            ],
            order: orderClause,
            limit,
            offset,
            distinct: true
        });

        // Transform data to include related names
        const transformedPackaging = rows.map(pkg => {
            const plainPkg = pkg.get({ plain: true });
            return {
                ...plainPkg,
                created_by_name: plainPkg.creator ? 
                    `${plainPkg.creator.first_name} ${plainPkg.creator.last_name}` : null,
                updated_by_name: plainPkg.updater ? 
                    `${plainPkg.updater.first_name} ${plainPkg.updater.last_name}` : null,
                createdAt: plainPkg.created_at || plainPkg.createdAt,
                updatedAt: plainPkg.updated_at || plainPkg.updatedAt
            };
        });

        const totalPages = Math.ceil(count / limit);

        res.json({
            success: true,
            data: transformedPackaging,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: count,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching packaging data',
            error: error.message
        });
    }
});

// Get all active packaging types for dropdown
router.get('/active/list', async (req, res) => {
    try {
        const packagingTypes = await Packaging.findAll({
            where: buildCompanyWhere(req, { status: 'active' }),
            attributes: ['id', 'code', 'name', 'pieces'],
            order: [['name', 'ASC']]
        });

        res.json({
            success: true,
            data: packagingTypes
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching active packaging types',
            error: error.message
        });
    }
});

// Get single packaging by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const packaging = await Packaging.findOne({
            where: buildCompanyWhere(req, { id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                }
            ]
        });

        if (!packaging) {
            return res.status(404).json({
                success: false,
                message: 'Packaging not found'
            });
        }

        // Transform data to include related names
        const plainPackaging = packaging.get({ plain: true });
        const transformedPackaging = {
            ...plainPackaging,
            created_by_name: plainPackaging.creator ? 
                `${plainPackaging.creator.first_name} ${plainPackaging.creator.last_name}` : null,
            updated_by_name: plainPackaging.updater ? 
                `${plainPackaging.updater.first_name} ${plainPackaging.updater.last_name}` : null,
            createdAt: plainPackaging.created_at || plainPackaging.createdAt,
            updatedAt: plainPackaging.updated_at || plainPackaging.updatedAt
        };

        res.json({
            success: true,
            data: transformedPackaging
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching packaging',
            error: error.message
        });
    }
});

// Create new packaging
router.post('/', csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and packaging creation
    const transaction = await sequelize.transaction();
    
    try {
        const { name, pieces, status = 'active' } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!name || !name.trim()) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Name is required'
            });
        }
        
        if (!pieces) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Pieces is required'
            });
        }
        
        // Validate name length
        const trimmedName = name.trim();
        if (trimmedName.length < 1 || trimmedName.length > 255) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Name must be between 1 and 255 characters'
            });
        }

        // Validate and parse pieces
        const piecesInt = parseInt(pieces);
        if (isNaN(piecesInt) || piecesInt < 1 || piecesInt > 999999) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Pieces must be a valid number between 1 and 999,999'
            });
        }
        
        // Validate status if provided
        if (status && !['active', 'inactive'].includes(status)) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Status must be either "active" or "inactive"'
            });
        }

        // Check if packaging name already exists in this company
        if (!req.user.companyId) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Company ID is required to create packaging'
            });
        }
        
        const existingPackaging = await Packaging.findOne({
            where: {
                name: trimmedName,
                companyId: req.user.companyId
            },
            transaction
        });

        if (existingPackaging) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'A packaging type with this name already exists in your company'
            });
        }
        
        // Auto-generate packaging code
        const code = await autoCodeService.generateNextCode(
            'packaging',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'PKG',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        // Check if code already exists for this company (multi-tenant uniqueness check)
        const existingCode = await Packaging.findOne({
            where: {
                code: code,
                companyId: req.user.companyId
            },
            transaction
        });
        
        if (existingCode) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'A packaging with this code already exists in your company',
                error: 'Code must be unique within your company'
            });
        }
        
        const packaging = await Packaging.create({
            code,
            name: trimmedName,
            companyId: req.user.companyId,
            pieces: piecesInt,
            status: status || 'active',
            createdBy: userId,
            updatedBy: userId
        }, { transaction });
        
        await transaction.commit();

        // Fetch the created packaging with user details
        const createdPackaging = await Packaging.findByPk(packaging.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                }
            ]
        });

        // Transform data to include related names
        const plainPackaging = createdPackaging.get({ plain: true });
        const transformedPackaging = {
            ...plainPackaging,
            created_by_name: plainPackaging.creator ? 
                `${plainPackaging.creator.first_name} ${plainPackaging.creator.last_name}` : null,
            updated_by_name: plainPackaging.updater ? 
                `${plainPackaging.updater.first_name} ${plainPackaging.updater.last_name}` : null,
            createdAt: plainPackaging.created_at || plainPackaging.createdAt,
            updatedAt: plainPackaging.updated_at || plainPackaging.updatedAt
        };

        res.status(201).json({
            success: true,
            message: 'Packaging created successfully',
            data: transformedPackaging
        });
    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        // Handle Sequelize validation errors
        if (error.name === 'SequelizeValidationError' || 
            error.name === 'ValidationError' ||
            (error.message && error.message.toLowerCase().includes('validation')) ||
            (error.errors && Array.isArray(error.errors) && error.errors.length > 0)) {
            const validationErrors = error.errors ? error.errors.map(e => ({
                field: e.path || e.field,
                message: e.message,
                value: e.value,
                type: e.type,
                validatorKey: e.validatorKey
            })) : [];
            
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                error: validationErrors.length > 0 ? validationErrors[0].message : 'Validation failed',
                errors: validationErrors.map(e => e.message),
                errorDetails: validationErrors,
                field: validationErrors.length > 0 ? validationErrors[0].field : undefined
            });
        }
        
        // Handle unique constraint errors
        if (error.name === 'SequelizeUniqueConstraintError') {
            if (error.fields && error.fields.includes('code')) {
                try {
                    const existingPackaging = await Packaging.findOne({
                        where: buildCompanyWhere(req, { code: req.body.code || 'unknown' })
                    });
                    
                    if (existingPackaging) {
                        return res.status(400).json({
                            success: false,
                            message: 'A packaging with this code already exists',
                            error: 'Code must be unique within your company',
                            field: 'code',
                            existingId: existingPackaging.id
                        });
                    }
                } catch (lookupError) {
                    // Continue to generic error response
                }
            }
            
            return res.status(400).json({
                success: false,
                message: 'A packaging with this code or name already exists in your company',
                error: error.message,
                fields: error.fields
            });
        }
        
        // Handle foreign key constraint errors
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid reference',
                error: error.message,
                table: error.table,
                fields: error.fields
            });
        }
        
        // Handle database connection errors
        if (error.name === 'SequelizeConnectionError' || error.name === 'SequelizeConnectionRefusedError') {
            return res.status(500).json({
                success: false,
                message: 'Database connection error',
                error: 'Unable to connect to database. Please try again later.'
            });
        }
        
        // Handle validation errors in generic handler
        if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
            const validationErrors = error.errors.map(e => ({
                field: e.path || e.field,
                message: e.message,
                value: e.value
            }));
            
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                error: validationErrors[0]?.message || error.message,
                errors: validationErrors.map(e => e.message),
                errorDetails: validationErrors
            });
        }
        
        // Generic error handler
        console.error('Error creating packaging:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error creating packaging',
            error: error.message || 'An unexpected error occurred',
            errorType: error.name,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

// Update packaging
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        const { code, name, pieces, status } = req.body;
        const userId = req.user.id;

        const packaging = await Packaging.findOne({
            where: buildCompanyWhere(req, { id })
        });

        if (!packaging) {
            return res.status(404).json({
                success: false,
                message: 'Packaging not found'
            });
        }

        // Validate required fields - code is auto-generated, don't require it
        if (!name || !pieces) {
            return res.status(400).json({
                success: false,
                message: 'Name and pieces are required'
            });
        }

        // Validate pieces
        if (pieces < 1 || pieces > 999999) {
            return res.status(400).json({
                success: false,
                message: 'Pieces must be between 1 and 999,999'
            });
        }

        // Code cannot be updated - it's auto-generated and immutable
        // Remove code from update data if present
        await packaging.update({
            name: name.trim(),
            pieces: parseInt(pieces),
            status: status || packaging.status,
            updatedBy: userId
        });

        // Reload the instance to ensure we have the latest data including code
        await packaging.reload();

        // Fetch the updated packaging with user details
        const updatedPackaging = await Packaging.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'username', 'email', 'first_name', 'last_name']
                }
            ]
        });

        // Transform data to include related names
        const plainPackaging = updatedPackaging.get({ plain: true });
        const transformedPackaging = {
            ...plainPackaging,
            created_by_name: plainPackaging.creator ? 
                `${plainPackaging.creator.first_name} ${plainPackaging.creator.last_name}` : null,
            updated_by_name: plainPackaging.updater ? 
                `${plainPackaging.updater.first_name} ${plainPackaging.updater.last_name}` : null,
            createdAt: plainPackaging.created_at || plainPackaging.createdAt,
            updatedAt: plainPackaging.updated_at || plainPackaging.updatedAt
        };

        res.json({
            success: true,
            message: 'Packaging updated successfully',
            data: transformedPackaging
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating packaging',
            error: error.message
        });
    }
});

// Get packaging statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const totalPackaging = await Packaging.count({
            where: buildCompanyWhere(req)
        });
        const activePackaging = await Packaging.count({
            where: buildCompanyWhere(req, { status: 'active' })
        });
        const inactivePackaging = await Packaging.count({
            where: buildCompanyWhere(req, { status: 'inactive' })
        });

        res.json({
            success: true,
            data: {
                total: totalPackaging,
                active: activePackaging,
                inactive: inactivePackaging
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching packaging statistics',
            error: error.message
        });
    }
});

// Export packaging to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, status } = req.query;
        
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        if (status && status !== 'all') {
            whereClause.status = status;
        }
        
        const packaging = await Packaging.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['first_name', 'last_name']
                }
            ],
            order: [['name', 'ASC']]
        });
        
        // Use the export service to generate Excel file
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        const buffer = await exportService.exportPackagingToExcel(packaging, req.query);
        
        // Set proper headers for Excel download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=packaging.xlsx');
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error exporting packaging to Excel',
            error: error.message
        });
    }
});

// Export packaging to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, status } = req.query;
        
        const whereClause = {};
        
        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        if (status && status !== 'all') {
            whereClause.status = status;
        }
        
        const packaging = await Packaging.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['first_name', 'last_name']
                }
            ],
            order: [['name', 'ASC']]
        });
        
        // Use the export service to generate PDF file
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        const buffer = await exportService.exportPackagingToPDF(packaging, req.query);
        
        // Set proper headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=packaging.pdf');
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error exporting packaging to PDF',
            error: error.message
        });
    }
});

// Check if packaging is being used
router.get('/:id/usage', async (req, res) => {
    try {
        const Product = require('../models/product'); // Dynamically require Product model
        const unitUsageCount = await Product.count({
            where: {
                unit_id: req.params.id
            }
        });
        const defaultPackagingUsageCount = await Product.count({
            where: {
                default_packaging_id: req.params.id
            }
        });
        const totalUsageCount = unitUsageCount + defaultPackagingUsageCount;
        
        res.json({
            isUsed: totalUsageCount > 0,
            usageCount: totalUsageCount,
            unitUsageCount,
            defaultPackagingUsageCount,
            message: totalUsageCount > 0
                ? `This packaging is used by ${totalUsageCount} product(s)`
                : 'This packaging is not used by any products'
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Deactivate packaging (for used packaging)
router.put('/:id/deactivate', csrfProtection, async (req, res) => {
    try {
        const packaging = await Packaging.findByPk(req.params.id);
        if (!packaging) {
            return res.status(404).json({ error: 'Packaging not found' });
        }

        await packaging.update({
            status: 'inactive',
            updated_by: req.user.id
        });

        res.json({
            message: 'Packaging deactivated successfully',
            packaging: packaging
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete packaging (only if not used)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;

        const packaging = await Packaging.findOne({
            where: buildCompanyWhere(req, { id })
        });

        if (!packaging) {
            return res.status(404).json({
                success: false,
                message: 'Packaging not found'
            });
        }

        // Check if packaging is being used
        const Product = require('../models/product'); // Dynamically require Product model
        const unitUsageCount = await Product.count({
            where: {
                unit_id: id
            }
        });
        const defaultPackagingUsageCount = await Product.count({
            where: {
                default_packaging_id: id
            }
        });
        const totalUsageCount = unitUsageCount + defaultPackagingUsageCount;

        if (totalUsageCount > 0) {
            return res.status(400).json({
                error: 'Cannot delete packaging',
                message: `This packaging is used by ${totalUsageCount} product(s). Please deactivate it instead.`,
                isUsed: true,
                usageCount: totalUsageCount
            });
        }

        // If not used, perform hard delete
        await packaging.destroy();

        res.json({
            success: true,
            message: 'Packaging deleted successfully',
            isUsed: false
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting packaging',
            error: error.message
        });
    }
});

module.exports = router; 