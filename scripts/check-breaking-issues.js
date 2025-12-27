#!/usr/bin/env node

/**
 * Check What Will Actually Break
 * 
 * Tests if the mismatches found by verification will actually cause runtime errors
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function checkBreakingIssues() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    console.log('🔍 CHECKING WHAT WILL ACTUALLY BREAK\n');
    console.log('='.repeat(80));
    
    // Check missing tables
    console.log('\n1. MISSING TABLES (WILL BREAK):');
    console.log('-'.repeat(80));
    const missingTables = ['loyalty_cards', 'loyalty_card_configs', 'loyalty_transactions'];
    
    for (const table of missingTables) {
      const [result] = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = :tableName
        );
      `, {
        replacements: { tableName: table },
        type: QueryTypes.SELECT
      });
      
      if (!result.exists) {
        console.log(`❌ ${table} - MISSING (Routes using this WILL FAIL)`);
        
        // Check if routes exist
        const fs = require('fs');
        const routesPath = require('path').join(__dirname, '../server/routes');
        const routes = fs.readdirSync(routesPath);
        const hasRoute = routes.some(r => r.includes('loyalty'));
        if (hasRoute) {
          console.log(`   ⚠️  Routes exist that use this table - WILL BREAK!`);
        }
      } else {
        console.log(`✅ ${table} - EXISTS`);
      }
    }
    
    // Check column naming issues (field mappings)
    console.log('\n2. COLUMN NAMING ISSUES (MIGHT BE FALSE POSITIVES):');
    console.log('-'.repeat(80));
    
    const columnChecks = [
      { table: 'accounts', modelField: 'account_type_id', dbField: 'accountTypeId' },
      { table: 'customer_deposits', modelField: 'depositReferenceNumber', dbField: 'deposit_reference_number' },
      { table: 'currencies', modelField: 'createdAt', dbField: 'created_at' },
      { table: 'payment_methods', modelField: 'deductsFromCustomerAccount', dbField: 'deducts_from_customer_account' }
    ];
    
    for (const check of columnChecks) {
      const [columns] = await sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = :tableName 
        AND (column_name = :modelField OR column_name = :dbField)
      `, {
        replacements: { 
          tableName: check.table,
          modelField: check.modelField,
          dbField: check.dbField
        },
        type: QueryTypes.SELECT
      });
      
      if (columns.length === 0) {
        console.log(`❌ ${check.table}.${check.modelField} - MISSING (Model expects this)`);
        console.log(`   Checking if ${check.dbField} exists...`);
        
        const [altCheck] = await sequelize.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = :tableName 
          AND column_name = :dbField
        `, {
          replacements: { 
            tableName: check.table,
            dbField: check.dbField
          },
          type: QueryTypes.SELECT
        });
        
        if (altCheck.length > 0) {
          console.log(`   ✅ ${check.dbField} EXISTS - Field mapping should work (FALSE POSITIVE)`);
        } else {
          console.log(`   ❌ ${check.dbField} also MISSING - WILL BREAK if used!`);
        }
      } else {
        console.log(`✅ ${check.table}.${check.modelField} - EXISTS (as ${columns[0].column_name})`);
      }
    }
    
    // Check if loyalty routes are registered
    console.log('\n3. ROUTE REGISTRATION CHECK:');
    console.log('-'.repeat(80));
    const fs = require('fs');
    const serverPath = require('path').join(__dirname, '../server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    
    if (serverContent.includes('loyaltyCard') || serverContent.includes('loyalty')) {
      console.log('⚠️  Loyalty routes are registered in server.js');
      console.log('   If tables are missing, these routes WILL FAIL');
    } else {
      console.log('✅ Loyalty routes not registered - won\'t break');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 SUMMARY:');
    console.log('='.repeat(80));
    console.log('❌ CRITICAL: Missing tables WILL break if routes are accessed');
    console.log('⚠️  WARNING: Missing columns MIGHT break if features are used');
    console.log('✅ SAFE: Field mappings handle most naming differences');
    console.log('\n💡 RECOMMENDATION:');
    console.log('   - Create migrations for missing tables');
    console.log('   - Add missing timestamp columns');
    console.log('   - Verify field mappings are correct');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkBreakingIssues();


