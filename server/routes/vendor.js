const express = require('express');
const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const autoCodeService = require('../utils/autoCodeService');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Vendor, VendorGroup, Account, Company, User, sequelize, Product, VendorProduct } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // Prevent companyId override attacks

// Stats
router.get('/stats', async (req, res) => {
  try {
    const total = await Vendor.count({ where: buildCompanyWhere(req) });
    const active = await Vendor.count({ where: buildCompanyWhere(req, { is_active: true }) });
    const inactive = await Vendor.count({ where: buildCompanyWhere(req, { is_active: false }) });
    const lastUpdateItem = await Vendor.findOne({ where: buildCompanyWhere(req), order: [['updated_at', 'DESC']] });
    res.json({ success: true, data: { total, active, inactive, lastUpdate: lastUpdateItem?.updated_at || null } });
  } catch (e) {
    console.error('Error fetching vendor stats', e);
    res.status(500).json({ success: false, error: 'Failed to fetch vendor stats' });
  }
});

// List with pagination, search and sorting
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
        { vendor_id: { [Op.iLike]: `%${search}%` } },
        { phone_number: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    if (status !== 'all') {
      where.is_active = status === 'active';
    }

    const finalWhere = buildCompanyWhere(req, where);
    if (!req.user.isSystemAdmin && req.user.companyId) finalWhere.companyId = req.user.companyId;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Sorting
    const directFields = {
      vendor_id: 'vendor_id',
      full_name: 'full_name',
      phone_number: 'phone_number',
      email: 'email',
      website: 'website',
      is_active: 'is_active',
      created_at: 'created_at',
      updated_at: 'updated_at'
    };

    let orderClause = [];
    if (sort_by === 'vendor_group_name') {
      orderClause = [[{ model: VendorGroup, as: 'vendorGroup' }, 'vendor_group_name', sort_order.toUpperCase()]];
    } else if (sort_by === 'default_payable_account_name') {
      orderClause = [[{ model: Account, as: 'defaultPayableAccount' }, 'name', sort_order.toUpperCase()]];
    } else if (sort_by === 'created_by_name') {
      orderClause = [[{ model: User, as: 'creator' }, 'first_name', sort_order.toUpperCase()]];
    } else if (sort_by === 'updated_by_name') {
      orderClause = [[{ model: User, as: 'updater' }, 'first_name', sort_order.toUpperCase()]];
    } else if (directFields[sort_by]) {
      orderClause = [[directFields[sort_by], sort_order.toUpperCase()]];
    } else {
      orderClause = [[sort_by, sort_order.toUpperCase()]];
    }

    const { count, rows } = await Vendor.findAndCountAll({
      where: finalWhere,
      include: [
        { model: VendorGroup, as: 'vendorGroup', attributes: ['id', 'vendor_group_name', 'vendor_group_code'], where: buildCompanyWhere(req), required: false },
        { model: Account, as: 'defaultPayableAccount', attributes: ['id', 'code', 'name'], required: false },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'] }
      ],
      order: orderClause,
      limit: parseInt(limit),
      offset
    });

    const data = rows.map(v => {
      const json = v.toJSON();
      return {
        ...json,
        companyId: json.companyId || v.getDataValue('companyId') || null,
        vendor_group_name: v.vendorGroup ? v.vendorGroup.vendor_group_name : null,
        default_payable_account_name: v.defaultPayableAccount ? `${v.defaultPayableAccount.code} - ${v.defaultPayableAccount.name}` : null,
        created_by_name: v.creator ? `${v.creator.first_name} ${v.creator.last_name}` : null,
        updated_by_name: v.updater ? `${v.updater.first_name} ${v.updater.last_name}` : null
      };
    });

    return res.json({
      success: true,
      data,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch vendors' });
  }
});

// Active list for dropdowns
router.get('/active', async (req, res) => {
  try {
    const vendors = await Vendor.findAll({
      where: buildCompanyWhere(req, {}),
      attributes: ['id', 'full_name', 'vendor_id'],
      order: [['full_name', 'ASC']]
    });
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch vendors' });
  }
});

// Get by id
router.get('/:id', async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: VendorGroup, as: 'vendorGroup', attributes: ['id', 'vendor_group_name', 'vendor_group_code'], required: false },
        { model: Account, as: 'defaultPayableAccount', attributes: ['id', 'code', 'name'], required: false },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'], required: false },
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'], required: false }
      ]
    });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch vendor' });
  }
});

