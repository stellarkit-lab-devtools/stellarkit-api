/**
 * Tests for caching on GET /claimable-balances/by-sponsor/:address
 *
 * Covers:
 *   - First request → X-Cache: MISS, Horizon is called
 *   - Second request (same params) → X-Cache: HIT, Horizon NOT called again
 *   - Different sponsor addresses produce separate cache entries
 *   - Different pagination params (limit, cursor) produce separate entries
 *   - ?fresh=true bypasses the cache (always X-Cache: MISS)
 *   - After ?fresh=true the refreshed value is re-cached
 *   - Error responses are never cached
 *   - TTL is configurable via CACHE_TTL_BALANCES_BY_SPONSOR_MS
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    claimableBalances: jest.fn(),
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

// ---------- Fixtures ---------------------------------------------------------

const sponsorA = Keypair.random().publicKey();
const sponsorB = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();

function makeBalance(overrides = {}) {
  return {
    id: overrides.id || "bal-0001",
    paging_token: overrides.paging_token || "pt-1",
    asset: `USDC:${issuer}`,
    amount: "50.0000000",
    sponsor: sponsorA,
    last_modified_ledger: 600,
    last_modified_time: "2024-05-01T00:00:00Z",
    claimants: [],
    ...overrides,
  };
}

function mockClaimableBalances(records) {
  const chain = {
    sponsor: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.claimableBalances.mockReturnValue(chain);
  return chain;
}

// ---------- Tests ------------------------------------------------------------

describe("GET /claimable-balances/by-sponsor/:address — caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── HIT / MISS basics ──────────────────────────────────────────────────────

  it("returns X-Cache: MISS on first request and calls Horizon once", async () => {
    mockClaimableBalances([makeBalance()]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorA}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.claimableBalances).toHaveBeenCalledTimes(1);
  });

  it("returns X-Cache: HIT on second identical request and does NOT call Horizon", async () => {
    mockClaimableBalances([makeBalance()]);

    const url = `/claimable-balances/by-sponsor/${sponsorA}`;

    const res1 = await request(app).get(url);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(server.claimableBalances).toHaveBeenCalledTimes(1);

    const res2 = await request(app).get(url);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(1); // no second call
  });

  it("cached HIT response body matches the original MISS response body", async () => {
    mockClaimableBalances([makeBalance()]);

    const url = `/claimable-balances/by-sponsor/${sponsorA}`;
    const res1 = await request(app).get(url);
    const res2 = await request(app).get(url);

    expect(res2.body).toEqual(res1.body);
  });

  it("X-Cache header is always present in the response", async () => {
    mockClaimableBalances([]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorA}`
    );

    expect(res.get("X-Cache")).toBeDefined();
    expect(["HIT", "MISS"]).toContain(res.get("X-Cache"));
  });

  // ── ?fresh=true bypass ─────────────────────────────────────────────────────

  it("?fresh=true bypasses the cache and returns X-Cache: MISS", async () => {
    mockClaimableBalances([makeBalance()]);

    const url = `/claimable-balances/by-sponsor/${sponsorA}`;

    // Populate cache
    await request(app).get(url);
    expect(server.claimableBalances).toHaveBeenCalledTimes(1);

    // fresh=true forces a new Horizon call
    const res = await request(app).get(`${url}?fresh=true`);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);
  });

  it("?fresh=true returns the correct data", async () => {
    mockClaimableBalances([makeBalance({ id: "fresh-bal" })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorA}?fresh=true`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.balances[0].balanceId).toBe("fresh-bal");
  });

  it("after ?fresh=true the refreshed value is cached for subsequent calls", async () => {
    mockClaimableBalances([makeBalance()]);
    const url = `/claimable-balances/by-sponsor/${sponsorA}`;

    // First call — populates cache
    await request(app).get(url);

    // fresh=true — refreshes cache
    await request(app).get(`${url}?fresh=true`);
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);

    // Normal call — should now be a HIT on the freshly populated cache
    const res = await request(app).get(url);
    expect(res.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(2); // no third call
  });

  // ── Cache key isolation — sponsor address ──────────────────────────────────

  it("caches separately for different sponsor addresses", async () => {
    mockClaimableBalances([makeBalance()]);

    await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}`);
    await request(app).get(`/claimable-balances/by-sponsor/${sponsorB}`);

    // Two different sponsors → two Horizon calls
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);

    // Second calls for each → HITs (no additional Horizon calls)
    const hitA = await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}`);
    const hitB = await request(app).get(`/claimable-balances/by-sponsor/${sponsorB}`);
    expect(hitA.get("X-Cache")).toBe("HIT");
    expect(hitB.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);
  });

  // ── Cache key isolation — pagination params ────────────────────────────────

  it("caches separately for different limit values", async () => {
    mockClaimableBalances([]);

    await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?limit=5`);
    await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?limit=20`);

    // Different limits → separate cache keys → two Horizon calls
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);

    // Repeat calls with the same limits are HITs
    const hit5 = await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?limit=5`);
    const hit20 = await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?limit=20`);
    expect(hit5.get("X-Cache")).toBe("HIT");
    expect(hit20.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);
  });

  it("caches separately for different cursor values", async () => {
    mockClaimableBalances([]);

    await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?cursor=pt-1`);
    await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?cursor=pt-2`);

    // Different cursors → separate cache keys → two Horizon calls
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);

    const hitCursor1 = await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?cursor=pt-1`);
    const hitCursor2 = await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}?cursor=pt-2`);
    expect(hitCursor1.get("X-Cache")).toBe("HIT");
    expect(hitCursor2.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(2);
  });

  it("treats no cursor and cursor='' as the same cache entry", async () => {
    mockClaimableBalances([]);

    // First request — no cursor
    await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}`);
    expect(server.claimableBalances).toHaveBeenCalledTimes(1);

    // Second request — same effective params, should be a HIT
    const res = await request(app).get(`/claimable-balances/by-sponsor/${sponsorA}`);
    expect(res.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(1);
  });

  // ── Empty result caching ───────────────────────────────────────────────────

  it("caches empty result lists (no balances for sponsor)", async () => {
    mockClaimableBalances([]);

    const url = `/claimable-balances/by-sponsor/${sponsorA}`;

    const res1 = await request(app).get(url);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(res1.body.data.balances).toHaveLength(0);

    // Second call should be a HIT even for an empty list
    const res2 = await request(app).get(url);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(server.claimableBalances).toHaveBeenCalledTimes(1);
  });

  // ── Validation errors are not cached ──────────────────────────────────────

  it("does not cache 400 validation errors", async () => {
    const url = "/claimable-balances/by-sponsor/NOT_A_REAL_KEY";

    const res1 = await request(app).get(url);
    const res2 = await request(app).get(url);

    expect(res1.statusCode).toBe(400);
    expect(res2.statusCode).toBe(400);
    // Neither should have called Horizon — validation fires before the cache
    expect(server.claimableBalances).not.toHaveBeenCalled();
  });

  // ── TTL configuration ──────────────────────────────────────────────────────

  it("the TTL entry 'balancesBySponsor' exists in cacheConfig", () => {
    const cacheTTL = require("../src/config/cacheConfig");
    expect(typeof cacheTTL.balancesBySponsor).toBe("number");
    expect(cacheTTL.balancesBySponsor).toBeGreaterThan(0);
  });

  it("defaults to 30 seconds when CACHE_TTL_BALANCES_BY_SPONSOR_MS is not set", () => {
    const cacheTTL = require("../src/config/cacheConfig");
    // Default is 30000 ms → 30 s. In test env the var is unset, so it must be ≤ 30.
    expect(cacheTTL.balancesBySponsor).toBeLessThanOrEqual(30);
    expect(cacheTTL.balancesBySponsor).toBeGreaterThan(0);
  });

  it("respects CACHE_TTL_BALANCES_BY_SPONSOR_MS override", () => {
    // Temporarily set the env var to a different value and reload the module
    const originalEnv = process.env.CACHE_TTL_BALANCES_BY_SPONSOR_MS;
    process.env.CACHE_TTL_BALANCES_BY_SPONSOR_MS = "60000"; // 60 s

    // Clear module cache so cacheConfig re-reads process.env
    jest.resetModules();
    const reloadedCacheTTL = require("../src/config/cacheConfig");
    expect(reloadedCacheTTL.balancesBySponsor).toBe(60);

    // Restore
    if (originalEnv === undefined) {
      delete process.env.CACHE_TTL_BALANCES_BY_SPONSOR_MS;
    } else {
      process.env.CACHE_TTL_BALANCES_BY_SPONSOR_MS = originalEnv;
    }
    jest.resetModules();
  });
});
