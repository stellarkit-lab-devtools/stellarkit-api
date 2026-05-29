const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("Account Balance Conversion", () => {
  const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const ISSUER = "GBBD67CHI7LWB6C67GR77S3E5K5SNCZ275W6G3XF2A6F2A6F2A6F2A6F";
  const ANOTHER_ISSUER =
    "GAHH7A6X7K4J5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /account/:id/balances/xlm-equivalent", () => {
    it.skip("converts multiple asset balances to XLM equivalents", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: ISSUER,
            balance: "50.0000000",
          },
        ],
      };

      const mockPathResponse = {
        records: [
          {
            destination_amount: "25.0000000", // 50 USDC = 25 XLM (rate 0.5)
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      jest.spyOn(server, "strictSendPaths").mockReturnValue({
        call: jest.fn().mockResolvedValue(mockPathResponse),
      });

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/balances/xlm-equivalent`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalXlmEquivalent).toBe("125.0000000");
      expect(res.body.data.balances).toHaveLength(2);
      expect(res.body.data.balances[0]).toEqual({
        asset: "XLM:native",
        balance: "100.0000000",
        xlmEquivalent: "100.0000000",
        rateUsed: "1.0000000",
      });
      expect(res.body.data.balances[1]).toEqual({
        asset: `USDC:${ISSUER}`,
        balance: "50.0000000",
        xlmEquivalent: "25.0000000",
        rateUsed: "0.5000000",
      });
    });

    it("marks assets with no available path as null equivalents", async () => {
      const mockAccount = {
        id: ACCOUNT_ID,
        balances: [
          { asset_type: "native", balance: "10.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "SHIT",
            asset_issuer: ANOTHER_ISSUER,
            balance: "1000.0000000",
          },
        ],
      };

      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      server.strictSendPaths = jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/balances/xlm-equivalent`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalXlmEquivalent).toBe("10.0000000");
      expect(res.body.data.balances[1]).toEqual({
        asset: `SHIT:${ANOTHER_ISSUER}`,
        balance: "1000.0000000",
        xlmEquivalent: null,
        rateUsed: null,
      });
    });

    it("returns 404 for non-existent account", async () => {
      jest.spyOn(server, "loadAccount").mockRejectedValue({
        response: { status: 404 },
      });

      const res = await request(app).get(
        `/account/${ACCOUNT_ID}/balances/xlm-equivalent`,
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get(
        "/account/INVALID_ID/balances/xlm-equivalent",
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
