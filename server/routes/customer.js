const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const autoCodeService = require('../utils/autoCodeService');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Customer, CustomerGroup, Account, LoyaltyCardConfig, User } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// List with pagination, search, filters, sorting
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = 'all',
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    const where = {};
    if (search) {
      where[Op.or] = [
        { full_name: { [Op.iLike]: `%${search}%` } },
        { customer_id: { [Op.iLike]: `%${search}%` } },
        { phone_number: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    if (status !== 'all') {
      where.is_active = status === 'active';
    }

    // Build final where clause with company filter
    const finalWhere = buildCompanyWhere(req, where);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhere.companyId = req.user.companyId;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build order clause - handle both direct fields and associated model fields
    let orderClause = [];
    
    // Direct fields that can be sorted directly
    const directFields = {
      'customer_id': 'customer_id',
      'full_name': 'full_name',
      'phone_number': 'phone_number',
      'email': 'email',
      'website': 'website',
      'fax': 'fax',
      'address': 'address',
      'birthday': 'birthday',
      'loyalty_card_number': 'loyalty_card_number',
      'account_balance': 'account_balance',
      'debt_balance': 'debt_balance',
      'deposit_balance': 'deposit_balance',
      'loyalty_points': 'loyalty_points',
      'is_active': 'is_active',
      'created_at': 'created_at',
      'updated_at': 'updated_at'
    };
    
    // Associated model fields that need special handling
    if (sort_by === 'group_name') {
      orderClause = [[{ model: CustomerGroup, as: 'group' }, 'group_name', sort_order.toUpperCase()]];
    } else if (sort_by === 'account_receivable_name') {
      orderClause = [[{ model: Account, as: 'defaultReceivableAccount' }, 'name', sort_order.toUpperCase()]];
    } else if (sort_by === 'loyalty_card_name') {
      orderClause = [[{ model: LoyaltyCardConfig, as: 'loyaltyCardConfig' }, 'loyalty_card_name', sort_order.toUpperCase()]];
    } else if (sort_by === 'created_by_name') {
      orderClause = [[{ model: User, as: 'creator' }, 'first_name', sort_order.toUpperCase()]];
    } else if (sort_by === 'updated_by_name') {
      orderClause = [[{ model: User, as: 'updater' }, 'first_name', sort_order.toUpperCase()]];
    } else if (directFields[sort_by]) {
      // Direct field - use the database column name
      orderClause = [[directFields[sort_by], sort_order.toUpperCase()]];
    } else {
      // Default to created_at if field not recognized
      orderClause = [['created_at', 'DESC']];
    }
    
    const { count, rows } = await Customer.findAndCountAll({
      where: finalWhere,
      include: [
        { 
          model: CustomerGroup, 
          as: 'group', 
          attributes: ['id', 'group_name', 'default_liability_account_id'],
          where: buildCompanyWhere(req), // Ensure CustomerGroup is also filtered
          required: false, // LEFT JOIN so customers without groups are still included
          include: [
            { model: Account, as: 'defaultLiabilityAccount', attributes: ['id', 'code', 'name'] }
          ]
        },
        { model: Account, as: 'defaultReceivableAccount', attributes: ['id', 'code', 'name'] },
        { model: LoyaltyCardConfig, as: 'loyaltyCardConfig', attributes: ['id', 'loyalty_card_name'] },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'] }
      ],
      order: orderClause,
      limit: parseInt(limit),
      offset
    });

    const data = rows.map(c => {
      const json = c.toJSON();
      // Ensure companyId is included in response for verification
      return {
        ...json,
        companyId: json.companyId || c.getDataValue('companyId') || null, // Explicitly include companyId
        group_name: c.group ? c.group.group_name : null,
        default_liability_account_id: c.group?.defaultLiabilityAccount?.id || null,
        default_liability_account_name: c.group?.defaultLiabilityAccount ? `${c.group.defaultLiabilityAccount.code} - ${c.group.defaultLiabilityAccount.name}` : null,
        account_receivable_name: c.defaultReceivableAccount ? `${c.defaultReceivableAccount.code} - ${c.defaultReceivableAccount.name}` : null,
        loyalty_card_name: c.loyaltyCardConfig ? c.loyaltyCardConfig.loyalty_card_name : null,
        created_by_name: c.creator ? `${c.creator.first_name} ${c.creator.last_name}` : null,
        updated_by_name: c.updater ? `${c.updater.first_name} ${c.updater.last_name}` : null
      };
    });

    return res.json({
      success: true,
      data,
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
    return res.status(500).json({ success: false, error: 'Failed to fetch customers' });
  }
});

// Create
router.post('/', csrfProtection, async (req, res) => {
  // Start transaction for atomic code generation and customer creation
  const transaction = await Customer.sequelize.transaction();
  
  try {
    const {
      customer_group_id,
      full_name,
      address,
      default_receivable_account_id,
      fax,
      loyalty_card_number,
      loyalty_card_config_id,
      birthday,
      phone_number,
      email,
      website,
      is_active = true
    } = req.body;

    // Basic validation for required fields
    if (!customer_group_id || !full_name) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'customer_group_id and full_name are required' });
    }

    // Normalize empty strings to null for optional fields to satisfy DB validators
    const normalize = (v) => (v === '' || v === undefined ? null : v);
    const sanitized = {
      address: normalize(address),
      default_receivable_account_id: normalize(default_receivable_account_id),
      fax: normalize(fax),
      loyalty_card_number: normalize(loyalty_card_number),
      loyalty_card_config_id: normalize(loyalty_card_config_id),
      birthday: normalize(birthday),
      phone_number: normalize(phone_number),
      email: normalize(email),
      website: normalize(website)
    };

    // Validate companyId exists
    if (!req.user || !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ 
        success: false,
        error: 'Company access required. Please ensure you are assigned to a company.' 
      });
    }

    // Validate customer_group_id belongs to the same company
    const customerGroup = await CustomerGroup.findOne({
      where: buildCompanyWhere(req, { id: customer_group_id }),
      transaction
    });
    if (!customerGroup) {
      await transaction.rollback();
      return res.status(400).json({ 
        success: false,
        error: 'Customer group not found or does not belong to your company' 
      });
    }

    // Validate default_receivable_account_id belongs to the same company (if provided)
    if (sanitized.default_receivable_account_id) {
      const receivableAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: sanitized.default_receivable_account_id }),
        transaction
      });
      if (!receivableAccount) {
        await transaction.rollback();
        return res.status(400).json({ 
          success: false,
          error: 'Account receivable not found or does not belong to your company' 
        });
      }
    }

    // Validate loyalty_card_config_id belongs to the same company (if provided)
    if (sanitized.loyalty_card_config_id) {
      const loyaltyConfig = await LoyaltyCardConfig.findOne({
        where: buildCompanyWhere(req, { id: sanitized.loyalty_card_config_id }),
        transaction
      });
      if (!loyaltyConfig) {
        await transaction.rollback();
        return res.status(400).json({ 
          success: false,
          error: 'Loyalty card configuration not found or does not belong to your company' 
        });
      }
    }

    // Check if customer name already exists in this company
    // Always check within company, even for super-admins
    if (!req.user.companyId) {
      await transaction.rollback();
      return res.status(400).json({ 
        success: false,
        error: 'Company ID is required to create a customer' 
      });
    }

    const existingCustomerByName = await Customer.findOne({
      where: {
        full_name: full_name.trim(),
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingCustomerByName) {
      await transaction.rollback();
      return res.status(400).json({ 
        success: false,
        error: 'A customer with this name already exists in your company' 
      });
    }

    // Auto-generate customer_id using AutoCode system
    // Format: CUST-XXXX (e.g., CUST-0001, CUST-0002) - Sequential, no date reset
    const customer_id = await autoCodeService.generateNextCode(
      'customers',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'CUST',
        fallbackFormat: '{PREFIX}-{NUMBER}'
      }
    );

    // Check if customer_id already exists in this company (safety check)
    const existingCustomerByCode = await Customer.findOne({
      where: {
        customer_id: customer_id,
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingCustomerByCode) {
      await transaction.rollback();
      return res.status(400).json({ 
        success: false,
        error: 'A customer with this code already exists in your company. Please try again.' 
      });
    }

    const created = await Customer.create({
      companyId: req.user.companyId,
      customer_id,
      customer_group_id,
      full_name,
      address: sanitized.address,
      default_receivable_account_id: sanitized.default_receivable_account_id,
      fax: sanitized.fax,
      loyalty_card_number: sanitized.loyalty_card_number,
      loyalty_card_config_id: sanitized.loyalty_card_config_id,
      birthday: sanitized.birthday,
      phone_number: sanitized.phone_number,
      email: sanitized.email,
      website: sanitized.website,
      is_active,
      created_by: req.user.id
    }, { transaction });

    const withIncludes = await Customer.findOne({
      where: buildCompanyWhere(req, { id: created.id }),
      include: [
        { model: CustomerGroup, as: 'group', attributes: ['id', 'group_name'] },
        { model: Account, as: 'defaultReceivableAccount', attributes: ['id', 'code', 'name'] },
        { model: LoyaltyCardConfig, as: 'loyaltyCardConfig', attributes: ['id', 'loyalty_card_name'] },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'] }
      ],
      transaction
    });

    // Award welcome bonus if customer has loyalty card assigned
    if (sanitized.loyalty_card_number && sanitized.loyalty_card_config_id) {
      try {
        const { awardWelcomeBonus } = require('../utils/loyaltyBonusHelper');
        const loyaltyConfig = await LoyaltyCardConfig.findOne({
          where: buildCompanyWhere(req, { id: sanitized.loyalty_card_config_id }),
          transaction
        });

        if (loyaltyConfig) {
          await awardWelcomeBonus(withIncludes, loyaltyConfig, {
            transaction,
            user: req.user,
            companyId: req.user.companyId,
            reference: `CUSTOMER_CREATION-${customer_id}`,
            transactionDate: new Date()
          });
        }
      } catch (bonusError) {
        // Log error but don't fail customer creation
        // Continue with customer creation even if bonus fails
      }
    }

    // Commit transaction
    await transaction.commit();

    return res.status(201).json({ success: true, data: withIncludes });
  } catch (error) {
    // Rollback transaction on error
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors?.map(err => ({
        field: err.path,
        message: err.message
      })) || [];
      return res.status(400).json({ 
        success: false,
        error: 'Validation error',
        errors: validationErrors,
        message: error.message
      });
    }
    
    // Handle unique constraint errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      const constraint = error.fields || {};
      const constraintName = error.parent?.constraint || '';
      
      // Check if it's a customer_id constraint violation
      if (constraint.customer_id || constraintName.includes('customer_id')) {
        return res.status(400).json({ 
          success: false,
          error: 'Duplicate customer code',
          message: 'A customer with this code already exists in your company. Please try again.'
        });
      }
      
      // Check if it's a full_name constraint violation (if such constraint exists)
      if (constraint.full_name || constraintName.includes('full_name')) {
        return res.status(400).json({ 
          success: false,
          error: 'Duplicate customer name',
          message: `A customer with the name "${req.body.full_name}" already exists in your company. Please choose a different name.`
        });
      }
      
      return res.status(400).json({ 
        success: false,
        error: 'Duplicate entry',
        message: error.message || 'A record with this information already exists',
        constraint
      });
    }
    
    return res.status(500).json({ success: false, error: error?.message || 'Failed to create customer' });
  }
});

