const express = require('express');
const router = express.Router();
const { Store, User } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { sequelize } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Multer setup for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Get available store types
router.get('/types', (req, res) => {
    const storeTypes = [
        { value: 'pharmacy', label: 'Pharmacy', icon: 'fa-pills', description: 'Medical and pharmaceutical products' },
        { value: 'retail_shop', label: 'Retail Shop', icon: 'fa-shopping-bag', description: 'General retail store' },
        { value: 'restaurant', label: 'Restaurant', icon: 'fa-utensils', description: 'Food and dining establishment' },
        { value: 'barber_shop', label: 'Barber Shop', icon: 'fa-cut', description: 'Hair cutting and grooming services' },
        { value: 'supermarket', label: 'Supermarket', icon: 'fa-shopping-cart', description: 'Large grocery and household store' },
        { value: 'clothing_store', label: 'Clothing Store', icon: 'fa-tshirt', description: 'Apparel and fashion items' },
        { value: 'electronics_store', label: 'Electronics Store', icon: 'fa-laptop', description: 'Electronic devices and gadgets' },
        { value: 'hardware_store', label: 'Hardware Store', icon: 'fa-tools', description: 'Tools and construction materials' },
        { value: 'jewelry_store', label: 'Jewelry Store', icon: 'fa-gem', description: 'Jewelry and accessories' },
        { value: 'bookstore', label: 'Bookstore', icon: 'fa-book', description: 'Books and educational materials' },
        { value: 'other', label: 'Other', icon: 'fa-store', description: 'Other business types' }
    ];
    
    res.json({
        success: true,
        storeTypes
    });
});

// Get active stores for dropdowns
router.get('/active', async (req, res) => {
    try {
        const stores = await Store.findAll({
            where: buildCompanyWhere(req, { is_active: true }),
            attributes: ['id', 'name', 'location'],
            order: [['name', 'ASC']]
        });

        res.json({
            success: true,
            stores: stores.map(store => ({
                id: store.id,
                name: store.name,
                location: store.location
            }))
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching active stores' 
        });
    }
});

