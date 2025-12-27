require('dotenv').config({ path: './.env' });
const { createDatabaseConnection } = require('../config/database');
const { SalesInvoice, SalesInvoiceItem, Account } = require('../server/models');

async function checkInvoiceDetails(invoiceRefNumber) {
  const sequelize = createDatabaseConnection(process.env.LOCAL_DATABASE_URL);
  await sequelize.authenticate();
  console.log('✅ Connected to database\n');

  const invoice = await SalesInvoice.findOne({
    where: { invoice_ref_number: invoiceRefNumber },
    include: [{ 
      model: SalesInvoiceItem, 
      as: 'items',
      required: false
    }]
  });

  if (!invoice) {
    console.log(`❌ Invoice ${invoiceRefNumber} not found`);
    process.exit(1);
  }

  console.log(`📄 Invoice: ${invoiceRefNumber}`);
  console.log(`   Subtotal: ${invoice.subtotal}`);
  console.log(`   Discount Amount: ${invoice.discount_amount}`);
  console.log(`   Tax Amount: ${invoice.tax_amount}`);
  console.log(`   Total: ${invoice.total_amount}`);
  console.log(`   Discount Allowed Account ID: ${invoice.discount_allowed_account_id || 'NOT SET'}`);
  console.log(`\n📦 Items:`);
  
  for (const item of invoice.items || []) {
    console.log(`   - ${item.id}:`);
    console.log(`     Sales Tax ID: ${item.sales_tax_id || 'NOT SET'}`);
    console.log(`     Tax Amount: ${item.tax_amount || 0}`);
    console.log(`     Discount Amount: ${item.discount_amount || 0}`);
  }

  if (invoice.discount_allowed_account_id) {
    const discountAccount = await Account.findByPk(invoice.discount_allowed_account_id);
    console.log(`\n💳 Discount Account: ${discountAccount ? discountAccount.name : 'NOT FOUND'}`);
  }

  process.exit(0);
}

const invoiceRef = process.argv[2] || 'INV-20251118-0009';
checkInvoiceDetails(invoiceRef).catch(console.error);
