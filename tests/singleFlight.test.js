"use strict";

/**
 * Issue #1179 — single-flight coalescing of identical concurrent upstream calls.
 */

const express = require("express");
const request = require("supertest");

jest.mock("../src/utils/mapNetworkStatus", () => ({
  fetchNetworkStatus: jest.fn(),
}));

const { singleFlight, getInFlightCount, reset } = require("../src/utils/singleFlight");
const { fetchNetworkStatus } = require("../src/utils/mapNetworkStatus");
const cacheService = require("../src/services/cache");
const networkStatusRouter = require("../src/routes/networkStatus");
const cacheStatsRouter = require("../src/routes/cacheStats");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("singleFlight helper", () => {
  beforeEach(() => reset());
  afterEach(() => reset());

  it("shares one upstream call between ten concurrent callers for the same key", async () => {
    const gate = deferred();
    const upstream = jest.fn(() => gate.promise);
    const results = Array.from({ length: 10 }, () => singleFlight("key:A", upstream));
    await Promise.resolve(); // let the deferred upstream call start

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(getInFlightCount()).toBe(1);

    gate.resolve("value");
    await expect(Promise.all(results)).resolves.toEqual(Array(10).fill("value"));
    expect(getInFlightCount()).toBe(0);
  });

  it("does not coalesce different keys", async () => {
    const gate = deferred();
    const a = jest.fn(() => gate.promise);
    const b = jest.fn(async () => "B");

    const pa = singleFlight("key:A", a);
    const pb = singleFlight("key:B", b);
    await Promise.resolve();
    expect(getInFlightCount()).toBe(2);

    gate.resolve("A");
    await expect(Promise.all([pa, pb])).resolves.toEqual(["A", "B"]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("propagates a rejection to every waiter and lets the next call retry", async () => {
    const gate = deferred();
    const upstream = jest.fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue("recovered");

    const waiters = Array.from({ length: 3 }, () => singleFlight("key:err", upstream));
    await Promise.resolve();
    gate.reject(new Error("boom"));
    await expect(Promise.all(waiters.map((p) => p.catch((e) => e.message))))
      .resolves.toEqual(["boom", "boom", "boom"]);

    expect(getInFlightCount()).toBe(0);
    await expect(singleFlight("key:err", upstream)).resolves.toBe("recovered");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("leaves no in-flight entry after either settle path", async () => {
    await singleFlight("ok", async () => 1);
    expect(getInFlightCount()).toBe(0);
    await expect(singleFlight("bad", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(getInFlightCount()).toBe(0);
  });
});

describe("coalescing on GET /network-status?fresh=true", () => {
  let miniApp;

  beforeEach(() => {
    reset();
    cacheService.flush();
    jest.clearAllMocks();
    miniApp = express();
    miniApp.use("/network-status", networkStatusRouter);
    miniApp.use("/cache", cacheStatsRouter);
  });
  afterEach(() => {
    reset();
    cacheService.flush();
  });

  it("ten concurrent fresh requests produce one upstream call and increment the counter", async () => {
    const gate = deferred();
    let started = 0;
    fetchNetworkStatus.mockImplementation(() => {
      started++;
      return gate.promise;
    });

    // supertest requests are lazy: kick them off with .then() immediately.
    const requests = Array.from({ length: 10 }, () =>
      request(miniApp).get("/network-status?fresh=true").then((res) => res));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toBe(1);
    gate.resolve({ horizonVersion: "test", currentLedger: 1 });
    const responses = await Promise.all(requests);

    responses.forEach((res) => expect(res.statusCode).toBe(200));
    expect(started).toBe(1);
    expect(fetchNetworkStatus).toHaveBeenCalledTimes(1);

    const stats = await request(miniApp).get("/cache/stats");
    expect(stats.body.data.coalescedRequests).toBe(9);
    expect(getInFlightCount()).toBe(0);
  });

  it("a failed upstream call is retried by the next request", async () => {
    fetchNetworkStatus
      .mockRejectedValueOnce(new Error("horizon down"))
      .mockResolvedValue({ horizonVersion: "recovered" });

    const first = await request(miniApp).get("/network-status?fresh=true");
    expect(first.statusCode).toBe(500);
    expect(getInFlightCount()).toBe(0);

    const second = await request(miniApp).get("/network-status?fresh=true");
    expect(second.statusCode).toBe(200);
    expect(fetchNetworkStatus).toHaveBeenCalledTimes(2);
  });
});
