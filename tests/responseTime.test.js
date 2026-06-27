const request = require('supertest');
const app = require('../src/app');

describe('X-Response-Time middleware', () => {
  it('attaches X-Response-Time header to every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-response-time']).toBeDefined();
  });

  it('header value is a number followed by ms', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-response-time']).toMatch(/^\d+\.\d+ms$/);
  });

  it('elapsed time is a positive number', async () => {
    const res = await request(app).get('/health');
    const ms = parseFloat(res.headers['x-response-time']);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
