const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const { Op } = require('sequelize');
const { PurchaseInvoice, PurchaseInvoiceItem, PurchaseInvoicePayment, Product, Vendor, Store, Currency } = require('../models');
const PurchaseInvoiceService = require('../services/purchaseInvoiceService');

const validate = (validations) => async (req, res, next) => {
  await Promise.all(validations.map(v => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId);



// Get purchase invoice statistics
router.get('/stats', async (req, res) => {
  try {
    const total = await PurchaseInvoice.count({ where: buildCompanyWhere(req) });
    const draft = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'draft' }) });
    const posted = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'posted' }) });
    const partiallyPaid = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'partially_paid' }) });
    const paid = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'paid' }) });
    const cancelled = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'cancelled' }) });

    // Sums
    const totalAmountSum = await PurchaseInvoice.sum('total_amount', { where: buildCompanyWhere(req) }) || 0;
    const balanceDueSum = await PurchaseInvoice.sum('balance_due', { where: buildCompanyWhere(req) }) || 0;

    // Overdue (due_date < today and balance_due > 0)
    const overdue = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { due_date: { [Op.lt]: new Date() }, balance_due: { [Op.gt]: 0 } }) });

    res.json({ stats: { total, draft, posted, partiallyPaid, paid, cancelled, totalAmount: totalAmountSum, balanceDue: balanceDueSum, overdue } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// List with pagination/search/sort
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'invoice_date';
    const sortOrder = req.query.sortOrder || 'DESC';

    const whereClause = {};
    if (req.query.storeId) whereClause.store_id = req.query.storeId;
    if (req.query.vendorId) whereClause.vendor_id = req.query.vendorId;
    if (req.query.status) whereClause.status = req.query.status;
    if (search) whereClause[Op.or] = [
      { invoice_number: { [Op.iLike]: `%${search}%` } },
      { reference: { [Op.iLike]: `%${search}%` } },
      { notes: { [Op.iLike]: `%${search}%` } }
    ];

    const { count, rows } = await PurchaseInvoice.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Vendor, as: 'vendor', required: false },
        { model: Store, as: 'store', required: false },
        { model: Currency, as: 'currency', required: false },
        { model: PurchaseInvoiceItem, as: 'items', required: false, include: [{ model: Product, as: 'product', required: false }] },
        { model: PurchaseInvoicePayment, as: 'payments', required: false }
      ],
      order: [[sortBy, sortOrder]],
      limit,
      offset
    });

    res.json({ data: rows, pagination: { currentPage: page, totalPages: Math.ceil(count/limit), totalItems: count, itemsPerPage: limit } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Create invoice (inline handler delegating to service)
router.post('/', csrfProtection, validate([
  body('invoiceDate').notEmpty().withMessage('invoiceDate is required'),
  body('vendorId').notEmpty().withMessage('vendorId is required'),
  body('items').isArray({ min: 1 }).withMessage('items array required'),
  body('items.*.quantity').notEmpty().withMessage('item.quantity required'),
  body('items.*.unitPrice').notEmpty().withMessage('item.unitPrice required')
]), async (req, res) => {
  try {
    if (!req.user.companyId) return res.status(400).json({ error: 'Company ID required' });
    const payload = { ...req.body, companyId: req.user.companyId };
    const created = await PurchaseInvoiceService.createInvoice(payload, req.user);
    res.status(201).json(created);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// NOTE: payment endpoint moved to its own route file `/api/purchase-invoice-payments`

// Get by ID
router.get('/:id', validate([ param('id').isUUID() ]), async (req, res) => {
  try {
    const invoice = await PurchaseInvoiceService.getById(req.params.id, req.user.companyId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Update header
router.put('/:id', csrfProtection, validate([ param('id').isUUID() ]), async (req, res) => {
  try {
    // We support limited header updates via service
    const updated = await PurchaseInvoiceService.createInvoice(req.body, req.user); // placeholder: reuse create for now or implement update
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Post/approve
router.post('/:id/post', csrfProtection, validate([ param('id').isUUID() ]), async (req, res) => {
  try {
    const result = await PurchaseInvoiceService.post(req.params.id, req.user);
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// NOTE: POST /:id/pay is handled in `server/routes/purchaseInvoicePayment.js`

// Cancel
router.delete('/:id', csrfProtection, validate([ param('id').isUUID() ]), async (req, res) => {
  try {
    const result = await PurchaseInvoiceService.cancel(req.params.id, req.user);
    res.json({ message: 'Cancelled', data: result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

module.exports = router;
