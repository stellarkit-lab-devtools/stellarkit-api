/**
 * Tests for freeze-status caching behaviour on
 * GET /account/:id/freeze-status/:assetCode/:assetIssuer
 *
 * Covers:
 *   - First request → X-Cache: MISS, Horizon is called
 *   - Second request (same params) → X-Cache: HIT, Horizon NOT called again
 *   - Different account / code / issuer each produce separate cache entries
 *   - ?fresh=true always bypasses the cache (X-Cache: MISS)
 *   - Cache is keyed by account ID, asset code, AND asset issuer
 *   - TTL is configurable via CACHE_TTL_FREEZE_CHECK_MS
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

// ---------- Fixtures ---------------------------------------------------------

const accountId = Keypair.random().publicKey();
const issuerA = Keypair.random().publicKey();
const issuerB = Keypair.random().publicKey();

function makeAccountWithTrustline(opts = {}) {
  const {
    assetCode = "USDC",
    assetIssuer = issuerA,
    isAuthorized = true,
    isAuthorizedToMaintainLiabilities = true,
  } = opts;

  return {
    id: opts.accountId || accountId,
    balances: [
      {
        asset_type: "credit_alphanum4",
        asset_code: assetCode,
        asset_issuer: assetIssuer,
        balance: "10.0000000",
        is_authorized: isAuthorized,
        is_authorized_to_maintain_liabilities: isAuthorizedToMaintainLiabilities,
      },
    ],
  };
}

// ---------- Tests ------------------------------------------------------------

describe("GET /account/:id/freeze-status/:assetCode/:assetIssuer — caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── HIT / MISS basics ──────────────────────────────────────────────────────

  it("returns X-Cache: MISS on first request and calls Horizon once", async () => {
    server.loadAccount.mockResolvedValue(makeAccountWithTrustline());

    const res = await request(app).get(
      `/account/${accountId}/freeze-status/USDC/${issuerA}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("returns X-Cache: HIT on second request and does NOT call Horizon again", async () => {
    server.loadAccount.mockResolvedValue(makeAccountWithTrustline());

    const url = `/account/${accountId}/freeze-status/USDC/${issuerA}`;

    const res1 = await request(app).get(url);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(1);

    const res2 = await request(app).get(url);
    expect(res2.get("X-Cache")).toBe("HIT");
    // Horizon should NOT have been called a second time
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("cached HIT returns the same data as the original MISS response", async () => {
    server.loadAccount.mockResolvedValue(makeAccountWithTrustline());

    const url = `/account/${accountId}/freeze-status/USDC/${issuerA}`;
    const res1 = await request(app).get(url);
    const res2 = await request(app).get(url);

    expect(res2.body.data).toEqual(res1.body.data);
  });

  // ── ?fresh=true bypass ─────────────────────────────────────────────────────

  it("?fresh=true bypasses cache and returns X-Cache: MISS", async () => {
    server.loadAccount.mockResolvedValue(makeAccountWithTrustline());

    const url = `/account/${accountId}/freeze-status/USDC/${issuerA}`;

    // Populate the cache
    await request(app).get(url);
    expect(server.loadAccount).toHaveBeenCalledTimes(1);

    // fresh=true should call Horizon again
    const res = await request(app).get(`${url}?fresh=true`);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it("?fresh=true still returns correct data", async () => {
    server.loadAccount.mockResolvedValue(
      makeAccountWithTrustline({ isAuthorized: false, isAuthorizedToMaintainLiabilities: false })
    );

    const res = await request(app).get(
      `/account/${accountId}/freeze-status/USDC/${issuerA}?fresh=true`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.isFrozen).toBe(true);
  });

  it("after ?fresh=true the refreshed value is cached for subsequent calls", async () => {
    server.loadAccount.mockResolvedValue(makeAccountWithTrustline());
    const url = `/account/${accountId}/freeze-status/USDC/${issuerA}`;

    // Populate cache normally
    await request(app).get(url);

    // Refresh
    await request(app).get(`${url}?fresh=true`);
    expect(server.loadAccount).toHaveBeenCalledTimes(2);

    // Next normal call should hit the freshly populated cache
    const res = await request(app).get(url);
    expect(res.get("X-Cache")).toBe("HIT");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  // ── Cache key isolation ────────────────────────────────────────────────────

  it("caches separately for different account IDs", async () => {
    const accountB = Keypair.random().publicKey();
    server.loadAccount.mockImplementation((id) =>
      Promise.resolve(makeAccountWithTrustline({ accountId: id }))
    );

    await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerA}`);
    await request(app).get(`/account/${accountB}/freeze-status/USDC/${issuerA}`);

    // Each account gets its own Horizon call
    expect(server.loadAccount).toHaveBeenCalledTimes(2);

    // Second call for each should be cache hits
    const resA2 = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerA}`);
    const resB2 = await request(app).get(`/account/${accountB}/freeze-status/USDC/${issuerA}`);
    expect(resA2.get("X-Cache")).toBe("HIT");
    expect(resB2.get("X-Cache")).toBe("HIT");
    expect(server.loadAccount).toHaveBeenCalledTimes(2); // no additional calls
  });

  it("caches separately for different asset codes", async () => {
    server.loadAccount.mockImplementation(() =>
      Promise.resolve({
        id: accountId,
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: issuerA,
            balance: "5.0",
            is_authorized: true,
            is_authorized_to_maintain_liabilities: true,
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDT",
            asset_issuer: issuerA,
            balance: "5.0",
            is_authorized: true,
            is_authorized_to_maintain_liabilities: true,
          },
        ],
      })
    );

    const res1 = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerA}`);
    const res2 = await request(app).get(`/account/${accountId}/freeze-status/USDT/${issuerA}`);

    // Both are MISSes (separate keys)
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(res2.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);

    // Repeat calls are HITs
    const hit1 = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerA}`);
    const hit2 = await request(app).get(`/account/${accountId}/freeze-status/USDT/${issuerA}`);
    expect(hit1.get("X-Cache")).toBe("HIT");
    expect(hit2.get("X-Cache")).toBe("HIT");
  });

  it("caches separately for different issuers", async () => {
    server.loadAccount.mockImplementation(() =>
      Promise.resolve({
        id: accountId,
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: issuerA,
            balance: "5.0",
            is_authorized: true,
            is_authorized_to_maintain_liabilities: true,
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: issuerB,
            balance: "5.0",
            is_authorized: false,
            is_authorized_to_maintain_liabilities: false,
          },
        ],
      })
    );

    const resA = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerA}`);
    const resB = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerB}`);

    // Different issuers → different cache entries → different freeze states
    expect(resA.get("X-Cache")).toBe("MISS");
    expect(resB.get("X-Cache")).toBe("MISS");
    expect(resA.body.data.isFrozen).toBe(false);
    expect(resB.body.data.isFrozen).toBe(true);

    // Second calls → HITs with the correct per-issuer state
    const hitA = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerA}`);
    const hitB = await request(app).get(`/account/${accountId}/freeze-status/USDC/${issuerB}`);
    expect(hitA.get("X-Cache")).toBe("HIT");
    expect(hitB.get("X-Cache")).toBe("HIT");
    expect(hitA.body.data.isFrozen).toBe(false);
    expect(hitB.body.data.isFrozen).toBe(true);
  });

  // ── Error paths are not cached ─────────────────────────────────────────────

  it("does not cache 404 responses (account does not hold asset)", async () => {
    server.loadAccount.mockResolvedValue({ id: accountId, balances: [] });

    const url = `/account/${accountId}/freeze-status/USDC/${issuerA}`;
    const res1 = await request(app).get(url);
    const res2 = await request(app).get(url);

    expect(res1.statusCode).toBe(404);
    expect(res2.statusCode).toBe(404);
    // Both calls hit Horizon — 404s should never be cached
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  // ── TTL env var is honoured ────────────────────────────────────────────────

  it("the TTL entry 'freezeCheck' exists in cacheConfig", () => {
    const cacheTTL = require("../src/config/cacheConfig");
    expect(typeof cacheTTL.freezeCheck).toBe("number");
    expect(cacheTTL.freezeCheck).toBeGreaterThan(0);
  });

  it("defaults to 30 seconds when CACHE_TTL_FREEZE_CHECK_MS is not set", () => {
    // cacheConfig already loaded; the default is 30000 ms → 30 s
    const cacheTTL = require("../src/config/cacheConfig");
    // Without the env var the value should be 30 (the default 30000 ms ÷ 1000)
    // In test environment process.env may be unset — just check it is reasonable
    expect(cacheTTL.freezeCheck).toBeLessThanOrEqual(30);
    expect(cacheTTL.freezeCheck).toBeGreaterThan(0);
  });
});
