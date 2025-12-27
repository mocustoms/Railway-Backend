const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Product, ProductCategory, ProductBrandName, ProductManufacturer, ProductModel, ProductStoreLocation, Packaging, TaxCode, Account, User, PriceCategory, ProductPriceCategory, Store, ProductStore, ProductColor, ProductRawMaterial } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const { sequelize } = require('../models');
const PriceHistoryService = require('../utils/priceHistoryService');
const autoCodeService = require('../utils/autoCodeService');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for file uploads - save directly to final location like other modules
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // __dirname is server/server/routes, so we need to go up two levels to reach server/uploads
        const uploadDir = path.join(__dirname, '../../uploads/products');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const fileExtension = path.extname(file.originalname);
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExtension}`;
        cb(null, fileName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Get all products with pagination, search, and sorting
router.get('/', async (req, res) => {
    try {
        // Validate user is authenticated
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ 
                error: 'Unauthorized', 
                details: 'User authentication required' 
            });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const status = req.query.status || 'all';
        const sortBy = req.query.sortBy || 'created_at';
        const sortOrder = req.query.sortOrder || 'desc';
        const offset = (page - 1) * limit;

        // Enhanced sorting logic for all columns
        let orderClause = [];
        
        // Only allow sorting by direct product fields, not joined table fields
        const directFields = [
            'id', 'name', 'part_number', 'code', 'barcode', 'product_type', 
            'description', 'average_cost', 'selling_price', 'is_active', 
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ];
        
        // Handle sorting by user fields (created_by, updated_by)
        if (sortBy === 'created_by') {
            orderClause = [[{ model: User, as: 'createdByUser' }, 'first_name', sortOrder.toUpperCase()]];
        } else if (sortBy === 'updated_by') {
            orderClause = [[{ model: User, as: 'updatedByUser' }, 'first_name', sortOrder.toUpperCase()]];
        } else if (directFields.includes(sortBy)) {
            orderClause = [[sortBy, sortOrder.toUpperCase()]];
        } else {
            // Default to created_at if trying to sort by joined field
            orderClause = [['created_at', 'desc']];
        }

        // Build where clause for search with company filter
        const whereClause = {};
        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { code: { [Op.iLike]: `%${search}%` } },
                { barcode: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        // Handle status filter
        if (status !== 'all') {
            const isActive = status === 'active';
            whereClause.is_active = isActive;
        }

        // Handle additional filters
        if (req.query.category_id) {
            whereClause.category_id = req.query.category_id;
        }
        if (req.query.brand_id) {
            whereClause.brand_id = req.query.brand_id;
        }
        if (req.query.manufacturer_id) {
            whereClause.manufacturer_id = req.query.manufacturer_id;
        }
        if (req.query.model_id) {
            whereClause.model_id = req.query.model_id;
        }
        if (req.query.color_id) {
            whereClause.color_id = req.query.color_id;
        }
        if (req.query.unit_id) {
            whereClause.unit_id = req.query.unit_id;
        }
        if (req.query.product_type) {
            whereClause.product_type = req.query.product_type;
        }

        // Handle boolean filters
        if (req.query.lowStock === 'true') {
            whereClause.min_quantity = { [Op.gt]: 0 };
        }
        if (req.query.expiring === 'true') {
            // Add logic for expiring products (within 30 days)
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            whereClause.expiry_notification_days = { [Op.lte]: 30 };
        }
        if (req.query.has_image === 'true') {
            whereClause.image = { [Op.ne]: null };
        }
        if (req.query.track_serial_number === 'true') {
            whereClause.track_serial_number = true;
        }
        if (req.query.price_tax_inclusive === 'true') {
            whereClause.price_tax_inclusive = true;
        }

        // Handle price range filters
        if (req.query.price_range_min || req.query.price_range_max) {
            whereClause.selling_price = {};
            if (req.query.price_range_min) {
                const minPrice = parseFloat(req.query.price_range_min);
                if (!isNaN(minPrice)) {
                    whereClause.selling_price[Op.gte] = minPrice;
                }
            }
            if (req.query.price_range_max) {
                const maxPrice = parseFloat(req.query.price_range_max);
                if (!isNaN(maxPrice)) {
                    whereClause.selling_price[Op.lte] = maxPrice;
                }
            }
        }

        // Handle cost range filters
        if (req.query.cost_range_min || req.query.cost_range_max) {
            whereClause.average_cost = {};
            if (req.query.cost_range_min) {
                const minCost = parseFloat(req.query.cost_range_min);
                if (!isNaN(minCost)) {
                    whereClause.average_cost[Op.gte] = minCost;
                }
            }
            if (req.query.cost_range_max) {
                const maxCost = parseFloat(req.query.cost_range_max);
                if (!isNaN(maxCost)) {
                    whereClause.average_cost[Op.lte] = maxCost;
                }
            }
        }

        // Handle stock range filters (this will be applied after the main query)
        let stockRangeFilter = null;
        if (req.query.stock_range_min || req.query.stock_range_max) {
            stockRangeFilter = {};
            if (req.query.stock_range_min) {
                stockRangeFilter.min = parseFloat(req.query.stock_range_min);
            }
            if (req.query.stock_range_max) {
                stockRangeFilter.max = parseFloat(req.query.stock_range_max);
            }
        }

        // Handle date range filters
        if (req.query.created_date_from || req.query.created_date_to) {
            whereClause.created_at = {};
            if (req.query.created_date_from) {
                whereClause.created_at[Op.gte] = new Date(req.query.created_date_from);
            }
            if (req.query.created_date_to) {
                whereClause.created_at[Op.lte] = new Date(req.query.created_date_to + ' 23:59:59');
            }
        }

        if (req.query.updated_date_from || req.query.updated_date_to) {
            whereClause.updated_at = {};
            if (req.query.updated_date_from) {
                whereClause.updated_at[Op.gte] = new Date(req.query.updated_date_from);
            }
            if (req.query.updated_date_to) {
                whereClause.updated_at[Op.lte] = new Date(req.query.updated_date_to + ' 23:59:59');
            }
        }

        // Build include array - only include fields that exist in database
        const includeArray = [
            {
                model: ProductCategory,
                as: 'category',
                attributes: ['id', 'name']
            },
            {
                model: ProductBrandName,
                as: 'brand',
                attributes: ['id', 'name']
            },
            {
                model: ProductManufacturer,
                as: 'manufacturer',
                attributes: ['id', 'name']
            },
            {
                model: ProductModel,
                as: 'model',
                attributes: ['id', 'name']
            },
            {
                model: ProductColor,
                as: 'color',
                attributes: ['id', 'name', 'hex_code']
            },
            {
                model: ProductStoreLocation,
                as: 'storeLocation',
                attributes: ['id', 'location_name']
            },
            {
                model: Packaging,
                as: 'unit',
                attributes: ['id', 'name']
            },
            {
                model: TaxCode,
                as: 'purchasesTax',
                attributes: ['id', 'name', 'rate']
            },
            {
                model: TaxCode,
                as: 'salesTax',
                attributes: ['id', 'name', 'rate']
            },
            {
                model: Account,
                as: 'incomeAccount',
                attributes: ['id', 'name', 'type']
            },
            {
                model: Account,
                as: 'cogsAccount',
                attributes: ['id', 'name', 'type']
            },
            {
                model: Account,
                as: 'assetAccount',
                attributes: ['id', 'name', 'type']
            },
            {
                model: Store,
                as: 'assignedStores',
                attributes: ['id', 'name', 'store_type', 'location'],
                through: { attributes: ['quantity', 'min_quantity', 'reorder_point'] }
            },
            {
                model: User,
                as: 'createdByUser',
                attributes: ['id', 'first_name', 'last_name', 'username'],
                required: false
            },
            {
                model: User,
                as: 'updatedByUser',
                attributes: ['id', 'first_name', 'last_name', 'username'],
                required: false
            }
        ];

        // Add company filter to where clause (must be done after all filters are set)
        let finalWhere;
        try {
            finalWhere = buildCompanyWhere(req, whereClause);
        } catch (whereError) {
            return res.status(400).json({ 
                error: 'Invalid request', 
                details: 'Failed to build query filter',
                message: whereError.message
            });
        }

        // Get total count (with error handling)
        let totalCount = 0;
        try {
            totalCount = await Product.count({ where: finalWhere });
        } catch (countError) {
            throw new Error(`Failed to count products: ${countError.message}`);
        }
        
        // Get products with pagination (with error handling)
        let products = [];
        try {
            products = await Product.findAll({
                where: finalWhere,
                attributes: [
                    'id', 'product_type', 'code', 'barcode', 'name', 'part_number', 
                    'image', 'description', 'category_id', 'brand_id', 'manufacturer_id', 
                    'model_id', 'color_id', 'store_location_id', 'unit_id', 
                    'cogs_account_id', 'income_account_id', 'asset_account_id',
                    'average_cost', 'selling_price', 'purchases_tax_id', 'sales_tax_id',
                    'default_packaging_id', 'default_quantity', 'price_tax_inclusive',
                    'expiry_notification_days', 'track_serial_number', 'is_active',
                    'min_quantity', 'max_quantity', 'reorder_point', 'created_at', 'updated_at',
                    'created_by', 'updated_by', 'companyId'
                ],
                include: includeArray,
                order: orderClause,
                limit: limit,
                offset: offset,
                distinct: true
            });
        } catch (findAllError) {
            throw new Error(`Failed to fetch products: ${findAllError.message}`);
        }

        // If search term exists, also search in joined tables and filter results
        let filteredProducts = products;
        if (search) {
            const searchLower = search.toLowerCase();
            filteredProducts = products.filter(product => {
                // Check main product fields
                const mainFieldsMatch = 
                    product.name?.toLowerCase().includes(searchLower) ||
                    product.code?.toLowerCase().includes(searchLower) ||
                    product.barcode?.toLowerCase().includes(searchLower) ||
                    product.description?.toLowerCase().includes(searchLower);
                
                // Check joined table fields
                const joinedFieldsMatch = 
                    product.category?.name?.toLowerCase().includes(searchLower) ||
                    product.brand?.name?.toLowerCase().includes(searchLower) ||
                    product.manufacturer?.name?.toLowerCase().includes(searchLower) ||
                    product.model?.name?.toLowerCase().includes(searchLower) ||
                    product.color?.name?.toLowerCase().includes(searchLower) ||
                    product.unit?.name?.toLowerCase().includes(searchLower);
                
                return mainFieldsMatch || joinedFieldsMatch;
            });
        }

        // Update pagination for filtered results
        const actualTotalItems = totalCount; // Use total count from database, not filtered results
        const actualTotalPages = Math.ceil(actualTotalItems / limit);
        
        // Calculate start and end indices for current page
        const startIndex = offset;
        const endIndex = Math.min(startIndex + limit, actualTotalItems);
        const paginatedProducts = filteredProducts; // No need to slice since we already have the right page

        // Transform products to include user names
        const transformedProducts = paginatedProducts.map(product => {
            const json = product.toJSON ? product.toJSON() : product;
            return {
                ...json,
                created_by_name: product.createdByUser ? 
                    `${product.createdByUser.first_name || ''} ${product.createdByUser.last_name || ''}`.trim() || 
                    product.createdByUser.username : null,
                updated_by_name: product.updatedByUser ? 
                    `${product.updatedByUser.first_name || ''} ${product.updatedByUser.last_name || ''}`.trim() || 
                    product.updatedByUser.username : null
            };
        });

        res.json({
            products: transformedProducts,
            pagination: {
                page: page,
                totalPages: actualTotalPages,
                totalItems: actualTotalItems,
                limit: limit,
                hasNextPage: page < actualTotalPages,
                hasPrevPage: page > 1,
                startIndex: startIndex,
                endIndex: endIndex
            }
        });

    } catch (error) {
        // Return appropriate status code based on error type
        const statusCode = error.name === 'SequelizeValidationError' || 
                          error.name === 'SequelizeDatabaseError' ? 400 : 500;
        
        res.status(statusCode).json({ 
            error: 'Failed to fetch products', 
            details: error.message,
            errorName: error.name,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

// Get product statistics
router.get('/stats', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const totalProducts = await Product.count({ where: baseWhere });
        const activeProducts = await Product.count({ where: { ...baseWhere, is_active: true } });
        const inactiveProducts = await Product.count({ where: { ...baseWhere, is_active: false } });
        
        // Count by product type (with company filter)
        const productTypeStats = await Product.findAll({
            where: baseWhere,
            attributes: [
                'product_type',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: ['product_type']
        });

        // Count by category (with company filter)
        const categoryStats = await Product.findAll({
            where: baseWhere,
            attributes: [
                [sequelize.col('category.name'), 'category_name'],
                [sequelize.fn('COUNT', sequelize.col('Product.id')), 'count']
            ],
            include: [{
                model: ProductCategory,
                as: 'category',
                attributes: [],
                where: buildCompanyWhere(req),
                required: false
            }],
            group: ['category.name']
        });

        res.json({
            totalProducts,
            activeProducts,
            inactiveProducts,
            productTypeStats,
            categoryStats
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product statistics', details: error.message });
    }
});

// Get next product code
router.get('/next-code', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = {
            code: {
                [Op.regexp]: '^[0-9]+$'
            },
            ...buildCompanyWhere(req)
        };
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const lastProduct = await Product.findOne({
            where: whereClause,
            order: [['code', 'DESC']]
        });

        let nextCode = '1';
        if (lastProduct && lastProduct.code) {
            const lastCodeNum = parseInt(lastProduct.code);
            nextCode = (lastCodeNum + 1).toString();
        }

        res.json({ nextCode });

    } catch (error) {
        res.status(500).json({ error: 'Failed to generate next code', details: error.message });
    }
});

// Get next barcode
router.get('/next-barcode', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = {
            barcode: {
                [Op.regexp]: '^[0-9]+$'
            },
            ...buildCompanyWhere(req)
        };
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const lastProduct = await Product.findOne({
            where: whereClause,
            order: [['barcode', 'DESC']]
        });

        let nextBarcode = '1000000000000';
        if (lastProduct && lastProduct.barcode) {
            const lastBarcodeNum = parseInt(lastProduct.barcode);
            nextBarcode = (lastBarcodeNum + 1).toString();
        }

        res.json({ nextBarcode });

    } catch (error) {
        res.status(500).json({ error: 'Failed to generate next barcode', details: error.message });
    }
});

// Get single product by ID
router.get('/:id', async (req, res) => {
    try {
        // Add company filter for single product lookup
        const productWhere = buildCompanyWhere(req, { id: req.params.id });
        const product = await Product.findOne({
            where: productWhere,
            attributes: [
                'id', 'product_type', 'code', 'barcode', 'name', 'part_number', 
                'image', 'description', 'category_id', 'brand_id', 'manufacturer_id', 
                'model_id', 'color_id', 'store_location_id', 'unit_id', 
                'cogs_account_id', 'income_account_id', 'asset_account_id',
                'average_cost', 'selling_price', 'purchases_tax_id', 'sales_tax_id',
                'default_packaging_id', 'default_quantity', 'price_tax_inclusive',
                'expiry_notification_days', 'track_serial_number', 'is_active',
                'min_quantity', 'max_quantity', 'reorder_point', 'created_at', 'updated_at'
            ],
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductBrandName,
                    as: 'brand',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductManufacturer,
                    as: 'manufacturer',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductModel,
                    as: 'model',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductColor,
                    as: 'color',
                    attributes: ['id', 'name', 'hex_code']
                },
                {
                    model: ProductStoreLocation,
                    as: 'storeLocation',
                    attributes: ['id', 'location_name']
                },
                {
                    model: Packaging,
                    as: 'unit',
                    attributes: ['id', 'name']
                },
                {
                    model: Packaging,
                    as: 'defaultPackaging',
                    attributes: ['id', 'name']
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate']
                },
                {
                    model: TaxCode,
                    as: 'salesTax',
                    attributes: ['id', 'name', 'rate']
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'name', 'type']
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'name', 'type']
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'name', 'type']
                },
                {
                    model: Store,
                    as: 'assignedStores',
                    attributes: ['id', 'name', 'store_type', 'location'],
                    through: { attributes: ['quantity', 'min_quantity', 'reorder_point'] }
                }
            ]
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Now fetch the related data separately to avoid association issues
        try {
            const [stores, priceCategories] = await Promise.all([
                ProductStore.findAll({
                    where: buildCompanyWhere(req, { product_id: req.params.id }),
                    include: [{
                        model: Store,
                        as: 'productStoreStore',
                        attributes: ['id', 'name', 'store_type', 'location']
                    }]
                }),
                ProductPriceCategory.findAll({
                    where: buildCompanyWhere(req, { product_id: req.params.id }),
                    include: [{
                        model: PriceCategory,
                        as: 'priceCategory',
                        attributes: ['id', 'name', 'code', 'price_change_type', 'percentage_change']
                    }]
                })
            ]);

            // Add the related data to the product object
            const productWithRelations = product.toJSON();
            productWithRelations.assignedStores = stores.map(ps => ps.productStoreStore);
            productWithRelations.priceCategories = priceCategories.map(pc => pc.priceCategory);

            res.json(productWithRelations);
        } catch (relationError) {
            // Return product without relations if there's an error
            res.json(product);
        }

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product', details: error.message });
    }
});

// Create new product
router.post('/', upload.single('image'), csrfProtection, async (req, res) => {
    // Start transaction for atomic code generation and product creation
    const transaction = await sequelize.transaction();
    let imagePath = null; // Declare outside try block for cleanup in catch
    
    try {
        const productData = req.body;
        
        // Parse JSON arrays that might be sent as strings
        // Handle both JSON (when no image) and FormData (when image) formats
        if (productData.store_ids) {
            if (typeof productData.store_ids === 'string') {
                try {
                    productData.store_ids = JSON.parse(productData.store_ids);
                } catch (e) {
                    productData.store_ids = []; // Reset to empty array on parse error
                }
            } else if (!Array.isArray(productData.store_ids)) {
                productData.store_ids = []; // Convert non-array to empty array
            }
        } else {
            productData.store_ids = [];
        }
        
        if (productData.price_category_ids) {
            if (typeof productData.price_category_ids === 'string') {
                try {
                    productData.price_category_ids = JSON.parse(productData.price_category_ids);
                } catch (e) {
                    productData.price_category_ids = []; // Reset to empty array on parse error
                }
            } else if (!Array.isArray(productData.price_category_ids)) {
                productData.price_category_ids = []; // Convert non-array to empty array
            }
        } else {
            productData.price_category_ids = [];
        }
        
        // Validate required fields
        if (!productData.name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Name is required' });
        }

        // Validate foreign keys belong to user's company (multi-tenant security)
        const foreignKeyValidations = [];
        
        if (productData.category_id) {
            foreignKeyValidations.push(
                ProductCategory.findOne({
                    where: buildCompanyWhere(req, { id: productData.category_id }),
                    attributes: ['id'],
                    transaction
                }).then(cat => ({ field: 'category_id', value: productData.category_id, exists: !!cat }))
            );
        }
        
        if (productData.brand_id) {
            foreignKeyValidations.push(
                ProductBrandName.findOne({
                    where: buildCompanyWhere(req, { id: productData.brand_id }),
                    attributes: ['id'],
                    transaction
                }).then(brand => ({ field: 'brand_id', value: productData.brand_id, exists: !!brand }))
            );
        }
        
        if (productData.manufacturer_id) {
            foreignKeyValidations.push(
                ProductManufacturer.findOne({
                    where: buildCompanyWhere(req, { id: productData.manufacturer_id }),
                    attributes: ['id'],
                    transaction
                }).then(man => ({ field: 'manufacturer_id', value: productData.manufacturer_id, exists: !!man }))
            );
        }
        
        if (productData.model_id) {
            foreignKeyValidations.push(
                ProductModel.findOne({
                    where: buildCompanyWhere(req, { id: productData.model_id }),
                    attributes: ['id'],
                    transaction
                }).then(mod => ({ field: 'model_id', value: productData.model_id, exists: !!mod }))
            );
        }
        
        if (productData.color_id) {
            foreignKeyValidations.push(
                ProductColor.findOne({
                    where: buildCompanyWhere(req, { id: productData.color_id }),
                    attributes: ['id'],
                    transaction
                }).then(col => ({ field: 'color_id', value: productData.color_id, exists: !!col }))
            );
        }
        
        if (productData.unit_id) {
            foreignKeyValidations.push(
                Packaging.findOne({
                    where: buildCompanyWhere(req, { id: productData.unit_id }),
                    attributes: ['id'],
                    transaction
                }).then(unit => ({ field: 'unit_id', value: productData.unit_id, exists: !!unit }))
            );
        }
        
        if (productData.store_location_id) {
            foreignKeyValidations.push(
                ProductStoreLocation.findOne({
                    where: buildCompanyWhere(req, { id: productData.store_location_id }),
                    attributes: ['id'],
                    transaction
                }).then(loc => ({ field: 'store_location_id', value: productData.store_location_id, exists: !!loc }))
            );
        }
        
        if (productData.purchases_tax_id) {
            foreignKeyValidations.push(
                TaxCode.findOne({
                    where: buildCompanyWhere(req, { id: productData.purchases_tax_id }),
                    attributes: ['id'],
                    transaction
                }).then(tax => ({ field: 'purchases_tax_id', value: productData.purchases_tax_id, exists: !!tax }))
            );
        }
        
        if (productData.sales_tax_id) {
            foreignKeyValidations.push(
                TaxCode.findOne({
                    where: buildCompanyWhere(req, { id: productData.sales_tax_id }),
                    attributes: ['id'],
                    transaction
                }).then(tax => ({ field: 'sales_tax_id', value: productData.sales_tax_id, exists: !!tax }))
            );
        }
        
        if (productData.cogs_account_id) {
            foreignKeyValidations.push(
                Account.findOne({
                    where: buildCompanyWhere(req, { id: productData.cogs_account_id }),
                    attributes: ['id'],
                    transaction
                }).then(acc => ({ field: 'cogs_account_id', value: productData.cogs_account_id, exists: !!acc }))
            );
        }
        
        if (productData.income_account_id) {
            foreignKeyValidations.push(
                Account.findOne({
                    where: buildCompanyWhere(req, { id: productData.income_account_id }),
                    attributes: ['id'],
                    transaction
                }).then(acc => ({ field: 'income_account_id', value: productData.income_account_id, exists: !!acc }))
            );
        }
        
        if (productData.asset_account_id) {
            foreignKeyValidations.push(
                Account.findOne({
                    where: buildCompanyWhere(req, { id: productData.asset_account_id }),
                    attributes: ['id'],
                    transaction
                }).then(acc => ({ field: 'asset_account_id', value: productData.asset_account_id, exists: !!acc }))
            );
        }
        
        if (productData.default_packaging_id) {
            foreignKeyValidations.push(
                Packaging.findOne({
                    where: buildCompanyWhere(req, { id: productData.default_packaging_id }),
                    attributes: ['id'],
                    transaction
                }).then(pkg => ({ field: 'default_packaging_id', value: productData.default_packaging_id, exists: !!pkg }))
            );
        }
        
        // Wait for all validations
        if (foreignKeyValidations.length > 0) {
            const validationResults = await Promise.all(foreignKeyValidations);
            const invalidFields = validationResults.filter(v => !v.exists);
            
            if (invalidFields.length > 0) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'Validation error',
                    details: 'One or more referenced records do not exist or do not belong to your company',
                    invalidFields: invalidFields.map(f => ({ field: f.field, value: f.value }))
                });
            }
        }

        // Auto-generate product code (always generate, don't accept from user)
        const productCode = await autoCodeService.generateNextCode(
            'products',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'PROD',
                fallbackFormat: '{PREFIX}-{YEAR}-{NUMBER}'
            }
        );

        // Auto-generate barcode if not provided
        let productBarcode = productData.barcode;
        if (!productBarcode || productBarcode.trim() === '') {
            // Try to generate barcode from AutoCode, fallback to simple increment
            try {
                productBarcode = await autoCodeService.generateNextCode(
                    'products_barcode',
                    req.user.companyId,
                    {
                        transaction,
                        fallbackPrefix: 'BAR',
                        fallbackFormat: '{NUMBER}'
                    }
                );
            } catch (barcodeError) {
                // Fallback: Generate simple numeric barcode
                const lastBarcode = await Product.findOne({
                    where: buildCompanyWhere(req, {
                        barcode: { [Op.regexp]: '^[0-9]+$' }
                    }),
                    order: [['barcode', 'DESC']],
                    attributes: ['barcode'],
                    transaction
                });
                
                if (lastBarcode && lastBarcode.barcode) {
                    const lastBarcodeNum = parseInt(lastBarcode.barcode);
                    productBarcode = (lastBarcodeNum + 1).toString();
                } else {
                    productBarcode = '1000000000000';
                }
            }
        }

        // Handle image upload if provided
        if (req.file) {
            // File is already saved to final location by multer.diskStorage
            // req.file.path contains the full path, req.file.filename contains just the filename
            const fileName = req.file.filename;
            imagePath = `uploads/products/${fileName}`;
            
            // Verify file exists and has content
            const finalPath = req.file.path;
            if (!fs.existsSync(finalPath)) {
                await transaction.rollback();
                return res.status(500).json({ error: 'Failed to save image file' });
            }
            
            const stats = fs.statSync(finalPath);
            if (stats.size === 0) {
                // Delete the empty file
                fs.unlinkSync(finalPath);
                await transaction.rollback();
                return res.status(400).json({ error: 'Uploaded file appears to be empty' });
            }
        }

        // Clean and prepare the data for database insertion
        const cleanProductData = {
            ...productData,
            // Set auto-generated codes
            code: productCode,
            barcode: productBarcode,
            // Add companyId for multi-tenant isolation
            companyId: req.user.companyId,
            // Add image path if image was uploaded
            image: imagePath,
            // Ensure numeric fields have proper values
            average_cost: productData.average_cost ? parseFloat(productData.average_cost) : null,
            selling_price: productData.selling_price ? parseFloat(productData.selling_price) : null,
            default_quantity: productData.default_quantity ? parseInt(productData.default_quantity) : null,
            expiry_notification_days: productData.expiry_notification_days ? parseInt(productData.expiry_notification_days) : null,
            production_time: productData.production_time ? parseFloat(productData.production_time) : null,
            min_quantity: productData.min_quantity ? parseFloat(productData.min_quantity) : 0,
            max_quantity: productData.max_quantity ? parseFloat(productData.max_quantity) : 0,
            reorder_point: productData.reorder_point ? parseFloat(productData.reorder_point) : 0,
            // Ensure boolean fields are properly set
            price_tax_inclusive: Boolean(productData.price_tax_inclusive),
            track_serial_number: Boolean(productData.track_serial_number),
            is_active: Boolean(productData.is_active),
            // Set created_by
            created_by: req.user.id
        };

        const product = await Product.create(cleanProductData, { transaction });
        // Track initial prices in price history for new products
        try {
            if (cleanProductData.average_cost || cleanProductData.selling_price) {
                // Get system default currency and current exchange rate
                const Currency = require('../models/currency');
                const ExchangeRate = require('../models/exchangeRate');
                const defaultCurrency = await Currency.findOne({
                    where: buildCompanyWhere(req, { is_default: true })
                });
                
                let exchangeRateId = null;
                let exchangeRate = 1.0;
                
                if (defaultCurrency) {
                    // Get the latest exchange rate for the default currency
                    const latestRate = await ExchangeRate.findOne({
                        where: buildCompanyWhere(req, {
                            from_currency_id: defaultCurrency.id,
                            to_currency_id: defaultCurrency.id,
                            is_active: true
                        }),
                        order: [['effective_date', 'DESC']]
                    });
                    if (latestRate) {
                        exchangeRateId = latestRate.id;
                    }
                }
                
                await PriceHistoryService.trackPriceChange({
                    entityType: 'product',
                    entityId: product.id,
                    entityCode: product.code,
                    entityName: product.name,
                    moduleName: 'Product Catalog',
                    oldAverageCost: null, // New product, no old cost
                    newAverageCost: cleanProductData.average_cost,
                    oldSellingPrice: null, // New product, no old price
                    newSellingPrice: cleanProductData.selling_price,
                    costingMethodCode: 'AVG', // Default to Average costing
                    priceChangeReasonCode: 'INITIAL', // Initial setup
                    currencyId: defaultCurrency ? defaultCurrency.id : null,
                    exchangeRate: exchangeRate,
                    exchangeRateId: exchangeRateId,
                    userId: req.user.id,
                    transactionDate: new Date(),
                    notes: 'Initial product creation via Product Catalog',
                    companyId: req.user.companyId
                });
            }
        } catch (priceHistoryError) {
            // Don't fail the entire creation if price history tracking fails
        }
        
        // Handle store assignments if provided
        if (productData.store_ids && Array.isArray(productData.store_ids) && productData.store_ids.length > 0) {
            // Verify all stores belong to user's company
            const storeWhere = buildCompanyWhere(req, { id: { [Op.in]: productData.store_ids } });
            const validStores = await Store.findAll({
                where: storeWhere,
                attributes: ['id'],
                transaction
            });
            const validStoreIds = validStores.map(s => s.id);
            
            // Validate: Check if all requested stores are valid
            const invalidStoreIds = productData.store_ids.filter(id => !validStoreIds.includes(id));
            if (invalidStoreIds.length > 0) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'Validation error',
                    details: 'One or more stores do not exist or do not belong to your company',
                    invalidStoreIds: invalidStoreIds
                });
            }
            
            // All stores are valid - create assignments
            const storeAssignments = validStoreIds.map(storeId => ({
                product_id: product.id,
                store_id: storeId,
                is_active: true,
                assigned_by: req.user.id,
                assigned_at: new Date(),
                companyId: req.user.companyId,
                quantity: 0,
                min_quantity: cleanProductData.min_quantity || 0,
                max_quantity: cleanProductData.max_quantity || 0,
                reorder_point: cleanProductData.reorder_point || 0,
                average_cost: cleanProductData.average_cost || 0
            }));
            
            try {
                // Check for existing records within the same company
                // Unique constraint is now on [product_id, store_id, companyId]
                const existingCheck = await ProductStore.findAll({
                    where: buildCompanyWhere(req, {
                        product_id: product.id,
                        store_id: { [Op.in]: validStoreIds }
                    }),
                    transaction,
                    attributes: ['id', 'product_id', 'store_id', 'companyId']
                });
                
                if (existingCheck.length > 0) {
                    // Filter out stores that already have assignments
                    const existingStoreIds = existingCheck.map(e => e.store_id);
                    const newStoreAssignments = storeAssignments.filter(sa => !existingStoreIds.includes(sa.store_id));
                    
                    if (newStoreAssignments.length === 0) {
                        storeAssignments = []; // Clear to skip creation
                    } else {
                        storeAssignments = newStoreAssignments; // Use filtered list
                    }
                }
                
                // Use individual creates with SAVEPOINT to handle errors
                const createdStores = [];
                for (const assignment of storeAssignments) {
                    // Create a savepoint for each insert
                    const savepointName = `sp_store_${assignment.store_id.substring(0, 8)}`;
                    await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
                    
                    try {
                        const created = await ProductStore.create(assignment, {
                            transaction,
                            returning: true
                        });
                        await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                        createdStores.push(created);
                    } catch (createError) {
                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                        if (createError.name === 'SequelizeUniqueConstraintError' || createError.original?.code === '23505') {
                            // Duplicate exists, skip
                        } else {
                            throw createError;
                        }
                    }
                }
            } catch (bulkCreateError) {
                throw bulkCreateError;
            }
        }
        
        // Handle price categories if provided
        if (productData.price_category_ids && Array.isArray(productData.price_category_ids) && productData.price_category_ids.length > 0) {
            // Fetch price category details to calculate prices (verify they belong to user's company)
            const priceCategoryWhere = buildCompanyWhere(req, { id: { [Op.in]: productData.price_category_ids } });
            const selectedPriceCategories = await PriceCategory.findAll({
                where: priceCategoryWhere,
                transaction
            });
            
            // Validate: Check if all requested price categories are valid
            const validPriceCategoryIds = selectedPriceCategories.map(cat => cat.id);
            const invalidPriceCategoryIds = productData.price_category_ids.filter(id => !validPriceCategoryIds.includes(id));
            if (invalidPriceCategoryIds.length > 0) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'Validation error',
                    details: 'One or more price categories do not exist or do not belong to your company',
                    invalidPriceCategoryIds: invalidPriceCategoryIds
                });
            }
            
            // Get base price for calculations
            const basePrice = parseFloat(cleanProductData.selling_price || cleanProductData.average_cost || 0);
            
            const priceCategoryAssignments = selectedPriceCategories.map((category) => {
                let calculatedPrice = basePrice;
                
                // Calculate price based on category settings using SELLING PRICE as base
                const percentage = parseFloat(category.percentage_change || 0);
                if (category.price_change_type === 'increase') {
                    calculatedPrice = basePrice * (1 + percentage / 100);
                } else {
                    calculatedPrice = basePrice * (1 - percentage / 100);
                }
                
                return {
                    product_id: product.id,
                    price_category_id: category.id,
                    created_by: req.user.id,
                    companyId: req.user.companyId,
                    calculated_price: calculatedPrice
                };
            });
            
            await ProductPriceCategory.bulkCreate(priceCategoryAssignments, { transaction });
        }
        
        // Commit transaction after all operations complete
        await transaction.commit();
        
        // Reload product to get all associations and ensure image is included
        // Note: We fetch after transaction commit to ensure all associations are available
        const createdProduct = await Product.findByPk(product.id, {
            attributes: [
                'id', 'product_type', 'code', 'barcode', 'name', 'part_number', 
                'image', 'description', 'category_id', 'brand_id', 'manufacturer_id', 
                'model_id', 'color_id', 'store_location_id', 'unit_id', 
                'cogs_account_id', 'income_account_id', 'asset_account_id',
                'average_cost', 'selling_price', 'purchases_tax_id', 'sales_tax_id',
                'default_packaging_id', 'default_quantity', 'price_tax_inclusive',
                'expiry_notification_days', 'track_serial_number', 'is_active',
                'min_quantity', 'max_quantity', 'reorder_point', 'created_at', 'updated_at',
                'companyId'
            ],
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductBrandName,
                    as: 'brand',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductManufacturer,
                    as: 'manufacturer',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductModel,
                    as: 'model',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductColor,
                    as: 'color',
                    attributes: ['id', 'name', 'hex_code']
                },
                {
                    model: ProductStoreLocation,
                    as: 'storeLocation',
                    attributes: ['id', 'location_name']
                },
                {
                    model: Packaging,
                    as: 'unit',
                    attributes: ['id', 'name', 'pieces']
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'name', 'code']
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'name', 'code']
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'name', 'code']
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate']
                },
                {
                    model: TaxCode,
                    as: 'salesTax',
                    attributes: ['id', 'name', 'rate']
                },
                {
                    model: Store,
                    as: 'assignedStores',
                    attributes: ['id', 'name', 'store_type', 'location'],
                    through: {
                        attributes: ['quantity', 'min_quantity', 'reorder_point'],
                        where: {
                            is_active: true,
                            companyId: req.user.companyId
                        },
                        required: false
                    },
                    required: false
                },
                {
                    model: PriceCategory,
                    as: 'priceCategories',
                    attributes: ['id', 'name', 'code'],
                    through: {
                        attributes: ['calculated_price']
                    }
                }
            ]
        });
        
        // Explicitly reload the associations to ensure they're fresh after transaction
        if (createdProduct) {
            await createdProduct.reload({
                include: [
                    {
                        model: Store,
                        as: 'assignedStores',
                        attributes: ['id', 'name', 'store_type', 'location'],
                        through: { 
                            attributes: ['quantity', 'min_quantity', 'reorder_point'],
                            where: buildCompanyWhere(req, {
                                is_active: true
                            }),
                            required: false
                        },
                        required: false
                    },
                    {
                        model: PriceCategory,
                        as: 'priceCategories',
                        attributes: ['id', 'name', 'code', 'price_change_type', 'percentage_change'],
                        through: { attributes: ['calculated_price'] },
                        required: false
                    }
                ]
            });
        }
        
        res.status(201).json(createdProduct);

    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        // Clean up uploaded file if transaction fails
        if (imagePath && req.file) {
            try {
                const finalPath = req.file.path; // File is already in final location
                if (fs.existsSync(finalPath)) {
                    fs.unlinkSync(finalPath);
                }
            } catch (cleanupError) {
                // Error cleaning up image file - ignore
            }
        }
        
        res.status(500).json({ error: 'Failed to create product', details: error.message });
    }
});

// Update product
router.put('/:id', upload.single('image'), csrfProtection, async (req, res) => {
    // Start transaction for atomic updates
    const transaction = await sequelize.transaction();
    
    try {
        // Find product with company filter to ensure multi-tenant isolation
        const productWhere = buildCompanyWhere(req, { id: req.params.id });
        const product = await Product.findOne({ where: productWhere, transaction });
        
        if (!product) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Product not found' });
        }

        const productData = req.body;
        
        // Parse JSON arrays that might be sent as strings
        // Handle both JSON (when no image) and FormData (when image) formats
        if (productData.store_ids) {
            if (typeof productData.store_ids === 'string') {
                try {
                    productData.store_ids = JSON.parse(productData.store_ids);
                } catch (e) {
                    productData.store_ids = []; // Reset to empty array on parse error
                }
            } else if (!Array.isArray(productData.store_ids)) {
                productData.store_ids = []; // Convert non-array to empty array
            }
        } else {
            productData.store_ids = [];
        }
        
        if (productData.price_category_ids) {
            if (typeof productData.price_category_ids === 'string') {
                try {
                    productData.price_category_ids = JSON.parse(productData.price_category_ids);
                } catch (e) {
                    productData.price_category_ids = []; // Reset to empty array on parse error
                }
            } else if (!Array.isArray(productData.price_category_ids)) {
                productData.price_category_ids = []; // Convert non-array to empty array
            }
        } else {
            productData.price_category_ids = [];
        }
        
        // Handle image upload if provided
        // Only process if req.file exists AND has a valid filename (not empty/undefined)
        if (req.file && req.file.filename && req.file.filename.trim() !== '') {
            // File is already saved to final location by multer.diskStorage
            // req.file.path contains the full path, req.file.filename contains just the filename
            const fileName = req.file.filename;
            const finalPath = req.file.path;
            
            // Verify file exists and has content
            if (!fs.existsSync(finalPath)) {
                return res.status(500).json({ error: 'Failed to save image file' });
            }
            
            const stats = fs.statSync(finalPath);
            if (stats.size === 0) {
                // Delete the empty file
                fs.unlinkSync(finalPath);
                return res.status(400).json({ error: 'Uploaded file appears to be empty' });
            }
            
            // Store relative path in database
            productData.image = `uploads/products/${fileName}`;
            
            // Delete old image if it exists (only when actually uploading a new image)
            if (product.image && product.image.trim() !== '') {
                // Construct the correct path to the old image file
                // product.image is stored as 'uploads/products/filename.jpg'
                // We need to resolve it relative to the server root (where uploads folder is)
                const oldImagePath = path.join(__dirname, '../../', product.image);
                if (fs.existsSync(oldImagePath)) {
                    try {
                        fs.unlinkSync(oldImagePath);
                    } catch (deleteError) {
                        // Don't fail the update if old image deletion fails
                    }
                }
            }
        } else if (productData.existingImagePath) {
            // No new image uploaded, preserve existing image path from frontend
            productData.image = productData.existingImagePath;
            // Remove the temporary field from data before saving
            delete productData.existingImagePath;
        } else {
            // No new image uploaded and no existingImagePath provided - preserve current image from database
            // Don't include image in productData to prevent overwriting with undefined/null
            delete productData.image;
        }
        
        // Handle code: Only validate and update if it's actually changing
        // Since this is multi-tenant, code uniqueness is per company (enforced by composite unique index)
        if (productData.code !== undefined) {
            if (productData.code === product.code) {
                // Code is not changing - remove from update to avoid unnecessary constraint check
                delete productData.code;
            } else {
                // Code is changing - check if it exists for another product in the same company
                const existingProductWhere = buildCompanyWhere(req, { 
                    code: productData.code,
                    id: { [Op.ne]: req.params.id } // Exclude current product
                });
                const existingProduct = await Product.findOne({
                    where: existingProductWhere
                });

                if (existingProduct) {
                    return res.status(400).json({ 
                        error: 'Validation error',
                        details: 'Product code already exists in your company',
                        field: 'code',
                        value: productData.code
                    });
                }
                // Code is valid and changing - keep it in productData for update
            }
        }

        // Handle barcode: Only validate and update if it's actually changing
        // Since this is multi-tenant, barcode uniqueness is per company (enforced by composite unique index)
        // Note: barcode can be null/empty, so handle that case
        if (productData.barcode !== undefined) {
            const currentBarcode = product.barcode || '';
            const newBarcode = productData.barcode || '';
            
            if (newBarcode === currentBarcode) {
                // Barcode is not changing - remove from update to avoid unnecessary constraint check
                delete productData.barcode;
            } else if (newBarcode.trim() !== '') {
                // Barcode is changing to a non-empty value - check if it exists for another product in the same company
                const existingProductWhere = buildCompanyWhere(req, { 
                    barcode: productData.barcode,
                    id: { [Op.ne]: req.params.id } // Exclude current product
                });
                const existingProduct = await Product.findOne({
                    where: existingProductWhere
                });

                if (existingProduct) {
                    return res.status(400).json({ 
                        error: 'Validation error',
                        details: 'Product barcode already exists in your company',
                        field: 'barcode',
                        value: productData.barcode
                    });
                }
                // Barcode is valid and changing - keep it in productData for update
            } else {
                // Barcode is being set to empty/null - this is allowed, keep it for update
                productData.barcode = null;
            }
        }

        // Store old values for price history tracking (before update)
        const oldAverageCost = product.average_cost ? parseFloat(product.average_cost) : null;
        const oldSellingPrice = product.selling_price ? parseFloat(product.selling_price) : null;
        
        // Parse and normalize numeric values before update
        if (productData.average_cost !== undefined && productData.average_cost !== null) {
            productData.average_cost = parseFloat(productData.average_cost);
            if (isNaN(productData.average_cost)) {
                productData.average_cost = null;
            }
        }
        
        if (productData.selling_price !== undefined && productData.selling_price !== null) {
            productData.selling_price = parseFloat(productData.selling_price);
            if (isNaN(productData.selling_price)) {
                productData.selling_price = null;
            }
        }
        
        // Parse new values for price history tracking
        const newAverageCost = productData.average_cost !== undefined && productData.average_cost !== null 
            ? productData.average_cost 
            : oldAverageCost;
        const newSellingPrice = productData.selling_price !== undefined && productData.selling_price !== null 
            ? productData.selling_price 
            : oldSellingPrice;
        
        // Validate foreign keys belong to user's company (multi-tenant security)
        const foreignKeyValidations = [];
        
        if (productData.category_id !== undefined && productData.category_id !== null) {
            foreignKeyValidations.push(
                ProductCategory.findOne({
                    where: buildCompanyWhere(req, { id: productData.category_id }),
                    attributes: ['id'],
                    transaction
                }).then(cat => ({ field: 'category_id', value: productData.category_id, exists: !!cat }))
            );
        }
        
        if (productData.brand_id !== undefined && productData.brand_id !== null) {
            foreignKeyValidations.push(
                ProductBrandName.findOne({
                    where: buildCompanyWhere(req, { id: productData.brand_id }),
                    attributes: ['id'],
                    transaction
                }).then(brand => ({ field: 'brand_id', value: productData.brand_id, exists: !!brand }))
            );
        }
        
        if (productData.manufacturer_id !== undefined && productData.manufacturer_id !== null) {
            foreignKeyValidations.push(
                ProductManufacturer.findOne({
                    where: buildCompanyWhere(req, { id: productData.manufacturer_id }),
                    attributes: ['id'],
                    transaction
                }).then(man => ({ field: 'manufacturer_id', value: productData.manufacturer_id, exists: !!man }))
            );
        }
        
        if (productData.model_id !== undefined && productData.model_id !== null) {
            foreignKeyValidations.push(
                ProductModel.findOne({
                    where: buildCompanyWhere(req, { id: productData.model_id }),
                    attributes: ['id'],
                    transaction
                }).then(mod => ({ field: 'model_id', value: productData.model_id, exists: !!mod }))
            );
        }
        
        if (productData.color_id !== undefined && productData.color_id !== null) {
            foreignKeyValidations.push(
                ProductColor.findOne({
                    where: buildCompanyWhere(req, { id: productData.color_id }),
                    attributes: ['id'],
                    transaction
                }).then(col => ({ field: 'color_id', value: productData.color_id, exists: !!col }))
            );
        }
        
        if (productData.unit_id !== undefined && productData.unit_id !== null) {
            foreignKeyValidations.push(
                Packaging.findOne({
                    where: buildCompanyWhere(req, { id: productData.unit_id }),
                    attributes: ['id'],
                    transaction
                }).then(unit => ({ field: 'unit_id', value: productData.unit_id, exists: !!unit }))
            );
        }
        
        if (productData.store_location_id !== undefined && productData.store_location_id !== null) {
            foreignKeyValidations.push(
                ProductStoreLocation.findOne({
                    where: buildCompanyWhere(req, { id: productData.store_location_id }),
                    attributes: ['id'],
                    transaction
                }).then(loc => ({ field: 'store_location_id', value: productData.store_location_id, exists: !!loc }))
            );
        }
        
        if (productData.purchases_tax_id !== undefined && productData.purchases_tax_id !== null) {
            foreignKeyValidations.push(
                TaxCode.findOne({
                    where: buildCompanyWhere(req, { id: productData.purchases_tax_id }),
                    attributes: ['id'],
                    transaction
                }).then(tax => ({ field: 'purchases_tax_id', value: productData.purchases_tax_id, exists: !!tax }))
            );
        }
        
        if (productData.sales_tax_id !== undefined && productData.sales_tax_id !== null) {
            foreignKeyValidations.push(
                TaxCode.findOne({
                    where: buildCompanyWhere(req, { id: productData.sales_tax_id }),
                    attributes: ['id'],
                    transaction
                }).then(tax => ({ field: 'sales_tax_id', value: productData.sales_tax_id, exists: !!tax }))
            );
        }
        
        if (productData.cogs_account_id !== undefined && productData.cogs_account_id !== null) {
            foreignKeyValidations.push(
                Account.findOne({
                    where: buildCompanyWhere(req, { id: productData.cogs_account_id }),
                    attributes: ['id'],
                    transaction
                }).then(acc => ({ field: 'cogs_account_id', value: productData.cogs_account_id, exists: !!acc }))
            );
        }
        
        if (productData.income_account_id !== undefined && productData.income_account_id !== null) {
            foreignKeyValidations.push(
                Account.findOne({
                    where: buildCompanyWhere(req, { id: productData.income_account_id }),
                    attributes: ['id'],
                    transaction
                }).then(acc => ({ field: 'income_account_id', value: productData.income_account_id, exists: !!acc }))
            );
        }
        
        if (productData.asset_account_id !== undefined && productData.asset_account_id !== null) {
            foreignKeyValidations.push(
                Account.findOne({
                    where: buildCompanyWhere(req, { id: productData.asset_account_id }),
                    attributes: ['id'],
                    transaction
                }).then(acc => ({ field: 'asset_account_id', value: productData.asset_account_id, exists: !!acc }))
            );
        }
        
        if (productData.default_packaging_id !== undefined && productData.default_packaging_id !== null) {
            foreignKeyValidations.push(
                Packaging.findOne({
                    where: buildCompanyWhere(req, { id: productData.default_packaging_id }),
                    attributes: ['id'],
                    transaction
                }).then(pkg => ({ field: 'default_packaging_id', value: productData.default_packaging_id, exists: !!pkg }))
            );
        }
        
        // Wait for all validations
        const validationResults = await Promise.all(foreignKeyValidations);
        const invalidFields = validationResults.filter(v => !v.exists);
        
        if (invalidFields.length > 0) {
            await transaction.rollback();
            return res.status(400).json({
                error: 'Validation error',
                details: 'One or more referenced records do not exist or do not belong to your company',
                invalidFields: invalidFields.map(f => ({ field: f.field, value: f.value }))
            });
        }
        
        await product.update(productData, { transaction });
        
        // Reload product to get updated values
        await product.reload({ transaction });
        
        // Track price changes in price history
        try {
            // Use the reloaded product values for accurate comparison
            const updatedAverageCost = product.average_cost ? parseFloat(product.average_cost) : null;
            const updatedSellingPrice = product.selling_price ? parseFloat(product.selling_price) : null;
            
            // Compare with proper numeric comparison (handle null/undefined cases)
            const hasCostChange = (oldAverageCost !== updatedAverageCost) && 
                                 (oldAverageCost !== null || updatedAverageCost !== null) &&
                                 (oldAverageCost !== undefined || updatedAverageCost !== undefined);
            const hasPriceChange = (oldSellingPrice !== updatedSellingPrice) && 
                                  (oldSellingPrice !== null || updatedSellingPrice !== null) &&
                                  (oldSellingPrice !== undefined || updatedSellingPrice !== undefined);
            
            if (hasCostChange || hasPriceChange) {
                // Get system default currency and current exchange rate
                const Currency = require('../models/currency');
                const ExchangeRate = require('../models/exchangeRate');
                const defaultCurrency = await Currency.findOne({
                    where: buildCompanyWhere(req, { is_default: true })
                });
                
                let exchangeRateId = null;
                let exchangeRate = 1.0;
                
                // If a currency is provided in the request, get its exchange rate
                const requestCurrencyId = productData.currency_id || productData.currencyId;
                if (requestCurrencyId && defaultCurrency && requestCurrencyId !== defaultCurrency.id) {
                    const latestRate = await ExchangeRate.findOne({
                        where: buildCompanyWhere(req, {
                            from_currency_id: requestCurrencyId,
                            to_currency_id: defaultCurrency.id,
                            is_active: true
                        }),
                        order: [['effective_date', 'DESC']]
                    });
                    if (latestRate) {
                        exchangeRateId = latestRate.id;
                        exchangeRate = parseFloat(latestRate.rate);
                    }
                } else if (defaultCurrency) {
                    // Use system default currency (rate is 1.0)
                    // Still try to get the latest exchange rate record for the default currency
                    const latestRate = await ExchangeRate.findOne({
                        where: buildCompanyWhere(req, {
                            from_currency_id: defaultCurrency.id,
                            to_currency_id: defaultCurrency.id,
                            is_active: true
                        }),
                        order: [['effective_date', 'DESC']]
                    });
                    if (latestRate) {
                        exchangeRateId = latestRate.id;
                    }
                }
                
                const priceHistory = await PriceHistoryService.trackPriceChange({
                    entityType: 'product',
                    entityId: req.params.id,
                    entityCode: product.code,
                    entityName: product.name,
                    moduleName: 'Product Catalog',
                    oldAverageCost: oldAverageCost,
                    newAverageCost: updatedAverageCost,
                    oldSellingPrice: oldSellingPrice,
                    newSellingPrice: updatedSellingPrice,
                    costingMethodCode: 'AVG', // Default to Average costing
                    priceChangeReasonCode: 'ADJUSTMENT', // Default reason for manual edits
                    currencyId: requestCurrencyId || (defaultCurrency ? defaultCurrency.id : null),
                    exchangeRate: exchangeRate,
                    exchangeRateId: exchangeRateId,
                    userId: req.user.id,
                    transactionDate: new Date(),
                    notes: 'Product updated via Product Catalog',
                    companyId: req.user.companyId // Add companyId for multi-tenant isolation
                });
            }
        } catch (priceHistoryError) {
            // Don't fail the entire update if price history tracking fails
        }
        
        // Handle store assignments if provided
        try {
            if (productData.store_ids !== undefined) {
                // Get existing store assignments for this product (within company)
                const existingAssignmentsWhere = buildCompanyWhere(req, { product_id: req.params.id });
                const existingAssignments = await ProductStore.findAll({
                    where: existingAssignmentsWhere,
                    attributes: ['store_id'],
                    transaction
                });
                const existingStoreIds = existingAssignments.map(a => a.store_id);
                
                // Verify all new stores belong to user's company
                let newStoreIds = [];
                if (Array.isArray(productData.store_ids) && productData.store_ids.length > 0) {
                    const storeWhere = buildCompanyWhere(req, { id: { [Op.in]: productData.store_ids } });
                    const validStores = await Store.findAll({
                        where: storeWhere,
                        attributes: ['id'],
                        transaction
                    });
                    newStoreIds = validStores.map(s => s.id);
                    
                    // Validate: Check if all requested stores are valid
                    const invalidStoreIds = productData.store_ids.filter(id => !newStoreIds.includes(id));
                    if (invalidStoreIds.length > 0) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: 'Validation error',
                            details: 'One or more stores do not exist or do not belong to your company',
                            invalidStoreIds: invalidStoreIds
                        });
                    }
                }
                
                // Find stores to add (in new list but not in existing)
                const storesToAdd = newStoreIds.filter(storeId => !existingStoreIds.includes(storeId));
                
                // Find stores to remove (in existing but not in new list)
                const storesToRemove = existingStoreIds.filter(storeId => !newStoreIds.includes(storeId));
                
                // Remove store assignments that are no longer needed
                if (storesToRemove.length > 0) {
                    await ProductStore.destroy({
                        where: buildCompanyWhere(req, {
                            product_id: req.params.id,
                            store_id: { [Op.in]: storesToRemove }
                        }),
                        transaction
                    });
                }
                
                // Add new store assignments (only for stores that don't already exist)
                if (storesToAdd.length > 0) {
                    // Get current product values for defaults
                    const currentProduct = await Product.findByPk(req.params.id, { transaction });
                    const storeAssignments = storesToAdd.map(storeId => ({
                        product_id: req.params.id,
                        store_id: storeId,
                        is_active: true,
                        assigned_by: req.user.id,
                        assigned_at: new Date(),
                        companyId: req.user.companyId,
                        quantity: 0,
                        min_quantity: productData.min_quantity !== undefined ? parseFloat(productData.min_quantity) : (currentProduct?.min_quantity || 0),
                        max_quantity: productData.max_quantity !== undefined ? parseFloat(productData.max_quantity) : (currentProduct?.max_quantity || 0),
                        reorder_point: productData.reorder_point !== undefined ? parseFloat(productData.reorder_point) : (currentProduct?.reorder_point || 0),
                        average_cost: productData.average_cost !== undefined ? parseFloat(productData.average_cost) : (currentProduct?.average_cost || 0)
                    }));
                    
                    try {
                        // Check for existing records within the same company
                        // Unique constraint is now on [product_id, store_id, companyId]
                        const existingCheck = await ProductStore.findAll({
                            where: buildCompanyWhere(req, {
                                product_id: req.params.id,
                                store_id: { [Op.in]: storesToAdd }
                            }),
                            transaction,
                            attributes: ['id', 'product_id', 'store_id', 'companyId']
                        });
                        
                        if (existingCheck.length > 0) {
                            // Filter out stores that already have assignments
                            const existingStoreIds = existingCheck.map(e => e.store_id);
                            const newStoresToAdd = storesToAdd.filter(storeId => !existingStoreIds.includes(storeId));
                            
                            if (newStoresToAdd.length > 0) {
                                // Update storeAssignments to only include new stores
                                const newStoreAssignments = storeAssignments.filter(sa => newStoresToAdd.includes(sa.store_id));
                                
                                // Use individual creates with SAVEPOINT to handle errors
                                for (const assignment of newStoreAssignments) {
                                    // Create a savepoint for each insert
                                    const savepointName = `sp_store_${assignment.store_id.substring(0, 8)}`;
                                    await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
                                    
                                    try {
                                        await ProductStore.create(assignment, {
                                            transaction,
                                            returning: true
                                        });
                                        await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                    } catch (createError) {
                                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                        if (createError.name === 'SequelizeUniqueConstraintError' || createError.original?.code === '23505') {
                                            // Duplicate exists, skip
                                        } else {
                                            throw createError;
                                        }
                                    }
                                }
                            }
                        } else {
                            // No existing records, create all
                            // Use individual creates with SAVEPOINT to handle errors
                            for (const assignment of storeAssignments) {
                                // Create a savepoint for each insert
                                const savepointName = `sp_store_${assignment.store_id.substring(0, 8)}`;
                                await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
                                
                                try {
                                    await ProductStore.create(assignment, {
                                        transaction,
                                        returning: true
                                    });
                                    await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                } catch (createError) {
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    if (createError.name === 'SequelizeUniqueConstraintError' || createError.original?.code === '23505') {
                                        // Duplicate exists, skip
                                    } else {
                                        throw createError;
                                    }
                                }
                            }
                        }
                    } catch (bulkCreateError) {
                        throw bulkCreateError;
                    }
                }
            }
        } catch (storeError) {
            await transaction.rollback();
            throw storeError; // Re-throw to be caught by outer catch
        }
        
        // Handle price categories if provided
        try {
            if (productData.price_category_ids !== undefined) {
                // Remove all existing price category assignments (with company filter)
                await ProductPriceCategory.destroy({
                    where: buildCompanyWhere(req, { product_id: req.params.id }),
                    transaction
                });
                
                // Add new price category assignments if any
                if (Array.isArray(productData.price_category_ids) && productData.price_category_ids.length > 0) {
                    // Fetch price category details to calculate prices (verify they belong to user's company)
                    const priceCategoryWhere = buildCompanyWhere(req, { id: { [Op.in]: productData.price_category_ids } });
                    const selectedPriceCategories = await PriceCategory.findAll({
                        where: priceCategoryWhere,
                        transaction
                    });
                    
                    // Validate: Check if all requested price categories are valid
                    const validPriceCategoryIds = selectedPriceCategories.map(cat => cat.id);
                    const invalidPriceCategoryIds = productData.price_category_ids.filter(id => !validPriceCategoryIds.includes(id));
                    if (invalidPriceCategoryIds.length > 0) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: 'Validation error',
                            details: 'One or more price categories do not exist or do not belong to your company',
                            invalidPriceCategoryIds: invalidPriceCategoryIds
                        });
                    }
                    
                    // Use UPDATED product price (after reload) for calculations, not old price
                    // This ensures price categories use the new price if it was changed
                    const updatedProduct = await Product.findByPk(req.params.id, { transaction });
                    const basePrice = parseFloat(updatedProduct.selling_price || updatedProduct.average_cost || 0);
                    
                    const priceCategoryAssignments = selectedPriceCategories.map((category) => {
                        let calculatedPrice = basePrice;
                        
                        // Calculate price based on category settings using SELLING PRICE as base
                        const percentage = parseFloat(category.percentage_change || 0);
                        if (category.price_change_type === 'increase') {
                            calculatedPrice = basePrice * (1 + percentage / 100);
                        } else {
                            calculatedPrice = basePrice * (1 - percentage / 100);
                        }
                        
                        return {
                            product_id: req.params.id,
                            price_category_id: category.id,
                            calculated_price: calculatedPrice,
                            updated_by: req.user.id,
                            companyId: req.user.companyId
                        };
                    });
                    
                    await ProductPriceCategory.bulkCreate(priceCategoryAssignments, { transaction });
                }
            }
        } catch (priceCategoryError) {
            await transaction.rollback();
            throw priceCategoryError; // Re-throw to be caught by outer catch
        }
        
        // Commit transaction after all operations complete
        await transaction.commit();
        
        // Fetch the updated product with associations
        // Note: We fetch after transaction commit to ensure all associations are available
        const updatedProduct = await Product.findByPk(req.params.id, {
            attributes: [
                'id', 'product_type', 'code', 'barcode', 'name', 'part_number', 
                'image', 'description', 'category_id', 'brand_id', 'manufacturer_id', 
                'model_id', 'color_id', 'store_location_id', 'unit_id', 
                'cogs_account_id', 'income_account_id', 'asset_account_id',
                'average_cost', 'selling_price', 'purchases_tax_id', 'sales_tax_id',
                'default_packaging_id', 'default_quantity', 'price_tax_inclusive',
                'expiry_notification_days', 'track_serial_number', 'is_active',
                'min_quantity', 'max_quantity', 'reorder_point', 'created_at', 'updated_at',
                'companyId'
            ],
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductBrandName,
                    as: 'brand',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductManufacturer,
                    as: 'manufacturer',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductModel,
                    as: 'model',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductColor,
                    as: 'color',
                    attributes: ['id', 'name', 'hex_code']
                },
                {
                    model: ProductStoreLocation,
                    as: 'storeLocation',
                    attributes: ['id', 'location_name']
                },
                {
                    model: Packaging,
                    as: 'unit',
                    attributes: ['id', 'name']
                },
                {
                    model: Packaging,
                    as: 'defaultPackaging',
                    attributes: ['id', 'name']
                },
                {
                    model: TaxCode,
                    as: 'purchasesTax',
                    attributes: ['id', 'name', 'rate']
                },
                {
                    model: TaxCode,
                    as: 'salesTax',
                    attributes: ['id', 'name', 'rate']
                },
                {
                    model: Account,
                    as: 'cogsAccount',
                    attributes: ['id', 'name', 'type']
                },
                {
                    model: Account,
                    as: 'incomeAccount',
                    attributes: ['id', 'name', 'type']
                },
                {
                    model: Account,
                    as: 'assetAccount',
                    attributes: ['id', 'name', 'type']
                },
                {
                    model: Store,
                    as: 'assignedStores',
                    attributes: ['id', 'name', 'store_type', 'location'],
                    through: { 
                        attributes: ['quantity', 'min_quantity', 'reorder_point'],
                        where: buildCompanyWhere(req, {
                            is_active: true
                        }),
                        required: false
                    },
                    required: false
                },
                {
                    model: PriceCategory,
                    as: 'priceCategories',
                    attributes: ['id', 'name', 'code', 'price_change_type', 'percentage_change'],
                    through: { attributes: [] }
                }
            ]
        });
        
        // Explicitly reload the associations to ensure they're fresh after transaction
        if (updatedProduct) {
            await updatedProduct.reload({
                include: [
                    {
                        model: Store,
                        as: 'assignedStores',
                        attributes: ['id', 'name', 'store_type', 'location'],
                        through: { 
                            attributes: ['quantity', 'min_quantity', 'reorder_point'],
                            where: buildCompanyWhere(req, {
                                is_active: true
                            }),
                            required: false
                        },
                        required: false
                    },
                    {
                        model: PriceCategory,
                        as: 'priceCategories',
                        attributes: ['id', 'name', 'code', 'price_change_type', 'percentage_change'],
                        through: { attributes: [] },
                        required: false
                    }
                ]
            });
        }
        
        res.json(updatedProduct);

    } catch (error) {
        // Rollback transaction on error
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        // Handle Sequelize validation errors
        if (error.name === 'SequelizeValidationError' || error.name === 'ValidationError') {
            const validationErrors = error.errors ? error.errors.map(err => ({
                field: err.path || err.field,
                message: err.message,
                value: err.value,
                type: err.type
            })) : [{ message: error.message }];
            
            return res.status(400).json({ 
                error: 'Validation error', 
                details: 'Validation failed',
                validationErrors: validationErrors,
                errorName: error.name
            });
        }
        
        // Handle foreign key constraint errors
        if (error.name === 'SequelizeForeignKeyConstraintError' || error.name === 'ForeignKeyConstraintError') {
            return res.status(400).json({ 
                error: 'Validation error', 
                details: 'One or more referenced records do not exist',
                message: error.message,
                errorName: error.name
            });
        }
        
        // Handle unique constraint errors
        if (error.name === 'SequelizeUniqueConstraintError' || error.name === 'UniqueConstraintError') {
            // Extract which field caused the unique constraint violation
            let fieldName = 'unknown';
            let conflictingValue = null;
            
            if (error.errors && error.errors.length > 0) {
                const firstError = error.errors[0];
                fieldName = firstError.path || firstError.field || 'unknown';
                conflictingValue = firstError.value;
            } else if (error.message) {
                // Try to extract field name from error message
                const codeMatch = error.message.match(/code/i);
                const barcodeMatch = error.message.match(/barcode/i);
                if (codeMatch) fieldName = 'code';
                if (barcodeMatch) fieldName = 'barcode';
            }
            
            // Check if it's the same product (update to same value should be allowed)
            if (fieldName === 'code' && productData.code === product.code) {
                // This shouldn't happen, but if it does, it's likely a database issue
                return res.status(400).json({ 
                    error: 'Validation error', 
                    details: `Product code "${productData.code}" already exists. You cannot update to the same code.`,
                    field: fieldName,
                    value: conflictingValue,
                    errorName: error.name
                });
            }
            
            if (fieldName === 'barcode' && productData.barcode === product.barcode) {
                return res.status(400).json({ 
                    error: 'Validation error', 
                    details: `Product barcode "${productData.barcode}" already exists. You cannot update to the same barcode.`,
                    field: fieldName,
                    value: conflictingValue,
                    errorName: error.name
                });
            }
            
            return res.status(400).json({ 
                error: 'Validation error', 
                details: `A product with this ${fieldName} already exists in your company. Please use a different ${fieldName}.`,
                field: fieldName,
                value: conflictingValue,
                errorName: error.name,
                message: error.message
            });
        }
        
        // Handle database errors
        if (error.name === 'SequelizeDatabaseError') {
            return res.status(400).json({ 
                error: 'Validation error', 
                details: 'Database constraint violation',
                message: error.message,
                errorName: error.name
            });
        }
        
        // Generic error - return more details
        res.status(500).json({ 
            error: 'Failed to update product', 
            details: error.message || 'Unknown error',
            errorName: error.name || 'Unknown',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Delete product
router.delete('/:id', csrfProtection, csrfProtection, async (req, res) => {
    try {
        // Find product with company filter to ensure multi-tenant isolation
        const productWhere = buildCompanyWhere(req, { id: req.params.id });
        const product = await Product.findOne({ where: productWhere });
        
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        await product.destroy();
        
        res.json({ message: 'Product deleted successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to delete product', details: error.message });
    }
});

// Get reference data for forms
router.get('/reference/categories', async (req, res) => {
    try {
        const categories = await ProductCategory.findAll({
            attributes: ['id', 'name', 'cogs_account_id', 'income_account_id', 'asset_account_id', 'tax_code_id', 'purchases_tax_id'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
    }
});

router.get('/reference/brands', async (req, res) => {
    try {
        const brands = await ProductBrandName.findAll({
            attributes: ['id', 'name', 'logo', 'is_active'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(brands);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch brands', details: error.message });
    }
});

router.get('/reference/manufacturers', async (req, res) => {
    try {
        const manufacturers = await ProductManufacturer.findAll({
            attributes: ['id', 'name', 'logo', 'is_active'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(manufacturers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch manufacturers', details: error.message });
    }
});

router.get('/reference/models', async (req, res) => {
    try {
        const models = await ProductModel.findAll({
            attributes: ['id', 'name', 'logo', 'is_active'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(models);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch models', details: error.message });
    }
});

router.get('/reference/colors', async (req, res) => {
    try {
        const colors = await ProductColor.findAll({
            attributes: ['id', 'name', 'hex_code'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(colors);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch colors', details: error.message });
    }
});

router.get('/reference/packagings', async (req, res) => {
    try {
        const packagings = await Packaging.findAll({
            attributes: ['id', 'name', 'pieces'],
            where: buildCompanyWhere(req),
            order: [['name', 'ASC']]
        });
        res.json(packagings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch packagings', details: error.message });
    }
});

router.get('/reference/accounts', async (req, res) => {
    try {
        const accounts = await Account.findAll({
            attributes: ['id', 'name', 'type'],
            where: buildCompanyWhere(req),
            order: [['name', 'ASC']]
        });
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch accounts', details: error.message });
    }
});

router.get('/reference/taxcodes', async (req, res) => {
    try {
        const taxCodes = await TaxCode.findAll({
            attributes: ['id', 'name', 'rate'],
            where: buildCompanyWhere(req),
            order: [['name', 'ASC']]
        });
        res.json(taxCodes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tax codes', details: error.message });
    }
});

router.get('/reference/pricecategories', async (req, res) => {
    try {
        const priceCategories = await PriceCategory.findAll({
            attributes: ['id', 'name', 'code', 'price_change_type', 'percentage_change'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(priceCategories);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch price categories', details: error.message });
    }
});

router.get('/reference/stores', async (req, res) => {
    try {
        const stores = await Store.findAll({
            attributes: ['id', 'name', 'store_type', 'location', 'address', 'is_active'],
            where: buildCompanyWhere(req, { is_active: true }),
            order: [['name', 'ASC']]
        });
        res.json(stores);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stores', details: error.message });
    }
});

// Remove product from all stores
router.delete('/:productId/stores', csrfProtection, csrfProtection, async (req, res) => {
    try {
        const { productId } = req.params;
        
        // Verify product belongs to user's company
        const productWhere = buildCompanyWhere(req, { id: productId });
        const product = await Product.findOne({ where: productWhere });
        if (!product) {
            return res.status(404).json({ 
                success: false,
                error: 'Product not found' 
            });
        }
        
        // Delete all ProductStore records for this product (with company filter)
        await ProductStore.destroy({
            where: buildCompanyWhere(req, { product_id: productId })
        });
        
        res.json({ message: 'Product removed from all stores successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove product from all stores', details: error.message });
    }
});

// Export products to Excel
router.get('/export/excel', async (req, res) => {
    try {
        // Build where clause for export filters
        const whereClause = {};
        
        if (req.query.search) {
            whereClause[Op.or] = [
                { name: { [Op.iLike]: `%${req.query.search}%` } },
                { code: { [Op.iLike]: `%${req.query.search}%` } },
                { barcode: { [Op.iLike]: `%${req.query.search}%` } },
                { description: { [Op.iLike]: `%${req.query.search}%` } }
            ];
        }
        
        if (req.query.status && req.query.status !== 'all') {
            whereClause.is_active = req.query.status === 'active';
        }
        
        if (req.query.product_type) {
            whereClause.product_type = req.query.product_type;
        }
        
        if (req.query.category_id) {
            whereClause.category_id = req.query.category_id;
        }
        
        if (req.query.brand_id) {
            whereClause.brand_id = req.query.brand_id;
        }
        
        if (req.query.manufacturer_id) {
            whereClause.manufacturer_id = req.query.manufacturer_id;
        }
        
        if (req.query.model_id) {
            whereClause.model_id = req.query.model_id;
        }
        
        if (req.query.color_id) {
            whereClause.color_id = req.query.color_id;
        }
        
        if (req.query.store_id) {
            whereClause.id = {
                [Op.in]: sequelize.literal(`(
                    SELECT DISTINCT product_id 
                    FROM product_stores 
                    WHERE store_id = '${req.query.store_id}'
                )`)
            };
        }
        
        if (req.query.low_stock === 'true') {
            whereClause.min_quantity = { [Op.gt]: 0 };
        }
        
        if (req.query.expiring === 'true') {
            // Expiring products logic can be added here if needed
        }

        // Fetch products with all necessary relations for export
        const products = await Product.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductBrandName,
                    as: 'brand',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductManufacturer,
                    as: 'manufacturer',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductModel,
                    as: 'model',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductColor,
                    as: 'color',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: Packaging,
                    as: 'unit',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name', 'username'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Transform data for export
        const transformedProducts = products.map(product => ({
            ...product.toJSON(),
            category_name: product.category?.name || '',
            brand_name: product.brand?.name || '',
            manufacturer_name: product.manufacturer?.name || '',
            model_name: product.model?.name || '',
            color_name: product.color?.name || '',
            unit_name: product.unit?.name || '',
            created_by_name: product.createdByUser ? 
                `${product.createdByUser.first_name || ''} ${product.createdByUser.last_name || ''}`.trim() || 
                product.createdByUser.username : 'System',
            updated_by_name: product.updatedByUser ? 
                `${product.updatedByUser.first_name || ''} ${product.updatedByUser.last_name || ''}`.trim() || 
                product.updatedByUser.username : 'System'
        }));

        // Create export service instance
        const exportService = new ExportService();
        
        // Generate Excel file
        const buffer = await exportService.exportProductsToExcel(transformedProducts, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="products_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
        } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export products to Excel', 
            details: error.message 
        });
    }
});

// Export products to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        // Build where clause for export filters (same as Excel)
        const whereClause = {};
        
        if (req.query.search) {
            whereClause[Op.or] = [
                { name: { [Op.iLike]: `%${req.query.search}%` } },
                { code: { [Op.iLike]: `%${req.query.search}%` } },
                { barcode: { [Op.iLike]: `%${req.query.search}%` } },
                { description: { [Op.iLike]: `%${req.query.search}%` } }
            ];
        }
        
        if (req.query.status && req.query.status !== 'all') {
            whereClause.is_active = req.query.status === 'active';
        }
        
        if (req.query.product_type) {
            whereClause.product_type = req.query.product_type;
        }
        
        if (req.query.category_id) {
            whereClause.category_id = req.query.category_id;
        }
        
        if (req.query.brand_id) {
            whereClause.brand_id = req.query.brand_id;
        }
        
        if (req.query.manufacturer_id) {
            whereClause.manufacturer_id = req.query.manufacturer_id;
        }
        
        if (req.query.model_id) {
            whereClause.model_id = req.query.model_id;
        }
        
        if (req.query.color_id) {
            whereClause.color_id = req.query.color_id;
        }
        
        if (req.query.store_id) {
            whereClause.id = {
                [Op.in]: sequelize.literal(`(
                    SELECT DISTINCT product_id 
                    FROM product_stores 
                    WHERE store_id = '${req.query.store_id}'
                )`)
            };
        }
        
        if (req.query.low_stock === 'true') {
            whereClause.min_quantity = { [Op.gt]: 0 };
        }
        
        if (req.query.expiring === 'true') {
            // Expiring products logic can be added here if needed
        }

        // Fetch products with all necessary relations for export
        const products = await Product.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductBrandName,
                    as: 'brand',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductManufacturer,
                    as: 'manufacturer',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductModel,
                    as: 'model',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductColor,
                    as: 'color',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: Packaging,
                    as: 'unit',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['first_name', 'last_name', 'username'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['first_name', 'last_name', 'username'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Transform data for export
        const transformedProducts = products.map(product => ({
            ...product.toJSON(),
            category_name: product.category?.name || '',
            brand_name: product.brand?.name || '',
            manufacturer_name: product.manufacturer?.name || '',
            model_name: product.model?.name || '',
            color_name: product.color?.name || '',
            unit_name: product.unit?.name || '',
            created_by_name: product.createdByUser ? 
                `${product.createdByUser.first_name || ''} ${product.createdByUser.last_name || ''}`.trim() || 
                product.createdByUser.username : 'System',
            updated_by_name: product.updatedByUser ? 
                `${product.updatedByUser.first_name || ''} ${product.updatedByUser.last_name || ''}`.trim() || 
                product.updatedByUser.username : 'System'
        }));

        // Create export service instance
        const exportService = new ExportService();
        
        // Generate PDF file
        const buffer = await exportService.exportProductsToPDF(transformedProducts, req.query);
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="products_export_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        
        // Send the file
        res.send(buffer);
        
        } catch (error) {
        res.status(500).json({ 
            error: 'Failed to export products to PDF', 
            details: error.message 
        });
    }
});

// Get products by store for stock adjustment
router.get('/store/:storeId', async (req, res) => {
    try {
        const storeId = req.params.storeId;
        const search = req.query.search || '';
        const limit = parseInt(req.query.limit) || 50;
        
        // Build where clause for search
        const whereClause = {
            is_active: true // Only active products
            // Note: Services products are included for sales invoices
            // If POS needs to exclude services, it should use a different route or filter
        };
        
        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { code: { [Op.iLike]: `%${search}%` } },
                { barcode: { [Op.iLike]: `%${search}%` } },
                { part_number: { [Op.iLike]: `%${search}%` } },
                { description: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        // Handle additional filters (server-side filtering)
        // Only add filters if they are provided and not empty strings
        if (req.query.category_id && String(req.query.category_id).trim() !== '') {
            whereClause.category_id = String(req.query.category_id).trim();
        }
        if (req.query.brand_id && String(req.query.brand_id).trim() !== '') {
            whereClause.brand_id = String(req.query.brand_id).trim();
        }
        if (req.query.manufacturer_id && String(req.query.manufacturer_id).trim() !== '') {
            whereClause.manufacturer_id = String(req.query.manufacturer_id).trim();
        }
        if (req.query.model_id && String(req.query.model_id).trim() !== '') {
            whereClause.model_id = String(req.query.model_id).trim();
        }
        if (req.query.color_id && String(req.query.color_id).trim() !== '') {
            whereClause.color_id = String(req.query.color_id).trim();
        }
        if (req.query.unit_id && String(req.query.unit_id).trim() !== '') {
            whereClause.unit_id = String(req.query.unit_id).trim();
        }
        
        // Build company filter for products
        const productWhere = buildCompanyWhere(req, whereClause);
        
        // Verify store belongs to user's company
        const storeWhere = buildCompanyWhere(req, { id: storeId });
        const store = await Store.findOne({ where: storeWhere });
        if (!store) {
            return res.status(404).json({ 
                success: false,
                error: 'Store not found' 
            });
        }
        
        // Get products assigned to the specific store with their stock quantities
        const products = await Product.findAll({
            where: productWhere,
            attributes: [
                'id', 'product_type', 'code', 'barcode', 'name', 'part_number', 
                'image', 'description', 'category_id', 'brand_id', 'manufacturer_id', 
                'model_id', 'color_id', 'store_location_id', 'unit_id', 
                'average_cost', 'selling_price', 'sales_tax_id',
                'price_tax_inclusive', 'track_serial_number', 'is_active',
                'min_quantity', 'max_quantity', 'reorder_point', 'created_at', 'updated_at'
            ],
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    where: { id: storeId },
                    required: true,
                    through: { 
                        attributes: ['quantity', 'min_quantity', 'reorder_point', 'average_cost', 'last_updated'] // Include stock data
                    }
                },
                {
                    model: ProductCategory,
                    as: 'category',
                    attributes: ['id', 'name'],
                    required: false
                },
                {
                    model: ProductBrandName,
                    as: 'brand',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductManufacturer,
                    as: 'manufacturer',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductModel,
                    as: 'model',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: ProductColor,
                    as: 'color',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: Packaging,
                    as: 'unit',
                    attributes: ['name'],
                    required: false
                },
                {
                    model: TaxCode,
                    as: 'salesTax',
                    attributes: ['id', 'name', 'rate'],
                    required: false
                },
                {
                    model: PriceCategory,
                    as: 'priceCategories',
                    attributes: ['id', 'code', 'name', 'price_change_type', 'percentage_change'],
                    required: false,
                    through: { 
                        attributes: ['calculated_price'],
                        model: ProductPriceCategory
                    }
                }
            ],
            order: [['name', 'ASC']],
            limit: limit
        });
        
        // Products from DB query already match search in product fields (name, code, barcode, part_number, description)
        // All products in the results are valid matches, so we keep them all
        // Note: If we wanted to also search in joined tables without requiring product field matches,
        // we would need to modify the DB query to use Op.or with joined table conditions, which is more complex.
        let filteredProducts = products;
        
        // Transform the response to include computed fields and store-specific stock data
        const transformedProducts = filteredProducts.map(product => {
            // Get store-specific stock data from the junction table
            const storeData = product.assignedStores && product.assignedStores[0] ? product.assignedStores[0].ProductStore : null;
            
            return {
                id: product.id,
                name: product.name,
                code: product.code,
                barcode: product.barcode,
                part_number: product.part_number,
                image: product.image, // Include image field
                description: product.description,
                product_type: product.product_type,
                average_cost: product.average_cost,
                selling_price: product.selling_price,
                price_tax_inclusive: product.price_tax_inclusive || false,
                is_active: product.is_active,
                track_serial_number: product.track_serial_number,
                expiry_notification_days: product.expiry_notification_days,
                min_quantity: product.min_quantity,
                max_quantity: product.max_quantity,
                reorder_point: product.reorder_point,
                category_id: product.category_id, // Include category_id for filtering
                category: product.category,
                brand: product.brand,
                manufacturer: product.manufacturer,
                model: product.model,
                color: product.color,
                unit: product.unit,
                salesTax: product.salesTax,
                created_at: product.created_at,
                updated_at: product.updated_at,
                // Store-specific stock data
                currentQuantity: storeData ? parseFloat(storeData.quantity || 0) : 0,
                storeMinQuantity: storeData ? parseFloat(storeData.min_quantity || 0) : 0,
                storeReorderPoint: storeData ? parseFloat(storeData.reorder_point || 0) : 0,
                storeAverageCost: storeData ? parseFloat(storeData.average_cost || 0) : 0,
                lastStockUpdate: storeData ? storeData.last_updated : null,
                // Price categories with calculated prices
                ProductPriceCategories: product.priceCategories ? product.priceCategories.map((pc) => ({
                    price_category_id: pc.id,
                    calculated_price: pc.ProductPriceCategory?.calculated_price ? parseFloat(pc.ProductPriceCategory.calculated_price) : 0,
                    priceCategory: {
                        id: pc.id,
                        code: pc.code,
                        name: pc.name
                    }
                })) : [],
                priceCategories: product.priceCategories ? product.priceCategories.map((pc) => ({
                    price_category_id: pc.id,
                    calculated_price: pc.ProductPriceCategory?.calculated_price ? parseFloat(pc.ProductPriceCategory.calculated_price) : 0,
                    priceCategory: {
                        id: pc.id,
                        code: pc.code,
                        name: pc.name
                    }
                })) : []
            };
        });
        
        res.json({
            success: true,
            data: transformedProducts,
            total: transformedProducts.length
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch products by store', 
            details: error.message 
        });
    }
});

// Get product stock for a specific store
router.get('/:productId/store-stock', async (req, res) => {
    try {
        const { productId } = req.params;
        const { store_id } = req.query;
        
        if (!store_id) {
            return res.status(400).json({
                success: false,
                message: 'Store ID is required'
            });
        }
        
        // Verify product belongs to user's company
        const productWhere = buildCompanyWhere(req, { id: productId });
        const product = await Product.findOne({ where: productWhere });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        // Verify store belongs to user's company
        const storeWhere = buildCompanyWhere(req, { id: store_id });
        const store = await Store.findOne({ where: storeWhere });
        if (!store) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }
        
        // Find the product-store relationship with company filter
        const productStoreWhere = buildCompanyWhere(req, {
            product_id: productId,
            store_id: store_id,
            is_active: true
        });
        const productStore = await ProductStore.findOne({
            where: productStoreWhere
        });
        
        if (!productStore) {
            return res.json({
                success: true,
                quantity: 0,
                message: 'No stock record found for this product at this store'
            });
        }
        
        const quantity = parseFloat(productStore.quantity || 0);
        
        res.json({
            success: true,
            quantity: quantity,
            product_id: productId,
            store_id: store_id,
            average_cost: parseFloat(productStore.average_cost || 0),
            last_updated: productStore.last_updated
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get product store stock',
            error: error.message
        });
    }
});

// Raw Materials routes for products
// Get raw materials for a manufactured product
router.get('/:productId/raw-materials', async (req, res) => {
    try {
        const { productId } = req.params;
        
        // Verify product belongs to user's company
        const productWhere = buildCompanyWhere(req, { id: productId });
        const product = await Product.findOne({ where: productWhere });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
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
router.post('/:productId/raw-materials', csrfProtection, async (req, res) => {
    try {
        const { productId } = req.params;
        const { raw_material_id, quantity_per_unit, unit } = req.body;
        const userId = req.user.id;
        
        // Verify manufactured product exists and is manufactured type
        const manufacturedProduct = await Product.findOne({
            where: buildCompanyWhere(req, { id: productId })
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
                manufactured_product_id: productId,
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
            manufactured_product_id: productId,
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
router.put('/:productId/raw-materials/:rawMaterialId', csrfProtection, async (req, res) => {
    try {
        const { productId, rawMaterialId } = req.params;
        const { quantity_per_unit, unit } = req.body;
        const userId = req.user.id;
        
        // Verify product belongs to user's company
        const productWhere = buildCompanyWhere(req, { id: productId });
        const product = await Product.findOne({ where: productWhere });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        const rawMaterial = await ProductRawMaterial.findOne({
            where: buildCompanyWhere(req, { id: rawMaterialId })
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
        const updatedRecord = await ProductRawMaterial.findByPk(rawMaterialId, {
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
router.delete('/:productId/raw-materials/:rawMaterialId', csrfProtection, async (req, res) => {
    try {
        const { productId, rawMaterialId } = req.params;
        
        // Verify product belongs to user's company
        const productWhere = buildCompanyWhere(req, { id: productId });
        const product = await Product.findOne({ where: productWhere });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        const rawMaterial = await ProductRawMaterial.findOne({
            where: buildCompanyWhere(req, { id: rawMaterialId })
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

module.exports = router;
