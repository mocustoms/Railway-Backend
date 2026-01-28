const express = require('express');
const router = express.Router();
const ExchangeRate = require('../models/exchangeRate');
const Currency = require('../models/currency');
const User = require('../models/user');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ExchangeRateService = require('../services/exchangeRateService');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// GET /api/exchange-rates/all-active - Get all active exchange rates (for calculations)
router.get('/all-active', async (req, res) => {
    try {
        const currentDate = new Date();
        
        const activeExchangeRates = await ExchangeRate.findAll({
            where: buildCompanyWhere(req, {
                is_active: true,
                effective_date: {
                    [Op.lte]: currentDate
                }
            }),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                }
            ],
            order: [['effective_date', 'DESC']]
        });

        res.json(activeExchangeRates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active exchange rates' });
    }
});

// GET /api/exchange-rates - Get all exchange rates with pagination and search
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 25, search = '', sort = 'effective_date', order = 'desc' } = req.query;
        
        const offset = (page - 1) * limit;
        const whereClause = {};
        
        // Add search functionality
        if (search) {
            whereClause[Op.or] = [
                { '$fromCurrency.code$': { [Op.iLike]: `%${search}%` } },
                { '$fromCurrency.name$': { [Op.iLike]: `%${search}%` } },
                { '$toCurrency.code$': { [Op.iLike]: `%${search}%` } },
                { '$toCurrency.name$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        const { count, rows: exchangeRates } = await ExchangeRate.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['id', 'code', 'name', 'symbol'],
                    required: false
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['id', 'code', 'name', 'symbol'],
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ],
            order: [[sort, order.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Transform data to include related names
        const transformedExchangeRates = exchangeRates.map(rate => {
            const plainRate = rate.get({ plain: true });
            return {
                ...plainRate,
                from_currency_name: plainRate.fromCurrency ? plainRate.fromCurrency.name : null,
                to_currency_name: plainRate.toCurrency ? plainRate.toCurrency.name : null,
                created_by_name: plainRate.creator ? 
                    `${plainRate.creator.first_name} ${plainRate.creator.last_name}` : null,
                updated_by_name: plainRate.updater ? 
                    `${plainRate.updater.first_name} ${plainRate.updater.last_name}` : null
            };
        });

        res.json({
            data: transformedExchangeRates,
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(count / limit),
            pagination: {
                totalItems: count,
                currentPage: parseInt(page),
                totalPages: Math.ceil(count / limit),
                hasNextPage: parseInt(page) < Math.ceil(count / limit),
                hasPrevPage: parseInt(page) > 1,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exchange rates', details: error.message });
    }
});

// GET /api/exchange-rates/statistics - Get exchange rate statistics
router.get('/statistics', async (req, res) => {
    try {
        // Get total exchange rates
        const totalRates = await ExchangeRate.count({
            where: buildCompanyWhere(req)
        });

        // Get active exchange rates
        const activeRates = await ExchangeRate.count({
            where: buildCompanyWhere(req, { is_active: true })
        });

        // Get expired exchange rates (rates with effective_date in the past and not active)
        const expiredRates = await ExchangeRate.count({
            where: buildCompanyWhere(req, {
                effective_date: { [Op.lt]: new Date() },
                is_active: false
            })
        });

        // Get last update
        const lastUpdate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req),
            order: [['updated_at', 'DESC']],
            attributes: ['updated_at']
        });

        const stats = {
            totalRates,
            activeRates,
            expiredRates,
            lastUpdate: lastUpdate ? new Date(lastUpdate.updated_at).toLocaleDateString() : 'Never'
        };

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exchange rate statistics', details: error.message });
    }
});

// GET /api/exchange-rates/history/:from_currency_id/:to_currency_id - Get exchange rate history
router.get('/history/:from_currency_id/:to_currency_id', async (req, res) => {
    try {
        const { from_currency_id, to_currency_id } = req.params;
        const { limit = 50 } = req.query;

        const history = await ExchangeRate.findAll({
            where: buildCompanyWhere(req, {
                from_currency_id,
                to_currency_id
            }),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['id', 'code', 'name', 'symbol'],
                    required: false
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['id', 'code', 'name', 'symbol'],
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name', 'username'],
                    required: false
                }
            ],
            order: [['effective_date', 'DESC']],
            limit: parseInt(limit)
        });

        const fromCurrency = history.length > 0 ? history[0].fromCurrency : null;
        const toCurrency = history.length > 0 ? history[0].toCurrency : null;

        res.json({
            history: history.map(rate => ({
                id: rate.id,
                rate: rate.rate,
                effective_date: rate.effective_date,
                is_active: rate.is_active,
                created_at: rate.created_at,
                created_by: rate.created_by,
                creator: rate.creator
            })),
            fromCurrency,
            toCurrency
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exchange rate history', details: error.message });
    }
});

// GET /api/exchange-rates/:id - Get single exchange rate
router.get('/:id', async (req, res) => {
    try {
        const exchangeRate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['id', 'code', 'name', 'symbol'],
                    required: false
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['id', 'code', 'name', 'symbol'],
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false
                }
            ]
        });

        if (!exchangeRate) {
            return res.status(404).json({ message: 'Exchange rate not found' });
        }

        const plainRate = exchangeRate.get({ plain: true });
        const transformedRate = {
            ...plainRate,
            from_currency_name: plainRate.fromCurrency ? plainRate.fromCurrency.name : null,
            to_currency_name: plainRate.toCurrency ? plainRate.toCurrency.name : null,
            created_by_name: plainRate.creator ? 
                `${plainRate.creator.first_name} ${plainRate.creator.last_name}` : null,
            updated_by_name: plainRate.updater ? 
                `${plainRate.updater.first_name} ${plainRate.updater.last_name}` : null
        };

        res.json(transformedRate);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/exchange-rates - Create new exchange rate
