/**
 * Initialize Default Admin User
 * 
 * This script creates a default system administrator user when installing on a new server.
 * 
 * Default credentials:
 * - Username: adminuser
 * - Password: StrongPass@2025
 * 
 * Usage: node scripts/seedAdminUser.js
 */

const sequelize = require('../config/database');
const { User } = require('../server/models');
const bcrypt = require('bcryptjs');

async function seedAdminUser() {
    const transaction = await sequelize.transaction();
    
    try {
        await sequelize.authenticate();
        console.log('✅ Database connection established');

        // Check if admin user already exists
        const existingAdmin = await User.findOne({
            where: {
                username: 'adminuser'
            },
            transaction
        });

        if (existingAdmin) {
            console.log('⚠️  Admin user already exists. Skipping creation.');
            console.log(`   Username: ${existingAdmin.username}`);
            console.log(`   Email: ${existingAdmin.email}`);
            console.log(`   System Admin: ${existingAdmin.isSystemAdmin ? 'Yes' : 'No'}`);
            await transaction.commit();
            return;
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
            companyId: null // System admin doesn't need a company
        }, { transaction });

        await transaction.commit();

        console.log('\n✅ Admin user created successfully!');
        console.log('\n📋 Default Credentials:');
        console.log('   Username: adminuser');
        console.log('   Password: StrongPass@2025');
        console.log('   Email: admin@easymauzo.com');
        console.log('   Role: System Administrator');
        console.log('\n⚠️  IMPORTANT: Change the password after first login!');
        console.log('   User ID:', adminUser.id);

    } catch (error) {
        await transaction.rollback();
        console.error('\n❌ Error creating admin user:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

// Run the seed
seedAdminUser()
    .then(() => {
        console.log('\n✅ Seed script completed successfully.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    });

