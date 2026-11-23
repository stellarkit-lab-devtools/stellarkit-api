const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ASSET_CODE = "USDC";
const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function buildAssetsMock(numAccounts = 10, amount = "1000") {
  return {
    forCode: jest.fn().mockReturnThis(),
    forIssuer: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({
      records: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, amount, num_accounts: numAccounts }],
    }),
  };
}

function buildHolder(id, balance) {
  return {
    id,
    balances: [{ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER, balance: String(balance) }],
  };
}

function buildAccountsMock(holders) {
  return {
    forAsset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: holders }),
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("GET /asset/:code/:issuer/distribution", () => {
  it("response includes topHolders, distributionStats, totalHolders, and giniCoefficient fields", async () => {
    jest.spyOn(server, "assets").mockReturnValue(buildAssetsMock(5, "1000"));
    jest.spyOn(server, "accounts").mockReturnValue(
      buildAccountsMock([
        buildHolder("A1", "500"),
        buildHolder("A2", "300"),
        buildHolder("A3", "100"),
        buildHolder("A4", "60"),
        buildHolder("A5", "40"),
      ])
    );

    const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/distribution`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data).toHaveProperty("totalHolders");
    expect(data).toHaveProperty("topHolders");
    expect(data).toHaveProperty("distributionStats");
    expect(data).toHaveProperty("giniCoefficient");

    expect(Array.isArray(data.topHolders)).toBe(true);
    expect(typeof data.distributionStats).toBe("object");
    expect(data.distributionStats).toHaveProperty("top10HoldersPercent");
    expect(data.distributionStats).toHaveProperty("top25HoldersPercent");
    expect(data.totalHolders).toBe(5);
    expect(data.giniCoefficient).toBeGreaterThan(0);
  });

  it("?limit=5 affects the size of topHolders", async () => {
    const holders = Array.from({ length: 20 }, (_, i) =>
      buildHolder(`HOLDER_${i}`, String(1000 - i * 10))
    );
    jest.spyOn(server, "assets").mockReturnValue(buildAssetsMock(20, "20000"));
    jest.spyOn(server, "accounts").mockReturnValue(buildAccountsMock(holders));

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/distribution?limit=5`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.topHolders).toHaveLength(5);
  });

  it("each holder entry in topHolders has an address and balance field", async () => {
    jest.spyOn(server, "assets").mockReturnValue(buildAssetsMock(3, "600"));
    jest.spyOn(server, "accounts").mockReturnValue(
      buildAccountsMock([
        buildHolder("ADDR_1", "300"),
        buildHolder("ADDR_2", "200"),
        buildHolder("ADDR_3", "100"),
      ])
    );

    const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/distribution`);

    expect(res.statusCode).toBe(200);
    const holder = res.body.data.topHolders[0];
    expect(holder).toHaveProperty("address");
    expect(holder).toHaveProperty("balance");
    expect(typeof holder.address).toBe("string");
    expect(typeof holder.balance).toBe("string");
  });

  it("returns 400 for an invalid issuer address", async () => {
    const res = await request(app).get(`/asset/${ASSET_CODE}/INVALID_ISSUER/distribution`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAsset");
  });
});
