const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("Account Risk Scorer", () => {
  const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /account/:id/risk-score", () => {
    it("returns a low risk score for an old, multi-sig account with a home domain", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        home_domain: "stellar.org",
        signers: [{ key: "G1", weight: 1 }, { key: "G2", weight: 1 }],
        balances: [{ asset_type: "native", balance: "100" }],
      };

      const mockFirstOp = {
        records: [{ created_at: "2020-01-01T00:00:00Z" }], // Very old
      };

      const mockRecentTx = {
        records: [], // No recent tx (low activity is low risk here)
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      jest.spyOn(server, "operations").mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockFirstOp),
      });
      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockRecentTx),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.score).toBeGreaterThanOrEqual(70);
      expect(res.body.data.rating).toBe("low");
      expect(res.body.data.factors).toHaveLength(5);
    });

    it("returns a high risk score for a new account with no domain and many trustlines", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        home_domain: null,
        signers: [{ key: "G1", weight: 1 }],
        balances: Array(40).fill({ asset_type: "credit_alphanum4", asset_code: "SPAM", asset_issuer: "G1", balance: "1" }),
      };
      mockAccount.balances.push({ asset_type: "native", balance: "1" });

      const mockFirstOp = {
        records: [{ created_at: new Date().toISOString() }], // Brand new
      };

      const mockRecentTx = {
        records: Array(60).fill({ created_at: new Date().toISOString() }), // High activity
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      jest.spyOn(server, "operations").mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockFirstOp),
      });
      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockRecentTx),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.score).toBeLessThan(40);
      expect(res.body.data.rating).toBe("high");
    });

    it("returns 404 if the account is not found", async () => {
      jest.spyOn(server, "loadAccount").mockRejectedValue({
        response: { status: 404 },
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/risk-score");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
