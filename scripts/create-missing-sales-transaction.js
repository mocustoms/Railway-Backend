const sequelize = require('../config/database');
const { SalesInvoice, SalesTransaction } = require('../server/models');
const { createTransactionFromInvoice } = require('../server/utils/salesTransactionHelper');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');

// Mock req object for createTransactionFromInvoice
function createMockReq(userId, companyId) {
  return {
    user: {
      id: userId,
      companyId: companyId
    }
  };
}

async function createMissingSalesTransaction(invoiceRefNumber) {
  try {
    console.log(`\n🔍 Creating missing sales transaction for invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    // Find the invoice
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber }
    });

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceRefNumber} not found`);
      return;
    }

    console.log(`✅ Invoice Found: ${invoiceRefNumber}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   ID: ${invoice.id}`);
    console.log(`   Company ID: ${invoice.companyId}`);

    // Check if sales transaction already exists
    const existingTransaction = await SalesTransaction.findOne({
      where: {
        source_invoice_id: invoice.id
      }
    });

    if (existingTransaction) {
      console.log(`\n✅ Sales transaction already exists:`);
      console.log(`   Reference: ${existingTransaction.transaction_ref_number}`);
      console.log(`   Status: ${existingTransaction.status}`);
      console.log(`   Type: ${existingTransaction.transaction_type}`);
      return;
    }

    // Get the user who created the invoice (or use a system user)
    const createdBy = invoice.created_by || invoice.approved_by;
    if (!createdBy) {
      console.error(`❌ Cannot determine user ID for invoice creation`);
      console.log(`   Invoice created_by: ${invoice.created_by}`);
      console.log(`   Invoice approved_by: ${invoice.approved_by}`);
      return;
    }

    // Create mock req object
    const mockReq = createMockReq(createdBy, invoice.companyId);

    console.log(`\n📝 Creating sales transaction...`);
    console.log(`   Using User ID: ${createdBy}`);
    console.log(`   Using Company ID: ${invoice.companyId}`);

    // Create the sales transaction
    const transaction = await sequelize.transaction();
    try {
      const salesTransaction = await createTransactionFromInvoice(invoice, mockReq, { transaction });

      // Update status to match invoice status
      await salesTransaction.update({
        status: invoice.status,
        approved_by: invoice.approved_by,
        approved_at: invoice.approved_at,
        sent_by: invoice.sent_by,
        sent_at: invoice.sent_at,
        updated_by: createdBy
      }, { transaction });

      await transaction.commit();

      console.log(`\n✅ Successfully created sales transaction:`);
      console.log(`   Reference: ${salesTransaction.transaction_ref_number}`);
      console.log(`   Status: ${salesTransaction.status}`);
      console.log(`   Type: ${salesTransaction.transaction_type}`);
      console.log(`   Total Amount: ${salesTransaction.total_amount}`);
      console.log(`   Customer: ${salesTransaction.customer_id}`);
      console.log(`   Store: ${salesTransaction.store_id}`);

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ Sales transaction created successfully!`);
      console.log(`${'='.repeat(80)}\n`);

    } catch (createError) {
      await transaction.rollback();
      console.error(`\n❌ Error creating sales transaction:`, createError.message);
      console.error(`Stack:`, createError.stack);
      throw createError;
    }

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference from command line
const invoiceRef = process.argv[2] || 'INV-20251110-0007';

createMissingSalesTransaction(invoiceRef);

