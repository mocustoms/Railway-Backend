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
const autoCodeService = require('../utils/autoCodeService');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Import models
const { Customer, CustomerGroup, LoyaltyCardConfig, Account } = require('../models');

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
    // Get reference data for dropdowns (filtered by companyId)
    const customerGroups = await CustomerGroup.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'group_code', 'group_name'],
      order: [['group_code', 'ASC']]
    });

    const loyaltyCards = await LoyaltyCardConfig.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'loyalty_card_code', 'loyalty_card_name'],
      order: [['loyalty_card_code', 'ASC']]
    });

    // Create workbook with template structure
    const workbook = XLSX.utils.book_new();
    
    // Define headers based on customer model - using codes for foreign keys
    const headers = [
      'Customer Group Code*',
      'Full Name*',
      'Address',
      'Phone Number',
      'Email',
      'Website',
      'Fax',
      'Birthday',
      'Loyalty Card Code',
      'Loyalty Card Number',
      'Status*'
    ];

    // Add sample data row with actual data if available
    const sampleCustomerGroup = customerGroups.length > 0 ? customerGroups[0].group_code : 'PREMIUM';
    const sampleLoyaltyCard = loyaltyCards.length > 0 ? loyaltyCards[0].loyalty_card_code : 'GOLD';
    
    const sampleData = [
      sampleCustomerGroup,
      'John Doe',
      '123 Main Street, City, State 12345',
      '+1234567890',
      'john.doe@example.com',
      'https://johndoe.com',
      '+1234567891',
      '1990-01-15',
      sampleLoyaltyCard,
      'GC001',
      'active'
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([headers, sampleData]);
    
    // Set column widths
    const columnWidths = [
      { wch: 18 }, // Customer Group Code
      { wch: 20 }, // Full Name
      { wch: 30 }, // Address
      { wch: 15 }, // Phone Number
      { wch: 25 }, // Email
      { wch: 20 }, // Website
      { wch: 15 }, // Fax
      { wch: 12 }, // Birthday
      { wch: 18 }, // Loyalty Card Code
      { wch: 18 }, // Loyalty Card Number
      { wch: 10 }  // Status
    ];
    worksheet['!cols'] = columnWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers Template');

    // Add reference data sheets
    // Customer Groups sheet
    const customerGroupsHeaders = ['Customer Group Code', 'Customer Group Name'];
    const customerGroupsData = customerGroups.map(group => [group.group_code, group.group_name]);
    const customerGroupsSheet = XLSX.utils.aoa_to_sheet([customerGroupsHeaders, ...customerGroupsData]);
    XLSX.utils.book_append_sheet(workbook, customerGroupsSheet, 'Customer Groups');

    // Loyalty Cards sheet
    const loyaltyCardsHeaders = ['Loyalty Card Code', 'Loyalty Card Name'];
    const loyaltyCardsData = loyaltyCards.map(card => [card.loyalty_card_code, card.loyalty_card_name]);
    const loyaltyCardsSheet = XLSX.utils.aoa_to_sheet([loyaltyCardsHeaders, ...loyaltyCardsData]);
    XLSX.utils.book_append_sheet(workbook, loyaltyCardsSheet, 'Loyalty Cards');

    // Add instructions sheet
    const instructions = [
      ['Instructions for Customer Import'],
      [''],
      ['Required Fields (marked with *):'],
      ['- Customer Group Code: Must exist in the system (e.g., PREMIUM, STANDARD)'],
      ['- Full Name: Customer\'s complete name'],
      ['- Status: active or inactive'],
      [''],
      ['Optional Fields:'],
      ['- Address: Customer address'],
      ['- Phone Number: Contact number'],
      ['- Email: Valid email address'],
      ['- Website: Customer website URL'],
      ['- Fax: Fax number'],
      ['- Birthday: Date in YYYY-MM-DD or MM/DD/YYYY format'],
      ['- Loyalty Card Code: Must exist in the system (e.g., GOLD, SILVER)'],
      ['- Loyalty Card Number: Card number'],
      [''],
      ['Notes:'],
      ['- Do not modify the header row'],
      ['- Remove the sample data row before adding your data'],
      ['- Ensure all required fields are filled'],
      ['- Use CODES not names for Customer Group and Loyalty Card'],
      ['- Check the "Customer Groups" and "Loyalty Cards" reference sheets for valid codes'],
      ['- All codes must exist in your company\'s data'],
      ['- Customer IDs are automatically generated in format: CUST-YYYYMMDD-XXXX'],
      ['- Customer IDs are unique per company'],
      [''],
      ['IMPORTANT FORMATTING:'],
      ['- Format ALL columns as TEXT before entering data'],
      ['- This prevents Excel from auto-formatting your data incorrectly'],
      ['- Phone numbers, fax, and loyalty card numbers should be TEXT format'],
      ['- Birthday should be TEXT format (not date format)']
    ];

    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
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
    const warnings = [];
    const validData = [];

    // Get reference data for validation - using codes instead of names
    const customerGroups = await CustomerGroup.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'group_code', 'account_receivable_id']
    });
    
    const loyaltyCards = await LoyaltyCardConfig.findAll({
      where: buildCompanyWhere(req, { is_active: true }),
      attributes: ['id', 'loyalty_card_code']
    });

    const customerGroupMap = new Map();
    customerGroups.forEach(group => {
      customerGroupMap.set(group.group_code, { id: group.id, account_receivable_id: group.account_receivable_id });
    });

    const loyaltyCardMap = new Map();
    loyaltyCards.forEach(card => {
      loyaltyCardMap.set(card.loyalty_card_code, card.id);
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
      const rowWarnings = [];

      // Map headers to data
      headers.forEach((header, index) => {
        rowData[header] = row[index] || '';
      });

      // Validate required fields
      if (!rowData['Customer Group Code*']) {
        rowErrors.push('Customer Group Code is required');
      } else if (!customerGroupMap.has(rowData['Customer Group Code*'])) {
        rowErrors.push(`Customer Group Code '${rowData['Customer Group Code*']}' not found`);
      }

      if (!rowData['Full Name*']) {
        rowErrors.push('Full Name is required');
      }

      if (!rowData['Status*']) {
        rowErrors.push('Status is required');
      } else if (!['active', 'inactive'].includes(rowData['Status*'].toLowerCase())) {
        rowErrors.push('Status must be either "active" or "inactive"');
      }

      // Validate optional fields
      if (rowData['Email'] && typeof rowData['Email'] === 'string' && rowData['Email'].trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(rowData['Email'])) {
          rowErrors.push('Invalid email format');
        }
      }

      if (rowData['Website'] && typeof rowData['Website'] === 'string' && rowData['Website'].trim() !== '') {
        try {
          new URL(rowData['Website']);
        } catch {
          rowErrors.push('Invalid website URL format');
        }
      }

      if (rowData['Birthday'] && typeof rowData['Birthday'] === 'string' && rowData['Birthday'].trim() !== '') {
        const birthdayStr = rowData['Birthday'].trim();
        let birthday;
        
        // Try different date formats
        if (birthdayStr.includes('/')) {
          // Handle MM/DD/YYYY format
          birthday = new Date(birthdayStr);
        } else if (birthdayStr.includes('-')) {
          // Handle YYYY-MM-DD format
          birthday = new Date(birthdayStr);
        } else {
          // Try parsing as-is
          birthday = new Date(birthdayStr);
        }
        
        if (isNaN(birthday.getTime())) {
          rowErrors.push('Invalid birthday format. Use YYYY-MM-DD or MM/DD/YYYY');
        } else {
          // Convert to YYYY-MM-DD format for storage
          const year = birthday.getFullYear();
          const month = String(birthday.getMonth() + 1).padStart(2, '0');
          const day = String(birthday.getDate()).padStart(2, '0');
          rowData['Birthday'] = `${year}-${month}-${day}`;
        }
      }

      if (rowData['Loyalty Card Code'] && typeof rowData['Loyalty Card Code'] === 'string' && rowData['Loyalty Card Code'].trim() !== '') {
        if (!loyaltyCardMap.has(rowData['Loyalty Card Code'])) {
          rowErrors.push(`Loyalty Card Code '${rowData['Loyalty Card Code']}' not found`);
        }
      }

      // Check for missing optional fields and add warnings
      if (!rowData['Phone Number'] || typeof rowData['Phone Number'] !== 'string' || rowData['Phone Number'].trim() === '') {
        rowWarnings.push('Phone Number is missing');
      }
      
      if (!rowData['Fax'] || typeof rowData['Fax'] !== 'string' || rowData['Fax'].trim() === '') {
        rowWarnings.push('Fax is missing');
      }
      
      if (!rowData['Birthday'] || typeof rowData['Birthday'] !== 'string' || rowData['Birthday'].trim() === '') {
        rowWarnings.push('Birthday is missing');
      }
      
      if (!rowData['Email'] || typeof rowData['Email'] !== 'string' || rowData['Email'].trim() === '') {
        rowWarnings.push('Email is missing');
      }
      
      if (!rowData['Website'] || typeof rowData['Website'] !== 'string' || rowData['Website'].trim() === '') {
        rowWarnings.push('Website is missing');
      }

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
      } else {
        // Add warnings if any
        if (rowWarnings.length > 0) {
          warnings.push({
            row: rowNumber,
            customer: rowData['Full Name*'],
            message: rowWarnings.join('; ')
          });
        }
        
        // Add customer group ID, account receivable ID, and loyalty card ID to valid data
        const customerGroupData = customerGroupMap.get(rowData['Customer Group Code*']);
        rowData.customer_group_id = customerGroupData.id;
        rowData.default_receivable_account_id = customerGroupData.account_receivable_id;
        
        if (rowData['Loyalty Card Code'] && typeof rowData['Loyalty Card Code'] === 'string' && rowData['Loyalty Card Code'].trim() !== '') {
          rowData.loyalty_card_config_id = loyaltyCardMap.get(rowData['Loyalty Card Code']);
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
      warnings: warnings,
      summary: {
        totalRows: rows.length,
        validRows: validData.length,
        errorRows: errors.length,
        warningRows: warnings.length
      }
    });

  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to process file',
      details: error.message 
    });
  }
});

