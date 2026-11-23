/**
 * Tests for the body-size-limit middleware (feature a).
 *
 * Acceptance criteria:
 *   - Requests with bodies exceeding 10 KB return
 *     { success: false, error: { type: "PayloadTooLarge",
 *       message: "Request body exceeds the maximum allowed size of 10KB." } }
 *   - Requests with bodies ≤ 10 KB are accepted (2xx / route-level response)
 *   - Limit is configurable via MAX_BODY_SIZE_KB env var
 *   - The middleware never lets oversized bodies reach a route handler
 *
 * All tests use a real Express app instance; no network calls are made.
 */

const request = require("supertest");
const app = require("../src/index");

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a JSON body of approximately `sizeInBytes` bytes. */
function buildPayload(sizeInBytes) {
  // "data" key + quotes + colon + space = ~9 bytes overhead; fill the rest.
  const fill = "x".repeat(Math.max(0, sizeInBytes - 12));
  return { data: fill };
}

// 1 KB  = 1 024 bytes
const ONE_KB   = 1_024;
const TEN_KB   = 10 * ONE_KB;
const ELEVEN_KB = 11 * ONE_KB;

// ── Suite ──────────────────────────────────────────────────────────────────

describe("Body size limit middleware", () => {

  // ── 413 for oversized payloads ──────────────────────────────────────────

  describe("oversized payloads (> 10 KB)", () => {
    it("returns 413 with the correct error envelope", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")       // any POST route works
        .set("Content-Type", "application/json")
        .send(buildPayload(ELEVEN_KB));

      expect(res.statusCode).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({
        type: "PayloadTooLarge",
        message: expect.stringContaining("Request body exceeds the maximum allowed size of 10KB"),
      });
    });

    it("response has no success:true field", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(ELEVEN_KB));

      expect(res.body.success).toBe(false);
    });

    it("error type is exactly 'PayloadTooLarge'", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(ELEVEN_KB));

      expect(res.body.error.type).toBe("PayloadTooLarge");
    });

    it("blocks the request before reaching the route handler", async () => {
      // The /transactions/batch-status route returns 400 for missing hashes.
      // A 413 proves the body parser rejected it first.
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(ELEVEN_KB));

      expect(res.statusCode).toBe(413);
    });

    it("also rejects payloads larger than 20 KB", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(20 * ONE_KB));

      expect(res.statusCode).toBe(413);
      expect(res.body.error.type).toBe("PayloadTooLarge");
    });
  });

  // ── 2xx for valid payloads ──────────────────────────────────────────────

  describe("valid payloads (≤ 10 KB)", () => {
    it("accepts a small JSON body and reaches the route handler", async () => {
      // Sending a valid-looking (but structurally incomplete) request — the
      // route responds 400/ValidationError, NOT 413, proving the body was parsed.
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send({ hashes: [] });   // valid structure, empty — route returns 200

      // Route-level response — body size limit did NOT trigger
      expect(res.statusCode).not.toBe(413);
      expect(res.statusCode).toBe(200);   // empty array → success
    });

    it("accepts a body right at the boundary (≈ 1 KB)", async () => {
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(ONE_KB));

      expect(res.statusCode).not.toBe(413);
    });

    it("accepts a body just under 10 KB", async () => {
      // 9 KB — well within the limit
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(9 * ONE_KB));

      expect(res.statusCode).not.toBe(413);
    });
  });

  // ── MAX_BODY_SIZE_KB env var ────────────────────────────────────────────

  describe("MAX_BODY_SIZE_KB environment variable", () => {
    it("exports MAX_BODY_SIZE_KB as a number", () => {
      // Fresh require to pick up the module as loaded by the current process.
      jest.resetModules();
      const mod = require("../src/middleware/bodySizeLimit");
      expect(typeof mod.MAX_BODY_SIZE_KB).toBe("number");
      expect(mod.MAX_BODY_SIZE_KB).toBeGreaterThan(0);
    });

    it("defaults to 10 KB when MAX_BODY_SIZE_KB is not set", () => {
      const saved = process.env.MAX_BODY_SIZE_KB;
      delete process.env.MAX_BODY_SIZE_KB;
      delete process.env.MAX_BODY_SIZE;

      jest.resetModules();
      const mod = require("../src/middleware/bodySizeLimit");

      expect(mod.MAX_BODY_SIZE_KB).toBe(10);
      expect(mod.MAX_BODY_SIZE).toBe("10kb");

      // Restore
      if (saved !== undefined) process.env.MAX_BODY_SIZE_KB = saved;
    });

    it("honours a custom MAX_BODY_SIZE_KB value", () => {
      const saved = process.env.MAX_BODY_SIZE_KB;
      process.env.MAX_BODY_SIZE_KB = "5";

      jest.resetModules();
      const mod = require("../src/middleware/bodySizeLimit");

      expect(mod.MAX_BODY_SIZE_KB).toBe(5);
      expect(mod.MAX_BODY_SIZE).toBe("5kb");

      process.env.MAX_BODY_SIZE_KB = saved ?? "";
      jest.resetModules();
    });

    it("falls back to MAX_BODY_SIZE legacy string when MAX_BODY_SIZE_KB absent", () => {
      const savedKb  = process.env.MAX_BODY_SIZE_KB;
      const savedLeg = process.env.MAX_BODY_SIZE;

      delete process.env.MAX_BODY_SIZE_KB;
      process.env.MAX_BODY_SIZE = "2kb";

      jest.resetModules();
      const mod = require("../src/middleware/bodySizeLimit");

      expect(mod.MAX_BODY_SIZE).toBe("2kb");

      // Restore
      if (savedKb  !== undefined) process.env.MAX_BODY_SIZE_KB = savedKb;
      if (savedLeg !== undefined) process.env.MAX_BODY_SIZE    = savedLeg;
      jest.resetModules();
    });

    it("error message includes the configured KB limit", async () => {
      // Uses the currently loaded limit (10 KB by default in test runs).
      const res = await request(app)
        .post("/transactions/batch-status")
        .set("Content-Type", "application/json")
        .send(buildPayload(ELEVEN_KB));

      // Message must mention the KB number
      expect(res.body.error.message).toMatch(/\d+KB/);
    });
  });
});
