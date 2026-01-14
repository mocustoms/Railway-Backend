const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const { PurchaseInvoice, PurchaseInvoicePayment, sequelize } = require('../models');
const { Op } = require('sequelize');
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

// Payments stats
router.get('/stats', async (req, res) => {
  try {
    // First get invoice IDs for this company to scope payments correctly without Sequelize adding non-aggregated columns
    const invoices = await PurchaseInvoice.findAll({ where: buildCompanyWhere(req), attributes: ['id'], raw: true });
    const invoiceIds = invoices.map(i => i.id);

    if (invoiceIds.length === 0) {
      return res.json({ stats: { total: 0, totalAmount: 0, byMethod: [] } });
    }

    const total = await PurchaseInvoicePayment.count({ where: { purchase_invoice_id: invoiceIds } });
    const totalAmount = await PurchaseInvoicePayment.sum('amount', { where: { purchase_invoice_id: invoiceIds } }) || 0;

    // Count and sum by method
    const byMethodRows = await PurchaseInvoicePayment.findAll({
      attributes: ['method', [sequelize.fn('COUNT', sequelize.col('id')), 'count'], [sequelize.fn('SUM', sequelize.col('amount')), 'sum']],
      where: { purchase_invoice_id: invoiceIds },
      group: ['method']
    });
    const byMethod = byMethodRows.map(r => ({ method: r.method, count: Number(r.get('count')), sum: r.get('sum') }));

    res.json({ stats: { total, totalAmount, byMethod } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Create a payment for a purchase invoice
router.post('/:id/pay', csrfProtection, validate([
  param('id').isUUID().withMessage('Invalid invoice id'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount must be a number > 0'),
  body('method').optional().isString(),
  body('reference').optional().isString()
]), async (req, res) => {
  try {
    // Ensure invoice exists and belongs to the requesting user's company
    const invoice = await PurchaseInvoice.findOne({ where: buildCompanyWhere(req, { id: req.params.id }) });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const payload = {
      amount: req.body.amount,
      method: req.body.method,
      reference: req.body.reference
    };

    const result = await PurchaseInvoiceService.pay(req.params.id, payload, req.user);
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// List payments with pagination and filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.invoiceId) where.purchase_invoice_id = req.query.invoiceId;
    if (req.query.method) where.method = req.query.method;
    if (req.query.fromDate || req.query.toDate) {
      where.paid_at = {};
      if (req.query.fromDate) where.paid_at[Op.gte] = new Date(req.query.fromDate);
      if (req.query.toDate) where.paid_at[Op.lte] = new Date(req.query.toDate);
    }

    const { count, rows } = await PurchaseInvoicePayment.findAndCountAll({
      where,
      include: [{ model: PurchaseInvoice, as: 'purchaseInvoice', where: buildCompanyWhere(req), required: true }],
      order: [['paid_at', 'DESC']],
      limit,
      offset
    });

    res.json({ data: rows, pagination: { currentPage: page, totalPages: Math.ceil(count/limit), totalItems: count, itemsPerPage: limit } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get payment by ID
router.get('/:id', validate([ param('id').isUUID().withMessage('Invalid id') ]), async (req, res) => {
  try {
    const payment = await PurchaseInvoicePayment.findOne({ where: { id: req.params.id }, include: [{ model: PurchaseInvoice, as: 'purchaseInvoice', where: buildCompanyWhere(req), required: true }] });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Delete a payment
router.delete('/:id', csrfProtection, validate([ param('id').isUUID().withMessage('Invalid id') ]), async (req, res) => {
  try {
    // Find payment and its invoice with company scoping
    const payment = await PurchaseInvoicePayment.findOne({ where: { id: req.params.id }, include: [{ model: PurchaseInvoice, as: 'purchaseInvoice', where: buildCompanyWhere(req), required: true }] });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const invoiceId = payment.purchaseInvoice.id;

    await sequelize.transaction(async (transaction) => {
      // Lock invoice row
      const invoice = await PurchaseInvoice.findByPk(invoiceId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!invoice) { const err = new Error('Invoice not found'); err.status = 404; throw err; }

      // Delete the payment
      await payment.destroy({ transaction });

      // Recalculate payments total
      const remainingSum = await PurchaseInvoicePayment.sum('amount', { where: { purchase_invoice_id: invoiceId }, transaction }) || 0;
      const newBalance = +(Number(invoice.total_amount) - Number(remainingSum)).toFixed(2);
      let newStatus = invoice.status;
      if (newBalance <= 0) newStatus = 'paid';
      else if (newBalance < Number(invoice.total_amount)) newStatus = 'partially_paid';
      else newStatus = 'posted';

      await invoice.update({ balance_due: Math.max(0, newBalance), status: newStatus, updated_by: req.user.id }, { transaction });
    });

    res.json({ message: 'Payment deleted' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});



module.exports = router;
