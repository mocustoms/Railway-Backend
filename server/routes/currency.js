const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { Sequelize, Op } = require('sequelize');
const { Currency, User, ExchangeRate, Company } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const autoCodeService = require('../utils/autoCodeService');
const sequelize = require('../../config/database');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// GET /api/currency - Get all currencies with pagination, search, and sorting
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sort = 'name',
      order = 'asc',
      status = 'all',
      is_default = 'all'
    } = req.query;

    const offset = (page - 1) * limit;
    const pageSize = parseInt(limit);

    // Build where clause
    let whereClause = {};
    
    if (search && search.trim()) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { code: { [Op.iLike]: `%${search.trim()}%` } },
        { symbol: { [Op.iLike]: `%${search.trim()}%` } },
        { country: { [Op.iLike]: `%${search.trim()}%` } }
      ];
    }

    if (status !== 'all') {
      whereClause.is_active = status === 'active';
    }

    if (is_default !== 'all') {
      whereClause.is_default = is_default === 'default';
    }

    // Validate sort field
    const allowedSortFields = ['name', 'code', 'symbol', 'is_default', 'is_active', 'created_at', 'updated_at'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'name';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // Get currencies with pagination (with company filter)
    const { count, rows: currencies } = await Currency.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'created_by'
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'updated_by'
        }
      ],
      order: [[sortField, sortOrder]],
      limit: pageSize,
      offset: offset,
      distinct: true
    });

    const currenciesWithNames = currencies.map(currency => ({
      ...currency.toJSON(),
      creator_name: currency.creator ? 
        `${currency.creator.first_name || ''} ${currency.creator.last_name || ''}`.trim() || 
        currency.creator.username : 'N/A',
      updater_name: currency.updater ? 
        `${currency.updater.first_name || ''} ${currency.updater.last_name || ''}`.trim() || 
        currency.updater.username : 'N/A'
    }));

    const totalPages = Math.ceil(count / pageSize);

    res.json({
      currencies: currenciesWithNames,
      total: count,
      page: parseInt(page),
      limit: pageSize,
      totalPages
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/currency/:id - Get currency by ID
router.get('/:id', async (req, res) => {
  try {
    const currency = await Currency.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'created_by'
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'updated_by'
        }
      ]
    });

    if (!currency) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    res.json(currency);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Validation rules for currency creation
const currencyValidation = [
  body('name')
    .notEmpty()
    .withMessage('Currency name is required')
    .isLength({ max: 100 })
    .withMessage('Currency name must be 100 characters or less'),
  body('symbol')
    .notEmpty()
    .withMessage('Currency symbol is required')
    .isLength({ max: 10 })
    .withMessage('Currency symbol must be 10 characters or less'),
  body('country')
    .optional({ nullable: true, checkFalsy: true }),
  body('flag')
    .optional({ nullable: true, checkFalsy: true }),
  body('is_default')
    .optional({ nullable: true }),
  body('is_active')
    .optional({ nullable: true })
];

// POST /api/currency - Create new currency
router.post('/', currencyValidation, csrfProtection, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation error',
      errors: errors.array()
    });
  }

  // Start transaction for atomic code generation and currency creation
  const transaction = await Currency.sequelize.transaction();
  
  try {
    const {
      name,
      symbol,
      country,
      flag,
      is_default = false,
      is_active = true
    } = req.body;

    // Ensure user has a company (unless super-admin)
    if (!req.user.isSystemAdmin && !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Company access required. Please contact your administrator.' });
    }

    // Validate name and symbol are not empty after trimming
    const trimmedName = (name || '').trim();
    const trimmedSymbol = (symbol || '').trim();
    
    if (!trimmedName) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Currency name is required',
        error: 'Validation error'
      });
    }
    
    if (!trimmedSymbol) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Currency symbol is required',
        error: 'Validation error'
      });
    }

    // Get company code for code generation (simplified)
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

    // Auto-generate currency code (simple, no retry needed - autoCodeService handles uniqueness)
    const currencyCode = await autoCodeService.generateNextCode(
      'currencies',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'CUR',
        fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
        companyCode: companyCode
      }
    );

    // Validate that code was generated
    if (!currencyCode || !currencyCode.trim()) {
      await transaction.rollback();
      return res.status(500).json({ 
        error: 'Failed to generate currency code. Please try again.',
        message: 'Code generation failed'
      });
    }

    // Create currency (trim strings here, not in validation)
    const currency = await Currency.create({
      code: currencyCode.toUpperCase().trim(),
      name: trimmedName,
      symbol: trimmedSymbol,
      country: country ? country.trim() : null,
      flag: flag ? flag.trim() : null,
      is_default: is_default === true || is_default === 'true' || is_default === 1 || is_default === '1',
      is_active: is_active !== false && is_active !== 'false' && is_active !== 0 && is_active !== '0',
      created_by: req.user.id,
      companyId: req.user.companyId
    }, { transaction });
      
    await transaction.commit();
    res.status(201).json(currency);
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    
    // Handle Sequelize unique constraint errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ 
        error: 'Currency code already exists in your company' 
      });
    }
    
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      // Check if it's a missing required fields error
      const missingFields = error.errors
        ?.filter(e => e.type === 'notNull Violation' || e.message?.toLowerCase().includes('cannot be null'))
        .map(e => {
          // Map Sequelize field names to user-friendly names
          const fieldMap = {
            'code': 'Code',
            'name': 'Name',
            'symbol': 'Symbol',
            'companyId': 'Company'
          };
          return fieldMap[e.path] || (e.path.charAt(0).toUpperCase() + e.path.slice(1));
        })
        .filter(Boolean) || [];
      
      if (missingFields.length > 0) {
        return res.status(400).json({ 
          message: `${missingFields.join(', ')} ${missingFields.length === 1 ? 'is' : 'are'} required`,
          error: `Missing required fields: ${missingFields.join(', ')}`,
          errors: error.errors.map(e => ({
            field: e.path,
            message: e.message
          }))
        });
      }
      
      const errors = error.errors?.map(e => ({
        field: e.path,
        message: e.message
      })) || [];
      return res.status(400).json({ 
        error: 'Validation error',
        errors 
      });
    }
    
    // Handle any other errors that might have the message format
    if (error.message && error.message.includes('required')) {
      return res.status(400).json({ 
        error: error.message,
        details: error
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/currency/:id - Update currency
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const currency = await Currency.findByPk(req.params.id);
    if (!currency) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    const {
      code,
      name,
      symbol,
      country,
      flag,
      is_default,
      is_active
    } = req.body;

    // Check if currency code already exists (excluding current currency, within same company)
    // Always check within company, even for super-admins
    if (code && code.toUpperCase() !== currency.code) {
      if (!req.user.companyId) {
        return res.status(400).json({ message: 'Company ID is required to update a currency' });
      }

      // Use the currency.id from the database query to ensure correct comparison
      const currentCurrencyId = currency.id;

      const existingCurrency = await Currency.findOne({ 
        where: {
          code: code.toUpperCase(),
          companyId: req.user.companyId,
          id: { [Op.ne]: currentCurrencyId }
        }
      });
      if (existingCurrency) {
        return res.status(400).json({ message: 'Currency code already exists in your company' });
      }
    }

    // Update currency
    await currency.update({
      code: code ? code.toUpperCase() : currency.code,
      name: name || currency.name,
      symbol: symbol || currency.symbol,
      country: country !== undefined ? country : currency.country,
      flag: flag !== undefined ? flag : currency.flag,
      is_default: is_default !== undefined ? is_default : currency.is_default,
      is_active: is_active !== undefined ? is_active : currency.is_active,
      updated_by: req.user.id
    });

    res.json(currency);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/currency/:id - Delete currency
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const currency = await Currency.findByPk(req.params.id);
    if (!currency) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    // Check if currency is default
    if (currency.is_default) {
      return res.status(400).json({ message: 'Cannot delete the default currency' });
    }

    // Check if currency is in use (you can add more checks here)
    // For now, we'll just delete it
    await currency.destroy();

    res.json({ message: 'Currency deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/currency/:id/set-default - Set currency as default
router.put('/:id/set-default', csrfProtection, async (req, res) => {
  try {
    const currency = await Currency.findByPk(req.params.id);
    if (!currency) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    // Set all currencies as non-default (within same company)
    const defaultWhere = buildCompanyWhere(req);
    await Currency.update(
      { is_default: false },
      { where: defaultWhere }
    );

    // Set this currency as default
    await currency.update({ 
      is_default: true,
      updated_by: req.user.id
    });

    res.json(currency);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/currency/:id/toggle-status - Toggle currency status
router.put('/:id/toggle-status', csrfProtection, async (req, res) => {
  try {
    const currency = await Currency.findByPk(req.params.id);
    if (!currency) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    const { is_active } = req.body;

    // Prevent deactivating the default currency
    if (!is_active && currency.is_default) {
      return res.status(400).json({ message: 'Cannot deactivate the default currency' });
    }

    await currency.update({ 
      is_active,
      updated_by: req.user.id
    });

    res.json(currency);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/currency/stats - Get currency statistics
router.get('/stats/overview', async (req, res) => {
  try {
    // Build base where clause with company filter
    const baseWhere = buildCompanyWhere(req);

    const totalCurrencies = await Currency.count({ where: baseWhere });
    const activeCurrencies = await Currency.count({ where: { ...baseWhere, is_active: true } });
    const defaultCurrency = await Currency.findOne({ 
      where: { ...baseWhere, is_default: true } 
    });
    
    // Get last update time (with company filter)
    const lastUpdated = await Currency.findOne({
      where: baseWhere,
      order: [['updated_at', 'DESC']],
      attributes: ['updated_at']
    });
    const lastUpdate = lastUpdated ? lastUpdated.updated_at : null;
    const lastUpdateFormatted = lastUpdate ? new Date(lastUpdate).toLocaleDateString() : 'Never';

    res.json({
      stats: {
        totalCurrencies,
        activeCurrencies,
        defaultCurrency: defaultCurrency ? defaultCurrency.name : 'None',
        lastUpdate: lastUpdateFormatted
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/currency/check-code - Check if currency code is available
router.get('/check-code/availability', async (req, res) => {
  try {
    const { code, exclude_id } = req.query;
    
    if (!code) {
      return res.status(400).json({ message: 'Currency code is required' });
    }

    const whereClause = { code: code.toUpperCase() };
    if (exclude_id) {
      whereClause.id = { [Op.ne]: exclude_id };
    }
    
    // Add company filter
    const finalWhere = buildCompanyWhere(req, whereClause);
    const existingCurrency = await Currency.findOne({ where: finalWhere });
    const available = !existingCurrency;

    res.json({ available });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/currency/countries/list - Get countries list
router.get('/countries/list', async (req, res) => {
  try {
    // This would typically come from a countries API or database
    // For now, we'll return a static list
    const countries = [
      { name: 'United States', code: 'US', currency: 'USD', symbol: '$', flag: '🇺🇸' },
      { name: 'United Kingdom', code: 'GB', currency: 'GBP', symbol: '£', flag: '🇬🇧' },
      { name: 'European Union', code: 'EU', currency: 'EUR', symbol: '€', flag: '🇪🇺' },
      { name: 'Japan', code: 'JP', currency: 'JPY', symbol: '¥', flag: '🇯🇵' },
      { name: 'Canada', code: 'CA', currency: 'CAD', symbol: 'C$', flag: '🇨🇦' },
      { name: 'Australia', code: 'AU', currency: 'AUD', symbol: 'A$', flag: '🇦🇺' },
      { name: 'Switzerland', code: 'CH', currency: 'CHF', symbol: 'CHF', flag: '🇨🇭' },
      { name: 'China', code: 'CN', currency: 'CNY', symbol: '¥', flag: '🇨🇳' },
      { name: 'India', code: 'IN', currency: 'INR', symbol: '₹', flag: '🇮🇳' },
      { name: 'Brazil', code: 'BR', currency: 'BRL', symbol: 'R$', flag: '🇧🇷' },
      { name: 'South Africa', code: 'ZA', currency: 'ZAR', symbol: 'R', flag: '🇿🇦' },
      { name: 'Mexico', code: 'MX', currency: 'MXN', symbol: '$', flag: '🇲🇽' },
      { name: 'South Korea', code: 'KR', currency: 'KRW', symbol: '₩', flag: '🇰🇷' },
      { name: 'Singapore', code: 'SG', currency: 'SGD', symbol: 'S$', flag: '🇸🇬' },
      { name: 'Hong Kong', code: 'HK', currency: 'HKD', symbol: 'HK$', flag: '🇭🇰' },
      { name: 'New Zealand', code: 'NZ', currency: 'NZD', symbol: 'NZ$', flag: '🇳🇿' },
      { name: 'Sweden', code: 'SE', currency: 'SEK', symbol: 'kr', flag: '🇸🇪' },
      { name: 'Norway', code: 'NO', currency: 'NOK', symbol: 'kr', flag: '🇳🇴' },
      { name: 'Denmark', code: 'DK', currency: 'DKK', symbol: 'kr', flag: '🇩🇰' },
      { name: 'Poland', code: 'PL', currency: 'PLN', symbol: 'zł', flag: '🇵🇱' },
      { name: 'Czech Republic', code: 'CZ', currency: 'CZK', symbol: 'Kč', flag: '🇨🇿' },
      { name: 'Hungary', code: 'HU', currency: 'HUF', symbol: 'Ft', flag: '🇭🇺' },
      { name: 'Turkey', code: 'TR', currency: 'TRY', symbol: '₺', flag: '🇹🇷' },
      { name: 'Russia', code: 'RU', currency: 'RUB', symbol: '₽', flag: '🇷🇺' },
      { name: 'Saudi Arabia', code: 'SA', currency: 'SAR', symbol: 'ر.س', flag: '🇸🇦' },
      { name: 'United Arab Emirates', code: 'AE', currency: 'AED', symbol: 'د.إ', flag: '🇦🇪' },
      { name: 'Israel', code: 'IL', currency: 'ILS', symbol: '₪', flag: '🇮🇱' },
      { name: 'Egypt', code: 'EG', currency: 'EGP', symbol: 'E£', flag: '🇪🇬' },
      { name: 'Nigeria', code: 'NG', currency: 'NGN', symbol: '₦', flag: '🇳🇬' },
      { name: 'Kenya', code: 'KE', currency: 'KES', symbol: 'KSh', flag: '🇰🇪' },
      { name: 'Tanzania', code: 'TZ', currency: 'TZS', symbol: 'TSh', flag: '🇹🇿' },
      { name: 'Uganda', code: 'UG', currency: 'UGX', symbol: 'USh', flag: '🇺🇬' },
      { name: 'Ghana', code: 'GH', currency: 'GHS', symbol: 'GH₵', flag: '🇬🇭' },
      { name: 'Morocco', code: 'MA', currency: 'MAD', symbol: 'MAD', flag: '🇲🇦' },
      { name: 'Thailand', code: 'TH', currency: 'THB', symbol: '฿', flag: '🇹🇭' },
      { name: 'Malaysia', code: 'MY', currency: 'MYR', symbol: 'RM', flag: '🇲🇾' },
      { name: 'Philippines', code: 'PH', currency: 'PHP', symbol: '₱', flag: '🇵🇭' },
      { name: 'Indonesia', code: 'ID', currency: 'IDR', symbol: 'Rp', flag: '🇮🇩' },
      { name: 'Vietnam', code: 'VN', currency: 'VND', symbol: '₫', flag: '🇻🇳' },
      { name: 'Argentina', code: 'AR', currency: 'ARS', symbol: '$', flag: '🇦🇷' },
      { name: 'Chile', code: 'CL', currency: 'CLP', symbol: '$', flag: '🇨🇱' },
      { name: 'Colombia', code: 'CO', currency: 'COP', symbol: '$', flag: '🇨🇴' },
      { name: 'Peru', code: 'PE', currency: 'PEN', symbol: 'S/', flag: '🇵🇪' },
      { name: 'Venezuela', code: 'VE', currency: 'VES', symbol: 'Bs', flag: '🇻🇪' }
    ];

    res.json(countries);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/currency/export/excel - Export currencies to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      is_default = 'all'
    } = req.query;

    // Build where clause
    let whereClause = {};
    
    if (search && search.trim()) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { code: { [Op.iLike]: `%${search.trim()}%` } },
        { symbol: { [Op.iLike]: `%${search.trim()}%` } },
        { country: { [Op.iLike]: `%${search.trim()}%` } }
      ];
    }

    if (status !== 'all') {
      whereClause.is_active = status === 'active';
    }

    if (is_default !== 'all') {
      whereClause.is_default = is_default === 'default';
    }

    // Get all currencies for export
    const currencies = await Currency.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'created_by'
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'updated_by'
        }
      ],
      order: [['name', 'ASC']]
    });

    // Convert to CSV format (Excel can open CSV files)
    const headers = [
      'Currency Name',
      'Code',
      'Symbol',
      'Country',
      'Flag',
      'Is Default',
      'Is Active',
      'Created By',
      'Updated By',
      'Created At',
      'Updated At'
    ];

    const csvData = currencies.map(currency => [
      currency.name,
      currency.code,
      currency.symbol,
      currency.country || '',
      currency.flag || '',
      currency.is_default ? 'Yes' : 'No',
      currency.is_active ? 'Yes' : 'No',
      currency.creator ? 
        `${currency.creator.first_name || ''} ${currency.creator.last_name || ''}`.trim() || 
        currency.creator.username : 'N/A',
      currency.updater ? 
        `${currency.updater.first_name || ''} ${currency.updater.last_name || ''}`.trim() || 
        currency.updater.username : 'N/A',
      new Date(currency.created_at).toLocaleDateString(),
      new Date(currency.updated_at).toLocaleDateString()
    ]);

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Set headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="currencies.xlsx"');
    
    // For now, we'll send CSV data (Excel can open it)
    // In a production environment, you might want to use a library like 'xlsx' to create proper Excel files
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/currency/export/pdf - Export currencies to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      is_default = 'all'
    } = req.query;

    // Build where clause
    let whereClause = {};
    
    if (search && search.trim()) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { code: { [Op.iLike]: `%${search.trim()}%` } },
        { symbol: { [Op.iLike]: `%${search.trim()}%` } },
        { country: { [Op.iLike]: `%${search.trim()}%` } }
      ];
    }

    if (status !== 'all') {
      whereClause.is_active = status === 'active';
    }

    if (is_default !== 'all') {
      whereClause.is_default = is_default === 'default';
    }

    // Get all currencies for export
    const currencies = await Currency.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'created_by'
        },
        {
          model: User,
          as: 'updater',
          attributes: ['id', 'first_name', 'last_name', 'username'],
          foreignKey: 'updated_by'
        }
      ],
      order: [['name', 'ASC']]
    });

    // Create simple HTML table for PDF (browser can print to PDF)
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Currencies Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .header { text-align: center; margin-bottom: 20px; }
          .status-yes { color: green; }
          .status-no { color: red; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Currencies Report</h1>
          <p>Generated on: ${new Date().toLocaleDateString()}</p>
          <p>Total Currencies: ${currencies.length}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Currency Name</th>
              <th>Code</th>
              <th>Symbol</th>
              <th>Country</th>
              <th>Is Default</th>
              <th>Is Active</th>
              <th>Created By</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            ${currencies.map(currency => `
              <tr>
                <td>${currency.name}</td>
                <td>${currency.code}</td>
                <td>${currency.symbol}</td>
                <td>${currency.country || '-'}</td>
                <td class="status-${currency.is_default ? 'yes' : 'no'}">${currency.is_default ? 'Yes' : 'No'}</td>
                <td class="status-${currency.is_active ? 'yes' : 'no'}">${currency.is_active ? 'Yes' : 'No'}</td>
                <td>${currency.creator ? 
                  `${currency.creator.first_name || ''} ${currency.creator.last_name || ''}`.trim() || 
                  currency.creator.username : 'N/A'}</td>
                <td>${new Date(currency.created_at).toLocaleDateString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="currencies.pdf"');
    
    // For now, we'll send HTML content (browser can convert to PDF)
    // In a production environment, you might want to use a library like 'puppeteer' or 'html-pdf' to create proper PDF files
    res.send(htmlContent);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Public endpoint to get latest exchange rate for a currency (no authentication required)
router.get('/exchange-rates/latest', async (req, res) => {
  try {
    const { currencyId } = req.query;
    
    if (!currencyId) {
      return res.status(400).json({ error: 'CurrencyId is required' });
    }

    // Validate currencyId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(currencyId)) {
      return res.status(400).json({ error: 'Invalid currencyId format' });
    }

    // Get the currency object by ID
    const fromCurrency = await Currency.findByPk(currencyId);
    if (!fromCurrency) {
      return res.status(404).json({ error: 'Currency not found' });
    }

    // Get the default currency
    const toCurrency = await Currency.findOne({ where: { is_default: true } });
    if (!toCurrency) {
      return res.status(404).json({ error: 'Default currency not found' });
    }

    // If the selected currency is the default, rate is 1
    if (fromCurrency.id === toCurrency.id) {
      return res.json({ rate: 1.0, id: null });
    }

    // Get the latest exchange rate from selected currency to default currency
    const latestRate = await ExchangeRate.findOne({
      where: {
        from_currency_id: fromCurrency.id,
        to_currency_id: toCurrency.id,
        is_active: true
      },
      order: [['effective_date', 'DESC']]
    });

    if (!latestRate) {
      return res.status(404).json({ error: 'No exchange rate found' });
    }

    res.json({ rate: parseFloat(latestRate.rate), id: latestRate.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch latest exchange rate', details: error.message });
  }
});

module.exports = router; 