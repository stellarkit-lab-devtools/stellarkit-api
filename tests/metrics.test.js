"use strict";

/**
 * Tests for GET /metrics and MetricsService
 *
 * Verifies:
 *   - GET /metrics returns { totalRequests, totalErrors, errorsByStatus }
 *   - errorsByStatus always includes the 5 pre-seeded keys (400, 404, 429, 500, 503)
 *   - Counters increment correctly on each error response type
 *   - totalErrors increments on every error regardless of status
 *   - Counters survive multiple errors of the same status code
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const metrics = require("../src/services/metrics");

// Use full jest.mock so ledger/feeStats warm-up does not fire real requests
jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      payments: jest.fn(),
      operations: jest.fn(),
      offers: jest.fn(),
      transactions: jest.fn(),
      effects: jest.fn(),
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
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

const VALID_ID = Keypair.random().publicKey();

beforeEach(() => {
  metrics.reset();
  jest.clearAllMocks();
});

// ── MetricsService unit tests ─────────────────────────────────────────────────

describe("MetricsService", () => {
  it("starts with zeroed counters after reset()", () => {
    const snap = metrics.getSnapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.totalErrors).toBe(0);
  });

  it("pre-seeds errorsByStatus with the 5 tracked status codes at 0", () => {
    const { errorsByStatus } = metrics.getSnapshot();
    expect(errorsByStatus).toHaveProperty("400", 0);
    expect(errorsByStatus).toHaveProperty("404", 0);
    expect(errorsByStatus).toHaveProperty("429", 0);
    expect(errorsByStatus).toHaveProperty("500", 0);
    expect(errorsByStatus).toHaveProperty("503", 0);
  });

  it("incrementRequests increments totalRequests by 1", () => {
    metrics.incrementRequests();
    metrics.incrementRequests();
    expect(metrics.getSnapshot().totalRequests).toBe(2);
  });

  it("incrementError increments totalErrors by 1", () => {
    metrics.incrementError(404);
    metrics.incrementError(500);
    expect(metrics.getSnapshot().totalErrors).toBe(2);
  });

  it("incrementError(400) increments errorsByStatus['400']", () => {
    metrics.incrementError(400);
    metrics.incrementError(400);
    metrics.incrementError(400);
    expect(metrics.getSnapshot().errorsByStatus["400"]).toBe(3);
  });

  it("incrementError(404) increments errorsByStatus['404']", () => {
    metrics.incrementError(404);
    metrics.incrementError(404);
    expect(metrics.getSnapshot().errorsByStatus["404"]).toBe(2);
  });

  it("incrementError(429) increments errorsByStatus['429']", () => {
    metrics.incrementError(429);
    expect(metrics.getSnapshot().errorsByStatus["429"]).toBe(1);
  });

  it("incrementError(500) increments errorsByStatus['500']", () => {
    metrics.incrementError(500);
    expect(metrics.getSnapshot().errorsByStatus["500"]).toBe(1);
  });

  it("incrementError(503) increments errorsByStatus['503']", () => {
    metrics.incrementError(503);
    expect(metrics.getSnapshot().errorsByStatus["503"]).toBe(1);
  });

  it("records additional status codes not in the pre-seeded set", () => {
    metrics.incrementError(422);
    expect(metrics.getSnapshot().errorsByStatus["422"]).toBe(1);
  });

  it("each status code is counted independently", () => {
    metrics.incrementError(400);
    metrics.incrementError(400);
    metrics.incrementError(404);
    metrics.incrementError(500);
    const snap = metrics.getSnapshot();
    expect(snap.errorsByStatus["400"]).toBe(2);
    expect(snap.errorsByStatus["404"]).toBe(1);
    expect(snap.errorsByStatus["500"]).toBe(1);
    expect(snap.errorsByStatus["429"]).toBe(0);
    expect(snap.errorsByStatus["503"]).toBe(0);
  });

  it("getSnapshot returns a copy — mutations do not affect service state", () => {
    metrics.incrementError(404);
    const snap = metrics.getSnapshot();
    snap.errorsByStatus["404"] = 9999;
    expect(metrics.getSnapshot().errorsByStatus["404"]).toBe(1);
  });

  it("reset() clears all counts back to zero", () => {
    metrics.incrementRequests();
    metrics.incrementError(500);
    metrics.reset();
    const snap = metrics.getSnapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.totalErrors).toBe(0);
    expect(snap.errorsByStatus["500"]).toBe(0);
  });
});

// ── GET /metrics endpoint ─────────────────────────────────────────────────────

describe("GET /metrics", () => {
  it("returns 200 with success: true", async () => {
    const res = await request(app).get("/metrics");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("response includes totalRequests, totalErrors, and errorsByStatus", async () => {
    const res = await request(app).get("/metrics");
    expect(res.body.data).toHaveProperty("totalRequests");
    expect(res.body.data).toHaveProperty("totalErrors");
    expect(res.body.data).toHaveProperty("errorsByStatus");
  });

  it("errorsByStatus always includes the 5 pre-seeded keys", async () => {
    const res = await request(app).get("/metrics");
    const { errorsByStatus } = res.body.data;
    expect(errorsByStatus).toHaveProperty("400");
    expect(errorsByStatus).toHaveProperty("404");
    expect(errorsByStatus).toHaveProperty("429");
    expect(errorsByStatus).toHaveProperty("500");
    expect(errorsByStatus).toHaveProperty("503");
  });

  it("errorsByStatus values are numbers", async () => {
    const res = await request(app).get("/metrics");
    const { errorsByStatus } = res.body.data;
    for (const val of Object.values(errorsByStatus)) {
      expect(typeof val).toBe("number");
    }
  });

  it("totalRequests increments after each request", async () => {
    const before = (await request(app).get("/metrics")).body.data.totalRequests;
    await request(app).get("/metrics");
    const after = (await request(app).get("/metrics")).body.data.totalRequests;
    expect(after).toBeGreaterThan(before);
  });
});

// ── Error counter integration via real error responses ────────────────────────

describe("errorsByStatus — incremented by real API errors", () => {
  it("increments errorsByStatus['404'] when a 404 AccountNotFound is returned", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    await request(app).get(`/account/${VALID_ID}`);

    const snap = metrics.getSnapshot();
    expect(snap.errorsByStatus["404"]).toBe(1);
    expect(snap.totalErrors).toBe(1);
  });

  it("increments errorsByStatus['400'] when an invalid account ID is used", async () => {
    await request(app).get("/account/NOTVALID");

    const snap = metrics.getSnapshot();
    expect(snap.errorsByStatus["400"]).toBe(1);
    expect(snap.totalErrors).toBe(1);
  });

  it("accumulates counts across multiple errors of the same status", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    await request(app).get(`/account/${VALID_ID}`);
    await request(app).get(`/account/${VALID_ID}`);
    await request(app).get(`/account/${VALID_ID}`);

    const snap = metrics.getSnapshot();
    expect(snap.errorsByStatus["404"]).toBe(3);
    expect(snap.totalErrors).toBe(3);
  });

  it("tracks 400 and 404 independently in the same test run", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    // Two 404s
    await request(app).get(`/account/${VALID_ID}`);
    await request(app).get(`/account/${VALID_ID}`);
    // One 400
    await request(app).get("/account/NOTVALID");

    const snap = metrics.getSnapshot();
    expect(snap.errorsByStatus["404"]).toBe(2);
    expect(snap.errorsByStatus["400"]).toBe(1);
    expect(snap.totalErrors).toBe(3);
  });
});
