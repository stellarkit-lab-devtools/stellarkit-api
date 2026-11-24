/**
 * Tests for the DISABLED_ROUTES middleware.
 *
 * Acceptance criteria:
 *   - DISABLED_ROUTES is a comma-separated list of exact entries
 *     (GET /network/top-accounts) or prefix wildcards (/soroban/*).
 *   - Disabled routes return 404 { type: "EndpointDisabled" }.
 *   - Disabled routes make no upstream calls.
 *   - A pattern that matches no registered route logs a warning.
 *   - .env.example documents the variable.
 *   - Tests cover: exact match, wildcard, unaffected routes,
 *     unmatched-pattern warning, and no upstream call on a disabled route.
 */

const request = require("supertest");

function loadFreshApp(envValue) {
  jest.resetModules();
  const original = process.env.DISABLED_ROUTES;
  if (envValue) process.env.DISABLED_ROUTES = envValue;
  else delete process.env.DISABLED_ROUTES;

  const app = require("../src/index");
  const { server } = require("../src/config/stellar");

  process.env.DISABLED_ROUTES = original;
  return { app, server };
}

describe("DISABLED_ROUTES middleware", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // ── Exact match ────────────────────────────────────────────────────────────

  it("returns 404 EndpointDisabled for an exact route match", async () => {
    const { app } = loadFreshApp("GET /network/validators");

    const res = await request(app).get("/network/validators");
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        type: "EndpointDisabled",
        message: expect.stringContaining("disabled"),
      },
    });
  });

  // ── Wildcard ───────────────────────────────────────────────────────────────

  it("returns 404 for all routes under a wildcard pattern (/soroban/*)", async () => {
    const { app } = loadFreshApp("/soroban/*");

    const res1 = await request(app).get("/soroban/contract/abc123");
    expect(res1.statusCode).toBe(404);
    expect(res1.body.error.type).toBe("EndpointDisabled");

    const res2 = await request(app).get("/soroban/contract/abc123/storage");
    expect(res2.statusCode).toBe(404);
    expect(res2.body.error.type).toBe("EndpointDisabled");
  });

  // ── Unaffected routes ──────────────────────────────────────────────────────

  it("does not affect routes not listed in DISABLED_ROUTES", async () => {
    const { app } = loadFreshApp("/soroban/*");

    // /health/live makes no upstream calls — verifies non-disabled routes still work.
    const res = await request(app).get("/health/live");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "alive" });
  });

  it("does not affect /health/live", async () => {
    const { app } = loadFreshApp("/soroban/*,GET /network/validators");

    const res = await request(app).get("/health/live");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "alive" });
  });

  // ── No upstream call on a disabled route ─────────────────────────────────

  it("makes no upstream (Horizon) call on a disabled route", async () => {
    const { app, server } = loadFreshApp("GET /network/validators");
    const spy = jest.spyOn(server, "serverInfo");

    await request(app).get("/network/validators");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // ── Unmatched-pattern warning ─────────────────────────────────────────────

  it("logs a warning when a pattern matches no registered route", () => {
    const { parsePatterns } = require("../src/middleware/disabledRoutes");
    const logger = require("../src/utils/logger");
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

    // "GET /nonexistent/path" does not match any registered route.
    parsePatterns("GET /nonexistent/path", [
      { method: "GET", path: "/network-status" },
      { method: "GET", path: "/soroban" },
    ]);

    const unmatchedCall = warnSpy.mock.calls.find(
      (args) => typeof args[1] === "string" && args[1].includes("matches no registered routes"),
    );
    expect(unmatchedCall).toBeDefined();
    warnSpy.mockRestore();
  });

  it("does not warn when a pattern matches a registered route", () => {
    const { parsePatterns } = require("../src/middleware/disabledRoutes");
    const logger = require("../src/utils/logger");
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

    // "/soroban/*" matches the registered route "/soroban".
    parsePatterns("/soroban/*", [
      { method: "GET", path: "/soroban" },
      { method: "GET", path: "/network-status" },
    ]);

    const unmatchedCall = warnSpy.mock.calls.find(
      (args) => typeof args[1] === "string" && args[1].includes("matches no registered routes"),
    );
    expect(unmatchedCall).toBeUndefined();
    warnSpy.mockRestore();
  });

  // ── Multiple patterns ─────────────────────────────────────────────────────

  it("supports multiple comma-separated patterns", async () => {
    const { app } = loadFreshApp("GET /network/validators,/soroban/*");

    const res1 = await request(app).get("/network/validators");
    expect(res1.statusCode).toBe(404);
    expect(res1.body.error.type).toBe("EndpointDisabled");

    const res2 = await request(app).get("/soroban/contract/test");
    expect(res2.statusCode).toBe(404);
    expect(res2.body.error.type).toBe("EndpointDisabled");
  });

  // ── Empty / unset ─────────────────────────────────────────────────────────

  it("does not disable any routes when DISABLED_ROUTES is empty", async () => {
    const { app } = loadFreshApp("");

    // /health/live makes no upstream calls — verifies nothing is disabled.
    const res = await request(app).get("/health/live");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "alive" });
  });

  // ── .env.example documents the variable ───────────────────────────────────

  it(".env.example documents DISABLED_ROUTES", () => {
    const fs = require("fs");
    const path = require("path");
    const envExample = fs.readFileSync(
      path.join(__dirname, "..", ".env.example"),
      "utf-8",
    );
    expect(envExample).toContain("DISABLED_ROUTES");
    expect(envExample.toLowerCase()).toContain("disabled");
  });
});
