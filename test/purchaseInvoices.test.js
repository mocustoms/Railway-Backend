const request = require('supertest');
const app = require('../server');

describe('Purchase Invoices API (smoke)', () => {
  test('POST /api/purchase-invoices requires auth/validation', async () => {
    const res = await request(app).post('/api/purchase-invoices').send({});
    expect([400,401]).toContain(res.status);
  });
});
