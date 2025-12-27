#!/usr/bin/env node

/**
 * Compare All Table Settings: Local vs Railway
 * 
 * Compares constraints, indexes, foreign keys, and defaults for ALL tables
 * between local and Railway databases
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function getTables(sequelize) {
  const tables = await sequelize.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
     AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    { type: QueryTypes.SELECT }
  );
  const tablesArray = Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0])
    ? tables[0]
    : tables;
  return tablesArray.map(t => t.table_name);
}

async function getTableConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(
    `SELECT
      constraint_name,
      constraint_type
     FROM information_schema.table_constraints
     WHERE table_name = :tableName
     AND table_schema = 'public'
     ORDER BY constraint_name`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(constraints) && constraints.length > 0 && Array.isArray(constraints[0]) 
    ? constraints[0] 
    : constraints;
}

async function getTableForeignKeys(sequelize, tableName) {
  const foreignKeys = await sequelize.query(
    `SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage AS ccu
       ON ccu.constraint_name = tc.constraint_name
     LEFT JOIN information_schema.referential_constraints AS rc
       ON rc.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
     AND tc.table_name = :tableName
     AND tc.table_schema = 'public'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(foreignKeys) && foreignKeys.length > 0 && Array.isArray(foreignKeys[0]) 
    ? foreignKeys[0] 
    : foreignKeys;
}

async function getTableIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(
    `SELECT
      indexname,
      indexdef
     FROM pg_indexes
     WHERE tablename = :tableName
     AND schemaname = 'public'
     ORDER BY indexname`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(indexes) && indexes.length > 0 && Array.isArray(indexes[0]) 
    ? indexes[0] 
    : indexes;
}

async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(
    `SELECT 
      column_name,
      column_default,
      is_nullable
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = :tableName
     ORDER BY ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

function compareArrays(local, railway, name) {
  const localSet = new Set(local.map(item => JSON.stringify(item)));
  const railwaySet = new Set(railway.map(item => JSON.stringify(item)));
  
  const missing = local.filter(item => !railwaySet.has(JSON.stringify(item)));
  const extra = railway.filter(item => !localSet.has(JSON.stringify(item)));
  
  return { missing, extra, match: missing.length === 0 && extra.length === 0 };
}

async function compareAllTableSettings() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔍 COMPARING ALL TABLE SETTINGS: LOCAL vs RAILWAY\n');
    console.log('='.repeat(80));
    
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    const localTables = await getTables(localSequelize);
    const railwayTables = await getTables(railwaySequelize);
    
    const commonTables = localTables.filter(t => railwayTables.includes(t));
    
    console.log(`📊 Local tables: ${localTables.length}`);
    console.log(`📊 Railway tables: ${railwayTables.length}`);
    console.log(`📊 Common tables: ${commonTables.length}\n`);

    let totalIssues = 0;
    const tablesWithIssues = [];

    for (const tableName of commonTables) {
      const localConstraints = await getTableConstraints(localSequelize, tableName);
      const railwayConstraints = await getTableConstraints(railwaySequelize, tableName);
      
      const localForeignKeys = await getTableForeignKeys(localSequelize, tableName);
      const railwayForeignKeys = await getTableForeignKeys(railwaySequelize, tableName);
      
      const localIndexes = await getTableIndexes(localSequelize, tableName);
      const railwayIndexes = await getTableIndexes(railwaySequelize, tableName);
      
      const localColumns = await getTableColumns(localSequelize, tableName);
      const railwayColumns = await getTableColumns(railwaySequelize, tableName);

      const constraintCompare = compareArrays(
        localConstraints.map(c => ({ name: c.constraint_name, type: c.constraint_type })),
        railwayConstraints.map(c => ({ name: c.constraint_name, type: c.constraint_type })),
        'constraints'
      );

      const fkCompare = compareArrays(
        localForeignKeys.map(fk => ({
          name: fk.constraint_name,
          column: fk.column_name,
          ref_table: fk.foreign_table_name,
          ref_column: fk.foreign_column_name,
          update_rule: fk.update_rule,
          delete_rule: fk.delete_rule
        })),
        railwayForeignKeys.map(fk => ({
          name: fk.constraint_name,
          column: fk.column_name,
          ref_table: fk.foreign_table_name,
          ref_column: fk.foreign_column_name,
          update_rule: fk.update_rule,
          delete_rule: fk.delete_rule
        })),
        'foreign keys'
      );

      const indexCompare = compareArrays(
        localIndexes.map(idx => idx.indexname),
        railwayIndexes.map(idx => idx.indexname),
        'indexes'
      );

      // Compare column defaults
      const localDefaults = new Map(localColumns.map(c => [c.column_name, c.column_default]));
      const railwayDefaults = new Map(railwayColumns.map(c => [c.column_name, c.column_default]));
      const defaultDifferences = [];
      
      for (const [colName, localDefault] of localDefaults) {
        const railwayDefault = railwayDefaults.get(colName);
        if (localDefault !== railwayDefault) {
          defaultDifferences.push({
            column: colName,
            local: localDefault,
            railway: railwayDefault
          });
        }
      }

      const hasIssues = !constraintCompare.match || !fkCompare.match || !indexCompare.match || defaultDifferences.length > 0;

      if (hasIssues) {
        totalIssues++;
        tablesWithIssues.push(tableName);
        
        console.log(`\n📋 ${tableName}:`);
        console.log('-'.repeat(80));

        if (!constraintCompare.match) {
          console.log('  ⚠️  Constraints differ:');
          if (constraintCompare.missing.length > 0) {
            console.log('     Missing in Railway:');
            constraintCompare.missing.forEach(c => console.log(`       - ${c.name} (${c.type})`));
          }
          if (constraintCompare.extra.length > 0) {
            console.log('     Extra in Railway:');
            constraintCompare.extra.forEach(c => console.log(`       - ${c.name} (${c.type})`));
          }
        }

        if (!fkCompare.match) {
          console.log('  ⚠️  Foreign Keys differ:');
          if (fkCompare.missing.length > 0) {
            console.log('     Missing in Railway:');
            fkCompare.missing.forEach(fk => console.log(`       - ${fk.name}: ${fk.column} -> ${fk.ref_table}.${fk.ref_column} (ON UPDATE ${fk.update_rule}, ON DELETE ${fk.delete_rule})`));
          }
          if (fkCompare.extra.length > 0) {
            console.log('     Extra in Railway:');
            fkCompare.extra.forEach(fk => console.log(`       - ${fk.name}: ${fk.column} -> ${fk.ref_table}.${fk.ref_column} (ON UPDATE ${fk.update_rule}, ON DELETE ${fk.delete_rule})`));
          }
        }

        if (!indexCompare.match) {
          console.log('  ⚠️  Indexes differ:');
          if (indexCompare.missing.length > 0) {
            console.log('     Missing in Railway:');
            indexCompare.missing.forEach(idx => console.log(`       - ${idx}`));
          }
          if (indexCompare.extra.length > 0) {
            console.log('     Extra in Railway:');
            indexCompare.extra.forEach(idx => console.log(`       - ${idx}`));
          }
        }

        if (defaultDifferences.length > 0) {
          console.log('  ⚠️  Column defaults differ:');
          defaultDifferences.forEach(diff => {
            console.log(`     ${diff.column}:`);
            console.log(`       Local: ${diff.local || 'NULL'}`);
            console.log(`       Railway: ${diff.railway || 'NULL'}`);
          });
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    if (totalIssues === 0) {
      console.log('✅ ALL TABLE SETTINGS MATCH!');
      console.log(`   All ${commonTables.length} tables have matching constraints, foreign keys, indexes, and defaults`);
    } else {
      console.log(`⚠️  FOUND ISSUES IN ${totalIssues} TABLE(S)`);
      console.log(`   Tables with differences: ${tablesWithIssues.join(', ')}`);
    }
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

compareAllTableSettings().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

