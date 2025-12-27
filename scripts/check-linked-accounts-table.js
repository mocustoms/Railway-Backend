const { Sequelize } = require('sequelize');

const DATABASE_URL = process.argv[2] || 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false
});

async function checkTable() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Railway database');
    
    const [results] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'linked_accounts'
    `);
    
    if (results.length > 0) {
      console.log('✅ linked_accounts table EXISTS on Railway');
      
      // Check columns
      const [columns] = await sequelize.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'linked_accounts'
        ORDER BY ordinal_position
      `);
      
      console.log(`\n📋 Table has ${columns.length} columns:`);
      columns.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    } else {
      console.log('❌ linked_accounts table NOT FOUND on Railway');
      console.log('   Migration needs to be run');
    }
    
    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkTable();

