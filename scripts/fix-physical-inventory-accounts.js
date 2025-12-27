const { Sequelize } = require('sequelize');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Parse DATABASE_URL or use individual variables
const parseDatabaseUrl = () => {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: url.port || 5432,
      database: url.pathname.slice(1),
      username: url.username,
      password: url.password,
      dialect: 'postgres',
      logging: false
    };
  }
  
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'easymauzo',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    dialect: 'postgres',
    logging: false
  };
};

const dbConfig = parseDatabaseUrl();

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
  host: dbConfig.host,
  port: dbConfig.port,
  dialect: 'postgres',
  logging: false
});

async function fixPhysicalInventoryAccounts() {
  const referenceNumber = process.argv[2] || 'PI-1763382086931-343';
  
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    // Find the physical inventory
    const physicalInventories = await sequelize.query(`
      SELECT 
        id,
        reference_number,
        status,
        inventory_account_id,
        gain_account_id,
        loss_account_id,
        inventory_in_account_id,
        inventory_in_corresponding_account_id,
        inventory_out_account_id,
        inventory_out_corresponding_account_id
      FROM physical_inventories
      WHERE reference_number = :referenceNumber
    `, {
      replacements: { referenceNumber },
      type: Sequelize.QueryTypes.SELECT
    });
    
    if (!physicalInventories || physicalInventories.length === 0) {
      console.log(`❌ Physical inventory with reference number ${referenceNumber} not found`);
      return;
    }
    
    const pi = physicalInventories[0];
    console.log('\n📋 Physical Inventory Details:');
    console.log('ID:', pi.id);
    console.log('Reference Number:', pi.reference_number);
    console.log('Status:', pi.status);
    
    // Check what needs to be updated
    const updates = {};
    
    if (!pi.inventory_account_id && pi.inventory_in_account_id) {
      updates.inventory_account_id = pi.inventory_in_account_id;
      console.log(`\n✅ Will set inventory_account_id = ${pi.inventory_in_account_id}`);
    }
    
    if (!pi.gain_account_id && pi.inventory_in_corresponding_account_id) {
      updates.gain_account_id = pi.inventory_in_corresponding_account_id;
      console.log(`✅ Will set gain_account_id = ${pi.inventory_in_corresponding_account_id}`);
    }
    
    if (!pi.loss_account_id && pi.inventory_out_corresponding_account_id) {
      updates.loss_account_id = pi.inventory_out_corresponding_account_id;
      console.log(`✅ Will set loss_account_id = ${pi.inventory_out_corresponding_account_id}`);
    }
    
    if (Object.keys(updates).length === 0) {
      console.log('\n✅ All GL posting accounts are already set!');
      return;
    }
    
    // Perform the update
    const updateFields = Object.keys(updates).map(key => `"${key}" = :${key}`).join(', ');
    const replacements = { ...updates, id: pi.id };
    
    await sequelize.query(`
      UPDATE physical_inventories
      SET ${updateFields}
      WHERE id = :id
    `, {
      replacements,
      type: Sequelize.QueryTypes.UPDATE
    });
    
    console.log('\n✅ Successfully updated physical inventory accounts!');
    console.log('\n📊 Updated Accounts:');
    console.log('  inventory_account_id:', updates.inventory_account_id || pi.inventory_account_id || 'N/A');
    console.log('  gain_account_id:', updates.gain_account_id || pi.gain_account_id || 'N/A');
    console.log('  loss_account_id:', updates.loss_account_id || pi.loss_account_id || 'N/A');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

fixPhysicalInventoryAccounts();