// Get all stores with pagination, search, and filters
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 25, 
            search = '', 
            sort = 'createdAt', 
            order = 'desc',
            store_type,
            status,
            has_manufacturing,
            has_storage,
            has_temperature_control
        } = req.query;

        // Build where clause
        const whereClause = {};
        
        if (search) {
            whereClause[sequelize.Op.or] = [
                { name: { [sequelize.Op.iLike]: `%${search}%` } },
                { location: { [sequelize.Op.iLike]: `%${search}%` } },
                { phone: { [sequelize.Op.iLike]: `%${search}%` } },
                { email: { [sequelize.Op.iLike]: `%${search}%` } }
            ];
        }

        if (store_type) {
            whereClause.store_type = store_type;
        }

        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        if (has_manufacturing === 'true') {
            whereClause.is_manufacturing = true;
        }

        if (has_storage === 'true') {
            whereClause.is_storage_facility = true;
        }

        if (has_temperature_control === 'true') {
            whereClause.has_temperature_control = true;
        }

        // Add company filter (must be done after all filters are set)
        const finalWhere = buildCompanyWhere(req, whereClause);

        // Get total count
        const count = await Store.count({ where: finalWhere });

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const totalPages = Math.ceil(count / parseInt(limit));

        // Get stores with pagination
        const stores = await Store.findAll({
            where: finalWhere,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: require('../models').Currency,
                    as: 'defaultCurrency',
                    attributes: ['id', 'code', 'name', 'symbol', 'country', 'flag']
                },
                {
                    model: require('../models').PriceCategory,
                    as: 'defaultPriceCategory',
                    attributes: ['id', 'code', 'name', 'description', 'price_change_type', 'percentage_change']
                }
            ],
            order: [[sort, order.toUpperCase()]],
            limit: parseInt(limit),
            offset: offset
        });

        const transformedStores = stores.map(store => ({
            id: store.id,
            name: store.name,
            store_type: store.store_type,
            location: store.location,
            phone: store.phone,
            email: store.email,
            address: store.address,
            description: store.description,
            is_active: store.is_active,
            // GPS Coordinates
            latitude: store.latitude,
            longitude: store.longitude,
            // Store Capabilities
            is_manufacturing: store.is_manufacturing,
            can_receive_po: store.can_receive_po,
            can_issue_to_store: store.can_issue_to_store,
            can_receive_from_store: store.can_receive_from_store,
            can_sale_products: store.can_sale_products,
            is_storage_facility: store.is_storage_facility,
            has_temperature_control: store.has_temperature_control,
            temperature_min: store.temperature_min,
            temperature_max: store.temperature_max,
            settings: store.settings,
            default_currency_id: store.default_currency_id,
            defaultCurrency: store.defaultCurrency ? {
                id: store.defaultCurrency.id,
                code: store.defaultCurrency.code,
                name: store.defaultCurrency.name,
                symbol: store.defaultCurrency.symbol,
                country: store.defaultCurrency.country,
                flag: store.defaultCurrency.flag
            } : null,
            default_price_category_id: store.default_price_category_id,
            defaultPriceCategory: store.defaultPriceCategory ? {
                id: store.defaultPriceCategory.id,
                code: store.defaultPriceCategory.code,
                name: store.defaultPriceCategory.name,
                description: store.defaultPriceCategory.description,
                price_change_type: store.defaultPriceCategory.price_change_type,
                percentage_change: store.defaultPriceCategory.percentage_change
            } : null,
            // Audit fields
            createdAt: store.createdAt,
            updatedAt: store.updatedAt,
            creator: store.creator ? {
                id: store.creator.id,
                firstName: store.creator.first_name,
                lastName: store.creator.last_name,
                username: store.creator.username
            } : null,
            updater: store.updater ? {
                id: store.updater.id,
                firstName: store.updater.first_name,
                lastName: store.updater.last_name,
                username: store.updater.username
            } : null
        }));

        res.json({
            data: transformedStores,
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: totalPages,
            pagination: {
                totalItems: count,
                currentPage: parseInt(page),
                totalPages: totalPages,
                hasNextPage: parseInt(page) < totalPages,
                hasPrevPage: parseInt(page) > 1,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching stores' 
        });
    }
});

// Route to get the CSV template for importing stores
router.get('/template', async (req, res) => {
    try {
        // Get available currencies for the template
        const currencies = await require('../models').Currency.findAll({
            attributes: ['id', 'code', 'name', 'symbol'],
            where: { is_active: true },
            order: [['code', 'ASC']]
        });

        const currencyOptions = currencies.map(c => `${c.code} (${c.name})`).join('|');
        const currencyExample = currencies.length > 0 ? currencies[0].code : 'USD';

        // Get available price categories for the template
        const priceCategories = await require('../models').PriceCategory.findAll({
            attributes: ['id', 'code', 'name'],
            where: { is_active: true },
            order: [['code', 'ASC']]
        });

        const priceCategoryOptions = priceCategories.map(pc => `${pc.code} (${pc.name})`).join('|');
        const priceCategoryExample = priceCategories.length > 0 ? priceCategories[0].code : 'STANDARD';

        // Define all fields that match the Store table structure
        // Excluding auto-generated fields: id, created_by, updated_by, createdAt, updatedAt
        const templateData = [
            {
                name: 'Store Name',
                store_type: 'Store Type (pharmacy|retail_shop|restaurant|barber_shop|supermarket|clothing_store|electronics_store|hardware_store|jewelry_store|bookstore|other)',
                default_currency_id: `Default Currency (${currencyOptions})`,
                default_price_category_id: `Default Price Category (${priceCategoryOptions})`,
                location: 'Store Location',
                phone: 'Phone Number',
                email: 'Email Address',
                address: 'Full Address',
                description: 'Store Description (optional)',
                is_active: 'Is Active (true|false)',
                latitude: 'Latitude (-90 to 90, optional)',
                longitude: 'Longitude (-180 to 180, optional)',
                is_manufacturing: 'Is Manufacturing Facility (true|false)',
                can_receive_po: 'Can Receive Purchase Orders (true|false)',
                can_issue_to_store: 'Can Issue to Other Stores (true|false)',
                can_receive_from_store: 'Can Receive from Other Stores (true|false)',
                can_sale_products: 'Can Sale Products (true|false)',
                is_storage_facility: 'Is Storage Facility (true|false)',
                has_temperature_control: 'Has Temperature Control (true|false)',
                temperature_min: 'Minimum Temperature (optional, for storage facilities)',
                temperature_max: 'Maximum Temperature (optional, for storage facilities)',
                settings: 'Additional Settings (JSON format, optional)'
            },
            {
                name: 'Example Store',
                store_type: 'retail_shop',
                default_currency_id: currencyExample,
                default_price_category_id: priceCategoryExample,
                location: 'Downtown Mall',
                phone: '+1234567890',
                email: 'store@example.com',
                address: '123 Main Street, City, State 12345',
                description: 'A retail store selling various products',
                is_active: 'true',
                latitude: '40.7128',
                longitude: '-74.0060',
                is_manufacturing: 'false',
                can_receive_po: 'true',
                can_issue_to_store: 'false',
                can_receive_from_store: 'true',
                can_sale_products: 'true',
                is_storage_facility: 'false',
                has_temperature_control: 'false',
                temperature_min: '',
                temperature_max: '',
                settings: '{"opening_hours": "9AM-6PM", "payment_methods": ["cash", "card"]}'
            }
        ];

        // Convert to CSV format
        const headers = Object.keys(templateData[0]);
        const csvContent = [
            headers.join(','),
            ...templateData.map(row => 
                headers.map(header => {
                    const value = row[header] || '';
                    // Escape commas and quotes in CSV
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                }).join(',')
            )
        ].join('\n');

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="store_import_template.csv"');
        res.send(csvContent);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error generating template' });
    }
});