// Create
router.post('/', [
  body('vendor_group_id').isUUID().withMessage('Vendor group id is required'),
  body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ max: 150 }).withMessage('Full name too long'),
  body('default_payable_account_id').optional().isUUID().withMessage('Default payable account must be a UUID'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email')
], csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!req.user || !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ success: false, error: 'Company access required' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await transaction.rollback();
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { vendor_group_id, full_name, address, default_payable_account_id, fax, phone_number, email, website, is_active = true } = req.body;
    const trimmedName = full_name?.trim();
    if (!trimmedName) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'Full name cannot be empty' });
    }

    // Validate vendor_group belongs to company
    const group = await VendorGroup.findOne({ where: buildCompanyWhere(req, { id: vendor_group_id }), transaction });
    if (!group) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'Vendor group not found or does not belong to your company' });
    }

    // Validate payable account if provided
    if (default_payable_account_id) {
      const acc = await Account.findOne({ where: buildCompanyWhere(req, { id: default_payable_account_id }), transaction });
      if (!acc) {
        await transaction.rollback();
        return res.status(400).json({ success: false, error: 'Payable account not found or does not belong to your company' });
      }
    }

    // Check duplicate full_name within company
    const existingByName = await Vendor.findOne({ where: { full_name: trimmedName, companyId: req.user.companyId }, transaction });
    if (existingByName) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'A vendor with this name already exists in your company' });
    }

    // Generate vendor code
    const vendor_id = await autoCodeService.generateNextCode('vendors', req.user.companyId, { transaction, fallbackPrefix: 'VEND', fallbackFormat: '{PREFIX}-{NUMBER}' });

    const created = await Vendor.create({
      companyId: req.user.companyId,
      vendor_id,
      vendor_group_id,
      full_name: trimmedName,
      address: address || null,
      default_payable_account_id: default_payable_account_id || null,
      fax: fax || null,
      phone_number: phone_number || null,
      email: email || null,
      website: website || null,
      is_active,
      created_by: req.user.id
    }, { transaction });

    await transaction.commit();

    const createdWithIncludes = await Vendor.findOne({ where: buildCompanyWhere(req, { id: created.id }), include: [
      { model: VendorGroup, as: 'vendorGroup', attributes: ['id', 'vendor_group_name'] },
      { model: Account, as: 'defaultPayableAccount', attributes: ['id', 'code', 'name'] },
      { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
      { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'] }
    ] });

    return res.status(201).json({ success: true, data: createdWithIncludes });
  } catch (error) {
    console.error('Error creating vendor:', error);
    if (transaction && !transaction.finished) await transaction.rollback();
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ success: false, error: 'Duplicate entry', message: error.message, fields: error.fields });
    }
    return res.status(500).json({ success: false, error: error?.message || 'Failed to create vendor' });
  }
});

