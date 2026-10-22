/**
 * Tests for GET /account/:id/trustline-limits — caching behaviour
 *
 * Verifies:
 *   1. The first request returns X-Cache: MISS.
 *   2. A second identical request returns X-Cache: HIT.
 *   3. ?fresh=true bypasses the cache and returns X-Cache: MISS.
 *   4. Two different account IDs get separate cache entries.
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT_A = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ISSUER    = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/** Builds a minimal Horizon account with one non-native trustline. */
function buildHorizonAccount(id, balance = "100.0000000") {
  return {
    id,
    balances: [
      {
        asset_type: "native",
        balance: "500.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER,
        balance,
        limit: "10000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
    ],
  };
}

let loadAccountSpy;

beforeEach(() => {
  cacheService.flush();
  loadAccountSpy = jest
    .spyOn(server, "loadAccount")
    .mockImplementation(async (id) => buildHorizonAccount(id));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/trustline-limits — caching", () => {
  // ── 1. First request returns X-Cache: MISS ────────────────────────────────
  it("returns X-Cache: MISS on the first request", async () => {
    const res = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(loadAccountSpy).toHaveBeenCalledTimes(1);
  });

  // ── 2. Second identical request returns X-Cache: HIT ─────────────────────
  it("returns X-Cache: HIT on a second identical request", async () => {
    await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const res = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    // Horizon is only called once — second response served from cache.
    expect(loadAccountSpy).toHaveBeenCalledTimes(1);
  });

  // ── 3. ?fresh=true bypasses the cache and returns X-Cache: MISS ──────────
  it("bypasses the cache with ?fresh=true and returns X-Cache: MISS", async () => {
    // Populate the cache on the first request.
    await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);

    // Second request with ?fresh=true must bypass the cache.
    const res = await request(app).get(
      `/account/${ACCOUNT_A}/trustline-limits?fresh=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    // Horizon is hit a second time because the cache was bypassed.
    expect(loadAccountSpy).toHaveBeenCalledTimes(2);
  });

  // ── 4. Cache is keyed per account ID ─────────────────────────────────────
  it("gives separate cache entries to different account IDs", async () => {
    loadAccountSpy.mockImplementation(async (id) =>
      buildHorizonAccount(id, id === ACCOUNT_A ? "100.0000000" : "250.0000000"),
    );

    // First requests for both accounts must be MISS.
    const firstA = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const firstB = await request(app).get(`/account/${ACCOUNT_B}/trustline-limits`);
    expect(firstA.headers["x-cache"]).toBe("MISS");
    expect(firstB.headers["x-cache"]).toBe("MISS");

    // Second requests for both accounts must be HIT from their own cache entry.
    const secondA = await request(app).get(`/account/${ACCOUNT_A}/trustline-limits`);
    const secondB = await request(app).get(`/account/${ACCOUNT_B}/trustline-limits`);
    expect(secondA.headers["x-cache"]).toBe("HIT");
    expect(secondB.headers["x-cache"]).toBe("HIT");

    // The cached data for each account reflects that account's own balance.
    expect(secondA.body.data.accountId).toBe(ACCOUNT_A);
    expect(secondB.body.data.accountId).toBe(ACCOUNT_B);
    expect(secondA.body.data.trustlines[0].balance).toBe("100.0000000");
    expect(secondB.body.data.trustlines[0].balance).toBe("250.0000000");

    // Horizon is called exactly once per account (2 total), never for cache hits.
    expect(loadAccountSpy).toHaveBeenCalledTimes(2);
  });
});