// Update
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const customer = await Customer.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const normalize = (v) => (v === '' || v === undefined ? null : v);
    const payload = {
      ...req.body,
      address: normalize(req.body.address),
      default_receivable_account_id: normalize(req.body.default_receivable_account_id),
      fax: normalize(req.body.fax),
      loyalty_card_number: normalize(req.body.loyalty_card_number),
      loyalty_card_config_id: normalize(req.body.loyalty_card_config_id),
      birthday: normalize(req.body.birthday),
      phone_number: normalize(req.body.phone_number),
      email: normalize(req.body.email),
      website: normalize(req.body.website),
      updated_by: req.user.id
    };

    // Validate customer_group_id belongs to the same company (if being updated)
    if (payload.customer_group_id && payload.customer_group_id !== customer.customer_group_id) {
      const customerGroup = await CustomerGroup.findOne({
        where: buildCompanyWhere(req, { id: payload.customer_group_id })
      });
      if (!customerGroup) {
        return res.status(400).json({ 
          success: false,
          error: 'Customer group not found or does not belong to your company' 
        });
      }
    }

    // Validate default_receivable_account_id belongs to the same company (if being updated)
    if (payload.default_receivable_account_id && payload.default_receivable_account_id !== customer.default_receivable_account_id) {
      const receivableAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: payload.default_receivable_account_id })
      });
      if (!receivableAccount) {
        return res.status(400).json({ 
          success: false,
          error: 'Account receivable not found or does not belong to your company' 
        });
      }
    }

    // Validate loyalty_card_config_id belongs to the same company (if being updated)
    if (payload.loyalty_card_config_id && payload.loyalty_card_config_id !== customer.loyalty_card_config_id) {
      const loyaltyConfig = await LoyaltyCardConfig.findOne({
        where: buildCompanyWhere(req, { id: payload.loyalty_card_config_id })
      });
      if (!loyaltyConfig) {
        return res.status(400).json({ 
          success: false,
          error: 'Loyalty card configuration not found or does not belong to your company' 
        });
      }
    }

    // Check if full_name is being changed and validate uniqueness
    if (payload.full_name && payload.full_name.trim() !== customer.full_name) {
      const trimmedName = payload.full_name.trim();
      const existingCustomer = await Customer.findOne({
        where: buildCompanyWhere(req, { 
          full_name: trimmedName,
          id: { [Op.ne]: req.params.id }
        })
      });
      
      if (existingCustomer) {
        return res.status(400).json({ 
          success: false,
          error: 'A customer with this name already exists in your company' 
        });
      }
    }

    await customer.update(payload);

    const withIncludes = await Customer.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: CustomerGroup, as: 'group', attributes: ['id', 'group_name'] },
        { model: Account, as: 'defaultReceivableAccount', attributes: ['id', 'code', 'name'] },
        { model: LoyaltyCardConfig, as: 'loyaltyCardConfig', attributes: ['id', 'loyalty_card_name'] },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'] }
      ]
    });

    return res.json({ success: true, data: withIncludes });
  } catch (error) {
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors?.map(err => ({
        field: err.path,
        message: err.message
      })) || [];
      return res.status(400).json({ 
        success: false,
        error: 'Validation error',
        errors: validationErrors,
        message: error.message
      });
    }
    
    // Handle unique constraint errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      const constraint = error.fields || {};
      const constraintName = error.parent?.constraint || '';
      
      // Check if it's a customer_id constraint violation
      if (constraint.customer_id || constraintName.includes('customer_id')) {
        return res.status(400).json({ 
          success: false,
          error: 'Duplicate customer code',
          message: 'A customer with this code already exists in your company. Please try again.'
        });
      }
      
      // Check if it's a full_name constraint violation (if such constraint exists)
      if (constraint.full_name || constraintName.includes('full_name')) {
        return res.status(400).json({ 
          success: false,
          error: 'Duplicate customer name',
          message: `A customer with the name "${req.body.full_name}" already exists in your company. Please choose a different name.`
        });
      }
      
      return res.status(400).json({ 
        success: false,
        error: 'Duplicate entry',
        message: error.message || 'A record with this information already exists',
        constraint
      });
    }
    
    return res.status(500).json({ success: false, error: error?.message || 'Failed to update customer' });
  }
});

