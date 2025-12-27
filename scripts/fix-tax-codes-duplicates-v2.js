#!/usr/bin/env node

/**
 * Fix duplicate IDs in tax_codes table using ctid
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const railwayDbConfig = require('../config/railway-db');

const railwaySequelize = railwayDbConfig.createRailwaySequelize();

async function main() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
    
    // Find duplicate IDs with ctid
    const duplicates = await railwaySequelize.query(`
      SELECT id, COUNT(*) as count
      FROM tax_codes
      GROUP BY id
      HAVING COUNT(*) > 1;
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`Found ${duplicates.length} duplicate ID(s):\n`);
    
    for (const dup of duplicates) {
      console.log(`Duplicate ID: ${dup.id} (appears ${dup.count} times)`);
      
      // Get all records with this ID including ctid (physical row identifier)
      const records = await railwaySequelize.query(`
        SELECT ctid, id, code, name, "companyId", created_at
        FROM tax_codes
        WHERE id = :duplicateId
        ORDER BY created_at;
      `, {
        replacements: { duplicateId: dup.id },
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      console.log(`  Found ${records.length} record(s) with this ID:`);
      records.forEach((record, index) => {
        console.log(`    ${index + 1}. CTID: ${record.ctid}, Code: ${record.code}, Name: ${record.name}, Company: ${record.companyId}`);
      });
      
      // Keep the first record, update the rest with new UUIDs using ctid
      if (records.length > 1) {
        const recordsToFix = records.slice(1);
        console.log(`\n  Fixing ${recordsToFix.length} duplicate(s)...`);
        
        for (const record of recordsToFix) {
          const newId = uuidv4();
          console.log(`    Updating record at CTID ${record.ctid} (${record.code}) → ${newId}`);
          
          // Use ctid to update the specific row
          await railwaySequelize.query(`
            UPDATE tax_codes
            SET id = :newId
            WHERE ctid = :ctid;
          `, {
            replacements: {
              newId,
              ctid: record.ctid
            }
          });
        }
      }
    }
    
    // Verify no more duplicates
    const [verify] = await railwaySequelize.query(`
      SELECT COUNT(*) as total, COUNT(DISTINCT id) as distinct_count
      FROM tax_codes;
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`\n✅ Verification:`);
    console.log(`   Total records: ${verify.total}`);
    console.log(`   Distinct IDs: ${verify.distinct_count}`);
    
    if (verify.total === verify.distinct_count) {
      console.log(`\n✅ All duplicates fixed! Now you can add the primary key.`);
    } else {
      console.log(`\n⚠️  Still have duplicates. Please review manually.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await railwaySequelize.close();
  }
}

main();

