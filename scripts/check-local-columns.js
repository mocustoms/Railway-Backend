#!/usr/bin/env node

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function checkColumns() {
  try {
    await sequelize.authenticate();
    
    const tables = ['bank_details', 'openingBalances', 'payment_methods'];
    
    for (const table of tables) {
      const columns = await sequelize.query(
        `SELECT column_name, data_type 
         FROM information_schema.columns 
         WHERE table_schema = 'public' 
         AND table_name = :tableName 
         ORDER BY column_name`,
        {
          replacements: { tableName: table },
          type: QueryTypes.SELECT
        }
      );
      
      console.log(`\n${table}:`);
      columns.forEach(col => {
        console.log(`  - ${col.column_name} (${col.data_type})`);
      });
    }
    
    await sequelize.close();
  } catch (error) {
    console.error('Error:', error);
    await sequelize.close();
  }
}

checkColumns();

