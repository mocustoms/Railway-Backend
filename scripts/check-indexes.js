#!/usr/bin/env node

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { createRailwaySequelize } = require('../config/railway-db');

const railwayUrl = 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';

async function getIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(`
    SELECT
      i.relname AS index_name,
      array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      pg_get_indexdef(ix.indexrelid) AS definition
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relkind = 'r'
    AND t.relname = :tableName
    GROUP BY i.relname, ix.indisunique, ix.indisprimary, ix.indexrelid, ix.indkey
    ORDER BY i.relname
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return Array.isArray(indexes) && indexes.length > 0 && Array.isArray(indexes[0])
    ? indexes[0]
    : indexes;
}

async function main() {
  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  
  try {
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');
    
    console.log('='.repeat(80));
    console.log('PACKAGING TABLE INDEXES');
    console.log('='.repeat(80));
    
    const localIndexes = await getIndexes(localSequelize, 'packaging');
    const railwayIndexes = await getIndexes(railwaySequelize, 'packaging');
    
    console.log('\nLOCAL Indexes:');
    localIndexes.forEach(idx => {
      const cols = Array.isArray(idx.columns) ? idx.columns.filter(c => c).join(', ') : (idx.columns || 'N/A');
      console.log(`  ${idx.is_unique ? '[UNIQUE]' : '[INDEX]'} ${idx.index_name}: (${cols})`);
      console.log(`    Definition: ${idx.definition}`);
    });
    
    console.log('\nRAILWAY Indexes:');
    railwayIndexes.forEach(idx => {
      const cols = Array.isArray(idx.columns) ? idx.columns.filter(c => c).join(', ') : (idx.columns || 'N/A');
      console.log(`  ${idx.is_unique ? '[UNIQUE]' : '[INDEX]'} ${idx.index_name}: (${cols})`);
      console.log(`    Definition: ${idx.definition}`);
    });
    
    // Compare unique indexes
    const localUnique = localIndexes.filter(i => i.is_unique && !i.is_primary).map(i => i.index_name);
    const railwayUnique = railwayIndexes.filter(i => i.is_unique && !i.is_primary).map(i => i.index_name);
    
    console.log('\n' + '='.repeat(80));
    console.log('COMPARISON:');
    console.log('='.repeat(80));
    
    const missing = localUnique.filter(n => !railwayUnique.includes(n));
    const extra = railwayUnique.filter(n => !localUnique.includes(n));
    
    if (missing.length > 0) {
      console.log('\n❌ Missing unique indexes in Railway:');
      missing.forEach(n => console.log(`   - ${n}`));
    }
    
    if (extra.length > 0) {
      console.log('\n⚠️  Extra unique indexes in Railway:');
      extra.forEach(n => console.log(`   - ${n}`));
    }
    
    // Check for the specific index we need
    const expectedIndex = 'packaging_code_companyId_unique';
    const localHas = localUnique.includes(expectedIndex);
    const railwayHas = railwayUnique.includes(expectedIndex);
    
    console.log('\n' + '='.repeat(80));
    console.log('EXPECTED INDEX CHECK:');
    console.log('='.repeat(80));
    console.log(`Expected: ${expectedIndex}`);
    console.log(`Local:    ${localHas ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`Railway:  ${railwayHas ? '✅ EXISTS' : '❌ MISSING'}`);
    
    if (!localHas || !railwayHas) {
      console.log('\n⚠️  The expected unique index is missing!');
      console.log('   This index should enforce uniqueness on (code, companyId)');
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