router.post('/', csrfProtection, async (req, res) => {
    try {
        const {
            from_currency_id,
            to_currency_id,
            rate,
            effective_date,
            is_active
        } = req.body;

        // Use the service to create exchange rate
        const exchangeRate = await ExchangeRateService.createExchangeRate(
            {
                from_currency_id,
                to_currency_id,
                rate,
                effective_date,
                is_active
            },
            req.user.companyId,
            req.user.id
        );

        res.status(201).json(exchangeRate);
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ message: error.errors[0].message });
        }
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/exchange-rates/:id - Update exchange rate
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const exchangeRate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!exchangeRate) {
            return res.status(404).json({ message: 'Exchange rate not found' });
        }

        const {
            from_currency_id,
            to_currency_id,
            rate,
            effective_date,
            is_active
        } = req.body;

        // Validate required fields
        if (!from_currency_id || !to_currency_id || !rate || !effective_date) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        await exchangeRate.update({
            from_currency_id,
            to_currency_id,
            rate: parseFloat(rate),
            effective_date,
            is_active: is_active !== undefined ? is_active : exchangeRate.is_active,
            updated_by: req.user.id
        });

        res.json(exchangeRate);
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ message: error.errors[0].message });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/exchange-rates/:id - Delete exchange rate
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const exchangeRate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        if (!exchangeRate) {
            return res.status(404).json({ message: 'Exchange rate not found' });
        }

        await exchangeRate.destroy();
        res.json({ message: 'Exchange rate deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PATCH /api/exchange-rates/:id/toggle-status - Toggle exchange rate status
router.patch('/:id/toggle-status', async (req, res) => {
    try {
        const { is_active } = req.body;
        const exchangeRate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });
        
        if (!exchangeRate) {
            return res.status(404).json({ message: 'Exchange rate not found' });
        }

        await exchangeRate.update({
            is_active: is_active,
            updated_by: req.user.id
        });

        res.json(exchangeRate);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/exchange-rates/export/excel - Export exchange rates to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search = '', status = 'all', dateFrom = '', dateTo = '' } = req.query;

        // Build where clause
        let whereClause = {};

        if (search && search.trim()) {
            whereClause[Op.or] = [
                { '$fromCurrency.code$': { [Op.iLike]: `%${search.trim()}%` } },
                { '$fromCurrency.name$': { [Op.iLike]: `%${search.trim()}%` } },
                { '$toCurrency.code$': { [Op.iLike]: `%${search.trim()}%` } },
                { '$toCurrency.name$': { [Op.iLike]: `%${search.trim()}%` } }
            ];
        }

        if (status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        if (dateFrom) {
            whereClause.effective_date = { [Op.gte]: dateFrom };
        }

        if (dateTo) {
            whereClause.effective_date = { 
                ...whereClause.effective_date, 
                [Op.lte]: dateTo 
            };
        }

        const exchangeRates = await ExchangeRate.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['code', 'name'],
                    required: false
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['first_name', 'last_name', 'username'],
                    required: false
                }
            ],
            order: [['effective_date', 'DESC']]
        });

        // Prepare data for Excel
        const excelData = exchangeRates.map(rate => ({
            'From Currency': rate.fromCurrency ? `${rate.fromCurrency.code} - ${rate.fromCurrency.name}` : 'N/A',
            'To Currency': rate.toCurrency ? `${rate.toCurrency.code} - ${rate.toCurrency.name}` : 'N/A',
            'Exchange Rate': parseFloat(rate.rate).toFixed(6),
            'Effective Date': new Date(rate.effective_date).toLocaleDateString(),
            'Status': rate.is_active ? 'Active' : 'Inactive',
            'Created By': rate.creator ? 
                `${rate.creator.first_name || ''} ${rate.creator.last_name || ''}`.trim() || 
                rate.creator.username : 'N/A',
            'Created Date': rate.created_at ? new Date(rate.created_at).toLocaleDateString() : 'N/A'
        }));

        // Create workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(excelData);

        // Set column widths
        const columnWidths = [
            { wch: 20 }, // From Currency
            { wch: 20 }, // To Currency
            { wch: 15 }, // Exchange Rate
            { wch: 15 }, // Effective Date
            { wch: 10 }, // Status
            { wch: 20 }, // Created By
            { wch: 15 }  // Created Date
        ];
        worksheet['!cols'] = columnWidths;

        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Exchange Rates');

        // Generate buffer
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        // Set headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=exchange-rates-${new Date().toISOString().split('T')[0]}.xlsx`);

        res.send(buffer);
    } catch (error) {
        res.status(500).json({ message: 'Failed to export to Excel' });
    }
});

