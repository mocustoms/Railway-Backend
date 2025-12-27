/**
 * Reset Migrations for Railway
 * 
 * This script clears SequelizeMeta so migrations can run fresh.
 * Use this ONLY if migrations were incorrectly marked as "run" without actually running.
 * 
 * WARNING: This will clear all migration records. Migrations will need to run again.
 */

const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');

async function resetMigrations() {
  try {
    console.log('\n🔄 Resetting Migrations for Fresh Run');
    console.log('='.repeat(60));
    
    // Test database connection
    try {
      await sequelize.authenticate();
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    }
    
    // Check if SequelizeMeta table exists
    const [tableExists] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SequelizeMeta'
      );
    `);
    
    if (!tableExists[0]?.exists) {
      console.log('\n✅ SequelizeMeta table does not exist - nothing to reset');
      process.exit(0);
    }
    
    // Get count of migrations before clearing
    const [countResult] = await sequelize.query(
      'SELECT COUNT(*) as count FROM "SequelizeMeta"'
    );
    const count = countResult[0]?.count || 0;
    
    console.log(`\n📊 Found ${count} migration(s) recorded in SequelizeMeta`);
    
    if (count === 0) {
      console.log('✅ SequelizeMeta is already empty - nothing to reset');
      process.exit(0);
    }
    
    // Clear all migrations
    await sequelize.query('TRUNCATE TABLE "SequelizeMeta";');
    console.log(`\n✅ Cleared ${count} migration record(s) from SequelizeMeta`);
    console.log('   Migrations will now run fresh on next deployment');
    
    // Close connection
    await sequelize.close();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Reset Complete!');
    console.log('='.repeat(60));
    console.log('\n💡 Next steps:');
    console.log('   1. Redeploy on Railway (or run: npm run migrate)');
    console.log('   2. All migrations will run fresh');
    console.log('   3. Database tables will be created properly');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error resetting migrations:', error.message);
    console.error('   Details:', error);
    process.exit(1);
  }
}

// Run reset
resetMigrations();