// Get store statistics
router.get('/statistics', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const [
            totalStores,
            activeStores,
            inactiveStores,
            manufacturingStores,
            storageFacilities
        ] = await Promise.all([
            Store.count({ where: baseWhere }),
            Store.count({ where: { ...baseWhere, is_active: true } }),
            Store.count({ where: { ...baseWhere, is_active: false } }),
            Store.count({ where: { ...baseWhere, is_manufacturing: true } }),
            Store.count({ where: { ...baseWhere, is_storage_facility: true } })
        ]);

        res.json({
            totalStores,
            activeStores,
            inactiveStores,
            manufacturingStores,
            storageFacilities,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching store statistics' 
        });
    }
});

// Toggle store status
router.patch('/:id/toggle-status', async (req, res) => {
    try {
        const { id } = req.params;
        const store = await Store.findByPk(id);
        
        if (!store) {
            return res.status(404).json({ 
                success: false, 
                message: 'Store not found' 
            });
        }

        store.is_active = !store.is_active;
        store.updated_by = req.user.id;
        await store.save();

        res.json({
            success: true,
            message: `Store ${store.is_active ? 'activated' : 'deactivated'} successfully`,
            store: {
                id: store.id,
                name: store.name,
                is_active: store.is_active
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error toggling store status' 
        });
    }
});

// Export stores to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, store_type, status, has_manufacturing, has_storage, has_temperature_control } = req.query;

        // Build where clause (same as main GET route)
        const whereClause = {};
        
        if (search) {
            whereClause[sequelize.Op.or] = [
                { name: { [sequelize.Op.iLike]: `%${search}%` } },
                { location: { [sequelize.Op.iLike]: `%${search}%` } },
                { phone: { [sequelize.Op.iLike]: `%${search}%` } },
                { email: { [sequelize.Op.iLike]: `%${search}%` } }
            ];
        }

        if (store_type) {
            whereClause.store_type = store_type;
        }

        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        if (has_manufacturing === 'true') {
            whereClause.is_manufacturing = true;
        }

        if (has_storage === 'true') {
            whereClause.is_storage_facility = true;
        }

        if (has_temperature_control === 'true') {
            whereClause.has_temperature_control = true;
        }

        const stores = await Store.findAll({
            where: whereClause,
            include: [
                {
                    model: require('../models').Currency,
                    as: 'defaultCurrency',
                    attributes: ['code', 'name', 'symbol']
                }
            ],
            order: [['name', 'ASC']]
        });

        // For now, return JSON (you can implement Excel generation later)
        res.json({
            success: true,
            message: 'Excel export functionality will be implemented',
            count: stores.length,
            stores: stores.map(store => ({
                name: store.name,
                store_type: store.store_type,
                location: store.location,
                phone: store.phone,
                email: store.email,
                address: store.address,
                default_currency: store.defaultCurrency?.code || 'N/A',
                is_active: store.is_active ? 'Yes' : 'No',
                is_manufacturing: store.is_manufacturing ? 'Yes' : 'No',
                is_storage_facility: store.is_storage_facility ? 'Yes' : 'No',
                has_temperature_control: store.has_temperature_control ? 'Yes' : 'No'
            }))
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error exporting stores to Excel' 
        });
    }
});

