#!/usr/bin/env node

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { createRailwaySequelize } = require('../config/railway-db');

async function checkConstraints(sequelize, label) {
  const constraints = await sequelize.query(
    `SELECT 
      conname AS constraint_name,
      contype AS constraint_type,
      pg_get_constraintdef(oid) AS constraint_definition
    FROM pg_constraint
    WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'packaging')
    ORDER BY contype, conname`,
    { type: QueryTypes.SELECT }
  );
  
  console.log(`\n${label} Packaging Constraints:`);
  console.log('='.repeat(80));
  
  const uniqueConstraints = constraints.filter(c => c.constraint_type === 'u');
  const foreignKeys = constraints.filter(c => c.constraint_type === 'f');
  const checks = constraints.filter(c => c.constraint_type === 'c');
  
  console.log(`\nUnique Constraints (${uniqueConstraints.length}):`);
  uniqueConstraints.forEach(c => {
    console.log(`  - ${c.constraint_name}: ${c.constraint_definition}`);
  });
  
  console.log(`\nForeign Keys (${foreignKeys.length}):`);
  foreignKeys.forEach(c => {
    console.log(`  - ${c.constraint_name}: ${c.constraint_definition}`);
  });
  
  console.log(`\nCheck Constraints (${checks.length}):`);
  checks.forEach(c => {
    console.log(`  - ${c.constraint_name}: ${c.constraint_definition}`);
  });
  
  return constraints;
}

async function main() {
  const localSequelize = require('../config/database');
  const railwayUrl = 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  
  try {
    await localSequelize.authenticate();
    await railwaySequelize.authenticate();
    
    const localConstraints = await checkConstraints(localSequelize, 'LOCAL');
    const railwayConstraints = await checkConstraints(railwaySequelize, 'RAILWAY');
    
    // Compare
    console.log('\n\nCOMPARISON:');
    console.log('='.repeat(80));
    
    const localUnique = localConstraints.filter(c => c.constraint_type === 'u').map(c => c.constraint_name);
    const railwayUnique = railwayConstraints.filter(c => c.constraint_type === 'u').map(c => c.constraint_name);
    
    const missingInRailway = localUnique.filter(name => !railwayUnique.includes(name));
    const extraInRailway = railwayUnique.filter(name => !localUnique.includes(name));
    
    if (missingInRailway.length > 0) {
      console.log('\n❌ Missing unique constraints in Railway:');
      missingInRailway.forEach(name => console.log(`   - ${name}`));
    }
    
    if (extraInRailway.length > 0) {
      console.log('\n⚠️  Extra unique constraints in Railway:');
      extraInRailway.forEach(name => console.log(`   - ${name}`));
    }
    
    if (missingInRailway.length === 0 && extraInRailway.length === 0) {
      console.log('\n✅ Unique constraints match!');
    }
    
    // Check definitions
    const localUniqueMap = new Map(localConstraints.filter(c => c.constraint_type === 'u').map(c => [c.constraint_name, c.constraint_definition]));
    const railwayUniqueMap = new Map(railwayConstraints.filter(c => c.constraint_type === 'u').map(c => [c.constraint_name, c.constraint_definition]));
    
    console.log('\n\nConstraint Definitions Comparison:');
    console.log('='.repeat(80));
    
    for (const [name, localDef] of localUniqueMap) {
      if (railwayUniqueMap.has(name)) {
        const railwayDef = railwayUniqueMap.get(name);
        if (localDef !== railwayDef) {
          console.log(`\n⚠️  ${name} definitions differ:`);
          console.log(`   Local:   ${localDef}`);
          console.log(`   Railway: ${railwayDef}`);
        } else {
          console.log(`✅ ${name}: Definitions match`);
        }
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

