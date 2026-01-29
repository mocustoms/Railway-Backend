const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sequelize = require('../../config/database');
const { 
  CustomerDeposit, 
  Customer, 
  PaymentType, 
  PaymentMethod, 
  BankDetail, 
  Currency, 
  ExchangeRate, 
  Account, 
  TransactionType,
  GeneralLedger,
  FinancialYear,
  User 
} = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { getUploadDir } = require('../utils/uploadsPath');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for document uploads (uses UPLOAD_PATH for Railway Volume / partition)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = getUploadDir('customerDeposits');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'deposit-doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for documents
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, images, Word, and Excel files are allowed'), false);
    }
  }
});

// Get customer deposit statistics
router.get('/stats', async (req, res) => {
  try {
    const { 
      search = '', 
      currencyId,
      paymentTypeId,
      bankDetailId,
      start_date,
      end_date
    } = req.query;
    
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { depositReferenceNumber: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$customer.customer_id$': { [Op.iLike]: `%${search}%` } },
        { '$paymentType.name$': { [Op.iLike]: `%${search}%` } },
        { '$paymentType.code$': { [Op.iLike]: `%${search}%` } },
        { chequeNumber: { [Op.iLike]: `%${search}%` } },
        { '$bankDetail.bank_name$': { [Op.iLike]: `%${search}%` } },
        { '$bankDetail.branch$': { [Op.iLike]: `%${search}%` } },
        { '$bankDetail.account_number$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add filter functionality
    if (currencyId) {
      whereClause.currencyId = currencyId;
    }
    if (paymentTypeId) {
      whereClause.paymentTypeId = paymentTypeId;
    }
    if (bankDetailId) {
      whereClause.bankDetailId = bankDetailId;
    }
    if (start_date) {
      whereClause.transactionDate = { [Op.gte]: start_date };
    }
    if (end_date) {
      whereClause.transactionDate = { 
        ...whereClause.transactionDate, 
        [Op.lte]: end_date 
      };
    }

    // Count total deposits with filters
    const totalDeposits = await CustomerDeposit.count({
      where: buildCompanyWhere(req, whereClause),
      include: search ? [
        { model: Customer, as: 'customer', attributes: ['id', 'customer_id', 'full_name'] },
        { model: PaymentType, as: 'paymentType', attributes: ['id', 'name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['id', 'bankName', 'branch', 'accountNumber'] }
      ] : []
    });
    
    // Calculate filtered total equivalent amount
    const totalEquivalentAmount = await CustomerDeposit.sum('equivalentAmount', {
      where: buildCompanyWhere(req, whereClause),
      include: search ? [
        { model: Customer, as: 'customer', attributes: ['id', 'customer_id', 'full_name'] },
        { model: PaymentType, as: 'paymentType', attributes: ['id', 'name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['id', 'bankName', 'branch', 'accountNumber'] }
      ] : []
    });

    res.json({
      stats: {
        totalDeposits,
        totalEquivalentAmount: totalEquivalentAmount || 0,
        lastUpdate: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer deposit statistics' });
  }
});

// Test endpoint to check database data
router.get('/test-data', async (req, res) => {
  try {
    // Get all deposits without any filters
    const allDeposits = await CustomerDeposit.findAll({
      where: buildCompanyWhere(req),
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'customer_id', 'full_name'] },
        { model: PaymentType, as: 'paymentType', attributes: ['id', 'name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['id', 'bankName', 'branch'] }
      ],
      limit: 5
    });


    res.json({
      totalCount: allDeposits.length,
      deposits: allDeposits.map(deposit => ({
        id: deposit.id,
        depositReferenceNumber: deposit.depositReferenceNumber,
        customerName: deposit.customer?.full_name,
        paymentType: deposit.paymentType?.name,
        bankName: deposit.bankDetail?.bankName
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Test failed' });
  }
});

// Get all customer deposits with pagination, search, and sorting
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 25, 
      search = '', 
      sortBy = 'transactionDate', 
      sortOrder = 'desc',
      currencyId,
      paymentTypeId,
      bankDetailId,
      start_date,
      end_date
    } = req.query;

    
    const offset = (page - 1) * limit;
    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { depositReferenceNumber: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$customer.customer_id$': { [Op.iLike]: `%${search}%` } },
        { '$paymentType.name$': { [Op.iLike]: `%${search}%` } },
        { '$paymentType.code$': { [Op.iLike]: `%${search}%` } },
        { chequeNumber: { [Op.iLike]: `%${search}%` } },
        { '$bankDetail.bank_name$': { [Op.iLike]: `%${search}%` } },
        { '$bankDetail.branch$': { [Op.iLike]: `%${search}%` } },
        { '$bankDetail.account_number$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add filter functionality
    if (currencyId) {
      whereClause.currencyId = currencyId;
    }
    if (paymentTypeId) {
      whereClause.paymentTypeId = paymentTypeId;
    }
    if (bankDetailId) {
      whereClause.bankDetailId = bankDetailId;
    }
    if (start_date) {
      whereClause.transactionDate = { [Op.gte]: start_date };
    }
    if (end_date) {
      whereClause.transactionDate = { 
        ...whereClause.transactionDate, 
        [Op.lte]: end_date 
      };
    }

    // Build order clause - handle both direct fields and associated model fields
    let orderClause = [];
    
    // Direct fields that can be sorted directly
    const directFields = {
      'transactionDate': 'transactionDate',
      'depositAmount': 'depositAmount',
      'equivalentAmount': 'equivalentAmount',
      'depositReferenceNumber': 'depositReferenceNumber',
      'chequeNumber': 'chequeNumber',
      'is_active': 'is_active',
      'createdAt': 'createdAt',
      'updatedAt': 'updatedAt',
      'currencyId': 'currencyId',
      'paymentTypeId': 'paymentTypeId',
      'bankDetailId': 'bankDetailId',
      'customerId': 'customerId',
      'liabilityAccountId': 'liabilityAccountId',
      'assetAccountId': 'assetAccountId'
    };
    
    // Associated model fields that need special handling
    if (sortBy === 'customer' || sortBy === 'customerName') {
      orderClause = [[{ model: Customer, as: 'customer' }, 'full_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'currency' || sortBy === 'currencyName') {
      orderClause = [[{ model: Currency, as: 'currency' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'paymentType' || sortBy === 'paymentTypeName') {
      orderClause = [[{ model: PaymentType, as: 'paymentType' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'bankDetail' || sortBy === 'bankDetailName') {
      orderClause = [[{ model: BankDetail, as: 'bankDetail' }, 'bankName', sortOrder.toUpperCase()]];
    } else if (sortBy === 'liabilityAccount' || sortBy === 'liabilityAccountName') {
      orderClause = [[{ model: Account, as: 'liabilityAccount' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'assetAccount' || sortBy === 'assetAccountName') {
      orderClause = [[{ model: Account, as: 'assetAccount' }, 'name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'createdBy' || sortBy === 'createdByName') {
      orderClause = [[{ model: User, as: 'creator' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (sortBy === 'updatedBy' || sortBy === 'updatedByName') {
      orderClause = [[{ model: User, as: 'updater' }, 'first_name', sortOrder.toUpperCase()]];
    } else if (directFields[sortBy]) {
      // Direct field - use the database column name
      orderClause = [[directFields[sortBy], sortOrder.toUpperCase()]];
    } else {
      // Default to transactionDate if field not recognized
      orderClause = [['transactionDate', 'DESC']];
    }

    const { count, rows: deposits } = await CustomerDeposit.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'customer_id', 'full_name', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points'] },
        { model: PaymentType, as: 'paymentType', attributes: ['id', 'name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['id', 'bankName', 'branch', 'accountNumber'] },
        { model: Currency, as: 'currency', attributes: ['id', 'code', 'name', 'symbol'] },
        { model: Account, as: 'liabilityAccount', attributes: ['id', 'code', 'name'] },
        { model: Account, as: 'assetAccount', attributes: ['id', 'code', 'name'] },
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ],
      order: orderClause,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform deposits to ensure numeric fields are properly typed
    const transformedDeposits = deposits.map(deposit => ({
      ...deposit.toJSON(),
      depositAmount: parseFloat(deposit.depositAmount) || 0,
      equivalentAmount: parseFloat(deposit.equivalentAmount) || 0,
      exchangeRate: parseFloat(deposit.exchangeRate) || 1
    }));

    res.json({
      deposits: transformedDeposits,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer deposits', details: err.message });
  }
});

// Get a single customer deposit by ID
router.get('/:id', async (req, res) => {
  try {
    const deposit = await CustomerDeposit.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'customer_id', 'full_name', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points'] },
        { 
          model: PaymentType, 
          as: 'paymentType', 
          attributes: ['id', 'name', 'code'],
          include: [
            { model: PaymentMethod, as: 'paymentMethod', attributes: ['name', 'requiresBankDetails', 'uploadDocument'] }
          ]
        },
        { model: BankDetail, as: 'bankDetail', attributes: ['id', 'bankName', 'branch', 'accountNumber'] },
        { model: Currency, as: 'currency', attributes: ['id', 'code', 'name', 'symbol'] },
        { model: Account, as: 'liabilityAccount', attributes: ['id', 'code', 'name'] },
        { model: Account, as: 'assetAccount', attributes: ['id', 'code', 'name'] },
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ]
    });
    if (!deposit) return res.status(404).json({ error: 'Customer deposit not found' });
    res.json(deposit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer deposit' });
  }
});

// Helper: Generate deposit reference number
async function generateDepositReferenceNumber(req) {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  // Get all deposits for today (filtered by companyId)
  const todayDeposits = await CustomerDeposit.findAll({
    where: buildCompanyWhere(req, {
      depositReferenceNumber: {
        [Op.like]: `DEP-${dateString}-%`
      }
    }),
    attributes: ['depositReferenceNumber'],
    order: [['depositReferenceNumber', 'DESC']]
  });
  
  // Extract the highest sequence number for today
  let nextSequence = 1;
  if (todayDeposits.length > 0) {
    const lastDeposit = todayDeposits[0];
    const match = lastDeposit.depositReferenceNumber.match(/DEP-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }
  
  // Generate the reference number
  const referenceNumber = `DEP-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  
  // Double-check that this number doesn't exist (safety check)
  const existingDeposit = await CustomerDeposit.findOne({
    where: buildCompanyWhere(req, { depositReferenceNumber: referenceNumber }),
    attributes: ['id']
  });
  
  if (existingDeposit) {
    // If it exists, find the next available number for today
    const allTodayDeposits = await CustomerDeposit.findAll({
      where: buildCompanyWhere(req, {
        depositReferenceNumber: {
          [Op.like]: `DEP-${dateString}-%`
        }
      }),
      attributes: ['depositReferenceNumber'],
      order: [['depositReferenceNumber', 'ASC']]
    });
    
    const usedNumbers = allTodayDeposits
      .map(deposit => {
        const match = deposit.depositReferenceNumber.match(/DEP-\d{8}-(\d{4})/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => num > 0)
      .sort((a, b) => a - b);
    
    // Find the first gap or next number
    let nextAvailableNumber = 1;
    for (const num of usedNumbers) {
      if (num === nextAvailableNumber) {
        nextAvailableNumber++;
      } else {
        break;
      }
    }
    
    return `DEP-${dateString}-${nextAvailableNumber.toString().padStart(4, '0')}`;
  }
  
  return referenceNumber;
}

// Helper: Get current exchange rate (filtered by companyId)
async function getCurrentExchangeRate(req, currencyId, systemCurrencyId) {
  if (currencyId === systemCurrencyId) {
    // For same currency, find or create a 1:1 exchange rate record
    let exchangeRate = await ExchangeRate.findOne({
      where: buildCompanyWhere(req, {
        from_currency_id: currencyId,
        to_currency_id: systemCurrencyId,
        is_active: true
      }),
      order: [['created_at', 'DESC']]
    });
    
    if (!exchangeRate) {
      // Create a default 1:1 exchange rate if none exists
      exchangeRate = await ExchangeRate.create({
        companyId: req.user.companyId,
        from_currency_id: currencyId,
        to_currency_id: systemCurrencyId,
        rate: 1.0,
        is_active: true,
        created_by: null
      });
    }
    
    return { rate: 1.0, exchangeRateId: exchangeRate.id };
  }
  
  const exchangeRate = await ExchangeRate.findOne({
    where: buildCompanyWhere(req, {
      from_currency_id: currencyId,
      to_currency_id: systemCurrencyId,
      is_active: true
    }),
    order: [['created_at', 'DESC']]
  });
  
  if (!exchangeRate) {
    throw new Error(`No exchange rate found for currency ${currencyId} to system currency ${systemCurrencyId}`);
  }
  
  return {
    rate: parseFloat(exchangeRate.rate),
    exchangeRateId: exchangeRate.id
  };
}

// Helper: Get payment type details (filtered by companyId)
async function getPaymentTypeDetails(req, paymentTypeId) {
  const paymentType = await PaymentType.findOne({
    where: buildCompanyWhere(req, { id: paymentTypeId }),
    include: [
      { model: PaymentMethod, as: 'paymentMethod', attributes: ['name', 'requiresBankDetails', 'uploadDocument'] }
    ]
  });
  
  return paymentType;
}

// Helper: Validate Customer Deposit fields
function validateCustomerDeposit(body) {
  const errors = [];

  if (!body.customerId) {
    errors.push('Customer selection is required');
  }

  if (!body.paymentTypeId) {
    errors.push('Payment type selection is required');
  }

  if (!body.currencyId) {
    errors.push('Currency selection is required');
  }

  if (!body.depositAmount || parseFloat(body.depositAmount) <= 0) {
    errors.push('Deposit amount must be greater than 0');
  }

  if (!body.liabilityAccountId) {
    errors.push('Liability account selection is required');
  }

  if (!body.assetAccountId) {
    errors.push('Asset account selection is required');
  }

  return errors;
}

// Create a new customer deposit
router.post('/', upload.single('document'), csrfProtection, async (req, res) => {
  const transaction = await CustomerDeposit.sequelize.transaction();
  
  try {
    const validationErrors = validateCustomerDeposit(req.body);
    if (validationErrors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors 
      });
    }

    // Generate deposit reference number
    const depositReferenceNumber = await generateDepositReferenceNumber(req);

    // Validate companyId exists
    if (!req.user || !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ 
        error: 'Company access required. Please ensure you are assigned to a company.' 
      });
    }

    // Validate customerId belongs to the same company
    const customer = await Customer.findOne({
      where: buildCompanyWhere(req, { id: req.body.customerId }),
      transaction
    });
    if (!customer) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Customer not found or does not belong to your company' 
      });
    }

    // Validate paymentTypeId belongs to the same company
    const paymentType = await PaymentType.findOne({
      where: buildCompanyWhere(req, { id: req.body.paymentTypeId }),
      transaction
    });
    if (!paymentType) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Payment type not found or does not belong to your company' 
      });
    }

    // Validate bankDetailId belongs to the same company (if provided)
    if (req.body.bankDetailId) {
      const bankDetail = await BankDetail.findOne({
        where: buildCompanyWhere(req, { id: req.body.bankDetailId }),
        transaction
      });
      if (!bankDetail) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Bank detail not found or does not belong to your company' 
        });
      }
    }

    // Validate currencyId belongs to the same company
    const currency = await Currency.findOne({
      where: buildCompanyWhere(req, { id: req.body.currencyId }),
      transaction
    });
    if (!currency) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Currency not found or does not belong to your company' 
      });
    }

    // Validate liabilityAccountId belongs to the same company
    const liabilityAccount = await Account.findOne({
      where: buildCompanyWhere(req, { id: req.body.liabilityAccountId }),
      transaction
    });
    if (!liabilityAccount) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Liability account not found or does not belong to your company' 
      });
    }

    // Validate assetAccountId belongs to the same company
    const assetAccount = await Account.findOne({
      where: buildCompanyWhere(req, { id: req.body.assetAccountId }),
      transaction
    });
    if (!assetAccount) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Asset account not found or does not belong to your company' 
      });
    }

    // Get current exchange rate
    const systemCurrency = await Currency.findOne({ 
      where: buildCompanyWhere(req, { is_default: true })
    });
    const exchangeRateData = await getCurrentExchangeRate(req, req.body.currencyId, systemCurrency.id);

    // Handle document upload
    let documentPath = null;
    if (req.file) {
      documentPath = req.file.filename;
    }

    // Get current financial year (must be both current and active, filtered by company)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isCurrent: true, isActive: true })
    });

    if (!currentFinancialYear) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'No current financial year found. Please set up a current financial year before creating customer deposits.' 
      });
    }

    // Validate transaction date is within financial year range
    // Use date-only comparison to avoid timezone issues (same pattern as salesInvoice and salesOrder)
    const transactionDateInput = req.body.transactionDate || new Date().toISOString().split('T')[0];
    const transactionDateStr = transactionDateInput.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (transactionDateStr < startDateStr || transactionDateStr > endDateStr) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: `Transaction date must be within the active financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Create the deposit
    const deposit = await CustomerDeposit.create({
      companyId: req.user.companyId,
      depositReferenceNumber,
      customerId: req.body.customerId,
      paymentTypeId: req.body.paymentTypeId,
      chequeNumber: req.body.chequeNumber || null,
      bankDetailId: req.body.bankDetailId || null,
      branch: req.body.branch || null,
      currencyId: req.body.currencyId,
      exchangeRate: exchangeRateData.rate,
      exchangeRateId: exchangeRateData.exchangeRateId,
      documentPath: documentPath,
      depositAmount: parseFloat(req.body.depositAmount),
      equivalentAmount: parseFloat(req.body.depositAmount) * exchangeRateData.rate,
      description: req.body.description || null,
      liabilityAccountId: req.body.liabilityAccountId,
      assetAccountId: req.body.assetAccountId,
      transactionDate: req.body.transactionDate || new Date(),
      financialYearId: currentFinancialYear.id,
      createdBy: req.user.id,
      updatedBy: req.user.id
    }, { transaction });

    // Update customer account balance (in system currency)
    const equivalentAmount = parseFloat(req.body.depositAmount) * exchangeRateData.rate;
    await Customer.increment('account_balance', {
      by: equivalentAmount, // Use equivalent amount
      where: buildCompanyWhere(req, { id: req.body.customerId }),
      transaction
    });
    
    // Update customer deposit balance (prepaid amount)
    await Customer.increment('deposit_balance', {
      by: equivalentAmount, // Use equivalent amount
      where: buildCompanyWhere(req, { id: req.body.customerId }),
      transaction
    });

    // Get transaction type (GLOBAL - no company filter, create if doesn't exist)
    let transactionType = await TransactionType.findOne({ 
      where: { code: 'CUSTOMER_DEPOSIT' } // Global - no company filtering
    });
    
    if (!transactionType) {
      transactionType = await TransactionType.create({
        companyId: null, // Global - no company association
        code: 'CUSTOMER_DEPOSIT',
        name: 'Customer Deposit',
        description: 'Customer deposit transactions'
      }, { transaction });
    }

    // Account details already validated above, use them for General Ledger entries
    // Note: currentFinancialYear was already fetched before deposit creation

    // Create General Ledger entries
    const generalLedgerId = require('uuid').v4();
    
    // Liability Account Entry (Credit)
    await GeneralLedger.create({
      id: require('uuid').v4(),
      financial_year_code: currentFinancialYear.name,
      financial_year_id: currentFinancialYear.id,
      system_date: new Date(),
      transaction_date: deposit.transactionDate,
      reference_number: depositReferenceNumber,
      transaction_type: 'CUSTOMER_DEPOSIT',
      transaction_type_name: 'Customer Deposit',
      transaction_type_id: transactionType.id,
      created_by_code: req.user.id,
      created_by_name: `${req.user.first_name} ${req.user.last_name}`,
      description: deposit.description || `Customer deposit - ${depositReferenceNumber}`,
      account_type_code: 'LIABILITY',
      account_type_name: 'Liability',
      account_id: liabilityAccount.id,
      account_name: liabilityAccount.name,
      account_code: liabilityAccount.code,
      account_nature: 'credit',
      exchange_rate: exchangeRateData.rate,
      amount: parseFloat(req.body.depositAmount),
      system_currency_id: systemCurrency.id,
      user_credit_amount: parseFloat(req.body.depositAmount),
      equivalent_credit_amount: parseFloat(req.body.depositAmount) * exchangeRateData.rate,
      username: req.user.username,
      general_ledger_id: generalLedgerId,
      companyId: req.user.companyId // Add companyId for multi-tenant support
    }, { transaction });

    // Asset Account Entry (Debit)
    await GeneralLedger.create({
      id: require('uuid').v4(),
      financial_year_code: currentFinancialYear.name,
      financial_year_id: currentFinancialYear.id,
      system_date: new Date(),
      transaction_date: deposit.transactionDate,
      reference_number: depositReferenceNumber,
      transaction_type: 'CUSTOMER_DEPOSIT',
      transaction_type_name: 'Customer Deposit',
      transaction_type_id: transactionType.id,
      created_by_code: req.user.id,
      created_by_name: `${req.user.first_name} ${req.user.last_name}`,
      description: deposit.description || `Customer deposit - ${depositReferenceNumber}`,
      account_type_code: 'ASSET',
      account_type_name: 'Asset',
      account_id: assetAccount.id,
      account_name: assetAccount.name,
      account_code: assetAccount.code,
      account_nature: 'debit',
      exchange_rate: exchangeRateData.rate,
      amount: parseFloat(req.body.depositAmount),
      system_currency_id: systemCurrency.id,
      user_debit_amount: parseFloat(req.body.depositAmount),
      equivalent_debit_amount: parseFloat(req.body.depositAmount) * exchangeRateData.rate,
      username: req.user.username,
      general_ledger_id: generalLedgerId,
      companyId: req.user.companyId // Add companyId for multi-tenant support
    }, { transaction });

    await transaction.commit();

    // Fetch the created deposit with associations
    const createdDeposit = await CustomerDeposit.findByPk(deposit.id, {
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'customer_id', 'full_name', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points'] },
        { model: PaymentType, as: 'paymentType', attributes: ['id', 'name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['id', 'bankName', 'branch', 'accountNumber'] },
        { model: Currency, as: 'currency', attributes: ['id', 'code', 'name', 'symbol'] },
        { model: Account, as: 'liabilityAccount', attributes: ['id', 'code', 'name'] },
        { model: Account, as: 'assetAccount', attributes: ['id', 'code', 'name'] },
        { model: User, as: 'creator', attributes: ['id', 'username', 'first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ]
    });

    res.status(201).json(createdDeposit);
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: 'Failed to create customer deposit', details: err.message });
  }
});

// Update customer deposit
router.put('/:id', upload.single('document'), csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    
    // Find the existing deposit
    const existingDeposit = await CustomerDeposit.findOne({
      where: buildCompanyWhere(req, { id }),
      transaction
    });
    if (!existingDeposit) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Customer deposit not found' });
    }

    // Validate companyId exists
    if (!req.user || !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ 
        error: 'Company access required. Please ensure you are assigned to a company.' 
      });
    }

    // Validate customerId belongs to the same company (if being updated)
    if (req.body.customerId && req.body.customerId !== existingDeposit.customerId) {
      const customer = await Customer.findOne({
        where: buildCompanyWhere(req, { id: req.body.customerId }),
        transaction
      });
      if (!customer) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Customer not found or does not belong to your company' 
        });
      }
    }

    // Validate paymentTypeId belongs to the same company (if being updated)
    if (req.body.paymentTypeId && req.body.paymentTypeId !== existingDeposit.paymentTypeId) {
      const paymentType = await PaymentType.findOne({
        where: buildCompanyWhere(req, { id: req.body.paymentTypeId }),
        transaction
      });
      if (!paymentType) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Payment type not found or does not belong to your company' 
        });
      }
    }

    // Validate bankDetailId belongs to the same company (if being updated)
    if (req.body.bankDetailId && req.body.bankDetailId !== existingDeposit.bankDetailId) {
      const bankDetail = await BankDetail.findOne({
        where: buildCompanyWhere(req, { id: req.body.bankDetailId }),
        transaction
      });
      if (!bankDetail) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Bank detail not found or does not belong to your company' 
        });
      }
    }

    // Validate currencyId belongs to the same company (if being updated)
    if (req.body.currencyId && req.body.currencyId !== existingDeposit.currencyId) {
      const currency = await Currency.findOne({
        where: buildCompanyWhere(req, { id: req.body.currencyId }),
        transaction
      });
      if (!currency) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Currency not found or does not belong to your company' 
        });
      }
    }

    // Validate liabilityAccountId belongs to the same company (if being updated)
    if (req.body.liabilityAccountId && req.body.liabilityAccountId !== existingDeposit.liabilityAccountId) {
      const liabilityAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: req.body.liabilityAccountId }),
        transaction
      });
      if (!liabilityAccount) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Liability account not found or does not belong to your company' 
        });
      }
    }

    // Validate assetAccountId belongs to the same company (if being updated)
    if (req.body.assetAccountId && req.body.assetAccountId !== existingDeposit.assetAccountId) {
      const assetAccount = await Account.findOne({
        where: buildCompanyWhere(req, { id: req.body.assetAccountId }),
        transaction
      });
      if (!assetAccount) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Asset account not found or does not belong to your company' 
        });
      }
    }

    // Get current exchange rate
    const systemCurrency = await Currency.findOne({ 
      where: buildCompanyWhere(req, { is_default: true })
    });
    const exchangeRateData = await getCurrentExchangeRate(req, req.body.currencyId, systemCurrency.id);

    // Handle document upload
    let documentPath = existingDeposit.documentPath; // Keep existing document if no new one uploaded
    if (req.file) {
      // Delete old document if exists (use UPLOAD_PATH for Railway)
      if (existingDeposit.documentPath) {
        const oldDocumentPath = path.join(getUploadDir('customerDeposits'), existingDeposit.documentPath);
        if (fs.existsSync(oldDocumentPath)) {
          fs.unlinkSync(oldDocumentPath);
        }
      }
      documentPath = req.file.filename;
    }

    // Get current financial year (must be both current and active, filtered by company)
    const currentFinancialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isCurrent: true, isActive: true })
    });

    if (!currentFinancialYear) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'No current financial year found. Please set up a current financial year before updating customer deposits.' 
      });
    }

    // Validate transaction date is within financial year range
    // Use date-only comparison to avoid timezone issues (same pattern as salesInvoice and salesOrder)
    let transactionDateInput = req.body.transactionDate;
    if (!transactionDateInput) {
      // If no date provided, use existing deposit's date or current date
      if (existingDeposit.transactionDate) {
        const existingDate = existingDeposit.transactionDate instanceof Date 
          ? existingDeposit.transactionDate.toISOString().split('T')[0]
          : existingDeposit.transactionDate;
        transactionDateInput = existingDate;
      } else {
        transactionDateInput = new Date().toISOString().split('T')[0];
      }
    }
    const transactionDateStr = transactionDateInput.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (transactionDateStr < startDateStr || transactionDateStr > endDateStr) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: `Transaction date must be within the active financial year range (${startDateStr} to ${endDateStr}).` 
      });
    }

    // Update the deposit
    await existingDeposit.update({
      customerId: req.body.customerId,
      paymentTypeId: req.body.paymentTypeId,
      chequeNumber: req.body.chequeNumber || null,
      bankDetailId: req.body.bankDetailId || null,
      branch: req.body.branch || null,
      currencyId: req.body.currencyId,
      exchangeRate: exchangeRateData.rate,
      exchangeRateId: exchangeRateData.exchangeRateId,
      documentPath: documentPath,
      depositAmount: parseFloat(req.body.depositAmount),
      equivalentAmount: parseFloat(req.body.depositAmount) * exchangeRateData.rate,
      description: req.body.description || null,
      liabilityAccountId: req.body.liabilityAccountId,
      assetAccountId: req.body.assetAccountId,
      transactionDate: req.body.transactionDate || new Date(),
      financialYearId: currentFinancialYear.id,
      updatedBy: req.user.id
    }, { transaction });

    // Update customer account balance (difference in system currency)
    const newEquivalentAmount = parseFloat(req.body.depositAmount) * exchangeRateData.rate;
    const oldEquivalentAmount = parseFloat(existingDeposit.equivalentAmount);
    const equivalentAmountDifference = newEquivalentAmount - oldEquivalentAmount;
    
    if (equivalentAmountDifference !== 0) {
      await Customer.increment('account_balance', {
        by: equivalentAmountDifference, // Use equivalent amount difference
        where: buildCompanyWhere(req, { id: req.body.customerId }),
        transaction
      });
      
      // Update customer deposit balance (prepaid amount)
      await Customer.increment('deposit_balance', {
        by: equivalentAmountDifference, // Use equivalent amount difference
        where: buildCompanyWhere(req, { id: req.body.customerId }),
        transaction
      });
    }

    // Update General Ledger entries
    // Note: currentFinancialYear was already fetched before deposit update
    // Account details already validated above, use them for General Ledger entries
    const liabilityAccount = await Account.findOne({
      where: buildCompanyWhere(req, { id: req.body.liabilityAccountId }),
      transaction
    });
    const assetAccount = await Account.findOne({
      where: buildCompanyWhere(req, { id: req.body.assetAccountId }),
      transaction
    });

    // Update General Ledger entries
    // Update Liability Account Entry (Credit)
    await GeneralLedger.update({
      amount: parseFloat(req.body.depositAmount),
      description: `Customer Deposit - ${req.body.description || 'No description'}`,
      user_credit_amount: parseFloat(req.body.depositAmount),
      equivalent_credit_amount: parseFloat(req.body.depositAmount) * exchangeRateData.rate,
      exchange_rate: exchangeRateData.rate
    }, {
      where: {
        reference_number: existingDeposit.depositReferenceNumber,
        transaction_type: 'CUSTOMER_DEPOSIT',
        account_id: req.body.liabilityAccountId
      },
      transaction
    });

    // Update Asset Account Entry (Debit)
    await GeneralLedger.update({
      amount: parseFloat(req.body.depositAmount),
      description: `Customer Deposit - ${req.body.description || 'No description'}`,
      user_debit_amount: parseFloat(req.body.depositAmount),
      equivalent_debit_amount: parseFloat(req.body.depositAmount) * exchangeRateData.rate,
      exchange_rate: exchangeRateData.rate
    }, {
      where: {
        reference_number: existingDeposit.depositReferenceNumber,
        transaction_type: 'CUSTOMER_DEPOSIT',
        account_id: req.body.assetAccountId
      },
      transaction
    });

    await transaction.commit();
    res.json({ message: 'Customer deposit updated successfully', deposit: existingDeposit });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: 'Failed to update customer deposit' });
  }
});

