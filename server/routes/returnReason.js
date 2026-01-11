const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ReturnReason, User, Account } = require('../models');
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

// Get all return reasons with pagination and search
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
            orderClause = [[{ model: User, as: 'createdByUserReturnReason' }, 'first_name', sortOrder]];
        } else if (sortBy === 'updatedBy' || sortBy === 'updated_by') {
            orderClause = [[{ model: User, as: 'updatedByUserReturnReason' }, 'first_name', sortOrder]];
        } else if (sortBy === 'refundAccount' || sortBy === 'refund_account') {
            orderClause = [[{ model: Account, as: 'refundAccount' }, 'name', sortOrder]];
        } else if (sortBy === 'inventoryAccount' || sortBy === 'inventory_account') {
            orderClause = [[{ model: Account, as: 'inventoryAccount' }, 'name', sortOrder]];
        } else if (sortBy === 'returnType' || sortBy === 'return_type') {
            orderClause = [['return_type', sortOrder]];
        } else if (sortBy === 'isActive' || sortBy === 'is_active') {
            orderClause = [['is_active', sortOrder]];
        } else if (sortBy === 'requiresApproval' || sortBy === 'requires_approval') {
            orderClause = [['requires_approval', sortOrder]];
        } else if (sortBy === 'createdAt' || sortBy === 'created_at') {
            orderClause = [['created_at', sortOrder]];
        } else if (sortBy === 'updatedAt' || sortBy === 'updated_at') {
            orderClause = [['updated_at', sortOrder]];
        } else {
            // For other fields like 'name', 'code', 'description'
            orderClause = [[sortBy, sortOrder]];
        }

        const { count, rows } = await ReturnReason.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
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
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// GET /api/return-reasons/all - Get all active return reasons for dropdowns
router.get('/all', async (req, res) => {
    try {
        const returnReasons = await ReturnReason.findAll({
            where: buildCompanyWhere(req, {
                is_active: true
            }),
            include: [
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        res.json(returnReasons);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch return reasons' });
    }
});

// Get return reason statistics
router.get('/stats', async (req, res) => {
    try {
        const total = await ReturnReason.count({
            where: buildCompanyWhere(req)
        });
        const active = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactive = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { is_active: false })
        });
        const requiresApproval = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { requires_approval: true })
        });
        const fullRefund = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { return_type: 'full_refund' })
        });
        const partialRefund = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { return_type: 'partial_refund' })
        });
        const exchange = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { return_type: 'exchange' })
        });
        const storeCredit = await ReturnReason.count({ 
            where: buildCompanyWhere(req, { return_type: 'store_credit' })
        });

        res.json({
            stats: {
                total,
                active,
                inactive,
                requiresApproval,
                fullRefund,
                partialRefund,
                exchange,
                storeCredit
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Get return reason by ID
router.get('/:id', async (req, res) => {
    try {
        const returnReason = await ReturnReason.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: User,
                    as: 'createdByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ]
        });
        
        if (!returnReason) {
            return res.status(404).json({ error: 'Return reason not found' });
        }
        
        res.json(returnReason);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new return reason
router.post('/', csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and reason creation
    const transaction = await sequelize.transaction();
    
    try {
        const { 
            name, 
            description, 
            return_type, 
            requires_approval, 
            max_return_days,
            refund_account_id, 
            inventory_account_id,
            is_active 
        } = req.body;
        
        // Validate required fields
        if (!name || !return_type) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Missing required fields: name and return_type are required' });
        }
        
        // Validate return type
        if (!['full_refund', 'partial_refund', 'exchange', 'store_credit'].includes(return_type)) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Invalid return type. Must be "full_refund", "partial_refund", "exchange", or "store_credit"' });
        }

        // Check if return reason name already exists in this company
        // Always check within company, even for super-admins
        if (!req.user.companyId) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'Company ID is required to create a return reason' 
            });
        }

        const existingReturnReason = await ReturnReason.findOne({
            where: {
                name: name.trim(),
                companyId: req.user.companyId
            },
            transaction
        });

        if (existingReturnReason) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'A return reason with this name already exists in your company' 
            });
        }
        
        // Auto-generate return reason code
        const code = await autoCodeService.generateNextCode(
            'return_reasons',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'RET',
                fallbackFormat: '{PREFIX}-{NUMBER}'
            }
        );
        
        // Properly handle boolean fields
        const requiresApprovalBoolean = requires_approval === 'true' || requires_approval === true || requires_approval === '1' || requires_approval === 1;
        const isActiveBoolean = is_active === 'true' || is_active === true || is_active === '1' || is_active === 1;
        
        const returnReason = await ReturnReason.create({
            companyId: req.user.companyId,
            code,
            name,
            description,
            return_type,
            requires_approval: requiresApprovalBoolean,
            max_return_days: max_return_days || null,
            refund_account_id: refund_account_id || null,
            inventory_account_id: inventory_account_id || null,
            is_active: isActiveBoolean,
            created_by: req.user.id,
            updated_by: req.user.id
        }, { transaction });
        
        // Commit transaction
        await transaction.commit();
        
        // Fetch the created record with associations
        const createdReason = await ReturnReason.findByPk(returnReason.id, {
            include: [
                {
                    model: User,
                    as: 'createdByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: User,
                    as: 'updatedByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name']
                },
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code']
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
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
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Return reason code already exists' });
        }
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ error: 'Invalid account ID' });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Update return reason
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const returnReason = await ReturnReason.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!returnReason) {
            return res.status(404).json({ error: 'Return reason not found' });
        }
        
        const { 
            code, 
            name, 
            description, 
            return_type, 
            requires_approval, 
            max_return_days,
            refund_account_id, 
            inventory_account_id,
            is_active 
        } = req.body;
        
        // Validate required fields
        if (!name || !return_type) {
            return res.status(400).json({ error: 'Missing required fields: name and return_type are required' });
        }
        
        // Validate return type
        if (!['full_refund', 'partial_refund', 'exchange', 'store_credit'].includes(return_type)) {
            return res.status(400).json({ error: 'Invalid return type. Must be "full_refund", "partial_refund", "exchange", or "store_credit"' });
        }
        
        // Check if code already exists (excluding current record, within company scope)
        if (code && code !== returnReason.code) {
            const codeWhere = buildCompanyWhere(req, { code });
            if (!req.user.isSystemAdmin && req.user.companyId) {
                codeWhere.companyId = req.user.companyId;
            }
            const existingReason = await ReturnReason.findOne({ where: codeWhere });
            if (existingReason) {
                return res.status(400).json({ error: 'Return reason code already exists in your company' });
            }
        }
        
        // Properly handle boolean fields
        const requiresApprovalBoolean = requires_approval === 'true' || requires_approval === true || requires_approval === '1' || requires_approval === 1;
        const isActiveBoolean = is_active === 'true' || is_active === true || is_active === '1' || is_active === 1;
        
        await returnReason.update({
            code,
            name,
            description,
            return_type,
            requires_approval: requiresApprovalBoolean,
            max_return_days: max_return_days || null,
            refund_account_id: refund_account_id || null,
            inventory_account_id: inventory_account_id || null,
            is_active: isActiveBoolean,
            updated_by: req.user.id
        });
        
        // Fetch the updated record with associations
        const updatedReason = await ReturnReason.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    as: 'createdByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ]
        });
        
        res.json(updatedReason);
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Return reason code already exists' });
        }
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ error: 'Invalid account ID' });
        }
        res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
    }
});

