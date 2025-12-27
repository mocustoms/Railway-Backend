/**
 * Script to check if receipts table has the correct unique constraint
 */

const { Pool } = require('pg');
const config = require('./env');

async function checkConstraint() {
  const pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD
  });

  try {
    console.log('Checking receipts table constraints...\n');

    // Check for unique constraint on (receipt_reference_number, companyId)
    const constraintResult = await pool.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'receipts'::regclass 
      AND conname LIKE '%receipt_reference_number%'
      ORDER BY conname;
    `);

    console.log('Found constraints:');
    if (constraintResult.rows.length === 0) {
      console.log('  ❌ No unique constraint found on receipt_reference_number!');
    } else {
      constraintResult.rows.forEach(row => {
        console.log(`  ✅ ${row.constraint_name}: ${row.definition}`);
      });
    }

    // Check for any duplicate (receipt_reference_number, companyId) combinations
    const duplicatesResult = await pool.query(`
      SELECT 
        receipt_reference_number, 
        "companyId", 
        COUNT(*) as count
      FROM receipts
      GROUP BY receipt_reference_number, "companyId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10;
    `);

    console.log('\nDuplicate (receipt_reference_number, companyId) combinations:');
    if (duplicatesResult.rows.length === 0) {
      console.log('  ✅ No duplicates found');
    } else {
      console.log(`  ⚠️  Found ${duplicatesResult.rows.length} duplicate(s):`);
      duplicatesResult.rows.forEach(row => {
        console.log(`     - ${row.receipt_reference_number} / ${row.companyId}: ${row.count} entries`);
      });
    }

    // Check total receipts count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM receipts;');
    console.log(`\nTotal receipts in database: ${countResult.rows[0].total}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkConstraint();

