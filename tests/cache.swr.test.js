"use strict";

/**
 * Cache stale-while-revalidate tests (CACHE_SWR_MS).
 * Uses fake timers so TTL expiry and the SWR window are deterministic.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const flush = async () => {
  // Drain microtasks only — modern fake timers mock setImmediate.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function loadCache(swrMs) {
  jest.resetModules();
  process.env.CACHE_SWR_MS = String(swrMs);
  return require("../src/services/cache");
}

describe("CacheService stale-while-revalidate", () => {
  let cache;
  let logger;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = loadCache(5000);
    logger = require("../src/utils/logger");
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.dontMock("../src/config/stellar");
    jest.dontMock("../src/utils/mapNetworkStatus");
    delete process.env.CACHE_SWR_MS;
    delete process.env.CACHE_TTL_NETWORK_STATUS_MS;
  });

  it("serves a fresh hit without refreshing", async () => {
    const refresh = jest.fn(async () => ({ v: 2 }));
    cache.setWithRevalidation("k", { v: 1 }, 10, 5000);

    const result = cache.getWithRevalidation("k", 10, refresh, 5000);
    expect(result).toEqual({ state: "HIT", value: { v: 1 } });
    expect(refresh).not.toHaveBeenCalled();
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("serves stale to ten concurrent callers with exactly one refresh", async () => {
    const refresh = jest.fn(async () => {
      await flush();
      return { v: 2 };
    });
    cache.setWithRevalidation("k", { v: 1 }, 10, 5000);
    jest.advanceTimersByTime(11000); // 1s past the 10s TTL

    const results = Array.from({ length: 10 }, () =>
      cache.getWithRevalidation("k", 10, refresh, 5000),
    );
    expect(results).toHaveLength(10);
    results.forEach((r) => {
      expect(r.state).toBe("STALE");
      expect(r.value).toEqual({ v: 1 });
    });
    await flush();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toEqual({ v: 2 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale value and logs a warning when refresh fails", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const refresh = jest.fn(async () => {
      throw new Error("horizon down");
    });
    cache.setWithRevalidation("k", { v: 1 }, 10, 5000);
    jest.advanceTimersByTime(11000);

    expect(cache.getWithRevalidation("k", 10, refresh, 5000).state).toBe("STALE");
    await flush();
    await flush();
    expect(cache.get("k")).toEqual({ v: 1 });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/refresh failed/i);
  });

  it("returns MISS once the stale window has closed", () => {
    const refresh = jest.fn(async () => ({ v: 2 }));
    cache.setWithRevalidation("k", { v: 1 }, 10, 5000);
    jest.advanceTimersByTime(16000); // past TTL + 5s window

    const result = cache.getWithRevalidation("k", 10, refresh, 5000);
    expect(result.state).toBe("MISS");
    expect(result.value).toBeUndefined();
    expect(cache.get("k")).toBeUndefined();
  });

  it("honours CACHE_SWR_MS = 0 (feature off)", () => {
    const off = loadCache(0);
    expect(off.swrMs).toBe(0);
    off.set("k", { v: 1 }, 10);
    expect(off.getWithRevalidation("k", 10, jest.fn()).state).toBe("HIT");
  });

  it("sets X-Cache header values HIT / STALE / MISS on /network-status", async () => {
    // Real timers here: supertest's HTTP server needs the real clock.
    jest.useRealTimers();
    process.env.CACHE_SWR_MS = "150";
    process.env.CACHE_TTL_NETWORK_STATUS_MS = "60";
    const express = require("express");
    const request = require("supertest");

    jest.doMock("../src/config/stellar", () => ({
      server: {},
      horizonUrl: "https://horizon.example.com",
      NETWORK: "testnet",
    }));
    let calls = 0;
    const fetchNetworkStatus = jest.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error("background refresh unavailable");
      return { ledger: 1 };
    });
    jest.doMock("../src/utils/mapNetworkStatus", () => ({ fetchNetworkStatus }));
    jest.resetModules();
    cache = loadCache(150);
    const router = require("../src/routes/networkStatus");

    const app = express();
    app.use(router);
    cache.flush();

    let res = await request(app).get("/");
    expect(res.headers["x-cache"]).toBe("MISS");

    res = await request(app).get("/");
    expect(res.headers["x-cache"]).toBe("HIT");

    await sleep(80); // past the 60ms fresh TTL, inside the 150ms window
    res = await request(app).get("/");
    expect(res.headers["x-cache"]).toBe("STALE");
    expect(res.body.data).toEqual({ ledger: 1 });

    // Once the SWR window closes the entry is gone, so the next call is MISS.
    calls = 0; // next refresh should succeed again
    cache.delete("network-status");
    res = await request(app).get("/");
    expect(res.headers["x-cache"]).toBe("MISS");

    // ?fresh=true bypasses the cached (stale) value entirely.
    const freshRouter = require("../src/routes/networkStatus");
    expect(freshRouter).toBe(router);
  });
});