// Update
router.put('/:id', [
  body('vendor_group_id').optional().isUUID().withMessage('Vendor group id must be a UUID'),
  body('full_name').optional().trim().notEmpty().withMessage('Full name cannot be empty').isLength({ max: 150 }).withMessage('Full name too long'),
  body('default_payable_account_id').optional().isUUID().withMessage('Default payable account must be a UUID'),
  body('email').optional({checkFalsy: true}).isEmail().withMessage('Invalid email')
], csrfProtection, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const vendor = await Vendor.findOne({ where: buildCompanyWhere(req, { id: req.params.id }) });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });

    const normalize = (v) => (v === '' || v === undefined ? null : v);
    const payload = {
      vendor_group_id: req.body.vendor_group_id !== undefined ? req.body.vendor_group_id : vendor.vendor_group_id,
      full_name: req.body.full_name !== undefined ? req.body.full_name?.trim() : vendor.full_name,
      address: normalize(req.body.address),
      default_payable_account_id: normalize(req.body.default_payable_account_id),
      fax: normalize(req.body.fax),
      phone_number: normalize(req.body.phone_number),
      email: normalize(req.body.email),
      website: normalize(req.body.website),
      is_active: req.body.is_active !== undefined ? req.body.is_active : vendor.is_active,
      updated_by: req.user.id
    };

    // Validate vendor_group if changed
    if (payload.vendor_group_id && payload.vendor_group_id !== vendor.vendor_group_id) {
      const group = await VendorGroup.findOne({ where: buildCompanyWhere(req, { id: payload.vendor_group_id }) });
      if (!group) return res.status(400).json({ success: false, error: 'Vendor group not found or does not belong to your company' });
    }

    // Validate account if changed
    if (payload.default_payable_account_id && payload.default_payable_account_id !== vendor.default_payable_account_id) {
      const acc = await Account.findOne({ where: buildCompanyWhere(req, { id: payload.default_payable_account_id }) });
      if (!acc) return res.status(400).json({ success: false, error: 'Payable account not found or does not belong to your company' });
    }

    // Check name uniqueness if changed
    if (payload.full_name && payload.full_name !== vendor.full_name) {
      const existing = await Vendor.findOne({ where: buildCompanyWhere(req, { full_name: payload.full_name, id: { [Op.ne]: req.params.id } }) });
      if (existing) return res.status(400).json({ success: false, error: 'A vendor with this name already exists in your company' });
    }

    await vendor.update(payload);

    const updated = await Vendor.findOne({ where: buildCompanyWhere(req, { id: req.params.id }), include: [
      { model: VendorGroup, as: 'vendorGroup', attributes: ['id', 'vendor_group_name'] },
      { model: Account, as: 'defaultPayableAccount', attributes: ['id', 'code', 'name'] },
      { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
      { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name'] }
    ] });

    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors?.map(err => ({ field: err.path, message: err.message })) || [];
      return res.status(400).json({ success: false, error: 'Validation error', errors: validationErrors, message: error.message });
    }
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ success: false, error: 'Duplicate entry', message: error.message });
    }
    return res.status(500).json({ success: false, error: error?.message || 'Failed to update vendor' });
  }
});

// Usage - simple check (no purchases model present in repo)
router.get('/:id/usage', async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: buildCompanyWhere(req, { id: req.params.id }) });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });

    // No known relations referencing vendors exist in repository; return not used
    return res.json({ isUsed: false, usageCount: 0, canDelete: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to check vendor usage' });
  }
});

// Get products assigned to a vendor
router.get('/:vendorId/products', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const vendor = await Vendor.findOne({ where: buildCompanyWhere(req, { id: vendorId }) });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });

    // Find assigned products via the join table and include product details
    const assignments = await VendorProduct.findAll({
      where: { vendor_id: vendor.id },
      include: [
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'code', 'name', 'product_type', 'barcode'],
          where: buildCompanyWhere(req),
          required: true
        }
      ],
      order: [['created_at', 'DESC']]
    });

    const result = assignments.map(a => {
      const p = a.product;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        product_type: p.product_type,
        barcode: p.barcode || undefined,
        assigned_at: a.created_at ? new Date(a.created_at).toISOString() : null
      };
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching vendor products:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch vendor products' });
  }
});

// Assign products to vendor
router.post('/:vendorId/products', [
  body('product_ids').isArray({ min: 1 }).withMessage('product_ids must be a non-empty array'),
  body('product_ids.*').isUUID().withMessage('Each product id must be a valid UUID')
], csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await transaction.rollback();
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { vendorId } = req.params;
    const { product_ids } = req.body;

    const vendor = await Vendor.findOne({ where: buildCompanyWhere(req, { id: vendorId }), transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    // Ensure all products exist and belong to the company (if company scoping is used)
    const products = await Product.findAll({ where: buildCompanyWhere(req, { id: product_ids }), transaction });
    if (products.length !== product_ids.length) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'One or more products not found or do not belong to your company' });
    }

    // Create join rows if they do not exist
    for (const pid of product_ids) {
      await VendorProduct.findOrCreate({
        where: { vendor_id: vendor.id, product_id: pid },
        defaults: { companyId: req.user.companyId || null },
        transaction
      });
    }

    await transaction.commit();

    const updated = await Vendor.findOne({ where: buildCompanyWhere(req, { id: vendor.id }), include: [ { model: Product, as: 'products' } ] });
    return res.json({ success: true, data: updated });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error('Error assigning products to vendor:', error);
    return res.status(500).json({ success: false, error: 'Failed to assign products to vendor' });
  }
});

