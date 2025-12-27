require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function listRecentInvoices() {
  // Use local database - override DATABASE_URL if needed
  // Default local connection: postgresql://postgres:postgres@localhost:5432/easymauzo_pos
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to LOCAL database\n');
    console.log(`📊 Database: ${localDbUrl.split('@')[1] || 'local'}\n`);

    // Use raw query to see all invoices
    const rawInvoices = await sequelize.query(`
      SELECT 
        id,
        "invoice_ref_number",
        status,
        "total_amount",
        "companyId",
        "created_at"
      FROM sales_invoices
      ORDER BY "created_at" DESC
      LIMIT 20
    `, { type: QueryTypes.SELECT });

    console.log(`📋 Found ${rawInvoices.length} invoices\n`);

    if (rawInvoices.length > 0) {
      console.log('Recent invoices:\n');
      rawInvoices.forEach((inv, index) => {
        console.log(`${index + 1}. ${inv.invoice_ref_number} - Status: ${inv.status} - Amount: ${parseFloat(inv.total_amount || 0).toFixed(2)} - Company: ${inv.companyId} - Created: ${inv.created_at}`);
      });
    } else {
      console.log('❌ No invoices found in database');
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

listRecentInvoices();

