#!/usr/bin/env node

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { createRailwaySequelize } = require('../config/railway-db');

const railwayUrl = 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';

async function queryDB(sequelize, query, params = {}) {
  const result = await sequelize.query(query, {
    replacements: params,
    type: QueryTypes.SELECT
  });
  return Array.isArray(result) && result.length > 0 && Array.isArray(result[0])
    ? result[0]
    : result;
}

async function main() {
  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  
  try {
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');
    
    // Check packaging constraints
    console.log('='.repeat(80));
    console.log('PACKAGING TABLE CONSTRAINTS');
    console.log('='.repeat(80));
    
    const localConstraints = await queryDB(localSequelize, `
      SELECT 
        conname AS name,
        contype AS type,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'packaging')
      ORDER BY contype, conname
    `);
    
    const railwayConstraints = await queryDB(railwaySequelize, `
      SELECT 
        conname AS name,
        contype AS type,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'packaging')
      ORDER BY contype, conname
    `);
    
    console.log('\nLOCAL Constraints:');
    localConstraints.forEach(c => {
      console.log(`  [${c.type}] ${c.name}: ${c.definition}`);
    });
    
    console.log('\nRAILWAY Constraints:');
    railwayConstraints.forEach(c => {
      console.log(`  [${c.type}] ${c.name}: ${c.definition}`);
    });
    
    // Compare
    const localUnique = localConstraints.filter(c => c.type === 'u').map(c => c.name);
    const railwayUnique = railwayConstraints.filter(c => c.type === 'u').map(c => c.name);
    
    console.log('\n' + '='.repeat(80));
    console.log('COMPARISON:');
    console.log('='.repeat(80));
    
    const missing = localUnique.filter(n => !railwayUnique.includes(n));
    const extra = railwayUnique.filter(n => !localUnique.includes(n));
    
    if (missing.length > 0) {
      console.log('\n❌ Missing in Railway:');
      missing.forEach(n => console.log(`   - ${n}`));
    }
    
    if (extra.length > 0) {
      console.log('\n⚠️  Extra in Railway:');
      extra.forEach(n => console.log(`   - ${n}`));
    }
    
    if (missing.length === 0 && extra.length === 0) {
      console.log('\n✅ Unique constraints match!');
    }
    
    // Check all tables for issues
    console.log('\n' + '='.repeat(80));
    console.log('CHECKING ALL TABLES FOR ISSUES');
    console.log('='.repeat(80));
    
    const tables = await queryDB(localSequelize, `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const tableNames = tables.map(t => t.table_name);
    
    for (const tableName of tableNames.slice(0, 10)) { // Check first 10 tables
      const localUniques = await queryDB(localSequelize, `
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = :tableName)
        AND contype = 'u'
      `, { tableName });
      
      const railwayUniques = await queryDB(railwaySequelize, `
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = :tableName)
        AND contype = 'u'
      `, { tableName });
      
      const localNames = localUniques.map(u => u.conname).sort();
      const railwayNames = railwayUniques.map(u => u.conname).sort();
      
      if (JSON.stringify(localNames) !== JSON.stringify(railwayNames)) {
        console.log(`\n⚠️  ${tableName}:`);
        console.log(`   Local:   ${localNames.join(', ') || 'none'}`);
        console.log(`   Railway: ${railwayNames.join(', ') || 'none'}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

main().catch(console.error);

