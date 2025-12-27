const { Receipt, SalesInvoice } = require('./server/models');

(async () => {
  try {
    const receipt = await Receipt.findByPk('28a3f891-9065-4071-b693-62662623d4f0', {
      include: [
        {
          model: SalesInvoice,
          as: 'salesInvoice',
          attributes: ['invoice_ref_number', 'total_amount', 'paid_amount', 'balance_amount']
        }
      ]
    });
    
    if (receipt) {
      console.log('✅ Receipt found:');
      console.log(`   Reference: ${receipt.receipt_reference_number || receipt.receiptReferenceNumber}`);
      console.log(`   Invoice: ${receipt.salesInvoice?.invoice_ref_number || 'N/A'}`);
      console.log(`   Payment Amount: ${receipt.payment_amount || receipt.paymentAmount}`);
      console.log(`   Company ID: ${receipt.companyId}`);
      console.log(`   Status: ${receipt.status}`);
      if (receipt.salesInvoice) {
        console.log(`   Invoice Total: ${receipt.salesInvoice.total_amount}`);
        console.log(`   Invoice Paid: ${receipt.salesInvoice.paid_amount}`);
        console.log(`   Invoice Balance: ${receipt.salesInvoice.balance_amount}`);
      }
    } else {
      console.log('❌ Receipt not found');
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

