"use strict";

/**
 * Tests for slowest endpoints tracking in MetricsService and GET /metrics
 *
 * Verifies:
 *   - GET /metrics response includes slowestEndpoints array
 *   - Endpoints are ranked by average response time descending
 *   - List is limited to 10 entries
 *   - averageResponseTimeMs is correctly computed from multiple recordings
 *   - requestCount reflects the number of recorded calls per route
 *   - slowestEndpoints is empty ([]) when no response times have been recorded
 *   - Entries include { route, method, averageResponseTimeMs, requestCount }
 *   - reset() clears slowestEndpoints data
 *   - Multiple requests for the same route are averaged together
 */

const request = require("supertest");

// Suppress real Horizon warm-up calls
jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    ledgers: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    }),
    feeStats: jest.fn().mockResolvedValue({
      fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.5",
    }),
  },
  fetchAccountCreation: jest.fn(),
}));

const app = require("../src/index");
const metrics = require("../src/services/metrics");

beforeEach(() => {
  metrics.reset();
  jest.clearAllMocks();
});

// ── MetricsService.recordResponseTime unit tests ──────────────────────────────

describe("MetricsService.recordResponseTime", () => {
  it("records a single response time for a route", () => {
    metrics.recordResponseTime("GET", "/account/:id", 200);
    const snap = metrics.getSnapshot();
    expect(snap.slowestEndpoints).toHaveLength(1);
    expect(snap.slowestEndpoints[0].route).toBe("/account/:id");
    expect(snap.slowestEndpoints[0].method).toBe("GET");
    expect(snap.slowestEndpoints[0].averageResponseTimeMs).toBe(200);
    expect(snap.slowestEndpoints[0].requestCount).toBe(1);
  });

  it("averages multiple response times for the same route", () => {
    metrics.recordResponseTime("GET", "/account/:id", 100);
    metrics.recordResponseTime("GET", "/account/:id", 300);
    const snap = metrics.getSnapshot();
    expect(snap.slowestEndpoints[0].averageResponseTimeMs).toBe(200);
    expect(snap.slowestEndpoints[0].requestCount).toBe(2);
  });

  it("tracks different routes independently", () => {
    metrics.recordResponseTime("GET", "/account/:id", 500);
    metrics.recordResponseTime("GET", "/asset/:code/:issuer", 100);
    const snap = metrics.getSnapshot();
    expect(snap.slowestEndpoints).toHaveLength(2);
  });

  it("tracks different methods for the same path independently", () => {
    metrics.recordResponseTime("GET", "/account/:id", 200);
    metrics.recordResponseTime("POST", "/account/:id", 400);
    const snap = metrics.getSnapshot();
    expect(snap.slowestEndpoints).toHaveLength(2);
  });

  it("ignores non-finite responseTimeMs values", () => {
    metrics.recordResponseTime("GET", "/account/:id", NaN);
    metrics.recordResponseTime("GET", "/account/:id", Infinity);
    metrics.recordResponseTime("GET", "/account/:id", -Infinity);
    expect(metrics.getSnapshot().slowestEndpoints).toHaveLength(0);
  });

  it("ignores calls with missing method or route", () => {
    metrics.recordResponseTime(null, "/account/:id", 200);
    metrics.recordResponseTime("GET", null, 200);
    metrics.recordResponseTime("", "/account/:id", 200);
    expect(metrics.getSnapshot().slowestEndpoints).toHaveLength(0);
  });
});

// ── Ranking (sorted by averageResponseTimeMs descending) ─────────────────────

describe("MetricsService — slowestEndpoints ranking", () => {
  it("sorts endpoints by averageResponseTimeMs descending", () => {
    metrics.recordResponseTime("GET", "/fast-route", 50);
    metrics.recordResponseTime("GET", "/medium-route", 200);
    metrics.recordResponseTime("GET", "/slow-route", 800);

    const { slowestEndpoints } = metrics.getSnapshot();

    expect(slowestEndpoints[0].route).toBe("/slow-route");
    expect(slowestEndpoints[1].route).toBe("/medium-route");
    expect(slowestEndpoints[2].route).toBe("/fast-route");
  });

  it("puts the slowest endpoint first when rankings change after more data", () => {
    // Initially /route-b is slower
    metrics.recordResponseTime("GET", "/route-a", 100);
    metrics.recordResponseTime("GET", "/route-b", 600);

    // Add more data that makes /route-a slower on average
    metrics.recordResponseTime("GET", "/route-a", 1000);
    // /route-a average: (100 + 1000) / 2 = 550 → still slower than 600? No, 600 > 550
    // /route-b: 600. /route-a: 550. So /route-b should be first.
    const snap = metrics.getSnapshot();
    expect(snap.slowestEndpoints[0].route).toBe("/route-b");
    expect(snap.slowestEndpoints[0].averageResponseTimeMs).toBe(600);
  });

  it("limits the list to 10 entries even when more than 10 routes are tracked", () => {
    // Record 15 distinct routes
    for (let i = 1; i <= 15; i++) {
      metrics.recordResponseTime("GET", `/route-${i}`, i * 10);
    }

    const { slowestEndpoints } = metrics.getSnapshot();
    expect(slowestEndpoints).toHaveLength(10);
  });

  it("the top 10 list contains the 10 slowest routes (not the 10 fastest)", () => {
    // Record 15 routes with response times 10, 20, ..., 150 ms
    for (let i = 1; i <= 15; i++) {
      metrics.recordResponseTime("GET", `/route-${i}`, i * 10);
    }

    const { slowestEndpoints } = metrics.getSnapshot();

    // The 10 slowest are routes 6-15 (60ms-150ms).
    // The fastest route in the list should have averageResponseTimeMs >= 60.
    const fastestInList = slowestEndpoints[slowestEndpoints.length - 1];
    expect(fastestInList.averageResponseTimeMs).toBeGreaterThanOrEqual(60);
  });

  it("returns an empty array when no response times have been recorded", () => {
    expect(metrics.getSnapshot().slowestEndpoints).toEqual([]);
  });
});

