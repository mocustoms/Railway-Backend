#!/usr/bin/env node

/**
 * Diagnose Physical Inventory Approval Issue
 * 
 * Compares local vs Railway for physical_inventories table constraints
 * Usage: node scripts/diagnose-physical-inventory-approval.js [railway-database-url]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');
const config = require('../env');

// Parse DATABASE_URL
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  
  try {
    let normalizedUrl = databaseUrl.trim();
    if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
    }
    
    normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
    const url = new URL(normalizedUrl);
    
    const databaseName = url.pathname ? url.pathname.slice(1) : '';
    if (!databaseName) {
      throw new Error('Database name not found in DATABASE_URL');
    }
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: databaseName,
      username: url.username || 'postgres',
      password: url.password || ''
    };
  } catch (error) {
    throw new Error(`Failed to parse DATABASE_URL: ${error.message}`);
  }
}

// Get table constraints
async function getTableConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns,
      ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = :tableName
    GROUP BY tc.constraint_name, tc.constraint_type, ccu.table_name
    ORDER BY tc.constraint_type, tc.constraint_name;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(constraints) ? constraints : [];
}

// Get table indexes
async function getTableIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(`
    SELECT
      i.indexname,
      i.indexdef,
      idx.indisunique as is_unique,
      idx.indisprimary as is_primary
    FROM pg_indexes i
    JOIN pg_index idx ON i.indexname = (
      SELECT relname FROM pg_class WHERE oid = idx.indexrelid
    )
    WHERE i.schemaname = 'public' 
      AND i.tablename = :tableName
    ORDER BY i.indexname;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(indexes) ? indexes : [];
}

// Get table columns
async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(`
    SELECT 
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = :tableName
    ORDER BY ordinal_position;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(columns) ? columns : [];
}

// Test updating a physical inventory
async function testPhysicalInventoryUpdate(sequelize, testData) {
  try {
    // First, find a submitted inventory
    const [inventory] = await sequelize.query(`
      SELECT id, status, reference_number 
      FROM physical_inventories 
      WHERE status = 'submitted'
      LIMIT 1;
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    if (!inventory) {
      return { success: false, error: 'No submitted physical inventory found for testing' };
    }
    
    // Try to update status to approved
    const [result] = await sequelize.query(`
      UPDATE physical_inventories 
      SET 
        status = :status,
        approved_by = :approved_by,
        approved_at = :approved_at,
        approval_notes = :approval_notes
      WHERE id = :id
      RETURNING id, status, approved_by, approved_at;
    `, {
      replacements: {
        id: inventory.id,
        status: 'approved',
        approved_by: testData.approved_by,
        approved_at: new Date(),
        approval_notes: testData.approval_notes || null
      },
      type: sequelize.QueryTypes.SELECT
    });
    
    if (result && result.length > 0) {
      // Rollback the test update
      await sequelize.query(`
        UPDATE physical_inventories 
        SET 
          status = 'submitted',
          approved_by = NULL,
          approved_at = NULL,
          approval_notes = NULL
        WHERE id = :id;
      `, {
        replacements: { id: inventory.id },
        type: sequelize.QueryTypes.RAW
      });
      
      return { success: true, result: result[0] };
    }
    
    return { success: false, error: 'Update returned no rows' };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
}

// Main function
async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Error: Railway DATABASE_URL is required');
    console.error('');
    console.error('Usage: node scripts/diagnose-physical-inventory-approval.js <railway-database-url>');
    process.exit(1);
  }
  
  // Parse Railway config
  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayDbUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
  
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Physical Inventory Approval Diagnostic                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Local Database:');
  console.log(`  Host: ${config.DB_HOST}:${config.DB_PORT}`);
  console.log(`  Database: ${config.DB_NAME}`);
  console.log('');
  console.log('Railway Database:');
  console.log(`  Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`  Database: ${railwayConfig.database}`);
  console.log('');
  
  // Create connections
  const localSequelize = require('../config/database');
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  
  try {
    // Test connections
    console.log('🔄 Connecting to databases...');
    await localSequelize.authenticate();
    console.log('✅ Connected to local database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database');
    console.log('');
    
    // Compare constraints
    console.log('═'.repeat(80));
    console.log('🔗 Comparing Constraints');
    console.log('═'.repeat(80));
    console.log('');
    
    const localConstraints = await getTableConstraints(localSequelize, 'physical_inventories');
    const railwayConstraints = await getTableConstraints(railwaySequelize, 'physical_inventories');
    
    console.log(`Local: ${localConstraints.length} constraints`);
    localConstraints.forEach(c => {
      const fkInfo = c.foreign_table_name ? ` -> ${c.foreign_table_name}` : '';
      console.log(`  - ${c.constraint_name} (${c.constraint_type}): [${c.columns}]${fkInfo}`);
    });
    console.log('');
    
    console.log(`Railway: ${railwayConstraints.length} constraints`);
    railwayConstraints.forEach(c => {
      const fkInfo = c.foreign_table_name ? ` -> ${c.foreign_table_name}` : '';
      console.log(`  - ${c.constraint_name} (${c.constraint_type}): [${c.columns}]${fkInfo}`);
    });
    console.log('');
    
    // Compare indexes
    console.log('═'.repeat(80));
    console.log('📑 Comparing Indexes');
    console.log('═'.repeat(80));
    console.log('');
    
    const localIndexes = await getTableIndexes(localSequelize, 'physical_inventories');
    const railwayIndexes = await getTableIndexes(railwaySequelize, 'physical_inventories');
    
    console.log(`Local: ${localIndexes.length} indexes`);
    localIndexes.forEach(idx => {
      const unique = idx.is_unique ? 'UNIQUE ' : '';
      console.log(`  - ${unique}${idx.indexname}`);
    });
    console.log('');
    
    console.log(`Railway: ${railwayIndexes.length} indexes`);
    railwayIndexes.forEach(idx => {
      const unique = idx.is_unique ? 'UNIQUE ' : '';
      console.log(`  - ${unique}${idx.indexname}`);
    });
    console.log('');
    
    // Check for problematic unique constraints
    const localUniqueConstraints = localIndexes.filter(idx => 
      idx.is_unique && 
      (idx.indexdef.includes('reference_number') || 
       idx.indexdef.includes('status') ||
       idx.indexdef.includes('approved_by'))
    );
    
    const railwayUniqueConstraints = railwayIndexes.filter(idx => 
      idx.is_unique && 
      (idx.indexdef.includes('reference_number') || 
       idx.indexdef.includes('status') ||
       idx.indexdef.includes('approved_by'))
    );
    
    console.log('═'.repeat(80));
    console.log('🔍 Critical Unique Constraint Check');
    console.log('═'.repeat(80));
    console.log('');
    
    // Check for status or approved_by unique constraints (these would block approval)
    const problematicRailway = railwayIndexes.filter(idx => 
      idx.is_unique && 
      (idx.indexdef.includes('status') || idx.indexdef.includes('approved_by'))
    );
    
    if (problematicRailway.length > 0) {
      console.log('❌ Railway has problematic unique constraints that would block approval:');
      problematicRailway.forEach(idx => {
        console.log(`   - ${idx.indexname}: ${idx.indexdef.substring(0, 100)}...`);
      });
    } else {
      console.log('✅ No problematic unique constraints on status or approved_by');
    }
    console.log('');
    
    // Compare columns related to approval
    console.log('═'.repeat(80));
    console.log('📋 Comparing Approval-Related Columns');
    console.log('═'.repeat(80));
    console.log('');
    
    const localColumns = await getTableColumns(localSequelize, 'physical_inventories');
    const railwayColumns = await getTableColumns(railwaySequelize, 'physical_inventories');
    
    const approvalColumns = ['status', 'approved_by', 'approved_at', 'approval_notes'];
    
    approvalColumns.forEach(colName => {
      const localCol = localColumns.find(c => c.column_name === colName);
      const railwayCol = railwayColumns.find(c => c.column_name === colName);
      
      if (localCol && railwayCol) {
        const localStr = `${localCol.data_type} ${localCol.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`;
        const railwayStr = `${railwayCol.data_type} ${railwayCol.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`;
        
        if (localStr !== railwayStr) {
          console.log(`⚠️  ${colName} differs:`);
          console.log(`   Local:   ${localStr}`);
          console.log(`   Railway: ${railwayStr}`);
        } else {
          console.log(`✅ ${colName}: ${localStr}`);
        }
      } else if (localCol && !railwayCol) {
        console.log(`❌ ${colName} missing in Railway`);
      } else if (!localCol && railwayCol) {
        console.log(`⚠️  ${colName} exists only in Railway`);
      }
    });
    console.log('');
    
    // Test approval update on Railway
    console.log('═'.repeat(80));
    console.log('🧪 Testing Physical Inventory Approval Update on Railway');
    console.log('═'.repeat(80));
    console.log('');
    
    // Get a sample user ID
    const [sampleUser] = await railwaySequelize.query(
      `SELECT id FROM users LIMIT 1;`,
      { type: railwaySequelize.QueryTypes.SELECT }
    );
    
    if (sampleUser) {
      const testResult = await testPhysicalInventoryUpdate(railwaySequelize, {
        approved_by: sampleUser.id,
        approval_notes: 'Test approval'
      });
      
      if (testResult.success) {
        console.log('✅ Test approval update SUCCESSFUL!');
        console.log(`   Updated inventory: ${testResult.result.id}`);
        console.log(`   Status: ${testResult.result.status}`);
        console.log(`   Approved by: ${testResult.result.approved_by}`);
      } else {
        console.log('❌ Test approval update FAILED!');
        console.log(`   Error: ${testResult.error}`);
        console.log(`   Code: ${testResult.code || 'N/A'}`);
      }
    } else {
      console.log('⚠️  No users found in Railway database for testing');
    }
    console.log('');
    
    console.log('═'.repeat(80));
    console.log('✅ Diagnostic Complete!');
    console.log('═'.repeat(80));
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ ERROR:');
    console.error('='.repeat(80));
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    console.error('');
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

// Run
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

