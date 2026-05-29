const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("Asset Routes", () => {
  const ASSET_CODE = "USDC";
  const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /asset/:code/:issuer/supply", () => {
    it("returns full supply breakdown for a valid asset", async () => {
      const mockAssetResponse = {
        records: [
          {
            asset_code: ASSET_CODE,
            asset_issuer: ASSET_ISSUER,
            amount: "1000.0000000",
            liquidity_pools_amount: "500.0000000",
            claimable_balances_amount: "200.0000000",
            num_accounts: 150,
          },
        ],
      };

      jest.spyOn(server, "assets").mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockAssetResponse),
      });

      const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/supply`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        totalSupply: "1700.0000000",
        circulatingSupply: "1000.0000000",
        lockedInPools: "500.0000000",
        lockedInClaimableBalances: "200.0000000",
        holderCount: 150,
      });
    });

    it("returns 404 if the asset is not found", async () => {
      jest.spyOn(server, "assets").mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/asset/NONEXISTENT/${ASSET_ISSUER}/supply`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");
    });

    it("returns 400 for invalid asset code or issuer", async () => {
      const res = await request(app).get("/asset/TOOLONGCODE/INVALID_ISSUER/supply");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
