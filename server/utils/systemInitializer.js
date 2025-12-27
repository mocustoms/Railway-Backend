/**
 * Initialize System on First Install
 * 
 * This module automatically initializes the system when installing on a new server:
 * - Creates default admin user (username: adminuser, password: StrongPass@2025)
 * - Only runs if no admin user exists
 * - Runs automatically on server startup
 */

const { User } = require('../models');
const bcrypt = require('bcryptjs');

async function initializeSystem() {
    try {
        // Check if any system admin exists
        const existingAdmin = await User.findOne({
            where: {
                isSystemAdmin: true
            }
        });

        if (existingAdmin) {
            // System already initialized
            return {
                initialized: false,
                message: 'System already initialized. Admin user exists.'
            };
        }

        // Check if adminuser exists (even if not system admin)
        const existingAdminUser = await User.findOne({
            where: {
                username: 'adminuser'
            }
        });

        if (existingAdminUser) {
            // Update existing adminuser to be system admin
            await existingAdminUser.update({
                isSystemAdmin: true,
                role: 'admin',
                is_active: true,
                approval_status: 'approved',
                approval_date: new Date(),
                companyId: null
            });

            return {
                initialized: true,
                message: 'Existing adminuser updated to system administrator',
                username: 'adminuser',
                password: 'StrongPass@2025'
            };
        }

        // Pass plain password - User model hook will hash it automatically
        // This prevents double-hashing (hook hashes it once)
        const adminUser = await User.create({
            username: 'adminuser',
            email: 'admin@easymauzo.com',
            password: 'StrongPass@2025', // Plain password - hook will hash it
            first_name: 'System',
            last_name: 'Administrator',
            role: 'admin',
            is_active: true,
            approval_status: 'approved',
            approval_date: new Date(),
            isSystemAdmin: true,
            companyId: null
        });

        return {
            initialized: true,
            message: 'System initialized successfully. Default admin user created.',
            username: 'adminuser',
            password: 'StrongPass@2025',
            email: 'admin@easymauzo.com',
            userId: adminUser.id
        };
    } catch (error) {
        // Don't throw - allow server to start even if initialization fails
        // The admin can be created manually later
        return {
            initialized: false,
            error: true,
            message: 'Failed to initialize system',
            details: error.message
        };
    }
}

module.exports = { initializeSystem };

