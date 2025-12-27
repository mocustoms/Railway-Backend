const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const sequelize = require('../../config/database');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Import models
const { 
  CustomerDeposit, 
  Customer, 
  PaymentType, 
  BankDetail, 
  Currency, 
  ExchangeRate, 
  Account, 
  GeneralLedger,
  User,
  FinancialYear,
  TransactionType
} = require('../models');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

// Download template
router.get('/template', csrfProtection, async (req, res) => {
  try {
    // Get existing customers for the template (filtered by companyId and is_active)
    const customers = await Customer.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'customer_id', 'full_name'],
      order: [['full_name', 'ASC']]
    });

    // Get reference data for dropdowns (filtered by companyId and is_active)
    const paymentTypes = await PaymentType.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'name', 'code'],
      order: [['code', 'ASC']]
    });

    const bankDetails = await BankDetail.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code', 'bankName', 'accountNumber', 'branch'],
      order: [['bankName', 'ASC']]
    });

    const currencies = await Currency.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code', 'name'],
      order: [['code', 'ASC']]
    });

    // Create workbook with template structure
    const workbook = XLSX.utils.book_new();
    
    // Get accounts for template
    const accounts = await Account.findAll({
      where: buildCompanyWhere(req, { status: 'active' }),
      attributes: ['id', 'code', 'name', 'type'],
      order: [['code', 'ASC']]
    });

    // Define headers based on customer deposit model
    const headers = [
      'Customer Code*',
      'Customer Name*',
      'Payment Type Code*',
      'Payment Type Name*',
      'Cheque Number',
      'Bank Code',
      'Bank Name',
      'Bank Account Number',
      'Bank Branch',
      'Currency Code*',
      'Currency Name*',
      'Deposit Amount*',
      'Liability Account Code*',
      'Liability Account Name*',
      'Asset Account Code*',
      'Asset Account Name*',
      'Description',
      'Transaction Date*',
      'Status*'
    ];

    // Create sample data rows with actual customer data
    const sampleData = [];
    const maxSamples = Math.min(5, customers.length);
    
    // Get liability and asset accounts for samples
    const liabilityAccounts = accounts.filter(acc => acc.type === 'LIABILITY');
    const assetAccounts = accounts.filter(acc => acc.type === 'ASSET');
    
    // Use specific accounts that exist in the database
    const defaultLiabilityAccount = liabilityAccounts.find(acc => acc.code === '2610') || liabilityAccounts[0]; // Customer Deposits
    const defaultAssetAccount = assetAccounts.find(acc => acc.code === '1121') || assetAccounts[0]; // Main Bank Account
    
    for (let i = 0; i < maxSamples; i++) {
      const customer = customers[i];
      const paymentType = paymentTypes[i % paymentTypes.length];
      const bank = bankDetails[i % bankDetails.length];
      const currency = currencies[i % currencies.length];
      
      sampleData.push([
        customer.customer_id, // CUST-YYYYMMDD-XXXX format
        customer.full_name,
        paymentType.code, // 000001, 000002, 000003 format
        paymentType.name,
        `CHQ${String(i + 1).padStart(4, '0')}`,
        bank.code, // 000001, 000002, 000003 format
        bank.bankName, // CRDB, NMB, DTB
        bank.accountNumber, // Actual account numbers
        bank.branch, // Actual branch names
        currency.code, // USD, TZS, KES, etc.
        currency.name,
        '1000.00', // Deposit Amount
        defaultLiabilityAccount.code, // Liability Account Code (2610)
        defaultLiabilityAccount.name, // Liability Account Name (Customer Deposits)
        defaultAssetAccount.code, // Asset Account Code (1121)
        defaultAssetAccount.name, // Asset Account Name (Main Bank Account)
        `Sample deposit ${i + 1}`,
        new Date().toISOString().split('T')[0],
        'active'
      ]);
    }

    // Create main worksheet
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
    
    // Set column widths
    const columnWidths = [
      { wch: 15 }, // Customer Code
      { wch: 25 }, // Customer Name
      { wch: 15 }, // Payment Type Code
      { wch: 20 }, // Payment Type Name
      { wch: 15 }, // Cheque Number
      { wch: 12 }, // Bank Code
      { wch: 20 }, // Bank Name
      { wch: 20 }, // Bank Account Number
      { wch: 15 }, // Bank Branch
      { wch: 12 }, // Currency Code
      { wch: 15 }, // Currency Name
      { wch: 15 }, // Deposit Amount
      { wch: 18 }, // Liability Account Code
      { wch: 25 }, // Liability Account Name
      { wch: 18 }, // Asset Account Code
      { wch: 25 }, // Asset Account Name
      { wch: 30 }, // Description
      { wch: 15 }, // Transaction Date
      { wch: 10 }  // Status
    ];
    worksheet['!cols'] = columnWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customer Deposits Template');

    // Add reference data sheets
    // Customers sheet
    const customersHeaders = ['Customer Code', 'Customer Name'];
    const customersData = customers.map(customer => [customer.customer_id, customer.full_name]);
    const customersSheet = XLSX.utils.aoa_to_sheet([customersHeaders, ...customersData]);
    XLSX.utils.book_append_sheet(workbook, customersSheet, 'Customers');

    // Payment Types sheet
    const paymentTypesHeaders = ['Payment Type Code', 'Payment Type Name'];
    const paymentTypesData = paymentTypes.map(pt => [pt.code, pt.name]);
    const paymentTypesSheet = XLSX.utils.aoa_to_sheet([paymentTypesHeaders, ...paymentTypesData]);
    XLSX.utils.book_append_sheet(workbook, paymentTypesSheet, 'Payment Types');

    // Banks sheet
    const banksHeaders = ['Bank Code', 'Bank Name', 'Account Number', 'Branch'];
    const banksData = bankDetails.map(bank => [
      bank.code, 
      bank.bankName, 
      bank.accountNumber, 
      bank.branch
    ]);
    const banksSheet = XLSX.utils.aoa_to_sheet([banksHeaders, ...banksData]);
    XLSX.utils.book_append_sheet(workbook, banksSheet, 'Banks');

    // Currencies sheet
    const currenciesHeaders = ['Currency Code', 'Currency Name'];
    const currenciesData = currencies.map(currency => [currency.code, currency.name]);
    const currenciesSheet = XLSX.utils.aoa_to_sheet([currenciesHeaders, ...currenciesData]);
    XLSX.utils.book_append_sheet(workbook, currenciesSheet, 'Currencies');

    // Accounts sheet
    const accountsHeaders = ['Account Code', 'Account Name', 'Account Type'];
    const accountsData = accounts.map(account => [account.code, account.name, account.type]);
    const accountsSheet = XLSX.utils.aoa_to_sheet([accountsHeaders, ...accountsData]);
    XLSX.utils.book_append_sheet(workbook, accountsSheet, 'Accounts');

    // Add instructions sheet
    const instructions = [
      ['Instructions for Customer Deposits Import'],
      [''],
      ['Required Fields (marked with *):'],
      ['- Customer Code: Must exist in the system (see Customers sheet)'],
      ['- Customer Name: Must match the customer code'],
      ['- Payment Type Code: Must exist in the system (see Payment Types sheet)'],
      ['- Payment Type Name: Must match the payment type code'],
      ['- Currency Code: Must exist in the system (see Currencies sheet)'],
      ['- Currency Name: Must match the currency code'],
      ['- Deposit Amount: Numeric value (e.g., 1000.00)'],
      ['- Liability Account Code: Must exist in the system (see Accounts sheet)'],
      ['- Liability Account Name: Must match the liability account code'],
      ['- Asset Account Code: Must exist in the system (see Accounts sheet)'],
      ['- Asset Account Name: Must match the asset account code'],
      ['- Transaction Date: Date in YYYY-MM-DD format'],
      ['- Status: active or inactive'],
      [''],
      ['Optional Fields:'],
      ['- Cheque Number: For cheque payments'],
      ['- Bank Code: Must exist in the system (see Banks sheet)'],
      ['- Bank Name: Must match the bank code'],
      ['- Bank Account Number: Must match the bank code'],
      ['- Bank Branch: Must match the bank code'],
      ['- Description: Any additional notes'],
      [''],
      ['Auto-Calculated Fields:'],
      ['- Exchange Rate: Automatically calculated based on currency'],
      ['- Equivalent Amount: Automatically calculated (Deposit Amount × Exchange Rate)'],
      [''],
      ['Notes:'],
      ['- Do not modify the header row'],
      ['- Use the reference sheets to get correct codes'],
      ['- Ensure all required fields are filled'],
      ['- Check that referenced data exists in the system'],
      ['- Liability accounts must be of type LIABILITY'],
      ['- Asset accounts must be of type ASSET'],
      ['- Deposit reference numbers are automatically generated'],
      ['- Customer account balances will be updated automatically'],
      ['- General Ledger entries will be created automatically']
    ];

    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer-deposits-import-template.xlsx"');
    res.send(buffer);

  } catch (error) {
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// Upload and validate file
router.post('/upload', csrfProtection, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (data.length < 2) {
      return res.status(400).json({ error: 'File is empty or missing data' });
    }

    const headers = data[0];
    const rows = data.slice(1);
    
    const errors = [];
    const validData = [];

    // Get reference data for validation (filtered by companyId and is_active)
    const customers = await Customer.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'customer_id', 'full_name']
    });
    
    const paymentTypes = await PaymentType.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'name', 'code']
    });

    const bankDetails = await BankDetail.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code', 'bank_name', 'account_number', 'branch']
    });

    const currencies = await Currency.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code', 'name']
    });

    const accounts = await Account.findAll({
      where: buildCompanyWhere(req, { status: 'active' }),
      attributes: ['id', 'code', 'name', 'type']
    });

    // Create lookup maps
    const customerMap = new Map();
    customers.forEach(customer => {
      customerMap.set(customer.customer_id, { id: customer.id, name: customer.full_name });
    });

    const paymentTypeMap = new Map();
    paymentTypes.forEach(pt => {
      paymentTypeMap.set(pt.code, { id: pt.id, name: pt.name });
    });

    const bankMap = new Map();
    bankDetails.forEach(bank => {
      bankMap.set(bank.code, { 
        id: bank.id, 
        name: bank.bankName, 
        account: bank.accountNumber, 
        branch: bank.branch 
      });
    });

    const currencyMap = new Map();
    currencies.forEach(currency => {
      currencyMap.set(currency.code, { id: currency.id, name: currency.name });
    });

    const accountMap = new Map();
    accounts.forEach(account => {
      accountMap.set(account.code, { id: account.id, name: account.name, type: account.type });
    });

    // Validate each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because we start from row 2 (after header)
      
      if (row.length === 0 || row.every(cell => !cell)) {
        continue; // Skip empty rows
      }

      const rowData = {};
      const rowErrors = [];

      // Map headers to data
      headers.forEach((header, index) => {
        rowData[header] = row[index] || '';
      });

      // Validate required fields
      if (!rowData['Customer Code*']) {
        rowErrors.push('Customer Code is required');
      } else if (!customerMap.has(rowData['Customer Code*'])) {
        rowErrors.push(`Customer Code '${rowData['Customer Code*']}' not found`);
      } else if (rowData['Customer Name*'] && rowData['Customer Name*'] !== customerMap.get(rowData['Customer Code*']).name) {
        rowErrors.push(`Customer Name '${rowData['Customer Name*']}' does not match Customer Code '${rowData['Customer Code*']}'`);
      }

      if (!rowData['Payment Type Code*']) {
        rowErrors.push('Payment Type Code is required');
      } else if (!paymentTypeMap.has(rowData['Payment Type Code*'])) {
        rowErrors.push(`Payment Type Code '${rowData['Payment Type Code*']}' not found`);
      }

      if (!rowData['Currency Code*']) {
        rowErrors.push('Currency Code is required');
      } else if (!currencyMap.has(rowData['Currency Code*'])) {
        rowErrors.push(`Currency Code '${rowData['Currency Code*']}' not found`);
      }

      if (!rowData['Deposit Amount*'] || isNaN(parseFloat(rowData['Deposit Amount*']))) {
        rowErrors.push('Valid Deposit Amount is required');
      }

      if (!rowData['Liability Account Code*']) {
        rowErrors.push('Liability Account Code is required');
      } else if (!accountMap.has(rowData['Liability Account Code*'])) {
        rowErrors.push(`Liability Account Code '${rowData['Liability Account Code*']}' not found`);
      } else {
        const liabilityAccount = accountMap.get(rowData['Liability Account Code*']);
        if (liabilityAccount.type !== 'LIABILITY') {
          rowErrors.push(`Account '${rowData['Liability Account Code*']}' is not a Liability account`);
        }
      }

      if (!rowData['Asset Account Code*']) {
        rowErrors.push('Asset Account Code is required');
      } else if (!accountMap.has(rowData['Asset Account Code*'])) {
        rowErrors.push(`Asset Account Code '${rowData['Asset Account Code*']}' not found`);
      } else {
        const assetAccount = accountMap.get(rowData['Asset Account Code*']);
        if (assetAccount.type !== 'ASSET') {
          rowErrors.push(`Account '${rowData['Asset Account Code*']}' is not an Asset account`);
        }
      }

      if (!rowData['Transaction Date*']) {
        rowErrors.push('Transaction Date is required');
      } else {
        const transactionDate = new Date(rowData['Transaction Date*']);
        if (isNaN(transactionDate.getTime())) {
          rowErrors.push('Invalid Transaction Date format. Use YYYY-MM-DD');
        }
      }

      if (!rowData['Status*'] || !['active', 'inactive'].includes(rowData['Status*'].toLowerCase())) {
        rowErrors.push('Status must be either "active" or "inactive"');
      }

      // Validate optional bank fields
      if (rowData['Bank Code'] && !bankMap.has(rowData['Bank Code'])) {
        rowErrors.push(`Bank Code '${rowData['Bank Code']}' not found`);
      }

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
      } else {
        // Add reference IDs to valid data
        const customerData = customerMap.get(rowData['Customer Code*']);
        const paymentTypeData = paymentTypeMap.get(rowData['Payment Type Code*']);
        const currencyData = currencyMap.get(rowData['Currency Code*']);
        
        rowData.customer_id = customerData.id;
        rowData.payment_type_id = paymentTypeData.id;
        rowData.currency_id = currencyData.id;
        
        if (rowData['Bank Code']) {
          const bankData = bankMap.get(rowData['Bank Code']);
          rowData.bank_detail_id = bankData.id;
        }
        
        validData.push(rowData);
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      data: validData,
      errors: errors,
      summary: {
        totalRows: rows.length,
        validRows: validData.length,
        errorRows: errors.length
      }
    });

  } catch (error) {
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process file',
      details: error.message 
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field. Please use the correct file input.' });
    }
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }
  
  if (error.message === 'Only Excel files (.xlsx, .xls) are allowed') {
    return res.status(400).json({ error: error.message });
  }
  
  if (error.code === 'ENOENT') {
    return res.status(500).json({ error: 'File system error. Please try again.' });
  }
  
  next(error);
});

