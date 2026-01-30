const express = require('express');
const { Op } = require('sequelize');
const User = require('../models/user');
const Store = require('../models/store');
const UserStore = require('../models/userStore');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { validatePassword, getPasswordStrength } = require('../utils/passwordValidator');
const router = express.Router();

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all users with pagination, search, and sorting
router.get('/', async (req, res) => {
    try {

        const {
            page = 1,
            pageSize = 10,
            search = '',
            sortField = 'first_name',
            sortDirection = 'asc',
            approval_status = '' // Add approval status filter
        } = req.query;

        const offset = (page - 1) * pageSize;
        const limit = parseInt(pageSize);

        // Build where clause for search
        let whereClause = {};
        if (search) {
            whereClause = {
                [Op.or]: [
                    { first_name: { [Op.iLike]: `%${search}%` } },
                    { last_name: { [Op.iLike]: `%${search}%` } },
                    { username: { [Op.iLike]: `%${search}%` } },
                    { email: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }

        // Add approval status filter
        if (approval_status) {
            whereClause.approval_status = approval_status;
        }

        // Build final where clause with company filter
        const finalWhereClause = buildCompanyWhere(req, whereClause);
        
        // CRITICAL: Ensure companyId is always in the where clause
        if (!req.user.isSystemAdmin && req.user.companyId) {
            finalWhereClause.companyId = req.user.companyId;
        }

        // Build order clause
        let orderClause = [];
        if (sortField === 'name') {
            orderClause = [
                ['first_name', sortDirection],
                ['last_name', sortDirection]
            ];
        } else if (sortField === 'approval') {
            orderClause = [['approval_status', sortDirection]];
        } else {
            orderClause = [[sortField, sortDirection]];
        }

        // Get users with pagination and include store assignments
        const { count, rows: users } = await User.findAndCountAll({
            where: finalWhereClause,
            order: orderClause,
            limit: limit,
            offset: offset,
            attributes: { exclude: ['password'] }, // Don't send passwords
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    through: { 
                        attributes: ['role', 'is_active', 'assigned_at'],
                        where: { is_active: true }
                    },
                    where: (() => {
                        const storeWhere = buildCompanyWhere(req);
                        return Object.keys(storeWhere).length > 0 ? storeWhere : undefined;
                    })(),
                    required: false,
                    attributes: ['id', 'name', 'store_type', 'location']
                }
            ]
        });

        res.json({
            users,
            total: count,
            page: parseInt(page),
            pageSize: limit,
            totalPages: Math.ceil(count / limit)
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
});

// Get a single user by ID with store assignments
router.get('/:id', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const storeWhere = buildCompanyWhere(req);
        
        const user = await User.findOne({
            where: whereClause,
            attributes: { exclude: ['password'] },
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    through: { 
                        attributes: ['role', 'is_active', 'assigned_at', 'assigned_by']
                    },
                    where: Object.keys(storeWhere).length > 0 ? storeWhere : undefined,
                    required: false,
                    attributes: ['id', 'name', 'store_type', 'location', 'phone', 'email']
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user', details: error.message });
    }
});

// Create a new user
router.post('/', csrfProtection, async (req, res) => {
    try {
        const {
            first_name,
            last_name,
            username,
            email,
            password,
            role = 'cashier',
            is_active = true,
            approval_status = 'pending', // Default to pending for new users
            store_assignments = [] // Array of { store_id, role } objects
        } = req.body;

        // Validate required fields
        if (!first_name || !last_name || !username || !email || !password) {
            const missingFields = [];
            if (!first_name) missingFields.push('first_name');
            if (!last_name) missingFields.push('last_name');
            if (!username) missingFields.push('username');
            if (!email) missingFields.push('email');
            if (!password) missingFields.push('password');
            
            return res.status(400).json({ 
                error: 'All required fields must be provided',
                missingFields 
            });
        }

        // Sanitize and normalize inputs
        const sanitizedFirstName = first_name.trim();
        const sanitizedLastName = last_name.trim();
        const normalizedUsername = username.trim().toLowerCase();
        const normalizedEmail = email.trim().toLowerCase();

        // Validate first name format (letters and spaces, 2-50 characters)
        const nameRegex = /^[a-zA-Z\s]{2,50}$/;
        if (!nameRegex.test(sanitizedFirstName)) {
            return res.status(400).json({ 
                error: 'First name must be 2-50 characters long and contain only letters and spaces' 
            });
        }

        // Validate last name format (letters and spaces, 2-50 characters)
        if (!nameRegex.test(sanitizedLastName)) {
            return res.status(400).json({ 
                error: 'Last name must be 2-50 characters long and contain only letters and spaces' 
            });
        }

        // Validate username format (alphanumeric, underscore, 3-20 characters)
        const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!usernameRegex.test(normalizedUsername)) {
            return res.status(400).json({ 
                error: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ 
                error: 'Please provide a valid email address' 
            });
        }

        // Validate password strength
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            return res.status(400).json({
                error: 'Password does not meet security requirements',
                errors: passwordValidation.errors
            });
        }

        // Check password strength
        const strength = getPasswordStrength(password);
        if (strength.strength === 'weak') {
            return res.status(400).json({
                error: 'Password is too weak',
                feedback: strength.feedback
            });
        }

        // Check if username already exists (within same company)
        const existingUsername = await User.findOne({ 
            where: buildCompanyWhere(req, { username: normalizedUsername })
        });
        if (existingUsername) {
            return res.status(400).json({ error: 'Username already exists in your company' });
        }

        // Check if email already exists (within same company)
        const existingEmail = await User.findOne({ 
            where: buildCompanyWhere(req, { email: normalizedEmail })
        });
        if (existingEmail) {
            return res.status(400).json({ error: 'Email already exists in your company' });
        }

        // Validate role
        const validRoles = ['admin', 'manager', 'cashier'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                error: 'Invalid role',
                validRoles 
            });
        }

        // Validate approval_status if provided
        const validApprovalStatuses = ['pending', 'approved', 'rejected'];
        if (approval_status && !validApprovalStatuses.includes(approval_status)) {
            return res.status(400).json({ 
                error: 'Invalid approval status',
                validStatuses: validApprovalStatuses 
            });
        }

        // Create user with companyId (use sanitized/normalized values)
        const user = await User.create({
            first_name: sanitizedFirstName,
            last_name: sanitizedLastName,
            username: normalizedUsername,
            email: normalizedEmail,
            password,
            role,
            is_active,
            approval_status,
            companyId: req.user.companyId // Set companyId from authenticated user
        });

        // Assign stores if provided
        if (store_assignments && store_assignments.length > 0) {
            const userStoreAssignments = store_assignments.map(assignment => ({
                user_id: user.id,
                store_id: assignment.store_id,
                role: assignment.role || 'cashier',
                assigned_by: req.user.id,
                companyId: req.user.companyId // Required field for UserStore model
            }));

            await UserStore.bulkCreate(userStoreAssignments);
        }

        // Return user without password and with store assignments
        const userResponse = await User.findByPk(user.id, {
            attributes: { exclude: ['password'] },
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    through: { 
                        attributes: ['role', 'is_active', 'assigned_at']
                    },
                    attributes: ['id', 'name', 'store_type', 'location']
                }
            ]
        });

        res.status(201).json(userResponse);

    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update a user
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const {
            first_name,
            last_name,
            username,
            email,
            password,
            role,
            is_active,
            approval_status,
            store_assignments = [] // Array of { store_id, role } objects
        } = req.body;

        // Check if user is updating themselves
        const isSelfUpdate = req.params.id === req.user.id;

        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // For self-updates, restrict what fields can be changed
        if (isSelfUpdate) {
            // Users cannot change their own role, is_active, or approval_status
            if (role && role !== user.role) {
                return res.status(403).json({ error: 'You cannot change your own role' });
            }
            if (typeof is_active === 'boolean' && is_active !== user.is_active) {
                return res.status(403).json({ error: 'You cannot change your own active status' });
            }
            if (approval_status && approval_status !== user.approval_status) {
                return res.status(403).json({ error: 'You cannot change your own approval status' });
            }
            // Users cannot assign stores to themselves - only admins can do that
            if (store_assignments && store_assignments.length > 0) {
                return res.status(403).json({ error: 'You cannot assign stores to yourself. Please contact an administrator.' });
            }
        }

        // Ensure companyId is available for store assignments
        if (!req.user.isSystemAdmin && !req.user.companyId) {
            return res.status(403).json({ 
                error: 'Company access required. Please contact your administrator.' 
            });
        }

        // Validate and sanitize fields if provided
        if (first_name) {
            const sanitizedFirstName = first_name.trim();
            const nameRegex = /^[a-zA-Z\s]{2,50}$/;
            if (!nameRegex.test(sanitizedFirstName)) {
                return res.status(400).json({ 
                    error: 'First name must be 2-50 characters long and contain only letters and spaces' 
                });
            }
        }

        if (last_name) {
            const sanitizedLastName = last_name.trim();
            const nameRegex = /^[a-zA-Z\s]{2,50}$/;
            if (!nameRegex.test(sanitizedLastName)) {
                return res.status(400).json({ 
                    error: 'Last name must be 2-50 characters long and contain only letters and spaces' 
                });
            }
        }

        // Check if username already exists (excluding current user, within same company)
        // Always check within company, even for super-admins
        if (username && username !== user.username) {
            // Validate username format (alphanumeric, underscore, 3-20 characters)
            const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
            const normalizedUsername = username.trim().toLowerCase();
            if (!usernameRegex.test(normalizedUsername)) {
                return res.status(400).json({ 
                    error: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
                });
            }

            if (!req.user.companyId) {
                return res.status(400).json({ error: 'Company ID is required to update a user' });
            }

            // Use the user.id from the database query to ensure correct comparison
            const currentUserId = user.id;

            const existingUsername = await User.findOne({ 
                where: {
                    username: normalizedUsername,
                    companyId: req.user.companyId,
                    id: { [Op.ne]: currentUserId }
                }
            });
            if (existingUsername) {
                return res.status(400).json({ error: 'Username already exists in your company' });
            }
        }

        // Check if email already exists (excluding current user, within same company)
        // Always check within company, even for super-admins
        if (email && email !== user.email) {
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const normalizedEmail = email.trim().toLowerCase();
            if (!emailRegex.test(normalizedEmail)) {
                return res.status(400).json({ 
                    error: 'Please provide a valid email address' 
                });
            }

            if (!req.user.companyId) {
                return res.status(400).json({ error: 'Company ID is required to update a user' });
            }

            // Use the user.id from the database query to ensure correct comparison
            const currentUserId = user.id;

            const existingEmail = await User.findOne({ 
                where: {
                    email: normalizedEmail,
                    companyId: req.user.companyId,
                    id: { [Op.ne]: currentUserId }
                }
            });
            if (existingEmail) {
                return res.status(400).json({ error: 'Email already exists in your company' });
            }
        }

        // Validate password if provided
        if (password) {
            const passwordValidation = validatePassword(password);
            if (!passwordValidation.isValid) {
                return res.status(400).json({
                    error: 'Password does not meet security requirements',
                    errors: passwordValidation.errors
                });
            }

            const strength = getPasswordStrength(password);
            if (strength.strength === 'weak') {
                return res.status(400).json({
                    error: 'Password is too weak',
                    feedback: strength.feedback
                });
            }
        }

        // Validate role if provided
        if (role) {
            const validRoles = ['admin', 'manager', 'cashier'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ error: 'Invalid role' });
            }
        }

        // Update user (use sanitized/normalized values)
        const updateData = {};
        if (first_name) {
            updateData.first_name = first_name.trim();
        }
        if (last_name) {
            updateData.last_name = last_name.trim();
        }
        if (username && username !== user.username) {
            // Use normalized username if validation passed above
            const normalizedUsernameForUpdate = username.trim().toLowerCase();
            updateData.username = normalizedUsernameForUpdate;
        }
        if (email && email !== user.email) {
            updateData.email = email.trim().toLowerCase();
        }
        if (password) updateData.password = password;
        if (role) updateData.role = role;
        if (typeof is_active === 'boolean') updateData.is_active = is_active;
        if (approval_status) updateData.approval_status = approval_status;

        await user.update(updateData);

        // Update store assignments if provided (only for admin updates, not self-updates)
        if (store_assignments && Array.isArray(store_assignments) && !isSelfUpdate) {
            // Validate that all assigned stores belong to the user's company
            if (store_assignments.length > 0 && !req.user.isSystemAdmin) {
                try {
                    const storeIds = store_assignments
                        .map(a => a.store_id)
                        .filter(id => id != null); // Filter out null/undefined IDs
                    
                    if (storeIds.length === 0) {
                        // No valid store IDs, skip validation
                    } else {
                        const storeWhere = buildCompanyWhere(req, { id: { [Op.in]: storeIds } });
                        if (!req.user.isSystemAdmin && req.user.companyId) {
                            storeWhere.companyId = req.user.companyId;
                        }
                        
                        const validStores = await Store.findAll({
                            where: storeWhere,
                            attributes: ['id']
                        });
                        
                        const validStoreIds = validStores.map(s => s.id);
                        const invalidStoreIds = storeIds.filter(id => !validStoreIds.includes(id));
                        
                        if (invalidStoreIds.length > 0) {
                            return res.status(403).json({ 
                                error: `Cannot assign stores from other companies. Invalid store IDs: ${invalidStoreIds.join(', ')}` 
                            });
                        }
                    }
                } catch (validationError) {
                    return res.status(500).json({ 
                        error: 'Failed to validate store assignments', 
                        details: validationError.message 
                    });
                }
            }
            
            // Remove existing assignments
            try {
                await UserStore.destroy({ where: { user_id: user.id } });
            } catch (destroyError) {
                return res.status(500).json({ 
                    error: 'Failed to remove existing store assignments', 
                    details: destroyError.message 
                });
            }
            
            // Add new assignments
            if (store_assignments.length > 0) {
                let userStoreAssignments = []; // Declare outside try block for error handling
                try {
                    // Validate role values before creating assignments
                    const validRoles = ['manager', 'cashier', 'viewer'];
                    const invalidAssignments = store_assignments.filter(a => 
                        a.role && !validRoles.includes(a.role)
                    );
                    
                    if (invalidAssignments.length > 0) {
                        return res.status(400).json({ 
                            error: 'Invalid role in store assignments', 
                            details: `Invalid roles found: ${invalidAssignments.map(a => a.role).join(', ')}. Valid roles are: ${validRoles.join(', ')}` 
                        });
                    }
                    
                    userStoreAssignments = store_assignments
                        .filter(a => a.store_id != null) // Filter out invalid assignments
                        .map(assignment => ({
                            user_id: user.id,
                            store_id: assignment.store_id,
                            role: assignment.role || 'cashier',
                            assigned_by: req.user.id,
                            is_active: assignment.is_active !== undefined ? assignment.is_active : true,
                            assigned_at: new Date(),
                            companyId: req.user.companyId // Required field for UserStore model
                        }));

                    if (userStoreAssignments.length > 0) {
                        await UserStore.bulkCreate(userStoreAssignments, {
                            validate: true,
                            individualHooks: true
                        });
                    }
                } catch (bulkCreateError) {
                    // Provide more detailed error information
                    let errorMessage = 'Failed to create store assignments';
                    let errorDetails = bulkCreateError.message;
                    
                    if (bulkCreateError.name === 'SequelizeValidationError') {
                        errorMessage = 'Validation error';
                        errorDetails = bulkCreateError.errors.map(err => ({
                            field: err.path,
                            message: err.message,
                            value: err.value
                        }));
                    } else if (bulkCreateError.name === 'SequelizeUniqueConstraintError') {
                        errorMessage = 'Duplicate store assignment';
                        errorDetails = 'This user is already assigned to one or more of these stores';
                    } else if (bulkCreateError.name === 'SequelizeForeignKeyConstraintError') {
                        errorMessage = 'Invalid reference';
                        errorDetails = 'One or more store IDs or user IDs are invalid';
                    }
                    
                    console.error('Store assignment creation error:', {
                        error: bulkCreateError.name,
                        message: bulkCreateError.message,
                        details: errorDetails,
                        assignments: userStoreAssignments.length > 0 ? userStoreAssignments : 'Not created due to earlier validation error'
                    });
                    
                    return res.status(500).json({ 
                        error: errorMessage, 
                        details: errorDetails 
                    });
                }
            }
        }

        // Return updated user without password and with store assignments
        try {
            const storeWhere = buildCompanyWhere(req);
            const userResponse = await User.findByPk(user.id, {
                attributes: { exclude: ['password'] },
                include: [
                    {
                        model: Store,
                        as: 'assignedStores',
                        through: { 
                            attributes: ['role', 'is_active', 'assigned_at']
                        },
                        where: Object.keys(storeWhere).length > 0 ? storeWhere : undefined,
                        required: false,
                        attributes: ['id', 'name', 'store_type', 'location']
                    }
                ]
            });

            if (!userResponse) {
                return res.status(404).json({ error: 'User not found after update' });
            }

            res.json(userResponse);
        } catch (fetchError) {
            // User was updated successfully, but failed to fetch updated data
            // Return success with basic user data
            const basicUser = await User.findByPk(user.id, {
                attributes: { exclude: ['password'] }
            });
            return res.json(basicUser || user);
        }

    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ 
                error: error.errors[0].message,
                details: error.errors 
            });
        }
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ 
                error: 'Invalid reference in user data',
                details: error.message 
            });
        }
        res.status(500).json({ 
            error: 'Failed to update user', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Delete a user
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent deleting the last admin user (within same company)
        if (user.role === 'admin') {
            const adminWhere = buildCompanyWhere(req, { role: 'admin' });
            if (!req.user.isSystemAdmin && req.user.companyId) {
                adminWhere.companyId = req.user.companyId;
            }
            const adminCount = await User.count({ where: adminWhere });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin user' });
            }
        }

        // Delete user (this will cascade delete user-store assignments)
        await user.destroy();
        res.json({ message: 'User deleted successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Get user's store assignments
router.get('/:id/stores', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const storeWhere = buildCompanyWhere(req);

        const user = await User.findOne({
            where: whereClause,
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    through: { 
                        attributes: ['role', 'is_active', 'assigned_at', 'assigned_by']
                    },
                    where: Object.keys(storeWhere).length > 0 ? storeWhere : undefined,
                    required: false,
                    attributes: ['id', 'name', 'store_type', 'location', 'phone', 'email']
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user.assignedStores || []);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user stores', details: error.message });
    }
});

// Get user's POS stores (assigned, can_sale_products=true, is_active=true)
router.get('/:id/stores/pos', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const storeWhere = buildCompanyWhere(req, {
            can_sale_products: true,
            is_active: true
        });

        const user = await User.findOne({
            where: whereClause,
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    through: { 
                        attributes: ['role', 'is_active', 'assigned_at', 'assigned_by'],
                        where: { is_active: true } // Only active assignments
                    },
                    where: storeWhere,
                    required: false,
                    attributes: ['id', 'name', 'store_type', 'location', 'phone', 'email', 'can_sale_products', 'is_active', 'default_currency_id']
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Filter to only return stores that meet POS criteria
        const posStores = (user.assignedStores || []).filter(store => 
            store.can_sale_products === true && 
            store.is_active === true
        );

        res.json(posStores);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch POS stores', details: error.message });
    }
});

// Assign stores to user
router.post('/:id/stores', csrfProtection, async (req, res) => {
    try {
        const { store_assignments } = req.body; // Array of { store_id, role } objects

        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!store_assignments || !Array.isArray(store_assignments)) {
            return res.status(400).json({ error: 'Store assignments must be an array' });
        }

        // Validate store assignments (must be from same company)
        for (const assignment of store_assignments) {
            if (!assignment.store_id) {
                return res.status(400).json({ error: 'Store ID is required for each assignment' });
            }

            const storeWhere = buildCompanyWhere(req, { id: assignment.store_id });
            if (!req.user.isSystemAdmin && req.user.companyId) {
                storeWhere.companyId = req.user.companyId;
            }
            const store = await Store.findOne({ where: storeWhere });
            if (!store) {
                return res.status(400).json({ error: `Store with ID ${assignment.store_id} not found` });
            }

            if (assignment.role && !['manager', 'cashier', 'viewer'].includes(assignment.role)) {
                return res.status(400).json({ error: 'Invalid store role' });
            }
        }

        // Remove existing assignments
        await UserStore.destroy({ where: { user_id: user.id } });

        // Add new assignments
        const userStoreAssignments = store_assignments.map(assignment => ({
            user_id: user.id,
            store_id: assignment.store_id,
            role: assignment.role || 'cashier',
            assigned_by: req.user.id,
            companyId: req.user.companyId // Required field for UserStore model
        }));

        await UserStore.bulkCreate(userStoreAssignments);

        res.json({ message: 'Store assignments updated successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to assign stores to user' });
    }
});

// Remove store assignment from user
router.delete('/:id/stores/:storeId', csrfProtection, async (req, res) => {
    try {
        const { id: userId, storeId } = req.params;

        // First verify user belongs to company
        const userWhere = buildCompanyWhere(req, { id: userId });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            userWhere.companyId = req.user.companyId;
        }
        const user = await User.findOne({ where: userWhere });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify store belongs to company
        const storeWhere = buildCompanyWhere(req, { id: storeId });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            storeWhere.companyId = req.user.companyId;
        }
        const store = await Store.findOne({ where: storeWhere });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        const userStore = await UserStore.findOne({
            where: { user_id: userId, store_id: storeId }
        });

        if (!userStore) {
            return res.status(404).json({ error: 'Store assignment not found' });
        }

        await userStore.destroy();
        res.json({ message: 'Store assignment removed successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to remove store assignment' });
    }
});