// Export stores to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, store_type, status, has_manufacturing, has_storage, has_temperature_control } = req.query;

        // Build where clause (same as main GET route)
        const whereClause = {};
        
        if (search) {
            whereClause[sequelize.Op.or] = [
                { name: { [sequelize.Op.iLike]: `%${search}%` } },
                { location: { [sequelize.Op.iLike]: `%${search}%` } },
                { phone: { [sequelize.Op.iLike]: `%${search}%` } },
                { email: { [sequelize.Op.iLike]: `%${search}%` } }
            ];
        }

        if (store_type) {
            whereClause.store_type = store_type;
        }

        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        if (has_manufacturing === 'true') {
            whereClause.is_manufacturing = true;
        }

        if (has_storage === 'true') {
            whereClause.is_storage_facility = true;
        }

        if (has_temperature_control === 'true') {
            whereClause.has_temperature_control = true;
        }

        const stores = await Store.findAll({
            where: whereClause,
            include: [
                {
                    model: require('../models').Currency,
                    as: 'defaultCurrency',
                    attributes: ['code', 'name', 'symbol']
                }
            ],
            order: [['name', 'ASC']]
        });

        // For now, return JSON (you can implement PDF generation later)
        res.json({
            success: true,
            message: 'PDF export functionality will be implemented',
            count: stores.length,
            stores: stores.map(store => ({
                name: store.name,
                store_type: store.store_type,
                location: store.location,
                phone: store.phone,
                email: store.email,
                address: store.address,
                default_currency: store.defaultCurrency?.code || 'N/A',
                is_active: store.is_active ? 'Yes' : 'No',
                is_manufacturing: store.is_manufacturing ? 'Yes' : 'No',
                is_storage_facility: store.is_storage_facility ? 'Yes' : 'No',
                has_temperature_control: store.has_temperature_control ? 'Yes' : 'No'
            }))
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error exporting stores to PDF' 
        });
    }
});

