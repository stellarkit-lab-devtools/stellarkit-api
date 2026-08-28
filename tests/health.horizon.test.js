"use strict";

/**
 * GET /health — Horizon connectivity (Issue #695).
 *
 * Covers healthy, slow (degraded), and unreachable Horizon scenarios.
 */

const request = require("supertest");

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    NETWORK: "testnet",
    server: {
      serverInfo: jest.fn(),
      root: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server, NETWORK } = require("../src/config/stellar");

describe("GET /health — Horizon connectivity", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("reports horizon.status ok and overall status ok when Horizon is healthy", async () => {
    server.serverInfo.mockResolvedValue({
      horizon_version: "22.0.1",
      network_passphrase: "Test SDF Network ; September 2015",
    });

    const res = await request(app).get("/health");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.horizon).toEqual({
      status: "ok",
      responseTimeMs: expect.any(Number),
      network: NETWORK,
    });
    expect(res.body.data.horizon.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(res.body.data.horizon.responseTimeMs).toBeLessThan(2000);
    expect(server.serverInfo).toHaveBeenCalledTimes(1);
  });

  it("reports degraded when Horizon is slow", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    server.serverInfo.mockImplementation(async () => {
      now += 2500;
      return { horizon_version: "22.0.1" };
    });

    const res = await request(app).get("/health");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("degraded");
    expect(res.body.data.horizon.status).toBe("degraded");
    expect(res.body.data.horizon.responseTimeMs).toBeGreaterThanOrEqual(2000);
    expect(res.body.data.horizon.network).toBe(NETWORK);
  });

  it("reports unreachable when Horizon cannot be reached", async () => {
    server.serverInfo.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await request(app).get("/health");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("unreachable");
    expect(res.body.data.horizon.status).toBe("unreachable");
    expect(typeof res.body.data.horizon.responseTimeMs).toBe("number");
    expect(res.body.data.horizon.network).toBe(NETWORK);
  });
});
