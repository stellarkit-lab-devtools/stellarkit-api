/**
 * Unit tests for the Content-Type validation middleware.
 *
 * Verifies that:
 *   - POST and PATCH without Content-Type: application/json → 415 with the
 *     correct error shape.
 *   - GET and DELETE are never blocked.
 *   - A correct Content-Type passes through.
 */

const request = require("supertest");
const express = require("express");
const contentTypeValidator = require("../../src/middleware/contentTypeValidator");

// Minimal app that applies the middleware and then echoes 200 ok.
function buildApp() {
  const app = express();
  app.use(contentTypeValidator);

  // Express needs a JSON body parser AFTER the validator for POST/PATCH to
  // reach the handler when the Content-Type is correct.
  app.use(express.json());

  app.post("/test", (req, res) => res.status(200).json({ ok: true }));
  app.patch("/test", (req, res) => res.status(200).json({ ok: true }));
  app.get("/test", (req, res) => res.status(200).json({ ok: true }));
  app.delete("/test", (req, res) => res.status(200).json({ ok: true }));

  return app;
}

describe("contentTypeValidator middleware", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  // ── POST ────────────────────────────────────────────────────────────────────

  describe("POST requests", () => {
    it("rejects a POST with no Content-Type header with 415", async () => {
      const res = await request(app)
        .post("/test")
        .send("some body");

      expect(res.statusCode).toBe(415);
      expect(res.body).toEqual({
        success: false,
        error: {
          type: "InvalidContentType",
          message: "Content-Type must be application/json.",
        },
      });
    });

    it("rejects a POST with Content-Type: text/plain with 415", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "text/plain")
        .send("not json");

      expect(res.statusCode).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("InvalidContentType");
      expect(res.body.error.message).toBe("Content-Type must be application/json.");
    });

    it("rejects a POST with Content-Type: application/x-www-form-urlencoded with 415", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("key=value");

      expect(res.statusCode).toBe(415);
      expect(res.body.error.type).toBe("InvalidContentType");
    });

    it("allows a POST with Content-Type: application/json", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ foo: "bar" }));

      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("rejects a POST with an empty body and no Content-Type with 415", async () => {
      const res = await request(app).post("/test");

      expect(res.statusCode).toBe(415);
      expect(res.body.error.type).toBe("InvalidContentType");
    });
  });

  // ── PATCH ───────────────────────────────────────────────────────────────────

  describe("PATCH requests", () => {
    it("rejects a PATCH with no Content-Type header with 415", async () => {
      const res = await request(app)
        .patch("/test")
        .send("some body");

      expect(res.statusCode).toBe(415);
      expect(res.body.error.type).toBe("InvalidContentType");
    });

    it("rejects a PATCH with Content-Type: text/xml with 415", async () => {
      const res = await request(app)
        .patch("/test")
        .set("Content-Type", "text/xml")
        .send("<xml/>");

      expect(res.statusCode).toBe(415);
      expect(res.body.error.type).toBe("InvalidContentType");
    });

    it("allows a PATCH with Content-Type: application/json", async () => {
      const res = await request(app)
        .patch("/test")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ update: true }));

      expect(res.statusCode).toBe(200);
    });
  });

  // ── GET / DELETE — must be unaffected ───────────────────────────────────────

  describe("GET and DELETE requests", () => {
    it("passes through GET requests without any Content-Type check", async () => {
      const res = await request(app).get("/test");
      expect(res.statusCode).toBe(200);
    });

    it("passes through DELETE requests without any Content-Type check", async () => {
      const res = await request(app).delete("/test");
      expect(res.statusCode).toBe(200);
    });
  });
});
