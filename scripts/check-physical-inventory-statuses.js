#!/usr/bin/env node

/**
 * Check Physical Inventory Statuses on Railway
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

const railwayUrl = process.env.RAILWAY_DATABASE_URL || 'postgresql://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';

const railwaySequelize = new Sequelize(railwayUrl, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

async function checkStatuses() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');

    // Get all physical inventories with their statuses
    const inventories = await railwaySequelize.query(`
      SELECT 
        id,
        reference_number,
        status,
        store_id,
        "companyId",
        created_at,
        updated_at
      FROM physical_inventories 
      ORDER BY created_at DESC
      LIMIT 10;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log(`📋 Found ${inventories.length} physical inventories:\n`);
    
    for (const inv of inventories) {
      console.log(`   Reference: ${inv.reference_number}`);
      console.log(`   Status: ${inv.status}`);
      console.log(`   ID: ${inv.id}`);
      console.log(`   Created: ${inv.created_at}`);
      console.log('');
    }

    // Check status distribution
    const statusCounts = await railwaySequelize.query(`
      SELECT status, COUNT(*) as count
      FROM physical_inventories
      GROUP BY status
      ORDER BY count DESC;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });

    console.log('📊 Status Distribution:');
    for (const stat of statusCounts) {
      console.log(`   ${stat.status}: ${stat.count}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await railwaySequelize.close();
  }
}

checkStatuses();

