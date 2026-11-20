/**
 * Tests for GET /account/:id/liquidity-contribution — caching behaviour
 *
 * Verifies:
 *   1. The first request returns X-Cache: MISS.
 *   2. A second identical request returns X-Cache: HIT.
 *   3. ?fresh=true bypasses the cache and returns X-Cache: MISS.
 *   4. Two different account IDs get separate cache entries.
 *   5. The cached response matches the original response exactly.
 *
 * Uses the shared cache service (flushed between tests). All Stellar SDK
 * calls are mocked; no real network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT_A = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ISSUER_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const POOL_ID = "dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7";

function buildHorizonAccount(id, shares = "100.0000000") {
  return {
    id,
    balances: [
      { asset_type: "native", balance: "500.0000000" },
      {
        asset_type: "liquidity_pool_shares",
        liquidity_pool_id: POOL_ID,
        balance: shares,
      },
    ],
  };
}

function buildPool() {
  return {
    id: POOL_ID,
    fee_bp: 30,
    total_shares: "1000.0000000",
    total_trustlines: 10,
    reserves: [
      { asset: "native", amount: "2000.0000000" },
      { asset: `USDC:${ISSUER_ID}`, amount: "400.0000000" },
    ],
  };
}

let loadAccountSpy;

beforeEach(() => {
  cacheService.flush();

  loadAccountSpy = jest
    .spyOn(server, "loadAccount")
    .mockImplementation(async (id) => buildHorizonAccount(id));

  jest.spyOn(server, "liquidityPools").mockReturnValue({
    liquidityPoolId: jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue(buildPool()),
    }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/liquidity-contribution — caching", () => {
  it("returns X-Cache: MISS on the first request", async () => {
    const res = await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(loadAccountSpy).toHaveBeenCalledTimes(1);
  });

  it("returns X-Cache: HIT on a second identical request", async () => {
    await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);
    const res = await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    // Served from cache — Horizon is only hit once.
    expect(loadAccountSpy).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache with ?fresh=true and returns X-Cache: MISS", async () => {
    await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);
    const res = await request(app).get(
      `/account/${ACCOUNT_A}/liquidity-contribution?fresh=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(loadAccountSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries for different account IDs", async () => {
    loadAccountSpy.mockImplementation(async (id) =>
      buildHorizonAccount(id, id === ACCOUNT_A ? "100.0000000" : "250.0000000"),
    );

    const firstA = await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);
    const firstB = await request(app).get(`/account/${ACCOUNT_B}/liquidity-contribution`);

    expect(firstA.headers["x-cache"]).toBe("MISS");
    expect(firstB.headers["x-cache"]).toBe("MISS");

    const secondA = await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);
    const secondB = await request(app).get(`/account/${ACCOUNT_B}/liquidity-contribution`);

    expect(secondA.headers["x-cache"]).toBe("HIT");
    expect(secondB.headers["x-cache"]).toBe("HIT");

    expect(secondA.body.data.accountId).toBe(ACCOUNT_A);
    expect(secondB.body.data.accountId).toBe(ACCOUNT_B);
    expect(secondA.body.data.pools[0].shares).toBe("100.0000000");
    expect(secondB.body.data.pools[0].shares).toBe("250.0000000");
    expect(loadAccountSpy).toHaveBeenCalledTimes(2);
  });

  it("returns a cached response that matches the original response exactly", async () => {
    const original = await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);
    const cached = await request(app).get(`/account/${ACCOUNT_A}/liquidity-contribution`);

    expect(original.headers["x-cache"]).toBe("MISS");
    expect(cached.headers["x-cache"]).toBe("HIT");
    expect(cached.body.data).toEqual(original.body.data);
    expect(cached.body.data).toEqual({
      accountId: ACCOUNT_A,
      pools: [
        {
          poolId: POOL_ID,
          shares: "100.0000000",
          sharePercent: "10.0000000",
          reserves: [
            {
              asset: { code: "XLM", issuer: null, type: "native" },
              amount: "200.0000000",
            },
            {
              asset: { code: "USDC", issuer: ISSUER_ID, type: "credit_alphanum4" },
              amount: "40.0000000",
            },
          ],
        },
      ],
      totalsByAsset: [
        { asset: { code: "XLM", issuer: null, type: "native" }, amount: "200.0000000" },
        { asset: { code: "USDC", issuer: ISSUER_ID, type: "credit_alphanum4" }, amount: "40.0000000" },
      ],
      poolCount: 1,
    });
  });
});