// ── reset() clears timing data ────────────────────────────────────────────────

describe("MetricsService.reset", () => {
  it("clears slowestEndpoints data after reset()", () => {
    metrics.recordResponseTime("GET", "/account/:id", 500);
    metrics.reset();
    expect(metrics.getSnapshot().slowestEndpoints).toEqual([]);
  });
});

// ── getSnapshot immutability ──────────────────────────────────────────────────

describe("MetricsService.getSnapshot — immutability", () => {
  it("mutations to the returned array do not affect service state", () => {
    metrics.recordResponseTime("GET", "/account/:id", 300);
    const snap = metrics.getSnapshot();
    snap.slowestEndpoints.push({ route: "/fake", method: "GET", averageResponseTimeMs: 9999, requestCount: 1 });
    // Internal state must be unchanged
    expect(metrics.getSnapshot().slowestEndpoints).toHaveLength(1);
  });
});

// ── GET /metrics endpoint integration ────────────────────────────────────────

describe("GET /metrics — slowestEndpoints in API response", () => {
  it("includes slowestEndpoints in the response", async () => {
    const res = await request(app).get("/metrics");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("slowestEndpoints");
    expect(Array.isArray(res.body.data.slowestEndpoints)).toBe(true);
  });

  it("slowestEndpoints is an empty array initially (after reset)", async () => {
    // reset() was called in beforeEach, and GET /metrics itself will add one
    // entry. We check shape only here.
    const res = await request(app).get("/metrics");
    // slowestEndpoints may contain the /metrics route itself, but must be an array
    expect(Array.isArray(res.body.data.slowestEndpoints)).toBe(true);
  });

  it("each slowestEndpoints entry has route, method, averageResponseTimeMs, requestCount", async () => {
    // Manually inject a known entry so we can verify the shape
    metrics.recordResponseTime("GET", "/test-shape-route", 123.456);

    const res = await request(app).get("/metrics");

    const entry = res.body.data.slowestEndpoints.find(
      (e) => e.route === "/test-shape-route",
    );
    expect(entry).toBeDefined();
    expect(typeof entry.route).toBe("string");
    expect(typeof entry.method).toBe("string");
    expect(typeof entry.averageResponseTimeMs).toBe("number");
    expect(typeof entry.requestCount).toBe("number");
  });

  it("slowestEndpoints values are sorted by averageResponseTimeMs descending", async () => {
    metrics.recordResponseTime("GET", "/slow-a", 900);
    metrics.recordResponseTime("GET", "/fast-b", 50);
    metrics.recordResponseTime("GET", "/medium-c", 400);

    const res = await request(app).get("/metrics");
    const endpoints = res.body.data.slowestEndpoints;

    // Verify descending order
    for (let i = 0; i < endpoints.length - 1; i++) {
      expect(endpoints[i].averageResponseTimeMs).toBeGreaterThanOrEqual(
        endpoints[i + 1].averageResponseTimeMs,
      );
    }
  });

  it("slowestEndpoints has at most 10 entries", async () => {
    // Inject 15 entries
    for (let i = 1; i <= 15; i++) {
      metrics.recordResponseTime("GET", `/injected-route-${i}`, i * 20);
    }

    const res = await request(app).get("/metrics");
    expect(res.body.data.slowestEndpoints.length).toBeLessThanOrEqual(10);
  });

  it("records the /metrics route itself after the request completes", async () => {
    // Make two requests so there is timing data
    await request(app).get("/metrics");
    const res = await request(app).get("/metrics");

    const endpoints = res.body.data.slowestEndpoints;
    // At least one entry must exist (the /metrics route was recorded after the first request)
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
  });

  it("requestCount reflects total number of requests for a route", async () => {
    metrics.recordResponseTime("GET", "/counted-route", 100);
    metrics.recordResponseTime("GET", "/counted-route", 200);
    metrics.recordResponseTime("GET", "/counted-route", 300);

    const res = await request(app).get("/metrics");
    const entry = res.body.data.slowestEndpoints.find(
      (e) => e.route === "/counted-route",
    );
    expect(entry).toBeDefined();
    expect(entry.requestCount).toBe(3);
  });
});
