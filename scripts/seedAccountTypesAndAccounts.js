/**
 * Migration script to seed Account Types and Accounts from mocustomstech company to Hamza & Sons Limited
 * 
 * Usage: node scripts/seedAccountTypesAndAccounts.js
 */

const sequelize = require('../config/database');
const { AccountType, Account, Company, User } = require('../server/models');
const { Sequelize } = require('sequelize');

async function seedAccountTypesAndAccounts() {
    const transaction = await sequelize.transaction();
    
    try {
        // Find source company (MocustomsTech)
        const sourceCompany = await Company.findOne({
            where: {
                name: 'MocustomsTech'
            },
            transaction
        });

        if (!sourceCompany) {
            console.error('Source company "MocustomsTech" not found!');
            console.log('Available companies:');
            const allCompanies = await Company.findAll({ attributes: ['id', 'name', 'code'] });
            allCompanies.forEach(c => {
                console.log(`  - ${c.name} (${c.code || 'no code'})`);
            });
            await transaction.rollback();
            process.exit(1);
        }

        console.log(`✓ Found source company: ${sourceCompany.name} (ID: ${sourceCompany.id})`);

        // Find target company (Hamza & Sons Limited)
        const targetCompany = await Company.findOne({
            where: {
                name: 'Hamza & Sons Limited'
            },
            transaction
        });

        if (!targetCompany) {
            console.error('Target company "Hamza & Sons Limited" not found!');
            console.log('Available companies:');
            const allCompanies = await Company.findAll({ attributes: ['id', 'name', 'code'] });
            allCompanies.forEach(c => {
                console.log(`  - ${c.name} (${c.code || 'no code'})`);
            });
            await transaction.rollback();
            process.exit(1);
        }

        console.log(`✓ Found target company: ${targetCompany.name} (ID: ${targetCompany.id})`);

        // Get the specific user account for created_by fields
        const targetUser = await User.findOne({
            where: {
                username: 'acc_ahmed',
                companyId: targetCompany.id
            },
            transaction
        });

        if (!targetUser) {
            console.error('User "acc_ahmed" not found in target company! Cannot proceed.');
            await transaction.rollback();
            process.exit(1);
        }

        console.log(`✓ Found user for target company: ${targetUser.username} (${targetUser.email || targetUser.id})`);

        // Step 1: Get all AccountTypes from source company
        const sourceAccountTypes = await AccountType.findAll({
            where: {
                companyId: sourceCompany.id
            },
            order: [['created_at', 'ASC']],
            transaction
        });

        if (sourceAccountTypes.length === 0) {
            console.log('No account types found in source company.');
            await transaction.commit();
            return;
        }

        console.log(`\nFound ${sourceAccountTypes.length} account type(s) to copy:`);
        sourceAccountTypes.forEach((at, index) => {
            console.log(`  ${index + 1}. ${at.name} (Code: ${at.code})`);
        });

        // Step 2: Get existing AccountTypes globally (to avoid duplicates - check both company-scoped and global)
        console.log('\nStep 1: Checking existing Account Types...');
        const existingAccountTypesByCompany = await AccountType.findAll({
            where: {
                companyId: targetCompany.id
            },
            transaction
        });

        // Also check globally by name (in case there's a global unique constraint)
        const existingAccountTypesGlobal = await AccountType.findAll({
            where: {
                name: sourceAccountTypes.map(at => at.name)
            },
            transaction
        });

        const existingAccountTypesByCode = new Map();
        const existingAccountTypesByName = new Map();
        
        // Add company-scoped ones
        existingAccountTypesByCompany.forEach(at => {
            existingAccountTypesByCode.set(`${at.companyId}-${at.code}`, at);
            existingAccountTypesByName.set(`${at.companyId}-${at.name}`, at);
        });
        
        // Add global ones (by name only, as there might be a global constraint)
        existingAccountTypesGlobal.forEach(at => {
            const key = `${at.companyId}-${at.name}`;
            if (!existingAccountTypesByName.has(key)) {
                existingAccountTypesByName.set(key, at);
            }
        });

        console.log(`Found ${existingAccountTypesByCompany.length} existing account type(s) in target company.`);
        if (existingAccountTypesGlobal.length > existingAccountTypesByCompany.length) {
            console.log(`Found ${existingAccountTypesGlobal.length - existingAccountTypesByCompany.length} additional account type(s) globally with matching names.`);
        }

        // Step 3: Create AccountTypes in target company (with ID mapping)
        console.log('\nStep 2: Creating Account Types...');
        const accountTypeIdMap = new Map(); // Maps old ID -> new ID
        
        for (const sourceAccountType of sourceAccountTypes) {
            // Check if account type with same code or name already exists in target company
            const existingByCode = existingAccountTypesByCode.get(`${targetCompany.id}-${sourceAccountType.code}`);
            const existingByName = existingAccountTypesByName.get(`${targetCompany.id}-${sourceAccountType.name}`);
            
            // Also check globally by name (since there might be a global unique constraint)
            let globalExistingByName = null;
            for (const [key, at] of existingAccountTypesByName.entries()) {
                if (at.name === sourceAccountType.name) {
                    globalExistingByName = at;
                    break;
                }
            }
            
            const existingAccountType = existingByCode || existingByName || globalExistingByName;

            if (existingAccountType) {
                console.log(`  ⚠ Skipping ${sourceAccountType.name} (code ${sourceAccountType.code} or name already exists)`);
                accountTypeIdMap.set(sourceAccountType.id, existingAccountType.id);
                continue;
            }

            try {
                const newAccountType = await AccountType.create({
                    name: sourceAccountType.name,
                    code: sourceAccountType.code,
                    description: sourceAccountType.description,
                    category: sourceAccountType.category,
                    nature: sourceAccountType.nature,
                    is_active: sourceAccountType.is_active,
                    created_by: targetUser.id,
                    updated_by: targetUser.id,
                    companyId: targetCompany.id
                }, { transaction });

                accountTypeIdMap.set(sourceAccountType.id, newAccountType.id);
                // Update the maps for potential future duplicates
                existingAccountTypesByCode.set(newAccountType.code, newAccountType);
                existingAccountTypesByName.set(newAccountType.name, newAccountType);
                console.log(`  ✓ Created: ${newAccountType.name} (${newAccountType.code})`);
            } catch (createError) {
                if (createError.name === 'SequelizeUniqueConstraintError') {
                    // If duplicate error occurs, try to find the existing record
                    console.log(`  ⚠ Duplicate constraint error for ${sourceAccountType.name}, looking up existing record...`);
                    const existing = await AccountType.findOne({
                        where: {
                            companyId: targetCompany.id,
                            [Sequelize.Op.or]: [
                                { code: sourceAccountType.code },
                                { name: sourceAccountType.name }
                            ]
                        },
                        transaction
                    });
                    
                    if (existing) {
                        console.log(`  ⚠ Using existing: ${existing.name} (${existing.code})`);
                        accountTypeIdMap.set(sourceAccountType.id, existing.id);
                        existingAccountTypesByCode.set(existing.code, existing);
                        existingAccountTypesByName.set(existing.name, existing);
                    } else {
                        // If we can't find it, it might be a global constraint issue
                        console.log(`  ⚠ Skipping ${sourceAccountType.name} due to duplicate constraint (may exist globally)`);
                        // Try to find by name globally as fallback
                        const globalExisting = await AccountType.findOne({
                            where: {
                                name: sourceAccountType.name
                            },
                            transaction
                        });
                        if (globalExisting) {
                            accountTypeIdMap.set(sourceAccountType.id, globalExisting.id);
                        }
                    }
                } else {
                    throw createError;
                }
            }
        }

        // Step 4: Get all Accounts from source company
        const sourceAccounts = await Account.findAll({
            where: {
                companyId: sourceCompany.id
            },
            order: [
                ['parentId', 'ASC NULLS FIRST'], // Parent accounts first
                ['createdAt', 'ASC']
            ],
            transaction
        });

        if (sourceAccounts.length === 0) {
            console.log('\nNo accounts found in source company.');
            await transaction.commit();
            return;
        }

        console.log(`\nFound ${sourceAccounts.length} account(s) to copy:`);
        sourceAccounts.forEach((acc, index) => {
            const parentInfo = acc.parentId ? ` (Parent: ${acc.parentId})` : '';
            console.log(`  ${index + 1}. ${acc.name} (Code: ${acc.code})${parentInfo}`);
        });

        // Step 5: Get existing Accounts globally (to avoid duplicates)
        console.log('\nStep 3: Checking existing Accounts...');
        const existingAccountsByCompany = await Account.findAll({
            where: {
                companyId: targetCompany.id
            },
            transaction
        });

        // Also check globally by code (in case there's a global unique constraint)
        const existingAccountsGlobal = await Account.findAll({
            where: {
                code: sourceAccounts.map(acc => acc.code)
            },
            transaction
        });

        const existingAccountsByCode = new Map();
        
        // Add company-scoped ones
        existingAccountsByCompany.forEach(acc => {
            existingAccountsByCode.set(`${acc.companyId}-${acc.code}`, acc);
        });
        
        // Add global ones (by code)
        existingAccountsGlobal.forEach(acc => {
            const key = `${acc.companyId}-${acc.code}`;
            if (!existingAccountsByCode.has(key)) {
                existingAccountsByCode.set(key, acc);
            }
            // Also add global code check
            if (!existingAccountsByCode.has(`GLOBAL-${acc.code}`)) {
                existingAccountsByCode.set(`GLOBAL-${acc.code}`, acc);
            }
        });

        console.log(`Found ${existingAccountsByCompany.length} existing account(s) in target company.`);
        if (existingAccountsGlobal.length > existingAccountsByCompany.length) {
            console.log(`Found ${existingAccountsGlobal.length - existingAccountsByCompany.length} additional account(s) globally with matching codes.`);
        }

        // Step 6: Create Accounts in target company (handling parent-child relationships)
        console.log('\nStep 4: Creating Accounts...');
        const accountIdMap = new Map(); // Maps old ID -> new ID
        
        // First pass: Create accounts without parentId (parent accounts)
        for (const sourceAccount of sourceAccounts) {
            if (sourceAccount.parentId) {
                continue; // Skip children in first pass
            }

            // Check if account with same code already exists (company-scoped or globally)
            const existingByCompanyCode = existingAccountsByCode.get(`${targetCompany.id}-${sourceAccount.code}`);
            const existingByGlobalCode = existingAccountsByCode.get(`GLOBAL-${sourceAccount.code}`);
            const existingAccount = existingByCompanyCode || existingByGlobalCode;

            if (existingAccount) {
                console.log(`  ⚠ Skipping ${sourceAccount.name} (code ${sourceAccount.code} already exists)`);
                accountIdMap.set(sourceAccount.id, existingAccount.id);
                continue;
            }

            // Map account_type_id (use accountTypeId as the property name)
            const newAccountTypeId = accountTypeIdMap.get(sourceAccount.accountTypeId || sourceAccount.account_type_id) || null;

            const newAccount = await Account.create({
                name: sourceAccount.name,
                code: sourceAccount.code,
                type: sourceAccount.type,
                nature: sourceAccount.nature,
                accountTypeId: newAccountTypeId,
                parentId: null, // Parent accounts don't have parentId
                description: sourceAccount.description,
                status: sourceAccount.status,
                createdBy: targetUser.id,
                updatedBy: targetUser.id,
                companyId: targetCompany.id
            }, { transaction });

            accountIdMap.set(sourceAccount.id, newAccount.id);
            // Update the map for potential future duplicates
            existingAccountsByCode.set(`${targetCompany.id}-${newAccount.code}`, newAccount);
            existingAccountsByCode.set(`GLOBAL-${newAccount.code}`, newAccount);
            console.log(`  ✓ Created parent: ${newAccount.name} (${newAccount.code})`);
        }

        // Second pass: Create accounts with parentId (child accounts)
        for (const sourceAccount of sourceAccounts) {
            if (!sourceAccount.parentId) {
                continue; // Skip parents in second pass
            }

            // Check if account with same code already exists (company-scoped or globally)
            const existingByCompanyCode = existingAccountsByCode.get(`${targetCompany.id}-${sourceAccount.code}`);
            const existingByGlobalCode = existingAccountsByCode.get(`GLOBAL-${sourceAccount.code}`);
            const existingAccount = existingByCompanyCode || existingByGlobalCode;

            if (existingAccount) {
                console.log(`  ⚠ Skipping ${sourceAccount.name} (code ${sourceAccount.code} already exists)`);
                accountIdMap.set(sourceAccount.id, existingAccount.id);
                continue;
            }

            // Map account_type_id and parentId (use accountTypeId as the property name)
            const newAccountTypeId = accountTypeIdMap.get(sourceAccount.accountTypeId || sourceAccount.account_type_id) || null;
            const newParentId = accountIdMap.get(sourceAccount.parentId) || null;

            if (!newParentId) {
                console.log(`  ⚠ Skipping ${sourceAccount.name} (parent account not found or not migrated)`);
                continue;
            }

            const newAccount = await Account.create({
                name: sourceAccount.name,
                code: sourceAccount.code,
                type: sourceAccount.type,
                nature: sourceAccount.nature,
                accountTypeId: newAccountTypeId,
                parentId: newParentId,
                description: sourceAccount.description,
                status: sourceAccount.status,
                createdBy: targetUser.id,
                updatedBy: targetUser.id,
                companyId: targetCompany.id
            }, { transaction });

            accountIdMap.set(sourceAccount.id, newAccount.id);
            // Update the map for potential future duplicates
            existingAccountsByCode.set(`${targetCompany.id}-${newAccount.code}`, newAccount);
            existingAccountsByCode.set(`GLOBAL-${newAccount.code}`, newAccount);
            console.log(`  ✓ Created child: ${newAccount.name} (${newAccount.code})`);
        }

        // Commit transaction
        await transaction.commit();

        console.log('\n✅ Migration completed successfully!');
        console.log(`\nSummary:`);
        console.log(`  - Account Types created: ${accountTypeIdMap.size}`);
        console.log(`  - Accounts created: ${accountIdMap.size}`);

    } catch (error) {
        await transaction.rollback();
        console.error('\n❌ Error during migration:', error);
        console.error('Transaction rolled back.');
        console.error('Error details:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

// Run the migration
seedAccountTypesAndAccounts()
    .then(() => {
        console.log('\nMigration script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nFatal error:', error);
        process.exit(1);
    });

