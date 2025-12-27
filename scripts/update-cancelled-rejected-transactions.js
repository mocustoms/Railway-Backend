const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function updateCancelledRejectedTransactions() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('Updating cancelled and rejected transactions...\n');
    
    // Find invoices that are cancelled or rejected
    const invoices = await sequelize.query(`
      SELECT 
        si.id,
        si."invoice_ref_number",
        si."status",
        si."cancelled_by",
        si."cancelled_at",
        si."rejected_by",
        si."rejected_at"
      FROM sales_invoices si
      WHERE si."companyId" = :companyId
        AND (si."status" = 'cancelled' OR si."status" = 'rejected');
    `, {
      type: QueryTypes.SELECT,
      replacements: { companyId: '4e42f29c-4b11-48a3-a74a-ba4f26c138e3' },
      transaction
    });

    console.log(`Found ${invoices.length} cancelled/rejected invoices\n`);

    let updatedCount = 0;

    for (const invoice of invoices) {
      // Find the related transaction
      const transactions = await sequelize.query(`
        SELECT 
          st.id,
          st."transaction_ref_number",
          st."status",
          st."is_cancelled",
          st."is_active"
        FROM sales_transactions st
        WHERE st."source_invoice_id" = :invoiceId
          AND st."companyId" = :companyId;
      `, {
        type: QueryTypes.SELECT,
        replacements: { 
          invoiceId: invoice.id,
          companyId: '4e42f29c-4b11-48a3-a74a-ba4f26c138e3'
        },
        transaction
      });

      for (const t of transactions) {
        const newStatus = invoice.status;
        const isCancelled = invoice.status === 'cancelled';
        const isActive = !isCancelled;

        console.log(`Updating transaction ${t.transaction_ref_number} for invoice ${invoice.invoice_ref_number}`);
        console.log(`   Old: status=${t.status}, is_cancelled=${t.is_cancelled}, is_active=${t.is_active}`);
        console.log(`   New: status=${newStatus}, is_cancelled=${isCancelled}, is_active=${isActive}`);

        await sequelize.query(`
          UPDATE sales_transactions
          SET 
            "status" = :status,
            "is_cancelled" = :isCancelled,
            "is_active" = :isActive,
            "cancelled_by" = :cancelledBy,
            "cancelled_at" = :cancelledAt,
            "rejected_by" = :rejectedBy,
            "rejected_at" = :rejectedAt,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE id = :transactionId
            AND "companyId" = :companyId;
        `, {
          replacements: {
            transactionId: t.id,
            companyId: '4e42f29c-4b11-48a3-a74a-ba4f26c138e3',
            status: newStatus,
            isCancelled: isCancelled,
            isActive: isActive,
            cancelledBy: invoice.cancelled_by || null,
            cancelledAt: invoice.cancelled_at || null,
            rejectedBy: invoice.rejected_by || null,
            rejectedAt: invoice.rejected_at || null
          },
          transaction
        });

        updatedCount++;
      }
    }

    await transaction.commit();

    console.log(`\n${'='.repeat(80)}`);
    console.log('=== UPDATE COMPLETE ===');
    console.log(`${'='.repeat(80)}`);
    console.log(`Total transactions updated: ${updatedCount}`);
    console.log(`${'='.repeat(80)}\n`);

    await sequelize.close();
  } catch (error) {
    await transaction.rollback();
    console.error('Error:', error);
    process.exit(1);
  }
}

updateCancelledRejectedTransactions();

