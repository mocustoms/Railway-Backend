require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function debugRevenueCalculation(invoiceRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Get invoice with items
    const invoiceResult = await sequelize.query(`
      SELECT 
        si.*,
        sii.id as item_id,
        sii.quantity,
        sii."unit_price",
        sii."line_total",
        (sii.quantity * sii."unit_price") as calculated_line_subtotal
      FROM sales_invoices si
      JOIN sales_invoice_items sii ON si.id = sii."sales_invoice_id"
      WHERE si."invoice_ref_number" = :invoiceRefNumber
      ORDER BY sii."created_at" ASC
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
    console.log(`📄 Invoice: ${invoice.invoice_ref_number}\n`);
    console.log('Invoice Totals:');
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Discount: ${parseFloat(invoice.discount_amount || 0).toFixed(2)}`);
    console.log(`   Tax: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   WHT: ${parseFloat(invoice.total_wht_amount || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}\n`);

    console.log('Line Items:');
    let totalLineSubtotal = 0;
    invoiceResult.forEach((item, index) => {
      const lineSubtotal = parseFloat(item.calculated_line_subtotal || 0);
      totalLineSubtotal += lineSubtotal;
      console.log(`   Item ${index + 1}:`);
      console.log(`      Quantity: ${item.quantity}`);
      console.log(`      Unit Price: ${parseFloat(item.unit_price || 0).toFixed(2)}`);
      console.log(`      Calculated Subtotal (qty × price): ${lineSubtotal.toFixed(2)}`);
      console.log(`      Line Total (from DB): ${parseFloat(item.line_total || 0).toFixed(2)}\n`);
    });

    console.log(`Total Line Subtotal (sum of qty × price): ${totalLineSubtotal.toFixed(2)}`);
    console.log(`Invoice Subtotal (from DB): ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`Difference: ${Math.abs(totalLineSubtotal - parseFloat(invoice.subtotal || 0)).toFixed(2)}\n`);

    // Check GL entries
    const glEntries = await sequelize.query(`
      SELECT 
        "account_code",
        "account_name",
        "account_nature",
        amount,
        "user_credit_amount",
        description
      FROM general_ledger
      WHERE "reference_number" LIKE :pattern
        AND description LIKE '%Sales Revenue%'
      ORDER BY "created_at" ASC
    `, {
      replacements: { pattern: `${invoiceRefNumber}%` },
      type: QueryTypes.SELECT
    });

    if (glEntries.length > 0) {
      console.log('Sales Revenue GL Entry:');
      glEntries.forEach(entry => {
        console.log(`   Account: ${entry.account_code} - ${entry.account_name}`);
        console.log(`   Amount (system currency): ${parseFloat(entry.amount || 0).toFixed(2)}`);
        console.log(`   Amount (invoice currency): ${parseFloat(entry.user_credit_amount || 0).toFixed(2)}`);
        console.log(`   Description: ${entry.description}\n`);
      });
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

const invoiceRefNumber = process.argv[2] || 'INV-20251118-0004';
debugRevenueCalculation(invoiceRefNumber);

