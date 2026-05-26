const request = require("supertest");
const app = require("../src/index");

describe("StellarKit API", () => {
  // ── Health ─────────────────────────────────────────────────────────────────
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ok");
    });
  });

  // ── Root ───────────────────────────────────────────────────────────────────
  describe("GET /", () => {
    it("returns API info and endpoint list", async () => {
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.endpoints).toBeInstanceOf(Array);
      expect(res.body.data.endpoints.length).toBeGreaterThan(0);
    });
  });

  // ── 404 ───────────────────────────────────────────────────────────────────
  describe("Unknown routes", () => {
    it("returns 404 for unknown paths", async () => {
      const res = await request(app).get("/unknown-route");
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  describe("GET /account/:id — validation", () => {
    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/account/NOT_A_VALID_KEY");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  describe("GET /transactions/:id — validation", () => {
    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/transactions/BADKEY123");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid limit param", async () => {
      const res = await request(app).get(
        "/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?limit=999999"
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /asset/search — validation", () => {
    it("returns 400 when code param is missing", async () => {
      const res = await request(app).get("/asset/search");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid asset code", async () => {
      const res = await request(app).get("/asset/search?code=TOOLONGASSETCODE");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

describe("GET /account/:id/summary", () => {
  it("should return full account summary", async () => {
    const res = await request(app)
      .get("/account/GBVALIDACCOUNTIDEXAMPLE1234567890ABCDEFGHIJKLMN");

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("account");
    expect(res.body).toHaveProperty("recentTransactions");
    expect(res.body).toHaveProperty("openOffers");
    expect(res.body).toHaveProperty("claimableBalances");
  });

  it("should reject invalid account id", async () => {
    const res = await request(app).get("/account/invalid-id");

    expect(res.statusCode).toBe(400);
  });
});
});
