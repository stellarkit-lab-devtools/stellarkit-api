const request = require('supertest');
const cacheService = require('../src/services/cache');

let app;
let server;

describe('GET /fee-estimate', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/config/stellar', () => {
      const originalModule = jest.requireActual('../src/config/stellar');
      return {
        ...originalModule,
        server: {
          ledgers: jest.fn(),
          feeStats: jest.fn(),
        },
      };
    });

    ({ server } = require('../src/config/stellar'));
    app = require('../src/index');
    cacheService.flush();
  });

  it('includes new fields in the response', async () => {
    jest.spyOn(server, 'feeStats').mockResolvedValue({
      fee_charged: {
        min: '100',
        p10: '110',
        p50: '120',
        p95: '140',
        p99: '150',
        max: '160',
      },
      last_ledger_base_fee: '120',
      ledger_capacity_usage: '0.12',
    });

    jest.spyOn(server, 'ledgers').mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          { sequence: '500', base_fee_in_stroops: '100', successful_transaction_count: 100 },
          { sequence: '499', base_fee_in_stroops: '110', successful_transaction_count: 200 },
          { sequence: '498', base_fee_in_stroops: '120', successful_transaction_count: 300 },
          { sequence: '497', base_fee_in_stroops: '130', successful_transaction_count: 400 },
          { sequence: '496', base_fee_in_stroops: '140', successful_transaction_count: 500 },
        ],
      }),
    });

    const res = await request(app).get('/fee-estimate?operations=2');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    expect(data).toHaveProperty('operationCount');
    expect(data).toHaveProperty('perOperation');
    expect(data).toHaveProperty('context');
    expect(typeof data.context).toBe('string');
    expect(data).toHaveProperty('networkCongestion');
    expect(['low', 'medium', 'high']).toContain(data.networkCongestion);
    expect(data).toHaveProperty('recommendation');
    expect(typeof data.recommendation).toBe('string');
    expect(data).toHaveProperty('history');
    expect(Array.isArray(data.history)).toBe(true);
    expect(data.history).toHaveLength(5);
    expect(data.history[0]).toEqual({
      ledger: 500,
      baseFee: 100,
      capacityUsage: 0.1,
    });
    expect(data.history[4]).toEqual({
      ledger: 496,
      baseFee: 140,
      capacityUsage: 0.5,
    });
  });
});
