const request = require("supertest");
const app = require("../src/index");

describe("Security - X-Powered-By header", () => {
  describe("GET /health", () => {
    it("should not include X-Powered-By header", async () => {
      const res = await request(app).get("/health");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("should return successful response with correct data", async () => {
      const res = await request(app).get("/health");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("status", "ok");
      expect(res.body.data).toHaveProperty("service", "StellarKit API");
      expect(res.body.data).toHaveProperty("timestamp");
      expect(res.body.data).toHaveProperty("version");
      expect(res.body.data).toHaveProperty("network");
    });
  });

  describe("GET /", () => {
    it("should not include X-Powered-By header on root endpoint", async () => {
      const res = await request(app).get("/");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("GET /account/:id — root endpoint security", () => {
    it("should not include X-Powered-By header even on validation errors", async () => {
      const res = await request(app).get("/account/INVALID_KEY");

      expect(res.statusCode).toBe(400);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("GET /network-status", () => {
    it("should not include X-Powered-By header on network-status endpoint", async () => {
      const res = await request(app).get("/network-status");

      // Response may be 200 or 503 depending on Horizon availability
      expect([200, 503]).toContain(res.statusCode);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("GET /fee-estimate", () => {
    it("should not include X-Powered-By header on fee-estimate endpoint", async () => {
      const res = await request(app).get("/fee-estimate");

      // Response may be 200 or 503 depending on Horizon availability
      expect([200, 503]).toContain(res.statusCode);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("POST — root endpoint security", () => {
    it("should not include X-Powered-By header on POST requests", async () => {
      const res = await request(app)
        .post("/future-route")
        .set("Content-Type", "text/plain")
        .send("not json");

      expect(res.statusCode).toBe(400);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("Unknown routes — 404", () => {
    it("should not include X-Powered-By header on 404 responses", async () => {
      const res = await request(app).get("/unknown-route");

      expect(res.statusCode).toBe(404);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });
});
