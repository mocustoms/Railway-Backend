# Purchase Invoices API

Endpoints

- POST /api/purchase-invoices
- PUT /api/purchase-invoices/:id
- GET /api/purchase-invoices
- GET /api/purchase-invoices/:id
- POST /api/purchase-invoices/:id/post
- POST /api/purchase-invoices/:id/pay
- DELETE /api/purchase-invoices/:id

Create payload example

{
  "invoiceDate": "2026-01-12",
  "dueDate": "2026-02-12",
  "vendorId": "uuid-of-vendor",
  "storeId": "uuid-of-store",
  "purchaseOrderId": "uuid-of-po",
  "currencyId": "uuid-of-currency",
  "exchangeRate": 1,
  "items": [
    { "productId": "uuid-prod-1", "quantity": 5, "unitPrice": 12.50 },
    { "description": "Service fee", "quantity": 1, "unitPrice": 50 }
  ]
}

Pay payload example

{
  "amount": 100.00,
  "method": "bank",
  "reference": "TRX123"
}

Notes

- Authentication required; routes are company-scoped.
- The service computes subtotals, discounts, taxes and totals.
- Posting an invoice sets its status to `posted` and indicates it's ready for payment/accounting.
- Payments reduce `balance_due` and create `purchase_invoice_payments` records.
