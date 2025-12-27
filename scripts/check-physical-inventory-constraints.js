#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

function parseDatabaseUrl(databaseUrl) {
  let normalizedUrl = databaseUrl.trim().replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalizedUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    username: url.username || 'postgres',
    password: url.password || ''
  };
}

async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
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
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway\n');
    
    // Check for CHECK constraints
    const checkConstraints = await railwaySequelize.query(`
      SELECT 
        conname as constraint_name,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = (
        SELECT oid FROM pg_class WHERE relname = 'physical_inventories'
      )
      AND contype = 'c'
      ORDER BY conname;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('🔍 CHECK Constraints');
    console.log('═'.repeat(80));
    console.log('');
    
    if (checkConstraints && checkConstraints.length > 0) {
      checkConstraints.forEach(c => {
        console.log(`  ${c.constraint_name}:`);
        console.log(`    ${c.constraint_definition}`);
        console.log('');
      });
    } else {
      console.log('  No CHECK constraints found');
      console.log('');
    }
    
    // Check for triggers
    const triggers = await railwaySequelize.query(`
      SELECT 
        trigger_name,
        event_manipulation,
        action_statement,
        action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'physical_inventories'
      ORDER BY trigger_name;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('🔔 Triggers');
    console.log('═'.repeat(80));
    console.log('');
    
    if (triggers && triggers.length > 0) {
      triggers.forEach(t => {
        console.log(`  ${t.trigger_name}:`);
        console.log(`    Event: ${t.event_manipulation}`);
        console.log(`    Timing: ${t.action_timing}`);
        console.log(`    Statement: ${t.action_statement.substring(0, 100)}...`);
        console.log('');
      });
    } else {
      console.log('  No triggers found');
      console.log('');
    }
    
    // Check for unique constraints that might be problematic
    const uniqueConstraints = await railwaySequelize.query(`
      SELECT
        i.indexname,
        i.indexdef,
        idx.indisunique as is_unique
      FROM pg_indexes i
      JOIN pg_index idx ON i.indexname = (
        SELECT relname FROM pg_class WHERE oid = idx.indexrelid
      )
      WHERE i.schemaname = 'public' 
        AND i.tablename = 'physical_inventories'
        AND idx.indisunique = true
      ORDER BY i.indexname;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('🔐 Unique Constraints/Indexes');
    console.log('═'.repeat(80));
    console.log('');
    
    if (uniqueConstraints && uniqueConstraints.length > 0) {
      uniqueConstraints.forEach(u => {
        console.log(`  ${u.indexname}:`);
        console.log(`    ${u.indexdef.substring(0, 150)}...`);
        console.log('');
        
        // Check if it's problematic (unique on status or approved_by)
        if (u.indexdef.includes('status') || u.indexdef.includes('approved_by')) {
          console.log('    ⚠️  WARNING: This unique constraint might block approval!');
          console.log('');
        }
      });
    } else {
      console.log('  No unique constraints found');
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

main().catch(console.error);

