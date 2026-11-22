const http = require("node:http");
const express = require("express");
const request = require("supertest");
const { Horizon } = require("@stellar/stellar-sdk");
const { createHorizonFailover, configuredUrls } = require("../src/utils/horizonFailover");
const errorHandler = require("../src/middleware/errorHandler");
const { getHorizonHealth } = require("../src/utils/horizonHealth");

describe("Horizon failover with mock HTTP servers", () => {
  let servers;
  let primary;
  let backup;
  let time;
  const endpoint = async (status = 200) => {
    const state = { status, requests: [], disconnect: false, delay: 0 };
    const server = http.createServer((req, res) => {
      state.requests.push({ url: req.url, authorization: req.headers.authorization });
      if (state.disconnect) return req.socket.destroy();
      const respond = () => {
        res.writeHead(state.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(state.status === 200 ? { horizon_version: "mock", _embedded: { records: [] } } : { title: "Mock failure" }));
      };
      if (state.delay) setTimeout(respond, state.delay);
      else respond();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return { state, url: `http://127.0.0.1:${server.address().port}` };
  };
  const client = (urls = [primary.url, backup.url]) => createHorizonFailover({
    urls, stickyMs: 60000, now: () => time,
    createServer: (url) => new Horizon.Server(url, { allowHttp: true, timeout: 50 }),
  });

  beforeEach(async () => {
    servers = [];
    time = 1000;
    primary = await endpoint();
    backup = await endpoint();
  });
  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })));
  });

  it("prefers HORIZON_URLS in order and preserves the single URL fallback", () => {
    expect(configuredUrls({ HORIZON_URLS: " https://a.test,https://b.test, ", HORIZON_URL: "https://old.test" }, "https://default.test"))
      .toEqual(["https://a.test", "https://b.test"]);
    expect(configuredUrls({ HORIZON_URL: "https://old.test" }, "https://default.test")).toEqual(["https://old.test"]);
    expect(configuredUrls({}, "https://default.test")).toEqual(["https://default.test"]);
  });

  it("retries the identical builder request on connection failure", async () => {
    primary.state.disconnect = true;
    const { server } = client();
    await server.operations().limit(7).order("asc").cursor("123").call();
    expect(primary.state.requests).toHaveLength(1);
    expect(backup.state.requests).toHaveLength(1);
    expect(backup.state.requests[0].url).toBe(primary.state.requests[0].url);
  });

  it("does not fail over for a 404", async () => {
    primary.state.status = 404;
    await expect(client().server.root()).rejects.toMatchObject({ response: { status: 404 } });
    expect(backup.state.requests).toHaveLength(0);
  });

  it.each([500, 502, 503])("fails over on HTTP %s", async (status) => {
    primary.state.status = status;
    await expect(client().server.root()).resolves.toMatchObject({ horizon_version: "mock" });
    expect(backup.state.requests).toHaveLength(1);
  });

  it("fails over on timeout", async () => {
    primary.state.delay = 150;
    await expect(client().server.root()).resolves.toMatchObject({ horizon_version: "mock" });
    expect(backup.state.requests).toHaveLength(1);
  });

  it("keeps the last good host until the fixed sticky deadline, then retries primary", async () => {
    primary.state.status = 503;
    const failover = client();
    await failover.server.root();
    primary.state.status = 200;
    time += 59000;
    await failover.server.root();
    expect(primary.state.requests).toHaveLength(1);
    time += 1000;
    await failover.server.root();
    expect(primary.state.requests).toHaveLength(2);
    expect(failover.getActiveHost()).toBe(new URL(primary.url).host);
  });

  it("returns a credential-free 503 envelope when all URLs fail", async () => {
    primary.state.status = backup.state.status = 503;
    const failover = client([primary.url.replace("://", "://alice:secret@"), backup.url]);
    const app = express();
    app.get("/probe", async (_req, res, next) => {
      try { res.json(await failover.server.root()); } catch (error) { next(error); }
    });
    app.use(errorHandler);
    const result = await request(app).get("/probe");
    expect(result.status).toBe(503);
    expect(result.body.error.type).toBe("UpstreamUnavailable");
    expect(JSON.stringify(result.body)).not.toMatch(/alice|secret/);
  });

  it("reports only the active host without credentials, path or query", async () => {
    primary.state.status = 503;
    const failover = client([primary.url, `${backup.url.replace("://", "://alice:secret@")} /private?key=value`.replace(" /", "/")]);
    const health = await getHorizonHealth({ server: failover.server, network: "testnet" });
    const body = { ...health, host: failover.getActiveHost() };
    expect(body.status).toBe("ok");
    expect(body.host).toBe(new URL(backup.url).host);
    expect(JSON.stringify(body)).not.toMatch(/alice|secret|private|key=value/);
  });

  it("never retries streaming subscriptions", () => {
    const stream = jest.fn(() => "unsubscribe");
    const createServer = jest.fn(() => ({ ledgers: () => ({ stream }) }));
    const failover = createHorizonFailover({ urls: [primary.url, backup.url], createServer });
    expect(failover.server.ledgers().stream({})).toBe("unsubscribe");
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
