const express = require('express');
const router = express.Router();
const { PaymentType, PaymentMethod, Account, User } = require('../models');
const { Op } = require('sequelize');
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

// Get payment type statistics
router.get('/stats', async (req, res) => {
  try {
    const totalPaymentTypes = await PaymentType.count({
      where: buildCompanyWhere(req)
    });
    const activePaymentTypes = await PaymentType.count({
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactivePaymentTypes = await PaymentType.count({
      where: buildCompanyWhere(req, { is_active: false })
    });

    // Get the most recent update time
    const lastUpdated = await PaymentType.findOne({
      where: buildCompanyWhere(req),
      order: [['updated_at', 'DESC']],
      attributes: ['updated_at']
    });

    const stats = {
      totalPaymentTypes,
      activePaymentTypes,
      inactivePaymentTypes,
      lastUpdate: lastUpdated ? lastUpdated.updated_at : null
    };

    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment type statistics' });
  }
});

// Get all payment types with related data
router.get('/', async (req, res) => {
  try {

    const { page = 1, limit = 25, search = '', sortBy = 'code', sortOrder = 'asc', status, used_in_customer_deposits, used_in_debtor_payments } = req.query;
    
    const offset = (page - 1) * limit;
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add status filtering
    if (status && status !== 'all') {
      if (status === 'active') {
        whereClause.is_active = true;
      } else if (status === 'inactive') {
        whereClause.is_active = false;
      }
    }

    // Add used_in_customer_deposits filtering
    if (used_in_customer_deposits !== undefined) {
      whereClause.used_in_customer_deposits = used_in_customer_deposits === 'true' || used_in_customer_deposits === true;
    }

    // Add used_in_debtor_payments filtering
    if (used_in_debtor_payments !== undefined) {
      // Query params are strings, so check for 'true' string
      whereClause.used_in_debtor_payments = used_in_debtor_payments === 'true' || used_in_debtor_payments === true;
    }

    const { count, rows: paymentTypes } = await PaymentType.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: PaymentMethod,
          as: 'paymentMethod',
          attributes: ['id', 'code', 'name', 'requiresBankDetails', 'uploadDocument']
        },
        {
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'name', 'code']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'first_name', 'last_name']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'username', 'first_name', 'last_name']
        }
      ],
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform the data to match frontend expectations
    const transformedPaymentTypes = paymentTypes.map(paymentType => {
      const data = paymentType.get({ plain: true });
      return {
        ...data,
        // Map camelCase to snake_case for related objects
        payment_method: data.paymentMethod,
        default_account: data.defaultAccount,
        // Map user objects to name strings
        created_by_name: data.creator ? `${data.creator.first_name} ${data.creator.last_name}` : null,
        updated_by_name: data.updater ? `${data.updater.first_name} ${data.updater.last_name}` : null,
        // Ensure timestamp fields are preserved
        created_at: data.created_at || data.createdAt,
        updated_at: data.updated_at || data.updatedAt,
        // Keep camelCase properties for frontend compatibility
        paymentMethod: data.paymentMethod,
        defaultAccount: data.defaultAccount,
        // Remove the original camelCase properties
        creator: undefined,
        updater: undefined,
        createdAt: undefined,
        updatedAt: undefined
      };
    });

    res.json({
      paymentTypes: transformedPaymentTypes,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    if (err && err.stack) {
      }
    res.status(500).json({ error: 'Failed to fetch payment types', details: err.message });
  }
});

// Get a single payment type by ID
router.get('/:id', async (req, res) => {
  try {
    const paymentType = await PaymentType.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        {
          model: PaymentMethod,
          as: 'paymentMethod',
          attributes: ['id', 'code', 'name', 'requiresBankDetails', 'uploadDocument']
        },
        {
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'name', 'code']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'first_name', 'last_name']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'username', 'first_name', 'last_name']
        }
      ]
    });
    
    if (!paymentType) {
      return res.status(404).json({ error: 'Payment type not found' });
    }
    
    // Transform the data to match frontend expectations
    const data = paymentType.get({ plain: true });
    const transformedPaymentType = {
      ...data,
      // Map camelCase to snake_case for related objects
      payment_method: data.paymentMethod,
      default_account: data.defaultAccount,
      // Map user objects to name strings
      created_by_name: data.creator ? `${data.creator.first_name} ${data.creator.last_name}` : null,
      updated_by_name: data.updater ? `${data.updater.first_name} ${data.updater.last_name}` : null,
      // Ensure timestamp fields are preserved
      created_at: data.created_at || data.createdAt,
      updated_at: data.updated_at || data.updatedAt,
      // Remove the original camelCase properties
      paymentMethod: undefined,
      defaultAccount: undefined,
      creator: undefined,
      updater: undefined,
      createdAt: undefined,
      updatedAt: undefined
    };
    
    res.json(transformedPaymentType);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment type' });
  }
});

