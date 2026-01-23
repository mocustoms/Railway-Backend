const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const { Op } = require('sequelize');
const { PurchaseInvoice, PurchaseInvoiceItem, PurchaseInvoicePayment, Product, Vendor, Store, Currency, sequelize } = require('../models');
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
    const sent = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'sent' }) });
    const partiallyPaid = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'partial_paid' }) });
    const paid = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'paid' }) });
    const cancelled = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { status: 'cancelled' }) });

    // Sums
    const totalAmountSum = await PurchaseInvoice.sum('total_amount', { where: buildCompanyWhere(req) }) || 0;
    const balanceDueSum = await PurchaseInvoice.sum('balance_due', { where: buildCompanyWhere(req) }) || 0;

    // Overdue (due_date < today and balance_due > 0)
    const overdue = await PurchaseInvoice.count({ where: buildCompanyWhere(req, { due_date: { [Op.lt]: new Date() }, balance_due: { [Op.gt]: 0 } }) });

    res.json({ total, draft, sent, partiallyPaid, paid, cancelled, totalAmount: totalAmountSum, balanceDue: balanceDueSum, overdue });
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
  body('invoice_date').notEmpty().withMessage('invoice_date is required'),
  body('vendor_id').notEmpty().withMessage('vendor_id is required'),
  body('items').isArray({ min: 1 }).withMessage('items array required'),
  body('items.*.quantity').notEmpty().withMessage('item.quantity required'),
  body('items.*.unit_price').notEmpty().withMessage('item.unit_price required')
]), async (req, res) => {
  try {
    if (!req.user.companyId) return res.status(400).json({ error: 'Company ID required' });
    const payload = { ...req.body, companyId: req.user.companyId };
    const created = await PurchaseInvoiceService.createInvoice(payload, req.user);
    res.status(201).json(created);
  } catch (error) {
    console.log('Error creating purchase invoice:', error);
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

// PUT /api/purchase-invoices/:id/send - Send purchase invoice
router.put('/:id/send', csrfProtection, validate([ param('id').isUUID() ]), async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await PurchaseInvoice.findOne({ where: buildCompanyWhere(req, { id }) });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be sent' });
    await invoice.update({ status: 'sent', sent_by: req.user.id, sent_at: new Date(), updated_by: req.user.id });
    res.json({ message: 'Invoice sent' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// PUT /api/purchase-invoices/:id/approve - Approve purchase invoice
router.put('/:id/approve', csrfProtection, validate([ param('id').isUUID() ]), async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const invoice = await PurchaseInvoice.findOne({ where: buildCompanyWhere(req, { id }), transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    if (!invoice) { await dbTransaction.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (['approved','paid','cancelled'].includes(invoice.status)) { await dbTransaction.rollback(); return res.status(400).json({ error: 'Cannot approve this invoice' }); }
    if (!['sent','overdue','draft'].includes(invoice.status)) { await dbTransaction.rollback(); return res.status(400).json({ error: 'Only sent, overdue or draft invoices can be approved' }); }

    // Perform any domain-specific processing here if needed (GL posting, inventory, etc.)
    await invoice.update({ status: 'approved', approved_by: req.user.id, approved_at: new Date(), updated_by: req.user.id }, { transaction: dbTransaction });
    await dbTransaction.commit();
    res.json({ message: 'Invoice approved' });
  } catch (error) {
    try { await dbTransaction.rollback(); } catch (e) {}
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// PUT /api/purchase-invoices/:id/reject - Reject purchase invoice
router.put('/:id/reject', csrfProtection, validate([ param('id').isUUID(), body('rejectionReason').notEmpty() ]), async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const invoice = await PurchaseInvoice.findOne({ where: buildCompanyWhere(req, { id }) });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (['paid','cancelled','rejected'].includes(invoice.status)) return res.status(400).json({ error: 'Cannot reject this invoice' });
    await invoice.update({ status: 'rejected', rejected_by: req.user.id, rejected_at: new Date(), rejection_reason: rejectionReason.trim(), updated_by: req.user.id });
    res.json({ message: 'Invoice rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// PUT /api/purchase-invoices/:id/cancel - Cancel purchase invoice (accepts cancellationReason)
router.put('/:id/cancel', csrfProtection, validate([ param('id').isUUID(), body('cancellationReason').notEmpty() ]), async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;
    const invoice = await PurchaseInvoice.findOne({ where: buildCompanyWhere(req, { id }) });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'paid') return res.status(400).json({ error: 'Paid invoices cannot be cancelled' });
    if (['cancelled','rejected'].includes(invoice.status)) return res.status(400).json({ error: 'Invoice already cancelled or rejected' });
    await invoice.update({ status: 'cancelled', cancelled_by: req.user.id, cancelled_at: new Date(), cancellation_reason: cancellationReason.trim(), updated_by: req.user.id });
    res.json({ message: 'Invoice cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// GET /api/purchase-invoices/export/excel - Export purchase invoices to Excel (not implemented)
router.get('/export/excel', async (req, res) => {
  return res.status(501).json({ message: 'Excel export for purchase invoices not yet implemented' });
});

// GET /api/purchase-invoices/export/pdf - Export purchase invoices to PDF (not implemented)
router.get('/export/pdf', async (req, res) => {
  return res.status(501).json({ message: 'PDF export for purchase invoices not yet implemented' });
});

// PUT /api/purchase-invoices/:id/record-payment - Record a payment directly against the invoice
router.put('/:id/record-payment', csrfProtection, validate([ param('id').isUUID(), body('amount').notEmpty() ]), async (req, res) => {
  try {
    const { id } = req.params;
    const payload = { amount: req.body.amount, method: req.body.method, reference: req.body.reference };
    const result = await PurchaseInvoiceService.pay(id, payload, req.user);
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
