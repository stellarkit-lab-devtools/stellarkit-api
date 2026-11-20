'use strict';

const request = require('supertest');

// Mock the Stellar SDK before requiring the app so the route uses the mock.
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn(),
    },
  };
});

const { Horizon } = require('@stellar/stellar-sdk');

const app = require('../../src/app');

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Build a fake Horizon transaction record with a controlled createdAt.
 * @param {string} createdAt ISO timestamp
 * @param {string} [id]
 */
function makeTx(createdAt, id = 'tx') {
  return {
    id,
    created_at: createdAt,
    source_account: 'GSOURCE',
    successful: true,
  };
}

/**
 * Configure the mocked Horizon.Server so that:
 *  - loadAccount resolves for known accounts and rejects otherwise
 *  - transactions().forAccount().order().call() resolves with the given records
 */
function mockHorizon({ records = [], accountExists = true } = {}) {
  const call = jest.fn().mockResolvedValue({ records });
  const order = jest.fn().mockReturnValue({ call });
  const forAccount = jest.fn().mockReturnValue({ order });
  const transactions = jest.fn().mockReturnValue({ forAccount });

  const loadAccount = accountExists
    ? jest.fn().mockResolvedValue({ id: 'GACCOUNT', sequence: '1' })
    : jest.fn().mockRejectedValue(
        Object.assign(new Error('Account not found'), { response: { status: 404 } })
      );

  Horizon.Server.mockImplementation(() => ({
    loadAccount,
    transactions,
  }));

  return { loadAccount, transactions, forAccount, order, call };
}

describe('GET /account/:id/activity-heatmap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('response contains exactly 7 days each with exactly 24 hourly values', async () => {
    mockHorizon({ records: [] });

    const res = await request(app).get('/account/GACCOUNT/activity-heatmap');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('heatmap');

    const { heatmap } = res.body;
    expect(Object.keys(heatmap)).toHaveLength(7);
    for (const day of DAY_KEYS) {
      expect(heatmap).toHaveProperty(day);
      expect(Array.isArray(heatmap[day])).toBe(true);
      expect(heatmap[day]).toHaveLength(24);
      for (const value of heatmap[day]) {
        expect(typeof value).toBe('number');
      }
    }
  });

  test('a transaction at Monday 14:00 UTC increments heatmap.monday[14]', async () => {
    // 2024-01-01 is a Monday.
    mockHorizon({
      records: [makeTx('2024-01-01T14:00:00Z', 'tx-monday-14')],
    });

    const res = await request(app).get('/account/GACCOUNT/activity-heatmap');

    expect(res.status).toBe(200);
    expect(res.body.heatmap.monday[14]).toBe(1);
    // No other slot should be incremented.
    const total = DAY_KEYS.reduce(
      (sum, day) => sum + res.body.heatmap[day].reduce((a, b) => a + b, 0),
      0
    );
    expect(total).toBe(1);
  });

  test('peakDay and peakHour identify the busiest slot', async () => {
    // Wednesday 2024-01-03 at 09:00 UTC appears three times (busiest).
    // Monday 2024-01-01 at 14:00 UTC appears once.
    mockHorizon({
      records: [
        makeTx('2024-01-03T09:00:00Z', 'tx-wed-1'),
        makeTx('2024-01-03T09:15:00Z', 'tx-wed-2'),
        makeTx('2024-01-03T09:45:00Z', 'tx-wed-3'),
        makeTx('2024-01-01T14:00:00Z', 'tx-mon-1'),
      ],
    });

    const res = await request(app).get('/account/GACCOUNT/activity-heatmap');

    expect(res.status).toBe(200);
    expect(res.body.heatmap.wednesday[9]).toBe(3);
    expect(res.body.heatmap.monday[14]).toBe(1);
    expect(res.body.peakDay).toBe('wednesday');
    expect(res.body.peakHour).toBe(9);
  });

  test('?days=7 filters out transactions older than 7 days', async () => {
    // Use a fixed "now" so the lookback window is deterministic.
    const now = new Date('2024-01-15T12:00:00Z');
    jest.useFakeTimers().setSystemTime(now);

    try {
      // Recent transaction: 2024-01-14T10:00:00Z (1 day ago).
      // Old transaction: 2023-12-01T10:00:00Z (well beyond 7 days).
      mockHorizon({
        records: [
          makeTx('2024-01-14T10:00:00Z', 'tx-recent'),
          makeTx('2023-12-01T10:00:00Z', 'tx-old'),
        ],
      });

      const res = await request(app)
        .get('/account/GACCOUNT/activity-heatmap')
        .query({ days: 7 });

      expect(res.status).toBe(200);

      const total = DAY_KEYS.reduce(
        (sum, day) => sum + res.body.heatmap[day].reduce((a, b) => a + b, 0),
        0
      );
      expect(total).toBe(1);
      expect(res.body.totalAnalysed).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('an account with no transactions returns all zeroes and totalAnalysed 0', async () => {
    mockHorizon({ records: [] });

    const res = await request(app).get('/account/GACCOUNT/activity-heatmap');

    expect(res.status).toBe(200);
    for (const day of DAY_KEYS) {
      expect(res.body.heatmap[day]).toEqual(new Array(24).fill(0));
    }
    expect(res.body.totalAnalysed).toBe(0);
  });

  test('returns 404 for a non-existent account', async () => {
    mockHorizon({ accountExists: false });

    const res = await request(app).get('/account/GMISSING/activity-heatmap');

    expect(res.status).toBe(404);
  });
});