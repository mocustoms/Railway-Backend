require('dotenv').config();
const sequelize = require('../config/database');
const {
  SalesInvoice,
  GeneralLedger,
  Receipt,
  Account
} = require('../server/models');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');
const { Op } = require('sequelize');

let mockReq = {
  user: {
    companyId: process.env.COMPANY_ID || null,
    id: process.env.USER_ID || '00000000-0000-0000-0000-000000000000',
    username: 'system',
    first_name: 'System',
    last_name: 'User'
  }
};

async function fixInvoiceGLEntries(invoiceRefNumber) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('\n' + '='.repeat(80));
    console.log('Fixing General Ledger Entries for Invoice:', invoiceRefNumber);
    console.log('='.repeat(80) + '\n');

    // Find invoice
    const invoice = await SalesInvoice.findOne({
      where: buildCompanyWhere(mockReq, { invoice_ref_number: invoiceRefNumber }),
      attributes: ['id', 'invoice_ref_number', 'account_receivable_id', 'companyId']
    });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceRefNumber} not found`);
    }

    if (!mockReq.user.companyId && invoice.companyId) {
      mockReq.user.companyId = invoice.companyId;
    }

    // Get a real user ID
    const { User } = require('../server/models');
    if (mockReq.user.id === '00000000-0000-0000-0000-000000000000') {
      const realUser = await User.findOne({
        where: buildCompanyWhere(mockReq, {}),
        attributes: ['id', 'username', 'first_name', 'last_name'],
        transaction
      });
      if (realUser) {
        mockReq.user.id = realUser.id;
        mockReq.user.username = realUser.username;
        mockReq.user.first_name = realUser.first_name;
        mockReq.user.last_name = realUser.last_name;
      }
    }

    console.log('Invoice:', invoice.invoice_ref_number);
    console.log('Receivable Account ID:', invoice.account_receivable_id);

    // Get the correct receivable account
    const receivableAccount = await Account.findOne({
      where: buildCompanyWhere(mockReq, { id: invoice.account_receivable_id }),
      transaction
    });

    if (!receivableAccount) {
      throw new Error('Receivable account not found');
    }

    console.log('Receivable Account:', receivableAccount.name, `(${receivableAccount.code})`);

    // Find receipts with loyalty points
    const receipts = await Receipt.findAll({
      where: buildCompanyWhere(mockReq, {
        salesInvoiceId: invoice.id,
        useLoyaltyPoints: true
      }),
      transaction
    });

    if (receipts.length === 0) {
      console.log('No loyalty point receipts found');
      await transaction.rollback();
      return;
    }

    // Get all GL entries for this invoice
    const glEntries = await GeneralLedger.findAll({
      where: buildCompanyWhere(mockReq, {
        reference_number: invoiceRefNumber,
        transaction_type: 'INVOICE_PAYMENT'
      }),
      transaction
    });

    console.log(`\nFound ${glEntries.length} GL entries`);

    // Find the credit entry that's incorrectly using Loyalty Cards account
    for (const entry of glEntries) {
      if (entry.account_nature === 'credit') {
        console.log(`\nChecking Credit Entry:`);
        console.log(`  Current Account: ${entry.account_name} (${entry.account_code})`);
        console.log(`  Expected Account: ${receivableAccount.name} (${receivableAccount.code})`);
        
        // Check if it's using the wrong account
        if (entry.account_id !== receivableAccount.id) {
          console.log(`  ❌ Wrong account! Fixing...`);
          
          // Update the credit entry to use the correct receivable account
          await entry.update({
            account_id: receivableAccount.id,
            account_name: receivableAccount.name,
            account_code: receivableAccount.code,
            account_type_code: receivableAccount.type || 'ASSET',
            account_type_name: receivableAccount.type || 'Asset',
            updated_by_code: mockReq.user.id,
            updated_by_name: `${mockReq.user.first_name} ${mockReq.user.last_name}`
          }, { transaction });
          
          console.log(`  ✅ Updated to use Receivable Account`);
        } else {
          console.log(`  ✅ Already using correct account`);
        }
      }
    }

    // Verify the fix
    const updatedEntries = await GeneralLedger.findAll({
      where: buildCompanyWhere(mockReq, {
        reference_number: invoiceRefNumber,
        transaction_type: 'INVOICE_PAYMENT'
      }),
      transaction
    });

    let totalDebit = 0;
    let totalCredit = 0;

    console.log(`\n` + '='.repeat(80));
    console.log('Updated GL Entries:');
    console.log('='.repeat(80));

    for (const entry of updatedEntries) {
      const amount = parseFloat(entry.amount || 0);
      console.log(`\n${entry.account_nature.toUpperCase()}: ${entry.account_name} (${entry.account_code}) = ${amount.toFixed(2)}`);
      
      if (entry.account_nature === 'debit') {
        totalDebit += amount;
      } else {
        totalCredit += amount;
      }
    }

    console.log(`\nTotal Debit:  ${totalDebit.toFixed(2)}`);
    console.log(`Total Credit: ${totalCredit.toFixed(2)}`);
    console.log(`Difference:   ${Math.abs(totalDebit - totalCredit).toFixed(2)}`);

    if (Math.abs(totalDebit - totalCredit) < 0.01) {
      console.log('\n✅ GL entries are balanced');
    } else {
      console.log('\n❌ GL entries are NOT balanced');
    }

    // Verify correct accounts
    const loyaltyDebit = updatedEntries.find(e => 
      e.account_nature === 'debit' && 
      e.transaction_type_name && 
      e.transaction_type_name.includes('Loyalty')
    );
    const receivableCredit = updatedEntries.find(e => 
      e.account_nature === 'credit' && 
      e.account_id === receivableAccount.id
    );

    if (loyaltyDebit && receivableCredit) {
      console.log('\n✅ Account Structure:');
      console.log(`   Debit: ${loyaltyDebit.account_name} (Loyalty Account)`);
      console.log(`   Credit: ${receivableCredit.account_name} (Receivable Account)`);
    } else {
      console.log('\n⚠️  Account structure verification failed');
    }

    await transaction.commit();
    console.log('\n' + '='.repeat(80));
    console.log('✅ GL entries fixed successfully!');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    await transaction.rollback();
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await sequelize.close();
  }
}

const invoiceRefNumber = process.argv[2] || 'INV-20251114-0001';
fixInvoiceGLEntries(invoiceRefNumber)
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

