const sequelize = require('../config/database');
const { ProductSerialNumber } = require('../server/models');
const { Op } = require('sequelize');

async function testSerialFetch() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    const product_id = '51a0c555-d90f-4e37-a74b-22c6d508a72c';
    const store_id = 'ba77812d-f810-43a7-ba83-5a9e6d4fa5ef';
    const companyId = '1dea12f6-e880-430b-a3b5-4323893be010';

    console.log('\n📋 Testing serial number fetch with:');
    console.log('  Product ID:', product_id);
    console.log('  Store ID:', store_id);
    console.log('  Company ID:', companyId);

    // First, check if there are any serial numbers for this product at all
    const allSerials = await ProductSerialNumber.findAll({
      where: {
        product_id,
        companyId
      },
      attributes: ['id', 'uuid', 'serial_number', 'store_id', 'current_quantity', 'is_active', 'status', 'companyId'],
      limit: 10
    });

    console.log(`\n📦 Found ${allSerials.length} total serial numbers for this product in this company:`);
    allSerials.forEach(s => {
      console.log(`  - Serial: ${s.serial_number}, Store: ${s.store_id}, Qty: ${s.current_quantity}, Active: ${s.is_active}, Status: ${s.status}`);
    });

    // Now test the actual query we're using
    const whereClause = {
      product_id,
      store_id,
      companyId,
      is_active: true,
      status: 'active',
      current_quantity: {
        [Op.gt]: 0
      }
    };

    console.log('\n🔍 Testing query with filters:');
    console.log('  Where clause:', JSON.stringify(whereClause, null, 2));

    const serialNumbers = await ProductSerialNumber.findAll({
      where: whereClause,
      order: [['serial_number', 'ASC']],
      attributes: ['id', 'uuid', 'serial_number', 'store_id', 'product_id', 'companyId', 'current_quantity', 'status']
    });

    console.log(`\n✅ Found ${serialNumbers.length} serial numbers matching all filters:`);
    serialNumbers.forEach(sn => {
      console.log(`  - Serial: ${sn.serial_number}, Qty: ${sn.current_quantity}, Status: ${sn.status}`);
      console.log(`    ID: ${sn.id || sn.uuid}, Store: ${sn.store_id}, Product: ${sn.product_id}, Company: ${sn.companyId}`);
    });

    // Test the response format
    const response = {
      success: true,
      serialNumbers: serialNumbers.map(sn => ({
        id: sn.id || sn.uuid,
        serial_number: sn.serial_number,
        product_id: sn.product_id,
        store_id: sn.store_id,
        current_quantity: parseFloat(sn.current_quantity || 0),
        status: sn.status || null,
        unit_cost: null
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

testSerialFetch();

