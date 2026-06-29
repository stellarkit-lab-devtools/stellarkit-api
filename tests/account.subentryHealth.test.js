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

describe("Account Subentry Health API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/subentry-health", () => {
    it("returns healthy status for low subentry usage", async () => {
      const mockAccount = {
        id: accountId,
        subentry_count: 5,
        balances: [
          { asset_type: "native", balance: "100.0" },
          { asset_type: "credit_alphanum4", asset_code: "USD", asset_issuer: "G1", balance: "10.0" },
        ],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSubentries).toBe(5);
      expect(res.body.data.usagePercent).toBe(0.5);
      expect(res.body.data.warning).toBeNull();
      expect(res.body.data.breakdown.trustlines).toBe(1);
      expect(res.body.data.breakdown.offers).toBe(4); // 5 - 1 trustline - 0 signers - 0 data
    });

    it("returns approaching_limit warning for usage > 80%", async () => {
      const mockAccount = {
        id: accountId,
        subentry_count: 850,
        balances: [{ asset_type: "native", balance: "100.0" }],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.warning).toBe("approaching_limit");
      expect(res.body.data.usagePercent).toBe(85);
    });

    it("returns critical warning for usage > 95%", async () => {
      const mockAccount = {
        id: accountId,
        subentry_count: 980,
        balances: [{ asset_type: "native", balance: "100.0" }],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.warning).toBe("critical");
      expect(res.body.data.usagePercent).toBe(98);
    });

    it("correctly breaks down subentries", async () => {
      const mockAccount = {
        id: accountId,
        subentry_count: 20,
        balances: [
          { asset_type: "native", balance: "100.0" },
          { asset_type: "credit_alphanum4", asset_code: "USD", asset_issuer: "G1", balance: "10.0" },
          { asset_type: "credit_alphanum4", asset_code: "EUR", asset_issuer: "G2", balance: "10.0" },
        ],
        signers: [
          { key: accountId, weight: 1 },
          { key: "G_SIGNER_1", weight: 1 },
          { key: "G_SIGNER_2", weight: 1 },
        ],
        data_attr: {
          "key1": "dmFsdWUx",
          "key2": "dmFsdWUy",
        },
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.breakdown.trustlines).toBe(2);
      expect(res.body.data.breakdown.additionalSigners).toBe(2);
      expect(res.body.data.breakdown.dataEntries).toBe(2);
      expect(res.body.data.breakdown.offers).toBe(14); // 20 - 2 trust - 2 signers - 2 data
    });

    it("validates the account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/subentry-health");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
