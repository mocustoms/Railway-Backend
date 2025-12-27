require('dotenv').config();
const path = require('path');
const { createDatabaseConnection } = require('../config/database');
const { QueryTypes } = require('sequelize');
const approveSalesInvoice = require('../server/utils/salesInvoiceApprovalHelper').approveSalesInvoice;

// We need to load models with the local connection
async function approveInvoiceDirect(invoiceRefNumber) {
  // Use local database connection
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  // Load models with this connection - we'll need to use raw queries and manual model creation
  // For simplicity, let's use the API approach or direct SQL
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Get invoice
    const invoiceResult = await sequelize.query(`
      SELECT 
        si.*,
        u.id as user_id,
        u.username,
        u."companyId"
      FROM sales_invoices si
      LEFT JOIN users u ON si."companyId" = u."companyId"
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

    const invoiceData = invoiceResult[0];
    console.log(`📄 Invoice: ${invoiceData.invoice_ref_number}`);
    console.log(`   Current Status: ${invoiceData.status}`);
    console.log(`   Subtotal: ${parseFloat(invoiceData.subtotal || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoiceData.total_amount || 0).toFixed(2)}\n`);

    if (invoiceData.status === 'approved') {
      console.log('✅ Invoice is already approved. Testing GL entries...\n');
    } else {
      // Get the invoice model instance with company filter
      const invoice = await SalesInvoice.findOne({
        where: { 
          id: invoiceData.id,
          companyId: invoiceData.companyId
        }
      });

      if (!invoice) {
        console.log('❌ Could not load invoice model');
        return;
      }

      // Create a mock request object for approval
      const mockReq = {
        user: {
          id: invoiceData.user_id || '00000000-0000-0000-0000-000000000000',
          username: invoiceData.username || 'system',
          companyId: invoiceData.companyId
        }
      };

      console.log('🔄 Approving invoice using approval helper...\n');
      
      const transaction = await sequelize.transaction();
      try {
        const approvalResults = await approveSalesInvoice(invoice, mockReq, transaction);
        
        // Update invoice status
        await invoice.update({
          status: 'approved',
          approved_at: new Date(),
          approved_by: mockReq.user.id,
          updated_by: mockReq.user.id
        }, { transaction });

        await transaction.commit();

        console.log('✅ Invoice approved successfully!');
        console.log(`   GL Entries Created: ${approvalResults.generalLedger.length}`);
        if (approvalResults.errors.length > 0) {
          console.log(`   Warnings: ${approvalResults.errors.length}`);
          approvalResults.errors.forEach(err => console.log(`      - ${err}`));
        }
        console.log('');
      } catch (error) {
        await transaction.rollback();
        console.error('❌ Error approving invoice:', error.message);
        console.error('Stack:', error.stack);
        throw error;
      }
    }

    // Now test the GL entries
    console.log('='.repeat(100));
    console.log('🧪 TESTING GENERAL LEDGER ENTRIES\n');
    
    // Execute test script in a new process
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const scriptPath = path.join(__dirname, 'test-invoice-accounts.js');
      const { stdout } = await execAsync(
        `node "${scriptPath}" ${invoiceRefNumber}`,
        { cwd: path.join(__dirname, '..') }
      );
      console.log(stdout);
    } catch (error) {
      console.error('Error running test:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

const invoiceRefNumber = process.argv[2] || 'INV-20251118-0004';
approveInvoiceDirect(invoiceRefNumber);

