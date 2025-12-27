const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function checkCancelledRejectedInvoices() {
  try {
    console.log('Checking cancelled and rejected invoices...\n');
    
    // Check invoices with their status
    const invoices = await sequelize.query(`
      SELECT 
        si.id,
        si."invoice_ref_number",
        si."status",
        si."payment_status",
        COUNT(st.id) as transaction_count
      FROM sales_invoices si
      LEFT JOIN sales_transactions st ON st."source_invoice_id" = si.id
      WHERE si."companyId" = :companyId
      GROUP BY si.id, si."invoice_ref_number", si."status", si."payment_status"
      ORDER BY si."created_at" DESC;
    `, {
      type: QueryTypes.SELECT,
      replacements: { companyId: '4e42f29c-4b11-48a3-a74a-ba4f26c138e3' }
    });

    console.log(`=== INVOICES STATUS BREAKDOWN (${invoices.length} total) ===\n`);
    
    const statusCounts = {};
    invoices.forEach(inv => {
      const status = inv.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    console.log('Status Distribution:');
    Object.keys(statusCounts).forEach(status => {
      console.log(`   ${status}: ${statusCounts[status]}`);
    });

    // Check cancelled and rejected invoices specifically
    console.log(`\n${'='.repeat(80)}`);
    console.log('=== CANCELLED AND REJECTED INVOICES ===');
    console.log(`${'='.repeat(80)}\n`);

    const cancelledRejected = invoices.filter(inv => 
      inv.status === 'cancelled' || inv.status === 'rejected'
    );

    console.log(`Found ${cancelledRejected.length} cancelled/rejected invoices:\n`);

    for (const inv of cancelledRejected) {
      console.log(`Invoice: ${inv.invoice_ref_number}`);
      console.log(`   Status: ${inv.status}`);
      console.log(`   Payment Status: ${inv.payment_status || 'N/A'}`);
      console.log(`   Has Transaction: ${inv.transaction_count > 0 ? '✅' : '❌'} (${inv.transaction_count} transactions)`);

      if (inv.transaction_count > 0) {
        // Check transaction details
        const transactions = await sequelize.query(`
          SELECT 
            st."transaction_ref_number",
            st."status",
            st."is_cancelled",
            st."is_active",
            st."product_category_id",
            st."brand_name_id",
            st."total_amount"
          FROM sales_transactions st
          WHERE st."source_invoice_id" = :invoiceId
          ORDER BY st."created_at" DESC;
        `, {
          type: QueryTypes.SELECT,
          replacements: { invoiceId: inv.id }
        });

        transactions.forEach(t => {
          console.log(`   Transaction: ${t.transaction_ref_number}`);
          console.log(`      Status: ${t.status}`);
          console.log(`      Is Cancelled: ${t.is_cancelled}`);
          console.log(`      Is Active: ${t.is_active}`);
          console.log(`      Has Product Data: ${t.product_category_id ? '✅' : '❌'}`);
          console.log(`      Total Amount: ${t.total_amount}`);
        });
      }
      console.log('');
    }

    // Check if top products query is filtering out cancelled/rejected
    console.log(`\n${'='.repeat(80)}`);
    console.log('=== CHECKING TOP PRODUCTS QUERY FILTERS ===');
    console.log(`${'='.repeat(80)}\n`);

    // Simulate the current query
    const allTransactions = await sequelize.query(`
      SELECT 
        st."transaction_ref_number",
        st."status",
        st."is_cancelled",
        st."is_active",
        st."product_category_id",
        st."total_amount",
        si."status" as invoice_status
      FROM sales_transactions st
      LEFT JOIN sales_invoices si ON si.id = st."source_invoice_id"
      WHERE st."companyId" = :companyId
      ORDER BY st."created_at" DESC;
    `, {
      type: QueryTypes.SELECT,
      replacements: { companyId: '4e42f29c-4b11-48a3-a74a-ba4f26c138e3' }
    });

    console.log(`Total Transactions: ${allTransactions.length}`);
    console.log(`\nTransactions by Status:`);
    const statusBreakdown = {};
    allTransactions.forEach(t => {
      const status = t.status || 'unknown';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });
    Object.keys(statusBreakdown).forEach(status => {
      console.log(`   ${status}: ${statusBreakdown[status]}`);
    });

    console.log(`\nTransactions with Product Data:`);
    const withProductData = allTransactions.filter(t => t.product_category_id);
    const withoutProductData = allTransactions.filter(t => !t.product_category_id);
    console.log(`   With Product Data: ${withProductData.length}`);
    console.log(`   Without Product Data: ${withoutProductData.length}`);

    console.log(`\nCancelled/Rejected Transactions:`);
    const cancelledRejectedTransactions = allTransactions.filter(t => 
      t.status === 'cancelled' || t.status === 'rejected' || t.is_cancelled === true
    );
    console.log(`   Total: ${cancelledRejectedTransactions.length}`);
    cancelledRejectedTransactions.forEach(t => {
      console.log(`   ${t.transaction_ref_number}: status=${t.status}, is_cancelled=${t.is_cancelled}, has_product=${t.product_category_id ? 'yes' : 'no'}`);
    });

    await sequelize.close();
    console.log('\n=== ANALYSIS COMPLETE ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkCancelledRejectedInvoices();

