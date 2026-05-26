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
        "/transactions/GDU5LH56CZ7NVKRHYI72QVJC6BS7GAYEIO34HDMICG3H5NSFJJJFHFWL?limit=999999"
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

  describe("GET /account/:id/analytics", () => {
  it("returns analytics for a valid account", async () => {
    const res = await request(app).get(
      "/account/GDU5LH56CZ7NVKRHYI72QVJC6BS7GAYEIO34HDMICG3H5NSFJJJFHFWL/analytics"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    expect(res.body.data).toHaveProperty("totalSent");
    expect(res.body.data).toHaveProperty("totalReceived");
    expect(res.body.data).toHaveProperty("topAssets");
    expect(res.body.data).toHaveProperty("avgTransactionsPerDay");
    expect(res.body.data).toHaveProperty("firstSeen");
    expect(res.body.data).toHaveProperty("lastSeen");

    expect(res.body.data.topAssets).toBeInstanceOf(Array);
  });

  it("returns 400 for invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID_KEY/analytics");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });
});
});
