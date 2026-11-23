/**
 * tests/routes/network.ledgerHistory.test.js
 *
 * Coverage for GET /network/ledger-history:
 *   1. default response returns up to 10 ledgers each with
 *      sequence, closedAt, transactionCount, operationCount, and baseFee
 *   2. ?limit=5 returns exactly 5 ledgers
 *   3. ?limit=0 returns a 400
 *   4. ?limit=51 returns a 400 since the cap is 50
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
    successful_transaction_count: 10 + (sequence % 7),
    operation_count: 20 + (sequence % 11),
    base_fee_in_stroops: "100",
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

describe("GET /network/ledger-history", () => {
  it("default response returns up to 10 ledgers each with sequence, closedAt, transactionCount, operationCount, and baseFee", async () => {
    server.ledgers.mockReturnValue(
      makeLedgersMock(makeLedgerRecords(10))
    );

    const res = await request(app).get("/network/ledger-history");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const ledgers = res.body.data.ledgers;
    expect(Array.isArray(ledgers)).toBe(true);
    expect(ledgers.length).toBeLessThanOrEqual(10);
    expect(ledgers.length).toBeGreaterThan(0);

    for (const ledger of ledgers) {
      expect(ledger).toHaveProperty("sequence");
      expect(ledger).toHaveProperty("closedAt");
      expect(ledger).toHaveProperty("transactionCount");
      expect(ledger).toHaveProperty("operationCount");
      expect(ledger).toHaveProperty("baseFee");
    }
  });

  it("?limit=5 returns exactly 5 ledgers", async () => {
    server.ledgers.mockReturnValue(makeLedgersMock(makeLedgerRecords(5)));

    const res = await request(app).get("/network/ledger-history?limit=5");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ledgers).toHaveLength(5);
  });

  it("?limit=0 returns a 400", async () => {
    server.ledgers.mockReturnValue(makeLedgersMock(makeLedgerRecords(10)));

    const res = await request(app).get("/network/ledger-history?limit=0");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("?limit=51 returns a 400 since the cap is 50", async () => {
    server.ledgers.mockReturnValue(makeLedgersMock(makeLedgerRecords(10)));

    const res = await request(app).get("/network/ledger-history?limit=51");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