// Helper: Validate Payment Type fields
function validatePaymentType(body) {
  const errors = [];
  
  // Code is now auto-generated, so remove code validation
  
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('Name is required and must be a string.');
  }
  
  if (!body.payment_method_id || typeof body.payment_method_id !== 'string') {
    errors.push('Payment method is required.');
  }
  
  if (body.order_of_display !== undefined && (isNaN(body.order_of_display) || body.order_of_display < 1)) {
    errors.push('Order of display must be a positive number.');
  }
  
  // Validate and convert boolean fields - convert string booleans to actual booleans
  // Allow undefined values (will use defaults from model)
  const booleanFields = [
    'used_in_sales', 'used_in_debtor_payments', 'used_in_credit_payments',
    'used_in_customer_deposits', 'used_in_refunds', 'display_in_cashier_report',
    'used_in_banking', 'is_active'
  ];
  
  booleanFields.forEach(field => {
    if (body[field] !== undefined && body[field] !== null) {
      // Convert string booleans to actual booleans
      if (typeof body[field] === 'string') {
        const lowerValue = body[field].toLowerCase().trim();
        if (lowerValue === 'true' || lowerValue === '1') {
          body[field] = true;
        } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === '') {
          body[field] = false;
        } else {
          errors.push(`${field} must be a boolean value (true/false).`);
        }
      } else if (typeof body[field] !== 'boolean') {
        // Allow numbers (0 = false, 1 = true)
        if (typeof body[field] === 'number') {
          body[field] = body[field] !== 0;
        } else {
          errors.push(`${field} must be a boolean value (true/false).`);
        }
      }
    }
    // If undefined or null, leave it - defaults will be applied in paymentTypeData
  });
  
  return errors;
}

