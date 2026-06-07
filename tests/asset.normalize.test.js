const request = require('supertest');
const app = require('../src/index');
const { server } = require('../src/config/stellar');

describe('Asset Code Normalizer Middleware', () => {
  const ASSET_CODE = 'USDC';
  const ASSET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes lowercase asset code in route params for /supply endpoint', async () => {
    const mockAssetResponse = {
      records: [
        {
          asset_code: ASSET_CODE,
          asset_issuer: ASSET_ISSUER,
          amount: '1000.0000000',
          liquidity_pools_amount: '500.0000000',
          claimable_balances_amount: '200.0000000',
          num_accounts: 150,
        },
      ],
    };

    jest.spyOn(server, 'assets').mockReturnValue({
      forCode: jest.fn().mockReturnThis(),
      forIssuer: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue(mockAssetResponse),
    });

    const lowerCaseCode = ASSET_CODE.toLowerCase();
    const res = await request(app).get(`/asset/${lowerCaseCode}/${ASSET_ISSUER}/supply`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      totalSupply: '1700.0000000',
      circulatingSupply: '1000.0000000',
      lockedInPools: '500.0000000',
      lockedInClaimableBalances: '200.0000000',
      holderCount: 150,
    });
  });

  it('normalizes mixed‑case asset code in query param for /search endpoint', async () => {
    const mockAssetResponse = {
      records: [
        {
          asset_code: ASSET_CODE,
          asset_issuer: ASSET_ISSUER,
          asset_type: 'credit_alphanum4',
          amount: '1000.0000000',
          num_accounts: 150,
          flags: {},
        },
      ],
    };

    jest.spyOn(server, 'assets').mockReturnValue({
      forCode: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue(mockAssetResponse),
    });

    const mixedCase = 'UsDc';
    const res = await request(app).get(`/asset/search?code=${mixedCase}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].assetCode).toBe(ASSET_CODE);
  });
});
