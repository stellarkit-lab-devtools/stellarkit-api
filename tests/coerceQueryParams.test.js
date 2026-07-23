/**
 * Tests for the coerceQueryParams middleware.
 *
 * Coverage strategy:
 *   1. Unit tests — call the middleware function directly with mock req/res
 *      objects. Fast, isolated, no HTTP overhead.
 *   2. Integration smoke tests — hit a real Express endpoint via supertest to
 *      confirm the middleware is wired up and that route handlers receive
 *      coerced types in practice.
 */

const coerceQueryParams = require("../src/middleware/coerceQueryParams");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock req/res pair and invoke coerceQueryParams.
 * Returns a promise that resolves with the mutated req.query when next() is
 * called, or rejects if next() is never called within 100 ms.
 *
 * @param {Record<string, string|string[]>} query - raw query params
 * @returns {Promise<Record<string, unknown>>}
 */
function runMiddleware(query) {
  return new Promise((resolve, reject) => {
    const req = { query: { ...query } };
    const res = {};
    const timer = setTimeout(
      () => reject(new Error("next() was never called")),
      100,
    );
    coerceQueryParams(req, res, () => {
      clearTimeout(timer);
      resolve(req.query);
    });
  });
}

// ── Unit tests ─────────────────────────────────────────────────────────────

describe("coerceQueryParams middleware — unit", () => {
  // ── Integer coercion: limit ───────────────────────────────────────────────

  describe("limit param", () => {
    it("converts a numeric string to an integer", async () => {
      const query = await runMiddleware({ limit: "20" });
      expect(query.limit).toBe(20);
      expect(typeof query.limit).toBe("number");
    });

    it("converts '0' to the integer 0", async () => {
      const query = await runMiddleware({ limit: "0" });
      expect(query.limit).toBe(0);
    });

    it("converts a string with leading/trailing spaces (pre-trimmed by sanitize) to integer", async () => {
      // sanitize runs before coerceQueryParams, so by this point the value
      // should already be trimmed. We test that trimmed numerics still coerce.
      const query = await runMiddleware({ limit: "10" });
      expect(query.limit).toBe(10);
    });

    it("leaves a non-numeric string unchanged", async () => {
      const query = await runMiddleware({ limit: "abc" });
      expect(query.limit).toBe("abc");
      expect(typeof query.limit).toBe("string");
    });

    it("leaves a float string unchanged", async () => {
      const query = await runMiddleware({ limit: "1.5" });
      expect(query.limit).toBe("1.5");
    });

    it("converts a negative integer string", async () => {
      const query = await runMiddleware({ limit: "-5" });
      expect(query.limit).toBe(-5);
    });
  });

  // ── Integer coercion: operations ─────────────────────────────────────────

  describe("operations param", () => {
    it("converts a numeric string to an integer", async () => {
      const query = await runMiddleware({ operations: "3" });
      expect(query.operations).toBe(3);
      expect(typeof query.operations).toBe("number");
    });

    it("converts '1' to the integer 1", async () => {
      const query = await runMiddleware({ operations: "1" });
      expect(query.operations).toBe(1);
    });

    it("leaves a non-numeric string unchanged", async () => {
      const query = await runMiddleware({ operations: "many" });
      expect(query.operations).toBe("many");
    });
  });

  // ── Boolean coercion: fresh ───────────────────────────────────────────────

  describe("fresh param", () => {
    it("converts 'true' to boolean true", async () => {
      const query = await runMiddleware({ fresh: "true" });
      expect(query.fresh).toBe(true);
      expect(typeof query.fresh).toBe("boolean");
    });

    it("converts 'false' to boolean false", async () => {
      const query = await runMiddleware({ fresh: "false" });
      expect(query.fresh).toBe(false);
      expect(typeof query.fresh).toBe("boolean");
    });

    it("converts 'TRUE' (uppercase) to boolean true", async () => {
      const query = await runMiddleware({ fresh: "TRUE" });
      expect(query.fresh).toBe(true);
    });

    it("converts 'False' (mixed case) to boolean false", async () => {
      const query = await runMiddleware({ fresh: "False" });
      expect(query.fresh).toBe(false);
    });

    it("leaves an unrecognised boolean string unchanged", async () => {
      const query = await runMiddleware({ fresh: "yes" });
      expect(query.fresh).toBe("yes");
      expect(typeof query.fresh).toBe("string");
    });

    it("leaves '1' unchanged (not treated as boolean)", async () => {
      const query = await runMiddleware({ fresh: "1" });
      expect(query.fresh).toBe("1");
    });
  });

  // ── Unknown params are not modified ──────────────────────────────────────

  describe("unknown params", () => {
    it("does not modify an unknown string param", async () => {
      const query = await runMiddleware({ cursor: "abc123", order: "desc" });
      expect(query.cursor).toBe("abc123");
      expect(query.order).toBe("desc");
    });

    it("does not modify memo or memo_type", async () => {
      const query = await runMiddleware({ memo: "invoice-1", memo_type: "text" });
      expect(query.memo).toBe("invoice-1");
      expect(query.memo_type).toBe("text");
    });

    it("does not modify code or id params", async () => {
      const query = await runMiddleware({ code: "USDC", id: "GA5Z" });
      expect(query.code).toBe("USDC");
      expect(query.id).toBe("GA5Z");
    });
  });

  // ── Multiple params coerced together ────────────────────────────────────

  describe("multiple params in one request", () => {
    it("coerces all known params simultaneously", async () => {
      const query = await runMiddleware({
        limit: "50",
        operations: "2",
        fresh: "true",
        cursor: "tok123",
        order: "asc",
      });

      expect(query.limit).toBe(50);
      expect(query.operations).toBe(2);
      expect(query.fresh).toBe(true);
      // Unknown params unchanged
      expect(query.cursor).toBe("tok123");
      expect(query.order).toBe("asc");
    });

    it("handles an empty query object without errors", async () => {
      const query = await runMiddleware({});
      expect(query).toEqual({});
    });
  });

  // ── Non-string values are skipped ───────────────────────────────────────

  describe("non-string values are skipped", () => {
    it("does not throw or modify an array value for limit (hpp already collapses dupes)", async () => {
      // hpp whitelists limit as an array — simulate what arrives after hpp
      const req = { query: { limit: ["10", "20"] } };
      await new Promise((resolve) => {
        coerceQueryParams(req, {}, () => resolve());
      });
      // Array should be left untouched
      expect(req.query.limit).toEqual(["10", "20"]);
    });
  });

  // ── next() is always called ──────────────────────────────────────────────

  it("always calls next()", async () => {
    const nextFn = jest.fn();
    const req = { query: { limit: "5", fresh: "true", unknown: "x" } };
    coerceQueryParams(req, {}, nextFn);
    expect(nextFn).toHaveBeenCalledTimes(1);
  });
});