// Create a new payment type
router.post('/', csrfProtection, async (req, res) => {
  // Start transaction for atomic code generation and payment type creation
  const transaction = await sequelize.transaction();
  
  try {
    const errors = validatePaymentType(req.body);
    if (errors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({ errors });
    }

    // Check if payment type name already exists in this company
    // Always check within company, even for super-admins
    if (!req.user.companyId) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Company ID is required to create a payment type' 
      });
    }

    const existingPaymentType = await PaymentType.findOne({
      where: {
        name: req.body.name.trim(),
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingPaymentType) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'A payment type with this name already exists in your company' 
      });
    }

    // Retry logic for code generation (handles race conditions)
    let paymentType = null;
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      // Start a new transaction for each retry attempt
      const retryTransaction = retryCount === 0 ? transaction : await sequelize.transaction();
      
      try {
        // Auto-generate payment type code
        const code = await autoCodeService.generateNextCode(
          'payment_types',
          req.user.companyId,
          {
            transaction: retryTransaction,
            fallbackPrefix: 'PTY',
            fallbackFormat: '{PREFIX}-{NUMBER}'
          }
        );

        // Verify payment method exists
        const paymentMethod = await PaymentMethod.findByPk(req.body.payment_method_id, { transaction: retryTransaction });
        if (!paymentMethod) {
          await retryTransaction.rollback();
          if (retryCount > 0) {
            await transaction.rollback();
          }
          return res.status(400).json({ error: 'Payment method not found' });
        }

        // Verify default account exists if provided
        if (req.body.default_account_id) {
          const account = await Account.findByPk(req.body.default_account_id, { transaction: retryTransaction });
          if (!account) {
            await retryTransaction.rollback();
            if (retryCount > 0) {
              await transaction.rollback();
            }
            return res.status(400).json({ error: 'Default account not found' });
          }
        }

        // Ensure boolean fields have default values
        const paymentTypeData = {
          ...req.body,
          code, // Use auto-generated code
          created_by: req.user.id,
          updated_by: req.user.id,
          companyId: req.user.companyId,
          // Set default values for boolean fields if not provided
          used_in_sales: req.body.used_in_sales !== undefined ? req.body.used_in_sales : false,
          used_in_debtor_payments: req.body.used_in_debtor_payments !== undefined ? req.body.used_in_debtor_payments : false,
          used_in_credit_payments: req.body.used_in_credit_payments !== undefined ? req.body.used_in_credit_payments : false,
          used_in_customer_deposits: req.body.used_in_customer_deposits !== undefined ? req.body.used_in_customer_deposits : false,
          used_in_refunds: req.body.used_in_refunds !== undefined ? req.body.used_in_refunds : false,
          display_in_cashier_report: req.body.display_in_cashier_report !== undefined ? req.body.display_in_cashier_report : false,
          used_in_banking: req.body.used_in_banking !== undefined ? req.body.used_in_banking : false,
          is_active: req.body.is_active !== undefined ? req.body.is_active : true,
          order_of_display: req.body.order_of_display !== undefined ? req.body.order_of_display : 1
        };

        paymentType = await PaymentType.create(paymentTypeData, { transaction: retryTransaction });
        
        // Commit the retry transaction
        await retryTransaction.commit();
        
        // Break out of retry loop on success
        break;
      } catch (createError) {
        // Rollback transaction on error
        await retryTransaction.rollback();
        
        // If it's a unique constraint error on code, retry with a new code
        if (createError.name === 'SequelizeUniqueConstraintError' && 
            (createError.errors?.some(e => e.path === 'code') || createError.fields?.code)) {
          retryCount++;
          if (retryCount >= maxRetries) {
            await transaction.rollback();
            throw new Error('Failed to generate unique payment type code after multiple attempts. Please try again.');
          }
          // Wait a small random amount before retrying (helps avoid collisions)
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
          continue; // Retry with new code (new transaction will be created)
        }
        
        // For other errors, rollback original transaction if needed and throw
        if (retryCount > 0) {
          await transaction.rollback();
        }
        throw createError;
      }
    }

    if (!paymentType) {
      // Rollback original transaction if it wasn't used (retryCount > 0)
      if (!transaction.finished && retryCount > 0) {
        await transaction.rollback();
      }
      throw new Error('Failed to create payment type after multiple retry attempts');
    }
    
    // If we retried (retryCount > 0), the original transaction wasn't used, so roll it back
    // If retryCount === 0, the original transaction was already committed in the loop
    if (!transaction.finished && retryCount > 0) {
      await transaction.rollback();
    }
    
    // Fetch the created payment type with associations
    const createdPaymentType = await PaymentType.findByPk(paymentType.id, {
      include: [
        {
          model: PaymentMethod,
          as: 'paymentMethod',
          attributes: ['id', 'code', 'name', 'requiresBankDetails', 'uploadDocument']
        },
        {
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'name', 'code']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'first_name', 'last_name']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'username', 'first_name', 'last_name']
        }
      ]
    });

    // Transform the data to match frontend expectations
    const data = createdPaymentType.get({ plain: true });
    const transformedPaymentType = {
      ...data,
      // Map camelCase to snake_case for related objects
      payment_method: data.paymentMethod,
      default_account: data.defaultAccount,
      // Map user objects to name strings
      created_by_name: data.creator ? `${data.creator.first_name} ${data.creator.last_name}` : null,
      updated_by_name: data.updater ? `${data.updater.first_name} ${data.updater.last_name}` : null,
      // Ensure timestamp fields are preserved
      created_at: data.created_at || data.createdAt,
      updated_at: data.updated_at || data.updatedAt,
      // Remove the original camelCase properties
      paymentMethod: undefined,
      defaultAccount: undefined,
      creator: undefined,
      updater: undefined,
      createdAt: undefined,
      updatedAt: undefined
    };

    res.status(201).json(transformedPaymentType);
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    console.error('Error creating payment type:', err);
    res.status(400).json({ 
      error: err.message || 'Failed to create payment type',
      details: err.errors || err.details || null
    });
  }
});

