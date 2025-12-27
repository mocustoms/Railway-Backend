require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function checkProductCost(invoiceRefNumber) {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Get invoice items with product details
    const invoiceResult = await sequelize.query(`
      SELECT 
        si."invoice_ref_number",
        sii.id as item_id,
        sii.quantity,
        sii."unit_price",
        sii."line_total",
        p.id as product_id,
        p.code as product_code,
        p.name as product_name,
        p."product_type",
        p."average_cost",
        p."selling_price",
        pc.name as category_name
      FROM sales_invoices si
      JOIN sales_invoice_items sii ON si.id = sii."sales_invoice_id"
      LEFT JOIN products p ON sii."product_id" = p.id
      LEFT JOIN product_categories pc ON p."category_id" = pc.id
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

    console.log(`📄 Invoice: ${invoiceResult[0].invoice_ref_number}\n`);
    console.log('='.repeat(100));
    console.log('📦 PRODUCT COST ANALYSIS:\n');

    invoiceResult.forEach((item, index) => {
      console.log(`Item ${index + 1}: ${item.product_name || 'Unknown Product'}`);
      console.log(`   Product Code: ${item.product_code || 'N/A'}`);
      console.log(`   Category: ${item.category_name || 'N/A'}`);
      console.log(`   Product Type: ${item.product_type || 'N/A'}`);
      console.log(`   Quantity: ${parseFloat(item.quantity || 0).toFixed(2)}`);
      console.log(`   Unit Price (Selling): ${parseFloat(item.unit_price || 0).toFixed(2)}`);
      console.log(`   Line Total: ${parseFloat(item.line_total || 0).toFixed(2)}`);
      console.log(`   Average Cost (COGS per unit): ${item.average_cost ? parseFloat(item.average_cost).toFixed(2) : 'NOT SET'}`);
      console.log(`   Selling Price (Product default): ${item.selling_price ? parseFloat(item.selling_price).toFixed(2) : 'NOT SET'}`);
      
      if (item.average_cost) {
        const cogsAmount = parseFloat(item.quantity || 0) * parseFloat(item.average_cost);
        console.log(`   📊 COGS Calculation: ${item.quantity} × ${parseFloat(item.average_cost).toFixed(2)} = ${cogsAmount.toFixed(2)}`);
      } else {
        console.log(`   ⚠️  WARNING: Average Cost is NOT SET - COGS cannot be calculated!`);
      }
      
      if (item.unit_price && item.average_cost) {
        const margin = parseFloat(item.unit_price) - parseFloat(item.average_cost);
        const marginPercent = (margin / parseFloat(item.unit_price)) * 100;
        console.log(`   💰 Profit Margin: ${margin.toFixed(2)} (${marginPercent.toFixed(2)}%)`);
      }
      
      console.log('');
    });

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

const invoiceRefNumber = process.argv[2] || 'INV-20251118-0001';
checkProductCost(invoiceRefNumber);

