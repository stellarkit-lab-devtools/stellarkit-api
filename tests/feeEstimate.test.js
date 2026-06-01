const request = require('supertest');
const app = require('../src/index');

describe('GET /fee-estimate', () => {
  it('includes new fields in the response', async () => {
    const res = await request(app).get('/fee-estimate?operations=2');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    // Existing fields
    expect(data).toHaveProperty('operationCount');
    expect(data).toHaveProperty('perOperation');
    // New fields
    expect(data).toHaveProperty('context');
    expect(typeof data.context).toBe('string');
    expect(data).toHaveProperty('networkCongestion');
    expect(['low', 'medium', 'high']).toContain(data.networkCongestion);
    expect(data).toHaveProperty('recommendation');
    expect(typeof data.recommendation).toBe('string');
  });
});