// Delete return reason (hard delete)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const returnReason = await ReturnReason.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!returnReason) {
            return res.status(404).json({ error: 'Return reason not found' });
        }
        
        // Actually delete the record from the database
        await returnReason.destroy();
        
        res.json({ message: 'Return reason deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Export return reasons to Excel
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
        
        if (req.query.returnType) {
            whereClause.return_type = req.query.returnType;
        }
        
        if (req.query.isActive !== undefined) {
            whereClause.is_active = req.query.isActive === 'true';
        }
        
        if (req.query.requiresApproval !== undefined) {
            whereClause.requires_approval = req.query.requiresApproval === 'true';
        }

        // Fetch return reasons with all necessary relations for export
        const returnReasons = await ReturnReason.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        // Transform data for export
        const transformedReturnReasons = returnReasons.map(reason => ({
            ...reason.toJSON(),
            created_by_name: reason.createdByUserReturnReason ? `${reason.createdByUserReturnReason.first_name} ${reason.createdByUserReturnReason.last_name}` : 'System',
            updated_by_name: reason.updatedByUserReturnReason ? `${reason.updatedByUserReturnReason.first_name} ${reason.updatedByUserReturnReason.last_name}` : null,
            refund_account_name: reason.refundAccount?.name || 'Not assigned',
            inventory_account_name: reason.inventoryAccount?.name || 'Not assigned'
        }));

        // Create export service instance
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        
        // Generate Excel file
        const buffer = await exportService.exportReturnReasonsToExcel(transformedReturnReasons, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="return_reasons_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export return reasons to Excel', 
            details: error.message 
        });
    }
});

// Export return reasons to PDF
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
        
        if (req.query.returnType) {
            whereClause.return_type = req.query.returnType;
        }
        
        if (req.query.isActive !== undefined) {
            whereClause.is_active = req.query.isActive === 'true';
        }
        
        if (req.query.requiresApproval !== undefined) {
            whereClause.requires_approval = req.query.requiresApproval === 'true';
        }

        // Fetch return reasons with all necessary relations for export
        const returnReasons = await ReturnReason.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'createdByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUserReturnReason',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: Account,
                    as: 'refundAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                },
                {
                    model: Account,
                    as: 'inventoryAccount',
                    attributes: ['id', 'name', 'code'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });

        // Transform data for export
        const transformedReturnReasons = returnReasons.map(reason => ({
            ...reason.toJSON(),
            created_by_name: reason.createdByUserReturnReason ? `${reason.createdByUserReturnReason.first_name} ${reason.createdByUserReturnReason.last_name}` : 'System',
            updated_by_name: reason.updatedByUserReturnReason ? `${reason.updatedByUserReturnReason.first_name} ${reason.updatedByUserReturnReason.last_name}` : null,
            refund_account_name: reason.refundAccount?.name || 'Not assigned',
            inventory_account_name: reason.inventoryAccount?.name || 'Not assigned'
        }));

        // Create export service instance
        const ExportService = require('../utils/exportService');
        const exportService = new ExportService();
        
        // Generate PDF file
        const buffer = await exportService.exportReturnReasonsToPDF(transformedReturnReasons, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="return_reasons_export_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export return reasons to PDF', 
            details: error.message 
        });
    }
});

module.exports = router;
