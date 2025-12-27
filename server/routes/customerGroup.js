const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { CustomerGroup, User, Account } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');
const PDFDocument = require('pdfkit');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get customer group statistics
router.get('/stats', async (req, res) => {
  try {
    const totalGroups = await CustomerGroup.count({
      where: buildCompanyWhere(req)
    });
    const activeGroups = await CustomerGroup.count({ 
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactiveGroups = await CustomerGroup.count({ 
      where: buildCompanyWhere(req, { is_active: false })
    });
    const defaultGroups = await CustomerGroup.count({ 
      where: buildCompanyWhere(req, { is_default: true })
    });

    res.json({
      totalGroups,
      activeGroups,
      inactiveGroups,
      defaultGroups,
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer group statistics' });
  }
});

// Get all customer groups with pagination, search, and filtering
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = 'all',
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    const whereClause = {};

    // Add search filter
    if (search) {
      whereClause[require('sequelize').Op.or] = [
        { group_name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { group_code: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }

    // Add status filter
    if (status === 'active') {
      whereClause.is_active = true;
    } else if (status === 'inactive') {
      whereClause.is_active = false;
    }

    const { count, rows } = await CustomerGroup.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: Account,
          as: 'accountReceivable',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'defaultLiabilityAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        }
      ],
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform data to include account receivable and liability account information
    const transformedGroups = rows.map(group => ({
      ...group.toJSON(),
      account_receivable_name: group.accountReceivable ? `${group.accountReceivable.code} - ${group.accountReceivable.name}` : null,
      default_liability_account_name: group.defaultLiabilityAccount ? `${group.defaultLiabilityAccount.code} - ${group.defaultLiabilityAccount.name}` : null,
      created_by_name: group.creator ? `${group.creator.first_name} ${group.creator.last_name}` : null,
      updated_by_name: group.updater ? `${group.updater.first_name} ${group.updater.last_name}` : null
    }));

    res.json({
      success: true,
      data: transformedGroups,
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
    res.status(500).json({ success: false, error: 'Failed to fetch customer groups' });
  }
});

// Get active customer groups for dropdowns
router.get('/active', async (req, res) => {
  try {
    const customerGroups = await CustomerGroup.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'group_name', 'group_code', 'is_default'],
      order: [['group_name', 'ASC']]
    });

    res.json(customerGroups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active customer groups' });
  }
});

// Get customer group by ID
router.get('/:id', async (req, res) => {
  try {
    const customerGroup = await CustomerGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ]
    });

    if (!customerGroup) {
      return res.status(404).json({ error: 'Customer group not found' });
    }

    res.json(customerGroup);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer group' });
  }
});

