const sequelize = require('../config/database');

(async () => {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🔧 Fixing proforma_invoices unique constraint...\n');
    
    // Step 1: Drop all existing unique constraints/indexes on proforma_ref_number
    console.log('Step 1: Dropping old global unique constraints...');
    
    // First, get all indexes/constraints to drop (exclude composite constraint)
    const [allIndexes] = await sequelize.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'proforma_invoices' 
      AND indexname LIKE '%proforma_ref_number%'
      AND indexname NOT LIKE '%companyId%'
      AND indexname != 'proforma_invoices_proforma_ref_number_companyId_unique'
      AND indexname != 'proforma_invoices_proforma_ref_number_companyid_unique'
    `, { transaction });
    
    const constraintsToDrop = [
      'proforma_invoices_proforma_ref_number_key',
      'proforma_invoices_proforma_ref_number'
    ];
    
    // Add any other indexes found
    allIndexes.forEach(idx => {
      if (!constraintsToDrop.includes(idx.indexname)) {
        constraintsToDrop.push(idx.indexname);
      }
    });
    
    for (const constraintName of constraintsToDrop) {
      try {
        // Try dropping as constraint first
        await sequelize.query(
          `ALTER TABLE proforma_invoices DROP CONSTRAINT IF EXISTS "${constraintName}" CASCADE`,
          { transaction }
        );
        console.log(`  ✅ Dropped constraint: ${constraintName}`);
      } catch (error) {
        if (!error.message.includes('does not exist')) {
          // Try dropping as index
          try {
            await sequelize.query(
              `DROP INDEX IF EXISTS "${constraintName}" CASCADE`,
              { transaction }
            );
            console.log(`  ✅ Dropped index: ${constraintName}`);
          } catch (indexError) {
            if (!indexError.message.includes('does not exist')) {
              console.log(`  ⚠️  Could not drop ${constraintName}: ${indexError.message}`);
            }
          }
        }
      }
    }
    
    // Step 2: Check if composite constraint already exists
    console.log('\nStep 2: Checking for existing composite constraint...');
    const [existingComposite] = await sequelize.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'proforma_invoices' 
      AND (indexname = 'proforma_invoices_proforma_ref_number_companyId_unique' 
           OR indexname = 'proforma_invoices_proforma_ref_number_companyid_unique')
    `, { transaction });
    
    if (existingComposite.length > 0) {
      console.log('  ✅ Composite constraint already exists');
    } else {
      // Step 3: Create composite unique constraint
      console.log('\nStep 3: Creating composite unique constraint...');
      try {
        await sequelize.query(`
          CREATE UNIQUE INDEX proforma_invoices_proforma_ref_number_companyId_unique 
          ON proforma_invoices (proforma_ref_number, "companyId")
        `, { transaction });
        console.log('  ✅ Created composite unique constraint');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('  ✅ Composite constraint already exists (different case)');
        } else {
          throw error;
        }
      }
    }
    
    await transaction.commit();
    console.log('\n✅ Successfully fixed proforma_invoices unique constraint!');
    
    // Verify
    console.log('\nVerifying constraints...');
    const [indexes] = await sequelize.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'proforma_invoices' 
      AND indexname LIKE '%proforma_ref_number%'
    `);
    
    console.log('\nCurrent constraints:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
      console.log(`    ${idx.indexdef}`);
    });
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    await transaction.rollback();
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await sequelize.close();
    process.exit(1);
  }
})();

