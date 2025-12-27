#!/usr/bin/env node

/**
 * Check if company exists and list all companies
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

const COMPANY_ID = process.argv[2] || '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    // List all companies
    const companiesResult = await sequelize.query(
      `SELECT id, name, email FROM "Company" ORDER BY id`,
      { type: QueryTypes.SELECT }
    );
    
    const companies = Array.isArray(companiesResult) && companiesResult.length > 0 && Array.isArray(companiesResult[0])
      ? companiesResult[0]
      : companiesResult;
    
    console.log('📋 ALL COMPANIES IN DATABASE:');
    console.log('='.repeat(80));
    
    if (!companies || companies.length === 0) {
      console.log('No companies found in database.\n');
    } else {
      companies.forEach((company, index) => {
        const isTarget = company.id === COMPANY_ID;
        const marker = isTarget ? '👉' : '  ';
        console.log(`${marker} ${(index + 1).toString().padStart(2)}. ${company.name}`);
        console.log(`     ID: ${company.id}`);
        console.log(`     Email: ${company.email || 'N/A'}`);
        console.log(`     Created: ${company.created_at || 'N/A'}`);
        console.log('');
      });
    }
    
    // Check specific company
    console.log('🔍 CHECKING TARGET COMPANY:');
    console.log('-'.repeat(80));
    console.log(`Company ID: ${COMPANY_ID}\n`);
    
    const [targetCompany] = await sequelize.query(
      `SELECT id, name, email FROM "Company" WHERE id = :companyId`,
      {
        replacements: { companyId: COMPANY_ID },
        type: QueryTypes.SELECT
      }
    );
    
    if (targetCompany) {
      console.log(`✅ Company found: ${targetCompany.name}`);
      console.log(`   Email: ${targetCompany.email || 'N/A'}`);
      
      // Count records
      const [countResult] = await sequelize.query(
        `SELECT 
          (SELECT COUNT(*) FROM sales_invoices WHERE "companyId" = :companyId) as sales_invoices,
          (SELECT COUNT(*) FROM sales_orders WHERE "companyId" = :companyId) as sales_orders,
          (SELECT COUNT(*) FROM customers WHERE "companyId" = :companyId) as customers,
          (SELECT COUNT(*) FROM products WHERE "companyId" = :companyId) as products,
          (SELECT COUNT(*) FROM users WHERE "companyId" = :companyId) as users`,
        {
          replacements: { companyId: COMPANY_ID },
          type: QueryTypes.SELECT
        }
      );
      
      console.log('\n📊 Sample record counts:');
      console.log(`   Sales Invoices: ${countResult.sales_invoices || 0}`);
      console.log(`   Sales Orders: ${countResult.sales_orders || 0}`);
      console.log(`   Customers: ${countResult.customers || 0}`);
      console.log(`   Products: ${countResult.products || 0}`);
      console.log(`   Users: ${countResult.users || 0}`);
    } else {
      console.log('❌ Company not found with this ID');
      console.log('\n💡 Make sure you are using the correct database (local vs Railway)');
    }
    
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