// Route to parse and review a CSV file before import
router.post('/review', upload.single('file'), csrfProtection, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        // Get available currencies for validation
        const currencies = await require('../models').Currency.findAll({
            attributes: ['id', 'code', 'name', 'symbol'],
            where: { is_active: true },
            order: [['code', 'ASC']]
        });

        const currencyMap = {};
        currencies.forEach(currency => {
            currencyMap[currency.code.toUpperCase()] = currency.id;
            currencyMap[currency.code.toLowerCase()] = currency.id;
        });

        // Get available price categories for validation
        const priceCategories = await require('../models').PriceCategory.findAll({
            attributes: ['id', 'code', 'name'],
            where: { is_active: true },
            order: [['code', 'ASC']]
        });

        const priceCategoryMap = {};
        priceCategories.forEach(pc => {
            priceCategoryMap[pc.code.toUpperCase()] = pc.id;
            priceCategoryMap[pc.code.toLowerCase()] = pc.id;
        });

        const results = [];
        const errors = [];
        const readableStream = new Readable();
        readableStream.push(req.file.buffer);
        readableStream.push(null);

        readableStream
            .pipe(csv())
            .on('data', (data) => {
                // Validate the row data
                const rowErrors = [];
                
                // Required field validation
                if (!data.store_type || data.store_type.trim() === '') {
                    rowErrors.push('Store type is required');
                }

                // Validate store type format
                const validStoreTypes = ['pharmacy', 'retail_shop', 'restaurant', 'barber_shop', 'supermarket', 'clothing_store', 'electronics_store', 'hardware_store', 'jewelry_store', 'bookstore', 'other'];
                if (data.store_type && !validStoreTypes.includes(data.store_type)) {
                    rowErrors.push(`Invalid store type: ${data.store_type}. Valid types: ${validStoreTypes.join(', ')}`);
                }

                // Validate currency if provided
                if (data.default_currency_id && data.default_currency_id.trim() !== '') {
                    const currencyCode = data.default_currency_id.trim();
                    if (!currencyMap[currencyCode]) {
                        const availableCurrencies = currencies.map(c => c.code).join(', ');
                        rowErrors.push(`Invalid currency code: ${currencyCode}. Available currencies: ${availableCurrencies}`);
                    } else {
                        // Convert currency code to ID for storage
                        data.default_currency_id = currencyMap[currencyCode];
                    }
                }

                // Validate price category if provided
                if (data.default_price_category_id && data.default_price_category_id.trim() !== '') {
                    const priceCategoryCode = data.default_price_category_id.trim();
                    if (!priceCategoryMap[priceCategoryCode]) {
                        const availablePriceCategories = priceCategories.map(pc => pc.code).join(', ');
                        rowErrors.push(`Invalid price category code: ${priceCategoryCode}. Available price categories: ${availablePriceCategories}`);
                    } else {
                        // Convert price category code to ID for storage
                        data.default_price_category_id = priceCategoryMap[priceCategoryCode];
                    }
                }

                // Validate JSON settings if provided
                if (data.settings && data.settings.trim() !== '') {
                    try {
                        JSON.parse(data.settings);
                    } catch (e) {
                        rowErrors.push(`Invalid JSON in settings: ${e.message}`);
                    }
                }

                // Add row to results with validation info
                const rowData = {
                    ...data,
                    _rowNumber: results.length + 1,
                    _hasErrors: rowErrors.length > 0,
                    _errors: rowErrors
                };

                results.push(rowData);
                
                if (rowErrors.length > 0) {
                    errors.push({
                        row: results.length,
                        storeName: data.name || 'Unknown',
                        errors: rowErrors
                    });
                }
            })
            .on('end', () => {
                res.json({ 
                    success: true, 
                    data: results,
                    validation: {
                        totalRows: results.length,
                        validRows: results.filter(r => !r._hasErrors).length,
                        invalidRows: results.filter(r => r._hasErrors).length,
                        errors: errors
                    }
                });
            })
            .on('error', (error) => {
                res.status(500).json({ success: false, message: 'Error processing CSV file.' });
            });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error processing review.' });
    }
});

