const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("Transaction Batch Status Checker", () => {
  const VALID_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const ANOTHER_VALID_HASH = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /transactions/batch-status", () => {
    it("returns status for multiple valid hashes", async () => {
      const mockTxResponse = {
        hash: VALID_HASH,
        successful: true,
        ledger: 12345,
        created_at: "2024-05-28T10:00:00Z",
        fee_charged: "100",
      };

      const mockAnotherTxResponse = {
        hash: ANOTHER_VALID_HASH,
        successful: false,
        ledger: 12346,
        created_at: "2024-05-28T10:05:00Z",
        fee_charged: "200",
      };

      // Simpler mock implementation for Promise.all context
      jest.spyOn(server, "transactions").mockReturnValue({
        transaction: jest.fn().mockImplementation((hash) => {
          if (hash === VALID_HASH) {
            return { call: jest.fn().mockResolvedValue(mockTxResponse) };
          }
          if (hash === ANOTHER_VALID_HASH) {
            return { call: jest.fn().mockResolvedValue(mockAnotherTxResponse) };
          }
          return { call: jest.fn().mockRejectedValue({ response: { status: 404 } }) };
        }),
      });

      const res = await request(app)
        .post("/transactions/batch-status")
        .send({ hashes: [VALID_HASH, ANOTHER_VALID_HASH] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({
        hash: VALID_HASH,
        found: true,
        successful: true,
        ledger: 12345,
        createdAt: "2024-05-28T10:00:00Z",
        fee: "100",
      });
      expect(res.body.data[1]).toEqual({
        hash: ANOTHER_VALID_HASH,
        found: true,
        successful: false,
        ledger: 12346,
        createdAt: "2024-05-28T10:05:00Z",
        fee: "200",
      });
    });

    it("returns found: false for non-existent hashes", async () => {
      jest.spyOn(server, "transactions").mockReturnValue({
        transaction: jest.fn().mockReturnValue({
          call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
        }),
      });

      const res = await request(app)
        .post("/transactions/batch-status")
        .send({ hashes: [VALID_HASH] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0]).toEqual({
        hash: VALID_HASH,
        found: false,
      });
    });

    it("returns 400 if more than 20 hashes are provided", async () => {
      const tooManyHashes = Array(21).fill(VALID_HASH);
      const res = await request(app)
        .post("/transactions/batch-status")
        .send({ hashes: tooManyHashes });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Maximum of 20 hashes allowed");
    });

    it("returns 400 if any hash is invalid", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")
        .send({ hashes: [VALID_HASH, "INVALID_HASH"] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Invalid transaction hash");
    });

    it("returns 400 if hashes property is missing or not an array", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")
        .send({ notHashes: [] });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Property 'hashes' is required");
    });
  });
});
