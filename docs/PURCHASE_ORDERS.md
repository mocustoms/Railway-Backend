# Purchase Orders API

Endpoints

- POST /api/purchase-orders
- PUT /api/purchase-orders/:id
- GET /api/purchase-orders
- GET /api/purchase-orders/:id
- POST /api/purchase-orders/:id/receive
- DELETE /api/purchase-orders/:id

Create payload example

{
  "orderDate": "2026-01-12",
  "expectedDeliveryDate": "2026-01-20",
  "vendorId": "uuid-of-vendor",
  "storeId": "uuid-of-store",
  "currencyId": "uuid-of-currency",
  "exchangeRate": 1,
  "shippingCost": 10.00,
  "notes": "Optional notes",
  "items": [
    { "productId": "uuid-prod-1", "quantityOrdered": 5, "unitPrice": 12.50 },
    { "productId": "uuid-prod-2", "quantityOrdered": 2, "unitPrice": 100 }
  ]
}

Receive payload example

{
  "items": [ { "id": "purchase_order_item_id", "quantity": 3 } ]
}

Notes

- Authentication required. Routes are company-scoped.
- Creating a PO computes subtotal, discounts, taxes and total amount.
- Receiving goods updates `purchase_order_items.quantity_received` and increments `product_stores.quantity` for the target store.
