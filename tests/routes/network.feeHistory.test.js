/**
 * tests/routes/network.feeHistory.test.js
 *
 * Coverage for GET /network/fee-history:
 *   1. Default response returns 20 ledgers each with the correct fields
 *   2. ?ledgers=5 returns exactly 5 ledgers
 *   3. ?ledgers=101 returns a 400
 *   4. Each ledger entry has sequence, closedAt, baseFee, p50Fee, p95Fee, and capacityUsage
 *   5. Ledgers are ordered by sequence descending
 *
 * Tests mock the Stellar SDK ledger response — no real Horizon calls are made.
 */

"use strict";

const request = require("supertest");
const cacheService = require("../../src/services/cache");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a single mock Horizon ledger record.
 * sequence is the ledger sequence number; higher = newer.
 */
function makeLedgerRecord(sequence) {
  return {
    sequence,
    closed_at: new Date(Date.UTC(2024, 0, sequence % 28 + 1)).toISOString(),
    base_fee_in_stroops: "100",
    successful_transaction_count: 50 + (sequence % 20),
    failed_transaction_count: 2,
    operation_count: 80 + (sequence % 30),
    // Horizon doesn't expose per-ledger p50/p95 directly; we compute from
    // fee_charged on the feeStats endpoint. The route may derive these from
    // feeStats or simulate from transaction data. We'll provide enough fields
    // for the route to build the response.
  };
}

/** Builds `count` mock ledger records ordered newest-first. */
function makeLedgerRecords(count, startSeq = 5000) {
  return Array.from({ length: count }, (_, i) => makeLedgerRecord(startSeq - i));
}

/** Returns a chainable ledgers() mock that resolves with the given records. */
function mockLedgers(records) {
  server.ledgers.mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

/** Returns a minimal feeStats mock. */
function mockFeeStats() {
  server.feeStats.mockResolvedValue({
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.15",
    fee_charged: {
      min: "100",
      p10: "100",
      p50: "200",
      p95: "500",
      p99: "1000",
      max: "5000",
    },
    fee_accepted: {
      min: "100",
      max: "5000",
    },
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
  mockFeeStats();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /network/fee-history", () => {
  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it("default response returns 20 ledgers each with the correct fields", async () => {
    mockLedgers(makeLedgerRecords(20));

    const res = await request(app).get("/network/fee-history");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { ledgers } = res.body.data;
    expect(Array.isArray(ledgers)).toBe(true);
    expect(ledgers.length).toBe(20);

    for (const ledger of ledgers) {
      expect(ledger).toHaveProperty("sequence");
      expect(ledger).toHaveProperty("closedAt");
      expect(ledger).toHaveProperty("baseFee");
      expect(ledger).toHaveProperty("p50Fee");
      expect(ledger).toHaveProperty("p95Fee");
      expect(ledger).toHaveProperty("capacityUsage");
    }
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it("?ledgers=5 returns exactly 5 ledgers", async () => {
    mockLedgers(makeLedgerRecords(5));

    const res = await request(app).get("/network/fee-history?ledgers=5");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ledgers).toHaveLength(5);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it("?ledgers=101 returns a 400", async () => {
    mockLedgers(makeLedgerRecords(20));

    const res = await request(app).get("/network/fee-history?ledgers=101");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  it("each ledger entry has sequence, closedAt, baseFee, p50Fee, p95Fee, and capacityUsage", async () => {
    mockLedgers(makeLedgerRecords(3));

    const res = await request(app).get("/network/fee-history?ledgers=3");

    expect(res.statusCode).toBe(200);

    const ledger = res.body.data.ledgers[0];

    // sequence must be a number (the formatLedgerSequence utility returns a number)
    expect(typeof ledger.sequence).toBe("number");
    expect(ledger.sequence).toBeGreaterThan(0);

    // closedAt must be a non-empty ISO 8601 string
    expect(typeof ledger.closedAt).toBe("string");
    expect(ledger.closedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // baseFee, p50Fee, p95Fee — the global normalizeAmountFields middleware
    // formats all fields ending with "fee" as 7-decimal strings (e.g. "100.0000000").
    // We assert they are present and parseable as non-negative numbers.
    const baseFeeNum = Number(ledger.baseFee);
    expect(ledger).toHaveProperty("baseFee");
    expect(Number.isFinite(baseFeeNum)).toBe(true);
    expect(baseFeeNum).toBeGreaterThanOrEqual(0);

    const p50FeeNum = Number(ledger.p50Fee);
    expect(ledger).toHaveProperty("p50Fee");
    expect(Number.isFinite(p50FeeNum)).toBe(true);
    expect(p50FeeNum).toBeGreaterThanOrEqual(0);

    const p95FeeNum = Number(ledger.p95Fee);
    expect(ledger).toHaveProperty("p95Fee");
    expect(Number.isFinite(p95FeeNum)).toBe(true);
    expect(p95FeeNum).toBeGreaterThanOrEqual(0);

    // capacityUsage is not a "fee" field so it stays as a number
    expect(typeof ledger.capacityUsage).toBe("number");
    expect(ledger.capacityUsage).toBeGreaterThanOrEqual(0);
    expect(ledger.capacityUsage).toBeLessThanOrEqual(1);
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  it("ledgers are ordered by sequence descending (newest first)", async () => {
    // Provide records in descending order as Horizon would (order=desc)
    const records = makeLedgerRecords(5, 5000);
    // Sequences should be 5000, 4999, 4998, 4997, 4996
    mockLedgers(records);

    const res = await request(app).get("/network/fee-history?ledgers=5");

    expect(res.statusCode).toBe(200);

    const sequences = res.body.data.ledgers.map((l) => l.sequence);

    // Verify descending order
    for (let i = 0; i < sequences.length - 1; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i + 1]);
    }
  });

  // ── Bonus: count and limit in meta ─────────────────────────────────────────
  it("response includes count and limit in the data", async () => {
    mockLedgers(makeLedgerRecords(10));

    const res = await request(app).get("/network/fee-history?ledgers=10");

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("count");
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data.count).toBe(10);
    expect(res.body.data.limit).toBe(10);
  });
});
