const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ProductStore = require('../models/productStore');
const Product = require('../models/product');
const Store = require('../models/store');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all product-store relationships
router.get('/', async (req, res) => {
    try {
        const productStores = await ProductStore.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            include: [
                { model: Product, as: 'productStore', attributes: ['id', 'name', 'code'] },
                { model: Store, as: 'productStoreStore', attributes: ['id', 'name', 'location'] }
            ]
        });
        
        res.json({
            success: true,
            productStores
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product stores',
            error: error.message
        });
    }
});

// Get stores for a specific product
router.get('/product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        
        const productStores = await ProductStore.findAll({
            where: buildCompanyWhere(req, { 
                product_id: productId,
                is_active: true 
            }),
            include: [
                { model: Store, as: 'productStoreStore', attributes: ['id', 'name', 'location'] }
            ]
        });
        
        const stores = productStores.map(ps => ps.productStoreStore);
        
        res.json({
            success: true,
            stores
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product stores',
            error: error.message
        });
    }
});

// Get products for a specific store
router.get('/store/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;
        
        const productStores = await ProductStore.findAll({
            where: buildCompanyWhere(req, { 
                store_id: storeId,
                is_active: true 
            }),
            include: [
                { model: Product, as: 'productStore', attributes: ['id', 'name', 'code'] }
            ]
        });
        
        const products = productStores.map(ps => ps.productStore);
        
        res.json({
            success: true,
            products
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch store products',
            error: error.message
        });
    }
});

// Create product-store relationship
router.post('/', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { product_id, store_id } = req.body;
        
        if (!product_id || !store_id) {
            return res.status(400).json({
                success: false,
                message: 'Product ID and Store ID are required'
            });
        }
        
        // Check if relationship already exists
        const existing = await ProductStore.findOne({
            where: buildCompanyWhere(req, { product_id, store_id })
        });
        
        if (existing) {
            if (existing.is_active) {
                return res.status(400).json({
                    success: false,
                    message: 'Product-store relationship already exists'
                });
            } else {
                // Reactivate existing relationship
                existing.is_active = true;
                existing.updated_by = req.user.id;
                await existing.save();
                
                return res.json({
                    success: true,
                    message: 'Product-store relationship reactivated',
                    productStore: existing
                });
            }
        }
        
        // Create new relationship
        const productStore = await ProductStore.create({
            product_id,
            store_id,
            companyId: req.user.companyId,
            created_by: req.user.id,
            updated_by: req.user.id
        });
        
        res.status(201).json({
            success: true,
            message: 'Product-store relationship created successfully',
            productStore
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to create product-store relationship',
            error: error.message
        });
    }
});

// Update product-store relationship
router.put('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        
        const productStore = await ProductStore.findOne({
            where: buildCompanyWhere(req, { id })
        });
        
        if (!productStore) {
            return res.status(404).json({
                success: false,
                message: 'Product-store relationship not found'
            });
        }
        
        productStore.is_active = is_active;
        productStore.updated_by = req.user.id;
        await productStore.save();
        
        res.json({
            success: true,
            message: 'Product-store relationship updated successfully',
            productStore
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update product-store relationship',
            error: error.message
        });
    }
});

// Delete product-store relationship (soft delete)
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { id } = req.params;
        
        const productStore = await ProductStore.findOne({
            where: buildCompanyWhere(req, { id })
        });
        
        if (!productStore) {
            return res.status(404).json({
                success: false,
                message: 'Product-store relationship not found'
            });
        }
        
        productStore.is_active = false;
        productStore.updated_by = req.user.id;
        await productStore.save();
        
        res.json({
            success: true,
            message: 'Product-store relationship deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete product-store relationship',
            error: error.message
        });
    }
});

// Bulk create/update product-store relationships
router.post('/bulk', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { product_id, store_ids } = req.body;
        
        if (!product_id || !Array.isArray(store_ids)) {
            return res.status(400).json({
                success: false,
                message: 'Product ID and array of Store IDs are required'
            });
        }
        
        // Deactivate all existing relationships for this product
        await ProductStore.update(
            { 
                is_active: false,
                updated_by: req.user.id 
            },
            { 
                where: { product_id } 
            }
        );
        
        // Create new relationships for selected stores
        const productStores = [];
        for (const store_id of store_ids) {
            const [productStore, created] = await ProductStore.findOrCreate({
                where: { product_id, store_id },
                defaults: {
                    created_by: req.user.id,
                    updated_by: req.user.id
                }
            });
            
            if (!created) {
                // Reactivate existing relationship
                productStore.is_active = true;
                productStore.updated_by = req.user.id;
                await productStore.save();
            }
            
            productStores.push(productStore);
        }
        
        res.json({
            success: true,
            message: 'Product-store relationships updated successfully',
            productStores
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update product-store relationships',
            error: error.message
        });
    }
});

module.exports = router;