// Delete
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const deleted = await Customer.destroy({ 
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!deleted) return res.status(404).json({ success: false, error: 'Customer not found' });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to delete customer' });
  }
});

module.exports = router;
// Stats endpoint
router.get('/stats', async (req, res) => {
  try {
    const total = await Customer.count({
      where: buildCompanyWhere(req)
    });
    const active = await Customer.count({ 
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactive = await Customer.count({ 
      where: buildCompanyWhere(req, { is_active: false })
    });
    const lastUpdateItem = await Customer.findOne({ 
      where: buildCompanyWhere(req),
      order: [['updated_at', 'DESC']]
    });
    res.json({ success: true, data: { total, active, inactive, lastUpdate: lastUpdateItem?.updated_at || null } });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const customers = await Customer.findAll({
      where: buildCompanyWhere(req),
      include: [
        { model: CustomerGroup, as: 'group', attributes: ['group_name'] },
        { model: Account, as: 'defaultReceivableAccount', attributes: ['code', 'name'] },
        { model: LoyaltyCardConfig, as: 'loyaltyCardConfig', attributes: ['loyalty_card_name'] }
      ]
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Customers');
    sheet.columns = [
      { header: 'Customer ID', key: 'customer_id', width: 20 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Group', key: 'group_name', width: 20 },
      { header: 'Receivable', key: 'receivable', width: 30 },
      { header: 'Phone', key: 'phone_number', width: 20 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Account Balance', key: 'account_balance', width: 15 },
      { header: 'Debt Balance', key: 'debt_balance', width: 15 },
      { header: 'Deposit Balance', key: 'deposit_balance', width: 15 },
      { header: 'Loyalty Points', key: 'loyalty_points', width: 15 },
      { header: 'Active', key: 'is_active', width: 10 }
    ];
    customers.forEach(c => sheet.addRow({
      customer_id: c.customer_id,
      full_name: c.full_name,
      group_name: c.group?.group_name || '',
      receivable: c.defaultReceivableAccount ? `${c.defaultReceivableAccount.code} - ${c.defaultReceivableAccount.name}` : '',
      phone_number: c.phone_number || '',
      email: c.email || '',
      account_balance: c.account_balance !== null && c.account_balance !== undefined ? parseFloat(c.account_balance) : 0,
      debt_balance: c.debt_balance !== null && c.debt_balance !== undefined ? parseFloat(c.debt_balance) : 0,
      deposit_balance: c.deposit_balance !== null && c.deposit_balance !== undefined ? parseFloat(c.deposit_balance) : 0,
      loyalty_points: c.loyalty_points !== null && c.loyalty_points !== undefined ? parseFloat(c.loyalty_points) : 0,
      is_active: c.is_active ? 'Yes' : 'No'
    }));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to export Excel' });
  }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const customers = await Customer.findAll({
      where: buildCompanyWhere(req),
      include: [
        { model: CustomerGroup, as: 'group', attributes: ['group_name'] },
        { model: Account, as: 'defaultReceivableAccount', attributes: ['code', 'name'] }
      ]
    });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.pdf');
    doc.pipe(res);
    doc.fontSize(16).text('Customers', { align: 'center' });
    doc.moveDown();
    
    // Table headers
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [80, 120, 80, 100, 80, 100, 80, 80, 80, 80, 50];
    const headers = ['ID', 'Full Name', 'Group', 'Receivable', 'Phone', 'Email', 'Acc Balance', 'Debt', 'Deposit', 'Points', 'Active'];
    
    // Draw header row
    doc.fontSize(9).font('Helvetica-Bold');
    let x = tableLeft;
    headers.forEach((header, i) => {
      doc.text(header, x, tableTop, { width: colWidths[i], align: 'left' });
      x += colWidths[i];
    });
    
    // Draw rows
    doc.fontSize(8).font('Helvetica');
    let y = tableTop + 20;
    customers.forEach(c => {
      const accountBalance = c.account_balance !== null && c.account_balance !== undefined ? parseFloat(c.account_balance).toFixed(2) : '0.00';
      const debtBalance = c.debt_balance !== null && c.debt_balance !== undefined ? parseFloat(c.debt_balance).toFixed(2) : '0.00';
      const depositBalance = c.deposit_balance !== null && c.deposit_balance !== undefined ? parseFloat(c.deposit_balance).toFixed(2) : '0.00';
      const loyaltyPoints = c.loyalty_points !== null && c.loyalty_points !== undefined ? parseFloat(c.loyalty_points).toFixed(2) : '0.00';
      
      x = tableLeft;
      const rowData = [
        c.customer_id || '',
        c.full_name || '',
        c.group?.group_name || '',
        c.defaultReceivableAccount ? `${c.defaultReceivableAccount.code} - ${c.defaultReceivableAccount.name}` : '',
        c.phone_number || '',
        c.email || '',
        accountBalance,
        debtBalance,
        depositBalance,
        loyaltyPoints,
        c.is_active ? 'Yes' : 'No'
      ];
      
      rowData.forEach((data, i) => {
        doc.text(String(data), x, y, { width: colWidths[i], align: 'left' });
        x += colWidths[i];
      });
      
      y += 15;
      
      // Add new page if needed
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
    });
    doc.end();
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to export PDF' });
  }
});