// Update a payment type
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const errors = validatePaymentType(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const paymentType = await PaymentType.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!paymentType) {
      return res.status(404).json({ error: 'Payment type not found' });
    }

    // Check if code already exists (excluding current record)
    if (req.body.code && req.body.code !== paymentType.code) {
      // Code updates are not allowed - codes are auto-generated
      return res.status(400).json({ error: 'Code cannot be changed. Codes are auto-generated.' });
    }

    // Verify payment method exists if being updated
    if (req.body.payment_method_id) {
      const paymentMethod = await PaymentMethod.findByPk(req.body.payment_method_id);
      if (!paymentMethod) {
        return res.status(400).json({ error: 'Payment method not found' });
      }
    }

    // Verify default account exists if provided
    if (req.body.default_account_id) {
      const account = await Account.findByPk(req.body.default_account_id);
      if (!account) {
        return res.status(400).json({ error: 'Default account not found' });
      }
    }

    const updateData = {
      ...req.body,
      updated_by: req.user.id
    };

    await paymentType.update(updateData);
    
    // Fetch the updated payment type with associations
    const updatedPaymentType = await PaymentType.findByPk(req.params.id, {
      include: [
        {
          model: PaymentMethod,
          as: 'paymentMethod',
          attributes: ['id', 'code', 'name', 'requiresBankDetails', 'uploadDocument']
        },
        {
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'name', 'code']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'first_name', 'last_name']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'username', 'first_name', 'last_name']
        }
      ]
    });

    // Transform the data to match frontend expectations
    const data = updatedPaymentType.get({ plain: true });
    const transformedPaymentType = {
      ...data,
      // Map camelCase to snake_case for related objects
      payment_method: data.paymentMethod,
      default_account: data.defaultAccount,
      // Map user objects to name strings
      created_by_name: data.creator ? `${data.creator.first_name} ${data.creator.last_name}` : null,
      updated_by_name: data.updater ? `${data.updater.first_name} ${data.updater.last_name}` : null,
      // Ensure timestamp fields are preserved
      created_at: data.created_at || data.createdAt,
      updated_at: data.updated_at || data.updatedAt,
      // Remove the original camelCase properties
      paymentMethod: undefined,
      defaultAccount: undefined,
      creator: undefined,
      updater: undefined,
      createdAt: undefined,
      updatedAt: undefined
    };

    res.json(transformedPaymentType);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a payment type
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const paymentType = await PaymentType.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!paymentType) {
      return res.status(404).json({ error: 'Payment type not found' });
    }

    await paymentType.destroy();
    res.json({ message: 'Payment type deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete payment type' });
  }
});

