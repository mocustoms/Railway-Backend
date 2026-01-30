const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { AdjustmentReason, User, Account } = require('../models');
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

// Get all adjustment reasons with pagination and search
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'name';
        const sortOrder = req.query.sortOrder || 'ASC';

        const whereClause = {};

        if (search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${search}%` } },
                { name: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Handle sorting for user-related fields and camelCase to snake_case mapping
        let orderClause;
        if (sortBy === 'createdBy' || sortBy === 'created_by') {
            orderClause = [[{ model: User, as: 'createdByUser' }, 'first_name', sortOrder]];
        } else if (sortBy === 'updatedBy' || sortBy === 'updated_by') {
            orderClause = [[{ model: User, as: 'updatedByUser' }, 'first_name', sortOrder]];
        } else if (sortBy === 'trackingAccount' || sortBy === 'tracking_account') {
            orderClause = [[{ model: Account, as: 'trackingAccount' }, 'name', sortOrder]];
        } else if (sortBy === 'correspondingAccount' || sortBy === 'corresponding_account') {
            orderClause = [[{ model: Account, as: 'correspondingAccount' }, 'name', sortOrder]];
        } else if (sortBy === 'adjustmentType' || sortBy === 'adjustment_type') {
            orderClause = [['adjustment_type', sortOrder]];
        } else if (sortBy === 'isActive' || sortBy === 'is_active') {
            orderClause = [['is_active', sortOrder]];
        } else if (sortBy === 'createdAt' || sortBy === 'created_at') {
            orderClause = [['created_at', sortOrder]];
        } else if (sortBy === 'updatedAt' || sortBy === 'updated_at') {
            orderClause = [['updated_at', sortOrder]];
        } else {
            // For other fields like 'name', 'code', 'description'
            orderClause = [[sortBy, sortOrder]];
        }

        const { count, rows } = await AdjustmentReason.findAndCountAll({
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
                },
                {
                    model: Account,
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: orderClause,
            limit: limit,
            offset: offset
        });

        res.json({
            data: rows,
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

// GET /api/adjustment-reasons/all - Get all active adjustment reasons for dropdowns
router.get('/all', async (req, res) => {
    try {
        const adjustmentReasons = await AdjustmentReason.findAll({
            where: buildCompanyWhere(req, {
                is_active: true
            }),
            include: [
                {
                    model: Account,
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        res.json(adjustmentReasons);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch adjustment reasons' });
    }
});

// Get adjustment reason statistics
router.get('/stats/overview', async (req, res) => {
    try {
        const total = await AdjustmentReason.count({
            where: buildCompanyWhere(req)
        });
        const active = await AdjustmentReason.count({ 
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactive = await AdjustmentReason.count({ 
            where: buildCompanyWhere(req, { is_active: false })
        });
        const addType = await AdjustmentReason.count({ 
            where: buildCompanyWhere(req, { adjustment_type: 'add' })
        });
        const deductType = await AdjustmentReason.count({ 
            where: buildCompanyWhere(req, { adjustment_type: 'deduct' })
        });

        res.json({
            stats: {
                total,
                active,
                inactive,
                addType,
                deductType
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Get adjustment reason by ID
router.get('/:id', async (req, res) => {
    try {
        const adjustmentReason = await AdjustmentReason.findOne({
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
                },
                {
                    model: Account,
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ]
        });
        
        if (!adjustmentReason) {
            return res.status(404).json({ error: 'Adjustment reason not found' });
        }
        
        res.json(adjustmentReason);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new adjustment reason
router.post('/', csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and reason creation
    const transaction = await sequelize.transaction();
    
    try {
        const { name, description, adjustment_type, tracking_account_id, is_active, corresponding_account_id } = req.body;
        
        // Validate required fields
        if (!name || !adjustment_type || !tracking_account_id) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Missing required fields: name, adjustment_type, and tracking_account_id are required' });
        }
        
        // Validate adjustment type
        if (!['add', 'deduct'].includes(adjustment_type)) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Invalid adjustment type. Must be "add" or "deduct"' });
        }

        // Check if adjustment reason name already exists in this company
        // Always check within company, even for super-admins
        if (!req.user.companyId) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'Company ID is required to create an adjustment reason' 
            });
        }

        // Check if name already exists in this company
        const existingNameReason = await AdjustmentReason.findOne({
            where: {
                name: name.trim(),
                companyId: req.user.companyId
            },
            transaction
        });

        if (existingNameReason) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'An adjustment reason with this name already exists in your company' 
            });
        }
        
        // Auto-generate adjustment reason code
        const code = await autoCodeService.generateNextCode(
            'adjustment_reasons',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'ADJ',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        // Check if code already exists in this company (safety check)
        const existingCodeReason = await AdjustmentReason.findOne({
            where: {
                code: code.trim(),
                companyId: req.user.companyId
            },
            transaction
        });

        if (existingCodeReason) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'Adjustment reason code already exists in your company' 
            });
        }
        
        // Properly handle is_active field
        const isActiveBoolean = is_active === 'true' || is_active === true || is_active === '1' || is_active === 1;
        
        const adjustmentReason = await AdjustmentReason.create({
            companyId: req.user.companyId,
            code,
            name,
            description,
            adjustment_type,
            tracking_account_id,
            corresponding_account_id,
            is_active: isActiveBoolean,
            created_by: req.user.id,
            updated_by: req.user.id
        }, { transaction });
        
        // Commit transaction
        await transaction.commit();
        
        // Fetch the created record with associations
        const createdReason = await AdjustmentReason.findByPk(adjustmentReason.id, {
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
                },
                {
                    model: require('../models/account'),
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code']
                },
                {
                    model: require('../models/account'),
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code']
                }
            ]
        });
        
        res.status(201).json(createdReason);
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
            // Check which constraint was violated
            const constraintName = error.parent?.constraint || '';
            if (constraintName.includes('name') || error.message.includes('name')) {
                return res.status(400).json({ error: 'An adjustment reason with this name already exists in your company' });
            } else {
                return res.status(400).json({ error: 'Adjustment reason code already exists in your company' });
            }
        }
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ error: 'Invalid tracking account ID' });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Update adjustment reason
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const adjustmentReason = await AdjustmentReason.findByPk(req.params.id);
        if (!adjustmentReason) {
            return res.status(404).json({ error: 'Adjustment reason not found' });
        }
        
        const { code, name, description, adjustment_type, tracking_account_id, is_active, corresponding_account_id } = req.body;
        
        // Validate required fields
        if (!name || !adjustment_type || !tracking_account_id) {
            return res.status(400).json({ error: 'Missing required fields: name, adjustment_type, and tracking_account_id are required' });
        }
        
        // Validate adjustment type
        if (!['add', 'deduct'].includes(adjustment_type)) {
            return res.status(400).json({ error: 'Invalid adjustment type. Must be "add" or "deduct"' });
        }
        
        // Check if code already exists (excluding current record, within company scope)
        if (code && code !== adjustmentReason.code) {
            const existingCodeReason = await AdjustmentReason.findOne({
                where: {
                    code: code.trim(),
                    companyId: req.user.companyId || adjustmentReason.companyId
                }
            });
            if (existingCodeReason) {
                return res.status(400).json({ error: 'Adjustment reason code already exists in your company' });
            }
        }
        
        // Check if name already exists (excluding current record, within company scope)
        if (name && name.trim() !== adjustmentReason.name) {
            const existingNameReason = await AdjustmentReason.findOne({
                where: {
                    name: name.trim(),
                    companyId: req.user.companyId || adjustmentReason.companyId
                }
            });
            if (existingNameReason) {
                return res.status(400).json({ error: 'An adjustment reason with this name already exists in your company' });
            }
        }
        
        // Properly handle is_active field
        const isActiveBoolean = is_active === 'true' || is_active === true || is_active === '1' || is_active === 1;
        
        await adjustmentReason.update({
            code,
            name,
            description,
            adjustment_type,
            tracking_account_id,
            corresponding_account_id,
            is_active: isActiveBoolean,
            updated_by: req.user.id
        });
        
        // Fetch the updated record with associations
        const updatedReason = await AdjustmentReason.findByPk(req.params.id, {
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
                },
                {
                    model: Account,
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ]
        });
        
        res.json(updatedReason);
    } catch (error) {
        if (error.errors) {
            error.errors.forEach((err, idx) => {
                });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            // Check which constraint was violated
            const constraintName = error.parent?.constraint || '';
            if (constraintName.includes('name') || error.message.includes('name')) {
                return res.status(400).json({ error: 'An adjustment reason with this name already exists in your company' });
            } else {
                return res.status(400).json({ error: 'Adjustment reason code already exists in your company' });
            }
        }
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ error: 'Invalid tracking account ID' });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Delete adjustment reason (hard delete)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const adjustmentReason = await AdjustmentReason.findByPk(req.params.id);
        if (!adjustmentReason) {
            return res.status(404).json({ error: 'Adjustment reason not found' });
        }
        
        // Actually delete the record from the database
        await adjustmentReason.destroy();
        
        res.json({ message: 'Adjustment reason deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Export adjustment reasons to Excel
router.get('/export/excel', async (req, res) => {
    try {
        // Build where clause for export filters
        const whereClause = {};
        
        if (req.query.search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${req.query.search}%` } },
                { name: { [Op.iLike]: `%${req.query.search}%` } },
                { description: { [Op.iLike]: `%${req.query.search}%` } }
            ];
        }
        
        if (req.query.adjustmentType) {
            whereClause.adjustment_type = req.query.adjustmentType;
        }
        
        if (req.query.isActive !== undefined) {
            whereClause.is_active = req.query.isActive === 'true';
        }
        
        if (req.query.trackingAccountId) {
            whereClause.tracking_account_id = req.query.trackingAccountId;
        }

        // Fetch adjustment reasons with all necessary relations for export
        const adjustmentReasons = await AdjustmentReason.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: Account,
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        // Transform data for export
        const transformedAdjustmentReasons = adjustmentReasons.map(reason => ({
            ...reason.toJSON(),
            created_by_name: reason.createdByUser ? `${reason.createdByUser.first_name} ${reason.createdByUser.last_name}` : 'System',
            updated_by_name: reason.updatedByUser ? `${reason.updatedByUser.first_name} ${reason.updatedByUser.last_name}` : null,
            tracking_account_name: reason.trackingAccount?.name || 'Unknown Account',
            corresponding_account_name: reason.correspondingAccount?.name || 'Unknown Account'
        }));

        // Create export service instance
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        
        // Generate Excel file
        const buffer = await exportService.exportAdjustmentReasonsToExcel(transformedAdjustmentReasons, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="adjustment_reasons_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
        } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export adjustment reasons to Excel', 
            details: error.message 
        });
    }
});

