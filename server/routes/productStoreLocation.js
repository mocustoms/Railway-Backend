const express = require('express');
const router = express.Router();
const ProductStoreLocation = require('../models/productStoreLocation');
const Store = require('../models/store');
const User = require('../models/user');
const { Company } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { generateNextCode } = require('../utils/autoCodeService');
const PDFDocument = require('pdfkit');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all store locations with related data
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 25, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        
        const offset = (page - 1) * limit;
        const whereClause = {};
        
        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { location_name: { [Op.iLike]: `%${search}%` } }
            ];
        }

        const { count, rows: storeLocations } = await ProductStoreLocation.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
                {
                    model: Store,
                    as: 'storeLocation',
                    attributes: ['id', 'name', 'location'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Transform data to include related names
        const transformedStoreLocations = storeLocations.map(location => {
            const plainLocation = location.get({ plain: true });
            return {
                ...plainLocation,
                store_name: plainLocation.storeLocation ? plainLocation.storeLocation.name : null,
                store_location: plainLocation.storeLocation ? plainLocation.storeLocation.location : null,
                created_by_name: plainLocation.createdByUser ? 
                    `${plainLocation.createdByUser.first_name} ${plainLocation.createdByUser.last_name}` : null,
                updated_by_name: plainLocation.updatedByUser ? 
                    `${plainLocation.updatedByUser.first_name} ${plainLocation.updatedByUser.last_name}` : null,
                createdAt: plainLocation.created_at || plainLocation.createdAt,
                updatedAt: plainLocation.updated_at || plainLocation.updatedAt
            };
        });

        res.json({
            storeLocations: transformedStoreLocations,
            pagination: {
                totalItems: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit),
                startIndex: offset,
                endIndex: Math.min(offset + parseInt(limit), count)
            }
        });
    } catch (error) {
        if (error && error.stack) {
            }
        res.status(500).json({ error: 'Failed to fetch store locations', details: error.message });
    }
});

// Get active store locations for dropdowns
router.get('/active', async (req, res) => {
    try {
        // Build where clause with company filter and active status
        const whereClause = buildCompanyWhere(req, { is_active: true });
        
        const storeLocations = await ProductStoreLocation.findAll({
            where: whereClause,
            include: [{ 
                model: Store, 
                as: 'storeLocation', 
                attributes: ['id', 'name', 'location'],
                required: false
            }],
            order: [['location_name', 'ASC']]
        });
        
        const transformed = storeLocations.map(location => {
            const plainLocation = location.get({ plain: true });
            return {
                id: plainLocation.id,
                location_code: plainLocation.location_code,
                location_name: plainLocation.location_name,
                store_id: plainLocation.store_id,
                store_name: plainLocation.storeLocation?.name,
                store_location: plainLocation.storeLocation?.location,
                capacity: plainLocation.location_capacity,
                packaging_types: plainLocation.packaging_type,
                is_active: plainLocation.is_active
            };
        });
        
        res.json(transformed);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching active store locations',
            details: error.message
        });
    }
});

