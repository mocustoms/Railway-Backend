/**
 * Reset Admin User Password
 * 
 * This script ensures the admin user exists and has the correct password.
 * Useful for fixing login issues or resetting admin password.
 * 
 * Usage: node scripts/resetAdminPassword.js
 */

const sequelize = require('../config/database');
const { User } = require('../server/models');
const bcrypt = require('bcryptjs');

async function resetAdminPassword() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connection established\n');

        // Find or create admin user
        let adminUser = await User.findOne({
            where: {
                username: 'adminuser'
            }
        });

        if (!adminUser) {
            console.log('⚠️  Admin user not found. Creating new admin user...');
            
            // Pass plain password - User model hook will hash it automatically
            adminUser = await User.create({
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

            console.log('✅ Admin user created successfully!\n');
        } else {
            console.log('✅ Admin user found. Resetting password...');
            
            // Pass plain password - User model hook will hash it automatically
            // Use set() to mark password as changed, then save
            adminUser.set('password', 'StrongPass@2025'); // Plain password - hook will hash it
            adminUser.set('is_active', true);
            adminUser.set('approval_status', 'approved');
            adminUser.set('isSystemAdmin', true);
            adminUser.set('role', 'admin');
            
            await adminUser.save(); // This triggers the beforeSave hook

            console.log('✅ Admin password reset successfully!\n');
        }

        // Verify password works
        const testPassword = 'StrongPass@2025';
        const isMatch = await bcrypt.compare(testPassword, adminUser.password);
        
        if (isMatch) {
            console.log('✅ Password verification successful!\n');
        } else {
            console.log('❌ Password verification failed! This should not happen.\n');
        }

        // Display admin user info
        console.log('📋 Admin User Details:');
        console.log('='.repeat(50));
        console.log(`Username: ${adminUser.username}`);
        console.log(`Email: ${adminUser.email}`);
        console.log(`Role: ${adminUser.role}`);
        console.log(`System Admin: ${adminUser.isSystemAdmin ? 'Yes' : 'No'}`);
        console.log(`Active: ${adminUser.is_active ? 'Yes' : 'No'}`);
        console.log(`Approval Status: ${adminUser.approval_status}`);
        console.log('='.repeat(50));
        console.log('\n🔐 Login Credentials:');
        console.log(`Username: adminuser`);
        console.log(`Password: StrongPass@2025`);
        console.log('\n⚠️  IMPORTANT: Change the password after first login!\n');

        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        await sequelize.close();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    resetAdminPassword();
}

module.exports = { resetAdminPassword };

