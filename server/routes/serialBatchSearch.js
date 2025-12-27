const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Search serial numbers
router.get('/serial-numbers/search', async (req, res) => {
  try {
    const { query, store_id, product_id, limit = 20 } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Use models from index (same pattern as stockAdjustment.js)
    const { ProductSerialNumber, Product, Store } = require('../models');
    
    const whereClause = {
      serial_number: {
        [Op.iLike]: `%${query.trim()}%`
      },
      is_active: true
    };

    // Add store filter if provided
    if (store_id) {
      whereClause.store_id = store_id;
    }

    // Add product filter if provided
    if (product_id) {
      whereClause.product_id = product_id;
    }

    const serialNumbers = await ProductSerialNumber.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name', 'code', 'track_serial_number'] },
        { model: Store, as: 'store', attributes: ['id', 'name'] }
      ],
      order: [['serial_number', 'ASC']],
      limit: parseInt(limit)
    });

    res.json({ 
      success: true,
      serialNumbers: serialNumbers.map(sn => ({
        id: sn.id,
        serial_number: sn.serial_number,
        product_id: sn.product_id,
        product_name: sn.product?.name,
        product_code: sn.product?.code,
        store_id: sn.store_id,
        store_name: sn.store?.name,
        current_quantity: sn.current_quantity,
        status: sn.status,
        unit_cost: sn.unit_cost,
        created_at: sn.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search serial numbers' });
  }
});

// Get available serial numbers for a product in a store
// CRITICAL: This route must come BEFORE /serial-numbers/:id to avoid route conflicts
router.get('/serial-numbers/available', async (req, res) => {
  try {
    const { product_id, store_id } = req.query;
    
    if (!product_id || !store_id) {
      return res.status(400).json({ error: 'product_id and store_id are required' });
    }

    if (!req.user || !req.user.companyId) {
      return res.status(400).json({ error: 'User company ID is required' });
    }

    // Use models from index (same pattern as stockAdjustment.js)
    const { ProductSerialNumber } = require('../models');
    
    const whereClause = {
      product_id,
      store_id, // Filter by the selected store in the sales invoice/order
      companyId: req.user.companyId, // Multi-tenant filter (same pattern as batch numbers)
      is_active: true,
      status: 'active',
      current_quantity: {
        [Op.gt]: 0 // Only return serial numbers with available quantity
      }
    };


    // Query serial numbers (same pattern as batch numbers - no includes needed)
    let serialNumbers;
    try {
      serialNumbers = await ProductSerialNumber.findAll({
        where: whereClause,
        order: [['serial_number', 'ASC']],
        limit: 1000
      });
    } catch (queryError) {
      throw queryError;
    }

    res.json({ 
      success: true,
      serialNumbers: serialNumbers.map(sn => ({
        id: sn.id || sn.uuid,
        serial_number: sn.serial_number,
        product_id: sn.product_id,
        product_name: null, // Not loading product details to keep query simple
        product_code: null,
        store_id: sn.store_id,
        store_name: null, // Not loading store details to keep query simple
        current_quantity: parseFloat(sn.current_quantity || 0),
        status: sn.status || null,
        unit_cost: sn.unit_cost ? parseFloat(sn.unit_cost) : null
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch available serial numbers',
      message: error.message,
      name: error.name,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Search batch numbers
router.get('/batch-numbers/search', async (req, res) => {
  try {
    const { query, store_id, product_id, limit = 20 } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    // Use models from index (same pattern as other routes)
    const { ProductExpiryDate, Product, Store } = require('../models');
    
    const whereClause = {
      batch_number: {
        [Op.iLike]: `%${query.trim()}%`
      },
      is_active: true
    };

    // Add store filter if provided
    if (store_id) {
      whereClause.store_id = store_id;
    }

    // Add product filter if provided
    if (product_id) {
      whereClause.product_id = product_id;
    }

    const batchNumbers = await ProductExpiryDate.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name', 'code', 'expiry_notification_days'] },
        { model: Store, as: 'store', attributes: ['id', 'name'] }
      ],
      order: [['batch_number', 'ASC']],
      limit: parseInt(limit)
    });

    res.json({ 
      success: true,
      batchNumbers: batchNumbers.map(bn => ({
        id: bn.id,
        batch_number: bn.batch_number,
        product_id: bn.product_id,
        product_name: bn.product?.name,
        product_code: bn.product?.code,
        store_id: bn.store_id,
        store_name: bn.store?.name,
        current_quantity: bn.current_quantity,
        expiry_date: bn.expiry_date ? bn.expiry_date.toISOString().split('T')[0] : null,
        status: bn.status,
        unit_cost: bn.unit_cost,
        days_until_expiry: bn.days_until_expiry,
        created_at: bn.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search batch numbers' });
  }
});

// Get serial number details by ID
router.get('/serial-numbers/:id', async (req, res) => {
  try {
    // Use models from index (same pattern as stockAdjustment.js)
    const { ProductSerialNumber, Product, Store } = require('../models');
    
    const serialNumber = await ProductSerialNumber.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name', 'code', 'track_serial_number'] },
        { model: Store, as: 'store', attributes: ['id', 'name'] }
      ]
    });

    if (!serialNumber) {
      return res.status(404).json({ error: 'Serial number not found' });
    }

    res.json({ 
      success: true,
      serialNumber: {
        id: serialNumber.id,
        serial_number: serialNumber.serial_number,
        product_id: serialNumber.product_id,
        product_name: serialNumber.product?.name,
        product_code: serialNumber.product?.code,
        store_id: serialNumber.store_id,
        store_name: serialNumber.store?.name,
        current_quantity: serialNumber.current_quantity,
        status: serialNumber.status,
        unit_cost: serialNumber.unit_cost,
        total_quantity_received: serialNumber.total_quantity_received,
        total_quantity_sold: serialNumber.total_quantity_sold,
        total_quantity_adjusted: serialNumber.total_quantity_adjusted,
        created_at: serialNumber.created_at
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch serial number details' });
  }
});

// Get available batch numbers for a product in a store
// CRITICAL: This route must come BEFORE /batch-numbers/:id to avoid route conflicts
router.get('/batch-numbers/available', async (req, res) => {
  try {
    const { product_id, store_id } = req.query;
    
    if (!product_id || !store_id) {
      return res.status(400).json({ error: 'product_id and store_id are required' });
    }

    if (!req.user || !req.user.companyId) {
      return res.status(400).json({ error: 'User company ID is required' });
    }

    // Use models from index (same pattern as stockAdjustment.js)
    const { ProductExpiryDate } = require('../models');
    
    const whereClause = {
      product_id,
      store_id, // Filter by the selected store in the sales invoice
      companyId: req.user.companyId, // Multi-tenant filter (same pattern as stockAdjustment.js)
      is_active: true,
      current_quantity: {
        [Op.gt]: 0 // Only return batches with available quantity
      }
    };
    
    let batchNumbers;
    try {
      batchNumbers = await ProductExpiryDate.findAll({
        where: whereClause,
        order: [['batch_number', 'ASC']],
        limit: 1000
      });
    } catch (queryError) {
      throw queryError;
    }

    // Format batch numbers for response
    const formattedBatchNumbers = batchNumbers.map(bn => {
      let expiryDate = null;
      if (bn.expiry_date) {
        if (bn.expiry_date instanceof Date) {
          expiryDate = bn.expiry_date.toISOString().split('T')[0];
        } else if (typeof bn.expiry_date === 'string') {
          expiryDate = bn.expiry_date.split('T')[0];
        } else {
          expiryDate = String(bn.expiry_date).split('T')[0];
        }
      }

      return {
        id: bn.id || bn.uuid,
        batch_number: bn.batch_number,
        product_id: bn.product_id,
        product_name: null, // Not loading product details to keep query simple
        product_code: null,
        store_id: bn.store_id,
        store_name: null, // Not loading store details to keep query simple
        current_quantity: parseFloat(bn.current_quantity || 0),
        expiry_date: expiryDate,
        status: bn.status || null,
        unit_cost: bn.unit_cost ? parseFloat(bn.unit_cost) : null,
        days_until_expiry: bn.days_until_expiry || null
      };
    });

    res.json({ 
      success: true,
      batchNumbers: formattedBatchNumbers
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch available batch numbers',
      message: error.message,
      name: error.name,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get batch number details by ID
router.get('/batch-numbers/:id', async (req, res) => {
  try {
    // Use models from index (same pattern as other routes)
    const { ProductExpiryDate, Product, Store } = require('../models');
    
    // CRITICAL: Use buildCompanyWhere to ensure multi-tenant isolation (same pattern as serial-numbers/:id)
    const batchNumber = await ProductExpiryDate.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name', 'code', 'expiry_notification_days'], required: false },
        { model: Store, as: 'store', attributes: ['id', 'name'], required: false }
      ]
    });

    if (!batchNumber) {
      return res.status(404).json({ error: 'Batch number not found' });
    }

    res.json({ 
      success: true,
      batchNumber: {
        id: batchNumber.id,
        batch_number: batchNumber.batch_number,
        product_id: batchNumber.product_id,
        product_name: batchNumber.product?.name,
        product_code: batchNumber.product?.code,
        store_id: batchNumber.store_id,
        store_name: batchNumber.store?.name,
        current_quantity: batchNumber.current_quantity,
        expiry_date: batchNumber.expiry_date ? batchNumber.expiry_date.toISOString().split('T')[0] : null,
        status: batchNumber.status,
        unit_cost: batchNumber.unit_cost,
        days_until_expiry: batchNumber.days_until_expiry,
        total_quantity_received: batchNumber.total_quantity_received,
        total_quantity_sold: batchNumber.total_quantity_sold,
        total_quantity_adjusted: batchNumber.total_quantity_adjusted,
        created_at: batchNumber.created_at
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch batch number details',
      message: error.message 
    });
  }
});

module.exports = router; 