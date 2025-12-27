const express = require('express');
const router = express.Router();
const { PaymentMethod, User } = require('../models');
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

// Get payment method statistics
router.get('/stats', async (req, res) => {
  try {
    const totalPaymentMethods = await PaymentMethod.count({
      where: buildCompanyWhere(req)
    });
    const activePaymentMethods = await PaymentMethod.count({
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactivePaymentMethods = await PaymentMethod.count({
      where: buildCompanyWhere(req, { is_active: false })
    });

    // Get the most recent update time
    const lastUpdated = await PaymentMethod.findOne({
      where: buildCompanyWhere(req),
      order: [['updated_at', 'DESC']],
      attributes: ['updated_at']
    });

    const stats = {
      totalPaymentMethods,
      activePaymentMethods,
      inactivePaymentMethods,
      lastUpdate: lastUpdated ? lastUpdated.updated_at : null
    };

    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment method statistics' });
  }
});

// Get all payment methods
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', sortBy = 'code', sortOrder = 'asc' } = req.query;
    
    const offset = (page - 1) * limit;
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: paymentMethods } = await PaymentMethod.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ],
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      paymentMethods,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// Get a single payment method by ID
router.get('/:id', async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ]
    });
    if (!method) return res.status(404).json({ error: 'Not found' });
    res.json(method);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment method' });
  }
});

// Helper: Validate Payment Method fields
function validatePaymentMethod(body) {
  const errors = [];
  // Code is now auto-generated, so remove code validation
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('Name is required.');
  }
  ['deductsFromCustomerAccount', 'requiresBankDetails', 'uploadDocument'].forEach(field => {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') {
      errors.push(`${field} must be a boolean.`);
    }
  });
  return errors;
}

// Create a new payment method
router.post('/', csrfProtection, async (req, res) => {
  // Start transaction for atomic code generation and payment method creation
  const transaction = await sequelize.transaction();
  
  const errors = validatePaymentMethod(req.body);
  if (errors.length) {
    await transaction.rollback();
    return res.status(400).json({ errors });
  }
  
  try {
    // Check if payment method name already exists in this company
    // Always check within company, even for super-admins
    if (!req.user.companyId) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Company ID is required to create a payment method' 
      });
    }

    const existingPaymentMethod = await PaymentMethod.findOne({
      where: {
        name: req.body.name.trim(),
        companyId: req.user.companyId
      },
      transaction
    });

    if (existingPaymentMethod) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'A payment method with this name already exists in your company' 
      });
    }

    // Auto-generate payment method code
    const code = await autoCodeService.generateNextCode(
      'payment_methods',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'PMT',
        fallbackFormat: '{PREFIX}-{NUMBER}'
      }
    );

    const method = await PaymentMethod.create({
      ...req.body,
      code, // Use auto-generated code
      createdBy: req.user.id,
      updatedBy: req.user.id,
      companyId: req.user.companyId
    }, { transaction });
    
    // Commit transaction
    await transaction.commit();
    
    const created = await PaymentMethod.findByPk(method.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ]
    });
    res.status(201).json(created);
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    res.status(400).json({ error: err.message });
  }
});

// Update a payment method
router.put('/:id', csrfProtection, async (req, res) => {
  const errors = validatePaymentMethod(req.body);
  if (errors.length) return res.status(400).json({ errors });
  try {
    const method = await PaymentMethod.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!method) return res.status(404).json({ error: 'Not found' });
    
    // Prevent code updates - codes are auto-generated
    if (req.body.code && req.body.code !== method.code) {
      return res.status(400).json({ error: 'Code cannot be changed. Codes are auto-generated.' });
    }
    
    await method.update({
      ...req.body,
      code: method.code, // Preserve original code
      updatedBy: req.user.id
    });
    const updated = await PaymentMethod.findByPk(method.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ]
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a payment method
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!method) return res.status(404).json({ error: 'Not found' });
    await method.destroy();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
});

// Toggle payment method status
router.put('/:id/toggle-status', csrfProtection, async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!method) return res.status(404).json({ error: 'Not found' });
    
    await method.update({
      is_active: !method.is_active,
      updatedBy: req.user.id
    });
    
    const updated = await PaymentMethod.findByPk(method.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ]
    });
    
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle payment method status' });
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

    const paymentMethods = await PaymentMethod.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
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
    const worksheet = workbook.addWorksheet('Payment Methods');

    // Add headers
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Deducts From Customer Account', key: 'deductsFromCustomerAccount', width: 25 },
      { header: 'Requires Bank Details', key: 'requiresBankDetails', width: 20 },
      { header: 'Requires Document Upload', key: 'uploadDocument', width: 20 },
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
    paymentMethods.forEach(paymentMethod => {
      worksheet.addRow({
        code: paymentMethod.code,
        name: paymentMethod.name,
        deductsFromCustomerAccount: paymentMethod.deductsFromCustomerAccount ? 'Yes' : 'No',
        requiresBankDetails: paymentMethod.requiresBankDetails ? 'Yes' : 'No',
        uploadDocument: paymentMethod.uploadDocument ? 'Yes' : 'No',
        status: paymentMethod.is_active ? 'Active' : 'Inactive',
        createdBy: paymentMethod.creator ? paymentMethod.creator.username : 'N/A',
        updatedBy: paymentMethod.updater ? paymentMethod.updater.username : 'N/A',
        createdAt: paymentMethod.created_at ? new Date(paymentMethod.created_at).toLocaleString() : 'N/A',
        updatedAt: paymentMethod.updated_at ? new Date(paymentMethod.updated_at).toLocaleString() : 'N/A'
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=payment-methods-${new Date().toISOString().split('T')[0]}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).json({ error: 'Failed to export payment methods to Excel' });
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

    const paymentMethods = await PaymentMethod.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
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
    res.setHeader('Content-Disposition', `attachment; filename=payment-methods-${new Date().toISOString().split('T')[0]}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    // Add title
    doc.fontSize(20).text('Payment Methods Report', { align: 'center' });
    doc.moveDown();

    // Add generation date
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Add table headers
    const tableTop = 150;
    const tableLeft = 50;
    const colWidths = [80, 120, 100, 80, 80, 60, 80, 80, 80, 80];
    const headers = ['Code', 'Name', 'Deducts From Account', 'Bank Details', 'Document Upload', 'Status', 'Created By', 'Updated By', 'Created At', 'Updated At'];

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
    
    paymentMethods.forEach((paymentMethod, rowIndex) => {
      if (currentY > 750) { // Start new page if needed
        doc.addPage();
        currentY = 50;
      }

      const rowData = [
        paymentMethod.code,
        paymentMethod.name,
        paymentMethod.deductsFromCustomerAccount ? 'Yes' : 'No',
        paymentMethod.requiresBankDetails ? 'Yes' : 'No',
        paymentMethod.uploadDocument ? 'Yes' : 'No',
        paymentMethod.is_active ? 'Active' : 'Inactive',
        paymentMethod.creator ? paymentMethod.creator.username : 'N/A',
        paymentMethod.updater ? paymentMethod.updater.username : 'N/A',
        paymentMethod.created_at ? new Date(paymentMethod.created_at).toLocaleDateString() : 'N/A',
        paymentMethod.updated_at ? new Date(paymentMethod.updated_at).toLocaleDateString() : 'N/A'
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
    res.status(500).json({ error: 'Failed to export payment methods to PDF' });
  }
});

module.exports = router; 