#!/usr/bin/env node

/**
 * Test Revenue Data
 * Checks sales transactions and revenue data
 */

const { sequelize } = require('../server/models');
const { SalesTransaction, Company } = require('../server/models');
const { Op } = require('sequelize');

async function testRevenueData() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log('='.repeat(80));
    console.log('🧪 TESTING REVENUE DATA');
    console.log('='.repeat(80));
    console.log('');

    // Get all companies
    const companies = await Company.findAll({
      attributes: ['id', 'name'],
      limit: 5
    });

    console.log(`📊 Found ${companies.length} companies\n`);

    // Check all sales transactions
    const allTransactions = await SalesTransaction.findAll({
      attributes: [
        'id',
        'transaction_ref_number',
        'companyId',
        'status',
        'is_cancelled',
        'is_active',
        'equivalent_amount',
        'total_amount',
        'transaction_date'
      ],
      limit: 20,
      order: [['created_at', 'DESC']]
    });

    console.log(`📋 Total Sales Transactions: ${allTransactions.length}\n`);

    if (allTransactions.length > 0) {
      console.log('Sample Transactions:');
      console.log('-'.repeat(80));
      allTransactions.slice(0, 10).forEach((t, i) => {
        console.log(`\n${i + 1}. ${t.transaction_ref_number || t.id}`);
        console.log(`   CompanyId: ${t.companyId}`);
        console.log(`   Status: ${t.status}`);
        console.log(`   Cancelled: ${t.is_cancelled}, Active: ${t.is_active}`);
        console.log(`   Total Amount: ${parseFloat(t.total_amount || 0).toFixed(2)}`);
        console.log(`   Equivalent Amount: ${parseFloat(t.equivalent_amount || 0).toFixed(2)}`);
        console.log(`   Date: ${t.transaction_date}`);
      });
      console.log('\n' + '-'.repeat(80));
    }

    // Test revenue calculation for each company
    for (const company of companies) {
      console.log(`\n📊 Testing Revenue for Company: ${company.name}`);
      console.log('='.repeat(80));

      const companyWhere = {
        companyId: company.id,
        status: {
          [Op.notIn]: ['cancelled', 'rejected']
        },
        is_cancelled: false,
        is_active: true
      };

      const [
        totalCount,
        totalEquivalentAmount
      ] = await Promise.all([
        SalesTransaction.count({ where: companyWhere }),
        SalesTransaction.sum('equivalent_amount', { where: companyWhere })
      ]);

      console.log(`Total Transactions: ${totalCount || 0}`);
      console.log(`Total Revenue (Equivalent Amount): ${totalEquivalentAmount != null ? parseFloat(totalEquivalentAmount).toFixed(2) : '0.00'}`);

      // Check without filters
      const allCount = await SalesTransaction.count({
        where: { companyId: company.id }
      });
      console.log(`Total Transactions (all): ${allCount}`);

      if (allCount > 0 && totalCount === 0) {
        console.log('\n⚠️  WARNING: Transactions exist but are excluded by filters!');
        const excluded = await SalesTransaction.findAll({
          where: { companyId: company.id },
          attributes: ['status', 'is_cancelled', 'is_active'],
          limit: 5
        });
        console.log('Sample transaction statuses:');
        excluded.forEach(t => {
          console.log(`  - Status: ${t.status}, Cancelled: ${t.is_cancelled}, Active: ${t.is_active}`);
        });
      }
    }

    await sequelize.close();
    console.log('\n✅ Test completed');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testRevenueData();