// GET /api/exchange-rates/export/pdf - Export exchange rates to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search = '', status = 'all', dateFrom = '', dateTo = '' } = req.query;

        // Build where clause
        let whereClause = {};

        if (search && search.trim()) {
            whereClause[Op.or] = [
                { '$fromCurrency.code$': { [Op.iLike]: `%${search.trim()}%` } },
                { '$fromCurrency.name$': { [Op.iLike]: `%${search.trim()}%` } },
                { '$toCurrency.code$': { [Op.iLike]: `%${search.trim()}%` } },
                { '$toCurrency.name$': { [Op.iLike]: `%${search.trim()}%` } }
            ];
        }

        if (status !== 'all') {
            whereClause.is_active = status === 'active';
        }

        if (dateFrom) {
            whereClause.effective_date = { [Op.gte]: dateFrom };
        }

        if (dateTo) {
            whereClause.effective_date = { 
                ...whereClause.effective_date, 
                [Op.lte]: dateTo 
            };
        }

        const exchangeRates = await ExchangeRate.findAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: Currency,
                    as: 'fromCurrency',
                    attributes: ['code', 'name'],
                    required: false
                },
                {
                    model: Currency,
                    as: 'toCurrency',
                    attributes: ['code', 'name'],
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['first_name', 'last_name', 'username'],
                    required: false
                }
            ],
            order: [['effective_date', 'DESC']]
        });

        // Create PDF document
        const doc = new PDFDocument({ margin: 50 });

        // Set headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=exchange-rates-${new Date().toISOString().split('T')[0]}.pdf`);

        // Pipe PDF to response
        doc.pipe(res);

        // Add title
        doc.fontSize(20).text('Exchange Rates Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Add table headers
        const tableTop = doc.y;
        const tableLeft = 50;
        const columnWidth = 70;
        const rowHeight = 20;

        // Headers
        const headers = ['From', 'To', 'Rate', 'Date', 'Status'];
        headers.forEach((header, i) => {
            doc.fontSize(10).text(header, tableLeft + (i * columnWidth), tableTop);
        });

        // Draw header line
        doc.moveTo(tableLeft, tableTop + 15).lineTo(tableLeft + (headers.length * columnWidth), tableTop + 15).stroke();

        // Add data rows
        let currentY = tableTop + 20;
        exchangeRates.forEach((rate, index) => {
            if (currentY > 700) { // New page if needed
                doc.addPage();
                currentY = 50;
            }

            const rowData = [
                rate.fromCurrency ? `${rate.fromCurrency.code}` : 'N/A',
                rate.toCurrency ? `${rate.toCurrency.code}` : 'N/A',
                parseFloat(rate.rate).toFixed(6),
                new Date(rate.effective_date).toLocaleDateString(),
                rate.is_active ? 'Active' : 'Inactive'
            ];

            rowData.forEach((cell, i) => {
                doc.fontSize(9).text(cell, tableLeft + (i * columnWidth), currentY);
            });

            currentY += rowHeight;
        });

        // Add summary
        doc.moveDown(2);
        doc.fontSize(12).text(`Total Exchange Rates: ${exchangeRates.length}`, { align: 'center' });

        // Finalize PDF
        doc.end();
    } catch (error) {
        res.status(500).json({ message: 'Failed to export to PDF' });
    }
});

module.exports = router; 