// Get user statistics
router.get('/stats', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const totalUsers = await User.count({ where: baseWhere });
        const activeUsers = await User.count({ where: { ...baseWhere, is_active: true } });
        const pendingUsers = await User.count({ where: { ...baseWhere, approval_status: 'pending' } });
        const adminUsers = await User.count({ where: { ...baseWhere, role: 'admin' } });
        const managerUsers = await User.count({ where: { ...baseWhere, role: 'manager' } });
        const cashierUsers = await User.count({ where: { ...baseWhere, role: 'cashier' } });

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const recentLogins = await User.count({
            where: {
                ...baseWhere,
                last_login: {
                    [Op.gte]: weekAgo
                }
            }
        });

        // Users with store assignments
        let usersWithStores = 0;
        try {
            const storeWhere = buildCompanyWhere(req);
            const usersWithStoresCount = await User.findAll({
                where: baseWhere,
                include: [
                    {
                        model: Store,
                        as: 'assignedStores',
                        where: Object.keys(storeWhere).length > 0 ? storeWhere : undefined,
                        through: { where: { is_active: true } },
                        required: false
                    }
                ],
                distinct: true,
                attributes: ['id'] // Only need IDs for counting
            });
            usersWithStores = usersWithStoresCount.filter(user => 
                user.assignedStores && user.assignedStores.length > 0
            ).length;
        } catch (storeError) {
            // Continue with 0 if this fails
            usersWithStores = 0;
        }

        const statsResponse = {
            totalUsers,
            activeUsers,
            pendingUsers,
            adminUsers,
            managerUsers,
            cashierUsers,
            recentLogins,
            usersWithStores
        };

        res.json(statsResponse);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user statistics', details: error.message });
    }
});