// Import validated data
router.post('/data', csrfProtection, async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    if (data.length === 0) {
      return res.json({
        success: true,
        imported: 0,
        skipped: 0,
        errors: [{ row: 0, message: 'No valid data found to import' }]
      });
    }

    // Get reference data for lookups (filtered by companyId and is_active)
    const customers = await Customer.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'customer_id']
    });
    
    const paymentTypes = await PaymentType.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code']
    });

    const bankDetails = await BankDetail.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code']
    });

    const currencies = await Currency.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'code']
    });

    const accounts = await Account.findAll({
      where: buildCompanyWhere(req, { status: 'active' }),
      attributes: ['id', 'code', 'name', 'type']
    });

    // Get additional required data for GeneralLedger
    const currentFinancialYear = await FinancialYear.findOne({ 
      where: buildCompanyWhere(req, { isActive: true }), 
      attributes: ['id', 'name'] 
    });
    const transactionType = await TransactionType.findOne({ 
      where: { code: 'CUSTOMER_DEPOSIT' }, // Global - no company filtering
      attributes: ['id'] 
    });
    const systemCurrency = await Currency.findOne({ 
      where: buildCompanyWhere(req, { is_default: true }), 
      attributes: ['id', 'code', 'name', 'symbol']
    });

    if (!currentFinancialYear) {
      throw new Error('No active financial year found');
    }
    if (!transactionType) {
      throw new Error('Transaction type CUSTOMER_DEPOSIT not found');
    }
    if (!systemCurrency) {
      throw new Error('System default currency not found');
    }

    // Create lookup maps
    const customerMap = new Map();
    customers.forEach(customer => {
      customerMap.set(customer.customer_id, customer.id);
    });

    const paymentTypeMap = new Map();
    paymentTypes.forEach(pt => {
      paymentTypeMap.set(pt.code, pt.id);
    });

    const bankMap = new Map();
    bankDetails.forEach(bank => {
      bankMap.set(bank.code, bank.id);
    });

    const currencyMap = new Map();
    currencies.forEach(currency => {
      currencyMap.set(currency.code, currency.id);
    });

    const accountMap = new Map();
    accounts.forEach(account => {
      accountMap.set(account.code, { 
        id: account.id, 
        name: account.name, 
        type: account.type,
        code: account.code
      });
    });

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const rowTransaction = await sequelize.transaction();
      try {
        const rowData = data[i];
        
        // Generate deposit reference number
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
        
        // Get the last deposit created today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const lastDeposit = await CustomerDeposit.findOne({
          where: buildCompanyWhere(req, {
            createdAt: {
              [Op.between]: [todayStart, todayEnd]
            }
          }),
          order: [['createdAt', 'DESC']],
          attributes: ['depositReferenceNumber'],
          transaction: rowTransaction
        });

        let seq = 1;
        if (lastDeposit) {
          const lastSeqMatch = lastDeposit.depositReferenceNumber.match(/DEP-\d{8}-(\d+)$/);
          if (lastSeqMatch) {
            seq = parseInt(lastSeqMatch[1]) + 1;
          }
        }

        const depositReferenceNumber = `DEP-${dateStr}-${seq.toString().padStart(4, '0')}`;

        // Get current exchange rate
        let exchangeRate = 1.0;
        let exchangeRateId = null;
        
        // Get system default currency (filtered by companyId)
        const systemCurrency = await Currency.findOne({
          where: buildCompanyWhere(req, { is_default: true }),
          attributes: ['id', 'code']
        });
        
        const currencyId = currencyMap.get(rowData['Currency Code*']);
        const depositAmount = parseFloat(rowData['Deposit Amount*']);
        
        if (currencyId !== systemCurrency?.id) {
          // Find exchange rate for foreign currency
          const exchangeRateRecord = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, {
              from_currency_id: currencyId,
              to_currency_id: systemCurrency?.id,
              is_active: true
            }),
            order: [['created_at', 'DESC']],
            transaction: rowTransaction
          });
          
          if (exchangeRateRecord) {
            exchangeRate = exchangeRateRecord.rate;
            exchangeRateId = exchangeRateRecord.id;
          } else {
            throw new Error(`Exchange rate not found for currency ${rowData['Currency Code*']}`);
          }
        } else {
          // For system currency, create or find 1:1 exchange rate
          const oneToOneRate = await ExchangeRate.findOne({
            where: buildCompanyWhere(req, {
              from_currency_id: currencyId,
              to_currency_id: systemCurrency?.id,
              rate: 1.0
            }),
            transaction: rowTransaction
          });
          
          if (oneToOneRate) {
            exchangeRateId = oneToOneRate.id;
          } else {
            const newRate = await ExchangeRate.create({
              companyId: req.user.companyId,
              from_currency_id: currencyId,
              to_currency_id: systemCurrency?.id,
              rate: 1.0,
              is_active: true,
              created_by: req.user.id
            }, { transaction: rowTransaction });
            exchangeRateId = newRate.id;
          }
        }

        // Calculate equivalent amount
        const equivalentAmount = depositAmount * exchangeRate;

        // Get account IDs from codes
        // Account IDs from codes
        const liabilityAccount = accountMap.get(rowData['Liability Account Code*']);
        const assetAccount = accountMap.get(rowData['Asset Account Code*']);

        if (!liabilityAccount || !assetAccount) {
          throw new Error('Required accounts not found. Please ensure liability and asset accounts are configured.');
        }

        // Create customer deposit
        const customerDeposit = await CustomerDeposit.create({
          companyId: req.user.companyId,
          depositReferenceNumber,
          customerId: customerMap.get(rowData['Customer Code*']),
          paymentTypeId: paymentTypeMap.get(rowData['Payment Type Code*']),
          chequeNumber: rowData['Cheque Number'] || null,
          bankDetailId: rowData['Bank Code'] ? bankMap.get(rowData['Bank Code']) : null,
          branch: rowData['Bank Branch'] || null,
          currencyId: currencyMap.get(rowData['Currency Code*']),
          exchangeRate: exchangeRate,
          exchangeRateId: exchangeRateId,
          documentPath: null,
          depositAmount: depositAmount,
          equivalentAmount: equivalentAmount,
          description: rowData['Description'] || null,
          liabilityAccountId: liabilityAccount.id,
          assetAccountId: assetAccount.id,
          transactionDate: new Date(rowData['Transaction Date*']),
          is_active: rowData['Status*'].toLowerCase() === 'active',
          createdBy: req.user.id,
          updatedBy: req.user.id
        }, { transaction: rowTransaction });

        // Update customer account balance
        await Customer.increment('account_balance', {
          by: equivalentAmount,
          where: { id: customerMap.get(rowData['Customer Code*']) },
          transaction: rowTransaction
        });

        // Create General Ledger entries (double-entry bookkeeping)
        const generalLedgerId = require('uuid').v4();
        
        // Debit: Asset Account (Cash/Bank)
        await GeneralLedger.create({
          id: require('uuid').v4(),
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: new Date(rowData['Transaction Date*']),
          reference_number: depositReferenceNumber,
          transaction_type: 'CUSTOMER_DEPOSIT',
          transaction_type_name: 'Customer Deposit',
          transaction_type_id: transactionType.id,
          created_by_code: req.user.id,
          created_by_name: `${req.user.first_name} ${req.user.last_name}`,
          description: rowData['Description'] || `Customer deposit - ${depositReferenceNumber}`,
          account_type_code: 'ASSET',
          account_type_name: 'Asset',
          account_id: assetAccount.id,
          account_name: assetAccount.name,
          account_code: assetAccount.code,
          account_nature: 'debit',
          exchange_rate: exchangeRate,
          amount: depositAmount,
          system_currency_id: systemCurrency.id,
          user_debit_amount: depositAmount,
          equivalent_debit_amount: equivalentAmount,
          username: req.user.username,
          general_ledger_id: generalLedgerId,
          companyId: req.user.companyId // Add companyId for multi-tenant support
        }, { transaction: rowTransaction });

        // Credit: Liability Account (Customer Deposits)
          await GeneralLedger.create({
          id: require('uuid').v4(),
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: new Date(rowData['Transaction Date*']),
          reference_number: depositReferenceNumber,
          transaction_type: 'CUSTOMER_DEPOSIT',
          transaction_type_name: 'Customer Deposit',
          transaction_type_id: transactionType.id,
          created_by_code: req.user.id,
          created_by_name: `${req.user.first_name} ${req.user.last_name}`,
          description: rowData['Description'] || `Customer deposit - ${depositReferenceNumber}`,
          account_type_code: 'LIABILITY',
          account_type_name: 'Liability',
          account_id: liabilityAccount.id,
          account_name: liabilityAccount.name,
          account_code: liabilityAccount.code,
          account_nature: 'credit',
          exchange_rate: exchangeRate,
          amount: depositAmount,
          system_currency_id: systemCurrency.id,
          user_credit_amount: depositAmount,
          equivalent_credit_amount: equivalentAmount,
          username: req.user.username,
          general_ledger_id: generalLedgerId,
          companyId: req.user.companyId // Add companyId for multi-tenant support
        }, { transaction: rowTransaction });

        await rowTransaction.commit();
        imported++;

      } catch (error) {
        await rowTransaction.rollback();
        errors.push({
          row: i + 1,
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      imported,
      skipped,
      errors
    });

  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to import customer deposits',
      details: error.message 
    });
  }
});

module.exports = router;
