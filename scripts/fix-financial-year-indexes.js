/**
 * Script to fix financial_years unique indexes
 * Drops global unique indexes on 'name' and creates composite unique index on ['name', 'companyId']
 */

const sequelize = require('../config/database');

async function fixFinancialYearIndexes() {
  const transaction = await sequelize.transaction();
  try {
    console.log('🔧 Fixing financial_years unique indexes...');
    
    // Drop the old unique indexes on name only
    const indexesToDrop = [
      'financial_years_name',
      'financial_years_name_key'
    ];
    
    for (const indexName of indexesToDrop) {
      try {
        console.log(`Dropping old unique index: ${indexName}`);
        await sequelize.query(
          `DROP INDEX IF EXISTS "${indexName}" CASCADE`,
          { transaction }
        );
        console.log(`✅ Dropped index: ${indexName}`);
      } catch (e) {
        if (!e.message.includes('does not exist')) {
          console.warn(`Warning dropping index ${indexName}:`, e.message);
        }
      }
    }
    
    // Check if composite index already exists
    const [existingIndexes] = await sequelize.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'financial_years' 
      AND indexname = 'financial_years_name_companyId_unique'
    `, { transaction });
    
    if (existingIndexes && existingIndexes.length > 0) {
      console.log('✅ Composite unique index already exists');
    } else {
      // Add new composite unique index on name and companyId
      console.log('Creating composite unique index on name and companyId...');
      await sequelize.query(`
        CREATE UNIQUE INDEX "financial_years_name_companyId_unique" 
        ON "financial_years" (name, "companyId")
      `, { transaction });
      console.log('✅ Created composite unique index');
    }
    
    await transaction.commit();
    console.log('✅ Successfully fixed financial_years unique indexes');
    
    // Verify the fix
    const [indexes] = await sequelize.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'financial_years' 
      AND indexname LIKE '%name%'
      ORDER BY indexname
    `);
    
    console.log('\n📊 Current name-related indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.indexname}: ${idx.indexdef}`);
    });
    
    process.exit(0);
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error fixing financial_years unique indexes:', error);
    process.exit(1);
  }
}

fixFinancialYearIndexes();