// Get user statistics (alias for /stats/summary)
router.get('/stats/summary', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const totalUsers = await User.count({ where: baseWhere });
        const activeUsers = await User.count({ where: { ...baseWhere, is_active: true } });
        const pendingUsers = await User.count({ where: { ...baseWhere, approval_status: 'pending' } });
        const adminUsers = await User.count({ where: { ...baseWhere, role: 'admin' } });
        const managerUsers = await User.count({ where: { ...baseWhere, role: 'manager' } });
        const cashierUsers = await User.count({ where: { ...baseWhere, role: 'cashier' } });

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const recentLogins = await User.count({
            where: {
                ...baseWhere,
                last_login: {
                    [Op.gte]: weekAgo
                }
            }
        });

        // Users with store assignments
        let usersWithStores = 0;
        try {
            const storeWhere = buildCompanyWhere(req);
            const usersWithStoresCount = await User.findAll({
                where: baseWhere,
                include: [
                    {
                        model: Store,
                        as: 'assignedStores',
                        where: Object.keys(storeWhere).length > 0 ? storeWhere : undefined,
                        through: { where: { is_active: true } },
                        required: false
                    }
                ],
                distinct: true,
                attributes: ['id'] // Only need IDs for counting
            });
            usersWithStores = usersWithStoresCount.filter(user => 
                user.assignedStores && user.assignedStores.length > 0
            ).length;
        } catch (storeError) {
            // Continue with 0 if this fails
            usersWithStores = 0;
        }

        const statsResponse = {
            totalUsers,
            activeUsers,
            pendingUsers,
            adminUsers,
            managerUsers,
            cashierUsers,
            recentLogins,
            usersWithStores
        };

        res.json(statsResponse);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
});

