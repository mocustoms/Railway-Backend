const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

// Migrations that are failing because objects already exist
const migrationsToMark = [
    '20250120000009-create-proforma-invoices-tables.js',
    '20250120000010-add-is-wht-to-tax-codes.js',
    '20250121000001-add-default-price-category-to-stores.js',
    '20250121000002-add-price-category-to-proforma-invoices.js',
    '20250121000003-recalculate-product-price-categories.js',
    '20250122000001-add-tax-fields-to-proforma-invoice-items.js',
    '20250122000002-add-currency-fields-to-proforma-invoice-items.js',
    '20250122000003-add-calculated-fields-to-proforma-invoices.js'
];

async function markMigrationsRun() {
    try {
        await sequelize.authenticate();
        console.log('Database connection established.');
        
        for (const migration of migrationsToMark) {
            try {
                await sequelize.query(
                    `INSERT INTO "SequelizeMeta" (name) VALUES ('${migration}') ON CONFLICT (name) DO NOTHING;`,
                    { type: QueryTypes.INSERT }
                );
                console.log(`✅ Marked ${migration} as run`);
            } catch (error) {
                console.error(`❌ Error marking ${migration}:`, error.message);
            }
        }
        
        await sequelize.close();
        console.log('\n✅ All migrations marked as run');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        await sequelize.close();
        process.exit(1);
    }
}

markMigrationsRun();