// Get customers for dropdown
router.get('/customers/search', async (req, res) => {
  try {
    const { search = '' } = req.query;
    
    const customers = await Customer.findAll({
      where: buildCompanyWhere(req, {
        is_active: true,
        [Op.or]: [
          { customer_id: { [Op.iLike]: `%${search}%` } },
          { full_name: { [Op.iLike]: `%${search}%` } },
          { phone_number: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } }
        ]
      }),
      attributes: ['id', 'customer_id', 'full_name', 'phone_number', 'email', 'account_balance', 'debt_balance', 'deposit_balance', 'loyalty_points'],
      limit: 2000,
      order: [['full_name', 'ASC']]
    });

    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search customers' });
  }
});

// Get payment types for dropdown
router.get('/payment-types', async (req, res) => {
  try {
    const paymentTypes = await PaymentType.findAll({
      where: { is_active: true },
      include: [
        { model: PaymentMethod, as: 'paymentMethod', attributes: ['name', 'requiresBankDetails', 'uploadDocument'] }
      ],
      attributes: ['id', 'name', 'code'],
      order: [['name', 'ASC']]
    });

    res.json(paymentTypes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment types' });
  }
});

// Delete a customer deposit
router.delete('/:id', csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    
    // Find the existing deposit
    const existingDeposit = await CustomerDeposit.findOne({
      where: buildCompanyWhere(req, { id }),
      transaction
    });
    if (!existingDeposit) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Customer deposit not found' });
    }

    // Reverse the customer account balance (subtract the equivalent amount)
    const equivalentAmount = parseFloat(existingDeposit.equivalentAmount);
    await Customer.decrement('account_balance', {
      by: equivalentAmount,
      where: buildCompanyWhere(req, { id: existingDeposit.customerId }),
      transaction
    });
    
    // Reverse the customer deposit balance (subtract the equivalent amount)
    await Customer.decrement('deposit_balance', {
      by: equivalentAmount,
      where: buildCompanyWhere(req, { id: existingDeposit.customerId }),
      transaction
    });

    // Delete associated General Ledger entries
    await GeneralLedger.destroy({
      where: {
        reference_number: existingDeposit.depositReferenceNumber,
        transaction_type: 'CUSTOMER_DEPOSIT'
      },
      transaction
    });

    // Delete the document file if it exists (use UPLOAD_PATH for Railway)
    if (existingDeposit.documentPath) {
      const documentPath = path.join(getUploadDir('customerDeposits'), existingDeposit.documentPath);
      if (fs.existsSync(documentPath)) {
        fs.unlinkSync(documentPath);
      }
    }

    // Delete the deposit
    await existingDeposit.destroy({ transaction });

    await transaction.commit();
    res.json({ message: 'Customer deposit deleted successfully' });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: 'Failed to delete customer deposit' });
  }
});

