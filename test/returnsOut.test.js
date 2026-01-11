const request = require('supertest');
const app = require('../server');

describe('Returns Out API (smoke)', () => {
  test('POST /api/returns-out should require auth and validation', async () => {
    const res = await request(app).post('/api/returns-out').send({});
    expect([400,401]).toContain(res.status);
  });
});
