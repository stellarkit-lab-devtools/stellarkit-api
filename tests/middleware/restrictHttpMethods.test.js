"use strict";

/**
 * Tests for restrictHttpMethods middleware.
 *
 * Unsupported methods (TRACE, CONNECT, OPTIONS, PUT, HEAD, …) must return
 * 405 with { success: false, error: { type: "MethodNotAllowed", message: "HTTP method not supported." } }.
 * Supported methods GET, POST, DELETE, PATCH pass through unchanged.
 */

const request = require("supertest");
const express = require("express");
const restrictHttpMethods = require("../src/middleware/restrictHttpMethods");

function buildApp() {
  const app = express();
  app.use(restrictHttpMethods);
  app.use(express.json());

  app.get("/test", (req, res) => res.status(200).json({ ok: true, method: "GET" }));
  app.post("/test", (req, res) => res.status(200).json({ ok: true, method: "POST" }));
  app.delete("/test", (req, res) => res.status(200).json({ ok: true, method: "DELETE" }));
  app.patch("/test", (req, res) => res.status(200).json({ ok: true, method: "PATCH" }));

  return app;
}

const METHOD_NOT_ALLOWED_BODY = {
  success: false,
  error: {
    type: "MethodNotAllowed",
    message: "HTTP method not supported.",
  },
};

describe("restrictHttpMethods middleware", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  describe("unsupported methods", () => {
    it("rejects TRACE with 405 MethodNotAllowed", async () => {
      const res = await request(app).trace("/test");

      expect(res.statusCode).toBe(405);
      expect(res.body).toEqual(METHOD_NOT_ALLOWED_BODY);
    });

    it("rejects OPTIONS with 405 MethodNotAllowed", async () => {
      const res = await request(app).options("/test");

      expect(res.statusCode).toBe(405);
      expect(res.body).toEqual(METHOD_NOT_ALLOWED_BODY);
    });

    it("rejects PUT with 405 MethodNotAllowed", async () => {
      const res = await request(app).put("/test").send({});

      expect(res.statusCode).toBe(405);
      expect(res.body).toEqual(METHOD_NOT_ALLOWED_BODY);
    });

    it("rejects CONNECT with 405 MethodNotAllowed", () => {
      const req = { method: "CONNECT" };
      const res = {
        statusCode: null,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };
      let nextCalled = false;
      restrictHttpMethods(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(405);
      expect(res.body).toEqual(METHOD_NOT_ALLOWED_BODY);
    });

    it("rejects HEAD with 405 MethodNotAllowed", async () => {
      const res = await request(app).head("/test");

      expect(res.statusCode).toBe(405);
    });
  });

  describe("supported methods", () => {
    it("allows GET through", async () => {
      const res = await request(app).get("/test");
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, method: "GET" });
    });

    it("allows POST through", async () => {
      const res = await request(app).post("/test").send({});
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, method: "POST" });
    });

    it("allows DELETE through", async () => {
      const res = await request(app).delete("/test");
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, method: "DELETE" });
    });

    it("allows PATCH through", async () => {
      const res = await request(app).patch("/test").send({});
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, method: "PATCH" });
    });
  });
});