// Unassign a product from a vendor
router.delete('/:vendorId/products/:productId', csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { vendorId, productId } = req.params;

    const vendor = await Vendor.findOne({ where: buildCompanyWhere(req, { id: vendorId }), transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    const product = await Product.findOne({ where: buildCompanyWhere(req, { id: productId }), transaction });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const where = { vendor_id: vendor.id, product_id: product.id };
    if (req.user && req.user.companyId) where.companyId = req.user.companyId;

    const destroyed = await VendorProduct.destroy({ where, transaction });
    if (!destroyed) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    await transaction.commit();
    return res.json({ success: true });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error('Error unassigning product from vendor:', error);
    return res.status(500).json({ success: false, error: 'Failed to unassign product from vendor' });
  }
});

// Bulk remove products from a vendor
router.post('/:vendorId/products/bulk-remove', [
  body('product_ids').isArray({ min: 1 }).withMessage('product_ids must be a non-empty array'),
  body('product_ids.*').isUUID().withMessage('Each product id must be a valid UUID')
], csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await transaction.rollback();
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { vendorId } = req.params;
    const { product_ids } = req.body;

    const vendor = await Vendor.findOne({ where: buildCompanyWhere(req, { id: vendorId }), transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    // Ensure all products exist and belong to the company
    const products = await Product.findAll({ where: buildCompanyWhere(req, { id: product_ids }), transaction });
    if (products.length !== product_ids.length) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'One or more products not found or do not belong to your company' });
    }

    const where = { vendor_id: vendor.id, product_id: product_ids };
    if (req.user && req.user.companyId) where.companyId = req.user.companyId;

    const destroyed = await VendorProduct.destroy({ where, transaction });

    await transaction.commit();
    return res.json({ success: true, removed: destroyed });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error('Error bulk removing products from vendor:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk remove products from vendor' });
  }
});

// Delete
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const deleted = await Vendor.destroy({ where: buildCompanyWhere(req, { id: req.params.id }) });
    if (!deleted) return res.status(404).json({ success: false, error: 'Vendor not found' });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to delete vendor' });
  }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const vendors = await Vendor.findAll({ where: buildCompanyWhere(req), include: [
      { model: VendorGroup, as: 'vendorGroup', attributes: ['vendor_group_name'] },
      { model: Account, as: 'defaultPayableAccount', attributes: ['code', 'name'] }
    ] });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Vendors');
    sheet.columns = [
      { header: 'Vendor ID', key: 'vendor_id', width: 20 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Group', key: 'group', width: 20 },
      { header: 'Payable', key: 'payable', width: 30 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Active', key: 'is_active', width: 10 }
    ];
    vendors.forEach(v => sheet.addRow({
      vendor_id: v.vendor_id,
      full_name: v.full_name,
      group: v.vendorGroup?.vendor_group_name || '',
      payable: v.defaultPayableAccount ? `${v.defaultPayableAccount.code} - ${v.defaultPayableAccount.name}` : '',
      phone: v.phone_number || '',
      email: v.email || '',
      is_active: v.is_active ? 'Yes' : 'No'
    }));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=vendors.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to export Excel' });
  }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const vendors = await Vendor.findAll({ where: buildCompanyWhere(req), include: [
      { model: VendorGroup, as: 'vendorGroup', attributes: ['vendor_group_name'] },
      { model: Account, as: 'defaultPayableAccount', attributes: ['code', 'name'] }
    ] });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=vendors.pdf');
    doc.pipe(res);
    doc.fontSize(16).text('Vendors', { align: 'center' });
    doc.moveDown();
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [80, 150, 100, 120, 80, 80];
    const headers = ['ID', 'Full Name', 'Group', 'Payable', 'Phone', 'Active'];
    doc.fontSize(9).font('Helvetica-Bold');
    let x = tableLeft;
    headers.forEach((h, i) => { doc.text(h, x, tableTop, { width: colWidths[i], align: 'left' }); x += colWidths[i]; });
    doc.fontSize(8).font('Helvetica');
    let y = tableTop + 20;
    vendors.forEach(v => {
      x = tableLeft;
      const row = [v.vendor_id || '', v.full_name || '', v.vendorGroup?.vendor_group_name || '', v.defaultPayableAccount ? `${v.defaultPayableAccount.code} - ${v.defaultPayableAccount.name}` : '', v.phone_number || '', v.is_active ? 'Yes' : 'No'];
      row.forEach((c, i) => { doc.text(String(c), x, y, { width: colWidths[i], align: 'left' }); x += colWidths[i]; });
      y += 15;
      if (y > 750) { doc.addPage(); y = 50; }
    });
    doc.end();
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to export PDF' });
  }
});

module.exports = router;