// Get payment methods for dropdown
router.get('/payment-methods/list', async (req, res) => {
  try {
    const paymentMethods = await PaymentMethod.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code', 'name'],
      order: [['name', 'ASC']]
    });
    res.json(paymentMethods);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// Get accounts for dropdown
router.get('/accounts/list', async (req, res) => {
  try {
    const accounts = await Account.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code', 'name'],
      order: [['name', 'ASC']]
    });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;
    
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add status filter
    if (status !== 'all') {
      whereClause.is_active = status === 'active';
    }

    const paymentTypes = await PaymentType.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: PaymentMethod,
          as: 'paymentMethod',
          attributes: ['id', 'code', 'name', 'requiresBankDetails', 'uploadDocument']
        },
        {
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'name', 'code']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'username', 'email']
        }
      ],
      order: [['code', 'ASC']]
    });

    // Import ExcelJS dynamically
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payment Types');

    // Add headers
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Payment Method', key: 'paymentMethod', width: 25 },
      { header: 'Display Order', key: 'orderOfDisplay', width: 15 },
      { header: 'Default Account', key: 'defaultAccount', width: 25 },
      { header: 'Used in Sales', key: 'usedInSales', width: 15 },
      { header: 'Used in Debtor Payments', key: 'usedInDebtorPayments', width: 20 },
      { header: 'Used in Credit Payments', key: 'usedInCreditPayments', width: 20 },
      { header: 'Used in Customer Deposits', key: 'usedInCustomerDeposits', width: 20 },
      { header: 'Used in Refunds', key: 'usedInRefunds', width: 15 },
      { header: 'Display in Cashier Report', key: 'displayInCashierReport', width: 20 },
      { header: 'Used in Banking', key: 'usedInBanking', width: 15 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Updated At', key: 'updatedAt', width: 20 }
    ];

    // Style headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    // Add data rows
    paymentTypes.forEach(paymentType => {
      worksheet.addRow({
        code: paymentType.code,
        name: paymentType.name,
        paymentMethod: paymentType.paymentMethod ? paymentType.paymentMethod.name : 'N/A',
        orderOfDisplay: paymentType.order_of_display,
        defaultAccount: paymentType.defaultAccount ? `${paymentType.defaultAccount.code} - ${paymentType.defaultAccount.name}` : 'N/A',
        usedInSales: paymentType.used_in_sales ? 'Yes' : 'No',
        usedInDebtorPayments: paymentType.used_in_debtor_payments ? 'Yes' : 'No',
        usedInCreditPayments: paymentType.used_in_credit_payments ? 'Yes' : 'No',
        usedInCustomerDeposits: paymentType.used_in_customer_deposits ? 'Yes' : 'No',
        usedInRefunds: paymentType.used_in_refunds ? 'Yes' : 'No',
        displayInCashierReport: paymentType.display_in_cashier_report ? 'Yes' : 'No',
        usedInBanking: paymentType.used_in_banking ? 'Yes' : 'No',
        status: paymentType.is_active ? 'Active' : 'Inactive',
        createdBy: paymentType.creator ? paymentType.creator.username : 'N/A',
        updatedBy: paymentType.updater ? paymentType.updater.username : 'N/A',
        createdAt: paymentType.created_at ? new Date(paymentType.created_at).toLocaleString() : 'N/A',
        updatedAt: paymentType.updated_at ? new Date(paymentType.updated_at).toLocaleString() : 'N/A'
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=payment-types-${new Date().toISOString().split('T')[0]}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).json({ error: 'Failed to export payment types to Excel' });
  }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;
    
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add status filter
    if (status !== 'all') {
      whereClause.is_active = status === 'active';
    }

    const paymentTypes = await PaymentType.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: PaymentMethod,
          as: 'paymentMethod',
          attributes: ['id', 'code', 'name', 'requiresBankDetails', 'uploadDocument']
        },
        {
          model: Account,
          as: 'defaultAccount',
          attributes: ['id', 'name', 'code']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'username', 'email']
        }
      ],
      order: [['code', 'ASC']]
    });

    // Import PDFKit dynamically
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payment-types-${new Date().toISOString().split('T')[0]}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    // Add title
    doc.fontSize(20).text('Payment Types Report', { align: 'center' });
    doc.moveDown();

    // Add generation date
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Add table headers
    const tableTop = 150;
    const tableLeft = 50;
    const colWidths = [80, 120, 100, 60, 100, 60, 60, 60, 60, 60, 60, 60, 60];
    const headers = ['Code', 'Name', 'Payment Method', 'Order', 'Default Account', 'Sales', 'Debtor', 'Credit', 'Deposits', 'Refunds', 'Cashier', 'Banking', 'Status'];

    // Draw table headers
    doc.fontSize(10).font('Helvetica-Bold');
    let currentX = tableLeft;
    headers.forEach((header, index) => {
      doc.text(header, currentX, tableTop, { width: colWidths[index], align: 'left' });
      currentX += colWidths[index];
    });

    // Draw table rows
    doc.font('Helvetica').fontSize(8);
    let currentY = tableTop + 20;
    
    paymentTypes.forEach((paymentType, rowIndex) => {
      if (currentY > 750) { // Start new page if needed
        doc.addPage();
        currentY = 50;
      }

      const rowData = [
        paymentType.code,
        paymentType.name,
        paymentType.paymentMethod ? paymentType.paymentMethod.name : 'N/A',
        paymentType.order_of_display.toString(),
        paymentType.defaultAccount ? paymentType.defaultAccount.code : 'N/A',
        paymentType.used_in_sales ? 'Yes' : 'No',
        paymentType.used_in_debtor_payments ? 'Yes' : 'No',
        paymentType.used_in_credit_payments ? 'Yes' : 'No',
        paymentType.used_in_customer_deposits ? 'Yes' : 'No',
        paymentType.used_in_refunds ? 'Yes' : 'No',
        paymentType.display_in_cashier_report ? 'Yes' : 'No',
        paymentType.used_in_banking ? 'Yes' : 'No',
        paymentType.is_active ? 'Active' : 'Inactive'
      ];

      currentX = tableLeft;
      rowData.forEach((data, colIndex) => {
        doc.text(data, currentX, currentY, { width: colWidths[colIndex], align: 'left' });
        currentX += colWidths[colIndex];
      });

      currentY += 15;
    });

    // Finalize PDF
    doc.end();

  } catch (err) {
    res.status(500).json({ error: 'Failed to export payment types to PDF' });
  }
});

module.exports = router; 