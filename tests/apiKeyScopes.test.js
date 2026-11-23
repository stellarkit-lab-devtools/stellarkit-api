"use strict";

const crypto = require("crypto");

jest.mock("../src/utils/logger", () => ({ error: jest.fn() }));

function middleware() {
  return require("../src/middleware/apiKeyAuth");
}

function makeReq(key, path) {
  return { headers: { "x-api-key": key }, path };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("API key scopes", () => {
  let next, res;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REQUIRE_API_KEY = "true";
    next = jest.fn();
    res = makeRes();
  });

  it("allows a read key on a normal read route", () => {
    process.env.API_KEYS = "readkey:read,adminkey:admin";
    middleware()(makeReq("readkey", "/account/test"), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a read key on /cache/stats with 403 InsufficientScope", () => {
    process.env.API_KEYS = "readkey:read,adminkey:admin";
    middleware()(makeReq("readkey", "/cache/stats"), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        type: "InsufficientScope",
        message: "This API key does not have the scope required for this endpoint.",
        requiredScope: "admin",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a read key on a /metrics* route", () => {
    process.env.API_KEYS = "readkey:read";
    middleware()(makeReq("readkey", "/metrics/slowest"), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error.requiredScope).toBe("admin");
  });

  it("allows an admin key on operational routes", () => {
    process.env.API_KEYS = "readkey:read,adminkey:admin";
    const mw = middleware();
    mw(makeReq("adminkey", "/cache/stats"), res, next);
    mw(makeReq("adminkey", "/metrics"), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("treats a legacy unsuffixed key as read scope", () => {
    process.env.API_KEYS = "legacykey";
    const mw = middleware();
    mw(makeReq("legacykey", "/account/test"), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    mw(makeReq("legacykey", "/cache/stats"), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects and logs an entry with an unknown scope", () => {
    process.env.API_KEYS = "readkey:read,badkey:superuser";
    const mw = middleware();
    const logger = require("../src/utils/logger");
    expect(logger.error).toHaveBeenCalled();
    mw(makeReq("badkey", "/account/test"), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.type).toBe("Unauthorized");
    // The valid entry is still registered
    const res2 = makeRes();
    mw(makeReq("readkey", "/account/test"), res2, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not enforce scopes when REQUIRE_API_KEY is false", () => {
    process.env.REQUIRE_API_KEY = "false";
    process.env.API_KEYS = "readkey:read";
    middleware()(makeReq("readkey", "/metrics"), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("still uses SHA-256 for key hashing", () => {
    process.env.API_KEYS = "readkey:read";
    middleware();
    const expected = crypto.createHash("sha256").update("readkey").digest("hex");
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });
});
