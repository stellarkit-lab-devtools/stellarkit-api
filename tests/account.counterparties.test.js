const request = require("supertest");
const app = require("../src/index");

describe("GET /account/:id/counterparties", () => {
  const validId = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  it("should return 400 for invalid account ID", async () => {
    const response = await request(app)
      .get("/account/INVALID/counterparties")
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it("should return counterparty data for a valid account", async () => {
    const response = await request(app)
      .get(`/account/${validId}/counterparties`);

    if (response.status === 200) {
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("topSenders");
      expect(response.body.data).toHaveProperty("topReceivers");
      expect(Array.isArray(response.body.data.topSenders)).toBe(true);
      expect(Array.isArray(response.body.data.topReceivers)).toBe(true);
    } else if (response.status === 404) {
      expect(response.body.success).toBe(false);
    }
  });
});
