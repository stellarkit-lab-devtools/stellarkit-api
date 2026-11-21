"use strict";

const express = require("express");
const request = require("supertest");
const securityTxtRouter = require("../src/routes/securityTxt");
const rateLimiter = require("../src/middleware/rateLimiter");
const apiKeyMiddleware = require("../src/middleware/apiKeyAuth");

describe("GET /.well-known/security.txt (RFC 9116)", () => {
  const originalEnv = process.env;

  function createTestApp() {
    const app = express();
    // Mount securityTxtRouter before rateLimiter and apiKeyMiddleware (matches src/index.js)
    app.use("/.well-known", securityTxtRouter);
    app.use(rateLimiter);
    app.use(apiKeyMiddleware);
    app.get("/protected", (req, res) => res.json({ success: true }));
    return app;
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 404 when SECURITY_CONTACT is unset", async () => {
    delete process.env.SECURITY_CONTACT;
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when SECURITY_CONTACT is empty whitespace", async () => {
    process.env.SECURITY_CONTACT = "   ";
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(404);
  });

  it("returns text/plain content type with required fields when SECURITY_CONTACT is set", async () => {
    process.env.SECURITY_CONTACT = "mailto:security@stellarkit.io";
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);

    const body = res.text;
    expect(body).toContain("Contact: mailto:security@stellarkit.io");
    expect(body).toContain("Preferred-Languages: en");
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/m);
    expect(body).toContain("Canonical: ");
  });

  it("generates a future Expires date approximately one year ahead by default", async () => {
    process.env.SECURITY_CONTACT = "https://stellarkit.io/security";
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);

    const match = /Expires: (.+)/.exec(res.text);
    expect(match).not.toBeNull();

    const expiresDate = new Date(match[1]);
    const now = new Date();
    const diffDays = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(350);
    expect(diffDays).toBeLessThan(370);
  });

  it("allows overriding the Expires field via SECURITY_TXT_EXPIRES", async () => {
    const customExpiry = "2029-01-01T00:00:00.000Z";
    process.env.SECURITY_CONTACT = "mailto:security@stellarkit.io";
    process.env.SECURITY_TXT_EXPIRES = customExpiry;
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain(`Expires: ${customExpiry}`);
  });

  it("includes Policy field when SECURITY_POLICY_URL is set", async () => {
    process.env.SECURITY_CONTACT = "mailto:security@stellarkit.io";
    process.env.SECURITY_POLICY_URL = "https://stellarkit.io/disclosure-policy";
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Policy: https://stellarkit.io/disclosure-policy");
  });

  it("omits Policy field when SECURITY_POLICY_URL is unset", async () => {
    process.env.SECURITY_CONTACT = "mailto:security@stellarkit.io";
    delete process.env.SECURITY_POLICY_URL;
    const app = createTestApp();

    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);
    expect(res.text).not.toContain("Policy:");
  });

  it("constructs Canonical header from request host", async () => {
    process.env.SECURITY_CONTACT = "mailto:security@stellarkit.io";
    const app = createTestApp();

    const res = await request(app)
      .get("/.well-known/security.txt")
      .set("Host", "api.stellarkit.io");

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Canonical: http://api.stellarkit.io/.well-known/security.txt");
  });

  it("does not require authentication even when REQUIRE_API_KEY is true", async () => {
    process.env.SECURITY_CONTACT = "mailto:security@stellarkit.io";
    process.env.REQUIRE_API_KEY = "true";
    process.env.API_KEYS = "secret-key-123";
    const app = createTestApp();

    // Protected route fails with 401 without API key
    const protRes = await request(app).get("/protected");
    expect(protRes.statusCode).toBe(401);

    // .well-known/security.txt succeeds with 200 without API key
    const res = await request(app).get("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Contact: mailto:security@stellarkit.io");
  });
});
