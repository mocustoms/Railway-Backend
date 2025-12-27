/**
 * Migration script to update price category codes for a specific company
 * Updates existing price categories to match the new auto-generated format: {COMPANY_CODE}-PRC-0001, etc.
 * 
 * Usage: node scripts/updatePriceCategoryCodes.js
 */

const sequelize = require('../config/database');
const { PriceCategory, Company } = require('../server/models');
const { Sequelize } = require('sequelize');

async function updatePriceCategoryCodes() {
    const transaction = await sequelize.transaction();
    
    try {
        // Find the company by name
        const company = await Company.findOne({
            where: {
                name: 'Hamza & Sons Limited'
            },
            transaction
        });

        if (!company) {
            console.error('Company "Hamza & Sons Limited" not found!');
            console.log('Available companies:');
            const allCompanies = await Company.findAll({ attributes: ['id', 'name', 'code'] });
            allCompanies.forEach(c => {
                console.log(`  - ${c.name} (${c.code || 'no code'})`);
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

        // Get all price categories for this company, ordered by creation date
        const priceCategories = await PriceCategory.findAll({
            where: {
                companyId: company.id
            },
            order: [['created_at', 'ASC']], // Order by creation date to maintain consistency
            transaction
        });

        if (priceCategories.length === 0) {
            console.log('No price categories found for this company.');
            await transaction.commit();
            return;
        }

        console.log(`Found ${priceCategories.length} price category(ies) to update:`);
        const originalCodes = new Map(); // Store original codes
        priceCategories.forEach((pc, index) => {
            originalCodes.set(pc.id, pc.code);
            console.log(`  ${index + 1}. ${pc.name} (Current code: ${pc.code})`);
        });

        // Update codes sequentially: PRC-0001, PRC-0002, etc.
        // Strategy: Update all codes to temporary codes first, then reassign sequentially
        // This avoids conflicts with existing codes
        
        console.log('\nStep 1: Temporarily updating codes to avoid conflicts...');
        const tempCodes = [];
        for (let i = 0; i < priceCategories.length; i++) {
            const category = priceCategories[i];
            const tempCode = `TEMP-${category.id.substring(0, 8)}-${i}`;
            await category.update({
                code: tempCode
            }, { transaction });
            tempCodes.push({ category, tempCode });
            console.log(`  ✓ Temporary code for ${category.name}: ${tempCode}`);
        }

        console.log('\nStep 2: Assigning new sequential codes with company prefix...');
        const updatedCategories = [];
        for (let i = 0; i < tempCodes.length; i++) {
            const { category } = tempCodes[i];
            const newCode = `${companyCode}-PRC-${String(i + 1).padStart(4, '0')}`;
            const originalCode = originalCodes.get(category.id);
            
            await category.update({
                code: newCode
            }, { transaction });

            updatedCategories.push({
                name: category.name,
                oldCode: originalCode,
                newCode
            });

            console.log(`  ✓ Updated: ${category.name}`);
            console.log(`    ${originalCode} → ${newCode}`);
        }

        // Commit transaction
        await transaction.commit();

        console.log('\n✅ Migration completed successfully!');
        console.log(`Updated ${updatedCategories.length} price category(ies):`);
        updatedCategories.forEach((cat, index) => {
            console.log(`  ${index + 1}. ${cat.name}: ${cat.oldCode} → ${cat.newCode}`);
        });

    } catch (error) {
        await transaction.rollback();
        console.error('\n❌ Error during migration:', error);
        console.error('Transaction rolled back.');
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

// Run the migration
updatePriceCategoryCodes()
    .then(() => {
        console.log('\nMigration script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nFatal error:', error);
        process.exit(1);
    });