router.patch('/:id/last-login', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await user.update({ last_login: new Date() });
        res.json({ message: 'Last login updated successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to update last login' });
    }
});

// Toggle user status (active/inactive)
router.patch('/:id/toggle-status', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent deactivating the last admin user (within same company)
        if (user.role === 'admin' && user.is_active) {
            const adminWhere = buildCompanyWhere(req, { role: 'admin', is_active: true });
            if (!req.user.isSystemAdmin && req.user.companyId) {
                adminWhere.companyId = req.user.companyId;
            }
            const adminCount = await User.count({ where: adminWhere });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot deactivate the last admin user' });
            }
        }

        await user.update({ is_active: !user.is_active });
        
        const userResponse = user.toJSON();
        delete userResponse.password;

        res.json(userResponse);

    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle user status' });
    }
});

// Approve a user
router.patch('/:id/approve', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.approval_status === 'approved') {
            return res.status(400).json({ error: 'User is already approved' });
        }

        await user.update({
            approval_status: 'approved',
            approval_date: new Date(),
            approved_by: req.user.id,
            rejection_reason: null // Clear any previous rejection reason
        });
        
        const userResponse = user.toJSON();
        delete userResponse.password;

        res.json({
            message: 'User approved successfully',
            user: userResponse
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to approve user' });
    }
});

