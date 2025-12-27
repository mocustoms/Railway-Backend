const sequelize = require('../config/database');

(async () => {
  try {
    console.log('Force dropping remaining global unique index...\n');
    
    // Drop the remaining global index
    await sequelize.query(`
      DROP INDEX IF EXISTS proforma_invoices_proforma_ref_number CASCADE
    `);
    console.log('✅ Dropped proforma_invoices_proforma_ref_number index');
    
    // Verify
    const [indexes] = await sequelize.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'proforma_invoices' 
      AND indexname LIKE '%proforma_ref_number%'
    `);
    
    console.log('\nRemaining constraints:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
      console.log(`    ${idx.indexdef}`);
    });
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    await sequelize.close();
    process.exit(1);
  }
})();

