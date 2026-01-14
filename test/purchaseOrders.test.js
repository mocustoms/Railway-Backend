const request = require('supertest');
const app = require('../server');

describe('Purchase Orders API (smoke)', () => {
  test('POST /api/purchase-orders requires auth (401 or validation)', async () => {
    const res = await request(app).post('/api/purchase-orders').send({});
    // server may return 401 for missing auth or 400 for validation; accept either
    expect([400,401]).toContain(res.status);
  });
});