// Import validated data
router.post('/data', csrfProtection, async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      try {
        const rowData = data[i];
        
        // Check if customer with same name and group already exists
        const existingCustomer = await Customer.findOne({ 
          where: buildCompanyWhere(req, { 
            full_name: rowData['Full Name*'],
            customer_group_id: rowData.customer_group_id
          })
        });
        
        if (existingCustomer) {
          skipped++;
          continue;
        }

        // Auto-generate customer_id using AutoCode system (same as manual creation)
        // Format: CUST-YYYYMMDD-XXXX (e.g., CUST-20251106-0001)
        const customer_id = await autoCodeService.generateNextCode(
          'customers',
          req.user.companyId,
          {
            fallbackPrefix: 'CUST',
            fallbackFormat: '{PREFIX}-{YEAR}{MONTH}{DAY}-{NUMBER}'
          }
        );

        // Get customer group to set default receivable account
        const customerGroup = await CustomerGroup.findOne({
          where: buildCompanyWhere(req, { id: rowData.customer_group_id })
        });
        
        // Create customer
        const customer = await Customer.create({
          companyId: req.user.companyId,
          customer_id,
          customer_group_id: rowData.customer_group_id,
          full_name: rowData['Full Name*'],
          address: rowData['Address'] && typeof rowData['Address'] === 'string' && rowData['Address'].trim() !== '' ? rowData['Address'] : null,
          default_receivable_account_id: customerGroup?.account_receivable_id || null,
          phone_number: rowData['Phone Number'] && typeof rowData['Phone Number'] === 'string' && rowData['Phone Number'].trim() !== '' ? rowData['Phone Number'] : null,
          email: rowData['Email'] && typeof rowData['Email'] === 'string' && rowData['Email'].trim() !== '' ? rowData['Email'] : null,
          website: rowData['Website'] && typeof rowData['Website'] === 'string' && rowData['Website'].trim() !== '' ? rowData['Website'] : null,
          fax: rowData['Fax'] && typeof rowData['Fax'] === 'string' && rowData['Fax'].trim() !== '' ? rowData['Fax'] : null,
          birthday: rowData['Birthday'] && typeof rowData['Birthday'] === 'string' && rowData['Birthday'].trim() !== '' ? rowData['Birthday'] : null,
          loyalty_card_config_id: rowData.loyalty_card_config_id || null,
          loyalty_card_number: rowData['Loyalty Card Number'] && typeof rowData['Loyalty Card Number'] === 'string' && rowData['Loyalty Card Number'].trim() !== '' ? rowData['Loyalty Card Number'] : null,
          is_active: rowData['Status*'].toLowerCase() === 'active',
          created_by: req.user.id
        });

        imported++;
      } catch (error) {
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
      error: 'Failed to import customers',
      details: error.message 
    });
  }
});

module.exports = router;
