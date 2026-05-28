const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

describe("Account Signer Validation API", () => {
  const accountId = Keypair.random().publicKey();
  const signer1 = Keypair.random().publicKey();
  const signer2 = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /account/:id/validate-signers", () => {
    it("returns correct threshold status for a set of signers", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        thresholds: {
          low_threshold: 1,
          med_threshold: 2,
          high_threshold: 3
        },
        signers: [
          { key: accountId, weight: 1 },
          { key: signer1, weight: 1 },
          { key: signer2, weight: 1 }
        ]
      });

      const res = await request(app)
        .post(`/account/${accountId}/validate-signers`)
        .send({ signers: [signer1, signer2] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.combinedWeight).toBe(2);
      expect(res.body.data.canSignLow).toBe(true);
      expect(res.body.data.canSignMed).toBe(true);
      expect(res.body.data.canSignHigh).toBe(false);
      expect(res.body.data.matchedSigners).toHaveLength(2);
    });

    it("returns 400 for invalid signer key", async () => {
      const res = await request(app)
        .post(`/account/${accountId}/validate-signers`)
        .send({ signers: ["INVALID_KEY"] });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toContain("Invalid signer key");
    });

    it("returns 400 if signers body is missing or not an array", async () => {
      const res = await request(app)
        .post(`/account/${accountId}/validate-signers`)
        .send({ signers: "not-an-array" });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toContain("must be an array");
    });

    it("handles accounts with high thresholds correctly", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        thresholds: {
          low_threshold: 10,
          med_threshold: 10,
          high_threshold: 10
        },
        signers: [
          { key: signer1, weight: 5 },
          { key: signer2, weight: 5 }
        ]
      });

      const res = await request(app)
        .post(`/account/${accountId}/validate-signers`)
        .send({ signers: [signer1, signer2] });

      expect(res.body.data.combinedWeight).toBe(10);
      expect(res.body.data.canSignHigh).toBe(true);
    });

    it("returns 404 if account not found", async () => {
      const error = new Error("Not Found");
      error.response = { status: 404 };
      server.loadAccount.mockRejectedValue(error);

      const res = await request(app)
        .post(`/account/${accountId}/validate-signers`)
        .send({ signers: [signer1] });

      expect(res.statusCode).toBe(404);
      expect(res.body.error.message).toContain("Account not found");
    });
  });
});
