const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { Product, ProductStore, ProductCategory, ProductBrandName, ProductManufacturer, ProductModel, ProductColor, Store, UserStore } = require('../models');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Plain / route for robust matching
router.get('/', async (req, res) => {
    try {
        const {
            category, brand, manufacturer, model, color, type, store,
            belowMin, search
        } = req.query;

        // Build where clauses for product and productStore
        const productWhere = {};
        const storeWhere = {};
        // Exclude service products from stock balance reports (product_type = 'services')
        if (type && type !== 'services') {
            productWhere.product_type = type;
        } else {
            productWhere.product_type = { [Op.ne]: 'services' };
        }
        if (category) productWhere.category_id = category;
        if (brand) productWhere.brand_id = brand;
        if (manufacturer) productWhere.manufacturer_id = manufacturer;
        if (model) productWhere.model_id = model;
        if (color) productWhere.color_id = color;
        if (search) {
            productWhere[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { code: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        if (store) {
            storeWhere.store_id = store;
        } else {
            // ALL stores selected: restrict to stores user has access to
            const userStores = await UserStore.findAll({
                where: { user_id: req.user.id, is_active: true },
                attributes: ['store_id']
            });
            const accessibleStoreIds = userStores.map(us => us.store_id);
            storeWhere.store_id = accessibleStoreIds.length > 0 ? accessibleStoreIds : null; // If none, will return empty
        }

        // Join Product and ProductStore
        const results = await ProductStore.findAll({
            where: buildCompanyWhere(req, storeWhere),
            include: [
                {
                    model: Product,
                    as: 'product',
                    where: buildCompanyWhere(req, productWhere),
                    include: [
                        { model: ProductCategory, as: 'category', attributes: ['id', 'name'] },
                        { model: ProductBrandName, as: 'brand', attributes: ['id', 'name'] },
                        { model: ProductManufacturer, as: 'manufacturer', attributes: ['id', 'name'] },
                        { model: ProductModel, as: 'model', attributes: ['id', 'name'] },
                        { model: ProductColor, as: 'color', attributes: ['id', 'name'] }
                    ]
                },
                { model: Store, as: 'store', attributes: ['id', 'name'] }
            ]
        });

        // Filter below minimum if requested
        let filtered = results;
        if (belowMin === 'true') {
            filtered = results.filter(r => parseFloat(r.quantity) < parseFloat(r.min_quantity || 0));
        }

        // Format response
        const data = filtered.map(r => ({
            product_id: r.product_id,
            product_code: r.product?.code,
            product_name: r.product?.name,
            category: r.product?.category?.name,
            brand: r.product?.brand?.name,
            manufacturer: r.product?.manufacturer?.name,
            model: r.product?.model?.name,
            color: r.product?.color?.name,
            type: r.product?.product_type,
            store: r.store?.name,
            store_id: r.store_id,
            quantity: r.quantity,
            min_quantity: r.min_quantity,
            max_quantity: r.max_quantity,
            reorder_point: r.reorder_point,
            average_cost: r.average_cost,
            status: r.is_active ? 'Active' : 'Inactive'
        }));

        res.json({ data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stock balance' });
    }
});

// Regex route for robust matching
router.get(/^\/?$/, async (req, res) => {
    try {
        const {
            category, brand, manufacturer, model, color, type, store,
            belowMin, search
        } = req.query;
        const productWhere = {};
        const storeWhere = {};
        // Exclude service products from stock balance reports (product_type = 'services')
        if (type && type !== 'services') {
            productWhere.product_type = type;
        } else {
            productWhere.product_type = { [Op.ne]: 'services' };
        }
        if (category) productWhere.category_id = category;
        if (brand) productWhere.brand_id = brand;
        if (manufacturer) productWhere.manufacturer_id = manufacturer;
        if (model) productWhere.model_id = model;
        if (color) productWhere.color_id = color;
        if (search) {
            productWhere[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { code: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        if (store) {
            storeWhere.store_id = store;
        } else {
            // ALL stores selected: restrict to stores user has access to
            const userStores = await UserStore.findAll({
                where: { user_id: req.user.id, is_active: true },
                attributes: ['store_id']
            });
            const accessibleStoreIds = userStores.map(us => us.store_id);
            storeWhere.store_id = accessibleStoreIds.length > 0 ? accessibleStoreIds : null;
        }
        const results = await ProductStore.findAll({
            where: storeWhere,
            include: [
                {
                    model: Product,
                    as: 'product',
                    where: buildCompanyWhere(req, productWhere),
                    include: [
                        { model: ProductCategory, as: 'category', attributes: ['id', 'name'] },
                        { model: ProductBrandName, as: 'brand', attributes: ['id', 'name'] },
                        { model: ProductManufacturer, as: 'manufacturer', attributes: ['id', 'name'] },
                        { model: ProductModel, as: 'model', attributes: ['id', 'name'] },
                        { model: ProductColor, as: 'color', attributes: ['id', 'name'] }
                    ]
                },
                { model: Store, as: 'store', attributes: ['id', 'name'] }
            ]
        });
        let filtered = results;
        if (belowMin === 'true') {
            filtered = results.filter(r => parseFloat(r.quantity) < parseFloat(r.min_quantity || 0));
        }
        const data = filtered.map(r => ({
            product_id: r.product_id,
            product_code: r.product?.code,
            product_name: r.product?.name,
            category: r.product?.category?.name,
            brand: r.product?.brand?.name,
            manufacturer: r.product?.manufacturer?.name,
            model: r.product?.model?.name,
            color: r.product?.color?.name,
            type: r.product?.product_type,
            store: r.store?.name,
            store_id: r.store_id,
            quantity: r.quantity,
            min_quantity: r.min_quantity,
            max_quantity: r.max_quantity,
            reorder_point: r.reorder_point,
            average_cost: r.average_cost,
            status: r.is_active ? 'Active' : 'Inactive'
        }));
        res.json({ data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stock balance' });
    }
});

module.exports = router; 