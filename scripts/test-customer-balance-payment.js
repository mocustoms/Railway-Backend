require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function testCustomerBalancePayment(invoiceRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log(`🔍 Testing Customer Balance Payment for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(100));

    // Get invoice details
    const invoiceResult = await sequelize.query(`
      SELECT 
        si.*,
        c."full_name" as customer_name,
        c."deposit_balance",
        c."account_balance",
        c."debt_balance"
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
    console.log('\n📄 INVOICE DETAILS:');
    console.log(`   Reference: ${invoice.invoice_ref_number}`);
    console.log(`   Customer: ${invoice.customer_name || 'N/A'}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Paid: ${parseFloat(invoice.paid_amount || 0).toFixed(2)}`);
    console.log(`   Balance: ${parseFloat(invoice.balance_amount || 0).toFixed(2)}`);
    console.log(`   Customer Deposit Balance: ${parseFloat(invoice.deposit_balance || 0).toFixed(2)}`);
    console.log(`   Customer Account Balance: ${parseFloat(invoice.account_balance || 0).toFixed(2)}`);
    console.log(`   Customer Debt Balance: ${parseFloat(invoice.debt_balance || 0).toFixed(2)}\n`);

    // Get receipts for this invoice
    const receiptsResult = await sequelize.query(`
      SELECT 
        r.*,
        pt.name as payment_type_name,
        a.code as account_code,
        a.name as account_name
      FROM receipts r
      LEFT JOIN payment_types pt ON r."payment_type_id" = pt.id
      LEFT JOIN accounts a ON r."asset_account_id" = a.id
      WHERE r."sales_invoice_id" = :invoiceId
      ORDER BY r."created_at" DESC
    `, {
      replacements: { invoiceId: invoice.id },
      type: QueryTypes.SELECT
    });

    console.log('💳 RECEIPTS FOR THIS INVOICE:');
    console.log('-'.repeat(100));
    
    if (receiptsResult.length === 0) {
      console.log('   No receipts found for this invoice.\n');
    } else {
      receiptsResult.forEach((receipt, index) => {
        console.log(`\n   Receipt ${index + 1}: ${receipt.receipt_reference_number || 'N/A'}`);
        console.log(`      Amount: ${parseFloat(receipt.payment_amount || 0).toFixed(2)}`);
        console.log(`      Uses Customer Deposit: ${receipt.use_customer_deposit ? 'YES' : 'NO'}`);
        console.log(`      Deposit Amount: ${parseFloat(receipt.deposit_amount || 0).toFixed(2)}`);
        console.log(`      Uses Loyalty Points: ${receipt.use_loyalty_points ? 'YES' : 'NO'}`);
        console.log(`      Loyalty Points Amount: ${parseFloat(receipt.loyalty_points_amount || 0).toFixed(2)}`);
        console.log(`      Payment Type: ${receipt.payment_type_name || 'N/A'}`);
        console.log(`      Payment Account: ${receipt.account_code || 'N/A'} - ${receipt.account_name || 'N/A'}`);
        console.log(`      Status: ${receipt.status || 'N/A'}`);
      });
    }

    // Get GL entries for payment (using invoice reference)
    console.log('\n\n💰 GENERAL LEDGER ENTRIES FOR PAYMENT:');
    console.log('-'.repeat(100));

    const glEntries = await sequelize.query(`
      SELECT 
        gl.*
      FROM general_ledger gl
      WHERE gl."reference_number" = :invoiceRef
        AND gl."companyId" = :companyId
        AND gl."transaction_type" = 'INVOICE_PAYMENT'
      ORDER BY gl."account_nature" ASC, gl."account_name" ASC
    `, {
      replacements: { 
        invoiceRef: invoiceRefNumber,
        companyId: invoice.companyId
      },
      type: QueryTypes.SELECT
    });

    if (glEntries.length === 0) {
      console.log('❌ NO GENERAL LEDGER ENTRIES FOUND!');
      console.log('   Payment may not have been posted to GL yet.\n');
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
        console.log(`      Transaction Type: ${entry.transaction_type_name || 'N/A'}`);
        console.log('');
      });

      console.log(`\n   Total Debit: ${totalDebit.toFixed(2)}`);
      console.log(`   Total Credit: ${totalCredit.toFixed(2)}`);
      console.log(`   Balance: ${(totalDebit - totalCredit).toFixed(2)} ${totalDebit === totalCredit ? '✅ BALANCED' : '❌ NOT BALANCED'}\n`);

      // Check for customer deposit payment entries
      console.log('📊 EXPECTED ENTRIES FOR CUSTOMER DEPOSIT PAYMENT:');
      console.log('-'.repeat(100));

      // Find deposit payment receipt
      const depositReceipt = receiptsResult.find(r => r.use_customer_deposit && parseFloat(r.deposit_amount || 0) > 0);
      
      if (depositReceipt) {
        const depositAmount = parseFloat(depositReceipt.deposit_amount || 0);
        console.log(`\n   Customer Deposit Payment: ${depositAmount.toFixed(2)}\n`);

        // Get linked account for account_balance
        const linkedAccountResult = await sequelize.query(`
          SELECT 
            la."account_id",
            a.code,
            a.name
          FROM linked_accounts la
          LEFT JOIN accounts a ON la."account_id" = a.id
          WHERE la."account_type" = 'account_balance'
            AND la."companyId" = :companyId
          LIMIT 1
        `, {
          replacements: { companyId: invoice.companyId },
          type: QueryTypes.SELECT
        });

        if (linkedAccountResult && linkedAccountResult.length > 0) {
          const accountBalanceAccount = linkedAccountResult[0];
          console.log(`   1. DEBIT - Account Balance (Liability) Account: ${accountBalanceAccount.code} - ${accountBalanceAccount.name}`);
          console.log(`      Expected Amount: ${depositAmount.toFixed(2)}`);
          
          const liabilityEntry = glEntries.find(e => 
            e.account_id === accountBalanceAccount.account_id && 
            e.account_nature?.toLowerCase() === 'debit'
          );
          
          if (liabilityEntry) {
            const actualAmount = parseFloat(liabilityEntry.amount || 0);
            const diff = Math.abs(depositAmount - actualAmount);
            if (diff < 0.01) {
              console.log(`      ✅ Actual: ${actualAmount.toFixed(2)} - MATCHES`);
            } else {
              console.log(`      ❌ Actual: ${actualAmount.toFixed(2)} - DIFF: ${diff.toFixed(2)}`);
            }
          } else {
            console.log(`      ❌ NOT FOUND`);
          }
        } else {
          console.log(`   ⚠️  Account Balance account not configured in Linked Accounts`);
        }

        // Check AR credit
        const arAccountId = invoice.account_receivable_id;
        if (arAccountId) {
          const arAccount = await sequelize.query(`
            SELECT code, name FROM accounts WHERE id = :accountId LIMIT 1
          `, {
            replacements: { accountId: arAccountId },
            type: QueryTypes.SELECT
          });

          if (arAccount && arAccount.length > 0) {
            console.log(`\n   2. CREDIT - Accounts Receivable: ${arAccount[0].code} - ${arAccount[0].name}`);
            console.log(`      Expected Amount: ${depositAmount.toFixed(2)}`);
            
            const arEntry = glEntries.find(e => 
              e.account_id === arAccountId && 
              e.account_nature?.toLowerCase() === 'credit'
            );
            
            if (arEntry) {
              const actualAmount = parseFloat(arEntry.amount || 0);
              const diff = Math.abs(depositAmount - actualAmount);
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
      } else {
        console.log('\n   ℹ️  No customer deposit payment found in receipts.');
        console.log('   This invoice was not paid using customer deposit balance.\n');
      }
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

const invoiceRefNumber = process.argv[2];
if (!invoiceRefNumber) {
  console.log('Usage: node test-customer-balance-payment.js <INVOICE_REF_NUMBER>');
  console.log('Example: node test-customer-balance-payment.js INV-20251118-0001');
  process.exit(1);
}

testCustomerBalancePayment(invoiceRefNumber);

