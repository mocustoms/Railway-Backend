const sequelize = require('../config/database');
const { Customer, LoyaltyCard, LoyaltyCardConfig, LoyaltyTransaction, SalesInvoice } = require('../server/models');

async function checkCustomerLoyalty(customerCode, invoiceRef) {
  try {
    console.log(`\n🔍 Checking Customer Loyalty for: ${customerCode}\n`);
    console.log('='.repeat(80));

    // Find customer by ID (customerCode might be the ID or we need to find by invoice)
    let customer;
    
    // First try to find by invoice to get customer
    if (invoiceRef) {
      const invoice = await SalesInvoice.findOne({
        where: { invoice_ref_number: invoiceRef },
        include: [{ model: Customer, as: 'customer' }]
      });
      
      if (invoice && invoice.customer) {
        customer = invoice.customer;
      }
    }
    
    // If not found via invoice, try to find by ID (assuming customerCode is actually an ID)
    if (!customer) {
      customer = await Customer.findByPk(customerCode);
    }

    if (!customer) {
      console.error(`❌ Customer ${customerCode} not found`);
      return;
    }

    console.log(`✅ Customer Found: ${customer.full_name}`);
    console.log(`   ID: ${customer.id}`);
    console.log(`   Code: ${customer.customer_code}`);
    console.log(`   Loyalty Card Number: ${customer.loyalty_card_number || 'N/A'}`);
    console.log(`   Loyalty Card Config ID: ${customer.loyalty_card_config_id || 'N/A'}`);
    console.log(`   Loyalty Points: ${customer.loyalty_points || 0}`);

    // Check loyalty card
    if (customer.loyalty_card_number) {
      const loyaltyCard = await LoyaltyCard.findOne({
        where: { card_number: customer.loyalty_card_number }
      });

      if (loyaltyCard) {
        console.log(`\n✅ Loyalty Card Found: ${loyaltyCard.card_number}`);
        console.log(`   Current Points: ${loyaltyCard.current_points || 0}`);
        console.log(`   Total Points Earned: ${loyaltyCard.total_points_earned || 0}`);
        console.log(`   Total Points Redeemed: ${loyaltyCard.total_points_redeemed || 0}`);
        console.log(`   Status: ${loyaltyCard.is_active ? 'Active' : 'Inactive'}`);
      } else {
        console.log(`\n❌ Loyalty Card ${customer.loyalty_card_number} not found in database`);
      }
    }

    // Check loyalty config
    if (customer.loyalty_card_config_id) {
      const loyaltyConfig = await LoyaltyCardConfig.findByPk(customer.loyalty_card_config_id);
      if (loyaltyConfig) {
        console.log(`\n✅ Loyalty Config Found: ${loyaltyConfig.id}`);
        console.log(`   Points per Currency Unit: ${loyaltyConfig.points_per_currency_unit || 'N/A'}`);
        console.log(`   Points Percentage: ${loyaltyConfig.points_percentage || 'N/A'}`);
      } else {
        console.log(`\n❌ Loyalty Config ${customer.loyalty_card_config_id} not found`);
      }
    }

    // Check invoice
    if (invoiceRef) {
      const invoice = await SalesInvoice.findOne({
        where: { invoice_ref_number: invoiceRef }
      });

      if (invoice) {
        console.log(`\n✅ Invoice Found: ${invoiceRef}`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Subtotal: ${invoice.subtotal}`);
        console.log(`   Total Amount: ${invoice.total_amount}`);

        // Check loyalty transactions for this invoice
        const loyaltyTransactions = await LoyaltyTransaction.findAll({
          where: { sales_invoice_id: invoice.id }
        });

        console.log(`\n📊 Loyalty Transactions for Invoice:`);
        if (loyaltyTransactions.length > 0) {
          loyaltyTransactions.forEach(lt => {
            console.log(`   ✅ Transaction: ${lt.transaction_ref_number}`);
            console.log(`      Points: ${lt.points_amount}`);
            console.log(`      Type: ${lt.transaction_type}`);
            console.log(`      Status: ${lt.status}`);
          });
        } else {
          console.log(`   ❌ No loyalty transactions found for this invoice`);
          console.log(`\n   ⚠️  Expected: A loyalty transaction should have been created during approval`);
          console.log(`      Check if:`);
          console.log(`      1. Customer has loyalty_card_number: ${customer.loyalty_card_number || 'NO'}`);
          console.log(`      2. Customer has loyalty_card_config_id: ${customer.loyalty_card_config_id || 'NO'}`);
          console.log(`      3. Invoice status is approved: ${invoice.status === 'approved' ? 'YES' : 'NO'}`);
        }
      }
    }

    console.log(`\n${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

const customerCode = process.argv[2] || 'CUST-20251110-0002';
const invoiceRef = process.argv[3] || 'INV-20251110-0008';

checkCustomerLoyalty(customerCode, invoiceRef);

