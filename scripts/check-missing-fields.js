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

async function checkFields() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    // Check customers table for loyalty-related fields
    console.log('📋 CUSTOMERS TABLE - All columns:');
    const customers = await sequelize.query(`
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customers'
      ORDER BY ordinal_position;
    `, { type: Sequelize.QueryTypes.SELECT });

    customers.forEach((col, idx) => {
      let typeInfo = col.data_type;
      if (col.character_maximum_length) {
        typeInfo += `(${col.character_maximum_length})`;
      } else if (col.numeric_precision && col.numeric_scale) {
        typeInfo += `(${col.numeric_precision},${col.numeric_scale})`;
      }
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      console.log(`${(idx + 1).toString().padStart(3)}. ${col.column_name.padEnd(40)} ${typeInfo.padEnd(25)} ${nullable}`);
    });

    // Check product_transactions for currency and exchange fields
    console.log('\n📋 PRODUCT_TRANSACTIONS TABLE - Currency/Exchange related columns:');
    const productTrans = await sequelize.query(`
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'product_transactions'
        AND (column_name LIKE '%currency%' OR column_name LIKE '%exchange%' OR column_name LIKE '%equivalent%')
      ORDER BY ordinal_position;
    `, { type: Sequelize.QueryTypes.SELECT });

    if (productTrans.length === 0) {
      console.log('⚠️  No currency/exchange fields found!');
    } else {
      productTrans.forEach((col, idx) => {
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

    // Check all product_transactions columns
    console.log('\n📋 PRODUCT_TRANSACTIONS TABLE - All columns:');
    const allProductTrans = await sequelize.query(`
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'product_transactions'
      ORDER BY ordinal_position;
    `, { type: Sequelize.QueryTypes.SELECT });

    allProductTrans.forEach((col, idx) => {
      let typeInfo = col.data_type;
      if (col.character_maximum_length) {
        typeInfo += `(${col.character_maximum_length})`;
      } else if (col.numeric_precision && col.numeric_scale) {
        typeInfo += `(${col.numeric_precision},${col.numeric_scale})`;
      }
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      console.log(`${(idx + 1).toString().padStart(3)}. ${col.column_name.padEnd(40)} ${typeInfo.padEnd(25)} ${nullable}`);
    });

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkFields();

