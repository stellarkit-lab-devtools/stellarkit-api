"use strict";

/**
 * tests/cacheConfig.test.js
 *
 * Unit tests for src/config/cacheConfig.js
 *
 * The module reads environment variables at require-time, so each test group
 * sets the relevant env vars, flushes the module from the require cache, and
 * re-imports it to pick up the fresh values.
 */

function loadCacheConfig() {
  // Clear the module from the require cache so env changes take effect.
  jest.resetModules();
  return require("../src/config/cacheConfig");
}

describe("cacheConfig — default values", () => {
  beforeEach(() => {
    // Remove all cache-TTL-related env vars so defaults are used.
    delete process.env.CACHE_TTL_MS;
    delete process.env.CACHE_TTL_NETWORK_STATUS_MS;
    delete process.env.CACHE_TTL_FEE_ESTIMATE_MS;
    delete process.env.CACHE_TTL_BASE_FEE_MS;
    delete process.env.CACHE_TTL_VALIDATORS_MS;
    delete process.env.CACHE_TTL_ASSET_MS;
    delete process.env.CACHE_TTL_ASSET_PRICE_MS;
    delete process.env.CACHE_TTL_TRADES_MS;
    delete process.env.CACHE_TTL_POOL_TRADES_MS;
  });

  it("networkStatus defaults to 5 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(5);
  });

  it("feeEstimate defaults to 5 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.feeEstimate).toBe(5);
  });

  it("baseFee defaults to 5 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.baseFee).toBe(5);
  });

  it("validators defaults to 300 seconds (5 minutes)", () => {
    const cfg = loadCacheConfig();
    expect(cfg.validators).toBe(300);
  });

  it("asset defaults to 30 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.asset).toBe(30);
  });

  it("assetPrice defaults to 5 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.assetPrice).toBe(5);
  });

  it("claimableBalances defaults to 20 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.claimableBalances).toBe(20);
  });

  it("effects defaults to 30 seconds", () => {
    const cfg = loadCacheConfig();
    expect(cfg.effects).toBe(30);
  });
});

describe("cacheConfig — per-endpoint overrides", () => {
  afterEach(() => {
    delete process.env.CACHE_TTL_NETWORK_STATUS_MS;
    delete process.env.CACHE_TTL_FEE_ESTIMATE_MS;
    delete process.env.CACHE_TTL_BASE_FEE_MS;
    delete process.env.CACHE_TTL_VALIDATORS_MS;
    delete process.env.CACHE_TTL_ASSET_MS;
    delete process.env.CACHE_TTL_ASSET_PRICE_MS;
    delete process.env.CACHE_TTL_CLAIMABLE_BALANCES_MS;
    delete process.env.CACHE_TTL_EFFECTS_MS;
  });

  it("CACHE_TTL_NETWORK_STATUS_MS overrides networkStatus TTL", () => {
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "10000";
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(10);
  });

  it("CACHE_TTL_FEE_ESTIMATE_MS overrides feeEstimate TTL", () => {
    process.env.CACHE_TTL_FEE_ESTIMATE_MS = "20000";
    const cfg = loadCacheConfig();
    expect(cfg.feeEstimate).toBe(20);
  });

  it("CACHE_TTL_BASE_FEE_MS overrides baseFee TTL", () => {
    process.env.CACHE_TTL_BASE_FEE_MS = "3000";
    const cfg = loadCacheConfig();
    expect(cfg.baseFee).toBe(3);
  });

  it("CACHE_TTL_VALIDATORS_MS overrides validators TTL", () => {
    process.env.CACHE_TTL_VALIDATORS_MS = "60000";
    const cfg = loadCacheConfig();
    expect(cfg.validators).toBe(60);
  });

  it("CACHE_TTL_ASSET_MS overrides asset TTL", () => {
    process.env.CACHE_TTL_ASSET_MS = "15000";
    const cfg = loadCacheConfig();
    expect(cfg.asset).toBe(15);
  });

  it("CACHE_TTL_ASSET_PRICE_MS overrides assetPrice TTL", () => {
    process.env.CACHE_TTL_ASSET_PRICE_MS = "8000";
    const cfg = loadCacheConfig();
    expect(cfg.assetPrice).toBe(8);
  });

  it("CACHE_TTL_TRADES_MS overrides trades TTL", () => {
    process.env.CACHE_TTL_TRADES_MS = "22000";
    const cfg = loadCacheConfig();
    expect(cfg.trades).toBe(22);
  });

  it("CACHE_TTL_POOL_TRADES_MS overrides poolTrades TTL", () => {
    process.env.CACHE_TTL_POOL_TRADES_MS = "45000";
    const cfg = loadCacheConfig();
    expect(cfg.poolTrades).toBe(45);
  });
});

describe("cacheConfig — global CACHE_TTL_MS fallback", () => {
  afterEach(() => {
    delete process.env.CACHE_TTL_MS;
    delete process.env.CACHE_TTL_NETWORK_STATUS_MS;
    delete process.env.CACHE_TTL_FEE_ESTIMATE_MS;
    delete process.env.CACHE_TTL_BASE_FEE_MS;
    delete process.env.CACHE_TTL_ASSET_PRICE_MS;
  });

  it("CACHE_TTL_MS is used as fallback for networkStatus when per-endpoint var is absent", () => {
    process.env.CACHE_TTL_MS = "12000";
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(12);
  });

  it("CACHE_TTL_MS is used as fallback for feeEstimate when per-endpoint var is absent", () => {
    process.env.CACHE_TTL_MS = "12000";
    const cfg = loadCacheConfig();
    expect(cfg.feeEstimate).toBe(12);
  });

  it("per-endpoint var takes precedence over CACHE_TTL_MS", () => {
    process.env.CACHE_TTL_MS = "12000";
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "2000";
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(2);
  });

  it("CACHE_TTL_MS does NOT override the validators hard-coded default (300 s)", () => {
    // validators has its own hard-coded default of 300 000 ms; CACHE_TTL_MS
    // is only used for endpoints whose default is 5 000 ms.
    process.env.CACHE_TTL_MS = "12000";
    const cfg = loadCacheConfig();
    // validators still falls back to its own 300 s default when
    // CACHE_TTL_VALIDATORS_MS is absent
    expect(cfg.validators).toBe(300);
  });
});

describe("cacheConfig — invalid / edge-case values", () => {
  afterEach(() => {
    delete process.env.CACHE_TTL_NETWORK_STATUS_MS;
    delete process.env.CACHE_TTL_MS;
  });

  it("falls back to default when env var is NaN", () => {
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "not-a-number";
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(5);
  });

  it("falls back to default when env var is zero", () => {
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "0";
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(5);
  });

  it("falls back to default when env var is negative", () => {
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "-1000";
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(5);
  });

  it("returns correct seconds for a large valid value", () => {
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "600000"; // 10 minutes
    const cfg = loadCacheConfig();
    expect(cfg.networkStatus).toBe(600);
  });
});
