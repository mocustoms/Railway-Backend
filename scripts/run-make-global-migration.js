const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function runMigration() {
    try {
        await sequelize.authenticate();
        console.log('Database connection established.');

        // Check if migration already ran
        const [results] = await sequelize.query(
            `SELECT name FROM "SequelizeMeta" WHERE name = '20250124000011-make-transaction-type-and-costing-method-global.js'`,
            { type: QueryTypes.SELECT }
        );

        if (results) {
            console.log('✅ Migration already run. Skipping...');
            await sequelize.close();
            process.exit(0);
        }

        console.log('Running migration: Make TransactionType and CostingMethod global...');

        // Make TransactionType.companyId nullable
        await sequelize.query(`
            ALTER TABLE transaction_types 
            ALTER COLUMN "companyId" DROP NOT NULL;
        `);
        console.log('✅ Made transaction_types.companyId nullable');

        // Make CostingMethod.companyId nullable
        await sequelize.query(`
            ALTER TABLE costing_methods 
            ALTER COLUMN "companyId" DROP NOT NULL;
        `);
        console.log('✅ Made costing_methods.companyId nullable');

        // Mark migration as run
        await sequelize.query(`
            INSERT INTO "SequelizeMeta" (name) 
            VALUES ('20250124000011-make-transaction-type-and-costing-method-global.js')
            ON CONFLICT (name) DO NOTHING;
        `);
        console.log('✅ Migration marked as run');

        console.log('\n✅ Migration completed successfully!');
        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        await sequelize.close();
        process.exit(1);
    }
}

runMigration();

