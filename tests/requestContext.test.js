const express = require("express");
const request = require("supertest");
const logger = require("../src/utils/logger");
const {
  runWithRequestContext,
  getRequestContext,
  requestContextMiddleware,
} = require("../src/utils/requestContext");
const requestIdMiddleware = require("../src/middleware/requestId");
const cacheService = require("../src/services/cache");
const { server, fetchAccountCreation } = require("../src/config/stellar");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loggedEntries(spy) {
  return spy.mock.calls.map((call) => call[0]).filter((x) => x && typeof x === "object");
}

describe("request-scoped log context", () => {
  let spy;

  beforeEach(() => {
    spy = jest.spyOn(logger.__rawLogger, "debug").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps two concurrent slow requests' contexts separate across awaits, setTimeout and promise chains", async () => {
    async function slowRequest(id) {
      return runWithRequestContext({ requestId: id, method: "GET", route: "/slow" }, async () => {
        await delay(id === "req-1" ? 25 : 5);
        await Promise.resolve().then(() => delay(5));
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.debug("after awaits");
        return getRequestContext().requestId;
      });
    }

    const [first, second] = await Promise.all([slowRequest("req-1"), slowRequest("req-2")]);
    expect(first).toBe("req-1");
    expect(second).toBe("req-2");
    const entries = loggedEntries(spy);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: "req-1", method: "GET", route: "/slow" }),
      expect.objectContaining({ requestId: "req-2", method: "GET", route: "/slow" }),
    ]));
  });

  it("middleware after request-ID middleware makes context available to services without req", async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const app = express();
    app.use(requestIdMiddleware);
    app.use(requestContextMiddleware);
    app.get("/slow", async (req, res) => {
      await delay(10);
      cacheService.get("context-test-miss-key");
      logger.debug("handler log");
      res.json({ ok: true });
    });

    await Promise.all([
      request(app).get("/slow").set("x-request-id", "aaa111").expect(200),
      request(app).get("/slow").set("x-request-id", "bbb222").expect(200),
    ]);

    const calls = spy.mock.calls;
    expect(calls.some((call) => call[0]?.requestId === "aaa111" && String(call[1]).includes("Cache miss"))).toBe(true);
    expect(calls.some((call) => call[0]?.requestId === "bbb222" && String(call[1]).includes("Cache miss"))).toBe(true);
    process.env.NODE_ENV = previousEnv;
  });

  it("Horizon wrapper logs carry the request ID without signature changes", async () => {
    const chain = {
      forAccount: () => chain,
      order: () => chain,
      limit: () => chain,
      call: async () => ({ records: [{ ledger_attr: 1, created_at: "2024-01-01T00:00:00Z" }] }),
    };
    jest.spyOn(server, "transactions").mockReturnValue(chain);
    await runWithRequestContext({ requestId: "horizon-123" }, () =>
      fetchAccountCreation("GABC"));
    expect(loggedEntries(spy).some((e) => e.requestId === "horizon-123" && e.operation === "fetchAccountCreation")).toBe(true);
  });

  it("logs outside a request carry no request ID", async () => {
    expect(getRequestContext()).toBeUndefined();
    logger.debug("outside request");
    expect(loggedEntries(spy)).toEqual([expect.not.objectContaining({ requestId: expect.anything() })]);
  });
});
