/**
 * Tests for Issue #696 — POST /fee-estimate/batch
 *
 * Acceptance criteria:
 *   - Accepts { transactions: [{ type, operationCount }] } with max 10 entries
 *   - Returns { success: true, data: { estimates: [{ type, operationCount, feeStroops, feeXLM }] } }
 *   - Exceeding 10 entries returns a 400
 *   - Tests cover single, multiple, and over-limit cases
 */

"use strict";

const request = require("supertest");
const cacheService = require("../src/services/cache");

let app;
let server;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetModules();

  jest.doMock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
      ...originalModule,
      server: {
        ledgers: jest.fn(),
        feeStats: jest.fn(),
      },
    };
  });

  ({ server } = require("../src/config/stellar"));
  app = require("../src/index");
  cacheService.flush();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Shared mock helper ─────────────────────────────────────────────────────────

function mockFeeStats(p50 = "200") {
  jest.spyOn(server, "feeStats").mockResolvedValue({
    fee_charged: {
      min: "100",
      p10: "110",
      p50,
      p95: "300",
      p99: "400",
      max: "500",
    },
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.10",
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /fee-estimate/batch", () => {
  // ── Single entry ───────────────────────────────────────────────────────────

  describe("single-entry batches", () => {
    it("returns a fee estimate for a single transaction type", async () => {
      mockFeeStats("200");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 1 }] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("estimates");
      expect(Array.isArray(res.body.data.estimates)).toBe(true);
      expect(res.body.data.estimates).toHaveLength(1);
    });

    it("estimate has type, operationCount, feeStroops, and feeXLM", async () => {
      mockFeeStats("200");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 1 }] });

      const estimate = res.body.data.estimates[0];
      expect(estimate).toHaveProperty("type", "payment");
      expect(estimate).toHaveProperty("operationCount", 1);
      expect(estimate).toHaveProperty("feeStroops");
      expect(estimate).toHaveProperty("feeXLM");
      expect(typeof estimate.feeStroops).toBe("number");
      expect(typeof estimate.feeXLM).toBe("string");
    });

    it("computes feeStroops as p50 * operationCount", async () => {
      mockFeeStats("200"); // p50 = 200 stroops

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 2 }] });

      expect(res.statusCode).toBe(200);
      const estimate = res.body.data.estimates[0];
      // 200 stroops * 2 operations = 400 stroops
      expect(estimate.feeStroops).toBe(400);
    });

    it("feeXLM is a seven-decimal string representation", async () => {
      mockFeeStats("200");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 1 }] });

      const { feeXLM } = res.body.data.estimates[0];
      // 200 stroops = 0.0000200 XLM
      expect(feeXLM).toMatch(/^\d+\.\d{7}$/);
    });
  });

  // ── Multiple entries ───────────────────────────────────────────────────────

  describe("multiple-entry batches", () => {
    it("returns an estimate for each entry in the batch", async () => {
      mockFeeStats("200");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({
          transactions: [
            { type: "payment", operationCount: 1 },
            { type: "swap", operationCount: 3 },
            { type: "clawback", operationCount: 2 },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.estimates).toHaveLength(3);
    });

    it("preserves transaction types in the response", async () => {
      mockFeeStats("100");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({
          transactions: [
            { type: "payment", operationCount: 1 },
            { type: "create_account", operationCount: 1 },
          ],
        });

      const types = res.body.data.estimates.map((e) => e.type);
      expect(types).toEqual(["payment", "create_account"]);
    });

    it("computes independent fee for each entry based on its own operationCount", async () => {
      mockFeeStats("100"); // p50 = 100 stroops

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({
          transactions: [
            { type: "payment", operationCount: 1 },  // 100 * 1 = 100
            { type: "swap", operationCount: 3 },     // 100 * 3 = 300
            { type: "batch_transfer", operationCount: 5 }, // 100 * 5 = 500
          ],
        });

      const stroops = res.body.data.estimates.map((e) => e.feeStroops);
      expect(stroops).toEqual([100, 300, 500]);
    });

    it("handles exactly 10 entries (at the limit) successfully", async () => {
      mockFeeStats("100");

      const transactions = Array.from({ length: 10 }, (_, i) => ({
        type: `tx_type_${i}`,
        operationCount: 1,
      }));

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.estimates).toHaveLength(10);
    });
  });

  // ── Over-limit cases ───────────────────────────────────────────────────────

  describe("over-limit cases", () => {
    it("returns 400 when more than 10 transactions are submitted", async () => {
      const transactions = Array.from({ length: 11 }, (_, i) => ({
        type: `tx_type_${i}`,
        operationCount: 1,
      }));

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("error message mentions the maximum limit of 10", async () => {
      const transactions = Array.from({ length: 11 }, () => ({
        type: "payment",
        operationCount: 1,
      }));

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions });

      expect(res.body.error.message).toMatch(/10/);
    });

    it("returns 400 for 20 entries (well over limit)", async () => {
      const transactions = Array.from({ length: 20 }, () => ({
        type: "payment",
        operationCount: 1,
      }));

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── Validation errors ──────────────────────────────────────────────────────

  describe("validation errors", () => {
    it("returns 400 when the transactions property is missing", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ notTransactions: [] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/transactions/);
    });

    it("returns 400 when transactions is not an array", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: "payment" });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when an entry is missing operationCount", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment" }] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when an entry has operationCount < 1", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 0 }] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when an entry has a non-integer operationCount", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 1.5 }] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when type is missing from an entry", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ operationCount: 1 }] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when type is an empty string", async () => {
      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "", operationCount: 1 }] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("response envelope is { success: true, data: { estimates: [...] } }", async () => {
      mockFeeStats("150");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({ transactions: [{ type: "payment", operationCount: 1 }] });

      expect(res.body).toHaveProperty("success", true);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data).toHaveProperty("estimates");
    });

    it("each estimate contains type, operationCount, feeStroops, feeXLM", async () => {
      mockFeeStats("150");

      const res = await request(app)
        .post("/fee-estimate/batch")
        .send({
          transactions: [
            { type: "payment", operationCount: 2 },
          ],
        });

      const estimate = res.body.data.estimates[0];
      expect(Object.keys(estimate).sort()).toEqual(
        ["feeStroops", "feeXLM", "operationCount", "type"].sort()
      );
    });
  });
});
