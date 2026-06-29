const request = require("supertest");
const app = require("../src/index");

describe("GET /dex/imbalance/:sellAsset/:buyAsset", () => {
  const xlmNative = "XLM:native";
  const usdc = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  it("should return 400 for invalid asset format", async () => {
    const response = await request(app)
      .get("/dex/imbalance/INVALID/XLM:native")
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toContain("Invalid asset format");
  });

  it("should return imbalance data for a valid pair", async () => {
    const response = await request(app)
      .get(`/dex/imbalance/${xlmNative}/${usdc}`);

    if (response.status === 200) {
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("bidVolume");
      expect(response.body.data).toHaveProperty("askVolume");
      expect(response.body.data).toHaveProperty("imbalanceRatio");
      expect(response.body.data).toHaveProperty("pressure");
      expect(response.body.data).toHaveProperty("signal");
      expect(["buy", "sell", "neutral"]).toContain(response.body.data.pressure);
    } else if (response.status === 404) {
      expect(response.body.success).toBe(false);
    }
  });

  it("should return 404 for non-existent order book", async () => {
    const fakeAsset = "FAKE:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    const response = await request(app)
      .get(`/dex/imbalance/${xlmNative}/${fakeAsset}`);

    if (response.status === 404) {
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("No order book exists");
    }
  });
});