// Get store by ID
router.get('/:id', async (req, res) => {
    try {
        const store = await Store.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name', 'username']
                },
                {
                    model: require('../models').Currency,
                    as: 'defaultCurrency',
                    attributes: ['id', 'code', 'name', 'symbol', 'country', 'flag']
                },
                {
                    model: require('../models').PriceCategory,
                    as: 'defaultPriceCategory',
                    attributes: ['id', 'code', 'name', 'description', 'price_change_type', 'percentage_change']
                }
            ]
        });

        if (!store) {
            return res.status(404).json({ 
                success: false, 
                message: 'Store not found' 
            });
        }

        res.json({ 
            success: true, 
            store: {
                id: store.id,
                name: store.name,
                store_type: store.store_type,
                location: store.location,
                phone: store.phone,
                email: store.email,
                address: store.address,
                description: store.description,
                is_active: store.is_active,
                // GPS Coordinates
                latitude: store.latitude,
                longitude: store.longitude,
                // Store Settings
                is_manufacturing: store.is_manufacturing,
                can_receive_po: store.can_receive_po,
                can_issue_to_store: store.can_issue_to_store,
                can_receive_from_store: store.can_receive_from_store,
                can_sale_products: store.can_sale_products,
                is_storage_facility: store.is_storage_facility,
                has_temperature_control: store.has_temperature_control,
                temperature_min: store.temperature_min,
                temperature_max: store.temperature_max,
                settings: store.settings,
                // Currency relationship
                default_currency_id: store.default_currency_id,
                defaultCurrency: store.defaultCurrency ? {
                    id: store.defaultCurrency.id,
                    code: store.defaultCurrency.code,
                    name: store.defaultCurrency.name,
                    symbol: store.defaultCurrency.symbol,
                    country: store.defaultCurrency.country,
                    flag: store.defaultCurrency.flag
                } : null,
                // Price Category relationship
                default_price_category_id: store.default_price_category_id,
                defaultPriceCategory: store.defaultPriceCategory ? {
                    id: store.defaultPriceCategory.id,
                    code: store.defaultPriceCategory.code,
                    name: store.defaultPriceCategory.name,
                    description: store.defaultPriceCategory.description,
                    price_change_type: store.defaultPriceCategory.price_change_type,
                    percentage_change: store.defaultPriceCategory.percentage_change
                } : null,
                // Audit fields
                createdAt: store.createdAt,
                updatedAt: store.updatedAt,
                created_by: store.creator ? {
                    id: store.creator.id,
                    firstName: store.creator.first_name,
                    lastName: store.creator.last_name,
                    username: store.creator.username
                } : null,
                updated_by: store.updater ? {
                    id: store.updater.id,
                    firstName: store.updater.first_name,
                    lastName: store.updater.last_name,
                    username: store.updater.username
                } : null
            } 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching store' 
        });
    }
});

// Create new store
router.post('/', csrfProtection, async (req, res) => {
    const {
        name,
        store_type,
        location,
        phone,
        email,
        address,
        description,
        is_manufacturing,
        can_receive_po,
        can_issue_to_store,
        can_receive_from_store,
        can_sale_products,
        is_storage_facility,
        has_temperature_control,
        latitude,
        longitude,
        temperature_min,
        temperature_max,
        settings,
        default_currency_id,
        default_price_category_id
    } = req.body;

    try {
        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Store name is required'
            });
        }
        
        if (!store_type) {
            return res.status(400).json({
                success: false,
                message: 'Store type is required'
            });
        }
        
        if (!location || !location.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Location is required'
            });
        }
        
        if (!phone || !phone.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Phone is required'
            });
        }

        // Ensure user has a company (unless super-admin)
        if (!req.user.isSystemAdmin && !req.user.companyId) {
            return res.status(403).json({
                success: false,
                message: 'Company access required. Please contact your administrator.'
            });
        }

        // Handle empty email - convert to null if empty string (Sequelize isEmail validation fails on empty strings)
        const storeEmail = email && email.trim() !== '' ? email.trim() : null;
        
        // Validate email format if provided
        if (storeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(storeEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Check if store name already exists in this company
        // Always check within company, even for super-admins
        if (!req.user.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Company ID is required to create a store'
            });
        }

        const existingStore = await Store.findOne({
            where: {
                name: name.trim(),
                companyId: req.user.companyId
            }
        });

        if (existingStore) {
            return res.status(400).json({
                success: false,
                message: 'A store with this name already exists in your company'
            });
        }

        const newStore = await Store.create({
            name: name.trim(),
            store_type,
            location: location.trim(),
            phone: phone.trim(),
            email: storeEmail,
            address: address ? address.trim() : null,
            description: description ? description.trim() : null,
            is_active: true, // Default to active
            is_manufacturing: is_manufacturing || false,
            can_receive_po: can_receive_po || false,
            can_issue_to_store: can_issue_to_store || false,
            can_receive_from_store: can_receive_from_store || false,
            can_sale_products: can_sale_products || false,
            is_storage_facility: is_storage_facility || false,
            has_temperature_control: has_temperature_control || false,
            latitude: latitude || null,
            longitude: longitude || null,
            temperature_min: temperature_min || null,
            temperature_max: temperature_max || null,
            settings: settings || {},
            default_currency_id: default_currency_id || null,
            default_price_category_id: default_price_category_id || null,
            created_by: req.user.id,
            updated_by: req.user.id,
            companyId: req.user.companyId
        });

        res.status(201).json({
            success: true,
            message: 'Store created successfully!',
            store: newStore
        });
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            const errors = error.errors.map(e => ({
                field: e.path,
                message: e.message
            }));
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: errors.map(e => e.message),
                errorDetails: errors
            });
        }
        
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({
                success: false,
                message: 'A store with this information already exists'
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Error creating store',
            error: error.message
        });
    }
});

