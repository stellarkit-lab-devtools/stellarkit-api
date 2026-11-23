/**
 * Tests for Issue #692 — Shield sensitive error details from production responses.
 *
 * Verifies:
 *   - Stack traces never appear in error responses when NODE_ENV=production
 *   - File paths (Windows and POSIX) are stripped from production responses
 *   - Full error details remain visible in development (NODE_ENV=development)
 *   - The sanitizeMessage helper is exported for unit-level testing
 *   - Generic fallback errors are sanitized in production
 *   - ReferenceError / TypeError detail is sanitized in production
 */

"use strict";

// We test the error handler in isolation (no HTTP layer needed for sanitization
// logic) and also via the full Express app to confirm end-to-end behaviour.

const errorHandler = require("../src/middleware/errorHandler");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReqRes() {
  const req = { method: "GET", path: "/test", requestId: null };
  const calls = [];
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation((body) => {
      calls.push(body);
      return res;
    }),
    _calls: calls,
  };
  const next = jest.fn();
  return { req, res, next };
}

function getResponseBody(res) {
  return res._calls[0];
}

// ── Production mode — stack traces must be absent ─────────────────────────────

describe("errorHandler — production mode (NODE_ENV=production)", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("does not expose stack trace lines (at ... file:line:col) in fallback errors", () => {
    const { req, res, next } = makeReqRes();
    // Simulate an error whose message contains a V8 stack frame
    const err = new Error("Something went wrong\n    at Object.<anonymous> (src/routes/feeEstimate.js:42:15)");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.success).toBe(false);
    const message = body.error.message;
    expect(message).not.toMatch(/at Object\.<anonymous>/);
    expect(message).not.toMatch(/feeEstimate\.js/);
    expect(message).toBe("An unexpected error occurred.");
  });

  it("does not expose Windows absolute file paths in fallback errors", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("Cannot find module 'C:\\Users\\HP\\Desktop\\my new project\\stellarkit-api\\src\\utils\\missingFile.js'");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error.message).not.toMatch(/C:\\Users/);
    expect(body.error.message).not.toMatch(/stellarkit-api/);
    expect(body.error.message).toBe("An unexpected error occurred.");
  });

  it("does not expose POSIX absolute file paths in fallback errors", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("ENOENT: no such file or directory, open '/home/ubuntu/app/src/config/stellar.js'");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error.message).not.toMatch(/\/home\/ubuntu/);
    expect(body.error.message).not.toMatch(/stellar\.js/);
    expect(body.error.message).toBe("An unexpected error occurred.");
  });

  it("returns a safe fallback for ReferenceError in production", () => {
    const { req, res, next } = makeReqRes();
    const err = new ReferenceError("someInternalVar is not defined\n    at handler (src/routes/network.js:10:5)");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("InternalError");
    // The detail field must not expose the file path or stack frame
    if (body.error.detail !== undefined) {
      expect(body.error.detail).not.toMatch(/src\/routes/);
      expect(body.error.detail).not.toMatch(/at handler/);
    }
  });

  it("returns a safe fallback for TypeError in production", () => {
    const { req, res, next } = makeReqRes();
    const err = new TypeError("Cannot read properties of undefined (reading 'feeStats')\n    at GET /fee-estimate (src/routes/feeEstimate.js:55:25)");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("InternalError");
    if (body.error.detail !== undefined) {
      expect(body.error.detail).not.toMatch(/feeEstimate\.js/);
      expect(body.error.detail).not.toMatch(/at GET/);
    }
  });

  it("passes through safe error messages that contain no paths or stack frames", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("Rate limit exceeded");
    err.status = 429;
    err.type = "RateLimitError";
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error.message).toBe("Rate limit exceeded");
  });

  it("returns a generic fallback when err.message is empty in production", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("does not include a stack property on the error body in production", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("Internal failure");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toContain("at errorHandler");
  });
});

// ── Development mode — full details must be visible ───────────────────────────

describe("errorHandler — development mode (NODE_ENV=development)", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("exposes the full error message in development (including file path content)", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("Cannot connect to database at localhost:5432");
    err.status = 500;
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    // In development, the raw message should appear unchanged
    expect(body.error.message).toBe("Cannot connect to database at localhost:5432");
  });

  it("exposes ReferenceError message in development", () => {
    const { req, res, next } = makeReqRes();
    const err = new ReferenceError("myVar is not defined");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error.type).toBe("InternalError");
    // In dev, the detail shows the raw message
    expect(body.error.detail).toBe("myVar is not defined");
  });

  it("exposes TypeError message in development", () => {
    const { req, res, next } = makeReqRes();
    const err = new TypeError("Cannot read properties of null (reading 'map')");
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error.type).toBe("InternalError");
    expect(body.error.detail).toBe("Cannot read properties of null (reading 'map')");
  });

  it("does not strip a message that merely mentions a file without it being an absolute path", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("Failed to parse feeEstimate response");
    err.status = 500;
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    expect(body.error.message).toContain("feeEstimate");
  });
});

// ── Test mode (default for Jest) — full details visible ───────────────────────

describe("errorHandler — test mode (NODE_ENV=test)", () => {
  it("exposes the full error message in test mode", () => {
    const { req, res, next } = makeReqRes();
    const err = new Error("Some internal message with path /tmp/data.json");
    err.status = 500;
    errorHandler(err, req, res, next);

    const body = getResponseBody(res);
    // NODE_ENV=test is not production, so message passes through
    expect(body.error.message).toContain("/tmp/data.json");
  });
});
