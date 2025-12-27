/**
 * Migration script to update Account codes for a specific company
 * Updates existing accounts to match the new auto-generated format: {COMPANY_CODE}-ACC-0001, etc.
 * 
 * Usage: node scripts/updateAccountCodes.js [companyId]
 */

const sequelize = require('../config/database');
const { Account, Company } = require('../server/models');
const { Sequelize } = require('sequelize');

async function updateAccountCodes(companyId = null) {
    const transaction = await sequelize.transaction();
    
    try {
        // Use provided company ID or find by name
        let company;
        if (companyId) {
            company = await Company.findByPk(companyId, { transaction });
        } else {
            company = await Company.findOne({
                where: {
                    name: 'Hamza & Sons Limited'
                },
                transaction
            });
        }

        if (!company) {
            console.error(`Company not found!`);
            console.log('Available companies:');
            const allCompanies = await Company.findAll({ attributes: ['id', 'name', 'code'] });
            allCompanies.forEach(c => {
                console.log(`  - ${c.name} (ID: ${c.id}, Code: ${c.code || 'no code'})`);
            });
            await transaction.rollback();
            process.exit(1);
        }

        console.log(`Found company: ${company.name} (ID: ${company.id})`);

        // Get company code for code generation
        let companyCode = 'EMZ';
        if (company.code) {
            companyCode = company.code.toUpperCase();
        } else if (company.name) {
            companyCode = company.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMZ';
        }
        console.log(`Company code: ${companyCode}`);

        // Get all accounts for this company, ordered by creation date
        const accounts = await Account.findAll({
            where: {
                companyId: company.id
            },
            order: [['createdAt', 'ASC']], // Order by creation date to maintain consistency
            transaction
        });

        if (accounts.length === 0) {
            console.log(`No accounts found for company ${company.name} (ID: ${company.id}).`);
            await transaction.commit();
            return;
        }

        console.log(`Found ${accounts.length} account(s) for this company.`);

        // Filter out accounts that already have the correct format
        const needsUpdate = accounts.filter(acc => {
            const code = acc.code.toUpperCase();
            // Check if it matches the new format: {COMPANY_CODE}-ACC-{NUMBER}
            const newFormatPattern = new RegExp(`^${companyCode}-ACC-\\d{4}$`);
            return !newFormatPattern.test(code);
        });

        if (needsUpdate.length === 0) {
            console.log(`All ${accounts.length} account(s) already have the correct format.`);
            await transaction.commit();
            return;
        }

        console.log(`Found ${accounts.length} total account(s), ${needsUpdate.length} need(s) updating:`);
        const originalCodes = new Map(); // Store original codes
        needsUpdate.forEach((acc, index) => {
            originalCodes.set(acc.id, acc.code);
            console.log(`  ${index + 1}. ${acc.name} (Current code: ${acc.code})`);
        });

        // Update codes sequentially: {COMPANY_CODE}-ACC-0001, {COMPANY_CODE}-ACC-0002, etc.
        // Strategy: Update all codes to temporary codes first, then reassign sequentially
        // This avoids conflicts with existing codes
        
        console.log('\nStep 1: Temporarily updating codes to avoid conflicts...');
        const tempCodes = [];
        for (let i = 0; i < needsUpdate.length; i++) {
            const account = needsUpdate[i];
            const tempCode = `TEMP-${account.id.substring(0, 8)}-${i}`;
            await account.update({
                code: tempCode
            }, { transaction });
            tempCodes.push({ account, tempCode });
            console.log(`  ✓ Temporary code for ${account.name}: ${tempCode}`);
        }

        console.log('\nStep 2: Assigning new sequential codes with company prefix...');
        
        // Find the highest existing number in the correct format to continue from there
        const existingCorrectFormat = accounts.filter(acc => {
            const code = acc.code.toUpperCase();
            const newFormatPattern = new RegExp(`^${companyCode}-ACC-(\\d{4})$`);
            return newFormatPattern.test(code);
        });

        let nextNumber = 1;
        if (existingCorrectFormat.length > 0) {
            const numbers = existingCorrectFormat.map(acc => {
                const match = acc.code.toUpperCase().match(new RegExp(`^${companyCode}-ACC-(\\d{4})$`));
                return match ? parseInt(match[1]) : 0;
            });
            nextNumber = Math.max(...numbers) + 1;
        }

        const updatedAccounts = [];
        for (let i = 0; i < tempCodes.length; i++) {
            const { account } = tempCodes[i];
            const newCode = `${companyCode}-ACC-${String(nextNumber + i).padStart(4, '0')}`;
            const originalCode = originalCodes.get(account.id);
            
            await account.update({
                code: newCode
            }, { transaction });

            updatedAccounts.push({
                name: account.name,
                oldCode: originalCode,
                newCode
            });

            console.log(`  ✓ Updated: ${account.name}`);
            console.log(`    ${originalCode} → ${newCode}`);
        }

        // Commit transaction
        await transaction.commit();

        console.log('\n✅ Migration completed successfully!');
        console.log(`Updated ${updatedAccounts.length} account(s):`);
        updatedAccounts.forEach((acc, index) => {
            console.log(`  ${index + 1}. ${acc.name}: ${acc.oldCode} → ${acc.newCode}`);
        });

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

// Get company ID from command line arguments
const companyId = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';

// Run the migration
updateAccountCodes(companyId)
    .then(() => {
        console.log('\nMigration script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nFatal error:', error);
        process.exit(1);
    });