// ── Integration tests ──────────────────────────────────────────────────────

/**
 * These tests mount coerceQueryParams on a minimal Express app and use a
 * capturing route to inspect the req.query values that arrive at the handler.
 * This approach is self-contained and does not depend on the full application
 * loading all routes.
 */
describe("coerceQueryParams middleware — integration", () => {
  const express = require("express");
  const request = require("supertest");

  /**
   * Build a minimal app that:
   *   1. Runs coerceQueryParams.
   *   2. Returns req.query as JSON so we can assert on the coerced values.
   */
  function buildApp() {
    const app = express();
    app.use(coerceQueryParams);
    app.get("/probe", (req, res) => {
      res.json({ query: req.query });
    });
    return app;
  }

  it("does not break requests with no query params", async () => {
    const app = buildApp();
    const res = await request(app).get("/probe");
    expect(res.statusCode).toBe(200);
    expect(res.body.query).toEqual({});
  });

  it("coerces limit to an integer before the route handler receives it", async () => {
    const app = buildApp();
    const res = await request(app).get("/probe?limit=20");
    expect(res.statusCode).toBe(200);
    expect(res.body.query.limit).toBe(20);
    expect(typeof res.body.query.limit).toBe("number");
  });

  it("coerces operations to an integer before the route handler receives it", async () => {
    const app = buildApp();
    const res = await request(app).get("/probe?operations=3");
    expect(res.statusCode).toBe(200);
    expect(res.body.query.operations).toBe(3);
  });

  it("coerces fresh=true to boolean before the route handler receives it", async () => {
    const app = buildApp();
    const res = await request(app).get("/probe?fresh=true");
    expect(res.statusCode).toBe(200);
    expect(res.body.query.fresh).toBe(true);
  });

  it("coerces fresh=false to boolean before the route handler receives it", async () => {
    const app = buildApp();
    const res = await request(app).get("/probe?fresh=false");
    expect(res.statusCode).toBe(200);
    expect(res.body.query.fresh).toBe(false);
  });

  it("does not modify unknown query params passed end-to-end", async () => {
    const app = buildApp();
    const res = await request(app).get("/probe?cursor=tok123&order=desc");
    expect(res.statusCode).toBe(200);
    expect(res.body.query.cursor).toBe("tok123");
    expect(res.body.query.order).toBe("desc");
  });

  it("coerces all known params together in a single request", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/probe?limit=50&operations=2&fresh=true&cursor=tok&order=asc",
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.query.limit).toBe(50);
    expect(res.body.query.operations).toBe(2);
    expect(res.body.query.fresh).toBe(true);
    expect(res.body.query.cursor).toBe("tok");
    expect(res.body.query.order).toBe("asc");
  });
});
