#!/usr/bin/env node

/**
 * Fix duplicate IDs in tax_codes table
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const railwayDbConfig = require('../config/railway-db');

const railwaySequelize = railwayDbConfig.createRailwaySequelize();

async function main() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
    
    // Find duplicate IDs
    const duplicates = await railwaySequelize.query(`
      SELECT id, COUNT(*) as count
      FROM tax_codes
      GROUP BY id
      HAVING COUNT(*) > 1;
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`Found ${duplicates.length} duplicate ID(s):\n`);
    
    for (const dup of duplicates) {
      console.log(`Duplicate ID: ${dup.id} (appears ${dup.count} times)`);
      
      // Get all records with this ID (using array format)
      const [records] = await railwaySequelize.query(`
        SELECT id, code, name, "companyId", created_at
        FROM tax_codes
        WHERE id = :duplicateId
        ORDER BY created_at;
      `, {
        replacements: { duplicateId: dup.id },
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      const recordsArray = Array.isArray(records) ? records : [records];
      
      console.log(`  Records with this ID:`);
      recordsArray.forEach((record, index) => {
        console.log(`    ${index + 1}. Code: ${record.code}, Name: ${record.name}, Company: ${record.companyId}`);
      });
      
      // Keep the first record, update the rest with new UUIDs
      if (recordsArray.length > 1) {
        const recordsToFix = recordsArray.slice(1);
        console.log(`\n  Fixing ${recordsToFix.length} duplicate(s)...`);
        
        for (const record of recordsToFix) {
          const newId = uuidv4();
          console.log(`    Updating record ${record.code} (${record.id}) → ${newId}`);
          
          // Use a more specific WHERE clause with companyId to ensure we update the right record
          await railwaySequelize.query(`
            UPDATE tax_codes
            SET id = :newId
            WHERE id = :oldId
            AND code = :code
            AND "companyId" = :companyId;
          `, {
            replacements: {
              newId,
              oldId: record.id,
              code: record.code,
              companyId: record.companyId
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