// Update store
router.put('/:id', csrfProtection, async (req, res) => {
    const {
        name,
        store_type,
        location,
        phone,
        email,
        address,
        description,
        is_active,
        is_manufacturing,
        can_receive_po,
        can_issue_to_store,
        can_receive_from_store,
        can_sale_products,
        is_storage_facility,
        has_temperature_control,
        latitude,
        longitude,
        temperature_min,
        temperature_max,
        settings,
        default_currency_id,
        default_price_category_id
    } = req.body;

    try {
        const store = await Store.findByPk(req.params.id);

        if (!store) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        // Update fields
        store.name = name;
        store.store_type = store_type;
        store.location = location;
        store.phone = phone;
        store.email = email;
        store.address = address;
        store.description = description;
        if (typeof is_active !== 'undefined') {
            store.is_active = is_active;
        }
        store.is_manufacturing = is_manufacturing;
        store.can_receive_po = can_receive_po;
        store.can_issue_to_store = can_issue_to_store;
        store.can_receive_from_store = can_receive_from_store;
        store.can_sale_products = can_sale_products;
        store.is_storage_facility = is_storage_facility;
        store.has_temperature_control = has_temperature_control;
        store.latitude = latitude;
        store.longitude = longitude;
        store.temperature_min = temperature_min;
        store.temperature_max = temperature_max;
        store.settings = settings;
        store.default_currency_id = default_currency_id;
        store.default_price_category_id = default_price_category_id;
        store.updated_by = req.user.id;

        await store.save();

        res.json({
            success: true,
            message: 'Store updated successfully!',
            store
        });
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            const messages = error.errors.map(e => e.message);
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: messages
            });
        }
        res.status(500).json({ 
            success: false, 
            message: 'Error updating store' 
        });
    }
});

// Delete store
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const store = await Store.findByPk(req.params.id);

        if (!store) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        await store.destroy();

        res.json({
            success: true,
            message: 'Store deleted successfully!'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting store' 
        });
    }
});

