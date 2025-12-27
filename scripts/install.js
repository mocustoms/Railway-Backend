#!/usr/bin/env node

/**
 * EasyMauzo Installation Script
 * 
 * This script helps set up EasyMauzo on a new server:
 * 1. Checks database connection
 * 2. Runs database migrations
 * 3. Creates default admin user
 * 4. Verifies installation
 * 
 * Usage: node scripts/install.js
 */

const sequelize = require('../config/database');
const { User } = require('../server/models');
const path = require('path');
const fs = require('fs');

async function checkDatabaseConnection() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connection successful');
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('\nPlease ensure:');
        console.error('  1. PostgreSQL is running');
        console.error('  2. Database exists');
        console.error('  3. Connection credentials in .env file are correct');
        return false;
    }
}

async function checkMigrations() {
    try {
        const { QueryTypes } = require('sequelize');
        const [results] = await sequelize.query(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')",
            { type: QueryTypes.SELECT }
        );
        
        const tablesExist = Object.values(results)[0];
        if (!tablesExist) {
            console.log('\n⚠️  Database tables not found.');
            console.log('   Please run migrations first:');
            console.log('   npm run migrate');
            console.log('   OR');
            console.log('   node migrations/00000000000000-initialize-database.js');
            return false;
        }
        
        console.log('✅ Database tables exist');
        return true;
    } catch (error) {
        console.error('❌ Error checking migrations:', error.message);
        return false;
    }
}

async function checkAdminUser() {
    try {
        const adminUser = await User.findOne({
            where: {
                username: 'adminuser'
            }
        });

        if (adminUser) {
            console.log('✅ Admin user exists');
            console.log(`   Username: ${adminUser.username}`);
            console.log(`   Email: ${adminUser.email}`);
            console.log(`   System Admin: ${adminUser.isSystemAdmin ? 'Yes' : 'No'}`);
            
            if (!adminUser.isSystemAdmin) {
                console.log('\n⚠️  Admin user exists but is not a system administrator.');
                console.log('   Updating to system administrator...');
                await adminUser.update({
                    isSystemAdmin: true,
                    role: 'admin',
                    is_active: true,
                    approval_status: 'approved',
                    approval_date: new Date(),
                    companyId: null
                });
                console.log('✅ Admin user updated to system administrator');
            }
            return true;
        } else {
            console.log('⚠️  Admin user not found');
            return false;
        }
    } catch (error) {
        console.error('❌ Error checking admin user:', error.message);
        return false;
    }
}

async function createAdminUser() {
    try {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('StrongPass@2025', salt);

        const adminUser = await User.create({
            username: 'adminuser',
            email: 'admin@easymauzo.com',
            password: hashedPassword,
            first_name: 'System',
            last_name: 'Administrator',
            role: 'admin',
            is_active: true,
            approval_status: 'approved',
            approval_date: new Date(),
            isSystemAdmin: true,
            companyId: null
        });

        console.log('✅ Admin user created successfully');
        return true;
    } catch (error) {
        console.error('❌ Error creating admin user:', error.message);
        return false;
    }
}

async function verifyInstallation() {
    try {
        const { QueryTypes } = require('sequelize');
        
        // Check key tables
        const tables = ['users', 'Company', 'stores', 'products', 'accounts'];
        let allTablesExist = true;

        for (const table of tables) {
            const [results] = await sequelize.query(
                `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}')`,
                { type: QueryTypes.SELECT }
            );
            
            const exists = Object.values(results)[0];
            if (!exists) {
                console.error(`❌ Table '${table}' not found`);
                allTablesExist = false;
            }
        }

        if (allTablesExist) {
            console.log('✅ All key tables exist');
        }

        // Check admin user
        const adminUser = await User.findOne({
            where: {
                username: 'adminuser',
                isSystemAdmin: true
            }
        });

        if (adminUser) {
            console.log('✅ Admin user verified');
            return true;
        } else {
            console.error('❌ Admin user not found or not system admin');
            return false;
        }
    } catch (error) {
        console.error('❌ Verification error:', error.message);
        return false;
    }
}

async function main() {
    console.log('\n🚀 EasyMauzo Installation Script');
    console.log('='.repeat(60));
    console.log('');

    // Step 1: Check database connection
    console.log('Step 1: Checking database connection...');
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
        console.error('\n❌ Installation failed: Database connection required');
        process.exit(1);
    }
    console.log('');

    // Step 2: Check migrations
    console.log('Step 2: Checking database migrations...');
    const migrationsOk = await checkMigrations();
    if (!migrationsOk) {
        console.error('\n❌ Installation failed: Database migrations required');
        console.error('   Run migrations first, then run this script again');
        process.exit(1);
    }
    console.log('');

    // Step 3: Check/Create admin user
    console.log('Step 3: Checking admin user...');
    const adminExists = await checkAdminUser();
    
    if (!adminExists) {
        console.log('\nCreating default admin user...');
        const created = await createAdminUser();
        if (!created) {
            console.error('\n❌ Installation failed: Could not create admin user');
            process.exit(1);
        }
    }
    console.log('');

    // Step 4: Verify installation
    console.log('Step 4: Verifying installation...');
    const verified = await verifyInstallation();
    console.log('');

    if (verified) {
        console.log('='.repeat(60));
        console.log('✅ INSTALLATION COMPLETE!');
        console.log('='.repeat(60));
        console.log('\n📋 Default Admin Credentials:');
        console.log('   Username: adminuser');
        console.log('   Password: StrongPass@2025');
        console.log('   Email: admin@easymauzo.com');
        console.log('\n⚠️  IMPORTANT:');
        console.log('   1. Change the admin password after first login');
        console.log('   2. Configure database settings via UI: /database-settings');
        console.log('   3. Create your company and start using the system');
        console.log('\n🚀 You can now start the server:');
        console.log('   node server.js');
        console.log('='.repeat(60) + '\n');
    } else {
        console.error('\n❌ Installation verification failed');
        console.error('   Please check the errors above and try again');
        process.exit(1);
    }

    await sequelize.close();
}

// Run installation
main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});

