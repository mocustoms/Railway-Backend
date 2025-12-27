const express = require('express');
const router = express.Router();
const { BankDetail, User, Account, Company } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { generateNextCode } = require('../utils/autoCodeService');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get bank detail statistics
router.get('/stats', async (req, res) => {
  try {
    const totalBankDetails = await BankDetail.count({
      where: buildCompanyWhere(req)
    });
    const activeBankDetails = await BankDetail.count({
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactiveBankDetails = await BankDetail.count({
      where: buildCompanyWhere(req, { is_active: false })
    });

    // Get the most recent update time
    const lastUpdated = await BankDetail.findOne({
      where: buildCompanyWhere(req),
      order: [['updated_at', 'DESC']],
      attributes: ['updated_at']
    });

    const stats = {
      totalBankDetails,
      activeBankDetails,
      inactiveBankDetails,
      lastUpdate: lastUpdated ? lastUpdated.updated_at : null
    };

    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bank detail statistics' });
  }
});

// Get all bank details
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', sortBy = 'code', sortOrder = 'asc', status } = req.query;
    
    const offset = (page - 1) * limit;
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { bankName: { [Op.iLike]: `%${search}%` } },
        { branch: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } }
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

    const { count, rows: bankDetails } = await BankDetail.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] }
      ],
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      bankDetails,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bank details' });
  }
});

// Get a single bank detail by ID
router.get('/:id', async (req, res) => {
  try {
    const bankDetail = await BankDetail.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] }
      ]
    });
    if (!bankDetail) return res.status(404).json({ error: 'Not found' });
    res.json(bankDetail);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bank detail' });
  }
});

// Helper: Validate Bank Detail fields (code is now auto-generated)
function validateBankDetail(body) {
  const errors = [];

  // Code is now auto-generated, no validation needed

  if (!body.bankName || body.bankName.trim() === '') {
    errors.push('Bank name is required');
  } else if (body.bankName.length > 100) {
    errors.push('Bank name must not exceed 100 characters');
  }

  if (!body.branch || body.branch.trim() === '') {
    errors.push('Branch is required');
  } else if (body.branch.length > 100) {
    errors.push('Branch must not exceed 100 characters');
  }

  if (!body.accountNumber || body.accountNumber.trim() === '') {
    errors.push('Account number is required');
  } else if (body.accountNumber.length > 50) {
    errors.push('Account number must not exceed 50 characters');
  }

  if (!body.accountId || body.accountId.trim() === '') {
    errors.push('Account selection is required');
  }

  return errors;
}

// Create a new bank detail
router.post('/', csrfProtection, async (req, res) => {
  const transaction = await BankDetail.sequelize.transaction();
  
  try {
    const validationErrors = validateBankDetail(req.body);
    if (validationErrors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors 
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

    // Auto-generate bank detail code
    const bankDetailCode = await generateNextCode(
      'bank_details',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'BANK',
        fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
        companyCode: companyCode
      }
    );

    // Validate that code was generated
    if (!bankDetailCode || !bankDetailCode.trim()) {
      await transaction.rollback();
      return res.status(500).json({ 
        error: 'Failed to generate bank detail code. Please try again.',
        message: 'Code generation failed'
      });
    }

    const bankDetail = await BankDetail.create({
      code: bankDetailCode.toUpperCase().trim(),
      bankName: req.body.bankName.trim(),
      companyId: req.user.companyId,
      branch: req.body.branch.trim(),
      accountNumber: req.body.accountNumber.trim(),
      accountId: req.body.accountId,
      is_active: req.body.is_active !== undefined ? req.body.is_active : true,
      createdBy: req.user.id,
      updatedBy: req.user.id
    }, { transaction });

    await transaction.commit();

    // Fetch the created bank detail with associations
    const createdBankDetail = await BankDetail.findByPk(bankDetail.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] }
      ]
    });

    res.status(201).json(createdBankDetail);
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    
    // Handle Sequelize unique constraint errors
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ 
        error: 'Bank detail code already exists in your company' 
      });
    }
    
    // Handle Sequelize validation errors
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: err.errors.map(e => e.message) 
      });
    }
    
    res.status(500).json({ error: 'Failed to create bank detail', details: err.message });
  }
});

