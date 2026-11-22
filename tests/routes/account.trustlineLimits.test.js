const request = require('supertest');

jest.mock('../../src/config/stellar', () => ({
  server: {
    loadAccount: jest.fn(),
  },
}));

const { server } = require('../../src/config/stellar');
const app = require('../../src/index');

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

const ACCOUNT_A = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function buildHorizonAccount(id, trustlines = []) {
  return {
    id,
    balances: [
      { asset_type: "native", balance: "1000.0000000" },
      ...trustlines,
    ],
  };
}

function makeTrustline(balance, limit, assetCode = "USD", issuer = "GISSUER") {
  return {
    balance,
    limit,
    asset_type: "credit_alphanum4",
    asset_code: assetCode,
    asset_issuer: issuer,
  };
}

beforeEach(() => {
  cacheService.flush();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /account/:id/trustline-limits", () => {
  it("returns X-Cache: MISS on the first request", async () => {
    const trustlines = [makeTrustline("50.0000000", "100.0000000")];
    server.loadAccount.mockResolvedValue(buildHorizonAccount(ACCOUNT_A, trustlines));

    const res = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.body.success).toBe(true);
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("returns X-Cache: HIT on a second identical request", async () => {
    const trustlines = [makeTrustline("50.0000000", "100.0000000")];
    server.loadAccount.mockResolvedValue(buildHorizonAccount(ACCOUNT_A, trustlines));

    await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const res = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    // Server.loadAccount should only be called once, not twice (second request is from cache)
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache with ?fresh=true and returns X-Cache: MISS", async () => {
    const trustlines = [makeTrustline("50.0000000", "100.0000000")];
    server.loadAccount.mockResolvedValue(buildHorizonAccount(ACCOUNT_A, trustlines));

    await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const res = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits?fresh=true`);

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    // Server.loadAccount should be called twice (cache was bypassed)
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries for different account IDs", async () => {
    server.loadAccount.mockImplementation(async (id) => {
      if (id === ACCOUNT_A) {
        return buildHorizonAccount(ACCOUNT_A, [makeTrustline("25.0000000", "100.0000000", "USD")]);
      }
      if (id === ACCOUNT_B) {
        return buildHorizonAccount(ACCOUNT_B, [makeTrustline("75.0000000", "100.0000000", "EUR", "GISSUER2")]);
      }
    });

    const firstA = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const firstB = await request(app).get(`/account/${ACCOUNT_B}/trustline-limits`);

    expect(firstA.headers["x-cache"]).toBe("MISS");
    expect(firstB.headers["x-cache"]).toBe("MISS");

    const secondA = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const secondB = await request(app).get(`/account/${ACCOUNT_B}/trustline-limits`);

    expect(secondA.headers["x-cache"]).toBe("HIT");
    expect(secondB.headers["x-cache"]).toBe("HIT");

    // Both should have loaded their data separately
    expect(secondA.body.data.accountId).toBe(ACCOUNT_A);
    expect(secondB.body.data.accountId).toBe(ACCOUNT_B);

    // loadAccount called twice (once per account ID)
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });
});
