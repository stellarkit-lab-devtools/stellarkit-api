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
      expect(res.body.error.type).toBe("InvalidAccountId");
    });

    // --- Warning threshold scenarios ---

    it("returns warning: null for an account with 0 subentries", async () => {
      // 0 subentries = 0% usage — well below all warning thresholds
      const mockAccount = {
        id: accountId,
        subentry_count: 0,
        balances: [{ asset_type: "native", balance: "100.0" }],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSubentries).toBe(0);
      expect(res.body.data.usagePercent).toBe(0);
      expect(res.body.data.remainingSlots).toBe(1000);
      // No warning at 0% usage
      expect(res.body.data.warning).toBeNull();
    });

    it("returns warning: null for an account with moderate subentries (below 80% threshold)", async () => {
      // 500 subentries = 50% usage — moderate load, no warning triggered
      const mockAccount = {
        id: accountId,
        subentry_count: 500,
        balances: [
          { asset_type: "native", balance: "100.0" },
          ...Array.from({ length: 10 }, (_, i) => ({
            asset_type: "credit_alphanum4",
            asset_code: `AS${i}`,
            asset_issuer: `GISSUER${i}`,
            balance: "10.0",
          })),
        ],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalSubentries).toBe(500);
      expect(res.body.data.usagePercent).toBe(50);
      // Moderate usage — below the 80% approaching_limit threshold
      expect(res.body.data.warning).toBeNull();
      expect(res.body.data.remainingSlots).toBe(500);
    });

    it("returns warning: critical for an account approaching the protocol limit of 1000 subentries", async () => {
      // 960 subentries = 96% usage — above the 95% critical threshold
      const mockAccount = {
        id: accountId,
        subentry_count: 960,
        balances: [{ asset_type: "native", balance: "100.0" }],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalSubentries).toBe(960);
      expect(res.body.data.maxSubentries).toBe(1000);
      expect(res.body.data.usagePercent).toBe(96);
      expect(res.body.data.remainingSlots).toBe(40);
      // 96% usage is above the 95% threshold → critical warning
      expect(res.body.data.warning).toBe("critical");
    });

    it("returns warning: approaching_limit at exactly the 80% boundary (801 subentries)", async () => {
      // 801 subentries = 80.1% — just above the approaching_limit threshold
      const mockAccount = {
        id: accountId,
        subentry_count: 801,
        balances: [{ asset_type: "native", balance: "100.0" }],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.warning).toBe("approaching_limit");
    });

    it("returns warning: null at exactly 800 subentries (80% usage — at threshold, not above)", async () => {
      // 800 subentries = exactly 80% — the condition is > 80%, so this should not trigger
      const mockAccount = {
        id: accountId,
        subentry_count: 800,
        balances: [{ asset_type: "native", balance: "100.0" }],
        signers: [{ key: accountId, weight: 1 }],
        data_attr: {},
      };

      server.loadAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/account/${accountId}/subentry-health`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.usagePercent).toBe(80);
      // Exactly 80% does not exceed the > 80% threshold
      expect(res.body.data.warning).toBeNull();
    });
  });
});
