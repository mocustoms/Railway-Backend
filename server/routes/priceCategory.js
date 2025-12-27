const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const PriceCategory = require('../models/priceCategory');
const { Company } = require('../models');
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

// Get price category statistics
router.get('/stats', async (req, res) => {
  try {
    const totalCategories = await PriceCategory.count({
      where: buildCompanyWhere(req)
    });
    const activeCategories = await PriceCategory.count({ 
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactiveCategories = await PriceCategory.count({ 
      where: buildCompanyWhere(req, { is_active: false })
    });
    const increaseCategories = await PriceCategory.count({ 
      where: buildCompanyWhere(req, { price_change_type: 'increase' })
    });
    const decreaseCategories = await PriceCategory.count({ 
      where: buildCompanyWhere(req, { price_change_type: 'decrease' })
    });
    const scheduledCategories = await PriceCategory.count({ 
      where: buildCompanyWhere(req, { 
        scheduled_type: { [require('sequelize').Op.ne]: 'not_scheduled' } 
      })
    });

    // Count upcoming scheduled categories (with future dates)
    const upcomingScheduledCategories = await PriceCategory.count({
      where: buildCompanyWhere(req, {
        scheduled_type: { [require('sequelize').Op.ne]: 'not_scheduled' },
        scheduled_date: { [require('sequelize').Op.gt]: new Date() }
      })
    });
    
    // Get the last updated category
    const lastUpdatedCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { updated_at: { [require('sequelize').Op.ne]: null } }),
      order: [['updated_at', 'DESC']]
    });
    
    const lastUpdate = lastUpdatedCategory ? 
      new Date(lastUpdatedCategory.updated_at).toLocaleDateString() : 
      'Never';
    
    res.json({
      totalCategories,
      activeCategories,
      inactiveCategories,
      increaseCategories,
      decreaseCategories,
      scheduledCategories,
      upcomingScheduledCategories,
      lastUpdate
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all price categories with pagination and search
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (page - 1) * limit;
    
    const whereClause = {};
    if (search) {
      whereClause[require('sequelize').Op.or] = [
        { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { code: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: priceCategories } = await PriceCategory.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: require('../models/user'),
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: require('../models/user'),
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ],
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform data to include user names
    const transformedPriceCategories = priceCategories.map(category => {
      const plainCategory = category.get({ plain: true });
      return {
        ...plainCategory,
        created_by_name: plainCategory.createdByUser ? 
          `${plainCategory.createdByUser.first_name} ${plainCategory.createdByUser.last_name}` : null,
        updated_by_name: plainCategory.updatedByUser ? 
          `${plainCategory.updatedByUser.first_name} ${plainCategory.updatedByUser.last_name}` : null
      };
    });

    res.json({
      priceCategories: transformedPriceCategories,
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get price category by ID
router.get('/:id', async (req, res) => {
  try {
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        {
          model: require('../models/user'),
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: require('../models/user'),
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ]
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    res.json(priceCategory);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validation rules for new fields (code removed from required validation)
const priceCategoryValidation = [
  body('name').notEmpty().withMessage('Name is required'),
  body('price_change_type').isIn(['increase', 'decrease']).withMessage('Price change type must be increase or decrease'),
  body('percentage_change').isFloat({ min: 0, max: 100 }).withMessage('Percentage change must be between 0 and 100'),
  body('scheduled_type').isIn(['not_scheduled', 'one_time', 'recurring']).withMessage('Invalid scheduled type'),
  body('recurring_period').optional({ nullable: true }).isIn(['daily', 'weekly', 'monthly', 'yearly']).withMessage('Invalid recurring period'),
  body('scheduled_date').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
  
  // Enhanced recurring scheduling validation
  body('recurring_day_of_week').optional({ nullable: true }).isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).withMessage('Invalid day of week'),
  body('recurring_date').optional({ nullable: true }).isInt({ min: 1, max: 31 }).withMessage('Recurring date must be between 1 and 31'),
  body('recurring_month').optional({ nullable: true }).isIn(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']).withMessage('Invalid month'),
  body('start_time').optional({ nullable: true }).matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:MM format'),
  body('end_time').optional({ nullable: true }).matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:MM format'),
  
  body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
];

// Create new price category
router.post('/', priceCategoryValidation, csrfProtection, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  // Start transaction for atomic code generation and price category creation
  const transaction = await sequelize.transaction();
  
  try {
    const { 
      name, 
      description, 
      price_change_type, 
      percentage_change, 
      scheduled_type, 
      recurring_period, 
      scheduled_date,
      recurring_day_of_week,
      recurring_date,
      recurring_month,
      start_time,
      end_time
    } = req.body;
    
    // Validate scheduled fields based on scheduled_type
    if (scheduled_type === 'recurring' && !recurring_period) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Recurring period is required for recurring scheduled type' });
    }
    
    if (scheduled_type === 'one_time' && !scheduled_date) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Scheduled date is required for one-time scheduled type' });
    }
    
    // Enhanced validation for recurring scheduling
    if (scheduled_type === 'recurring') {
      if (recurring_period === 'weekly' && !recurring_day_of_week) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Day of week is required for weekly recurring schedule' });
      }
      if ((recurring_period === 'monthly' || recurring_period === 'yearly') && !recurring_date) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Date is required for monthly/yearly recurring schedule' });
      }
      if (recurring_period === 'yearly' && !recurring_month) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Month is required for yearly recurring schedule' });
      }
      if (!start_time || !end_time) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Start time and end time are required for recurring schedule' });
      }
    }
    
    // Check if price category name already exists in this company
    // Always check within company, even for super-admins
    if (!req.user.companyId) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Company ID is required to create a price category' 
      });
    }

    const existingPriceCategory = await PriceCategory.findOne({
      where: {
        name: name.trim(),
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingPriceCategory) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'A price category with this name already exists in your company' 
      });
    }

    // Get company code for code generation
    let companyCode = 'EMZ';
    try {
      const company = await Company.findByPk(req.user.companyId, {
        attributes: ['code', 'name'],
        transaction
      });
      
      if (company?.code) {
        companyCode = company.code.toUpperCase();
      } else if (company?.name) {
        companyCode = company.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMZ';
      }
    } catch (companyError) {
      // Continue with default companyCode
    }
    
    // Auto-generate price category code
    const code = await autoCodeService.generateNextCode(
      'price_categories',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'PRC',
        fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
        companyCode: companyCode
      }
    );
    
    const priceCategory = await PriceCategory.create({
      code,
      name,
      companyId: req.user.companyId,
      description,
      price_change_type,
      percentage_change,
      scheduled_type,
      recurring_period: scheduled_type === 'recurring' ? recurring_period : null,
      scheduled_date: scheduled_type === 'one_time' ? scheduled_date : null,
      recurring_day_of_week: scheduled_type === 'recurring' ? recurring_day_of_week : null,
      recurring_date: scheduled_type === 'recurring' ? recurring_date : null,
      recurring_month: scheduled_type === 'recurring' ? recurring_month : null,
      start_time: scheduled_type === 'recurring' ? start_time : null,
      end_time: scheduled_type === 'recurring' ? end_time : null,
      created_by: req.user.id,
      updated_by: req.user.id
    }, { transaction });
    
    // Commit transaction
    await transaction.commit();
    
    // Fetch the created price category with user associations
    const createdPriceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: priceCategory.id }),
      include: [
        {
          model: require('../models/user'),
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: require('../models/user'),
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ]
    });
    
    res.status(201).json(createdPriceCategory);
  } catch (error) {
    // Rollback transaction on error
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Price category code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update price category
router.put('/:id', priceCategoryValidation, csrfProtection, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  try {
    const { 
      code, 
      name, 
      description, 
      price_change_type, 
      percentage_change, 
      scheduled_type, 
      recurring_period, 
      scheduled_date,
      recurring_day_of_week,
      recurring_date,
      recurring_month,
      start_time,
      end_time,
      is_active 
    } = req.body;
    
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    
    // Validate scheduled fields based on scheduled_type
    if (scheduled_type === 'recurring' && !recurring_period) {
      return res.status(400).json({ error: 'Recurring period is required for recurring scheduled type' });
    }
    
    if (scheduled_type === 'one_time' && !scheduled_date) {
      return res.status(400).json({ error: 'Scheduled date is required for one-time scheduled type' });
    }
    
    // Enhanced validation for recurring scheduling
    if (scheduled_type === 'recurring') {
      if (recurring_period === 'weekly' && !recurring_day_of_week) {
        return res.status(400).json({ error: 'Day of week is required for weekly recurring schedule' });
      }
      if ((recurring_period === 'monthly' || recurring_period === 'yearly') && !recurring_date) {
        return res.status(400).json({ error: 'Date is required for monthly/yearly recurring schedule' });
      }
      if (recurring_period === 'yearly' && !recurring_month) {
        return res.status(400).json({ error: 'Month is required for yearly recurring schedule' });
      }
      if (!start_time || !end_time) {
        return res.status(400).json({ error: 'Start time and end time are required for recurring schedule' });
      }
    }
    
    // Check if code is being changed and validate uniqueness
    if (code && code.trim() !== '' && code !== priceCategory.code) {
      const existingCategory = await PriceCategory.findOne({
        where: buildCompanyWhere(req, { 
          code: code.trim(),
          id: { [Op.ne]: req.params.id }
        })
      });
      
      if (existingCategory) {
        return res.status(400).json({ 
          error: 'Validation error',
          details: `Price category code "${code.trim()}" already exists in your company`,
          field: 'code',
          value: code.trim()
        });
      }
    }
    
    await priceCategory.update({
      code: code || priceCategory.code,
      name,
      description,
      price_change_type,
      percentage_change,
      scheduled_type,
      recurring_period: scheduled_type === 'recurring' ? recurring_period : null,
      scheduled_date: scheduled_type === 'one_time' ? scheduled_date : null,
      recurring_day_of_week: scheduled_type === 'recurring' ? recurring_day_of_week : null,
      recurring_date: scheduled_type === 'recurring' ? recurring_date : null,
      recurring_month: scheduled_type === 'recurring' ? recurring_month : null,
      start_time: scheduled_type === 'recurring' ? start_time : null,
      end_time: scheduled_type === 'recurring' ? end_time : null,
      is_active,
      updated_by: req.user.id
    });
    
    // Fetch the updated price category with user associations
    const updatedPriceCategory = await PriceCategory.findByPk(req.params.id, {
      include: [
        {
          model: require('../models/user'),
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: require('../models/user'),
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ]
    });
    
    res.json(updatedPriceCategory);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Price category code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete price category (soft delete)
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    
    await priceCategory.update({
      is_active: false,
      updated_by: req.user.id
    });
    
    res.json({ message: 'Price category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Restore price category (reactivate)
router.patch('/:id/restore', async (req, res) => {
  try {
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    
    await priceCategory.update({
      is_active: true,
      updated_by: req.user.id
    });
    
    res.json({ message: 'Price category restored successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Hard delete price category (permanent removal)
router.delete('/:id/permanent', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    
    await priceCategory.destroy();
    
    res.json({ message: 'Price category permanently deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if price category is being used
router.get('/:id/usage', async (req, res) => {
  try {
    // For now, we'll check if the price category is active and has any scheduled changes
    // This can be enhanced later to check actual usage in pricing rules or other business logic
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    
    // Check if this price category has any scheduled changes or is currently in use
    // This is a basic implementation - can be enhanced based on business requirements
    const isCurrentlyUsed = priceCategory.scheduled_type !== 'not_scheduled' && 
                           priceCategory.is_active === true;
    
    // For demonstration, we'll consider it "used" if it has scheduled changes
    // In a real implementation, you might check:
    // - Pricing rules that reference this category
    // - Active price changes using this category
    // - Products or services that use this pricing category
    
    res.json({
      isUsed: isCurrentlyUsed,
      usageCount: isCurrentlyUsed ? 1 : 0,
      message: isCurrentlyUsed 
        ? 'This price category has scheduled price changes and is currently active' 
        : 'This price category is not currently in use'
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deactivate price category (for used categories)
router.put('/:id/deactivate', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const priceCategory = await PriceCategory.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!priceCategory) {
      return res.status(404).json({ error: 'Price category not found' });
    }
    
    await priceCategory.update({
      is_active: false,
      updated_by: req.user.id
    });
    
    res.json({ 
      message: 'Price category deactivated successfully',
      priceCategory: priceCategory
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export price categories to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search, status, changeType, scheduledType } = req.query;
    
    const whereClause = {};
    
    if (search) {
      whereClause[require('sequelize').Op.or] = [
        { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { code: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status && status !== 'all') {
      whereClause.is_active = status === 'active';
    }
    
    if (changeType && changeType !== 'all') {
      whereClause.price_change_type = changeType;
    }
    
    if (scheduledType && scheduledType !== 'all') {
      whereClause.scheduled_type = scheduledType;
    }
    
    const priceCategories = await PriceCategory.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: require('../models/user'),
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'created_by'
        },
        {
          model: require('../models/user'),
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'updated_by'
        }
      ],
      order: [['created_at', 'DESC']]
    });
    
    // Convert to CSV format (Excel can open CSV files)
    const headers = [
      'Category Name',
      'Code',
      'Description',
      'Price Change Type',
      'Percentage Change',
      'Scheduled Type',
      'Recurring Period',
      'Scheduled Date',
      'Is Active',
      'Created By',
      'Updated By',
      'Created At',
      'Updated At'
    ];

    const csvData = priceCategories.map(category => [
      category.name,
      category.code,
      category.description || '',
      category.price_change_type,
      `${category.percentage_change}%`,
      category.scheduled_type,
      category.recurring_period || '',
      category.scheduled_date ? new Date(category.scheduled_date).toLocaleDateString() : '',
      category.is_active ? 'Yes' : 'No',
      category.createdByUser ? 
        `${category.createdByUser.first_name || ''} ${category.createdByUser.last_name || ''}`.trim() || 
        category.createdByUser.username : 'N/A',
      category.updatedByUser ? 
        `${category.updatedByUser.first_name || ''} ${category.updatedByUser.last_name || ''}`.trim() || 
        category.updatedByUser.username : 'N/A',
      new Date(category.created_at).toLocaleDateString(),
      new Date(category.updated_at).toLocaleDateString()
    ]);

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Set headers for CSV download (Excel can open CSV files)
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="price-categories.csv"');
    
    // Send CSV data
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export price categories to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search, status, changeType, scheduledType } = req.query;
    
    const whereClause = {};
    
    if (search) {
      whereClause[require('sequelize').Op.iLike] = [
        { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { code: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { description: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status && status !== 'all') {
      whereClause.is_active = status === 'active';
    }
    
    if (changeType && changeType !== 'all') {
      whereClause.price_change_type = changeType;
    }
    
    if (scheduledType && scheduledType !== 'all') {
      whereClause.scheduled_type = scheduledType;
    }
    
    const priceCategories = await PriceCategory.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: require('../models/user'),
          as: 'createdByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'created_by'
        },
        {
          model: require('../models/user'),
          as: 'updatedByUser',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'updated_by'
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=price-categories-${new Date().toISOString().split('T')[0]}.pdf`);
      res.send(buffer);
    });

    // Add title
    doc.fontSize(20).font('Helvetica-Bold').text('Price Categories Report', { align: 'center' });
    doc.moveDown();

    // Add export date and filters
    doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
    doc.moveDown();

    if (search || status !== 'all' || changeType !== 'all' || scheduledType !== 'all') {
      doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
      if (search) doc.fontSize(10).font('Helvetica').text(`Search: ${search}`);
      if (status !== 'all') doc.fontSize(10).font('Helvetica').text(`Status: ${status}`);
      if (changeType !== 'all') doc.fontSize(10).font('Helvetica').text(`Change Type: ${changeType}`);
      if (scheduledType !== 'all') doc.fontSize(10).font('Helvetica').text(`Scheduled Type: ${scheduledType}`);
      doc.moveDown();
    }

    // Add table headers
    const headers = ['Name', 'Code', 'Type', 'Change', 'Scheduled', 'Status', 'Created By'];
    const columnWidths = [120, 60, 60, 60, 80, 50, 100];
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
    priceCategories.forEach((category) => {
      const rowData = [
        category.name,
        category.code,
        category.price_change_type.charAt(0).toUpperCase() + category.price_change_type.slice(1),
        `${category.percentage_change}%`,
        category.scheduled_type === 'not_scheduled' ? 'Not Scheduled' : 
        category.scheduled_type === 'one_time' ? 'One Time' : 
        category.scheduled_type === 'recurring' ? 'Recurring' : category.scheduled_type,
        category.is_active ? 'Active' : 'Inactive',
        category.createdByUser ? 
          `${category.createdByUser.first_name || ''} ${category.createdByUser.last_name || ''}`.trim() || 
          category.createdByUser.username : 'N/A'
      ];

      rowData.forEach((cell, index) => {
        doc.text(cell, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
      });

      yPosition += 15;
      
      // Add page break if needed
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 