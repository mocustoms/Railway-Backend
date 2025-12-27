const { Receipt, sequelize } = require('./server/models');
const { Op } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    const today = new Date();
    const dateString = today.getFullYear().toString() + 
                      (today.getMonth() + 1).toString().padStart(2, '0') + 
                      today.getDate().toString().padStart(2, '0');
    
    console.log(`\n📅 Today's date string: ${dateString}`);

    // Get all receipts ordered by reference number
    const allReceipts = await Receipt.findAll({
      attributes: ['id', 'receipt_reference_number', 'companyId'],
      order: [['receipt_reference_number', 'DESC']],
      limit: 30
    });

    console.log(`\n📋 Last 30 receipts:`);
    allReceipts.forEach(r => {
      console.log(`  ${r.receipt_reference_number || 'NULL'} (companyId: ${r.companyId})`);
    });

    // Get receipts for today
    const todayReceipts = await Receipt.findAll({
      where: {
        receipt_reference_number: {
          [Op.like]: `RCP-${dateString}-%`
        }
      },
      attributes: ['id', 'receipt_reference_number', 'companyId'],
      order: [['receipt_reference_number', 'DESC']]
    });

    console.log(`\n📋 Receipts for today (${dateString}): ${todayReceipts.length}`);
    todayReceipts.forEach(r => {
      console.log(`  ${r.receipt_reference_number} (companyId: ${r.companyId})`);
    });

    // Get the last receipt for pattern matching
    const lastReceipt = await Receipt.findOne({
      where: {
        receipt_reference_number: {
          [Op.like]: 'RCP-%'
        }
      },
      attributes: ['receipt_reference_number'],
      order: [['receipt_reference_number', 'DESC']]
    });

    console.log(`\n🔍 Last receipt found: ${lastReceipt?.receipt_reference_number || 'NONE'}`);
    
    if (lastReceipt && lastReceipt.receipt_reference_number) {
      const match = lastReceipt.receipt_reference_number.match(/RCP-\d{8}-(\d{4})/);
      if (match) {
        const lastSequence = parseInt(match[1]);
        const nextSequence = lastSequence + 1;
        const nextRef = `RCP-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
        console.log(`   Last sequence: ${lastSequence}`);
        console.log(`   Next sequence: ${nextSequence}`);
        console.log(`   Next reference: ${nextRef}`);
        
        // Check if next reference exists
        const exists = await Receipt.findOne({
          where: { receipt_reference_number: nextRef },
          attributes: ['id']
        });
        console.log(`   Next reference exists: ${exists ? 'YES' : 'NO'}`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();

