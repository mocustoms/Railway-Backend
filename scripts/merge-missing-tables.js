/**
 * Merge account_types and exchange_rates into initial-company-data.json
 */

const fs = require('fs');
const path = require('path');

const INITIAL_DATA_FILE = path.join(__dirname, '../data/initial-company-data.json');
const MISSING_DATA_FILE = path.join(__dirname, '../data/missing-tables-data.json');

// Read both files
const initialData = JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf8'));
const missingData = JSON.parse(fs.readFileSync(MISSING_DATA_FILE, 'utf8'));

// Merge account_types and exchange_rates into initial data
initialData.tables.account_types = missingData.account_types;
initialData.tables.exchange_rates = missingData.exchange_rates;

// Update exportedAt timestamp
initialData.exportedAt = new Date().toISOString();

// Write back to file
fs.writeFileSync(INITIAL_DATA_FILE, JSON.stringify(initialData, null, 2));

console.log('✅ Successfully merged missing tables into initial-company-data.json');
console.log(`   Added ${missingData.account_types.length} account types`);
console.log(`   Added ${missingData.exchange_rates.length} exchange rates`);
console.log(`\n📊 Updated initial data now contains:`);
Object.entries(initialData.tables).forEach(([table, records]) => {
  console.log(`   ${table}: ${records.length} records`);
});

