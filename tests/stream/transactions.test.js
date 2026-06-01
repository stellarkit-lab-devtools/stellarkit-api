const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

describe("GET /stream/transactions/:id — SSE Endpoint", () => {
  const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
  const INVALID_KEY = "not-a-stellar-key";
  const UNFUNDED_KEY = "GBSU4GKNZITFA3OVBBHOTS6EB4ZLXJ6FMDPCF67KU3FJV6LRYLZEYJ52";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Validation Tests ────────────────────────────────────────────────────────

  describe("Validation — missing account ID", () => {
    it("returns 400 or 404 when account ID is missing", async () => {
      const res = await request(app).get("/stream/transactions/");

      // When no ID is provided, Express won't match the route, so we get 404
      // This is expected behavior - the route requires an ID parameter
      expect([400, 404]).toContain(res.statusCode);
      expect(res.body.success).toBe(false);
      // Ensure SSE headers are NOT set
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
    });
  });

  describe("Validation — malformed account ID", () => {
    it("returns 400 JSON for invalid Stellar key format", async () => {
      const res = await request(app).get(`/stream/transactions/${INVALID_KEY}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.body.error.message).toContain("Invalid Stellar account ID");
      expect(res.body.error.detail).toContain("G...");
      // Ensure SSE headers are NOT set
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
    });
  });

  describe("Validation — non-existent account", () => {
    it("returns 404 JSON when account does not exist on network", async () => {
      // Mock server.loadAccount to throw AccountNotFoundError (404)
      jest.spyOn(server, "loadAccount").mockRejectedValueOnce({
        response: {
          status: 404,
          data: {
            title: "Not Found",
            detail: "The resource at the url requested was not found.",
          },
        },
      });

      const res = await request(app).get(`/stream/transactions/${UNFUNDED_KEY}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");
      expect(res.body.error.message).toContain("Account not found");
      // Ensure SSE headers are NOT set
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
    });
  });

  // ── Transaction Formatter Tests ─────────────────────────────────────────────

  describe("Transaction Formatter", () => {
    it("formats transaction with all required fields", () => {
      const { formatTransaction } = require("../../src/utils/formatTransaction");

      const mockTransaction = {
        id: "tx-id",
        hash: "tx-hash",
        ledger: 100,
        created_at: "2024-01-01T12:00:00Z",
        source_account: VALID_KEY,
        fee_charged: "500",
        operation_count: 2,
        envelope_xdr: "envelope",
        result_xdr: "result",
        result_meta_xdr: "meta",
        memo_type: "text",
        memo: "test memo",
        successful: true,
      };

      const formatted = formatTransaction(mockTransaction);

      expect(formatted).toEqual({
        id: "tx-id",
        hash: "tx-hash",
        ledger: 100,
        created_at: "2024-01-01T12:00:00Z",
        source_account: VALID_KEY,
        fee_charged: "500",
        operation_count: 2,
        envelope_xdr: "envelope",
        result_xdr: "result",
        result_meta_xdr: "meta",
        memo_type: "text",
        memo: "test memo",
        successful: true,
      });
    });

    it("converts undefined memo to null", () => {
      const { formatTransaction } = require("../../src/utils/formatTransaction");

      const mockTransaction = {
        id: "tx-id",
        hash: "tx-hash",
        ledger: 100,
        created_at: "2024-01-01T12:00:00Z",
        source_account: VALID_KEY,
        fee_charged: "500",
        operation_count: 1,
        envelope_xdr: "envelope",
        result_xdr: "result",
        result_meta_xdr: "meta",
        memo_type: "none",
        memo: undefined,
        successful: true,
      };

      const formatted = formatTransaction(mockTransaction);

      expect(formatted.memo).toBeNull();
    });
  });
});
