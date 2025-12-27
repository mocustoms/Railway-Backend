const sequelize = require('../config/database');
const { Customer, SalesInvoice, LoyaltyCard } = require('../server/models');

async function updateCustomerLoyaltyCard(invoiceRef, cardNumber) {
  try {
    console.log(`\n🔍 Updating Customer Loyalty Card for Invoice: ${invoiceRef}\n`);
    console.log('='.repeat(80));

    // Find invoice
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRef },
      include: [{ model: Customer, as: 'customer' }]
    });

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceRef} not found`);
      return;
    }

    const customer = invoice.customer;
    if (!customer) {
      console.error(`❌ Customer not found for invoice`);
      return;
    }

    console.log(`✅ Customer Found: ${customer.full_name}`);
    console.log(`   Current Loyalty Card Number: ${customer.loyalty_card_number || 'N/A'}`);
    console.log(`   Loyalty Card Config ID: ${customer.loyalty_card_config_id || 'N/A'}`);

    // Update customer with loyalty card number
    await customer.update({
      loyalty_card_number: cardNumber
    });

    console.log(`\n✅ Updated customer with loyalty card number: ${cardNumber}`);
    console.log(`   Customer: ${customer.full_name}`);
    console.log(`   Loyalty Card Number: ${cardNumber}`);
    console.log(`   Loyalty Card Config ID: ${customer.loyalty_card_config_id || 'N/A'}`);

    // Check if loyalty card exists in loyalty_cards table
    try {
      const loyaltyCard = await LoyaltyCard.findOne({
        where: { card_number: cardNumber }
      });

      if (loyaltyCard) {
        console.log(`\n✅ Loyalty Card exists in database:`);
        console.log(`   Current Points: ${loyaltyCard.current_points || 0}`);
        console.log(`   Total Points Earned: ${loyaltyCard.total_points_earned || 0}`);
      } else {
        console.log(`\n⚠️  Loyalty Card ${cardNumber} not found in loyalty_cards table`);
        console.log(`   It will be created automatically during next invoice approval`);
      }
    } catch (error) {
      console.log(`\n⚠️  Could not check loyalty_cards table: ${error.message}`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Customer loyalty card updated successfully!`);
    console.log(`   Note: You may need to re-approve the invoice for loyalty points to be awarded`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

const invoiceRef = process.argv[2] || 'INV-20251110-0008';
const cardNumber = process.argv[3] || '000001';

updateCustomerLoyaltyCard(invoiceRef, cardNumber);