router.post('/import-final', csrfProtection, async (req, res) => {
    try {
        const { stores } = req.body; // Expecting an array of store objects

        if (!stores || !Array.isArray(stores) || stores.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No store data provided or invalid format.' 
            });
        }

        const userId = req.user.id;

        const storesToImport = stores.map((store, index) => {

            // Validate required fields
            const missingFields = [];
            const required = [
                'name', 'store_type', 'location', 'phone',
                'is_active', 'is_manufacturing', 'can_receive_po', 'can_issue_to_store',
                'can_receive_from_store', 'can_sale_products', 'is_storage_facility', 'has_temperature_control'
            ];
            required.forEach(field => {
                // Check for null, undefined, or empty string. Allow boolean false.
                if (store[field] === null || store[field] === undefined || store[field] === '') {
                    missingFields.push(field);
                }
            });

            if (missingFields.length > 0) {
                throw new Error(`Store "${store.name || 'Unknown'}" is missing required fields: ${missingFields.join(', ')}`);
            }

            // Validate email format if provided
            if (store.email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(store.email)) {
                    throw new Error(`Invalid email format "${store.email}" for store "${store.name}"`);
                }
            }

            // Validate store type
            const validStoreTypes = ['pharmacy', 'retail_shop', 'restaurant', 'barber_shop', 'supermarket', 'clothing_store', 'electronics_store', 'hardware_store', 'jewelry_store', 'bookstore', 'other'];
            if (!validStoreTypes.includes(store.store_type)) {
                throw new Error(`Invalid store type "${store.store_type}" for store "${store.name}". Valid types: ${validStoreTypes.join(', ')}`);
            }

            // Validate GPS coordinates if provided
            if (store.latitude !== undefined && store.latitude !== null && store.latitude !== '') {
                const lat = parseFloat(store.latitude);
                if (isNaN(lat) || lat < -90 || lat > 90) {
                    throw new Error(`Invalid latitude "${store.latitude}" for store "${store.name}". Must be between -90 and 90.`);
                }
            }

            if (store.longitude !== undefined && store.longitude !== null && store.longitude !== '') {
                const lng = parseFloat(store.longitude);
                if (isNaN(lng) || lng < -180 || lng > 180) {
                    throw new Error(`Invalid longitude "${store.longitude}" for store "${store.name}". Must be between -180 and 180.`);
                }
            }

            // Validate temperature range if storage facility
            if (store.is_storage_facility === 'true' || store.is_storage_facility === true) {
                if (store.temperature_min !== undefined && store.temperature_min !== null && store.temperature_min !== '' &&
                    store.temperature_max !== undefined && store.temperature_max !== null && store.temperature_max !== '') {
                    const minTemp = parseFloat(store.temperature_min);
                    const maxTemp = parseFloat(store.temperature_max);
                    if (!isNaN(minTemp) && !isNaN(maxTemp) && minTemp >= maxTemp) {
                        throw new Error(`Invalid temperature range for store "${store.name}". Minimum temperature must be less than maximum temperature.`);
                    }
                }
            }

            return {
                companyId: req.user.companyId, // Add companyId for multi-tenant support
                name: store.name.trim(),
                store_type: store.store_type,
                location: store.location.trim(),
                phone: store.phone.trim(),
                email: store.email ? store.email.trim().toLowerCase() : null,
                address: store.address ? store.address.trim() : null,
                description: store.description ? store.description.trim() : null,
                is_active: ['true', '1', 'yes', true].includes(store.is_active),
                // GPS Coordinates
                latitude: store.latitude && store.latitude !== '' ? parseFloat(store.latitude) : null,
                longitude: store.longitude && store.longitude !== '' ? parseFloat(store.longitude) : null,
                // Store Settings
                is_manufacturing: ['true', '1', 'yes', true].includes(store.is_manufacturing),
                can_receive_po: ['true', '1', 'yes', true].includes(store.can_receive_po),
                can_issue_to_store: ['true', '1', 'yes', true].includes(store.can_issue_to_store),
                can_receive_from_store: ['true', '1', 'yes', true].includes(store.can_receive_from_store),
                can_sale_products: ['true', '1', 'yes', true].includes(store.can_sale_products),
                is_storage_facility: ['true', '1', 'yes', true].includes(store.is_storage_facility),
                has_temperature_control: ['true', '1', 'yes', true].includes(store.has_temperature_control),
                temperature_min: store.temperature_min && store.temperature_min !== '' ? parseFloat(store.temperature_min) : null,
                temperature_max: store.temperature_max && store.temperature_max !== '' ? parseFloat(store.temperature_max) : null,
                // Settings (parse JSON if provided)
                settings: store.settings && store.settings !== '' ? (() => {
                    try {
                        return typeof store.settings === 'string' ? JSON.parse(store.settings) : store.settings;
                    } catch (e) {
                        throw new Error(`Invalid JSON in settings field for store "${store.name}": ${e.message}`);
                    }
                })() : null,
                default_currency_id: store.default_currency_id,
                default_price_category_id: store.default_price_category_id,
                created_by: userId,
                updated_by: userId
            };
        });

        const result = await Store.bulkCreate(storesToImport);

        res.status(201).json({ 
            success: true, 
            message: `${storesToImport.length} stores imported successfully!`,
            importedCount: storesToImport.length
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message || 'An error occurred during the final import process.' 
        });
    }
});

// Search stores by name, location, or email
router.get('/search/:term', async (req, res) => {
    try {
        const searchTerm = req.params.term;
        const stores = await Store.findAll({
            where: {
                [Sequelize.Op.or]: [
                    { name: { [Sequelize.Op.iLike]: `%${searchTerm}%` } },
                    { location: { [Sequelize.Op.iLike]: `%${searchTerm}%` } },
                    { email: { [Sequelize.Op.iLike]: `%${searchTerm}%` } }
                ]
            }
        });
        res.json({
            success: true,
            stores
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error searching stores'
        });
    }
});

module.exports = router; 