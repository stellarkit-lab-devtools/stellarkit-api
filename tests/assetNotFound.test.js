const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("AssetNotFound error handling", () => {
  const ASSET_CODE = "FAKECOIN";
  const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /asset/:code/:issuer (asset metadata)", () => {
    it("returns AssetNotFound when asset does not exist", async () => {
      jest.spyOn(server, "assets").mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });
      jest.spyOn(server, "loadAccount").mockRejectedValue(new Error("not found"));

      const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("AssetNotFound");
      expect(res.body.error.message).toContain(ASSET_CODE);
      expect(res.body.error.message).toContain(ASSET_ISSUER);
      expect(res.body.error.suggestion).toBeDefined();
    });
  });

  describe("GET /asset/:code/:issuer/supply", () => {
    it("returns AssetNotFound when asset does not exist", async () => {
      jest.spyOn(server, "assets").mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/supply`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("AssetNotFound");
      expect(res.body.error.message).toContain(ASSET_CODE);
      expect(res.body.error.suggestion).toBeDefined();
    });
  });

  describe("GET /asset/:code/:issuer/distribution", () => {
    it("returns AssetNotFound when asset does not exist", async () => {
      jest.spyOn(server, "assets").mockReturnValue({
        forCode: jest.fn().mockReturnThis(),
        forIssuer: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/distribution`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("AssetNotFound");
      expect(res.body.error.suggestion).toBeDefined();
    });
  });
});
