#!/usr/bin/env node

/**
 * Sync Table Settings to Railway
 * 
 * Syncs foreign key constraints, indexes, and column defaults from local to Railway
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
     AND indexname NOT LIKE '%_pkey'
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
      is_nullable,
      data_type
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

async function syncTableSettings() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔄 SYNCING TABLE SETTINGS TO RAILWAY\n');
    console.log('='.repeat(80));
    
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    const localTables = await getTables(localSequelize);
    const railwayTables = await getTables(railwaySequelize);
    const commonTables = localTables.filter(t => railwayTables.includes(t));
    
    console.log(`📊 Syncing settings for ${commonTables.length} tables...\n`);

    let fkUpdated = 0;
    let indexesAdded = 0;
    let defaultsUpdated = 0;
    let errors = [];

    for (const tableName of commonTables) {
      try {
        // 1. Sync Foreign Keys
        const localFKs = await getTableForeignKeys(localSequelize, tableName);
        const railwayFKs = await getTableForeignKeys(railwaySequelize, tableName);
        
        const localFKMap = new Map();
        localFKs.forEach(fk => {
          const key = `${fk.column_name}->${fk.foreign_table_name}.${fk.foreign_column_name}`;
          localFKMap.set(key, fk);
        });

        const railwayFKMap = new Map();
        railwayFKs.forEach(fk => {
          const key = `${fk.column_name}->${fk.foreign_table_name}.${fk.foreign_column_name}`;
          railwayFKMap.set(key, fk);
        });

        // Update or add missing foreign keys
        for (const [key, localFK] of localFKMap) {
          const railwayFK = railwayFKMap.get(key);
          
          if (!railwayFK) {
            // Add missing foreign key
            try {
              await railwaySequelize.query(`
                ALTER TABLE "${tableName}"
                ADD CONSTRAINT "${localFK.constraint_name}"
                FOREIGN KEY ("${localFK.column_name}")
                REFERENCES "${localFK.foreign_table_name}"("${localFK.foreign_column_name}")
                ON UPDATE ${localFK.update_rule}
                ON DELETE ${localFK.delete_rule};
              `);
              console.log(`   ✅ Added FK: ${tableName}.${localFK.constraint_name}`);
              fkUpdated++;
            } catch (error) {
              if (!error.message.includes('already exists')) {
                errors.push(`${tableName}.${localFK.constraint_name}: ${error.message}`);
              }
            }
          } else if (
            railwayFK.update_rule !== localFK.update_rule ||
            railwayFK.delete_rule !== localFK.delete_rule
          ) {
            // Update foreign key rules
            try {
              await railwaySequelize.query(`
                ALTER TABLE "${tableName}"
                DROP CONSTRAINT "${railwayFK.constraint_name}";
              `);
              await railwaySequelize.query(`
                ALTER TABLE "${tableName}"
                ADD CONSTRAINT "${localFK.constraint_name}"
                FOREIGN KEY ("${localFK.column_name}")
                REFERENCES "${localFK.foreign_table_name}"("${localFK.foreign_column_name}")
                ON UPDATE ${localFK.update_rule}
                ON DELETE ${localFK.delete_rule};
              `);
              console.log(`   ✅ Updated FK: ${tableName}.${localFK.constraint_name}`);
              fkUpdated++;
            } catch (error) {
              errors.push(`${tableName}.${localFK.constraint_name}: ${error.message}`);
            }
          }
        }

        // 2. Sync Indexes
        const localIndexes = await getTableIndexes(localSequelize, tableName);
        const railwayIndexes = await getTableIndexes(railwaySequelize, tableName);
        
        const railwayIndexNames = new Set(railwayIndexes.map(idx => idx.indexname));
        
        for (const localIdx of localIndexes) {
          // Check if equivalent index exists (by definition, not name)
          const indexExists = railwayIndexes.some(railIdx => 
            railIdx.indexdef.replace(/INDEX\s+\S+\s+/i, 'INDEX ').toLowerCase() === 
            localIdx.indexdef.replace(/INDEX\s+\S+\s+/i, 'INDEX ').toLowerCase()
          );

          if (!indexExists && !railwayIndexNames.has(localIdx.indexname)) {
            try {
              // Extract the index definition without the index name
              const indexDef = localIdx.indexdef.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+\S+\s+/i, 'CREATE $1INDEX ');
              await railwaySequelize.query(indexDef);
              console.log(`   ✅ Added index: ${tableName}.${localIdx.indexname}`);
              indexesAdded++;
            } catch (error) {
              if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
                errors.push(`${tableName}.${localIdx.indexname}: ${error.message}`);
              }
            }
          }
        }

        // 3. Sync Column Defaults
        const localColumns = await getTableColumns(localSequelize, tableName);
        const railwayColumns = await getTableColumns(railwaySequelize, tableName);
        
        const railwayColMap = new Map(railwayColumns.map(c => [c.column_name, c]));
        
        for (const localCol of localColumns) {
          const railwayCol = railwayColMap.get(localCol.column_name);
          
          if (railwayCol && localCol.column_default !== railwayCol.column_default) {
            try {
              let alterSQL;
              if (localCol.column_default === null || localCol.column_default === 'NULL') {
                alterSQL = `ALTER TABLE "${tableName}" ALTER COLUMN "${localCol.column_name}" DROP DEFAULT;`;
              } else {
                // Handle function defaults (like CURRENT_TIMESTAMP, gen_random_uuid())
                let defaultValue = localCol.column_default;
                if (defaultValue.includes('::')) {
                  defaultValue = defaultValue.split('::')[0].trim();
                }
                alterSQL = `ALTER TABLE "${tableName}" ALTER COLUMN "${localCol.column_name}" SET DEFAULT ${defaultValue};`;
              }
              
              await railwaySequelize.query(alterSQL);
              console.log(`   ✅ Updated default: ${tableName}.${localCol.column_name}`);
              defaultsUpdated++;
            } catch (error) {
              errors.push(`${tableName}.${localCol.column_name} default: ${error.message}`);
            }
          }
        }

      } catch (error) {
        errors.push(`${tableName}: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ SYNC COMPLETE!');
    console.log(`   Foreign keys updated/added: ${fkUpdated}`);
    console.log(`   Indexes added: ${indexesAdded}`);
    console.log(`   Column defaults updated: ${defaultsUpdated}`);
    if (errors.length > 0) {
      console.log(`   Errors: ${errors.length}`);
      console.log('\n⚠️  Errors encountered:');
      errors.slice(0, 10).forEach(err => console.log(`   - ${err}`));
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more`);
      }
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

syncTableSettings().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

