const sequelize = require('../config/database');

(async () => {
  try {
    console.log('Checking proforma_invoices constraints...\n');
    
    // Check indexes/constraints
    const [indexes] = await sequelize.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'proforma_invoices' 
      AND indexname LIKE '%proforma_ref_number%'
    `);
    
    console.log('Indexes/Constraints on proforma_ref_number:');
    if (indexes.length === 0) {
      console.log('  ⚠️  No indexes found!');
    } else {
      indexes.forEach(idx => {
        console.log(`  - ${idx.indexname}`);
        console.log(`    ${idx.indexdef}`);
        console.log('');
      });
    }
    
    // Check constraints directly
    const [constraints] = await sequelize.query(`
      SELECT 
        conname as constraint_name,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'proforma_invoices'::regclass
      AND conname LIKE '%proforma_ref_number%'
    `);
    
    console.log('Constraints on proforma_invoices:');
    if (constraints.length === 0) {
      console.log('  ⚠️  No constraints found!');
    } else {
      constraints.forEach(con => {
        console.log(`  - ${con.constraint_name}`);
        console.log(`    ${con.constraint_definition}`);
        console.log('');
      });
    }
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();

