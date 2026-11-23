/**
 * tests/routes/account.volume.test.js
 *
 * Unit tests for GET /account/:id/volume — time range filtering via ?days=
 *
 * Acceptance criteria (issue #916):
 *   1. Omitting ?days= defaults to 30 days.
 *   2. ?days=7  returns data for a 7-day window.
 *   3. ?days=90 returns data for a 90-day window (maximum allowed).
 *   4. ?days=91 returns HTTP 400 (exceeds maximum).
 *   5. ?days=0  returns HTTP 400 (below minimum of 1).
 *
 * The Stellar SDK payments() call is mocked so no live network requests are
 * made. Each test verifies both the HTTP status and the period.days value
 * (or the 400 error shape for invalid inputs).
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// ---------------------------------------------------------------------------
// Mock the Stellar server before the app is required so the mock is in place
// when account.js loads its route handlers.
// ---------------------------------------------------------------------------
jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      payments: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_ID = Keypair.random().publicKey();

/**
 * Builds a Horizon-style payments() mock that returns a single successful
 * payment record whose created_at is `daysAgo` days in the past.
 *
 * The route uses payments().forAccount().limit().order().cursor?().call()
 * so we mock the full builder chain.  A second call with the same cursor is
 * not expected (records.length < 200 signals done), so one resolved call is
 * sufficient.
 */
function mockPaymentsWithRecord(daysAgo = 1) {
  const createdAt = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000
  ).toISOString();

  const record = {
    type: "payment",
    transaction_successful: true,
    created_at: createdAt,
    paging_token: "token_1",
    asset_type: "native",
    asset_code: undefined,
    asset_issuer: undefined,
    amount: "10.0000000",
    from: ACCOUNT_ID,
    to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  };

  server.payments.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [record] }),
  });
}

/** Builds a mock that returns an empty payments page (no history). */
function mockNoPayments() {
  server.payments.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
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

describe("GET /account/:id/volume — ?days= time range filtering", () => {

  // ── default: no ?days= → 30 days ─────────────────────────────────────────

  describe("default (omitting ?days=)", () => {
    it("returns 200 and period.days=30 when ?days= is omitted", async () => {
      mockNoPayments();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.period.days).toBe(30);
    });

    it("includes period.from and period.to ISO timestamps", async () => {
      mockNoPayments();

      const before = Date.now();
      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume`);
      const after = Date.now();

      expect(res.statusCode).toBe(200);
      const { from, to } = res.body.data.period;

      // 'to' should be within the request window
      const toMs = new Date(to).getTime();
      expect(toMs).toBeGreaterThanOrEqual(before);
      expect(toMs).toBeLessThanOrEqual(after + 100);

      // 'from' should be approximately 30 days before 'to'
      const fromMs = new Date(from).getTime();
      const diffDays = (toMs - fromMs) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(30, 0);
    });

    it("applies a 30-day cutoff: payment within window is counted", async () => {
      mockPaymentsWithRecord(15); // 15 days ago — inside 30-day window

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalTransactions).toBe(1);
    });
  });

  // ── ?days=7 ───────────────────────────────────────────────────────────────

  describe("?days=7", () => {
    it("returns 200 and period.days=7", async () => {
      mockNoPayments();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=7`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.period.days).toBe(7);
    });

    it("applies a 7-day cutoff: payment 3 days ago is counted", async () => {
      mockPaymentsWithRecord(3); // 3 days ago — inside 7-day window

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=7`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalTransactions).toBe(1);
    });

    it("applies a 7-day cutoff: payment 8 days ago is excluded", async () => {
      mockPaymentsWithRecord(8); // 8 days ago — outside 7-day window

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=7`);

      expect(res.statusCode).toBe(200);
      // The record is outside the window so totalTransactions should be 0
      expect(res.body.data.totalTransactions).toBe(0);
    });
  });

  // ── ?days=90 (maximum allowed) ────────────────────────────────────────────

  describe("?days=90", () => {
    it("returns 200 and period.days=90", async () => {
      mockNoPayments();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=90`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.period.days).toBe(90);
    });

    it("applies a 90-day window: payment 89 days ago is counted", async () => {
      mockPaymentsWithRecord(89);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=90`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalTransactions).toBe(1);
    });
  });

  // ── ?days=91 → 400 ───────────────────────────────────────────────────────

  describe("?days=91 (exceeds maximum)", () => {
    it("returns 400 when ?days=91", async () => {
      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=91`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("does not call the Stellar SDK when ?days=91", async () => {
      await request(app).get(`/account/${ACCOUNT_ID}/volume?days=91`);

      expect(server.payments).not.toHaveBeenCalled();
    });

    it("returns an error message mentioning the days constraint", async () => {
      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=91`);

      expect(res.statusCode).toBe(400);
      const body = JSON.stringify(res.body).toLowerCase();
      expect(body).toMatch(/days/);
    });
  });

  // ── ?days=0 → 400 ────────────────────────────────────────────────────────

  describe("?days=0 (below minimum)", () => {
    it("returns 400 when ?days=0", async () => {
      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=0`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("does not call the Stellar SDK when ?days=0", async () => {
      await request(app).get(`/account/${ACCOUNT_ID}/volume?days=0`);

      expect(server.payments).not.toHaveBeenCalled();
    });

    it("returns an error message mentioning the days constraint", async () => {
      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume?days=0`);

      expect(res.statusCode).toBe(400);
      const body = JSON.stringify(res.body).toLowerCase();
      expect(body).toMatch(/days/);
    });
  });

  // ── response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("includes volumeByAsset as an array", async () => {
      mockNoPayments();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data.volumeByAsset)).toBe(true);
    });

    it("includes totalTransactions as a non-negative integer", async () => {
      mockNoPayments();

      const res = await request(app).get(`/account/${ACCOUNT_ID}/volume`);

      expect(res.statusCode).toBe(200);
      const total = res.body.data.totalTransactions;
      expect(typeof total).toBe("number");
      expect(total).toBeGreaterThanOrEqual(0);
    });
  });
});
