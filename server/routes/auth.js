const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Company } = require('../models');
const { Op, Sequelize } = require('sequelize');
const sequelize = require('../../config/database');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../../env');
const { authRateLimiter, registrationRateLimiter } = require('../middleware/enhancedRateLimiter');
const { validatePassword, getPasswordStrength } = require('../utils/passwordValidator');
const JWTService = require('../utils/jwtService');
const CookieService = require('../utils/cookieService');
const { refreshCSRFToken } = require('../middleware/csrfProtection');
const { csrfProtection } = require('../middleware/csrfProtection');

const { getUploadDir } = require('../utils/uploadsPath');

// Configure multer for profile picture uploads - save to UPLOAD_PATH (e.g. Railway Volume)
const profilePictureStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = getUploadDir('profilePictures');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: profilePictureStorage,
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

// POST /api/auth/register - Register new user account (Step 1)
// Company registration is separate (Step 2)
router.post('/register', authRateLimiter, async (req, res) => {
    try {
        const { 
            firstName, 
            lastName, 
            username, 
            email, 
            password
        } = req.body;

        // Validate required user fields
        if (!firstName || !lastName || !username || !email || !password) {
            return res.status(400).json({
                message: 'All user fields are required'
            });
        }

        // Sanitize inputs
        const sanitizedData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            username: username.trim().toLowerCase(),
            email: email.trim().toLowerCase(),
            password: password
        };

        // Enhanced password validation
        const passwordValidation = validatePassword(sanitizedData.password);
        if (!passwordValidation.isValid) {
            return res.status(400).json({
                message: 'Password does not meet security requirements',
                errors: passwordValidation.errors
            });
        }

        // Check password strength
        const strength = getPasswordStrength(sanitizedData.password);
        if (strength.strength === 'weak') {
            return res.status(400).json({
                message: 'Password is too weak',
                feedback: strength.feedback
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(sanitizedData.email)) {
            return res.status(400).json({
                message: 'Please provide a valid email address'
            });
        }

        // Validate username format (alphanumeric, 3-20 characters)
        const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!usernameRegex.test(sanitizedData.username)) {
            return res.status(400).json({
                message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores'
            });
        }

        // Validate name fields (no special characters, reasonable length)
        const nameRegex = /^[a-zA-Z\s]{2,50}$/;
        if (!nameRegex.test(sanitizedData.firstName) || !nameRegex.test(sanitizedData.lastName)) {
            return res.status(400).json({
                message: 'Names must be 2-50 characters long and contain only letters and spaces'
            });
        }

        // Check if user already exists (globally unique username/email)
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [{ username: sanitizedData.username }, { email: sanitizedData.email }]
            }
        });

        if (existingUser) {
            return res.status(400).json({
                message: existingUser.email === sanitizedData.email ? 
                    'User with this email already exists' : 
                    'Username already taken'
            });
        }

        // Create user WITHOUT company (companyId will be null initially)
        // User will register company in step 2
        // Auto-approve users on registration (they are self-registering)
        const user = await User.create({
            username: sanitizedData.username,
            email: sanitizedData.email,
            first_name: sanitizedData.firstName,
            last_name: sanitizedData.lastName,
            password: sanitizedData.password,
            role: 'cashier', // Will be upgraded to admin after company registration
            companyId: null, // Will be set when company is registered
            is_active: true,
            approval_status: 'approved', // Auto-approve self-registering users
            isSystemAdmin: false
        });

        // Generate token pair (without companyId since company not registered yet)
        const payload = {
            userId: user.id,
            username: user.username,
            role: user.role,
            companyId: null, // No company yet
            isSystemAdmin: user.isSystemAdmin
        };
        
        const { accessToken, refreshToken } = JWTService.generateTokenPair(payload);

        // Set secure cookies
        const csrfToken = CookieService.setAuthCookies(res, accessToken, refreshToken, false);

        // Return user data - frontend will redirect to company registration
        res.status(201).json({
            message: 'Account created successfully. Please register your company to continue.',
            user: {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                username: user.username,
                email: user.email,
                role: user.role,
                companyId: null // No company yet
            },
            requiresCompanyRegistration: true,
            csrfToken // Send CSRF token to frontend
        });
    } catch (error) {
        // Don't expose internal errors to client
        res.status(500).json({ 
            message: 'Error registering user. Please try again later.' 
        });
    }
});

