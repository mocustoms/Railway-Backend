const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');

// Middleware to ensure only system admins can access
const requireSystemAdmin = (req, res, next) => {
    if (!req.user || !req.user.isSystemAdmin) {
        return res.status(403).json({
            error: 'Access denied',
            message: 'Only system administrators can access database configuration'
        });
    }
    next();
};

// Apply authentication and system admin check to all routes
router.use(auth);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks
router.use(requireSystemAdmin);
router.use(csrfProtection);

// GET /api/database-config - Get current database configuration
router.get('/', (req, res) => {
    try {
        const config = require('../../env');
        
        // Return configuration (mask password for security)
        res.json({
            success: true,
            config: {
                DB_HOST: config.DB_HOST,
                DB_PORT: config.DB_PORT,
                DB_NAME: config.DB_NAME,
                DB_USER: config.DB_USER,
                DB_PASSWORD: config.DB_PASSWORD ? '***masked***' : '',
                DB_DIALECT: config.DB_DIALECT || 'postgres',
                DB_LOGGING: config.DB_LOGGING === 'true' || config.DB_LOGGING === true
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to read database configuration',
            message: error.message
        });
    }
});

// POST /api/database-config/test - Test database connection with provided credentials
router.post('/test', async (req, res) => {
    try {
        const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = req.body;

        // Validate required fields
        if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER || !DB_PASSWORD) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD are required'
            });
        }

        // Create a test Sequelize instance
        const testSequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
            host: DB_HOST,
            port: parseInt(DB_PORT),
            dialect: 'postgres',
            logging: false,
            dialectOptions: {
                connectTimeout: 10000
            }
        });

        // Test the connection
        await testSequelize.authenticate();
        
        // Close the test connection
        await testSequelize.close();

        res.json({
            success: true,
            message: 'Database connection test successful'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database connection test failed',
            message: error.message,
            details: {
                name: error.name,
                code: error.original?.code || error.code
            }
        });
    }
});

// PUT /api/database-config - Update database configuration
router.put('/', async (req, res) => {
    try {
        const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_LOGGING } = req.body;

        // Validate required fields
        if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER || !DB_PASSWORD) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD are required'
            });
        }

        // First, test the connection with new credentials
        const testSequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
            host: DB_HOST,
            port: parseInt(DB_PORT),
            dialect: 'postgres',
            logging: false,
            dialectOptions: {
                connectTimeout: 10000
            }
        });

        try {
            await testSequelize.authenticate();
            await testSequelize.close();
        } catch (testError) {
            return res.status(400).json({
                success: false,
                error: 'Connection test failed',
                message: 'Cannot save configuration. Database connection test failed.',
                details: testError.message
            });
        }

        // Read current .env file
        const envPath = path.join(__dirname, '../../.env');
        let envContent = '';
        
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Update or add database configuration variables
        const updates = {
            'DB_HOST': DB_HOST,
            'DB_PORT': DB_PORT.toString(),
            'DB_NAME': DB_NAME,
            'DB_USER': DB_USER,
            'DB_PASSWORD': DB_PASSWORD,
            'DB_DIALECT': 'postgres',
            'DB_LOGGING': DB_LOGGING ? 'true' : 'false'
        };

        // Process each update
        Object.keys(updates).forEach(key => {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            const newLine = `${key}=${updates[key]}`;
            
            if (regex.test(envContent)) {
                // Update existing line
                envContent = envContent.replace(regex, newLine);
            } else {
                // Add new line
                envContent += (envContent.endsWith('\n') ? '' : '\n') + newLine + '\n';
            }
        });

        // Write updated .env file
        fs.writeFileSync(envPath, envContent, 'utf8');

        res.json({
            success: true,
            message: 'Database configuration updated successfully',
            warning: 'Server restart required for changes to take effect'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to update database configuration',
            message: error.message
        });
    }
});

module.exports = router;

