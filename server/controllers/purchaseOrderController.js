const PurchaseOrderService = require('../services/purchaseOrderService');

class PurchaseOrderController {
  static async create(req, res) {
    try {
      if (!req.user.companyId) return res.status(400).json({ error: 'Company ID required' });
      const payload = { ...req.body, companyId: req.user.companyId };
      const created = await PurchaseOrderService.createPurchaseOrder(payload, req.user);
      res.status(201).json(created);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  static async getById(req, res) {
    try {
      const po = await PurchaseOrderService.getById(req.params.id, req.user.companyId);
      if (!po) return res.status(404).json({ error: 'Not found' });
      res.json(po);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  static async list(req, res) {
    try {
      const filters = { companyId: req.user.companyId };
      if (req.query.storeId) filters.storeId = req.query.storeId;
      if (req.query.vendorId) filters.vendorId = req.query.vendorId;
      if (req.query.status) filters.status = req.query.status;
      const rows = await PurchaseOrderService.list(filters);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async update(req, res) {
    try {
      const updated = await PurchaseOrderService.updatePurchaseOrder(req.params.id, req.body, req.user);
      res.json(updated);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  static async receive(req, res) {
    try {
      const payload = req.body || {};
      const result = await PurchaseOrderService.receive(req.params.id, payload, req.user);
      res.json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  static async cancel(req, res) {
    try {
      const result = await PurchaseOrderService.cancel(req.params.id, req.user);
      res.json({ message: 'Cancelled', data: result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
}

module.exports = PurchaseOrderController;
