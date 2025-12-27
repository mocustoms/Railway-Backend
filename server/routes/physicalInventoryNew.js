const express = require('express');
const router = express.Router();
const { 
  PhysicalInventory, 
  PhysicalInventoryItem, 
  Store, 
  AdjustmentReason, 
  Product, 
  User, 
  Currency,
  Account
} = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const PhysicalInventoryService = require('../services/physicalInventoryService');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Validation middleware
const validatePhysicalInventory = (req, res, next) => {
  const { store_id, inventory_date } = req.body;
  
  if (!store_id) {
    return res.status(400).json({
      success: false,
      message: 'Store ID is required'
    });
  }
  
  if (!inventory_date) {
    return res.status(400).json({
      success: false,
      message: 'Inventory date is required'
    });
  }
  
  next();
};

// Get all Physical Inventories with pagination and filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      store_id = '',
      start_date = '',
      end_date = '',
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      status,
      storeId: store_id,
      startDate: start_date,
      endDate: end_date,
      sortBy: sort_by,
      sortOrder: sort_order.toUpperCase()
    };

    const result = await PhysicalInventoryService.getPhysicalInventories(options);

    res.json({
      success: true,
      data: result.physicalInventories,
      pagination: result.pagination
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventories',
      error: error.message
    });
  }
});

// Get Physical Inventory by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.getPhysicalInventoryById(id);

    res.json({
      success: true,
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventory',
      error: error.message
    });
  }
});

// Create Physical Inventory as Draft
router.post('/draft', validatePhysicalInventory, csrfProtection, async (req, res) => {
  try {
    const physicalInventory = await PhysicalInventoryService.createDraft(req.body, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Physical inventory saved as draft successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create physical inventory draft',
      error: error.message
    });
  }
});

// Update Physical Inventory
router.put('/:id', validatePhysicalInventory, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.updatePhysicalInventory(id, req.body, req.user.id);

    res.json({
      success: true,
      message: 'Physical inventory updated successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update physical inventory',
      error: error.message
    });
  }
});

// Submit Physical Inventory for approval
router.patch('/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.submitPhysicalInventory(id, req.user.id);

    res.json({
      success: true,
      message: 'Physical inventory submitted for approval successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to submit physical inventory',
      error: error.message
    });
  }
});

// Approve Physical Inventory
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const physicalInventory = await PhysicalInventoryService.approvePhysicalInventory(id, req.user.id);

    res.json({
      success: true,
      message: 'Physical inventory approved successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to approve physical inventory',
      error: error.message
    });
  }
});

// Reject Physical Inventory
router.patch('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    
    if (!rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const physicalInventory = await PhysicalInventoryService.rejectPhysicalInventory(id, rejection_reason, req.user.id);

    res.json({
      success: true,
      message: 'Physical inventory rejected successfully',
      data: physicalInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to reject physical inventory',
      error: error.message
    });
  }
});

// Delete Physical Inventory
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await PhysicalInventoryService.deletePhysicalInventory(id);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete physical inventory',
      error: error.message
    });
  }
});

// Get Physical Inventory Statistics
router.get('/stats/overview', async (req, res) => {
  try {
    // Pass companyId to the service method
    const companyId = req.user.isSystemAdmin ? null : req.user.companyId;
    const stats = await PhysicalInventoryService.getPhysicalInventoryStats(companyId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventory statistics',
      error: error.message
    });
  }
});

// Get Physical Inventory Items by Physical Inventory ID
router.get('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    
    const items = await PhysicalInventoryItem.findAll({
      where: { physical_inventory_id: id },
      include: [
        { model: Product, as: 'product' },
        { model: AdjustmentReason, as: 'adjustmentInReason' },
        { model: AdjustmentReason, as: 'adjustmentOutReason' }
      ],
      order: [['created_at', 'ASC']]
    });

    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physical inventory items',
      error: error.message
    });
  }
});