// POST /api/auth/register-company - Register company for authenticated user (Step 2)
router.post('/register-company', authRateLimiter, auth, async (req, res) => {
    const transaction = await User.sequelize.transaction();
    
    try {
        const { 
            companyName,
            companyAddress,
            companyPhone,
            companyEmail,
            companyWebsite,
            companyTin,
            companyVrn,
            companyBusinessRegistrationNumber,
            companyBusinessType,
            companyIndustry,
            companyCountry,
            companyRegion,
            companyTimezone
        } = req.body;

        // Validate required company fields
        if (!companyName || !companyAddress || !companyPhone || !companyEmail) {
            await transaction.rollback();
            return res.status(400).json({
                message: 'Company name, address, phone, and email are required'
            });
        }

        // Check if user already has a company
        const user = await User.findByPk(req.user.id, { transaction });
        if (!user) {
            await transaction.rollback();
            return res.status(404).json({
                message: 'User not found'
            });
        }

        if (user.companyId) {
            await transaction.rollback();
            return res.status(400).json({
                message: 'User already has a company registered'
            });
        }

        // Create company
        const company = await Company.create({
            name: companyName.trim(),
            address: companyAddress.trim(),
            phone: companyPhone.trim(),
            email: companyEmail.trim().toLowerCase(),
            website: companyWebsite ? companyWebsite.trim() : null,
            tin: companyTin ? companyTin.trim() : null,
            vrn: companyVrn ? companyVrn.trim() : null,
            businessRegistrationNumber: companyBusinessRegistrationNumber ? companyBusinessRegistrationNumber.trim() : null,
            businessType: companyBusinessType ? companyBusinessType.trim() : null,
            industry: companyIndustry ? companyIndustry.trim() : null,
            country: companyCountry ? companyCountry.trim() : 'Tanzania',
            region: companyRegion ? companyRegion.trim() : null,
            timezone: companyTimezone ? companyTimezone.trim() : 'Africa/Dar_es_Salaam',
            subscriptionStatus: 'trial',
            trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            isActive: true
        }, { transaction });

        // Update user with companyId and upgrade to admin
        // Note: approval_status is already 'approved' from user registration
        await user.update({
            companyId: company.id,
            role: 'admin' // Company creator gets admin role
            // approval_status remains 'approved' (already set during user registration) - no need to update
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Generate new token pair with companyId
        const updatedUser = await User.findByPk(user.id);
        const payload = {
            userId: updatedUser.id,
            username: updatedUser.username,
            role: updatedUser.role,
            companyId: updatedUser.companyId,
            isSystemAdmin: updatedUser.isSystemAdmin
        };
        
        const { accessToken, refreshToken } = JWTService.generateTokenPair(payload);

        // Set secure cookies with updated token
        const csrfToken = CookieService.setAuthCookies(res, accessToken, refreshToken, false);

        // Auto-initialize account_types and accounts (mandatory)
        let autoInitResult = null;
        try {
            const CompanyInitializationService = require('../services/companyInitializationService');
            const models = require('../models');
            const initService = new CompanyInitializationService(User.sequelize, models);
            
            // Initialize only account_types and accounts
            autoInitResult = await initService.initializeCompany(
                company.id,
                updatedUser.id,
                null, // No progress callback needed for auto-init
                ['account_types', 'accounts'] // Only these two tables
            );
            
        } catch (initError) {
            // Don't fail company registration if auto-init fails - user can initialize manually
            autoInitResult = { success: false, error: initError.message };
        }

        // Return success - remaining initialization will be handled manually via frontend
        res.status(201).json({
            message: 'Company registered successfully',
            user: {
                id: updatedUser.id,
                first_name: updatedUser.first_name,
                last_name: updatedUser.last_name,
                username: updatedUser.username,
                email: updatedUser.email,
                role: updatedUser.role,
                companyId: updatedUser.companyId
            },
            company: {
                id: company.id,
                name: company.name
            },
            csrfToken,
            requiresInitialization: true,
            autoInitialized: {
                account_types: autoInitResult?.success ? true : false,
                accounts: autoInitResult?.success ? true : false,
                result: autoInitResult
            }
        });
    } catch (error) {
        // Rollback transaction on error
        await transaction.rollback();
        
        // Return more helpful error message
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                message: 'Validation error',
                errors: error.errors.map(e => e.message)
            });
        }
        
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ 
                message: 'Company with this name or email already exists'
            });
        }
        
        res.status(500).json({ 
            message: 'Error registering company. Please try again later.',
            error: config.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// POST /api/auth/login - Login user
router.post('/login', authRateLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Validate that username is not undefined or empty
        if (!username || username === undefined || username === '') {
            return res.status(400).json({ 
                message: 'Username is required',
                debug: { receivedUsername: username, usernameType: typeof username }
            });
        }

        // Validate that password is not undefined or empty
        if (!password || password === undefined || password === '') {
            return res.status(400).json({ 
                message: 'Password is required',
                debug: { receivedPassword: password ? '[REDACTED]' : 'undefined', passwordType: typeof password }
            });
        }

        // Normalize username (trim and lowercase for consistent lookup)
        const normalizedUsername = username.trim().toLowerCase();

        // Find user by username (case-insensitive)
        const user = await User.findOne({ 
            where: { 
                username: sequelize.where(
                    sequelize.fn('LOWER', sequelize.col('username')),
                    normalizedUsername
                )
            } 
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid username or password. Please try again.' });
        }

        // Check if user is active
        if (!user.is_active) {
            return res.status(400).json({ message: 'Account is deactivated' });
        }

        // Check if user is approved
        if (user.approval_status !== 'approved') {
            return res.status(400).json({ message: 'Account is not approved' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid username or password. Please try again.' });
        }

        await user.update({ last_login: new Date() });
        
        // Get user's assigned stores (if association exists)
        let assignedStores = [];
        try {
            const Store = require('../models/store');
            const userWithStores = await User.findByPk(user.id, {
                include: [
                    {
                        model: Store,
                        as: 'assignedStores',
                        through: { attributes: ['role', 'is_active', 'assigned_at'], where: { is_active: true } },
                        attributes: ['id', 'name', 'store_type', 'location', 'is_active'],
                        required: false
                    }
                ]
            });
            assignedStores = userWithStores?.assignedStores || [];
        } catch (storeError) {
            // If association doesn't exist or fails, just use empty array
            assignedStores = [];
        }

        // Create JWT token pair using centralized configuration
        const payload = {
            userId: user.id,
            username: user.username,
            role: user.role,
            companyId: user.companyId,
            isSystemAdmin: user.isSystemAdmin
        };

        const { accessToken, refreshToken } = JWTService.generateTokenPair(payload);

        // Set secure cookies
        const csrfToken = CookieService.setAuthCookies(res, accessToken, refreshToken, req.body.remember || false);

        // Return user data with companyId
        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                companyId: user.companyId, // Include companyId so frontend can check if company registration is needed
                isSystemAdmin: user.isSystemAdmin
            },
            stores: assignedStores,
            csrfToken // Send CSRF token to frontend
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            message: 'Server error',
            error: config.NODE_ENV === 'development' ? error.message : undefined,
            stack: config.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = CookieService.getRefreshToken(req);
        
        if (!refreshToken) {
            return res.status(401).json({ message: 'No refresh token provided' });
        }

        // Verify refresh token
        const decoded = JWTService.verifyRefreshToken(refreshToken);
        
        // Get user from database
        const user = await User.findByPk(decoded.userId);
        if (!user || !user.is_active || user.approval_status !== 'approved') {
            return res.status(401).json({ message: 'User not found or inactive' });
        }

        // Generate new token pair
        const payload = {
            userId: user.id,
            username: user.username,
            role: user.role,
            companyId: user.companyId,
            isSystemAdmin: user.isSystemAdmin
        };

        const { accessToken, refreshToken: newRefreshToken } = JWTService.generateTokenPair(payload);

        // Set new secure cookies
        const csrfToken = CookieService.setAuthCookies(res, accessToken, newRefreshToken, true);

        res.json({
            message: 'Token refreshed successfully',
            csrfToken
        });
    } catch (error) {
        res.status(401).json({ message: 'Invalid refresh token' });
    }
});

router.post('/logout', (req, res) => {
    try {
        // Clear all authentication cookies
        CookieService.clearAuthCookies(res);
        
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error during logout' });
    }
});

// GET /api/auth/verify - Verify token and get user info
router.get('/verify', auth, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            user: {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                username: user.username,
                role: user.role,
                is_active: user.is_active,
                phone: user.phone,
                address: user.address,
                profile_picture: user.profile_picture
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error verifying token' });
    }
});

// GET /api/auth/profile - Get user profile (protected)
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['password'] },
            include: [
                {
                    model: require('../models/store'),
                    as: 'assignedStores',
                    through: { attributes: ['role', 'is_active', 'assigned_at'], where: { is_active: true } },
                    attributes: ['id', 'name', 'store_type', 'location', 'is_active']
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// PUT /api/auth/profile - Update user profile (protected)
router.put('/profile', auth, csrfProtection, async (req, res) => {
    try {
        const { firstName, lastName, email, phone, address } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ 
                success: false,
                message: 'First name, last name, and email are required' 
            });
        }

        // Get current user first to check their company
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }

        // Check if email is already taken by another user (within same company for multi-tenant)
        // Only check if email is being changed
        if (email && email !== currentUser.email) {
            const emailWhere = {
                email,
                id: { [Op.ne]: req.user.id }
            };
            
            // For multi-tenant: check within company if user has a company
            if (currentUser.companyId) {
                emailWhere.companyId = currentUser.companyId;
            }
            
            const existingUser = await User.findOne({
                where: emailWhere
            });

            if (existingUser) {
                return res.status(400).json({ 
                    success: false,
                    message: currentUser.companyId 
                        ? 'Email is already taken by another user in your company' 
                        : 'Email is already taken'
                });
            }
        }

        // Update user profile (currentUser was already fetched above)
        await currentUser.update({
            first_name: firstName,
            last_name: lastName,
            email,
            phone: phone || null,
            address: address || null
        });

        // Reload user to get fresh data from database
        await currentUser.reload();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                id: currentUser.id,
                first_name: currentUser.first_name,
                last_name: currentUser.last_name,
                email: currentUser.email,
                username: currentUser.username,
                role: currentUser.role,
                phone: currentUser.phone,
                address: currentUser.address,
                profile_picture: currentUser.profile_picture,
                companyId: currentUser.companyId,
                isSystemAdmin: currentUser.isSystemAdmin
            }
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error updating profile',
            error: error.message 
        });
    }
});

