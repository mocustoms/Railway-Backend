const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo',
  {
    logging: false
  }
);

async function checkConstraints() {
  try {
    // Check sales_invoices constraints
    const [salesInvoiceConstraints] = await sequelize.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'sales_invoices'::regclass 
        AND contype = 'u'
      ORDER BY conname;
    `);

    console.log('\n📋 SALES_INVOICES UNIQUE CONSTRAINTS:');
    console.log('='.repeat(80));
    salesInvoiceConstraints.forEach(c => {
      console.log(`\nConstraint: ${c.constraint_name}`);
      console.log(`Definition: ${c.definition}`);
    });

    // Check indexes
    const [salesInvoiceIndexes] = await sequelize.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename = 'sales_invoices'
        AND indexdef LIKE '%UNIQUE%'
      ORDER BY indexname;
    `);

    console.log('\n\n📋 SALES_INVOICES UNIQUE INDEXES:');
    console.log('='.repeat(80));
    salesInvoiceIndexes.forEach(idx => {
      console.log(`\nIndex: ${idx.indexname}`);
      console.log(`Definition: ${idx.indexdef}`);
    });

    // Check if there are conflicting constraints
    const hasGlobalConstraint = salesInvoiceConstraints.some(c => 
      c.definition.includes('invoice_ref_number') && 
      !c.definition.includes('companyId') &&
      !c.definition.includes('company_id')
    );
    
    const hasCompositeIndex = salesInvoiceIndexes.some(idx => 
      idx.indexdef.includes('invoice_ref_number') && 
      (idx.indexdef.includes('companyId') || idx.indexdef.includes('company_id'))
    );

    console.log('\n\n🔍 ANALYSIS:');
    console.log('='.repeat(80));
    console.log(`Has Global Constraint (without companyId): ${hasGlobalConstraint ? '❌ YES' : '✅ NO'}`);
    console.log(`Has Composite Index (with companyId): ${hasCompositeIndex ? '✅ YES' : '❌ NO'}`);
    
    if (hasGlobalConstraint && hasCompositeIndex) {
      console.log('\n⚠️  CONFLICT DETECTED: Both global constraint and composite index exist!');
      console.log('   This prevents multi-tenant uniqueness.');
    }

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

checkConstraints();

