const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const { Product, ProductManufacturingInfo, ProductRawMaterial } = require('../models');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get manufacturing info for a product
router.get('/info/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        
        const manufacturingInfo = await ProductManufacturingInfo.findOne({
            where: { product_id: productId },
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'code', 'product_type']
                }
            ]
        });
        
        res.json({
            success: true,
            data: manufacturingInfo
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch manufacturing info',
            error: error.message
        });
    }
});

// Create or update manufacturing info
router.post('/info', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { product_id, manufacturing_process, production_time_hours } = req.body;
        const userId = req.user.id;
        
        // Validate product exists and is manufactured type
        const product = await Product.findOne({
            where: buildCompanyWhere(req, { id: product_id })
        });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        if (product.product_type !== 'manufactured') {
            return res.status(400).json({
                success: false,
                message: 'Product must be of type "manufactured"'
            });
        }
        
        // Create or update manufacturing info
        const [manufacturingInfo, created] = await ProductManufacturingInfo.findOrCreate({
            where: { product_id },
            defaults: {
                manufacturing_process,
                production_time_hours,
                created_by: userId,
                updated_by: userId
            }
        });
        
        if (!created) {
            await manufacturingInfo.update({
                manufacturing_process,
                production_time_hours,
                updated_by: userId
            });
        }
        
        res.json({
            success: true,
            data: manufacturingInfo,
            message: created ? 'Manufacturing info created successfully' : 'Manufacturing info updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save manufacturing info',
            error: error.message
        });
    }
});

// Get raw materials for a manufactured product
router.get('/raw-materials/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        
        const rawMaterials = await ProductRawMaterial.findAll({
            where: buildCompanyWhere(req, { manufactured_product_id: productId }),
            include: [
                {
                    model: Product,
                    as: 'rawMaterial',
                    attributes: ['id', 'name', 'code', 'product_type', 'average_cost', 'selling_price']
                }
            ],
            order: [['created_at', 'ASC']]
        });
        
        res.json({
            success: true,
            data: rawMaterials
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch raw materials',
            error: error.message
        });
    }
});

// Add raw material to manufactured product
router.post('/raw-materials', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { manufactured_product_id, raw_material_id, quantity_per_unit, unit } = req.body;
        const userId = req.user.id;
        
        // Validate manufactured product exists and is manufactured type
        const manufacturedProduct = await Product.findOne({
            where: buildCompanyWhere(req, { id: manufactured_product_id })
        });
        if (!manufacturedProduct || manufacturedProduct.product_type !== 'manufactured') {
            return res.status(400).json({
                success: false,
                message: 'Manufactured product not found or invalid type'
            });
        }
        
        // Validate raw material exists and is raw_materials type
        const rawMaterial = await Product.findOne({
            where: buildCompanyWhere(req, { id: raw_material_id })
        });
        if (!rawMaterial || rawMaterial.product_type !== 'raw_materials') {
            return res.status(400).json({
                success: false,
                message: 'Raw material not found or invalid type'
            });
        }
        
        // Check if raw material is already added (with company filtering)
        const existingRawMaterial = await ProductRawMaterial.findOne({
            where: buildCompanyWhere(req, {
                manufactured_product_id,
                raw_material_id
            })
        });
        
        if (existingRawMaterial) {
            return res.status(400).json({
                success: false,
                message: 'Raw material already exists for this manufactured product'
            });
        }
        
        // Create raw material entry
        const productRawMaterial = await ProductRawMaterial.create({
            manufactured_product_id,
            raw_material_id,
            quantity_per_unit,
            unit,
            companyId: req.user.companyId, // Add companyId for multi-tenant isolation
            created_by: userId,
            updated_by: userId
        });
        
        // Fetch the created record with raw material details
        const createdRecord = await ProductRawMaterial.findByPk(productRawMaterial.id, {
            include: [
                {
                    model: Product,
                    as: 'rawMaterial',
                    attributes: ['id', 'name', 'code', 'product_type', 'average_cost', 'selling_price']
                }
            ]
        });
        
        res.json({
            success: true,
            data: createdRecord,
            message: 'Raw material added successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to add raw material',
            error: error.message
        });
    }
});

// Update raw material quantity
router.put('/raw-materials/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity_per_unit, unit } = req.body;
        const userId = req.user.id;
        
        const rawMaterial = await ProductRawMaterial.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!rawMaterial) {
            return res.status(404).json({
                success: false,
                message: 'Raw material entry not found'
            });
        }
        
        await rawMaterial.update({
            quantity_per_unit,
            unit,
            updated_by: userId
        });
        
        // Fetch updated record with raw material details
        const updatedRecord = await ProductRawMaterial.findByPk(id, {
            include: [
                {
                    model: Product,
                    as: 'rawMaterial',
                    attributes: ['id', 'name', 'code', 'product_type', 'average_cost', 'selling_price']
                }
            ]
        });
        
        res.json({
            success: true,
            data: updatedRecord,
            message: 'Raw material updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update raw material',
            error: error.message
        });
    }
});

// Remove raw material from manufactured product
router.delete('/raw-materials/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        
        const rawMaterial = await ProductRawMaterial.findOne({
            where: buildCompanyWhere(req, { id })
        });
        if (!rawMaterial) {
            return res.status(404).json({
                success: false,
                message: 'Raw material entry not found'
            });
        }
        
        await rawMaterial.destroy();
        
        res.json({
            success: true,
            message: 'Raw material removed successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to remove raw material',
            error: error.message
        });
    }
});

// Get available raw materials (products of type 'raw_materials')
router.get('/available-raw-materials', async (req, res) => {
    try {
        const rawMaterials = await Product.findAll({
            where: buildCompanyWhere(req, {
                product_type: 'raw_materials',
                is_active: true
            }),
            attributes: ['id', 'name', 'code', 'average_cost', 'selling_price', 'default_packaging_id', 'default_quantity'],
            include: [
                {
                    model: require('../models').Packaging,
                    as: 'defaultPackaging',
                    attributes: ['id', 'name', 'pieces'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });
        
        res.json({
            success: true,
            data: rawMaterials
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available raw materials',
            error: error.message
        });
    }
});

// Calculate raw materials needed for a given quantity
router.post('/calculate-requirements', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { manufactured_product_id, quantity } = req.body;
        
        if (!manufactured_product_id || !quantity || quantity <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID or quantity'
            });
        }
        
        const rawMaterials = await ProductRawMaterial.findAll({
            where: buildCompanyWhere(req, { manufactured_product_id }),
            include: [
                {
                    model: Product,
                    as: 'rawMaterial',
                    attributes: ['id', 'name', 'code', 'average_cost', 'selling_price']
                }
            ]
        });
        
        const requirements = rawMaterials.map(rm => ({
            raw_material_id: rm.raw_material_id,
            raw_material_name: rm.rawMaterial.name,
            raw_material_code: rm.rawMaterial.code,
            quantity_per_unit: parseFloat(rm.quantity_per_unit),
            unit: rm.unit,
            total_quantity_needed: parseFloat(rm.quantity_per_unit) * quantity,
            estimated_cost: rm.rawMaterial.average_cost ? 
                parseFloat(rm.rawMaterial.average_cost) * parseFloat(rm.quantity_per_unit) * quantity : 
                null
        }));
        
        const totalEstimatedCost = requirements.reduce((sum, req) => 
            sum + (req.estimated_cost || 0), 0
        );
        
        res.json({
            success: true,
            data: {
                manufactured_product_id,
                quantity,
                requirements,
                total_estimated_cost: totalEstimatedCost
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to calculate requirements',
            error: error.message
        });
    }
});

module.exports = router; 