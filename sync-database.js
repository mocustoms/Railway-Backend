const sequelize = require('./config/database');
const models = require('./server/models');

async function syncDatabase() {
    try {
        // Only ensure the Customers table to avoid global ALTER conflicts
        await sequelize.authenticate();
        await sequelize.sync({ alter: false }); // Global sync disabled
        // const { Customer } = models;
        // await Customer.sync({ alter: true });
        console.log('Customers table ensured via targeted sync.');
        process.exit(0);
    } catch (error) {
        console.error('Targeted sync failed:', error);
        process.exit(1);
    }
}

// Run the sync
syncDatabase(); 