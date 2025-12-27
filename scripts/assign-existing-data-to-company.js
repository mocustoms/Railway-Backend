/**
 * Assign Existing Data to Company Script
 * 
 * This script:
 * 1. Finds the existing company in the database
 * 2. Assigns all existing data (with null companyId) to that company
 * 3. Creates/updates user "Mohamed" with admin role and links to company
 */

const sequelize = require('../config/database');
const { QueryTypes, Op } = require('sequelize');
const { User, Company } = require('../server/models');
const bcrypt = require('bcryptjs');

async function assignExistingDataToCompany() {
    const transaction = await sequelize.transaction();
    
    try {
        await sequelize.authenticate();
        console.log('Database connection established.\n');

        // Step 1: Find the existing company using raw query to avoid model issues
        const companies = await sequelize.query(
            `SELECT id, name, email FROM "Company" LIMIT 1;`,
            { type: QueryTypes.SELECT, transaction }
        );
        
        if (companies.length === 0) {
            throw new Error('No company found in database. Please create a company first.');
        }

        const companyData = companies[0];
        const companyId = companyData.id;
        console.log(`✅ Found company: ${companyData.name} (ID: ${companyId})\n`);

        // Step 2: Assign all existing data to this company
        console.log(`Assigning existing data to company ${companyData.name}...\n`);

        const tenantTables = [
            'account_type_audits',
            'account_types',
            'accounts',
            'adjustment_reasons',
            'auto_codes',
            'bank_details',
            'costing_methods',
            'currencies',
            'customer_deposits',
            'customer_groups',
            'customers',
            'exchange_rates',
            'financial_years',
            'general_ledger',
            'loyalty_card_configs',
            'openingBalances',
            'packaging',
            'payment_methods',
            'payment_types',
            'physical_inventories',
            'physical_inventory_items',
            'physical_inventory_reversals',
            'price_categories',
            'price_change_reasons',
            'price_history',
            'product_brand_names',
            'product_categories',
            'product_colors',
            'product_dosages',
            'product_expiry_dates',
            'product_manufacturers',
            'product_manufacturing_info',
            'product_models',
            'product_pharmaceutical_info',
            'product_price_categories',
            'product_raw_materials',
            'product_serial_numbers',
            'product_store_locations',
            'product_stores',
            'product_transactions',
            'products',
            'proforma_invoice_items',
            'proforma_invoices',
            'return_reasons',
            'sales_agents',
            'stock_adjustment_items',
            'stock_adjustments',
            'store_request_item_transactions',
            'store_request_items',
            'store_requests',
            'stores',
            'tax_codes',
            'transaction_types',
            'transactions',
            'user_stores'
        ];

        let totalUpdated = 0;
        for (const tableName of tenantTables) {
            try {
                // Check if table exists
                const tableExists = await sequelize.query(
                    `SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = '${tableName}'
                    );`,
                    { type: QueryTypes.SELECT, transaction }
                );

                if (!tableExists[0].exists) {
                    console.log(`  ⏭️  Skipping ${tableName} (table doesn't exist)`);
                    continue;
                }

                // Check if table has companyId column (case-sensitive check)
                const hasCompanyId = await sequelize.query(
                    `SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                        AND table_name = '${tableName}'
                        AND (column_name = 'companyId' OR column_name = 'company_id')
                    );`,
                    { type: QueryTypes.SELECT, transaction }
                );

                if (!hasCompanyId[0].exists) {
                    console.log(`  ⏭️  Skipping ${tableName} (no companyId column)`);
                    continue;
                }

                // Determine the actual column name
                const columnCheck = await sequelize.query(
                    `SELECT column_name FROM information_schema.columns 
                     WHERE table_schema = 'public' 
                     AND table_name = '${tableName}'
                     AND (column_name = 'companyId' OR column_name = 'company_id')
                     LIMIT 1;`,
                    { type: QueryTypes.SELECT, transaction }
                );
                const companyIdColumn = columnCheck[0]?.column_name || 'companyId';

                // Update all null companyId records to this company
                const result = await sequelize.query(
                    `UPDATE "${tableName}" 
                     SET "${companyIdColumn}" = ${companyId} 
                     WHERE "${companyIdColumn}" IS NULL;`,
                    { type: QueryTypes.UPDATE, transaction }
                );

                const updatedCount = result[1] || 0;
                if (updatedCount > 0) {
                    console.log(`  ✓ Updated ${updatedCount} records in ${tableName}`);
                    totalUpdated += updatedCount;
                }
            } catch (error) {
                console.error(`  ✗ Error updating ${tableName}:`, error.message);
                // Continue with other tables
            }
        }

        console.log(`\n✅ Total records updated: ${totalUpdated}\n`);

        // Step 3: Create or update user "Mohamed" with admin role
        console.log('Setting up user "Mohamed"...\n');

        let mohamed = await User.findOne({
            where: {
                [Op.or]: [
                    { username: 'mohamed' },
                    { username: 'Mohamed' },
                    { email: 'mohamed@example.com' }
                ]
            },
            transaction
        });

        if (mohamed) {
            // Update existing user
            mohamed.companyId = companyId;
            mohamed.role = 'admin';
            mohamed.is_active = true;
            mohamed.approval_status = 'approved';
            mohamed.isSystemAdmin = false;
            await mohamed.save({ transaction });
            console.log(`✅ Updated existing user: ${mohamed.username} (ID: ${mohamed.id})`);
            console.log(`   - Role: admin`);
            console.log(`   - Company: ${companyData.name}`);
            console.log(`   - Company ID: ${companyId}`);
        } else {
            // Create new user
            const defaultPassword = 'Admin@123'; // Change this password after first login
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);

            mohamed = await User.create({
                username: 'mohamed',
                email: 'mohamed@example.com',
                password: hashedPassword,
                first_name: 'Mohamed',
                last_name: 'Admin',
                role: 'admin',
                companyId: companyId,
                is_active: true,
                approval_status: 'approved',
                isSystemAdmin: false
            }, { transaction });

            console.log(`✅ Created new user: ${mohamed.username} (ID: ${mohamed.id})`);
            console.log(`   - Username: mohamed`);
            console.log(`   - Email: mohamed@example.com`);
            console.log(`   - Password: ${defaultPassword} (PLEASE CHANGE AFTER FIRST LOGIN)`);
            console.log(`   - Role: admin`);
            console.log(`   - Company: ${companyData.name}`);
            console.log(`   - Company ID: ${companyId}`);
        }

        // Step 4: Update the company's subscription status if needed
        try {
            const hasSubscriptionStatus = await sequelize.query(
                `SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'Company'
                    AND column_name = 'subscriptionStatus'
                );`,
                { type: QueryTypes.SELECT, transaction }
            );

            if (hasSubscriptionStatus[0].exists && !companyData.subscriptionStatus) {
                await sequelize.query(
                    `UPDATE "Company" 
                     SET "subscriptionStatus" = 'trial',
                         "trialEndsAt" = NOW() + INTERVAL '30 days'
                     WHERE id = ${companyId};`,
                    { type: QueryTypes.UPDATE, transaction }
                );
                console.log(`\n✅ Updated company subscription status to 'trial'`);
            }
        } catch (error) {
            console.log(`\n⚠️  Could not update subscription status: ${error.message}`);
        }

        // Commit transaction
        await transaction.commit();
        
        console.log('\n✅ Successfully assigned all existing data to company!');
        console.log('\n📝 Summary:');
        console.log(`   - Company: ${companyData.name} (ID: ${companyId})`);
        console.log(`   - Records assigned: ${totalUpdated}`);
        console.log(`   - Admin user: ${mohamed.username} (${mohamed.first_name} ${mohamed.last_name})`);
        console.log(`   - User ID: ${mohamed.id}`);
        console.log(`   - Login credentials:`);
        console.log(`     Username: ${mohamed.username}`);
        console.log(`     Email: ${mohamed.email}`);
        
        console.log(`     Password: [Already set - use existing password]`);
        console.log('\n⚠️  IMPORTANT: If you need to reset the password, use the password reset feature!');
        
        await sequelize.close();
        process.exit(0);
    } catch (error) {
        // Rollback transaction on error (only if not already committed)
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        await sequelize.close();
        process.exit(1);
    }
}

assignExistingDataToCompany();

