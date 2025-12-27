const data = require('../data/initial-company-data.json');

console.log('📊 Initial Data Summary:\n');
console.log('Version:', data.version);
console.log('Exported:', data.exportedAt);
console.log('Source Company ID:', data.sourceCompanyId);
console.log('\n📋 Tables and Record Counts:\n');

Object.entries(data.tables).forEach(([table, records]) => {
  console.log(`  ${table}: ${records.length} records`);
});

console.log('\n📝 Key Observations:\n');
console.log(`  • Accounts: ${data.tables.accounts.length} records (with accountTypeId references)`);
console.log(`  • Financial Years: ${data.tables.financial_years.length} record (2025)`);
console.log('  • Account Types: NOT in data (referenced by accounts)');
console.log('  • Exchange Rates: NOT in data (referenced by currencies)');
console.log('  • Stores reference currencies and price_categories');
console.log('  • Customer groups reference accounts');
console.log('  • Product categories reference tax_codes and accounts');
console.log('  • Tax codes reference accounts');
console.log('  • Adjustment/Return reasons reference accounts');
console.log('  • Payment types reference payment_methods and accounts');

console.log('\n🔍 Sample Account Data (first 3):\n');
data.tables.accounts.slice(0, 3).forEach((acc, idx) => {
  console.log(`  ${idx + 1}. ${acc.name} (${acc.code})`);
  console.log(`     Type: ${acc.type}, AccountTypeId: ${acc.accountTypeId}, ParentId: ${acc.parentId || 'null'}`);
});

console.log('\n🔍 Account Type IDs referenced:\n');
const accountTypeIds = new Set(data.tables.accounts.map(a => a.accountTypeId).filter(Boolean));
accountTypeIds.forEach(id => console.log(`  - ${id}`));

console.log('\n🔍 Currency IDs referenced in stores:\n');
const currencyIds = new Set(data.tables.stores.map(s => s.default_currency_id).filter(Boolean));
currencyIds.forEach(id => console.log(`  - ${id}`));

console.log('\n🔍 Price Category IDs referenced in stores:\n');
const priceCategoryIds = new Set(data.tables.stores.map(s => s.default_price_category_id).filter(Boolean));
priceCategoryIds.forEach(id => console.log(`  - ${id}`));