// Update a bank detail
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const bankDetail = await BankDetail.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!bankDetail) {
      return res.status(404).json({ error: 'Bank detail not found' });
    }

    const validationErrors = validateBankDetail(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors 
      });
    }

    // Code cannot be updated - it's auto-generated
    // Only update other fields
    await bankDetail.update({
      bankName: req.body.bankName.trim(),
      branch: req.body.branch.trim(),
      accountNumber: req.body.accountNumber.trim(),
      accountId: req.body.accountId,
      is_active: req.body.is_active !== undefined ? req.body.is_active : bankDetail.is_active,
      updatedBy: req.user.id
    });

    // Fetch the updated bank detail with associations
    const updatedBankDetail = await BankDetail.findByPk(bankDetail.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] }
      ]
    });

    res.json(updatedBankDetail);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update bank detail' });
  }
});

// Toggle bank detail status
router.put('/:id/toggle-status', csrfProtection, async (req, res) => {
  try {
    const bankDetail = await BankDetail.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!bankDetail) {
      return res.status(404).json({ error: 'Bank detail not found' });
    }

    await bankDetail.update({
      is_active: !bankDetail.is_active,
      updatedBy: req.user.id
    });

    // Fetch the updated bank detail with associations
    const updatedBankDetail = await BankDetail.findByPk(bankDetail.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: Account, as: 'account', attributes: ['id', 'code', 'name', 'type'] }
      ]
    });

    res.json(updatedBankDetail);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle bank detail status' });
  }
});

// Delete a bank detail
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const bankDetail = await BankDetail.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!bankDetail) {
      return res.status(404).json({ error: 'Bank detail not found' });
    }

    await bankDetail.destroy();
    res.json({ message: 'Bank detail deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete bank detail' });
  }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { bankName: { [Op.iLike]: `%${search}%` } },
        { branch: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const bankDetails = await BankDetail.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: User, as: 'creator', attributes: ['username'] },
        { model: User, as: 'updater', attributes: ['username'] },
        { model: Account, as: 'account', attributes: ['code', 'name', 'type'] }
      ],
      order: [['code', 'ASC']]
    });

    // Transform data for Excel export
    const excelData = bankDetails.map(bankDetail => ({
      'Code': bankDetail.code,
      'Bank Name': bankDetail.bankName,
      'Branch': bankDetail.branch,
      'Account Number': bankDetail.accountNumber,
      'Account Code': bankDetail.account ? bankDetail.account.code : 'N/A',
      'Account Name': bankDetail.account ? bankDetail.account.name : 'N/A',
      'Account Type': bankDetail.account ? bankDetail.account.type : 'N/A',
      'Status': bankDetail.is_active ? 'Active' : 'Inactive',
      'Created By': bankDetail.creator ? bankDetail.creator.username : 'N/A',
      'Created Date': bankDetail.createdAt ? new Date(bankDetail.createdAt).toLocaleDateString() : 'N/A',
      'Updated By': bankDetail.updater ? bankDetail.updater.username : 'N/A',
      'Updated Date': bankDetail.updatedAt ? new Date(bankDetail.updatedAt).toLocaleDateString() : 'N/A'
    }));

    // Set response headers for Excel file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=bank-details-${new Date().toISOString().split('T')[0]}.xlsx`);

    // For now, return JSON data. In production, you'd use a library like 'xlsx' to create actual Excel files
    res.json({
      message: 'Excel export functionality would be implemented here',
      data: excelData
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export bank details to Excel' });
  }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { bankName: { [Op.iLike]: `%${search}%` } },
        { branch: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const bankDetails = await BankDetail.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: User, as: 'creator', attributes: ['username'] },
        { model: User, as: 'updater', attributes: ['username'] },
        { model: Account, as: 'account', attributes: ['code', 'name', 'type'] }
      ],
      order: [['code', 'ASC']]
    });

    // Set response headers for PDF file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=bank-details-${new Date().toISOString().split('T')[0]}.pdf`);

    // For now, return JSON data. In production, you'd use a library like 'puppeteer' or 'pdfkit' to create actual PDF files
    res.json({
      message: 'PDF export functionality would be implemented here',
      data: bankDetails
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export bank details to PDF' });
  }
});

module.exports = router;