// Create new customer group
router.post('/', [
  body('group_name')
    .trim()
    .notEmpty()
    .withMessage('Group name is required')
    .isLength({ max: 100 })
    .withMessage('Group name must not exceed 100 characters'),
  body('is_default')
    .optional()
    .isBoolean()
    .withMessage('Is default must be a boolean value'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('account_receivable_id')
    .optional()
    .isUUID()
    .withMessage('Account receivable ID must be a valid UUID'),
  body('default_liability_account_id')
    .optional()
    .isUUID()
    .withMessage('Default liability account ID must be a valid UUID')
], csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    // Validate companyId exists
    if (!req.user || !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ 
        error: 'Company access required. Please ensure you are assigned to a company.' 
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await transaction.rollback();
      return res.status(400).json({ errors: errors.array() });
    }

    const { group_name, is_default = false, description, account_receivable_id, default_liability_account_id } = req.body;
    
    // Trim and validate group name
    const trimmedGroupName = group_name?.trim();
    if (!trimmedGroupName || trimmedGroupName.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Group name cannot be empty or contain only whitespace' });
    }

    // Check if customer group name already exists in this company
    // Always check within company, even for super-admins
    if (!req.user.companyId) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Company ID is required to create a customer group' 
      });
    }

    const existingCustomerGroup = await CustomerGroup.findOne({
      where: {
        group_name: trimmedGroupName,
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingCustomerGroup) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'A customer group with this name already exists in your company' 
      });
    }

    // Get company code for code generation
    const { Company } = require('../models');
    const company = await Company.findByPk(req.user.companyId, { transaction });
    if (!company) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Company not found' });
    }
    const companyCode = company?.code || null;

    // Auto-generate group code
    const group_code = await autoCodeService.generateNextCode(
      'customer_groups',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'CG',
        fallbackFormat: '{PREFIX}-{NUMBER}',
        companyCode
      }
    );

    // Check if customer group code already exists in this company (safety check)
    const existingCustomerGroupByCode = await CustomerGroup.findOne({
      where: {
        group_code: group_code,
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingCustomerGroupByCode) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'A customer group with this code already exists in your company. Please try again.' 
      });
    }

    // Validate account references belong to the same company
    if (account_receivable_id) {
      const Account = require('../models/account');
      const receivableAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: account_receivable_id }),
        transaction
      });
      if (!receivableAccount) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Account receivable not found or does not belong to your company' });
      }
    }

    if (default_liability_account_id) {
      const Account = require('../models/account');
      const liabilityAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: default_liability_account_id }),
        transaction
      });
      if (!liabilityAccount) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Default liability account not found or does not belong to your company' });
      }
    }

    const customerGroup = await CustomerGroup.create({
      group_name: trimmedGroupName, // Use trimmed name
      group_code,
      companyId: req.user.companyId,
      is_default,
      description: description?.trim() || null,
      account_receivable_id,
      default_liability_account_id,
      created_by: req.user.id
    }, { transaction });

    await transaction.commit();

    // Fetch the created group with associations
    const createdGroup = await CustomerGroup.findByPk(customerGroup.id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ]
    });

    res.status(201).json(createdGroup);
  } catch (error) {
    await transaction.rollback();
    
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors?.map(err => ({
        field: err.path,
        message: err.message
      })) || [];
      return res.status(400).json({ 
        error: 'Validation error',
        errors: validationErrors,
        message: error.message
      });
    }
    
    // Handle unique constraint errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      const constraint = error.fields || {};
      const constraintName = error.parent?.constraint || '';
      
      // Check if it's a group_name constraint violation
      if (constraint.group_name || constraintName.includes('group_name')) {
        return res.status(400).json({ 
          error: 'Duplicate group name',
          message: `A customer group with the name "${req.body.group_name}" already exists for your company. Please choose a different name.`
        });
      }
      
      // Check if it's a group_code constraint violation
      if (constraint.group_code || constraintName.includes('group_code')) {
        return res.status(400).json({ 
          error: 'Duplicate group code',
          message: 'A customer group with this code already exists. This should not happen as codes are auto-generated. Please try again.'
        });
      }
      
      return res.status(400).json({ 
        error: 'Duplicate entry',
        message: error.message || 'A record with this information already exists',
        constraint
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create customer group',
      message: error.message || 'Unknown error occurred'
    });
  }
});

// Update customer group
router.put('/:id', [
  body('group_name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Group name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Group name must not exceed 100 characters'),
  body('is_default')
    .optional()
    .isBoolean()
    .withMessage('Is default must be a boolean value'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('account_receivable_id')
    .optional()
    .isUUID()
    .withMessage('Account receivable ID must be a valid UUID'),
  body('default_liability_account_id')
    .optional()
    .isUUID()
    .withMessage('Default liability account ID must be a valid UUID')
], csrfProtection, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const customerGroup = await CustomerGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!customerGroup) {
      return res.status(404).json({ error: 'Customer group not found' });
    }

    const { group_name, is_default, description, account_receivable_id, default_liability_account_id } = req.body;

    // Prevent code updates - code is auto-generated and immutable
    if (req.body.group_code && req.body.group_code !== customerGroup.group_code) {
      return res.status(400).json({ error: 'Group code cannot be changed. It is automatically generated.' });
    }

    // Check if group_name is being changed and validate uniqueness
    const newGroupName = group_name?.trim();
    if (newGroupName && newGroupName !== customerGroup.group_name) {
      const existingGroup = await CustomerGroup.findOne({
        where: buildCompanyWhere(req, { 
          group_name: newGroupName,
          id: { [Op.ne]: req.params.id }
        })
      });
      
      if (existingGroup) {
        return res.status(400).json({ 
          error: 'Validation error',
          details: `Customer group name "${newGroupName}" already exists in your company`,
          field: 'group_name',
          value: newGroupName
        });
      }
    }

    await customerGroup.update({
      group_name: newGroupName || customerGroup.group_name,
      is_default: is_default !== undefined ? is_default : customerGroup.is_default,
      description: description !== undefined ? description : customerGroup.description,
      account_receivable_id: account_receivable_id !== undefined ? account_receivable_id : customerGroup.account_receivable_id,
      default_liability_account_id: default_liability_account_id !== undefined ? default_liability_account_id : customerGroup.default_liability_account_id,
      updated_by: req.user.id
    });

    // Fetch the updated group with associations
    const updatedGroup = await CustomerGroup.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: Account,
          as: 'accountReceivable',
          attributes: ['id', 'code', 'name'],
          required: false
        },
        {
          model: Account,
          as: 'defaultLiabilityAccount',
          attributes: ['id', 'code', 'name'],
          required: false
        }
      ]
    });

    res.json(updatedGroup);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update customer group' });
  }
});

