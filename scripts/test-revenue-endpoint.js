#!/usr/bin/env node

/**
 * Test Revenue Endpoint
 * Tests the /api/sales-transactions/stats/summary endpoint to verify revenue data
 */

const { sequelize } = require('../server/models');
const { SalesTransaction } = require('../server/models');
const { Op } = require('sequelize');

async function testRevenueEndpoint() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log('='.repeat(80));
    console.log('🧪 TESTING REVENUE ENDPOINT DATA');
    console.log('='.repeat(80));
    console.log('');

    // Get company ID from environment or use first company
    const { Company } = require('../server/models');
    const company = await Company.findOne();
    
    if (!company) {
      console.log('⚠️  No company found in database');
      await sequelize.close();
      return;
    }

    console.log(`📊 Testing for Company: ${company.name} (${company.id})\n`);

    // Simulate the endpoint query
    const whereClause = {};
    const companyWhere = {
      companyId: company.id,
      status: {
        [Op.notIn]: ['cancelled', 'rejected']
      },
      is_cancelled: false,
      is_active: true
    };

    console.log('🔍 Query Filters:');
    console.log(JSON.stringify(companyWhere, null, 2));
    console.log('');

    // Get statistics (same as endpoint)
    const [
      totalCount,
      totalAmount,
      totalEquivalentAmount,
      totalPaid,
      totalBalance
    ] = await Promise.all([
      SalesTransaction.count({ where: companyWhere }),
      SalesTransaction.sum('total_amount', { where: companyWhere }),
      SalesTransaction.sum('equivalent_amount', { where: companyWhere }),
      SalesTransaction.sum('paid_amount', { where: companyWhere }),
      SalesTransaction.sum('balance_amount', { where: companyWhere })
    ]);

    console.log('📊 Revenue Statistics:');
    console.log('='.repeat(80));
    console.log(`Total Transactions: ${totalCount || 0}`);
    console.log(`Total Amount: ${totalAmount != null ? parseFloat(totalAmount).toFixed(2) : '0.00'}`);
    console.log(`Total Equivalent Amount (Revenue): ${totalEquivalentAmount != null ? parseFloat(totalEquivalentAmount).toFixed(2) : '0.00'}`);
    console.log(`Total Paid: ${totalPaid != null ? parseFloat(totalPaid).toFixed(2) : '0.00'}`);
    console.log(`Total Balance: ${totalBalance != null ? parseFloat(totalBalance).toFixed(2) : '0.00'}`);
    console.log('='.repeat(80));
    console.log('');

    // Show sample transactions
    const sampleTransactions = await SalesTransaction.findAll({
      where: companyWhere,
      attributes: [
        'transaction_ref_number',
        'total_amount',
        'equivalent_amount',
        'status',
        'is_cancelled',
        'is_active',
        'transaction_date'
      ],
      limit: 5,
      order: [['created_at', 'DESC']]
    });

    console.log('📋 Sample Transactions (first 5):');
    console.log('='.repeat(80));
    if (sampleTransactions.length > 0) {
      sampleTransactions.forEach((tx, idx) => {
        console.log(`\n${idx + 1}. ${tx.transaction_ref_number || tx.id}`);
        console.log(`   Total Amount: ${parseFloat(tx.total_amount || 0).toFixed(2)}`);
        console.log(`   Equivalent Amount: ${parseFloat(tx.equivalent_amount || 0).toFixed(2)}`);
        console.log(`   Status: ${tx.status}`);
        console.log(`   Is Cancelled: ${tx.is_cancelled}`);
        console.log(`   Is Active: ${tx.is_active}`);
        console.log(`   Date: ${tx.transaction_date}`);
      });
    } else {
      console.log('   No transactions found matching the criteria.');
    }
    console.log('='.repeat(80));
    console.log('');

    // Check excluded transactions
    const excludedCount = await SalesTransaction.count({
      where: {
        companyId: company.id,
        [Op.or]: [
          { status: 'cancelled' },
          { status: 'rejected' },
          { is_cancelled: true },
          { is_active: false }
        ]
      }
    });

    console.log(`⚠️  Excluded Transactions (cancelled/rejected/inactive): ${excludedCount}`);
    console.log('');

    // Expected response format
    const expectedResponse = {
      summary: {
        totalTransactions: totalCount || 0,
        totalAmount: totalAmount != null ? parseFloat(totalAmount) : 0,
        totalEquivalentAmount: totalEquivalentAmount != null ? parseFloat(totalEquivalentAmount) : 0,
        totalPaid: totalPaid != null ? parseFloat(totalPaid) : 0,
        totalBalance: totalBalance != null ? parseFloat(totalBalance) : 0
      }
    };

    console.log('✅ Expected API Response:');
    console.log(JSON.stringify(expectedResponse, null, 2));
    console.log('');

    if (totalEquivalentAmount && totalEquivalentAmount > 0) {
      console.log('✅ SUCCESS: Revenue data is available!');
      console.log(`   Revenue Card should display: ${parseFloat(totalEquivalentAmount).toFixed(2)}`);
    } else {
      console.log('⚠️  WARNING: No revenue data found.');
      console.log('   This could mean:');
      console.log('   1. No sales transactions exist yet');
      console.log('   2. All transactions are cancelled/rejected');
      console.log('   3. Transactions have equivalent_amount = 0 or NULL');
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

testRevenueEndpoint();