// Export adjustment reasons to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        // Build where clause for export filters (same as Excel)
        const whereClause = {};
        
        if (req.query.search) {
            whereClause[Op.or] = [
                { code: { [Op.iLike]: `%${req.query.search}%` } },
                { name: { [Op.iLike]: `%${req.query.search}%` } },
                { description: { [Op.iLike]: `%${req.query.search}%` } }
            ];
        }
        
        if (req.query.adjustmentType) {
            whereClause.adjustment_type = req.query.adjustmentType;
        }
        
        if (req.query.isActive !== undefined) {
            whereClause.is_active = req.query.isActive === 'true';
        }
        
        if (req.query.trackingAccountId) {
            whereClause.tracking_account_id = req.query.trackingAccountId;
        }

        // Fetch adjustment reasons with all necessary relations for export
        const adjustmentReasons = await AdjustmentReason.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: Account,
                    as: 'trackingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'correspondingAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        // Transform data for export
        const transformedAdjustmentReasons = adjustmentReasons.map(reason => ({
            ...reason.toJSON(),
            created_by_name: reason.createdByUser ? `${reason.createdByUser.first_name} ${reason.createdByUser.last_name}` : 'System',
            updated_by_name: reason.updatedByUser ? `${reason.updatedByUser.first_name} ${reason.updatedByUser.last_name}` : null,
            tracking_account_name: reason.trackingAccount?.name || 'Unknown Account',
            corresponding_account_name: reason.correspondingAccount?.name || 'Unknown Account'
        }));

        // Create export service instance
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        
        // Generate PDF file
        const buffer = await exportService.exportAdjustmentReasonsToPDF(transformedAdjustmentReasons, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="adjustment_reasons_export_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
        } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export adjustment reasons to PDF', 
            details: error.message 
        });
    }
});

module.exports = router; 