// Toggle customer group status
router.patch('/:id/toggle-status', async (req, res) => {
  try {
    const customerGroup = await CustomerGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!customerGroup) {
      return res.status(404).json({ error: 'Customer group not found' });
    }

    await customerGroup.update({
      is_active: !customerGroup.is_active,
      updated_by: req.user.id
    });

    res.json({ 
      message: `Customer group ${customerGroup.is_active ? 'activated' : 'deactivated'} successfully`,
      is_active: customerGroup.is_active
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle customer group status' });
  }
});

// Check customer group usage before deletion
router.get('/:id/usage', async (req, res) => {
  try {
    const customerGroup = await CustomerGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!customerGroup) {
      return res.status(404).json({ error: 'Customer group not found' });
    }

    // Check if customer group is being used by customers
    // Note: This would need to be implemented when Customer model is created
    const usageCount = 0; // Placeholder for now

    res.json({
      isUsed: usageCount > 0,
      usageCount,
      canDelete: usageCount === 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check customer group usage' });
  }
});

// Delete customer group
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const customerGroup = await CustomerGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!customerGroup) {
      return res.status(404).json({ error: 'Customer group not found' });
    }

    // Check if it's the default group
    if (customerGroup.is_default) {
      return res.status(400).json({ 
        error: 'Cannot delete default customer group. Please set another group as default first.' 
      });
    }

    await customerGroup.destroy();
    res.json({ message: 'Customer group deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete customer group' });
  }
});

// Export customer groups to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;
    
    const whereClause = {};
    
    if (search) {
      whereClause[require('sequelize').Op.or] = [
        { group_name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { group_code: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status === 'active') {
      whereClause.is_active = true;
    } else if (status === 'inactive') {
      whereClause.is_active = false;
    }

    const customerGroups = await CustomerGroup.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['first_name', 'last_name']
        }
      ],
      order: [['group_name', 'ASC']]
    });

    // Generate Excel file (simplified version)
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customer Groups');

    // Add headers
    worksheet.columns = [
      { header: 'Group Name', key: 'group_name', width: 30 },
      { header: 'Group Code', key: 'group_code', width: 15 },
      { header: 'Is Default', key: 'is_default', width: 12 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created By', key: 'created_by', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 20 }
    ];

    // Add data
    customerGroups.forEach(group => {
      worksheet.addRow({
        group_name: group.group_name,
        group_code: group.group_code,
        is_default: group.is_default ? 'Yes' : 'No',
        description: group.description || '',
        status: group.is_active ? 'Active' : 'Inactive',
        created_by: group.creator ? `${group.creator.first_name} ${group.creator.last_name}` : '',
        created_at: group.created_at.toLocaleDateString()
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=customer-groups.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to export customer groups' });
  }
});

// Export customer groups to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;
    
    const whereClause = {};
    
    if (search) {
      whereClause[require('sequelize').Op.or] = [
        { group_name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { group_code: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status === 'active') {
      whereClause.is_active = true;
    } else if (status === 'inactive') {
      whereClause.is_active = false;
    }

    const customerGroups = await CustomerGroup.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['first_name', 'last_name']
        }
      ],
      order: [['group_name', 'ASC']]
    });

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=customer-groups.pdf');
    doc.pipe(res);

    // Add title
    doc.fontSize(20).text('Customer Groups Report', { align: 'center' });
    doc.moveDown();

    // Add generation date
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'right' });
    doc.moveDown();

    // Add table headers
    doc.fontSize(10);
    doc.text('Group Name', 50, doc.y);
    doc.text('Group Code', 200, doc.y);
    doc.text('Default', 280, doc.y);
    doc.text('Status', 330, doc.y);
    doc.text('Created By', 380, doc.y);
    doc.moveDown();

    // Add data rows
    customerGroups.forEach(group => {
      doc.text(group.group_name || '', 50, doc.y);
      doc.text(group.group_code || '', 200, doc.y);
      doc.text(group.is_default ? 'Yes' : 'No', 280, doc.y);
      doc.text(group.is_active ? 'Active' : 'Inactive', 330, doc.y);
      doc.text(group.creator ? `${group.creator.first_name} ${group.creator.last_name}` : '', 380, doc.y);
      doc.moveDown();
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to export customer groups to PDF' });
  }
});

module.exports = router;

