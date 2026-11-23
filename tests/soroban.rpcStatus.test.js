"use strict";

/** Coverage for GET /soroban/rpc-status. Mounts only the Soroban router so
 *  the test is independent of unrelated route modules. */

const express = require("express");
const request = require("supertest");

jest.mock("../src/config/stellar", () => {
  const original = jest.requireActual("../src/config/stellar");
  return {
    ...original,
    NETWORK: "testnet",
    sorobanServer: {
      getLatestLedger: jest.fn(),
      getVersionInfo: jest.fn(),
    },
  };
});

const { sorobanServer } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");
jest.mock("../src/utils/response", () => ({
  success: (res, data) => res.json({ success: true, data }),
}));
const sorobanRouter = require("../src/routes/soroban");
const errorHandler = require("../src/middleware/errorHandler");

const app = express();
app.use(sorobanRouter);
app.use(errorHandler);

describe("GET /soroban/rpc-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns health, retention window and version details", async () => {
    sorobanServer.getLatestLedger.mockResolvedValue({ sequence: 50000 });
    sorobanServer.getVersionInfo.mockResolvedValue({
      version: "21.2.0",
      protocolVersion: 21,
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const res = await request(app).get("/rpc-status");

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      status: "ok",
      latestLedger: 50000,
      oldestLedger: 32720,
      retentionWindowLedgers: 17280,
      retentionWindowApproxHours: 24,
      version: "21.2.0",
      protocolVersion: 21,
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(res.get("X-Cache")).toBe("MISS");

    const cached = await request(app).get("/rpc-status");
    expect(cached.get("X-Cache")).toBe("HIT");
    expect(cached.body.data).toEqual(res.body.data);
    expect(sorobanServer.getLatestLedger).toHaveBeenCalledTimes(1);
  });

  it("returns null version fields when getVersionInfo is unsupported", async () => {
    sorobanServer.getLatestLedger.mockResolvedValue({ sequence: 1000 });
    delete sorobanServer.getVersionInfo;

    const res = await request(app).get("/rpc-status");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.version).toBeNull();
    expect(res.body.data.protocolVersion).toBeNull();
    expect(res.body.data.networkPassphrase).toBeNull();
  });

  it("returns 503 upstream-unavailable for an unreachable RPC", async () => {
    sorobanServer.getLatestLedger.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await request(app).get("/rpc-status");

    expect(res.statusCode).toBe(503);
    expect(res.body.error.type).toBe("UpstreamUnavailable");
  });
});
