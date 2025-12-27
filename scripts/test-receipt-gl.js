require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function testReceiptGL(receiptRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log(`🔍 Testing Receipt: ${receiptRefNumber}\n`);
    console.log('='.repeat(100));

    // Get receipt details
    const receiptResult = await sequelize.query(`
      SELECT 
        r.*,
        si."invoice_ref_number",
        si."total_amount" as invoice_total,
        si."paid_amount" as invoice_paid,
        si."balance_amount" as invoice_balance,
        c."full_name" as customer_name,
        a.code as account_code,
        a.name as account_name
      FROM receipts r
      LEFT JOIN sales_invoices si ON r."sales_invoice_id" = si.id
      LEFT JOIN customers c ON r."customer_id" = c.id
      LEFT JOIN accounts a ON r."asset_account_id" = a.id
      WHERE r."receipt_reference_number" = :receiptRefNumber
      LIMIT 1
    `, {
      replacements: { receiptRefNumber },
      type: QueryTypes.SELECT
    });

    if (!receiptResult || receiptResult.length === 0) {
      console.log(`❌ Receipt not found: ${receiptRefNumber}`);
      await sequelize.close();
      return;
    }

    const receipt = receiptResult[0];
    console.log('\n📄 RECEIPT DETAILS:');
    console.log(`   Reference: ${receipt.receipt_ref_number}`);
    console.log(`   Date: ${receipt.receipt_date}`);
    console.log(`   Customer: ${receipt.customer_name || 'N/A'}`);
    console.log(`   Amount: ${parseFloat(receipt.payment_amount || 0).toFixed(2)}`);
    console.log(`   Payment Method: ${receipt.payment_method || 'N/A'}`);
    console.log(`   Payment Account: ${receipt.account_code || 'N/A'} - ${receipt.account_name || 'N/A'}`);
    console.log(`   Related Invoice: ${receipt.invoice_ref_number || 'N/A'}`);
    if (receipt.invoice_ref_number) {
      console.log(`   Invoice Total: ${parseFloat(receipt.invoice_total || 0).toFixed(2)}`);
      console.log(`   Invoice Paid: ${parseFloat(receipt.invoice_paid || 0).toFixed(2)}`);
      console.log(`   Invoice Balance: ${parseFloat(receipt.invoice_balance || 0).toFixed(2)}`);
    }
    console.log(`   Status: ${receipt.status || 'N/A'}\n`);

    // Get all GL entries for this receipt
    // Note: GL entries for payments use the invoice reference number, not receipt reference
    console.log('💰 GENERAL LEDGER ENTRIES:');
    console.log('-'.repeat(100));

    // Search by receipt reference first, then by invoice reference if receipt not found
    let glEntries = await sequelize.query(`
      SELECT 
        gl.*
      FROM general_ledger gl
      WHERE gl."reference_number" LIKE :pattern
        AND gl."companyId" = :companyId
        AND gl."transaction_type" = 'INVOICE_PAYMENT'
      ORDER BY gl."account_nature" ASC, gl."account_name" ASC
    `, {
      replacements: { 
        pattern: `${receiptRefNumber}%`,
        companyId: receipt.companyId
      },
      type: QueryTypes.SELECT
    });

    // If no entries found with receipt ref, try invoice reference
    if (glEntries.length === 0 && receipt.invoice_ref_number) {
      glEntries = await sequelize.query(`
        SELECT 
          gl.*
        FROM general_ledger gl
        WHERE gl."reference_number" = :invoiceRef
          AND gl."companyId" = :companyId
          AND gl."transaction_type" = 'INVOICE_PAYMENT'
          AND gl."description" LIKE :descPattern
        ORDER BY gl."account_nature" ASC, gl."account_name" ASC
      `, {
        replacements: { 
          invoiceRef: receipt.invoice_ref_number,
          companyId: receipt.companyId,
          descPattern: `%Payment%${receipt.invoice_ref_number}%`
        },
        type: QueryTypes.SELECT
      });
    }

    if (glEntries.length === 0) {
      console.log('❌ NO GENERAL LEDGER ENTRIES FOUND!');
      console.log('   This receipt may not have been posted to GL yet.\n');
    } else {
      console.log(`\n   Found ${glEntries.length} GL entries:\n`);

      let totalDebit = 0;
      let totalCredit = 0;

      glEntries.forEach((entry, index) => {
        const amount = parseFloat(entry.amount || 0);
        const nature = entry.account_nature?.toLowerCase();
        
        if (nature === 'debit') {
          totalDebit += amount;
        } else if (nature === 'credit') {
          totalCredit += amount;
        }

        console.log(`   ${index + 1}. ${nature?.toUpperCase() || 'N/A'}: ${entry.account_code || 'N/A'} - ${entry.account_name || 'N/A'}`);
        console.log(`      Amount: ${amount.toFixed(2)}`);
        console.log(`      Description: ${entry.description || 'N/A'}`);
        console.log(`      Reference: ${entry.reference_number || 'N/A'}`);
        console.log(`      Account ID: ${entry.account_id || 'N/A'}\n`);
      });

      console.log(`\n   Total Debit: ${totalDebit.toFixed(2)}`);
      console.log(`   Total Credit: ${totalCredit.toFixed(2)}`);
      console.log(`   Balance: ${(totalDebit - totalCredit).toFixed(2)} ${totalDebit === totalCredit ? '✅ BALANCED' : '❌ NOT BALANCED'}\n`);

      // Expected entries
      console.log('📊 EXPECTED ENTRIES:');
      console.log('-'.repeat(100));
      console.log(`\n   1. DEBIT - Payment Account (${receipt.account_code || 'Cash/Bank'}):`);
      console.log(`      Expected Amount: ${parseFloat(receipt.payment_amount || 0).toFixed(2)}`);
      const paymentEntry = glEntries.find(e => 
        e.account_id === receipt.asset_account_id && 
        e.account_nature?.toLowerCase() === 'debit'
      );
      if (paymentEntry) {
        const actualAmount = parseFloat(paymentEntry.amount || 0);
        const diff = Math.abs(parseFloat(receipt.payment_amount || 0) - actualAmount);
        if (diff < 0.01) {
          console.log(`      ✅ Actual: ${actualAmount.toFixed(2)} - MATCHES`);
        } else {
          console.log(`      ❌ Actual: ${actualAmount.toFixed(2)} - DIFF: ${diff.toFixed(2)}`);
        }
      } else {
        console.log(`      ❌ NOT FOUND`);
      }

      if (receipt.invoice_ref_number) {
        // Get AR account from invoice
        const invoiceResult = await sequelize.query(`
          SELECT 
            "account_receivable_id",
            c."default_receivable_account_id"
          FROM sales_invoices si
          LEFT JOIN customers c ON si."customer_id" = c.id
          WHERE si."invoice_ref_number" = :invoiceRefNumber
          LIMIT 1
        `, {
          replacements: { invoiceRefNumber: receipt.invoice_ref_number },
          type: QueryTypes.SELECT
        });

        if (invoiceResult && invoiceResult.length > 0) {
          const arAccountId = invoiceResult[0].account_receivable_id || invoiceResult[0].default_receivable_account_id;
          if (arAccountId) {
            const arAccount = await sequelize.query(`
              SELECT code, name FROM accounts WHERE id = :accountId LIMIT 1
            `, {
              replacements: { accountId: arAccountId },
              type: QueryTypes.SELECT
            });

            if (arAccount && arAccount.length > 0) {
              console.log(`\n   2. CREDIT - Accounts Receivable (${arAccount[0].code}):`);
              console.log(`      Expected Amount: ${parseFloat(receipt.payment_amount || 0).toFixed(2)}`);
              const arEntry = glEntries.find(e => 
                e.account_id === arAccountId && 
                e.account_nature?.toLowerCase() === 'credit'
              );
              if (arEntry) {
                const actualAmount = parseFloat(arEntry.amount || 0);
                const diff = Math.abs(parseFloat(receipt.payment_amount || 0) - actualAmount);
                if (diff < 0.01) {
                  console.log(`      ✅ Actual: ${actualAmount.toFixed(2)} - MATCHES`);
                } else {
                  console.log(`      ❌ Actual: ${actualAmount.toFixed(2)} - DIFF: ${diff.toFixed(2)}`);
                }
              } else {
                console.log(`      ❌ NOT FOUND`);
              }
            }
          }
        }
      }
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

const receiptRefNumber = process.argv[2] || 'RCP-20251118-0001';
testReceiptGL(receiptRefNumber);

