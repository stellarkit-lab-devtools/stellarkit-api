const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

// Mock the server.strictReceivePaths method
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      strictReceivePaths: jest.fn(),
    },
  };
});

describe("DEX Arbitrage API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /dex/arbitrage/:assetCode/:assetIssuer", () => {
    it("returns 200 and path data for a valid asset", async () => {
      const mockPaths = {
        records: [
          {
            source_amount: "9.5000000",
            destination_amount: "10.0000000",
            path: [
              {
                asset_code: "USDC",
                asset_issuer: "GBBD67V63DU762S2CFFSBCS74K33Z6S5Y6R4E62Y7Z66I264S4UBC5U6",
                asset_type: "credit_alphanum4",
              },
            ],
          },
        ],
      };

      server.strictReceivePaths.mockReturnValue({
        call: jest.fn().mockResolvedValue(mockPaths),
      });

      const assetCode = "XLM";
      const assetIssuer = "native";

      const res = await request(app).get(`/dex/arbitrage/${assetCode}/${assetIssuer}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pathsFound).toBe(true);
      expect(res.body.data.paths[0].isProfitable).toBe(true);
      expect(res.body.data.paths[0].sourceAmount).toBe("9.5000000");
      expect(res.body.data.paths[0].destinationAmount).toBe("10.0000000");
    });

    it("returns pathsFound: false when no paths are returned", async () => {
      server.strictReceivePaths.mockReturnValue({
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get("/dex/arbitrage/XLM/native");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pathsFound).toBe(false);
      expect(res.body.data.paths).toHaveLength(0);
    });

    it("returns 400 for an invalid asset code", async () => {
      const res = await request(app).get(
        "/dex/arbitrage/TOOLONGASSETCODE/GBBD67V63DU762S2CFFSBCS74K33Z6S5Y6R4E62Y7Z66I264S4UBC5U6",
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for an invalid issuer", async () => {
      const res = await request(app).get("/dex/arbitrage/USDC/INVALID_ISSUER");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });
});
