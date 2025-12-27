/**
 * Migration script to update Account Type codes to match the new simplified format
 * Updates existing account types to match the new auto-generated format: {COMPANY_CODE}-AT-0001, etc.
 * 
 * Usage: node scripts/updateAccountTypeCodes.js [companyIdOrName]
 * If companyIdOrName is not provided, updates all companies
 */

const sequelize = require('../config/database');
const { AccountType, Company } = require('../server/models');
const { Sequelize } = require('sequelize');

async function updateAccountTypeCodes(companyIdOrName = null) {
    const transaction = await sequelize.transaction();
    
    try {
        // Find company/companies
        let companies;
        if (companyIdOrName) {
            // Check if it's a UUID (company ID) or a name
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyIdOrName);
            
            let company;
            if (isUUID) {
                company = await Company.findByPk(companyIdOrName, { transaction });
            } else {
                company = await Company.findOne({
                    where: {
                        name: companyIdOrName
                    },
                    transaction
                });
            }

            if (!company) {
                console.error(`Company "${companyIdOrName}" not found!`);
                console.log('Available companies:');
                const allCompanies = await Company.findAll({ attributes: ['id', 'name', 'code'] });
                allCompanies.forEach(c => {
                    console.log(`  - ${c.name} (ID: ${c.id}, Code: ${c.code || 'no code'})`);
                });
                await transaction.rollback();
                process.exit(1);
            }
            companies = [company];
        } else {
            companies = await Company.findAll({
                attributes: ['id', 'name', 'code'],
                transaction
            });
            
            if (companies.length === 0) {
                console.log('No companies found.');
                await transaction.commit();
                return;
            }
        }

        let totalUpdated = 0;

        // Process each company
        for (const company of companies) {
            console.log('\n' + '='.repeat(60));
            console.log(`Processing company: ${company.name} (ID: ${company.id})`);
            console.log('='.repeat(60));

            // Get company code for code generation
            let companyCode = 'EMZ';
            if (company.code) {
                companyCode = company.code.toUpperCase();
            } else if (company.name) {
                companyCode = company.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMZ';
            }
            console.log(`Company code: ${companyCode}`);

            // Get all account types for this company, ordered by creation date
            const accountTypes = await AccountType.findAll({
                where: {
                    companyId: company.id
                },
                order: [['created_at', 'ASC']], // Order by creation date to maintain consistency
                transaction
            });

            if (accountTypes.length === 0) {
                console.log('No account types found for this company.');
                continue;
            }

            // Filter out account types that already have the correct format
            const needsUpdate = accountTypes.filter(at => {
                const code = at.code.toUpperCase();
                // Check if it matches the new format: {COMPANY_CODE}-AT-{NUMBER}
                const newFormatPattern = new RegExp(`^${companyCode}-AT-\\d{4}$`);
                return !newFormatPattern.test(code);
            });

            if (needsUpdate.length === 0) {
                console.log(`All ${accountTypes.length} account type(s) already have the correct format.`);
                continue;
            }

            console.log(`Found ${accountTypes.length} total account type(s), ${needsUpdate.length} need(s) updating:`);
            const originalCodes = new Map(); // Store original codes
            needsUpdate.forEach((at, index) => {
                originalCodes.set(at.id, at.code);
                console.log(`  ${index + 1}. ${at.name} (Current code: ${at.code})`);
            });

            // Update codes sequentially: {COMPANY_CODE}-AT-0001, {COMPANY_CODE}-AT-0002, etc.
            // Strategy: Update all codes to temporary codes first, then reassign sequentially
            // This avoids conflicts with existing codes
            
            console.log('\nStep 1: Temporarily updating codes to avoid conflicts...');
            const tempCodes = [];
            for (let i = 0; i < needsUpdate.length; i++) {
                const accountType = needsUpdate[i];
                const tempCode = `TEMP-${accountType.id.substring(0, 8)}-${i}`;
                await accountType.update({
                    code: tempCode
                }, { transaction });
                tempCodes.push({ accountType, tempCode });
                console.log(`  ✓ Temporary code for ${accountType.name}: ${tempCode}`);
            }

            console.log('\nStep 2: Assigning new sequential codes with company prefix...');
            
            // Find the highest existing number in the correct format to continue from there
            const existingCorrectFormat = accountTypes.filter(at => {
                const code = at.code.toUpperCase();
                const newFormatPattern = new RegExp(`^${companyCode}-AT-(\\d{4})$`);
                return newFormatPattern.test(code);
            });

            let nextNumber = 1;
            if (existingCorrectFormat.length > 0) {
                const numbers = existingCorrectFormat.map(at => {
                    const match = at.code.toUpperCase().match(new RegExp(`^${companyCode}-AT-(\\d{4})$`));
                    return match ? parseInt(match[1]) : 0;
                });
                nextNumber = Math.max(...numbers) + 1;
            }

            const updatedAccountTypes = [];
            for (let i = 0; i < tempCodes.length; i++) {
                const { accountType } = tempCodes[i];
                const newCode = `${companyCode}-AT-${String(nextNumber + i).padStart(4, '0')}`;
                const originalCode = originalCodes.get(accountType.id);
                
                await accountType.update({
                    code: newCode
                }, { transaction });

                updatedAccountTypes.push({
                    name: accountType.name,
                    oldCode: originalCode,
                    newCode
                });

                console.log(`  ✓ Updated: ${accountType.name}`);
                console.log(`    ${originalCode} → ${newCode}`);
            }

            totalUpdated += updatedAccountTypes.length;

            console.log(`\n✅ Updated ${updatedAccountTypes.length} account type(s) for ${company.name}:`);
            updatedAccountTypes.forEach((at, index) => {
                console.log(`  ${index + 1}. ${at.name}: ${at.oldCode} → ${at.newCode}`);
            });
        }

        // Commit transaction
        await transaction.commit();

        console.log('\n' + '='.repeat(60));
        console.log('✅ Migration completed successfully!');
        console.log(`Total account types updated: ${totalUpdated}`);
        console.log('='.repeat(60));

    } catch (error) {
        await transaction.rollback();
        console.error('\n❌ Error during migration:', error);
        console.error('Transaction rolled back.');
        console.error(error.stack);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

// Get company ID or name from command line arguments
const companyIdOrName = process.argv[2] || null;

// Run the migration
updateAccountTypeCodes(companyIdOrName)
    .then(() => {
        console.log('\nMigration script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nFatal error:', error);
        process.exit(1);
    });

