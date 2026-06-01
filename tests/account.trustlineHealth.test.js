const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("Account Trustline Health", () => {
  const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const ISSUER_1 = "GBBD67CHI7LWB6C67GR77S3E5K5SNCZ275W6G3XF2A6F2A6F2A6F2A6F";
  const ISSUER_2 = "GAHH7A6X7K4J5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /account/:id/trustline-health", () => {
    it("returns trustline health data for all asset trustlines", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: ISSUER_1,
            balance: "50.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "10.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "EUR",
            asset_issuer: ISSUER_2,
            balance: "95.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accountId).toBe(ACCOUNT_ID);
      expect(res.body.data.trustlineCount).toBe(2);
      expect(res.body.data.warningCount).toBe(1); // EUR is at 95% usage, triggers warning
      expect(res.body.data.trustlines).toHaveLength(2);

      // Verify first trustline (USD)
      expect(res.body.data.trustlines[0]).toEqual({
        assetCode: "USD",
        assetIssuer: ISSUER_1,
        balance: "50",
        limit: "100",
        buyingLiabilities: "0",
        sellingLiabilities: "10",
        usagePercent: 50,
        availableCapacity: "50", // 100 - 50 = 50
        isAuthorized: true,
        isClawbackEnabled: false,
        warning: null,
      });

      // Verify second trustline (EUR) - close to limit and triggers warning
      expect(res.body.data.trustlines[1]).toEqual({
        assetCode: "EUR",
        assetIssuer: ISSUER_2,
        balance: "95",
        limit: "100",
        buyingLiabilities: "0",
        sellingLiabilities: "0",
        usagePercent: 95,
        availableCapacity: "5",
        isAuthorized: true,
        isClawbackEnabled: false,
        warning: "near_limit",
      });
    });

    it("flags trustlines with usage above 90% as near_limit warning", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: ISSUER_1,
            balance: "91.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.warningCount).toBe(1);
      expect(res.body.data.trustlines[0].warning).toBe("near_limit");
      expect(res.body.data.trustlines[0].usagePercent).toBe(91);
    });

    it("considers buying liabilities in usage calculation", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "BTC",
            asset_issuer: ISSUER_1,
            balance: "50.0000000",
            limit: "100.0000000",
            buying_liabilities: "45.0000000",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      const trustline = res.body.data.trustlines[0];
      expect(trustline.usagePercent).toBe(95); // (50 + 45) / 100 * 100 = 95%
      expect(trustline.warning).toBe("near_limit");
      expect(trustline.availableCapacity).toBe("5"); // 100 - 50 - 45 = 5
    });

    it("calculates available capacity correctly", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "ETH",
            asset_issuer: ISSUER_1,
            balance: "25.0000000",
            limit: "100.0000000",
            buying_liabilities: "10.0000000",
            selling_liabilities: "5.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      const trustline = res.body.data.trustlines[0];
      // Available = limit - balance - buying_liabilities = 100 - 25 - 10 = 65
      expect(trustline.availableCapacity).toBe("65");
    });

    it("handles unauthorized trustlines", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "XRP",
            asset_issuer: ISSUER_1,
            balance: "50.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: false,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      const trustline = res.body.data.trustlines[0];
      expect(trustline.isAuthorized).toBe(false);
    });

    it("handles trustlines with clawback enabled", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "CLAWB",
            asset_issuer: ISSUER_1,
            balance: "50.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: true,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      const trustline = res.body.data.trustlines[0];
      expect(trustline.isClawbackEnabled).toBe(true);
    });

    it("excludes native XLM from trustline health data", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: ISSUER_1,
            balance: "50.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      // Only 1 trustline (USD), native XLM should be excluded
      expect(res.body.data.trustlineCount).toBe(1);
      expect(res.body.data.trustlines).toHaveLength(1);
      expect(res.body.data.trustlines[0].assetCode).toBe("USD");
    });

    it("returns empty trustlines array for account with no assets", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.trustlineCount).toBe(0);
      expect(res.body.data.warningCount).toBe(0);
      expect(res.body.data.trustlines).toHaveLength(0);
    });

    it("handles zero limit gracefully", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "TEST",
            asset_issuer: ISSUER_1,
            balance: "0.0000000",
            limit: "0.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      const trustline = res.body.data.trustlines[0];
      expect(trustline.usagePercent).toBe(0);
      expect(trustline.availableCapacity).toBe("0");
    });

    it("returns 404 for non-existent account", async () => {
      jest.spyOn(server, "loadAccount").mockRejectedValue({
        response: { status: 404 },
      });

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get(
        "/account/INVALID_ID/trustline-health",
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("correctly counts multiple warnings", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: ISSUER_1,
            balance: "92.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "EUR",
            asset_issuer: ISSUER_2,
            balance: "98.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "GBP",
            asset_issuer: ISSUER_1,
            balance: "50.0000000",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.trustlineCount).toBe(3);
      expect(res.body.data.warningCount).toBe(2); // USD and EUR should have warnings
      expect(res.body.data.trustlines[0].warning).toBe("near_limit"); // USD at 92%
      expect(res.body.data.trustlines[1].warning).toBe("near_limit"); // EUR at 98%
      expect(res.body.data.trustlines[2].warning).toBeNull(); // GBP at 50%
    });

    it("rounds usage percent to 2 decimal places", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: ISSUER_1,
            balance: "33.3333333",
            limit: "100.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/trustline-health`,
      );

      expect(res.statusCode).toBe(200);
      const usagePercent = res.body.data.trustlines[0].usagePercent;
      expect(typeof usagePercent).toBe("number");
      // Check that it's rounded to 2 decimals
      expect(
        usagePercent.toString().split(".")[1]?.length || 0,
      ).toBeLessThanOrEqual(2);
    });
  });
});
