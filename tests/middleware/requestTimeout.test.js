"use strict";

const express = require("express");
const request = require("supertest");
const { createRequestTimeout, DEFAULT_TIMEOUT_MS } = require("../../src/middleware/requestTimeout");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeApp({ timeoutMs = 20, handler, streamHandler } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = "req-123";
    next();
  });
  app.use(createRequestTimeout({ timeoutMs }));
  app.get("/slow", (req, res) => handler(req, res));
  app.get("/fast", (_req, res) => res.json({ ok: true }));
  app.get("/stream/ledgers", (_req, res) =>
    (streamHandler || ((_req2, res2) => setTimeout(() => res2.json({ stream: true }), 60)))(_req, res),
  );
  return app;
}

describe("request timeout middleware", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("has a 30000ms default", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30000);
  });

  it("returns 504 RequestTimeout for a slow handler", async () => {
    const handler = jest.fn(() => {
      /* intentionally never responds */
    });
    const res = await request(makeApp({ timeoutMs: 20, handler })).get("/slow");
    expect(res.statusCode).toBe(504);
    expect(res.body.type).toBe("RequestTimeout");
    expect(res.body.message).toMatch(/timed out/i);
    expect(res.body.requestId).toBe("req-123");
    expect(res.body.error.type).toBe("RequestTimeout");
  });

  it("does not affect a fast handler", async () => {
    const res = await request(makeApp({ timeoutMs: 20, handler: jest.fn() })).get("/fast");
    await sleep(40);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("exempts /stream/* routes", async () => {
    const res = await request(makeApp({ timeoutMs: 20, handler: jest.fn() })).get("/stream/ledgers");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ stream: true });
  });

  it("exempts WebSocket upgrade requests", () => {
    jest.useFakeTimers();
    const middleware = createRequestTimeout({ timeoutMs: 100 });
    const req = { path: "/anything", headers: { upgrade: "websocket" } };
    const next = jest.fn();
    middleware(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("clears the timer on finish and close", () => {
    jest.useFakeTimers();
    const middleware = createRequestTimeout({ timeoutMs: 100 });
    const EventEmitter = require("events").EventEmitter;

    for (const event of ["finish", "close"]) {
      const req = { path: "/x", headers: {} };
      const res = new EventEmitter();
      res.json = jest.fn();
      res.send = jest.fn();
      middleware(req, res, jest.fn());
      expect(jest.getTimerCount()).toBe(1);
      res.emit(event);
      expect(jest.getTimerCount()).toBe(0);
    }
  });

  it("guards a late handler completion after timeout (fake timers)", async () => {
    jest.useFakeTimers();
    const middleware = createRequestTimeout({ timeoutMs: 100 });
    const EventEmitter = require("events").EventEmitter;
    const req = { path: "/x", headers: {}, requestId: "r1" };
    const res = new EventEmitter();
    res.headersSent = false;
    res.writableEnded = false;
    res.status = jest.fn(() => res);
    const jsonMock = jest.fn();
    res.json = jsonMock;
    res.send = jest.fn();
    middleware(req, res, jest.fn());

    jest.advanceTimersByTime(120);
    expect(res.status).toHaveBeenCalledWith(504);
    expect(jsonMock).toHaveBeenCalledTimes(1);

    // The middleware wraps res.json/res.send; the original mock stays untouched.
    expect(() => res.json({ late: true })).not.toThrow();
    expect(() => res.send("late")).not.toThrow();
    expect(jsonMock).toHaveBeenCalledTimes(1);
  });
});
