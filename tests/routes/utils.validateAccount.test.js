'use strict';

const request = require('supertest');
const StellarSdk = require('@stellar/stellar-sdk');

const app = require('../../src/app');

const FUNDED_ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';
const UNFUNDED_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5';

const mockServer = (account) => {
  jest.spyOn(StellarSdk.Horizon.Server.prototype, 'loadAccount').mockImplementation(() => {
    if (account) {
      return Promise.resolve(account);
    }
    return Promise.reject(new Error('Account not found'));
  });
};

describe('GET /utils/validate-account', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns { valid: true, exists: true } for a valid funded testnet address', async () => {
    mockServer({ accountId: FUNDED_ADDRESS, balances: [] });

    const res = await request(app)
      .get('/utils/validate-account')
      .query({ address: FUNDED_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, exists: true });
  });

  it('returns { valid: true, exists: false } for a correctly formatted but unfunded address', async () => {
    mockServer(null);

    const res = await request(app)
      .get('/utils/validate-account')
      .query({ address: UNFUNDED_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, exists: false });
  });

  it('returns { valid: false } for an address with the wrong length', async () => {
    const res = await request(app)
      .get('/utils/validate-account')
      .query({ address: 'GABCDEF' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('returns { valid: false } for an address with the wrong prefix', async () => {
    const res = await request(app)
      .get('/utils/validate-account')
      .query({ address: 'SZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('returns a 400 for an empty string', async () => {
    const res = await request(app)
      .get('/utils/validate-account')
      .query({ address: '' });

    expect(res.status).toBe(400);
  });
});
