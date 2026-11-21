const request = require("supertest");
const express = require("express");
const deprecate = require("../../src/middleware/deprecation");

const SINCE = "2026-01-01T00:00:00Z";
const SUNSET_FUTURE = "2099-01-01T00:00:00Z";
const SUNSET_PAST = "2020-01-01T00:00:00Z";
const REPLACEMENT = "/v2/offers";

function makeApp(options) {
  const app = express();
  app.get("/old", deprecate(options), (req, res) => res.json({ ok: true, value: 42 }));
  return app;
}

describe("deprecate middleware", () => {
  it("sets RFC-style deprecation headers on an unchanged response body", async () => {
    const res = await request(makeApp({ since: SINCE, sunset: SUNSET_FUTURE })).get("/old");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, value: 42 });
    expect(res.headers.deprecation).toBe(`@${Math.floor(Date.parse(SINCE) / 1000)}`);
    expect(res.headers.sunset).toBe(new Date(SUNSET_FUTURE).toUTCString());
  });

  it("sets the successor link", async () => {
    const res = await request(
      makeApp({ since: SINCE, sunset: SUNSET_FUTURE, replacement: REPLACEMENT }),
    ).get("/old");
    expect(res.headers.link).toBe(`<${REPLACEMENT}>; rel="successor-version"`);
  });

  it("passes through before sunset even when enforcement is enabled", async () => {
    const res = await request(
      makeApp({ since: SINCE, sunset: SUNSET_FUTURE, replacement: REPLACEMENT, enforce: true }),
    ).get("/old");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, value: 42 });
  });

  it("returns 410 Gone after sunset and names the replacement", async () => {
    const res = await request(
      makeApp({ since: SINCE, sunset: SUNSET_PAST, replacement: REPLACEMENT, enforce: true }),
    ).get("/old");
    expect(res.statusCode).toBe(410);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("Gone");
    expect(res.body.error.message).toContain(REPLACEMENT);
    expect(res.headers.deprecation).toBe(`@${Math.floor(Date.parse(SINCE) / 1000)}`);
    expect(res.headers.sunset).toBe(new Date(SUNSET_PAST).toUTCString());
  });

  it("does not enforce without enforce: true", async () => {
    const res = await request(
      makeApp({ since: SINCE, sunset: SUNSET_PAST, replacement: REPLACEMENT }),
    ).get("/old");
    expect(res.statusCode).toBe(200);
  });
});
