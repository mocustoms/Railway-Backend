/**
 * Add _originalId to payment_methods in initial-company-data.json
 * by looking up the IDs from the database based on codes
 */

const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

const SOURCE_COMPANY_ID = '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';
const INITIAL_DATA_FILE = path.join(__dirname, '../data/initial-company-data.json');

async function addPaymentMethodIds() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    // Read initial data
    const initialData = JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf8'));
    
    if (!initialData.tables.payment_methods || initialData.tables.payment_methods.length === 0) {
      console.log('No payment methods in initial data');
      return;
    }

    console.log(`📦 Found ${initialData.tables.payment_methods.length} payment methods in initial data\n`);

    // Get payment methods from database
    const dbPaymentMethods = await sequelize.query(`
      SELECT id, code, name
      FROM payment_methods
      WHERE "companyId" = :companyId
      ORDER BY code
    `, {
      replacements: { companyId: SOURCE_COMPANY_ID },
      type: QueryTypes.SELECT
    });

    console.log(`📦 Found ${dbPaymentMethods.length} payment methods in database\n`);

    // Create a map of code -> id
    const codeToIdMap = new Map();
    dbPaymentMethods.forEach(pm => {
      if (pm.code) {
        codeToIdMap.set(pm.code, pm.id);
      }
    });

    // Update payment methods in initial data with _originalId
    let updated = 0;
    initialData.tables.payment_methods.forEach((pm, index) => {
      if (pm.code && codeToIdMap.has(pm.code)) {
        const originalId = codeToIdMap.get(pm.code);
        if (!pm._originalId) {
          initialData.tables.payment_methods[index]._originalId = originalId;
          updated++;
          console.log(`  ✅ Added _originalId to ${pm.name} (${pm.code}): ${originalId}`);
        } else {
          console.log(`  ℹ️  ${pm.name} (${pm.code}) already has _originalId: ${pm._originalId}`);
        }
      } else {
        console.log(`  ⚠️  Could not find ID for ${pm.name} (${pm.code || 'no code'})`);
      }
    });

    // Write back to file
    fs.writeFileSync(INITIAL_DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log(`\n✅ Updated ${updated} payment methods with _originalId`);
    console.log(`   File saved to: ${INITIAL_DATA_FILE}`);

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addPaymentMethodIds();

