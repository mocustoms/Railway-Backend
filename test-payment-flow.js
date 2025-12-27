/**
 * Test Script: Test Payment Flow for Invoice INV-20251111-0029
 * Simulates a "Pay All" payment request
 */

const axios = require('axios');
const config = require('./env');

// Test credentials
const TEST_CREDENTIALS = {
  username: 'mohamed',
  password: 'Admin@123'
};

const BASE_URL = `http://localhost:${config.PORT || 3000}`;
const INVOICE_REF = 'INV-20251111-0029';

async function testPaymentFlow() {
  try {
    console.log('🧪 Testing Payment Flow for Invoice:', INVOICE_REF);
    console.log('='.repeat(80));

    // Step 1: Login to get authentication token
    console.log('\n1️⃣  Logging in...');
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      username: TEST_CREDENTIALS.username,
      password: TEST_CREDENTIALS.password
    }, {
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Extract cookies from response
    const setCookieHeaders = loginResponse.headers['set-cookie'] || [];
    const cookieString = setCookieHeaders.map(cookie => cookie.split(';')[0]).join('; ');
    
    // Extract CSRF token from cookies
    let csrfToken = '';
    const csrfCookie = setCookieHeaders.find(c => c.startsWith('csrf_token='));
    if (csrfCookie) {
      csrfToken = csrfCookie.split('=')[1].split(';')[0];
    }
    
    // If not in cookies, try to get it from the endpoint
    if (!csrfToken) {
      try {
        const csrfResponse = await axios.get(`${BASE_URL}/api/auth/csrf-token`, {
          withCredentials: true,
          headers: {
            'Cookie': cookieString
          }
        });
        csrfToken = csrfResponse.data.csrfToken || csrfResponse.data.token || '';
        // Update cookie string if new cookies were set
        const newCookies = csrfResponse.headers['set-cookie'] || [];
        if (newCookies.length > 0) {
          const newCookieString = newCookies.map(c => c.split(';')[0]).join('; ');
          cookieString = cookieString ? `${cookieString}; ${newCookieString}` : newCookieString;
        }
      } catch (e) {
        console.log('⚠️  Could not get CSRF token from endpoint');
      }
    }

    console.log('✅ Login successful');
    console.log(`   Cookies: ${cookieString ? 'Set' : 'Not set'}`);
    console.log(`   CSRF Token: ${csrfToken ? 'Set' : 'Not set'}`);

    // Create axios instance with default config for authenticated requests
    // Note: We'll update headers per request since cookieString might change
    const apiClient = axios.create({
      baseURL: BASE_URL,
      withCredentials: true
    });
    
    // Add request interceptor to include cookies and CSRF token
    apiClient.interceptors.request.use(config => {
      config.headers = config.headers || {};
      if (cookieString) {
        config.headers['Cookie'] = cookieString;
      }
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
      return config;
    });

    // Step 2: Get the invoice details
    console.log('\n2️⃣  Fetching invoice details...');
    const invoiceResponse = await apiClient.get('/api/sales-invoices', {
      params: { search: INVOICE_REF }
    });

    // Handle different response structures
    let invoices = [];
    if (invoiceResponse.data.salesInvoices) {
      invoices = invoiceResponse.data.salesInvoices;
    } else if (invoiceResponse.data.invoices) {
      invoices = invoiceResponse.data.invoices;
    } else if (invoiceResponse.data.rows) {
      invoices = invoiceResponse.data.rows;
    } else if (Array.isArray(invoiceResponse.data)) {
      invoices = invoiceResponse.data;
    } else if (invoiceResponse.data) {
      invoices = [invoiceResponse.data];
    }

    const invoice = invoices.find(inv => 
      inv.invoiceRefNumber === INVOICE_REF || 
      inv.invoice_ref_number === INVOICE_REF ||
      inv.invoiceRefNumber?.includes(INVOICE_REF) ||
      inv.invoice_ref_number?.includes(INVOICE_REF)
    );

    if (!invoice || !invoice.id) {
      console.error('Invoice response:', JSON.stringify(invoiceResponse.data, null, 2));
      throw new Error(`Invoice ${INVOICE_REF} not found in response`);
    }

    const invoiceId = invoice.id;
    const balanceAmount = invoice.balanceAmount || invoice.balance_amount || 
                         (invoice.totalAmount || invoice.total_amount) - (invoice.paidAmount || invoice.paid_amount || 0);
    
    console.log('✅ Invoice found:');
    console.log(`   ID: ${invoiceId}`);
    console.log(`   Total Amount: ${invoice.totalAmount || invoice.total_amount}`);
    console.log(`   Paid Amount: ${invoice.paidAmount || invoice.paid_amount || 0}`);
    console.log(`   Balance Amount: ${balanceAmount}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Payment Status: ${invoice.paymentStatus || invoice.payment_status}`);

    if (!invoice.items || invoice.items.length === 0) {
      console.log('\n⚠️  Invoice has no items. Fetching full invoice details...');
      const fullInvoiceResponse = await apiClient.get(`/api/sales-invoices/${invoiceId}`);
      const fullInvoice = fullInvoiceResponse.data;
      invoice.items = fullInvoice.items || [];
    }

    // Step 3: Prepare payment data for "Pay All"
    console.log('\n3️⃣  Preparing "Pay All" payment data...');
    
    // Get full invoice details with items if not already loaded
    let fullInvoice = invoice;
    if (!invoice.items || invoice.items.length === 0) {
      console.log('   Fetching full invoice with items...');
      const fullInvoiceResponse = await apiClient.get(`/api/sales-invoices/${invoiceId}`);
      fullInvoice = fullInvoiceResponse.data;
    }
    
    // Calculate item-level payments (distribute payment proportionally or use item totals)
    const itemPayments = {};
    if (fullInvoice.items && fullInvoice.items.length > 0) {
      fullInvoice.items.forEach(item => {
        const itemId = item.id;
        // For "Pay All", use the remaining balance for each item
        const itemTotal = parseFloat(item.lineTotal || item.line_total || 0);
        const itemPaid = parseFloat(item.paidAmount || item.paid_amount || 0);
        const itemBalance = itemTotal - itemPaid;
        if (itemBalance > 0) {
          itemPayments[itemId] = itemBalance;
        }
      });
    }

    // Get a payment type ID (fetch first available payment type for debtor payments)
    let paymentTypeId = null;
    try {
      const paymentTypesResponse = await apiClient.get('/api/payment-types');
      let paymentTypes = [];
      if (paymentTypesResponse.data.paymentTypes) {
        paymentTypes = paymentTypesResponse.data.paymentTypes;
      } else if (paymentTypesResponse.data.rows) {
        paymentTypes = paymentTypesResponse.data.rows;
      } else if (Array.isArray(paymentTypesResponse.data)) {
        paymentTypes = paymentTypesResponse.data;
      }
      
      // Filter for payment types used in debtor payments and active
      const debtorPaymentTypes = paymentTypes.filter(pt => 
        (pt.usedInDebtorPayments || pt.used_in_debtor_payments) && 
        (pt.isActive !== false && pt.is_active !== false)
      );
      
      if (debtorPaymentTypes.length > 0) {
        paymentTypeId = debtorPaymentTypes[0].id;
        console.log(`   Using payment type: ${debtorPaymentTypes[0].name || debtorPaymentTypes[0].code} (${paymentTypeId})`);
      } else if (paymentTypes.length > 0) {
        // Fallback to any active payment type
        const activeTypes = paymentTypes.filter(pt => pt.isActive !== false && pt.is_active !== false);
        if (activeTypes.length > 0) {
          paymentTypeId = activeTypes[0].id;
          console.log(`   Using payment type (fallback): ${activeTypes[0].name || activeTypes[0].code} (${paymentTypeId})`);
        }
      }
      
      if (!paymentTypeId) {
        throw new Error('No payment types available');
      }
    } catch (e) {
      console.error('❌ Error fetching payment types:', e.message);
      throw new Error('Payment type is required but could not be fetched. Please ensure payment types are configured.');
    }

    const paymentData = {
      paymentAmount: parseFloat(balanceAmount),
      paymentTypeId: paymentTypeId,
      currencyId: fullInvoice.currencyId || fullInvoice.currency_id,
      exchangeRate: parseFloat(fullInvoice.exchangeRate || fullInvoice.exchange_rate || 1),
      transactionDate: new Date().toISOString().split('T')[0], // Today's date
      receivableAccountId: fullInvoice.accountReceivableId || fullInvoice.account_receivable_id || null,
      itemPayments: Object.keys(itemPayments).length > 0 ? itemPayments : undefined
    };

    console.log('✅ Payment data prepared:');
    console.log(`   Payment Amount: ${paymentData.paymentAmount}`);
    console.log(`   Currency ID: ${paymentData.currencyId}`);
    console.log(`   Exchange Rate: ${paymentData.exchangeRate}`);
    console.log(`   Transaction Date: ${paymentData.transactionDate}`);
    console.log(`   Item Payments: ${Object.keys(itemPayments).length} items`);

    // Step 4: Record the payment
    console.log('\n4️⃣  Recording payment...');
    console.log('   Sending payment request...');
    
    const paymentResponse = await apiClient.put(
      `/api/sales-invoices/${invoiceId}/record-payment`,
      paymentData
    );

    const updatedInvoice = paymentResponse.data;
    
    console.log('✅ Payment recorded successfully!');
    console.log('\n📊 Updated Invoice Status:');
    console.log(`   Reference: ${updatedInvoice.invoiceRefNumber || updatedInvoice.invoice_ref_number}`);
    console.log(`   Total Amount: ${updatedInvoice.totalAmount || updatedInvoice.total_amount}`);
    console.log(`   Paid Amount: ${updatedInvoice.paidAmount || updatedInvoice.paid_amount}`);
    console.log(`   Balance Amount: ${updatedInvoice.balanceAmount || updatedInvoice.balance_amount}`);
    console.log(`   Status: ${updatedInvoice.status}`);
    console.log(`   Payment Status: ${updatedInvoice.paymentStatus || updatedInvoice.payment_status}`);

    // Step 5: Verify payment was recorded
    console.log('\n5️⃣  Verifying payment was recorded...');
    const verifyResponse = await apiClient.get(`/api/sales-invoices/${invoiceId}`);

    const verifiedInvoice = verifyResponse.data;
    console.log('✅ Verification complete:');
    console.log(`   Final Balance: ${verifiedInvoice.balanceAmount || verifiedInvoice.balance_amount}`);
    console.log(`   Final Payment Status: ${verifiedInvoice.paymentStatus || verifiedInvoice.payment_status}`);

    if (parseFloat(verifiedInvoice.balanceAmount || verifiedInvoice.balance_amount || 0) === 0) {
      console.log('\n🎉 SUCCESS: Invoice is fully paid!');
    } else {
      console.log('\n⚠️  WARNING: Invoice still has a balance');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Payment flow test completed successfully!');

  } catch (error) {
    console.error('\n❌ Error testing payment flow:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.data?.message || error.message}`);
      console.error(`   Error: ${error.response.data?.error || 'Unknown error'}`);
      if (error.response.data?.details) {
        console.error(`   Details: ${JSON.stringify(error.response.data.details, null, 2)}`);
      }
      console.error(`   Full Response: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`   Error: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Run the test
testPaymentFlow();

