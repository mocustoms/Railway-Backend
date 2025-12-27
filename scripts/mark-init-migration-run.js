const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function markMigrationRun() {
    try {
        await sequelize.authenticate();
        console.log('Database connection established.');
        
        // Mark the initialize-database migration as run
        await sequelize.query(
            `INSERT INTO "SequelizeMeta" (name) VALUES ('00000000000000-initialize-database.js') ON CONFLICT (name) DO NOTHING;`,
            { type: QueryTypes.INSERT }
        );
        
        console.log('✅ Marked initialize-database migration as run');
        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        await sequelize.close();
        process.exit(1);
    }
}

markMigrationRun();

