/**
 * tests/routes/account.inactivity.test.js
 *
 * Unit tests for GET /account/:id/inactivity focusing on the exact status
 * label boundaries applied by the route handler.
 *
 * Thresholds (from src/routes/account.js):
 *   daysSinceLastTransaction < 30              → "active"
 *   daysSinceLastTransaction >= 30 && <= 180   → "idle"
 *   daysSinceLastTransaction > 180             → "dormant"
 *   no transactions in history                 → { status: "no_transactions" }
 *
 * Test scenarios:
 *   1. Account active within 7 days          → "active"
 *   2. Account inactive for 29 days          → "active"  (boundary: one day before cutoff)
 *   3. Account inactive for exactly 30 days  → "idle"    (boundary: first idle day)
 *   4. Account inactive for 60 days          → "idle"    (mid-range idle)
 *   5. Account inactive for exactly 180 days → "idle"    (boundary: last idle day)
 *   6. Account inactive for 181 days         → "dormant" (boundary: first dormant day)
 *   7. Account inactive for 365 days         → "dormant" (deep dormant)
 *   8. Brand-new account with no transactions → "no_transactions" with no crash
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock the Stellar server before requiring the app so the mock is in place
// when route modules are loaded.
jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      transactions: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fixed valid Stellar public key for use across tests. */
const ACCOUNT_ID = Keypair.random().publicKey();

/**
 * Builds a Horizon-style transactions() mock that resolves with a single
 * transaction record whose `created_at` is `daysAgo` days in the past.
 */
function mockTransactionDaysAgo(daysAgo) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return mockTransactionAt(date, `hash_${daysAgo}d`);
}

/**
 * Builds a Horizon-style transactions() mock that resolves with a single
 * transaction record at the given Date.
 */
function mockTransactionAt(date, hash = "hash_test") {
  server.transactions.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      records: [{ hash, created_at: date.toISOString() }],
    }),
  });
}

/** Builds a mock that returns an empty transaction history (new account). */
function mockNoTransactions() {
  server.transactions.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [] }),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /account/:id/inactivity – status label boundaries", () => {

  // ── active boundary ───────────────────────────────────────────────────────

  describe("active (< 30 days)", () => {
    it("returns status 'active' when last transaction was 7 days ago", async () => {
      mockTransactionDaysAgo(7);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.daysSinceLastTransaction).toBe(7);
    });

    it("returns status 'active' when last transaction was 1 day ago", async () => {
      mockTransactionDaysAgo(1);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.daysSinceLastTransaction).toBe(1);
    });

    it("returns status 'active' at the upper boundary: 29 days ago", async () => {
      mockTransactionDaysAgo(29);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.daysSinceLastTransaction).toBe(29);
    });
  });

  // ── idle boundary ─────────────────────────────────────────────────────────

  describe("idle (30 – 180 days)", () => {
    it("returns status 'idle' at the lower boundary: exactly 30 days ago", async () => {
      mockTransactionDaysAgo(30);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("idle");
      expect(res.body.data.daysSinceLastTransaction).toBe(30);
    });

    it("returns status 'idle' for a mid-range value: 60 days ago", async () => {
      mockTransactionDaysAgo(60);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("idle");
      expect(res.body.data.daysSinceLastTransaction).toBe(60);
    });

    it("returns status 'idle' for 90 days ago (within 30–180 range)", async () => {
      mockTransactionDaysAgo(90);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("idle");
      expect(res.body.data.daysSinceLastTransaction).toBe(90);
    });

    it("returns status 'idle' at the upper boundary: exactly 180 days ago", async () => {
      mockTransactionDaysAgo(180);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("idle");
      expect(res.body.data.daysSinceLastTransaction).toBe(180);
    });
  });

  // ── dormant boundary ──────────────────────────────────────────────────────

  describe("dormant (> 180 days)", () => {
    it("returns status 'dormant' at the lower boundary: 181 days ago", async () => {
      mockTransactionDaysAgo(181);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("dormant");
      expect(res.body.data.daysSinceLastTransaction).toBe(181);
    });

    it("returns status 'dormant' for a deeply inactive account: 365 days ago", async () => {
      mockTransactionDaysAgo(365);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("dormant");
      expect(res.body.data.daysSinceLastTransaction).toBe(365);
    });

    it("returns status 'dormant' for an account inactive over 90 days (> 180 days)", async () => {
      // The task mentions ">90 days → dormant" as an example; the actual code
      // threshold is >180 days. We test with a value that satisfies both.
      mockTransactionDaysAgo(200);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe("dormant");
      expect(res.body.data.daysSinceLastTransaction).toBe(200);
    });
  });

  // ── no transactions ───────────────────────────────────────────────────────

  describe("no transactions (brand-new account)", () => {
    it("returns 200 with status 'no_transactions' when no history exists", async () => {
      mockNoTransactions();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("no_transactions");
    });

    it("does not include daysSinceLastTransaction when there are no transactions", async () => {
      mockNoTransactions();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      // The route only returns status for empty accounts — no date fields
      expect(res.body.data).not.toHaveProperty("lastTransactionAt");
      expect(res.body.data).not.toHaveProperty("daysSinceLastTransaction");
    });

    it("does not crash or return 500 for a brand-new account with no transactions", async () => {
      mockNoTransactions();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.statusCode).not.toBe(500);
      expect(res.body.success).toBe(true);
    });
  });

  // ── response shape ────────────────────────────────────────────────────────

  describe("response shape for accounts with transactions", () => {
    it("includes lastTransactionAt as an ISO 8601 timestamp", async () => {
      mockTransactionDaysAgo(10);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.body.data).toHaveProperty("lastTransactionAt");
      // ISO 8601 format check
      expect(new Date(res.body.data.lastTransactionAt).toISOString()).toBe(
        res.body.data.lastTransactionAt
      );
    });

    it("includes lastTransactionHash", async () => {
      mockTransactionDaysAgo(10);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      expect(res.body.data).toHaveProperty("lastTransactionHash");
      expect(typeof res.body.data.lastTransactionHash).toBe("string");
    });

    it("includes daysSinceLastTransaction as a non-negative integer", async () => {
      mockTransactionDaysAgo(10);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/inactivity`);

      const days = res.body.data.daysSinceLastTransaction;
      expect(typeof days).toBe("number");
      expect(Number.isInteger(days)).toBe(true);
      expect(days).toBeGreaterThanOrEqual(0);
    });
  });
});
