'use strict';

const request = require('supertest');

jest.mock('../src/config/stellar', () => ({
  server: {
    loadAccount: jest.fn(),
    offers: jest.fn(),
  },
}));

jest.mock('../src/services/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}));

const { server } = require('../src/config/stellar');
const app = require('../src/app');

const ACCOUNT_ID = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const makeOffer = (id, selling, buying, amount) => ({
  id,
  seller: ACCOUNT_ID,
  selling: { asset_type: 'native' },
  buying: { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: 'GISSUER' },
  amount,
  price: '1.0',
  price_r: { n: 1, d: 1 },
});

const makeAccount = (balances) => ({
  id: ACCOUNT_ID,
  account_id: ACCOUNT_ID,
  sequence: '1',
  balances,
  subentry_count: 0,
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  flags: {},
  signers: [],
  data: {},
});

const mockOffers = (records) => {
  server.offers.mockReturnValue({
    forAccount: jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue({ records }),
    }),
  });
};

describe('GET /account/:id/offer-exposure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates 3 open sell offers for the same asset into one sellingExposure entry with offerCount: 3', async () => {
    server.loadAccount.mockResolvedValue(
      makeAccount([
        { asset_type: 'native', balance: '1000.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: 'GISSUER', balance: '500.0000000' },
      ])
    );

    mockOffers([
      makeOffer('1', 'native', 'USD', '10.0000000'),
      makeOffer('2', 'native', 'USD', '20.0000000'),
      makeOffer('3', 'native', 'USD', '30.0000000'),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

    expect(res.status).toBe(200);

    const body = res.body.data || res.body;
    const sellingExposure = body.sellingExposure || body.selling_exposure;

    expect(Array.isArray(sellingExposure)).toBe(true);
    expect(sellingExposure).toHaveLength(1);
    expect(sellingExposure[0].offerCount).toBe(3);
  });

  it('returns liquidityRisk "high" when more than 80% of a balance is in open offers', async () => {
    server.loadAccount.mockResolvedValue(
      makeAccount([
        { asset_type: 'native', balance: '100.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: 'GISSUER', balance: '100.0000000' },
      ])
    );

    mockOffers([
      makeOffer('1', 'native', 'USD', '90.0000000'),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

    expect(res.status).toBe(200);

    const body = res.body.data || res.body;
    expect(body.liquidityRisk).toBe('high');
  });

  it('returns empty arrays and liquidityRisk "low" when the account has no open offers', async () => {
    server.loadAccount.mockResolvedValue(
      makeAccount([
        { asset_type: 'native', balance: '100.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: 'GISSUER', balance: '100.0000000' },
      ])
    );

    mockOffers([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

    expect(res.status).toBe(200);

    const body = res.body.data || res.body;
    const sellingExposure = body.sellingExposure || body.selling_exposure;
    const buyingExposure = body.buyingExposure || body.buying_exposure;

    expect(sellingExposure).toEqual([]);
    expect(buyingExposure).toEqual([]);
    expect(body.liquidityRisk).toBe('low');
  });

  it('returns 404 when the account does not exist', async () => {
    const notFound = new Error('Account not found');
    notFound.response = { status: 404, data: { status: 404 } };
    notFound.status = 404;
    server.loadAccount.mockRejectedValue(notFound);

    mockOffers([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

    expect(res.status).toBe(404);
  });
});