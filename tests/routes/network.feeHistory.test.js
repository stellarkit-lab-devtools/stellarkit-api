/**
 * tests/routes/network.feeHistory.test.js
 *
 * Coverage for GET /network/fee-history:
 *   1. default response returns 20 ledgers each with
 *      sequence, closedAt, baseFee, p50Fee, p95Fee, and capacityUsage
 *   2. ?ledgers=5 returns exactly 5 ledgers
 *   3. ?ledgers=101 returns a 400
 *   4. each ledger entry has the required fields with correct types
 *   5. ledgers are ordered by sequence descending
 *
 * The Stellar SDK ledger response is mocked — no network calls are made.
 */

"use strict";

const request = require("supertest");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      ledgers: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a single mocked Horizon ledger record. */
function makeLedgerRecord(sequence) {
  return {
    sequence,
    closed_at: new Date(Date.UTC(2024, 0, 1, 0, 0, sequence % 60)).toISOString(),
    base_fee_in_stroops: "100",
    fee_charged: {
      min: "100",
      p50: "200",
      p95: "500",
      max: "1000",
    },
    operation_count: Math.floor(sequence % 5000),
    successful_transaction_count: 10 + (sequence % 7),
  };
}

/** Builds `count` mocked ledger records (newest first). */
function makeLedgerRecords(count, startSequence = 1000) {
  return Array.from({ length: count }, (_, i) =>
    makeLedgerRecord(startSequence - i)
  );
}

/** Returns a ledgers() chainable mock resolving with `records`. */
function makeLedgersMock(records) {
  return {
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /network/fee-history", () => {
  it("default response returns 20 ledgers each with sequence, closedAt, baseFee, p50Fee, p95Fee, and capacityUsage", async () => {
    server.ledgers.mockReturnValue(
      makeLedgersMock(makeLedgerRecords(20))
    );

    const res = await request(app).get("/network/fee-history");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const ledgers = res.body.data.ledgers;
    expect(Array.isArray(ledgers)).toBe(true);
    expect(ledgers.length).toBeLessThanOrEqual(20);
    expect(ledgers.length).toBeGreaterThan(0);

    for (const ledger of ledgers) {
      expect(ledger).toHaveProperty("sequence");
      expect(ledger).toHaveProperty("closedAt");
      expect(ledger).toHaveProperty("baseFee");
      expect(ledger).toHaveProperty("p50Fee");
      expect(ledger).toHaveProperty("p95Fee");
      expect(ledger).toHaveProperty("capacityUsage");

      expect(typeof ledger.sequence).toBe("number");
      expect(typeof ledger.closedAt).toBe("string");
      expect(typeof ledger.baseFee).toBe("number");
      expect(typeof ledger.p50Fee).toBe("number");
      expect(typeof ledger.p95Fee).toBe("number");
      expect(typeof ledger.capacityUsage).toBe("number");

      // capacityUsage should be between 0 and 1
      expect(ledger.capacityUsage).toBeGreaterThanOrEqual(0);
      expect(ledger.capacityUsage).toBeLessThanOrEqual(1);
    }
  });

  it("?ledgers=5 returns exactly 5 ledgers", async () => {
    server.ledgers.mockReturnValue(makeLedgersMock(makeLedgerRecords(5)));

    const res = await request(app).get("/network/fee-history?ledgers=5");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ledgers).toHaveLength(5);
  });

  it("?ledgers=101 returns a 400", async () => {
    server.ledgers.mockReturnValue(makeLedgersMock(makeLedgerRecords(20)));

    const res = await request(app).get("/network/fee-history?ledgers=101");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("ledgers are ordered by sequence descending", async () => {
    const records = makeLedgerRecords(10);
    server.ledgers.mockReturnValue(makeLedgersMock(records));

    const res = await request(app).get("/network/fee-history?ledgers=10");

    expect(res.statusCode).toBe(200);
    const ledgers = res.body.data.ledgers;
    
    for (let i = 0; i < ledgers.length - 1; i++) {
      expect(ledgers[i].sequence).toBeGreaterThan(ledgers[i + 1].sequence);
    }
  });

  it("response is cached and subsequent requests hit the cache", async () => {
    server.ledgers.mockReturnValue(makeLedgersMock(makeLedgerRecords(10)));

    const res1 = await request(app).get("/network/fee-history?ledgers=10");
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");

    const res2 = await request(app).get("/network/fee-history?ledgers=10");
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");
  });
});