// Reject a user
router.patch('/:id/reject', async (req, res) => {
    try {
        const { rejection_reason } = req.body;
        
        if (!rejection_reason || rejection_reason.trim() === '') {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { id: req.params.id });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const user = await User.findOne({ where: whereClause });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.approval_status === 'rejected') {
            return res.status(400).json({ error: 'User is already rejected' });
        }

        await user.update({
            approval_status: 'rejected',
            approval_date: new Date(),
            approved_by: req.user.id,
            rejection_reason: rejection_reason.trim()
        });
        
        const userResponse = user.toJSON();
        delete userResponse.password;

        res.json({
            message: 'User rejected successfully',
            user: userResponse
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to reject user' });
    }
});

// Get pending users for approval
router.get('/pending/approval', async (req, res) => {
    try {
        // Build where clause with company filter
        const whereClause = buildCompanyWhere(req, { approval_status: 'pending' });
        if (!req.user.isSystemAdmin && req.user.companyId) {
            whereClause.companyId = req.user.companyId;
        }

        const pendingUsers = await User.findAll({
            where: whereClause,
            attributes: { exclude: ['password'] },
            include: [
                {
                    model: Store,
                    as: 'assignedStores',
                    through: { 
                        attributes: ['role', 'is_active', 'assigned_at']
                    },
                    where: (() => {
                        const storeWhere = buildCompanyWhere(req);
                        return Object.keys(storeWhere).length > 0 ? storeWhere : undefined;
                    })(),
                    required: false,
                    attributes: ['id', 'name', 'store_type', 'location']
                }
            ],
            order: [['createdAt', 'ASC']]
        });

        res.json(pendingUsers);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pending users' });
    }
});

module.exports = router; 