// Get single store location by ID
router.get('/:id', async (req, res) => {
    try {
        const storeLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            attributes: {
                include: ['created_at', 'updated_at']
            },
            include: [
                {
                    model: Store,
                    as: 'storeLocation',
                    attributes: ['id', 'name', 'location'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        if (!storeLocation) {
            return res.status(404).json({ message: 'Store location not found' });
        }

        const plainLocation = storeLocation.get({ plain: true });
        const transformedLocation = {
            ...plainLocation,
            store_name: plainLocation.storeLocation ? plainLocation.storeLocation.name : null,
            store_location: plainLocation.storeLocation ? plainLocation.storeLocation.location : null,
            created_by_name: plainLocation.createdByUser ? 
                `${plainLocation.createdByUser.first_name} ${plainLocation.createdByUser.last_name}` : null,
            updated_by_name: plainLocation.updatedByUser ? 
                `${plainLocation.updatedByUser.first_name} ${plainLocation.updatedByUser.last_name}` : null,
            createdAt: plainLocation.created_at || plainLocation.createdAt,
            updatedAt: plainLocation.updated_at || plainLocation.updatedAt
        };

        res.json(transformedLocation);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch store location', details: error.message });
    }
});

// Create new store location
router.post('/', csrfProtection, async (req, res) => {
    const transaction = await ProductStoreLocation.sequelize.transaction();
    
    try {
        const userId = req.user.id;
        const { store_id, location_code, location_name, location_capacity, packaging_type, is_active } = req.body;

        if (!store_id || !location_name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'store_id and location_name are required.' });
        }

        // Code is now auto-generated, validate other fields
        if (!location_name.trim()) {
            await transaction.rollback();
            return res.status(400).json({ error: 'location_name is required.' });
        }

        // Get company code for code generation
        let companyCode = 'EMZ';
        try {
            const company = await Company.findByPk(req.user.companyId, {
                attributes: ['code', 'name'],
                transaction
            });
            
            if (company?.code) {
                companyCode = company.code.toUpperCase();
            } else if (company?.name) {
                companyCode = company.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMZ';
            }
        } catch (companyError) {
            // Continue with default companyCode
        }

        // Auto-generate store location code
        const storeLocationCode = await generateNextCode(
            'product_store_locations',
            req.user.companyId,
            {
                transaction,
                fallbackPrefix: 'LOC',
                fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
                companyCode: companyCode
            }
        );

        // Validate that code was generated
        if (!storeLocationCode || !storeLocationCode.trim()) {
            await transaction.rollback();
            return res.status(500).json({ 
                error: 'Failed to generate store location code. Please try again.',
                message: 'Code generation failed'
            });
        }

        let packagingTypeValue = packaging_type;
        if (packagingTypeValue && typeof packagingTypeValue === 'string') {
            try {
                packagingTypeValue = JSON.parse(packagingTypeValue);
            } catch (e) {
                packagingTypeValue = packagingTypeValue.split(',').map(item => item.trim());
            }
        }

        const locationData = {
            store_id,
            location_code: storeLocationCode.toUpperCase().trim(),
            location_name,
            location_capacity,
            packaging_type: packagingTypeValue,
            is_active: is_active !== undefined ? is_active : true,
            created_by: userId,
            updated_by: userId
        };

        const storeLocation = await ProductStoreLocation.create({
            ...locationData,
            companyId: req.user.companyId
        }, { transaction });
        
        await transaction.commit();
        
        // Fetch the created location with related data
        const createdLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: storeLocation.id }),
            include: [
                {
                    model: Store,
                    as: 'storeLocation',
                    attributes: ['id', 'name', 'location'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        const plainLocation = createdLocation.get({ plain: true });
        const transformedLocation = {
            ...plainLocation,
            store_name: plainLocation.storeLocation ? plainLocation.storeLocation.name : null,
            store_location: plainLocation.storeLocation ? plainLocation.storeLocation.location : null,
            created_by_name: plainLocation.createdByUser ? 
                `${plainLocation.createdByUser.first_name} ${plainLocation.createdByUser.last_name}` : null,
            createdAt: plainLocation.created_at || plainLocation.createdAt,
            updatedAt: plainLocation.updated_at || plainLocation.updatedAt
        };

        res.status(201).json(transformedLocation);
    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                error: 'Validation error', 
                details: error.errors.map(e => ({ field: e.path, message: e.message }))
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                error: 'Duplicate entry', 
                details: 'A store location with this name already exists in this store'
            });
        }
        res.status(500).json({ error: 'Failed to create store location', details: error.message });
    }
});

// Update store location
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const userId = req.user.id;
        const storeLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!storeLocation) {
            return res.status(404).json({ message: 'Store location not found' });
        }

        const updateData = {
            ...req.body,
            updated_by: userId
        };

        // Code cannot be updated - it's auto-generated
        // Remove location_code from update data if present
        delete updateData.location_code;

        // Handle packaging_type array
        if (updateData.packaging_type && typeof updateData.packaging_type === 'string') {
            try {
                updateData.packaging_type = JSON.parse(updateData.packaging_type);
            } catch (e) {
                updateData.packaging_type = updateData.packaging_type.split(',').map(item => item.trim());
            }
        }

        await storeLocation.update(updateData);
        
        // Fetch the updated location with related data
        const updatedLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: Store,
                    as: 'storeLocation',
                    attributes: ['id', 'name', 'location'],
                    required: false
                },
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updatedByUser',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        const plainLocation = updatedLocation.get({ plain: true });
        const transformedLocation = {
            ...plainLocation,
            store_name: plainLocation.storeLocation ? plainLocation.storeLocation.name : null,
            store_location: plainLocation.storeLocation ? plainLocation.storeLocation.location : null,
            created_by_name: plainLocation.createdByUser ? 
                `${plainLocation.createdByUser.first_name} ${plainLocation.createdByUser.last_name}` : null,
            updated_by_name: plainLocation.updatedByUser
                ? `${plainLocation.updatedByUser.first_name} ${plainLocation.updatedByUser.last_name}`
                : (plainLocation.createdByUser
                    ? `${plainLocation.createdByUser.first_name} ${plainLocation.createdByUser.last_name}`
                    : null),
            createdAt: plainLocation.created_at || plainLocation.createdAt,
            updatedAt: plainLocation.updated_at || plainLocation.updatedAt
        };

        res.json(transformedLocation);
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                error: 'Validation error', 
                details: error.errors.map(e => ({ field: e.path, message: e.message }))
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                error: 'Duplicate entry', 
                details: 'A store location with this name already exists in this store'
            });
        }
        res.status(500).json({ error: 'Failed to update store location', details: error.message });
    }
});

