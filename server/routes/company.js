const express = require('express');
const router = express.Router();
const { Company, Currency, CostingMethod, sequelize } = require('../models');
const auth = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const stripCompanyId = require('../middleware/stripCompanyId');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../../env');
const CompanyInitializationService = require('../services/companyInitializationService');

// Apply authentication, company filtering, and strip companyId from user input
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for logo uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../uploads/company-logos');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'company-logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|svg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files (PNG, JPG, SVG) are allowed!'));
        }
    }
});

// GET company details
router.get('/', async (req, res) => {
    try {
        // For system admins, they might not have a companyId, so we need to handle that
        // For regular users, filter by their companyId
        let whereClause = {};
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.id = req.user.companyId;
        } else if (req.user.isSystemAdmin) {
            // Super-admin can see any company, but for now return null or first
            // In a real scenario, you might want to pass companyId as query param
            whereClause = {}; // No filter for super-admin
        }
        
        const company = await Company.findOne({
            where: whereClause,
            include: [
                {
                    model: Currency,
                    as: 'defaultCurrency',
                    attributes: ['id', 'code', 'name', 'symbol']
                },
                {
                    model: CostingMethod,
                    as: 'costingMethodDetails',
                    attributes: ['id', 'code', 'name', 'description']
                }
            ]
        });
        if (company) {
            res.json({ success: true, data: company });
        } else {
            res.json({ success: true, data: null });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Helper function to generate company code from name
async function generateCompanyCode(name) {
    if (!name || !name.trim()) {
        return 'EMZ'; // Default fallback
    }

    // Extract first 3 uppercase letters/numbers from company name
    let code = name.trim()
        .substring(0, 10)
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .substring(0, 3);

    // If we don't have enough letters, pad with numbers or use default
    if (!code || code.length === 0) {
        code = 'EMZ';
    } else if (code.length < 3) {
        // If we have less than 3 characters, pad with numbers
        code = code.padEnd(3, '0');
    }

    // Ensure code is max 10 characters
    code = code.substring(0, 10);

    // Check if code already exists, if so add a number suffix
    let finalCode = code;
    let counter = 1;
    const { Op } = require('sequelize');
    
    while (counter < 1000) { // Prevent infinite loop
        const existing = await Company.findOne({
            where: { code: finalCode }
        });
        
        if (!existing) {
            break;
        }
        
        // Add number suffix (max 10 chars total)
        const suffix = counter.toString();
        const baseCode = code.substring(0, 10 - suffix.length);
        finalCode = baseCode + suffix;
        counter++;
    }

    return finalCode;
}

// Create or Update company details
router.post('/', upload.single('logoFile'), csrfProtection, async (req, res) => {
    try {
        const {
            name, code, address, phone, fax, email, website, logo,
            country, region, description, businessType, industry,
            businessRegistrationNumber, timezone, tin, vrn,
            defaultCurrencyId, costingMethod, efdSettings
        } = req.body;

        // Validate required fields (code is now auto-generated)
        if (!name || !address || !phone || !email) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: name, address, phone, and email are required'
            });
        }

        // Generate company code if not provided or empty
        let companyCode = code;
        if (!companyCode || !companyCode.trim()) {
            companyCode = await generateCompanyCode(name);
        }

        // Validate company code length
        if (companyCode && companyCode.length > 10) {
            return res.status(400).json({
                success: false,
                message: 'Company code must be 10 characters or less'
            });
        }

        // Handle logo upload
        let logoPath = logo;
        if (req.file) {
            logoPath = `/uploads/company-logos/${req.file.filename}`;
        }

        // For updates, ensure user can only update their own company
        let whereClause = {};
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.id = req.user.companyId;
        }
        
        let company = await Company.findOne({ where: whereClause });
        if (company) {
            // Update existing company (preserve existing code, only update if explicitly provided)
            const updateData = {
                name, address, phone, fax, email, website, logo: logoPath,
                country, region, description, businessType, industry,
                businessRegistrationNumber, timezone, tin, vrn,
                defaultCurrencyId, costingMethod, efdSettings
            };
            
            // Only update code if explicitly provided in request
            if (code && code.trim()) {
                updateData.code = code.trim();
            }
            
            await company.update(updateData);
            res.json({ success: true, message: 'Company details updated successfully.', data: company });
        } else {
            // Create new company (with auto-generated code)
            company = await Company.create({
                name, code: companyCode, address, phone, fax, email, website, logo: logoPath,
                country, region, description, businessType, industry,
                businessRegistrationNumber, timezone, tin, vrn,
                defaultCurrencyId, costingMethod, efdSettings
            });
            res.status(201).json({ success: true, message: 'Company details saved successfully.', data: company });
        }
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                success: false, 
                message: 'Validation error', 
                errors: error.errors.map(e => e.message) 
            });
        }
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/upload-logo', upload.single('logoFile'), csrfProtection, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No logo file provided'
            });
        }

        const logoPath = `/uploads/company-logos/${req.file.filename}`;
        
        res.json({
            success: true,
            message: 'Logo uploaded successfully',
            data: {
                logoUrl: logoPath,
                filename: req.file.filename
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/logo', csrfProtection, async (req, res) => {
    try {
        let whereClause = {};
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.id = req.user.companyId;
        }
        
        const company = await Company.findOne({ where: whereClause });
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        await company.update({ logo: null });
        
        res.json({
            success: true,
            message: 'Logo deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/company/initialize - Initialize company with default data
router.post('/initialize', csrfProtection, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const userId = req.user.id;
        const { tables } = req.body; // Optional array of table names to initialize

        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: 'User must have a company to initialize'
            });
        }

        // Verify company exists
        const company = await Company.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize the service
        const models = require('../models');
        const initService = new CompanyInitializationService(sequelize, models);

        // Progress tracking
        const progressUpdates = [];
        let currentProgress = {
            stage: 'starting',
            message: 'Starting initialization...',
            progress: 0,
            total: 0,
            table: null
        };

        // Progress callback
        const progressCallback = (update) => {
            currentProgress = { ...update };
            progressUpdates.push({ ...update, timestamp: new Date().toISOString() });
        };

        // Run initialization with optional table filter
        const result = await initService.initializeCompany(companyId, userId, progressCallback, tables);

        res.json({
            success: result.success,
            message: result.message || 'Company initialized successfully',
            total: result.total,
            successful: result.successful,
            failed: result.failed,
            details: result.details,
            errors: result.errors.length > 0 ? result.errors.slice(0, 10) : [] // Limit errors returned
        });
    } catch (error) {
        console.error('❌ Company initialization error:', error);
        res.status(500).json({
            success: false,
            message: 'Error initializing company',
            error: config.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router; 