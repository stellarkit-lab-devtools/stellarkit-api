const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
      offers: jest.fn(),
    },
  };
});

describe("Account Merge Eligibility API", () => {
  const { Keypair, StrKey } = require("@stellar/stellar-sdk");
  const realValidAccountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/merge-eligibility", () => {
    it("returns eligible: true when account meets all requirements", async () => {
      // Mock account with only native balance and no subentries
      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        balances: [{ asset_type: "native", balance: "100.0000000" }],
        subentry_count: 0,
        data_attr: {},
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/account/${realValidAccountId}/merge-eligibility`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eligible).toBe(true);
      expect(res.body.data.blockers).toHaveLength(0);
    });

    it("returns blockers when account has non-native balances and trustlines", async () => {
      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "G...", balance: "10.0000000" },
        ],
        subentry_count: 1,
        data_attr: {},
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/account/${realValidAccountId}/merge-eligibility`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.eligible).toBe(false);
      expect(res.body.data.blockers).toContain("Account has non-native asset balances. All assets must be sent or burned before merging.");
      expect(res.body.data.blockers).toContain("Account has 1 open trustline(s). All trustlines must be removed.");
    });

    it("returns blockers when account has open offers", async () => {
      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        balances: [{ asset_type: "native", balance: "100.0000000" }],
        subentry_count: 1,
        data_attr: {},
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [{ id: "123" }] }),
      });

      const res = await request(app).get(`/account/${realValidAccountId}/merge-eligibility`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.eligible).toBe(false);
      expect(res.body.data.blockers).toContain("Account has open offers. All offers must be cancelled.");
    });

    it("returns blockers when account has data entries", async () => {
      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        balances: [{ asset_type: "native", balance: "100.0000000" }],
        subentry_count: 1,
        data_attr: { "test-key": "test-value" },
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/account/${realValidAccountId}/merge-eligibility`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.eligible).toBe(false);
      expect(res.body.data.blockers).toContain("Account has 1 data entry/entries. All data entries must be removed.");
    });

    it("returns 404 when account is not found", async () => {
      server.loadAccount.mockRejectedValue({
        response: { status: 404 },
      });

      const res = await request(app).get(`/account/${realValidAccountId}/merge-eligibility`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe("Account not found.");
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/merge-eligibility");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