// Delete store location
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const storeLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!storeLocation) {
            return res.status(404).json({ message: 'Store location not found' });
        }

        await storeLocation.destroy();
        res.json({ message: 'Store location deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete store location', details: error.message });
    }
});

// Get locations by store ID
router.get('/store/:storeId', async (req, res) => {
    try {
        const locations = await ProductStoreLocation.findAll({
            where: buildCompanyWhere(req, { store_id: req.params.storeId }),
            order: [['created_at', 'DESC']]
        });

        res.json(locations);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch locations by store', details: error.message });
    }
});

// Get store location statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const totalLocations = await ProductStoreLocation.count({
            where: buildCompanyWhere(req)
        });
        const activeLocations = await ProductStoreLocation.count({ 
            where: buildCompanyWhere(req, { is_active: true })
        });
        const inactiveLocations = await ProductStoreLocation.count({ 
            where: buildCompanyWhere(req, { is_active: false })
        });

        res.json({
            success: true,
            data: {
                total: totalLocations,
                active: activeLocations,
                inactive: inactiveLocations
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch store location statistics', 
            details: error.message 
        });
    }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, status, store_id } = req.query;
        
        // Build where clause
        let whereClause = {};
        if (search) {
            whereClause = {
                [Op.or]: [
                    { location_name: { [Op.iLike]: `%${search}%` } },
                    { location_code: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }
        if (store_id) {
            whereClause.store_id = store_id;
        }

        const locations = await ProductStoreLocation.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Store,
                    as: 'storeLocation',
                    attributes: ['name', 'location']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Transform data for Excel with proper null handling
        const excelData = locations.map(location => {
            const packagingTypes = location.packaging_type;
            let packagingTypesStr = 'N/A';
            
            if (packagingTypes) {
                if (Array.isArray(packagingTypes)) {
                    packagingTypesStr = packagingTypes.join(', ');
                } else if (typeof packagingTypes === 'string') {
                    try {
                        const parsed = JSON.parse(packagingTypes);
                        packagingTypesStr = Array.isArray(parsed) ? parsed.join(', ') : packagingTypes;
                    } catch {
                        packagingTypesStr = packagingTypes;
                    }
                }
            }

            return {
                'Location Code': location.location_code || '',
                'Location Name': location.location_name || '',
                'Store': location.storeLocation?.name || '',
                'Store Location': location.storeLocation?.location || '',
                'Capacity': location.location_capacity || 0,
                'Packaging Types': packagingTypesStr,
                'Status': location.is_active ? 'Active' : 'Inactive',
                'Created At': location.created_at ? new Date(location.created_at).toLocaleDateString() : '',
                'Updated At': location.updated_at ? new Date(location.updated_at).toLocaleDateString() : ''
            };
        });

        // Handle empty data case
        if (excelData.length === 0) {
            const headers = ['Location Code', 'Location Name', 'Store', 'Store Location', 'Capacity', 'Packaging Types', 'Status', 'Created At', 'Updated At'];
            const csvContent = headers.join(',') + '\n';
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="store-locations-${new Date().toISOString().split('T')[0]}.csv"`);
            return res.send(csvContent);
        }

        // Convert to CSV format with proper escaping
        const headers = Object.keys(excelData[0]);
        const csvContent = [
            headers.join(','),
            ...excelData.map(row => 
                headers.map(header => {
                    const value = row[header] || '';
                    // Escape quotes and wrap in quotes if contains comma, quote, or newline
                    const escapedValue = String(value).replace(/"/g, '""');
                    return `"${escapedValue}"`;
                }).join(',')
            )
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="store-locations-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvContent);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export store locations', details: error.message });
    }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, status, store_id } = req.query;
        
        // Build where clause
        let whereClause = {};
        if (search) {
            whereClause = {
                [Op.or]: [
                    { location_name: { [Op.iLike]: `%${search}%` } },
                    { location_code: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }
        if (status && status !== 'all') {
            whereClause.is_active = status === 'active';
        }
        if (store_id) {
            whereClause.store_id = store_id;
        }

        const locations = await ProductStoreLocation.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Store,
                    as: 'storeLocation',
                    attributes: ['name', 'location']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Transform data for PDF with proper null handling
        const pdfData = locations.map(location => {
            const packagingTypes = location.packaging_type;
            let packagingTypesStr = 'N/A';
            
            if (packagingTypes) {
                if (Array.isArray(packagingTypes)) {
                    packagingTypesStr = packagingTypes.join(', ');
                } else if (typeof packagingTypes === 'string') {
                    try {
                        const parsed = JSON.parse(packagingTypes);
                        packagingTypesStr = Array.isArray(parsed) ? parsed.join(', ') : packagingTypes;
                    } catch {
                        packagingTypesStr = packagingTypes;
                    }
                }
            }

            return {
                'Location Code': location.location_code || '',
                'Location Name': location.location_name || '',
                'Store': location.storeLocation?.name || '',
                'Store Location': location.storeLocation?.location || '',
                'Capacity': location.location_capacity || 0,
                'Packaging Types': packagingTypesStr,
                'Status': location.is_active ? 'Active' : 'Inactive',
                'Created At': location.created_at ? new Date(location.created_at).toLocaleDateString() : '',
                'Updated At': location.updated_at ? new Date(location.updated_at).toLocaleDateString() : ''
            };
        });

        // Create PDF document
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const buffer = Buffer.concat(chunks);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=store-locations-${new Date().toISOString().split('T')[0]}.pdf`);
            res.send(buffer);
        });

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Store Locations', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (search || status !== 'all' || store_id) {
            doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
            if (search) {
                doc.fontSize(10).font('Helvetica').text(`Search: ${search}`);
            }
            if (status !== 'all') {
                doc.fontSize(10).font('Helvetica').text(`Status: ${status}`);
            }
            if (store_id) {
                doc.fontSize(10).font('Helvetica').text(`Store ID: ${store_id}`);
            }
            doc.moveDown();
        }

        // Add table headers
        const headers = ['Location Code', 'Location Name', 'Store', 'Store Location', 'Capacity', 'Packaging Types', 'Status'];
        const columnWidths = [80, 120, 100, 100, 60, 120, 60];
        let yPosition = doc.y;

        // Draw header row
        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, index) => {
            doc.text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveDown();

        // Draw data rows
        doc.fontSize(9).font('Helvetica');
        pdfData.forEach((location, index) => {
            // Check if we need a new page
            if (yPosition > 700) {
                doc.addPage();
                yPosition = 50;
            }

            const rowData = [
                location['Location Code'],
                location['Location Name'],
                location['Store'],
                location['Store Location'],
                location['Capacity'],
                location['Packaging Types'],
                location['Status']
            ];

            rowData.forEach((cell, cellIndex) => {
                const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
                doc.text(cell || 'N/A', x, yPosition);
            });

            yPosition += 15;
        });

        doc.end();
    } catch (error) {
        res.status(500).json({ error: 'Failed to export store locations', details: error.message });
    }
});

