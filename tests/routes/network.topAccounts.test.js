'use strict';

const request = require('supertest');

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: jest.fn(),
    },
  };
});

const { Horizon } = require('@stellar/stellar-sdk');

function makeTx(overrides = {}) {
  return {
    id: overrides.id || 'tx',
    source_account: overrides.source_account || 'GSOURCE',
    created_at: overrides.created_at || new Date().toISOString(),
    operation_count: overrides.operation_count !== undefined ? overrides.operation_count : 1,
    ...overrides,
  };
}

function buildRecords() {
  const now = Date.now();
  const recent = new Date(now - 60 * 1000).toISOString();
  const recent2 = new Date(now - 2 * 60 * 1000).toISOString();
  const recent3 = new Date(now - 3 * 60 * 1000).toISOString();
  const old = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  return [
    makeTx({ id: '1', source_account: 'GAAA', created_at: recent, operation_count: 2 }),
    makeTx({ id: '2', source_account: 'GAAA', created_at: recent2, operation_count: 3 }),
    makeTx({ id: '3', source_account: 'GBBB', created_at: recent3, operation_count: 1 }),
    makeTx({ id: '4', source_account: 'GCCC', created_at: recent, operation_count: 5 }),
    makeTx({ id: '5', source_account: 'GCCC', created_at: recent2, operation_count: 1 }),
    makeTx({ id: '6', source_account: 'GCCC', created_at: recent3, operation_count: 1 }),
    makeTx({ id: '7', source_account: 'GOLD', created_at: old, operation_count: 10 }),
  ];
}

function mockServer(records) {
  const call = jest.fn().mockResolvedValue({ records });
  const builder = {
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call,
  };
  const server = {
    transactions: jest.fn().mockReturnValue(builder),
  };
  Horizon.Server.mockImplementation(() => server);
  return { server, builder, call };
}

describe('GET /network/top-accounts', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
    app = require('../../src/app');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns accounts ranked by transaction count with expected fields', async () => {
    mockServer(buildRecords());

    const res = await request(app).get('/network/top-accounts');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
    expect(res.body.data.period).toBeDefined();

    const accounts = res.body.data.accounts;
    expect(accounts.length).toBeGreaterThan(0);

    // Ranked by transactionCount descending
    for (let i = 1; i < accounts.length; i += 1) {
      expect(accounts[i - 1].transactionCount).toBeGreaterThanOrEqual(
        accounts[i].transactionCount
      );
    }

    // GCCC has 3 transactions, GAAA has 2, GBBB has 1
    expect(accounts[0].address).toBe('GCCC');
    expect(accounts[0].transactionCount).toBe(3);
    expect(accounts[0].operationCount).toBe(7);

    accounts.forEach((acct) => {
      expect(typeof acct.address).toBe('string');
      expect(typeof acct.transactionCount).toBe('number');
      expect(typeof acct.operationCount).toBe('number');
      expect(typeof acct.lastActiveAt).toBe('string');
      // ISO 8601 validation
      expect(new Date(acct.lastActiveAt).toISOString()).toBe(acct.lastActiveAt);
    });
  });

  test('defaults to the last 24 hours', async () => {
    mockServer(buildRecords());

    const res = await request(app).get('/network/top-accounts');

    expect(res.status).toBe(200);
    const addresses = res.body.data.accounts.map((a) => a.address);
    // GOLD is 48h old and should be excluded by default
    expect(addresses).not.toContain('GOLD');
    expect(res.body.data.period).toBe('24h');
  });

  test('validates ?limit= and caps at 50', async () => {
    mockServer(buildRecords());

    const res = await request(app).get('/network/top-accounts?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Should not error; capped at 50
    expect(res.body.data.accounts.length).toBeLessThanOrEqual(50);
  });

  test('rejects invalid ?limit= values', async () => {
    mockServer(buildRecords());

    const res = await request(app).get('/network/top-accounts?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns expected response shape with total and period', async () => {
    mockServer(buildRecords());

    const res = await request(app).get('/network/top-accounts?limit=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          accounts: expect.any(Array),
          total: expect.any(Number),
          period: expect.any(String),
        }),
      })
    );
    expect(res.body.data.accounts.length).toBeLessThanOrEqual(2);
  });
});