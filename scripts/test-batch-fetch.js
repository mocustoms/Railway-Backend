const sequelize = require('../config/database');
const { ProductExpiryDate } = require('../server/models');
const { Op } = require('sequelize');

async function testBatchFetch() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    const product_id = '51a0c555-d90f-4e37-a74b-22c6d508a72c';
    const store_id = 'ba77812d-f810-43a7-ba83-5a9e6d4fa5ef';
    const companyId = '1dea12f6-e880-430b-a3b5-4323893be010';

    console.log('\n📋 Testing batch number fetch with:');
    console.log('  Product ID:', product_id);
    console.log('  Store ID:', store_id);
    console.log('  Company ID:', companyId);

    // First, check if there are any batches for this product at all
    const allBatches = await ProductExpiryDate.findAll({
      where: {
        product_id,
        companyId
      },
      attributes: ['id', 'batch_number', 'store_id', 'current_quantity', 'is_active', 'companyId'],
      limit: 10
    });

    console.log(`\n📦 Found ${allBatches.length} total batches for this product in this company:`);
    allBatches.forEach(b => {
      console.log(`  - Batch: ${b.batch_number}, Store: ${b.store_id}, Qty: ${b.current_quantity}, Active: ${b.is_active}`);
    });

    // Now test the actual query we're using
    const whereClause = {
      product_id,
      store_id,
      companyId,
      is_active: true,
      current_quantity: {
        [Op.gt]: 0
      }
    };

    console.log('\n🔍 Testing query with filters:');
    console.log('  Where clause:', JSON.stringify(whereClause, null, 2));

    const batchNumbers = await ProductExpiryDate.findAll({
      where: whereClause,
      order: [['batch_number', 'ASC']],
      attributes: ['id', 'uuid', 'batch_number', 'expiry_date', 'current_quantity', 'store_id', 'product_id', 'companyId']
    });

    console.log(`\n✅ Found ${batchNumbers.length} batch numbers matching all filters:`);
    batchNumbers.forEach(bn => {
      console.log(`  - Batch: ${bn.batch_number}, Expiry: ${bn.expiry_date}, Qty: ${bn.current_quantity}`);
      console.log(`    ID: ${bn.id || bn.uuid}, Store: ${bn.store_id}, Product: ${bn.product_id}, Company: ${bn.companyId}`);
    });

    // Test the response format
    const response = {
      success: true,
      batchNumbers: batchNumbers.map(bn => ({
        id: bn.id || bn.uuid,
        batch_number: bn.batch_number,
        product_id: bn.product_id,
        store_id: bn.store_id,
        current_quantity: parseFloat(bn.current_quantity || 0),
        expiry_date: bn.expiry_date ? (bn.expiry_date.toISOString ? bn.expiry_date.toISOString().split('T')[0] : bn.expiry_date) : null,
      }))
    };

    console.log('\n📤 Response format:');
    console.log(JSON.stringify(response, null, 2));

    await sequelize.close();
    console.log('\n✅ Test completed successfully');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testBatchFetch();

