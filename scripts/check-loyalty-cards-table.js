const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'easymauzo_pos',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function checkLoyaltyCards() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    // Check loyalty_cards table
    console.log('📋 LOYALTY_CARDS TABLE - All columns:');
    const loyaltyCards = await sequelize.query(`
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'loyalty_cards'
      ORDER BY ordinal_position;
    `, { type: Sequelize.QueryTypes.SELECT });

    if (loyaltyCards.length === 0) {
      console.log('⚠️  loyalty_cards table does not exist');
    } else {
      loyaltyCards.forEach((col, idx) => {
        let typeInfo = col.data_type;
        if (col.character_maximum_length) {
          typeInfo += `(${col.character_maximum_length})`;
        } else if (col.numeric_precision && col.numeric_scale) {
          typeInfo += `(${col.numeric_precision},${col.numeric_scale})`;
        }
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        console.log(`${(idx + 1).toString().padStart(3)}. ${col.column_name.padEnd(40)} ${typeInfo.padEnd(25)} ${nullable}`);
      });
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkLoyaltyCards();

