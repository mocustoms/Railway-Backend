/**
 * Script to show all equivalent amount values for an invoice across all tables
 * 
 * Usage: node scripts/show-equivalent-amounts.js INV-20251110-0019
 */

const sequelize = require('../config/database');
const {
  SalesInvoice,
  SalesInvoiceItem,
  GeneralLedger,
  ProductTransaction,
  ProductExpiryDate,
  ProductSerialNumber
} = require('../server/models');
const { Op } = require('sequelize');

async function showEquivalentAmounts(invoiceRefNumber) {
  try {
    console.log('💰 Equivalent Amount Analysis');
    console.log('='.repeat(80));
    console.log(`Invoice: ${invoiceRefNumber}\n`);

    // Find invoice
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        { model: SalesInvoiceItem, as: 'items' }
      ]
    });

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceRefNumber} not found`);
      process.exit(1);
    }

    console.log('📋 INVOICE EQUIVALENT AMOUNT');
    console.log('-'.repeat(80));
    console.log(`   Invoice Reference: ${invoice.invoice_ref_number}`);
    console.log(`   Total Amount (Invoice Currency): ${parseFloat(invoice.total_amount || 0).toLocaleString()}`);
    console.log(`   Equivalent Amount (System Currency): ${parseFloat(invoice.equivalent_amount || 0).toLocaleString()}`);
    console.log(`   Exchange Rate: ${parseFloat(invoice.exchange_rate || 1).toFixed(6)}`);
    console.log(`   Calculation: ${parseFloat(invoice.total_amount || 0).toLocaleString()} × ${parseFloat(invoice.exchange_rate || 1).toFixed(6)} = ${parseFloat(invoice.equivalent_amount || 0).toLocaleString()}`);
    console.log('');

    // ============================================
    // 1. GENERAL LEDGER EQUIVALENT AMOUNTS
    // ============================================
    console.log('1️⃣  GENERAL LEDGER - EQUIVALENT AMOUNTS');
    console.log('-'.repeat(80));
    try {
      const glEntries = await GeneralLedger.findAll({
        where: {
          reference_number: {
            [Op.like]: `${invoiceRefNumber}%`
          },
          companyId: invoice.companyId
        },
        order: [['reference_number', 'ASC']]
      });

      if (glEntries.length > 0) {
        let totalEquivalentDebit = 0;
        let totalEquivalentCredit = 0;
        let totalUserDebit = 0;
        let totalUserCredit = 0;

        glEntries.forEach((entry, index) => {
          const equivDebit = parseFloat(entry.equivalent_debit_amount || 0);
          const equivCredit = parseFloat(entry.equivalent_credit_amount || 0);
          const userDebit = parseFloat(entry.user_debit_amount || 0);
          const userCredit = parseFloat(entry.user_credit_amount || 0);

          totalEquivalentDebit += equivDebit;
          totalEquivalentCredit += equivCredit;
          totalUserDebit += userDebit;
          totalUserCredit += userCredit;

          console.log(`   Entry ${index + 1}: ${entry.reference_number}`);
          console.log(`      Account: ${entry.account_code} - ${entry.account_name}`);
          console.log(`      Nature: ${entry.account_nature}`);
          console.log(`      User Amount: ${entry.account_nature === 'debit' ? userDebit.toLocaleString() : userCredit.toLocaleString()}`);
          console.log(`      Equivalent Amount: ${entry.account_nature === 'debit' ? equivDebit.toLocaleString() : equivCredit.toLocaleString()}`);
          console.log(`      Exchange Rate: ${parseFloat(entry.exchange_rate || 1).toFixed(6)}`);
          if (entry.account_nature === 'debit') {
            console.log(`      Calculation: ${userDebit.toLocaleString()} × ${parseFloat(entry.exchange_rate || 1).toFixed(6)} = ${equivDebit.toLocaleString()}`);
          } else {
            console.log(`      Calculation: ${userCredit.toLocaleString()} × ${parseFloat(entry.exchange_rate || 1).toFixed(6)} = ${equivCredit.toLocaleString()}`);
          }
          console.log('');
        });

        console.log(`   📊 TOTALS:`);
        console.log(`      Total User Debit: ${totalUserDebit.toLocaleString()}`);
        console.log(`      Total User Credit: ${totalUserCredit.toLocaleString()}`);
        console.log(`      Total Equivalent Debit: ${totalEquivalentDebit.toLocaleString()}`);
        console.log(`      Total Equivalent Credit: ${totalEquivalentCredit.toLocaleString()}`);
        console.log(`      Balance Check: ${(totalEquivalentDebit - totalEquivalentCredit).toLocaleString()} (should be 0)`);
        console.log('');
      } else {
        console.log('   ❌ No GL entries found\n');
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 2. PRODUCT TRANSACTIONS EQUIVALENT AMOUNTS
    // ============================================
    console.log('2️⃣  PRODUCT TRANSACTIONS - EQUIVALENT AMOUNTS');
    console.log('-'.repeat(80));
    try {
      const productTransactions = await ProductTransaction.findAll({
        where: {
          reference_number: invoiceRefNumber,
          companyId: invoice.companyId
        }
      });

      if (productTransactions.length > 0) {
        productTransactions.forEach((pt, index) => {
          const userUnitCost = parseFloat(pt.user_unit_cost || 0);
          const exchangeRate = parseFloat(pt.exchange_rate || 1);
          const equivalentUnitCost = userUnitCost * exchangeRate;
          const quantityOut = parseFloat(pt.quantity_out || 0);
          const totalEquivalentValue = equivalentUnitCost * quantityOut;

          console.log(`   Transaction ${index + 1}:`);
          console.log(`      Product ID: ${pt.product_id}`);
          console.log(`      User Unit Cost: ${userUnitCost.toLocaleString()}`);
          console.log(`      Exchange Rate: ${exchangeRate.toFixed(6)}`);
          console.log(`      Equivalent Unit Cost: ${equivalentUnitCost.toLocaleString()} (${userUnitCost.toLocaleString()} × ${exchangeRate.toFixed(6)})`);
          console.log(`      Quantity Out: ${quantityOut.toLocaleString()}`);
          console.log(`      Total Equivalent Value: ${totalEquivalentValue.toLocaleString()} (${equivalentUnitCost.toLocaleString()} × ${quantityOut.toLocaleString()})`);
          console.log('');
        });
      } else {
        console.log('   ❌ No product transactions found\n');
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 3. PRODUCT EXPIRY EQUIVALENT AMOUNTS
    // ============================================
    console.log('3️⃣  PRODUCT EXPIRY - EQUIVALENT AMOUNTS');
    console.log('-'.repeat(80));
    try {
      if (invoice.items) {
        for (const item of invoice.items) {
          if (item.batch_number) {
            const expiry = await ProductExpiryDate.findOne({
              where: {
                product_id: item.product_id,
                batch_number: item.batch_number,
                companyId: invoice.companyId
              }
            });

            if (expiry) {
              const unitCost = parseFloat(expiry.unit_cost || 0);
              const exchangeRate = parseFloat(invoice.exchange_rate || 1);
              const equivalentUnitCost = unitCost * exchangeRate;
              const quantitySold = parseFloat(item.quantity || 0);
              const totalEquivalentValue = equivalentUnitCost * quantitySold;

              console.log(`   Batch: ${item.batch_number}`);
              console.log(`      Product ID: ${item.product_id}`);
              console.log(`      Unit Cost: ${unitCost.toLocaleString()}`);
              console.log(`      Exchange Rate: ${exchangeRate.toFixed(6)}`);
              console.log(`      Equivalent Unit Cost: ${equivalentUnitCost.toLocaleString()} (${unitCost.toLocaleString()} × ${exchangeRate.toFixed(6)})`);
              console.log(`      Quantity Sold: ${quantitySold.toLocaleString()}`);
              console.log(`      Total Equivalent Value: ${totalEquivalentValue.toLocaleString()} (${equivalentUnitCost.toLocaleString()} × ${quantitySold.toLocaleString()})`);
              console.log('');
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }

    // ============================================
    // 4. PRODUCT SERIAL NUMBERS EQUIVALENT AMOUNTS
    // ============================================
    console.log('4️⃣  PRODUCT SERIAL NUMBERS - EQUIVALENT AMOUNTS');
    console.log('-'.repeat(80));
    try {
      if (invoice.items) {
        for (const item of invoice.items) {
          if (item.serial_numbers && Array.isArray(item.serial_numbers) && item.serial_numbers.length > 0) {
            for (const serialNumber of item.serial_numbers) {
              const serial = await ProductSerialNumber.findOne({
                where: {
                  product_id: item.product_id,
                  serial_number: serialNumber,
                  store_id: invoice.store_id,
                  companyId: invoice.companyId
                }
              });

              if (serial) {
                const unitCost = parseFloat(serial.unit_cost || 0);
                const exchangeRate = parseFloat(serial.exchange_rate || invoice.exchange_rate || 1);
                const equivalentUnitCost = parseFloat(serial.unit_cost_equivalent || 0) || (unitCost * exchangeRate);

                console.log(`   Serial Number: ${serialNumber}`);
                console.log(`      Product ID: ${item.product_id}`);
                console.log(`      Unit Cost: ${unitCost.toLocaleString()}`);
                console.log(`      Exchange Rate: ${exchangeRate.toFixed(6)}`);
                console.log(`      Equivalent Unit Cost: ${equivalentUnitCost.toLocaleString()}`);
                console.log(`      Equivalent Amount (stored): ${parseFloat(serial.equivalent_amount || 0).toLocaleString()}`);
                console.log('');
              }
            }
          }
        }
        if (!invoice.items.some(item => item.serial_numbers && item.serial_numbers.length > 0)) {
          console.log('   ℹ️  No serial numbers in invoice items\n');
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }

    // ============================================
    // SUMMARY
    // ============================================
    console.log('='.repeat(80));
    console.log('📊 EQUIVALENT AMOUNT SUMMARY');
    console.log('='.repeat(80));
    console.log(`Invoice: ${invoiceRefNumber}`);
    console.log(`Invoice Equivalent Amount: ${parseFloat(invoice.equivalent_amount || 0).toLocaleString()}`);
    console.log(`Exchange Rate: ${parseFloat(invoice.exchange_rate || 1).toFixed(6)}`);
    console.log('');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Get invoice reference number from command line
const invoiceRefNumber = process.argv[2];

if (!invoiceRefNumber) {
  console.error('❌ Please provide an invoice reference number');
  console.error('Usage: node scripts/show-equivalent-amounts.js INV-20251110-0019');
  process.exit(1);
}

showEquivalentAmounts(invoiceRefNumber);