// POST /api/auth/profile/picture - Upload profile picture (protected)
router.post('/profile/picture', auth, upload.single('profilePicture'), csrfProtection, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false,
                message: 'No file uploaded' 
            });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }

        // File is already saved to the correct location by multer.diskStorage
        // req.file.filename contains just the filename (not full path)
        const profilePictureUrl = `/uploads/profile-pictures/${req.file.filename}`;
        
        // Update user profile picture path
        await user.update({ profile_picture: profilePictureUrl });
        
        // Reload user to get fresh data from database
        await user.reload();

        res.json({
            success: true,
            message: 'Profile picture uploaded successfully',
            profilePicture: profilePictureUrl
        });
    } catch (error) {
        console.error('Error uploading profile picture:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error uploading profile picture',
            error: error.message 
        });
    }
});

router.post('/logout', auth, (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

// POST /api/auth/change-password - Change password (protected)
router.post('/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        await user.update({ password: newPassword });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error changing password' });
    }
});

// POST /api/auth/forgot-password - Forgot password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ message: 'User with this email not found' });
        }

        // For now, just return success (you can implement email sending later)
        res.json({ message: 'Password reset instructions sent to your email' });
    } catch (error) {
        res.status(500).json({ message: 'Error processing request' });
    }
});

// POST /api/auth/reset-password - Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { username, token, newPassword } = req.body;

        if (!username || !token || !newPassword) {
            return res.status(400).json({ message: 'Username, token, and new password are required' });
        }

        // Find user by username
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Set the new password as plain text and save (triggers hashing hook)
        user.password = newPassword;
        await user.save();

        res.json({ message: 'Password reset successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error resetting password' });
    }
});

// GET /api/auth/csrf-token - Get fresh CSRF token
router.get('/csrf-token', (req, res) => {
    try {
        const csrfToken = CookieService.generateCSRFToken();
        CookieService.registerIssuedCSRFToken(csrfToken); // for header-only validation when frontend is cross-origin (e.g. Railway)
        CookieService.setCookie(res, 'csrf_token', csrfToken, {
            httpOnly: false, // CSRF token needs to be accessible by JavaScript
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day
        });

        res.json({
            message: 'CSRF token generated successfully',
            csrfToken: csrfToken
        });
    } catch (error) {
        res.status(500).json({ message: 'Error generating CSRF token' });
    }
});

module.exports = router; 