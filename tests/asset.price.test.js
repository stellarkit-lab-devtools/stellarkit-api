const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

describe("GET /asset/:code/:issuer/price", () => {
  const ASSET_CODE = "USDC";
  const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const BASE = `/asset/${ASSET_CODE}/${ASSET_ISSUER}/price`;

  beforeEach(() => {
    cacheService.flush();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns price data for a valid asset", async () => {
    jest.spyOn(server, "strictSendPaths").mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [
          {
            source_amount: "1.0000000",
            destination_amount: "0.1250000",
            path: [],
          },
        ],
      }),
    });

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assetCode).toBe(ASSET_CODE);
    expect(res.body.data.assetIssuer).toBe(ASSET_ISSUER);
    expect(res.body.data.priceInXlm).toBe("0.1250000");
    expect(res.body.data.quoteAsset).toBe("XLM");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("returns X-Cache: HIT on subsequent request within TTL", async () => {
    jest.spyOn(server, "strictSendPaths").mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [
          {
            source_amount: "1.0000000",
            destination_amount: "0.1250000",
            path: [],
          },
        ],
      }),
    });

    await request(app).get(BASE);

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.body.data.priceInXlm).toBe("0.1250000");
  });

  it("bypasses cache with ?fresh=true", async () => {
    jest.spyOn(server, "strictSendPaths").mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [
          {
            source_amount: "1.0000000",
            destination_amount: "0.1250000",
            path: [],
          },
        ],
      }),
    });

    await request(app).get(BASE);

    const res = await request(app).get(`${BASE}?fresh=true`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("returns 404 AssetNotFound when no DEX path exists", async () => {
    jest.spyOn(server, "strictSendPaths").mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AssetNotFound");
  });

  it("returns 400 for invalid asset code", async () => {
    const res = await request(app).get(
      `/asset/TOOLONGASSETCODE/${ASSET_ISSUER}/price`
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for invalid issuer", async () => {
    const res = await request(app).get(`/asset/${ASSET_CODE}/BADISSUER/price`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