// Check if store location is being used
router.get('/:id/usage', async (req, res) => {
    try {
        const Product = require('../models/product'); // Dynamically require Product model
        const usageCount = await Product.count({
            where: {
                store_location_id: req.params.id
            }
        });
        res.json({
            isUsed: usageCount > 0,
            usageCount: usageCount,
            message: usageCount > 0
                ? `This store location is used by ${usageCount} product(s)`
                : 'This store location is not used by any products'
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Deactivate store location (for used locations)
router.put('/:id/deactivate', csrfProtection, async (req, res) => {
    try {
        const storeLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!storeLocation) {
            return res.status(404).json({ error: 'Store location not found' });
        }

        await storeLocation.update({
            is_active: false,
            updated_by: req.user.id
        });

        res.json({
            message: 'Store location deactivated successfully',
            storeLocation: storeLocation
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete store location (only if not used)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const storeLocation = await ProductStoreLocation.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!storeLocation) {
            return res.status(404).json({ message: 'Store location not found' });
        }

        // Check if location is being used
        const Product = require('../models/product'); // Dynamically require Product model
        const usageCount = await Product.count({
            where: {
                store_location_id: req.params.id
            }
        });

        if (usageCount > 0) {
            return res.status(400).json({
                error: 'Cannot delete store location',
                message: `This store location is used by ${usageCount} product(s). Please deactivate it instead.`,
                isUsed: true,
                usageCount: usageCount
            });
        }

        // If not used, perform hard delete
        await storeLocation.destroy();
        res.json({
            message: 'Store location deleted successfully',
            isUsed: false
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete store location', details: error.message });
    }
});

module.exports = router; 