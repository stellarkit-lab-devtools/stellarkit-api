"use strict";

/**
 * Tests for sdk/stream.ts — the auto-reconnecting SSE / WebSocket client
 * exposed as `client.stream`.
 *
 * Jest has no TypeScript transform configured, so the real module is
 * transpiled on the fly with the project's `typescript` devDependency and
 * exercised against a fake HTTP/WebSocket server on localhost.
 *
 * Covers:
 *   - a normal stream
 *   - a drop followed by a resume via ?cursor= with no duplicates or gaps
 *   - backoff timing (exponential, jittered, capped, bounded by maxRetries)
 *   - heartbeat timeout forcing a reconnect
 *   - close() stopping retries
 *   - AbortSignal
 *   - the WS /stream/ledgers helper
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const Module = require("module");
const WebSocket = require("ws");

function loadTsModule(file) {
  const ts = require("typescript");
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod._compile(outputText, file);
  return mod.exports;
}

const { StreamClient, StreamError, computeBackoffDelay } = loadTsModule(
  path.join(__dirname, "..", "sdk", "stream.ts")
);

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── Fake server helpers ───────────────────────────────────────────────────────

function payment(n) {
  return {
    type: "payment",
    amount: `${n}.0000000`,
    asset: { code: "XLM", issuer: null, type: "native" },
    from: ACCOUNT,
    to: ACCOUNT,
    timestamp: "2026-01-01T00:00:00Z",
    cursor: String(n),
  };
}

function writeSseEvent(res, name, data, id) {
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${name}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: connected\ndata: {}\n\n`);
}

let server;
let baseUrl;
let requests;
let handler;

beforeEach(async () => {
  requests = [];
  handler = (req, res) => {
    res.writeHead(404);
    res.end();
  };
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    requests.push({ path: url.pathname, cursor: url.searchParams.get("cursor"), at: Date.now() });
    handler(req, res, url, requests.length);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeBackoffDelay", () => {
  it("grows exponentially from initialDelayMs", () => {
    const opts = { initialDelayMs: 100, maxDelayMs: 10_000, random: () => 0 };
    expect(computeBackoffDelay(0, opts)).toBe(50);
    expect(computeBackoffDelay(1, opts)).toBe(100);
    expect(computeBackoffDelay(2, opts)).toBe(200);
    expect(computeBackoffDelay(3, opts)).toBe(400);
  });

  it("applies jitter within [base/2, base]", () => {
    const low = computeBackoffDelay(2, { initialDelayMs: 100, random: () => 0 });
    const high = computeBackoffDelay(2, { initialDelayMs: 100, random: () => 0.999 });
    expect(low).toBe(200);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(400);
  });

  it("caps at maxDelayMs", () => {
    const delay = computeBackoffDelay(20, { initialDelayMs: 100, maxDelayMs: 1000, random: () => 0.999 });
    expect(delay).toBeLessThanOrEqual(1000);
    expect(delay).toBeGreaterThanOrEqual(500);
  });
});

describe("client.stream — SSE", () => {
  it("delivers a normal stream in order and calls onOpen", async () => {
    handler = (req, res) => {
      openSse(res);
      res.write(": ping\n\n");
      [1, 2, 3].forEach((n) => writeSseEvent(res, "payment", payment(n), n));
    };

    const received = [];
    const onOpen = jest.fn();
    const client = new StreamClient({ baseUrl });
    const sub = client.payments(ACCOUNT, {
      onMessage: (p) => received.push(p),
      onOpen,
    });

    await waitFor(() => received.length === 3);
    sub.close();

    expect(received.map((p) => p.cursor)).toEqual(["1", "2", "3"]);
    expect(received[0].asset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(requests[0].path).toBe(`/stream/payments/${ACCOUNT}`);
    expect(requests[0].cursor).toBeNull();
  });

  it("sends the API key header", async () => {
    let apiKey;
    handler = (req, res) => {
      apiKey = req.headers["x-api-key"];
      openSse(res);
    };
    const sub = new StreamClient({ baseUrl, apiKey: "secret" }).transactions(ACCOUNT, {
      onMessage: () => {},
    });
    await waitFor(() => requests.length === 1 && apiKey !== undefined);
    sub.close();
    expect(apiKey).toBe("secret");
    expect(requests[0].path).toBe(`/stream/transactions/${ACCOUNT}`);
  });

  it("resumes from the last cursor after a drop with no duplicates or gaps", async () => {
    const ALL = [1, 2, 3, 4, 5, 6];
    handler = (req, res, url, n) => {
      openSse(res);
      const from = Number(url.searchParams.get("cursor") || 0);
      // Replay inclusively to prove the client also drops a duplicate.
      const events = ALL.filter((e) => e >= from);
      if (n === 1) {
        events.slice(0, 3).forEach((e) => writeSseEvent(res, "payment", payment(e), e));
        res.end(); // drop the connection mid-stream
        return;
      }
      events.forEach((e) => writeSseEvent(res, "payment", payment(e), e));
    };

    const received = [];
    const errors = [];
    const sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: (p) => received.push(p.cursor),
      onError: (e) => errors.push(e),
      initialDelayMs: 10,
      random: () => 0,
    });

    await waitFor(() => received.length >= 6);
    await sleep(30);
    sub.close();

    expect(received).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(requests).toHaveLength(2);
    expect(requests[1].cursor).toBe("3");
    expect(errors[0]).toBeInstanceOf(StreamError);
    expect(errors[0].code).toBe("STREAM_ENDED");
    expect(errors[0].willRetry).toBe(true);
  });

  it("starts from options.cursor when given", async () => {
    handler = (req, res) => openSse(res);
    const sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      cursor: "12345-1",
    });
    await waitFor(() => requests.length === 1);
    sub.close();
    expect(requests[0].cursor).toBe("12345-1");
  });

  it("backs off exponentially between retries and stops after maxRetries", async () => {
    handler = (req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { message: "unavailable" } }));
    };

    const errors = [];
    const sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      onError: (e) => errors.push(e),
      initialDelayMs: 40,
      maxDelayMs: 1000,
      maxRetries: 3,
      random: () => 0, // delays: 20, 40, 80 ms
    });

    await waitFor(() => errors.some((e) => e.code === "MAX_RETRIES_EXCEEDED"));
    await sleep(150);
    sub.close();

    expect(requests).toHaveLength(4); // initial + 3 retries
    const gaps = requests.slice(1).map((r, i) => r.at - requests[i].at);
    expect(gaps[0]).toBeGreaterThanOrEqual(15);
    expect(gaps[1]).toBeGreaterThanOrEqual(35);
    expect(gaps[2]).toBeGreaterThanOrEqual(75);
    expect(gaps[2]).toBeGreaterThan(gaps[0]);

    expect(errors.slice(0, 3).every((e) => e.willRetry && e.status === 503)).toBe(true);
    const last = errors[errors.length - 1];
    expect(last.code).toBe("MAX_RETRIES_EXCEEDED");
    expect(last.willRetry).toBe(false);
  });

  it("does not retry client errors such as 404", async () => {
    handler = (req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { message: "Account not found" } }));
    };
    const errors = [];
    new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      onError: (e) => errors.push(e),
      initialDelayMs: 10,
    });
    await waitFor(() => errors.length === 1);
    await sleep(60);
    expect(requests).toHaveLength(1);
    expect(errors[0].status).toBe(404);
    expect(errors[0].message).toBe("Account not found");
    expect(errors[0].willRetry).toBe(false);
  });

  it("forces a reconnect when no events arrive within heartbeatMs", async () => {
    handler = (req, res) => openSse(res); // then silence

    const errors = [];
    const opens = jest.fn();
    const sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      onError: (e) => errors.push(e),
      onOpen: opens,
      heartbeatMs: 80,
      initialDelayMs: 10,
      random: () => 0,
    });

    await waitFor(() => requests.length >= 2);
    sub.close();

    expect(errors[0].code).toBe("HEARTBEAT_TIMEOUT");
    expect(errors[0].willRetry).toBe(true);
    expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(75);
    expect(opens.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("treats server keep-alives as activity for the heartbeat", async () => {
    handler = (req, res) => {
      openSse(res);
      const timer = setInterval(() => res.write(": ping\n\n"), 20);
      req.on("close", () => clearInterval(timer));
    };

    const errors = [];
    const sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      onError: (e) => errors.push(e),
      heartbeatMs: 100,
    });

    await sleep(300);
    sub.close();

    expect(errors).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it("close() stops pending retries", async () => {
    handler = (req, res) => {
      res.writeHead(503);
      res.end();
    };

    let sub;
    const errors = [];
    sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      onError: (e) => {
        errors.push(e);
        sub.close();
      },
      initialDelayMs: 20,
    });

    await waitFor(() => errors.length === 1);
    await sleep(150);

    expect(requests).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("close() during a backoff wait cancels the reconnect", async () => {
    handler = (req, res) => {
      res.writeHead(503);
      res.end();
    };
    const errors = [];
    const sub = new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      onError: (e) => errors.push(e),
      initialDelayMs: 100,
      random: () => 0,
    });
    await waitFor(() => errors.length === 1);
    sub.close();
    sub.close(); // idempotent
    await sleep(200);
    expect(requests).toHaveLength(1);
  });

  it("aborting the signal closes the stream and stops retries", async () => {
    let serverRes;
    handler = (req, res) => {
      serverRes = res;
      openSse(res);
      writeSseEvent(res, "payment", payment(1), 1);
    };

    const controller = new AbortController();
    const received = [];
    const errors = [];
    new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: (p) => received.push(p.cursor),
      onError: (e) => errors.push(e),
      signal: controller.signal,
      initialDelayMs: 10,
    });

    await waitFor(() => received.length === 1);
    controller.abort();
    await sleep(20);
    if (!serverRes.writableEnded && !serverRes.destroyed) {
      writeSseEvent(serverRes, "payment", payment(2), 2);
    }
    await sleep(80);

    expect(received).toEqual(["1"]);
    expect(requests).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("never connects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    new StreamClient({ baseUrl }).payments(ACCOUNT, {
      onMessage: () => {},
      signal: controller.signal,
    });
    await sleep(50);
    expect(requests).toHaveLength(0);
  });
});

describe("client.stream.ledgers — WebSocket", () => {
  let wss;

  afterEach(async () => {
    if (wss) {
      wss.clients.forEach((c) => c.terminate());
      await new Promise((resolve) => wss.close(resolve));
      wss = null;
    }
  });

  function ledger(n) {
    return {
      sequence: n,
      closedAt: "2026-01-01T00:00:00Z",
      baseFee: 100,
      transactionCount: 1,
      cursor: String(n),
    };
  }

  it("streams ledgers and resumes from the last cursor after a drop", async () => {
    const connections = [];
    wss = new WebSocket.Server({ server, path: "/stream/ledgers" });
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url, "http://localhost");
      const cursor = url.searchParams.get("cursor");
      connections.push(cursor);
      if (connections.length === 1) {
        ws.send(JSON.stringify(ledger(1)));
        ws.send(JSON.stringify(ledger(2)));
        setTimeout(() => ws.terminate(), 20); // drop
      } else {
        // Replay inclusively to prove the client drops the duplicate.
        [2, 3, 4].filter((n) => n >= Number(cursor)).forEach((n) => ws.send(JSON.stringify(ledger(n))));
      }
    });

    const received = [];
    const opens = jest.fn();
    const sub = new StreamClient({ baseUrl, WebSocket }).ledgers({
      onMessage: (l) => received.push(l.sequence),
      onOpen: opens,
      initialDelayMs: 10,
      random: () => 0,
    });

    await waitFor(() => received.length >= 4);
    await sleep(30);
    sub.close();

    expect(received).toEqual([1, 2, 3, 4]);
    expect(connections).toEqual([null, "2"]);
    expect(opens).toHaveBeenCalledTimes(2);
  });

  it("close() closes the socket and stops reconnecting", async () => {
    let connections = 0;
    wss = new WebSocket.Server({ server, path: "/stream/ledgers" });
    wss.on("connection", (ws) => {
      connections++;
      ws.send(JSON.stringify(ledger(1)));
    });

    const received = [];
    const sub = new StreamClient({ baseUrl, WebSocket }).ledgers({
      onMessage: (l) => received.push(l.sequence),
      initialDelayMs: 10,
    });

    await waitFor(() => received.length === 1);
    sub.close();
    await sleep(100);

    expect(connections).toBe(1);
    expect(wss.clients.size).toBe(0);
  });
});
