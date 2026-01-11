const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ReturnOut, ReturnOutItem, User, Store, Vendor, ReturnReason, Currency, Product } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ReturnOutService = require('../services/returnOutService');
const { sequelize } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // Prevent companyId override attacks

// List with pagination, search and sorting
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'return_date';
    const sortOrder = req.query.sortOrder || 'DESC';

    const whereClause = {};
    if (req.query.storeId) whereClause.store_id = req.query.storeId;
    if (req.query.vendorId) whereClause.vendor_id = req.query.vendorId;
    if (req.query.status) whereClause.status = req.query.status;

    if (search) {
      whereClause[Op.or] = [
        { notes: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // build order clause
    const orderClause = [[sortBy, sortOrder]];

    const { count, rows } = await ReturnOut.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Store, as: 'store', required: false },
        { model: Vendor, as: 'vendor', required: false },
        { model: ReturnReason, as: 'returnReason', required: false },
        { model: Currency, as: 'currency', required: false },
        { model: ReturnOutItem, as: 'items', required: false, include: [{ model: Product, as: 'product', required: false }] }
      ],
      order: orderClause,
      limit,
      offset
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
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get all (for dropdowns) - optionally filter by active/ recent
router.get('/all', async (req, res) => {
  try {
    const returnOuts = await ReturnOut.findAll({
      where: buildCompanyWhere(req),
      include: [
        { model: Store, as: 'store', required: false },
        { model: Vendor, as: 'vendor', required: false },
        { model: ReturnReason, as: 'returnReason', required: false }
      ],
      order: [['return_date', 'DESC']],
      limit: 200
    });
    res.json(returnOuts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch returns out', details: error.message });
  }
});

// Stats/overview
router.get('/stats', async (req, res) => {
  try {
    const total = await ReturnOut.count({ where: buildCompanyWhere(req) });
    const draft = await ReturnOut.count({ where: buildCompanyWhere(req, { status: 'draft' }) });
    const confirmed = await ReturnOut.count({ where: buildCompanyWhere(req, { status: 'confirmed' }) });
    const cancelled = await ReturnOut.count({ where: buildCompanyWhere(req, { status: 'cancelled' }) });
    const totalAmount = await ReturnOut.sum('total_amount', { where: buildCompanyWhere(req) });

    res.json({ stats: { total, draft, confirmed, cancelled, totalAmount: Number(totalAmount || 0) } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get by ID
router.get('/:id', async (req, res) => {
  try {
    const record = await ReturnOut.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: ReturnOutItem, as: 'items', include: [{ model: Product, as: 'product' }] },
        { model: Store, as: 'store' },
        { model: Vendor, as: 'vendor' },
        { model: ReturnReason, as: 'returnReason' },
        { model: Currency, as: 'currency' }
      ]
    });
    if (!record) return res.status(404).json({ error: 'Return out not found' });
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Create new return out
router.post('/', csrfProtection, async (req, res) => {
  try {
    if (!req.user.companyId) return res.status(400).json({ error: 'Company ID is required' });

    const payload = { ...req.body, companyId: req.user.companyId };
    const created = await ReturnOutService.createReturnOut(payload, req.user);
    res.status(201).json(created);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
  }
});

// Update return out header (limited fields)
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const record = await ReturnOut.findOne({ where: buildCompanyWhere(req, { id: req.params.id }) });
    if (!record) return res.status(404).json({ error: 'Return out not found' });

    // Only allow updates on draft or confirmed (business rule can be adjusted)
    const updatable = ['return_date','notes','status','exchange_rate','currency_id','vendor_id','return_reason_id'];
    const updates = {};
    for (const key of Object.keys(req.body || {})) {
      if (updatable.includes(key) || updatable.includes(camelToSnake(key))) {
        updates[camelToSnake(key)] = req.body[key];
      }
    }

    updates.updated_by = req.user.id;

    await record.update(updates);

    const updated = await ReturnOut.findByPk(req.params.id, {
      include: [ { model: ReturnOutItem, as: 'items', include: [{ model: Product, as: 'product' }] }, { model: Store, as: 'store' }, { model: Vendor, as: 'vendor' }, { model: ReturnReason, as: 'returnReason' }, { model: Currency, as: 'currency' } ]
    });
    res.json(updated);
  } catch (error) {
    if (error.name === 'SequelizeForeignKeyConstraintError') return res.status(400).json({ error: 'Invalid reference ID' });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Delete (hard delete) - mirrors returnReason behavior
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const record = await ReturnOut.findOne({ where: buildCompanyWhere(req, { id: req.params.id }) });
    if (!record) return res.status(404).json({ error: 'Return out not found' });

    await record.destroy();
    res.json({ message: 'Return out deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const whereClause = {};
    if (req.query.search) whereClause.notes = { [Op.iLike]: `%${req.query.search}%` };
    if (req.query.status) whereClause.status = req.query.status;
    if (req.query.storeId) whereClause.store_id = req.query.storeId;

    const records = await ReturnOut.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [ { model: ReturnOutItem, as: 'items', include: [{ model: Product, as: 'product' }] }, { model: Store, as: 'store' }, { model: Vendor, as: 'vendor' }, { model: ReturnReason, as: 'returnReason' }, { model: Currency, as: 'currency' } ],
      order: [['return_date','DESC']]
    });

    const transformed = records.map(r => ({ ...r.toJSON() }));
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();
    const buffer = await exportService.exportReturnOutsToExcel(transformed, req.query);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="returns_out_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export returns out', details: error.message });
  }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const whereClause = {};
    if (req.query.search) whereClause.notes = { [Op.iLike]: `%${req.query.search}%` };
    if (req.query.status) whereClause.status = req.query.status;

    const records = await ReturnOut.findAll({ where: buildCompanyWhere(req, whereClause), include: [ { model: ReturnOutItem, as: 'items', include: [{ model: Product, as: 'product' }] }, { model: Store, as: 'store' }, { model: Vendor, as: 'vendor' }, { model: ReturnReason, as: 'returnReason' }, { model: Currency, as: 'currency' } ], order: [['return_date','DESC']] });

    const transformed = records.map(r => ({ ...r.toJSON() }));
    const ExportService = require('../utils/exportService');
    const exportService = new ExportService();
    const buffer = await exportService.exportReturnOutsToPDF(transformed, req.query);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="returns_out_export_${new Date().toISOString().split('T')[0]}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export returns out to PDF', details: error.message });
  }
});

function camelToSnake(key) {
  // quick helper to convert camelCase to snake_case
  return key.replace(/([A-Z])/g, letter => `_${letter.toLowerCase()}`);
}

module.exports = router;
