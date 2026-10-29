const request = require('supertest');

jest.mock('../../config/stellar', () => ({
  server: {
    loadAccount: jest.fn(),
  },
}));

const { server } = require('../../config/stellar');
const app = require('../../app');

const NATIVE_BALANCE = {
  balance: '1000.0000000',
  asset_type: 'native',
};

const makeTrustline = (balance, limit, assetCode = 'USD') => ({
  balance,
  limit,
  asset_type: 'credit_alphanum4',
  asset_code: assetCode,
  asset_issuer: 'GISSUER',
});

const mockAccount = (balances) => {
  server.loadAccount.mockResolvedValue({ balances });
};

describe('GET /account/:id/trustline-limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns nearLimit: true for a trustline at 95% capacity', async () => {
    mockAccount([NATIVE_BALANCE, makeTrustline('95.0000000', '100.0000000')]);

    const res = await request(app).get('/account/GACCOUNT/trustline-limits');

    expect(res.status).toBe(200);
    const trustlines = Array.isArray(res.body) ? res.body : res.body.trustlines;
    expect(trustlines).toHaveLength(1);
    expect(trustlines[0].nearLimit).toBe(true);
  });

  it('returns nearLimit: false for a trustline at 50% capacity', async () => {
    mockAccount([NATIVE_BALANCE, makeTrustline('50.0000000', '100.0000000')]);

    const res = await request(app).get('/account/GACCOUNT/trustline-limits');

    expect(res.status).toBe(200);
    const trustlines = Array.isArray(res.body) ? res.body : res.body.trustlines;
    expect(trustlines).toHaveLength(1);
    expect(trustlines[0].nearLimit).toBe(false);
  });

  it('computes usedPercent as (balance / limit) * 100', async () => {
    mockAccount([NATIVE_BALANCE, makeTrustline('25.0000000', '200.0000000')]);

    const res = await request(app).get('/account/GACCOUNT/trustline-limits');

    expect(res.status).toBe(200);
    const trustlines = Array.isArray(res.body) ? res.body : res.body.trustlines;
    expect(trustlines).toHaveLength(1);
    expect(trustlines[0].usedPercent).toBeCloseTo((25 / 200) * 100, 5);
  });

  it('returns usedPercent: 0 for a trustline with zero limit', async () => {
    mockAccount([NATIVE_BALANCE, makeTrustline('0.0000000', '0.0000000')]);

    const res = await request(app).get('/account/GACCOUNT/trustline-limits');

    expect(res.status).toBe(200);
    const trustlines = Array.isArray(res.body) ? res.body : res.body.trustlines;
    expect(trustlines).toHaveLength(1);
    expect(trustlines[0].usedPercent).toBe(0);
  });

  it('returns an empty array for an account with no trustlines', async () => {
    mockAccount([NATIVE_BALANCE]);

    const res = await request(app).get('/account/GACCOUNT/trustline-limits');

    expect(res.status).toBe(200);
    const trustlines = Array.isArray(res.body) ? res.body : res.body.trustlines;
    expect(trustlines).toEqual([]);
  });
});