// Add item to Physical Inventory
router.post('/:id/items', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const itemData = req.body;

    // Check if physical inventory exists and is in draft status
    const physicalInventory = await PhysicalInventory.findByPk(id);
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }

    if (physicalInventory.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Items can only be added to draft physical inventories'
      });
    }

    // Calculate item values
    const calculatedValues = PhysicalInventoryService.calculateItemValues(itemData);

    // Create the item
    const item = await PhysicalInventoryItem.create({
      physical_inventory_id: id,
      product_id: itemData.product_id,
      current_quantity: itemData.current_quantity || 0,
      counted_quantity: itemData.counted_quantity || 0,
      adjustment_in_quantity: calculatedValues.adjustment_in_quantity,
      adjustment_out_quantity: calculatedValues.adjustment_out_quantity,
      adjustment_in_reason_id: itemData.adjustment_in_reason_id,
      adjustment_out_reason_id: itemData.adjustment_out_reason_id,
      unit_cost: itemData.unit_cost || 0,
      unit_average_cost: itemData.unit_average_cost || 0,
      new_stock: calculatedValues.new_stock,
      total_value: calculatedValues.total_value,
      exchange_rate: itemData.exchange_rate || 1.0,
      equivalent_amount: calculatedValues.equivalent_amount,
      expiry_date: itemData.expiry_date,
      batch_number: itemData.batch_number,
      serial_numbers: itemData.serial_numbers || [],
      notes: itemData.notes
    });

    // Update physical inventory totals
    const totalItems = await PhysicalInventoryItem.count({ where: { physical_inventory_id: id } });
    const totalValue = await PhysicalInventoryItem.sum('total_value', { where: { physical_inventory_id: id } });

    await physicalInventory.update({
      total_items: totalItems,
      total_value: totalValue || 0
    });

    // Return the created item with relations
    const createdItem = await PhysicalInventoryItem.findByPk(item.id, {
      include: [
        { model: Product, as: 'product' },
        { model: AdjustmentReason, as: 'adjustmentInReason' },
        { model: AdjustmentReason, as: 'adjustmentOutReason' }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Item added to physical inventory successfully',
      data: createdItem
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add item to physical inventory',
      error: error.message
    });
  }
});

// Update Physical Inventory Item
router.put('/:id/items/:itemId', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const itemData = req.body;

    // Check if physical inventory exists and is in draft status
    const physicalInventory = await PhysicalInventory.findByPk(id);
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }

    if (physicalInventory.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Items can only be updated in draft physical inventories'
      });
    }

    // Find the item
    const item = await PhysicalInventoryItem.findOne({
      where: { 
        id: itemId,
        physical_inventory_id: id 
      }
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory item not found'
      });
    }

    // Calculate updated values
    const calculatedValues = PhysicalInventoryService.calculateItemValues(itemData);

    // Update the item
    await item.update({
      current_quantity: itemData.current_quantity || 0,
      counted_quantity: itemData.counted_quantity || 0,
      adjustment_in_quantity: calculatedValues.adjustment_in_quantity,
      adjustment_out_quantity: calculatedValues.adjustment_out_quantity,
      adjustment_in_reason_id: itemData.adjustment_in_reason_id,
      adjustment_out_reason_id: itemData.adjustment_out_reason_id,
      unit_cost: itemData.unit_cost || 0,
      unit_average_cost: itemData.unit_average_cost || 0,
      new_stock: calculatedValues.new_stock,
      total_value: calculatedValues.total_value,
      exchange_rate: itemData.exchange_rate || 1.0,
      equivalent_amount: calculatedValues.equivalent_amount,
      expiry_date: itemData.expiry_date,
      batch_number: itemData.batch_number,
      serial_numbers: itemData.serial_numbers || [],
      notes: itemData.notes
    });

    // Update physical inventory totals
    const totalValue = await PhysicalInventoryItem.sum('total_value', { where: { physical_inventory_id: id } });
    await physicalInventory.update({
      total_value: totalValue || 0
    });

    // Return the updated item with relations
    const updatedItem = await PhysicalInventoryItem.findByPk(itemId, {
      include: [
        { model: Product, as: 'product' },
        { model: AdjustmentReason, as: 'adjustmentInReason' },
        { model: AdjustmentReason, as: 'adjustmentOutReason' }
      ]
    });

    res.json({
      success: true,
      message: 'Physical inventory item updated successfully',
      data: updatedItem
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update physical inventory item',
      error: error.message
    });
  }
});

// Delete Physical Inventory Item
router.delete('/:id/items/:itemId', csrfProtection, csrfProtection, async (req, res) => {
  try {
    const { id, itemId } = req.params;

    // Check if physical inventory exists and is in draft status
    const physicalInventory = await PhysicalInventory.findByPk(id);
    if (!physicalInventory) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory not found'
      });
    }

    if (physicalInventory.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Items can only be deleted from draft physical inventories'
      });
    }

    // Find and delete the item
    const item = await PhysicalInventoryItem.findOne({
      where: { 
        id: itemId,
        physical_inventory_id: id 
      }
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Physical inventory item not found'
      });
    }

    await item.destroy();

    // Update physical inventory totals
    const totalItems = await PhysicalInventoryItem.count({ where: { physical_inventory_id: id } });
    const totalValue = await PhysicalInventoryItem.sum('total_value', { where: { physical_inventory_id: id } });

    await physicalInventory.update({
      total_items: totalItems,
      total_value: totalValue || 0
    });

    res.json({
      success: true,
      message: 'Physical inventory item deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete physical inventory item',
      error: error.message
    });
  }
});

module.exports = router;
