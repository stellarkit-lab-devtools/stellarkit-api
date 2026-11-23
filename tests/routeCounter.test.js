/**
 * Tests for src/middleware/routeCounter.js (feature b).
 *
 * Acceptance criteria:
 *   - Every request increments the counter for its route and method.
 *   - getRouteCounts() returns { "GET /account/:id": 42, "GET /fee-estimate": 18, … }
 *   - Counters reset on server restart (modelled here as resetRouteCounts()).
 *   - Multiple different routes tracked independently.
 *
 * Strategy:
 *   - Unit-test the middleware and helpers in isolation using a minimal
 *     mock Express app so we don't need real Horizon calls.
 *   - Also run a lightweight integration smoke-test through the real app
 *     to confirm the middleware is wired into the request lifecycle.
 */

const express = require("express");
const request = require("supertest");
const routeCounter = require("../src/middleware/routeCounter");
const { getRouteCounts, resetRouteCounts } = require("../src/middleware/routeCounter");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a tiny Express app with the routeCounter middleware and a handful
 * of named routes.  Keeps tests fast and independent of real routes.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(routeCounter);

  app.get("/health",         (req, res) => res.json({ ok: true }));
  app.get("/items",          (req, res) => res.json({ ok: true }));
  app.get("/items/:id",      (req, res) => res.json({ ok: true }));
  app.post("/items",         (req, res) => res.status(201).json({ ok: true }));
  app.delete("/items/:id",   (req, res) => res.json({ ok: true }));

  return app;
}

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => resetRouteCounts());
afterAll(()  => resetRouteCounts());

// ── Unit tests ──────────────────────────────────────────────────────────────

describe("routeCounter middleware — unit", () => {

  describe("getRouteCounts() — initial state", () => {
    it("returns an empty object before any requests", () => {
      expect(getRouteCounts()).toEqual({});
    });
  });

  describe("single route increments", () => {
    it("increments GET /health after one request", async () => {
      const app = buildApp();
      await request(app).get("/health");

      const counts = getRouteCounts();
      expect(counts["GET /health"]).toBe(1);
    });

    it("increments GET /items after one request", async () => {
      const app = buildApp();
      await request(app).get("/items");

      const counts = getRouteCounts();
      expect(counts["GET /items"]).toBe(1);
    });

    it("increments POST /items after one request", async () => {
      const app = buildApp();
      await request(app).post("/items").send({});

      const counts = getRouteCounts();
      expect(counts["POST /items"]).toBe(1);
    });
  });

  describe("counter accumulation", () => {
    it("accumulates count across multiple requests to the same route", async () => {
      const app = buildApp();
      await request(app).get("/health");
      await request(app).get("/health");
      await request(app).get("/health");

      expect(getRouteCounts()["GET /health"]).toBe(3);
    });

    it("tracks different routes independently", async () => {
      const app = buildApp();
      await request(app).get("/health");
      await request(app).get("/health");
      await request(app).get("/items");

      const counts = getRouteCounts();
      expect(counts["GET /health"]).toBe(2);
      expect(counts["GET /items"]).toBe(1);
    });

    it("tracks different HTTP methods independently on the same path", async () => {
      const app = buildApp();
      await request(app).get("/items");
      await request(app).get("/items");
      await request(app).post("/items").send({});

      const counts = getRouteCounts();
      expect(counts["GET /items"]).toBe(2);
      expect(counts["POST /items"]).toBe(1);
    });

    it("tracks parametric routes by pattern, not raw URL value", async () => {
      const app = buildApp();
      // Two different IDs — should both count under the same pattern key
      await request(app).get("/items/123");
      await request(app).get("/items/456");

      const counts = getRouteCounts();
      // Should be aggregated under "GET /items/:id"
      expect(counts["GET /items/:id"]).toBe(2);
      // Raw URL keys should NOT appear
      expect(counts["GET /items/123"]).toBeUndefined();
      expect(counts["GET /items/456"]).toBeUndefined();
    });
  });

  describe("getRouteCounts() return shape", () => {
    it("returns a plain object (not a Map)", async () => {
      const app = buildApp();
      await request(app).get("/health");

      const counts = getRouteCounts();
      expect(typeof counts).toBe("object");
      expect(counts).not.toBeInstanceOf(Map);
    });

    it("keys are in 'METHOD /path' format", async () => {
      const app = buildApp();
      await request(app).get("/health");
      await request(app).post("/items").send({});

      const counts = getRouteCounts();
      const keys = Object.keys(counts);
      expect(keys).toContain("GET /health");
      expect(keys).toContain("POST /items");
    });

    it("values are positive integers", async () => {
      const app = buildApp();
      await request(app).get("/health");
      await request(app).get("/health");

      const counts = getRouteCounts();
      expect(Number.isInteger(counts["GET /health"])).toBe(true);
      expect(counts["GET /health"]).toBeGreaterThan(0);
    });
  });

  describe("resetRouteCounts()", () => {
    it("clears all counters to zero", async () => {
      const app = buildApp();
      await request(app).get("/health");
      await request(app).get("/items");

      resetRouteCounts();

      expect(getRouteCounts()).toEqual({});
    });

    it("counters accumulate fresh after a reset", async () => {
      const app = buildApp();
      await request(app).get("/health");
      resetRouteCounts();
      await request(app).get("/health");

      expect(getRouteCounts()["GET /health"]).toBe(1);
    });
  });

  describe("DELETE method", () => {
    it("tracks DELETE requests correctly", async () => {
      const app = buildApp();
      await request(app).delete("/items/99");

      const counts = getRouteCounts();
      expect(counts["DELETE /items/:id"]).toBe(1);
    });
  });
});

// ── Integration smoke-test ──────────────────────────────────────────────────

describe("routeCounter — integration with real app", () => {
  /**
   * The real app (src/index) registers routeCounter globally.
   * After a request to /health (no Horizon call needed), the counter
   * for that route should be ≥ 1.
   */
  it("increments the counter for GET /health in the real app", async () => {
    // Import the real app — routeCounter is registered inside it
    const realApp = require("../src/index");

    resetRouteCounts(); // start clean

    await request(realApp).get("/health");

    const counts = getRouteCounts();
    // The /health route has no :param segments, so the key is "GET /health"
    expect(counts["GET /health"]).toBeGreaterThanOrEqual(1);
  });
});
