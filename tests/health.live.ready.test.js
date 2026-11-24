/**
 * Tests for GET /health/live and GET /health/ready.
 *
 * /health/live  — always 200 { status: "alive" }, no upstream calls.
 * /health/ready — 200 only when a background Horizon probe has succeeded
 *                  within READINESS_MAX_AGE_MS (default 30 000).
 *                  Before first success: 503 { status: "starting" }
 *                  After stale/failed:    503 { status: "not_ready" }
 *
 * Both routes are excluded from rate limiting.
 */

const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const readinessProbe = require("../src/services/readinessProbe");

describe("GET /health/live", () => {
  it("always returns 200 with { status: 'alive' }", async () => {
    const res = await request(app).get("/health/live");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "alive" });
  });

  it("makes no upstream (Horizon) calls", async () => {
    const spy = jest.spyOn(server, "serverInfo");
    await request(app).get("/health/live");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is excluded from rate limiting", async () => {
    // Send many requests — none should be rate-limited (429).
    for (let i = 0; i < 150; i++) {
      const res = await request(app).get("/health/live");
      expect(res.statusCode).toBe(200);
    }
  }, 30_000);
});

describe("GET /health/ready", () => {
  beforeEach(() => {
    readinessProbe.reset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    readinessProbe.reset();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("returns 503 { status: 'starting' } before the first successful probe", async () => {
    const res = await request(app).get("/health/ready");
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ status: "starting" });
  });

  it("returns 200 { status: 'ready' } after a successful probe", async () => {
    jest.spyOn(server, "serverInfo").mockResolvedValue({
      horizon_version: "2.33.0",
      history_latest_ledger: 100,
    });

    readinessProbe.start(server);
    // Let the async probe settle.
    await jest.advanceTimersByTimeAsync(0);

    const res = await request(app).get("/health/ready");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });

  it("returns 503 { status: 'not_ready' } when the probe result is stale", async () => {
    jest.spyOn(server, "serverInfo").mockResolvedValue({
      horizon_version: "2.33.0",
    });

    readinessProbe.start(server);
    await jest.advanceTimersByTimeAsync(0);

    // Stop the interval so subsequent probes don't fire and reset the timestamp.
    readinessProbe.stop();

    // Advance past READINESS_MAX_AGE_MS (default 30 000 ms).
    jest.advanceTimersByTime(31_000);

    const res = await request(app).get("/health/ready");
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ status: "not_ready" });
  });

  it("recovers to ready after the next interval probe succeeds", async () => {
    jest.spyOn(server, "serverInfo").mockResolvedValue({
      horizon_version: "2.33.0",
    });

    readinessProbe.start(server);
    await jest.advanceTimersByTimeAsync(0);

    // Stop the interval, go stale.
    readinessProbe.stop();
    jest.advanceTimersByTime(31_000);
    expect(readinessProbe.getStatus()).toBe("not_ready");

    // Restart the probe — the immediate run succeeds.
    readinessProbe.start(server);
    await jest.advanceTimersByTimeAsync(0);

    const res = await request(app).get("/health/ready");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });

  it("returns 503 { status: 'not_ready' } when the probe fails", async () => {
    jest.spyOn(server, "serverInfo").mockRejectedValue(new Error("unreachable"));

    readinessProbe.start(server);
    await jest.advanceTimersByTimeAsync(0);

    const res = await request(app).get("/health/ready");
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ status: "not_ready" });
  });

  it("is excluded from rate limiting", async () => {
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });
    readinessProbe.start(server);
    await jest.advanceTimersByTimeAsync(0);

    // Send many requests — none should be rate-limited (429).
    for (let i = 0; i < 150; i++) {
      const res = await request(app).get("/health/ready");
      expect(res.statusCode).not.toBe(429);
    }
  }, 30_000);

  it("requests never trigger upstream calls themselves", async () => {
    const spy = jest.spyOn(server, "serverInfo").mockResolvedValue({
      horizon_version: "2.33.0",
    });

    readinessProbe.start(server);
    await jest.advanceTimersByTimeAsync(0);

    // Clear the mock call count (from the probe) and make HTTP requests.
    spy.mockClear();
    await request(app).get("/health/ready");
    await request(app).get("/health/ready");
    await request(app).get("/health/ready");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
