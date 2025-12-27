require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function explainExpectedGL(invoiceRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log(`📊 EXPECTED GENERAL LEDGER ENTRIES FOR: ${invoiceRefNumber}\n`);
    console.log('='.repeat(100));

    // Get invoice details
    const invoiceResult = await sequelize.query(`
      SELECT 
        si.*,
        c.name as customer_name,
        c."default_receivable_account_id" as customer_receivable_account_id
      FROM sales_invoices si
      LEFT JOIN customers c ON si."customer_id" = c.id
      WHERE si."invoice_ref_number" = :invoiceRefNumber
      LIMIT 1
    `, {
      replacements: { invoiceRefNumber },
      type: QueryTypes.SELECT
    });

    if (!invoiceResult || invoiceResult.length === 0) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      await sequelize.close();
      return;
    }

    const invoice = invoiceResult[0];

    // Get payment details
    const paymentResult = await sequelize.query(`
      SELECT 
        SUM(amount) as total_paid
      FROM receipts
      WHERE "sales_invoice_id" = :invoiceId
    `, {
      replacements: { invoiceId: invoice.id },
      type: QueryTypes.SELECT
    });

    const totalPaid = parseFloat(paymentResult[0]?.total_paid || 0);
    const invoiceTotal = parseFloat(invoice.total_amount || 0);
    const invoiceSubtotal = parseFloat(invoice.subtotal || 0);
    const invoiceTax = parseFloat(invoice.tax_amount || 0);
    const invoiceDiscount = parseFloat(invoice.discount_amount || 0);
    const invoiceWHT = parseFloat(invoice.total_wht_amount || 0);
    const balanceAmount = parseFloat(invoice.balance_amount || invoiceTotal);

    console.log('\n📄 INVOICE SUMMARY:');
    console.log(`   Customer: ${invoice.customer_name || 'N/A'}`);
    console.log(`   Subtotal: ${invoiceSubtotal.toFixed(2)}`);
    console.log(`   Discount: ${invoiceDiscount.toFixed(2)}`);
    console.log(`   Tax: ${invoiceTax.toFixed(2)}`);
    console.log(`   WHT: ${invoiceWHT.toFixed(2)}`);
    console.log(`   Total Amount: ${invoiceTotal.toFixed(2)}`);
    console.log(`   Paid Amount: ${totalPaid.toFixed(2)}`);
    console.log(`   Balance Amount: ${balanceAmount.toFixed(2)}`);

    // Get invoice items
    const itemsResult = await sequelize.query(`
      SELECT 
        sii.*,
        p.name as product_name,
        p."product_type",
        p."average_cost",
        pc."income_account_id" as category_income_account_id,
        p."income_account_id" as product_income_account_id,
        pc."cogs_account_id" as category_cogs_account_id,
        p."cogs_account_id" as product_cogs_account_id,
        pc."asset_account_id" as category_asset_account_id,
        p."asset_account_id" as product_asset_account_id
      FROM sales_invoice_items sii
      LEFT JOIN products p ON sii."product_id" = p.id
      LEFT JOIN product_categories pc ON p."category_id" = pc.id
      WHERE sii."sales_invoice_id" = :invoiceId
      ORDER BY sii."created_at" ASC
    `, {
      replacements: { invoiceId: invoice.id },
      type: QueryTypes.SELECT
    });

    console.log('\n\n📋 EXPECTED GENERAL LEDGER ENTRIES:\n');
    console.log('='.repeat(100));

    const expectedEntries = [];
    let totalDebit = 0;
    let totalCredit = 0;

    // 1. COGS and Inventory entries (per item, for non-service products)
    console.log('\n1️⃣  COGS & INVENTORY ENTRIES (Per Item):');
    console.log('-'.repeat(100));
    itemsResult.forEach((item, index) => {
      const product = item.product_name;
      const productType = item.product_type;
      const quantity = parseFloat(item.quantity || 0);
      const averageCost = parseFloat(item.average_cost || 0);
      const cogsAmount = quantity * averageCost;

      if (productType !== 'services' && cogsAmount > 0) {
        const cogsAccountId = item.category_cogs_account_id || item.product_cogs_account_id;
        const inventoryAccountId = item.category_asset_account_id || item.product_asset_account_id;

        console.log(`\n   Item ${index + 1}: ${product}`);
        console.log(`      Quantity: ${quantity}, Average Cost: ${averageCost.toFixed(2)}`);
        console.log(`      COGS Amount: ${cogsAmount.toFixed(2)}`);
        console.log(`      ✅ DEBIT - COGS Account: ${cogsAccountId || 'N/A'} - Amount: ${cogsAmount.toFixed(2)}`);
        console.log(`      ✅ CREDIT - Inventory Account: ${inventoryAccountId || 'N/A'} - Amount: ${cogsAmount.toFixed(2)}`);

        expectedEntries.push({
          nature: 'DEBIT',
          type: 'COGS',
          accountId: cogsAccountId,
          amount: cogsAmount,
          description: `COGS for ${product}`
        });

        expectedEntries.push({
          nature: 'CREDIT',
          type: 'INVENTORY',
          accountId: inventoryAccountId,
          amount: cogsAmount,
          description: `Inventory for ${product}`
        });

        totalDebit += cogsAmount;
        totalCredit += cogsAmount;
      } else if (productType === 'services') {
        console.log(`\n   Item ${index + 1}: ${product} (Service - No COGS/Inventory)`);
      }
    });

    // 2. Accounts Receivable Entry
    console.log('\n\n2️⃣  ACCOUNTS RECEIVABLE ENTRY:');
    console.log('-'.repeat(100));
    const receivableAccountId = invoice.customer_receivable_account_id || invoice.account_receivable_id;
    console.log(`   ✅ DEBIT - Accounts Receivable: ${receivableAccountId || 'N/A'}`);
    console.log(`      Amount: ${balanceAmount.toFixed(2)} (Balance after payment)`);
    console.log(`      Note: This is the UNPAID amount (Total ${invoiceTotal.toFixed(2)} - Paid ${totalPaid.toFixed(2)} = ${balanceAmount.toFixed(2)})`);

    expectedEntries.push({
      nature: 'DEBIT',
      type: 'RECEIVABLE',
      accountId: receivableAccountId,
      amount: balanceAmount,
      description: 'Accounts Receivable'
    });
    totalDebit += balanceAmount;

    // 3. Sales Revenue Entry (should be SUBTOTAL, not total)
    console.log('\n\n3️⃣  SALES REVENUE ENTRY:');
    console.log('-'.repeat(100));
    console.log(`   ⚠️  IMPORTANT: Revenue should be SUBTOTAL, not total amount!`);
    console.log(`   ✅ CREDIT - Income Account: ${itemsResult[0]?.category_income_account_id || itemsResult[0]?.product_income_account_id || 'N/A'}`);
    console.log(`      Expected Amount: ${invoiceSubtotal.toFixed(2)} (Subtotal)`);
    console.log(`      ❌ WRONG Amount: ${invoiceTotal.toFixed(2)} (Total - includes tax)`);
    console.log(`      Note: Revenue should NOT include tax. Tax is posted separately.`);

    const incomeAccountId = itemsResult[0]?.category_income_account_id || itemsResult[0]?.product_income_account_id;
    expectedEntries.push({
      nature: 'CREDIT',
      type: 'INCOME',
      accountId: incomeAccountId,
      amount: invoiceSubtotal, // Should be subtotal, not total
      description: 'Sales Revenue'
    });
    totalCredit += invoiceSubtotal;

    // 4. Tax Payable Entry
    if (invoiceTax > 0) {
      console.log('\n\n4️⃣  TAX PAYABLE ENTRY:');
      console.log('-'.repeat(100));
      console.log(`   ✅ CREDIT - Tax Payable Account: (from tax code)`);
      console.log(`      Amount: ${invoiceTax.toFixed(2)}`);
      expectedEntries.push({
        nature: 'CREDIT',
        type: 'TAX',
        accountId: null, // Will be from tax code
        amount: invoiceTax,
        description: 'Tax Payable'
      });
      totalCredit += invoiceTax;
    }

    // 5. WHT Receivable Entry
    if (invoiceWHT > 0) {
      console.log('\n\n5️⃣  WHT RECEIVABLE ENTRY:');
      console.log('-'.repeat(100));
      console.log(`   ✅ DEBIT - WHT Receivable Account: (from WHT tax code)`);
      console.log(`      Amount: ${invoiceWHT.toFixed(2)}`);
      expectedEntries.push({
        nature: 'DEBIT',
        type: 'WHT',
        accountId: null, // Will be from WHT tax code
        amount: invoiceWHT,
        description: 'WHT Receivable'
      });
      totalDebit += invoiceWHT;
    }

    // 6. Discount Allowed Entry
    if (invoiceDiscount > 0) {
      console.log('\n\n6️⃣  DISCOUNT ALLOWED ENTRY:');
      console.log('-'.repeat(100));
      console.log(`   ✅ DEBIT - Discount Allowed Account: ${invoice.discount_allowed_account_id || 'N/A'}`);
      console.log(`      Amount: ${invoiceDiscount.toFixed(2)}`);
      expectedEntries.push({
        nature: 'DEBIT',
        type: 'DISCOUNT',
        accountId: invoice.discount_allowed_account_id,
        amount: invoiceDiscount,
        description: 'Discount Allowed'
      });
      totalDebit += invoiceDiscount;
    }

    // 7. Payment Entry (if payment was made)
    if (totalPaid > 0) {
      console.log('\n\n7️⃣  PAYMENT ENTRIES:');
      console.log('-'.repeat(100));
      console.log(`   ✅ CREDIT - Accounts Receivable: ${receivableAccountId || 'N/A'}`);
      console.log(`      Amount: ${totalPaid.toFixed(2)} (Reduces AR)`);
      console.log(`   ✅ DEBIT - Payment Account (Cash/Bank): (from receipt)`);
      console.log(`      Amount: ${totalPaid.toFixed(2)}`);
      console.log(`   Note: Payment reduces Accounts Receivable balance`);
      
      // Payment reduces AR (credit) and increases cash/bank (debit)
      expectedEntries.push({
        nature: 'CREDIT',
        type: 'RECEIVABLE',
        accountId: receivableAccountId,
        amount: totalPaid,
        description: 'Payment - Reduces AR'
      });
      totalCredit += totalPaid;
    }

    // Summary
    console.log('\n\n📊 EXPECTED TOTALS:');
    console.log('='.repeat(100));
    console.log(`   Total Debit: ${totalDebit.toFixed(2)}`);
    console.log(`   Total Credit: ${totalCredit.toFixed(2)}`);
    console.log(`   Balance: ${(totalDebit - totalCredit).toFixed(2)} ${totalDebit === totalCredit ? '✅ BALANCED' : '❌ NOT BALANCED'}`);

    console.log('\n\n⚠️  KEY ISSUES FOUND:');
    console.log('='.repeat(100));
    console.log('1. ❌ Sales Revenue is posted as TOTAL (118,000) instead of SUBTOTAL (100,000)');
    console.log('   - Revenue should NOT include tax. Tax is posted separately.');
    console.log('   - This causes the GL to be unbalanced.');
    console.log('\n2. ⚠️  Accounts Receivable balance calculation');
    console.log('   - AR should be the UNPAID balance (118,000 - 50,000 = 68,000)');
    console.log('   - Payment should reduce AR with a credit entry');

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

const invoiceRefNumber = process.argv[2] || 'INV-20251118-0002';
explainExpectedGL(invoiceRefNumber);