// Export to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { 
      search = '', 
      currencyId = '', 
      paymentTypeId = '', 
      bankDetailId = '', 
      start_date = '', 
      end_date = '' 
    } = req.query;

    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { depositReferenceNumber: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add filters
    if (currencyId) {
      whereClause.currencyId = currencyId;
    }
    if (paymentTypeId) {
      whereClause.paymentTypeId = paymentTypeId;
    }
    if (bankDetailId) {
      whereClause.bankDetailId = bankDetailId;
    }
    if (start_date) {
      whereClause.transactionDate = { ...whereClause.transactionDate, [Op.gte]: start_date };
    }
    if (end_date) {
      whereClause.transactionDate = { ...whereClause.transactionDate, [Op.lte]: end_date };
    }

    const deposits = await CustomerDeposit.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Customer, as: 'customer', attributes: ['customer_id', 'full_name'] },
        { model: PaymentType, as: 'paymentType', attributes: ['name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['bankName', 'branch', 'accountNumber'] },
        { model: Currency, as: 'currency', attributes: ['code', 'name', 'symbol'] },
        { model: Account, as: 'liabilityAccount', attributes: ['code', 'name'] },
        { model: Account, as: 'assetAccount', attributes: ['code', 'name'] },
        { model: User, as: 'creator', attributes: ['first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['first_name', 'last_name'] }
      ],
      order: [['transactionDate', 'DESC']]
    });

    // Import ExcelJS dynamically
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customer Deposits');

    // Add headers
    worksheet.columns = [
      { header: 'Reference Number', key: 'depositReferenceNumber', width: 20 },
      { header: 'Customer ID', key: 'customer_id', width: 15 },
      { header: 'Customer Name', key: 'customer_name', width: 30 },
      { header: 'Payment Type', key: 'payment_type', width: 20 },
      { header: 'Bank', key: 'bank_name', width: 25 },
      { header: 'Branch', key: 'branch', width: 20 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Deposit Amount', key: 'deposit_amount', width: 15 },
      { header: 'Exchange Rate', key: 'exchange_rate', width: 15 },
      { header: 'Equivalent Amount', key: 'equivalent_amount', width: 18 },
      { header: 'Cheque Number', key: 'cheque_number', width: 15 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Transaction Date', key: 'transaction_date', width: 15 },
      { header: 'Created By', key: 'created_by', width: 20 },
      { header: 'Created Date', key: 'created_date', width: 15 },
      { header: 'Updated By', key: 'updated_by', width: 20 },
      { header: 'Updated Date', key: 'updated_date', width: 15 }
    ];

    // Add data rows
    deposits.forEach(deposit => {
      worksheet.addRow({
        depositReferenceNumber: deposit.depositReferenceNumber,
        customer_id: deposit.customer?.customer_id || '',
        customer_name: deposit.customer?.full_name || '',
        payment_type: deposit.paymentType?.name || '',
        bank_name: deposit.bankDetail?.bankName || '',
        branch: deposit.bankDetail?.branch || '',
        currency: deposit.currency?.code || '',
        deposit_amount: parseFloat(deposit.depositAmount || 0),
        exchange_rate: parseFloat(deposit.exchangeRate || 1),
        equivalent_amount: parseFloat(deposit.equivalentAmount || 0),
        cheque_number: deposit.chequeNumber || '',
        description: deposit.description || '',
        transaction_date: deposit.transactionDate ? new Date(deposit.transactionDate).toLocaleDateString() : '',
        created_by: deposit.creator ? `${deposit.creator.first_name} ${deposit.creator.last_name}` : '',
        created_date: deposit.createdAt ? new Date(deposit.createdAt).toLocaleDateString() : '',
        updated_by: deposit.updater ? `${deposit.updater.first_name} ${deposit.updater.last_name}` : '',
        updated_date: deposit.updatedAt ? new Date(deposit.updatedAt).toLocaleDateString() : ''
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=customer-deposits-${new Date().toISOString().split('T')[0]}.xlsx`);

    // Write the workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to export customer deposits to Excel' });
  }
});

// Export to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { 
      search = '', 
      currencyId = '', 
      paymentTypeId = '', 
      bankDetailId = '', 
      start_date = '', 
      end_date = '' 
    } = req.query;

    const whereClause = {};
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { depositReferenceNumber: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { '$customer.full_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add filters
    if (currencyId) {
      whereClause.currencyId = currencyId;
    }
    if (paymentTypeId) {
      whereClause.paymentTypeId = paymentTypeId;
    }
    if (bankDetailId) {
      whereClause.bankDetailId = bankDetailId;
    }
    if (start_date) {
      whereClause.transactionDate = { ...whereClause.transactionDate, [Op.gte]: start_date };
    }
    if (end_date) {
      whereClause.transactionDate = { ...whereClause.transactionDate, [Op.lte]: end_date };
    }

    const deposits = await CustomerDeposit.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Customer, as: 'customer', attributes: ['customer_id', 'full_name'] },
        { model: PaymentType, as: 'paymentType', attributes: ['name', 'code'] },
        { model: BankDetail, as: 'bankDetail', attributes: ['bankName', 'branch', 'accountNumber'] },
        { model: Currency, as: 'currency', attributes: ['code', 'name', 'symbol'] },
        { model: Account, as: 'liabilityAccount', attributes: ['code', 'name'] },
        { model: Account, as: 'assetAccount', attributes: ['code', 'name'] },
        { model: User, as: 'creator', attributes: ['first_name', 'last_name'] },
        { model: User, as: 'updater', attributes: ['first_name', 'last_name'] }
      ],
      order: [['transactionDate', 'DESC']]
    });

    // Import PDFDocument dynamically
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=customer-deposits-${new Date().toISOString().split('T')[0]}.pdf`);

    // Pipe the document to response
    doc.pipe(res);

    // Add title
    doc.fontSize(16).text('Customer Deposits Report', { align: 'center' });
    doc.moveDown();

    // Add generation date
    doc.fontSize(10).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'right' });
    doc.moveDown(2);

    // Add summary
    const totalDeposits = deposits.length;
    const totalAmount = deposits.reduce((sum, deposit) => sum + parseFloat(deposit.equivalentAmount || 0), 0);
    
    doc.fontSize(12).text(`Total Deposits: ${totalDeposits}`);
    doc.text(`Total Amount: ${totalAmount.toLocaleString()}`);
    doc.moveDown(2);

    // Add table headers
    doc.fontSize(10);
    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 120;
    const col3 = 200;
    const col4 = 280;
    const col5 = 360;
    const col6 = 450;

    doc.text('Ref #', col1, tableTop);
    doc.text('Customer', col2, tableTop);
    doc.text('Payment Type', col3, tableTop);
    doc.text('Amount', col4, tableTop);
    doc.text('Currency', col5, tableTop);
    doc.text('Date', col6, tableTop);

    // Draw line under headers
    doc.moveTo(col1, tableTop + 15).lineTo(col6 + 50, tableTop + 15).stroke();

    // Add data rows
    let currentY = tableTop + 25;
    deposits.forEach((deposit, index) => {
      if (currentY > 750) { // Start new page if needed
        doc.addPage();
        currentY = 50;
      }

      doc.text(deposit.depositReferenceNumber || '', col1, currentY);
      doc.text(deposit.customer?.full_name || '', col2, currentY);
      doc.text(deposit.paymentType?.name || '', col3, currentY);
      doc.text(`${parseFloat(deposit.depositAmount || 0).toLocaleString()}`, col4, currentY);
      doc.text(deposit.currency?.code || '', col5, currentY);
      doc.text(deposit.transactionDate ? new Date(deposit.transactionDate).toLocaleDateString() : '', col6, currentY);

      currentY += 20;
    });

    // Finalize the PDF
    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to export customer deposits to PDF' });
  }
});

module.exports = router;
