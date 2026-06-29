const request = require("supertest");
const app = require("../src/index");

describe("GET /network/ledger-timing", () => {
  it("should return ledger timing statistics", async () => {
    const response = await request(app)
      .get("/network/ledger-timing")
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("avgCloseTimeSeconds");
    expect(response.body.data).toHaveProperty("minCloseTime");
    expect(response.body.data).toHaveProperty("maxCloseTime");
    expect(response.body.data).toHaveProperty("stdDeviation");
    expect(response.body.data).toHaveProperty("consistency");
    expect(["stable", "variable", "unstable"]).toContain(response.body.data.consistency);
  });
});
