/**
 * Script to increase account_types.code column length from VARCHAR(20) to VARCHAR(50)
 * 
 * Usage: node scripts/increaseAccountTypeCodeLength.js
 */

const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function increaseAccountTypeCodeLength() {
    const transaction = await sequelize.transaction();
    
    try {
        console.log('🔄 Increasing account_types.code column length from VARCHAR(20) to VARCHAR(50)...\n');

        // Check current column definition
        const [results] = await sequelize.query(`
            SELECT column_name, data_type, character_maximum_length 
            FROM information_schema.columns 
            WHERE table_name = 'account_types' AND column_name = 'code'
        `, { type: QueryTypes.SELECT });

        if (results) {
            console.log(`Current column definition: ${results.data_type}(${results.character_maximum_length})`);
            
            if (results.character_maximum_length === 50) {
                console.log('✓ Column already has length 50. No changes needed.');
                await transaction.commit();
                return;
            }
        }

        // Alter the column
        await sequelize.query(`
            ALTER TABLE account_types 
            ALTER COLUMN code TYPE VARCHAR(50)
        `, { transaction });

        await transaction.commit();
        console.log('✓ Successfully increased account_types.code column length to VARCHAR(50)\n');
    } catch (error) {
        await transaction.rollback();
        console.error('❌ Error increasing column length:', error.message);
        throw error;
    }
}

// Run the migration
increaseAccountTypeCodeLength()
    .then(() => {
        console.log('Migration script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    })
    .finally(() => {
        sequelize.close();
    });

