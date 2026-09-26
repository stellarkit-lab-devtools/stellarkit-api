const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const VALID_HASH_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_HASH_B = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function mockTransactions(hashToRecord) {
  jest.spyOn(server, "transactions").mockReturnValue({
    transaction: jest.fn().mockImplementation((hash) => {
      if (hashToRecord[hash]) {
        return { call: jest.fn().mockResolvedValue(hashToRecord[hash]) };
      }
      return { call: jest.fn().mockRejectedValue({ response: { status: 404 } }) };
    }),
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("POST /transactions/batch-status", () => {
  it("returns status for each hash in a 2-hash array", async () => {
    mockTransactions({
      [VALID_HASH_A]: { hash: VALID_HASH_A, successful: true, ledger: 100, created_at: "2024-01-01T00:00:00Z", fee_charged: "100" },
      [VALID_HASH_B]: { hash: VALID_HASH_B, successful: false, ledger: 101, created_at: "2024-01-02T00:00:00Z", fee_charged: "200" },
    });

    const res = await request(app)
      .post("/transactions/batch-status")
      .send({ hashes: [VALID_HASH_A, VALID_HASH_B] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);

    const first = res.body.data.items[0];
    expect(first.hash).toBe(VALID_HASH_A);
    expect(first.found).toBe(true);
    expect(first).toHaveProperty("successful");
    expect(first).toHaveProperty("ledger");
    expect(first).toHaveProperty("createdAt");
    expect(first).toHaveProperty("fee");

    const second = res.body.data.items[1];
    expect(second.hash).toBe(VALID_HASH_B);
    expect(second.found).toBe(true);
  });

  it("returns 400 when the hashes array has 21 entries", async () => {
    const tooMany = Array(21).fill(VALID_HASH_A);

    const res = await request(app)
      .post("/transactions/batch-status")
      .send({ hashes: tooMany });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("Maximum of 20 hashes");
  });

  it("returns an error entry for an invalid hash without failing the whole request", async () => {
    mockTransactions({
      [VALID_HASH_A]: { hash: VALID_HASH_A, successful: true, ledger: 100, created_at: "2024-01-01T00:00:00Z", fee_charged: "100" },
    });

    const res = await request(app)
      .post("/transactions/batch-status")
      .send({ hashes: [VALID_HASH_A, "NOT_A_VALID_HASH"] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);

    const validItem = res.body.data.items[0];
    expect(validItem.found).toBe(true);

    const invalidItem = res.body.data.items[1];
    expect(invalidItem.hash).toBe("NOT_A_VALID_HASH");
    expect(invalidItem.found).toBe(false);
    expect(invalidItem.error).toBeDefined();
  });

  it("returns 400 for an empty hashes array", async () => {
    const res = await request(app)
      .post("/transactions/batch-status")
      .send({ hashes: [] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
