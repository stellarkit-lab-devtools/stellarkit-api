# Real-Time Guide

How to build live Stellar applications — payment feeds, balance monitors, DEX tickers — with StellarKit API by combining streaming endpoints, REST calls and polling.

This guide is about **composing** the pieces. For the full reference of each stream (headers, every event, close codes), see the [Streaming Guide](streaming.md).

---

## Table of Contents

1. [Building Blocks](#building-blocks)
2. [SSE Payment Stream](#sse-payment-stream)
3. [WebSocket Ledger Stream](#websocket-ledger-stream)
4. [Polling Non-Streaming Endpoints](#polling-non-streaming-endpoints)
5. [Combining Streams with REST Calls](#combining-streams-with-rest-calls)
6. [Handling Network Interruptions](#handling-network-interruptions)
7. [Complete Example: Real-Time Balance Monitor](#complete-example-real-time-balance-monitor)
8. [Related Documentation](#related-documentation)

---

## Building Blocks

| Need | Use | Transport |
|------|-----|-----------|
| React to payments to/from an account | `GET /stream/payments/:id` | SSE |
| React to any transaction on an account | `GET /stream/transactions/:id` | SSE |
| A heartbeat that fires every time a ledger closes (~5 s) | `/stream/ledgers` | WebSocket or SSE |
| Current state (balances, offers, positions) | `GET /account/:id/balances`, `/offers`, `/pool-positions`, … | REST |
| Data with no stream (DEX spread, fee stats, network status) | `GET /dex/...`, `/fee-estimate`, `/network-status` | REST + polling |

The pattern behind almost every real-time app is the same:

1. **Seed** state from a REST endpoint.
2. **Subscribe** to a stream for changes.
3. **Reconcile** periodically (or after a reconnect) by re-reading the REST endpoint, because streams can drop events while disconnected.

---

## SSE Payment Stream

`GET /stream/payments/:id` emits a `payment` event every time a payment, path payment or `create_account` operation involving the account is confirmed. Payload:

```json
{
  "type": "payment",
  "amount": "10.0000000",
  "asset": { "code": "XLM", "issuer": null, "type": "native" },
  "from": "GBBD...",
  "to": "GAAZ...",
  "timestamp": "2026-07-28T10:01:00.000Z"
}
```

```js
const EventSource = require("eventsource"); // npm install eventsource

const es = new EventSource(`http://localhost:3000/stream/payments/${ACCOUNT}`);

es.addEventListener("payment", (e) => {
  const p = JSON.parse(e.data);
  const direction = p.to === ACCOUNT ? "in" : "out";
  console.log(`${direction} ${p.amount} ${p.asset.code}`);
});
```

Things to keep in mind:

- The stream starts **now** — historical payments are not replayed. Seed history with `GET /account/:id/payments` first.
- Amounts are seven-decimal strings. Do arithmetic in stroops (integers) or with a decimal library, not with floats, if you need exact totals.
- A payment event tells you something changed; it does not include fees or the resulting balance. Treat it as a trigger to update or re-fetch state.

---

## WebSocket Ledger Stream

`ws://<host>/stream/ledgers` sends one JSON frame per closed ledger:

```json
{ "sequence": 52430100, "closedAt": "2026-07-28T10:02:00.000Z", "baseFee": 100, "transactionCount": 14 }
```

```js
const WebSocket = require("ws"); // npm install ws

const ws = new WebSocket("ws://localhost:3000/stream/ledgers");

ws.on("message", (raw) => {
  const ledger = JSON.parse(raw);
  console.log(`ledger ${ledger.sequence} closed at ${ledger.closedAt}`);
});
```

The ledger stream is the best clock for a Stellar app. Instead of polling on a fixed timer, use each ledger close as the signal to refresh data that can only change when a ledger closes — balances, order books, pool reserves. This avoids polling between ledgers when nothing could have changed.

---

## Polling Non-Streaming Endpoints

Most endpoints have no stream. Poll them, but poll politely:

- **Match the interval to how fast the data changes.** Ledgers close roughly every 5 seconds, so polling account or DEX data faster than that only returns the same answer. Check [Caching Strategy](caching-strategy.md) — polling faster than an endpoint's cache TTL just returns the cached response (`X-Cache: HIT`).
- **Prefer ledger-driven polling** (refresh on each `/stream/ledgers` frame) over fixed timers when you already have the ledger stream open.
- **Never overlap requests.** Schedule the next poll after the previous one finishes (`setTimeout` chain), not with `setInterval`, so a slow response does not stack up requests.
- **Use conditional requests.** Most GET endpoints return an `ETag`. Send it back as `If-None-Match`; an unchanged response comes back as `304 Not Modified` with no body.
- **Respect rate limits.** On `429`, wait for the `Retry-After` header before trying again. See [Rate Limiting](rate-limiting.md).
- **Use `?fresh=true` sparingly.** It bypasses the cache and goes to Horizon. Use it once after you know something changed (e.g. right after a payment event), not on every poll.
- **Don't cache volatile endpoints yourself.** `GET /account/:id/pending-effects` is sent with `Cache-Control: no-store` because pending state changes every few seconds.

A minimal polite poller:

```js
function poll(fn, intervalMs, signal) {
  let timer;
  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      console.error("poll failed:", err.message);
    }
    if (!signal.aborted) timer = setTimeout(tick, intervalMs);
  };
  signal.addEventListener("abort", () => clearTimeout(timer));
  tick();
}

const controller = new AbortController();
poll(async () => {
  const res = await fetch("http://localhost:3000/dex/spread?...");
  const body = await res.json();
  render(body.data);
}, 5000, controller.signal);

// later: controller.abort();
```

---

## Combining Streams with REST Calls

Streams tell you **that** something happened; REST tells you **what the state is now**. Combine them like this:

| Event | REST follow-up |
|-------|----------------|
| `payment` on `/stream/payments/:id` | `GET /account/:id/balances` to get the exact new balance |
| `transaction` on `/stream/transactions/:id` | `GET /account/:id/operations` for operation detail |
| New ledger on `/stream/ledgers` | `GET /account/:id/offers` or a DEX endpoint to refresh order-book state |
| Account submitted a transaction | `GET /account/:id/pending-effects` until `count` is `0` |

Rules that keep this correct:

1. **Open the stream before the seed request**, buffer events until the seed response arrives, then apply only events newer than the seed. Otherwise an event that lands between the seed and the subscription is lost.
2. **Make updates idempotent.** Re-fetching balances after a payment is naturally idempotent; incrementing a local counter is not. If you apply deltas, de-duplicate events (for example by `timestamp` + `from` + `to` + `amount`).
3. **Debounce re-fetches.** A burst of ten payments in one ledger should cause one balance fetch, not ten.

---

## Handling Network Interruptions

Connections will drop — laptops sleep, proxies time out, deploys restart the server.

**SSE.** `EventSource` reconnects automatically. Two things are still your job:

- Events emitted while disconnected are **not** replayed. After a reconnect (`open` fires again), re-seed from REST.
- On a fatal `error` event (`STREAM_ERROR`, `HORIZON_UNAVAILABLE`), close the stream and reconnect yourself with backoff.

**WebSocket.** There is no automatic reconnect. Reconnect on `close` with exponential backoff and jitter:

```js
function backoffDelay(attempt) {
  const base = Math.min(30000, 1000 * 2 ** attempt); // 1s, 2s, 4s … capped at 30s
  return base / 2 + Math.random() * (base / 2);      // jitter avoids thundering herds
}
```

Reset the attempt counter once a connection has been healthy for a while (or on the first message).

**Detecting stale data.** A stream can stay "open" while nothing arrives. Track the time of the last ledger frame; if no ledger has arrived for 30 seconds (about six ledgers), treat the connection as dead, close it and reconnect. Show users a "reconnecting…" or "last updated N seconds ago" indicator instead of silently showing stale numbers.

**Shutdown.** Always close streams on exit (`es.close()`, `ws.close(1000)`) so the server can release its Horizon subscription.

---

## Complete Example: Real-Time Balance Monitor

A Node.js script that keeps an account's balances live:

- seeds balances from `GET /account/:id/balances`,
- re-fetches (debounced) whenever `/stream/payments/:id` reports a payment,
- reconciles on every 12th ledger from the `/stream/ledgers` WebSocket to catch anything missed (fees, trades, claimable balances),
- reconnects both streams with backoff and re-seeds after every reconnect,
- detects a stalled ledger stream and shuts down cleanly on Ctrl+C.

Requires Node.js 18+ (for global `fetch`).

```bash
npm install eventsource ws
STELLARKIT_URL=http://localhost:3000 node balance-monitor.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

```js
// balance-monitor.js
const EventSource = require("eventsource");
const WebSocket = require("ws");

const BASE_URL = process.env.STELLARKIT_URL || "http://localhost:3000";
const ACCOUNT = process.argv[2];
const RECONCILE_EVERY_N_LEDGERS = 12; // ~1 minute
const STALE_LEDGER_MS = 30000;
const REFRESH_DEBOUNCE_MS = 500;

if (!ACCOUNT) {
  console.error("Usage: node balance-monitor.js <ACCOUNT_ID>");
  process.exit(1);
}

let balances = null;
let es = null;
let ws = null;
let shuttingDown = false;
let refreshTimer = null;
let ledgersSinceReconcile = 0;
let lastLedgerAt = Date.now();

// ── Helpers ───────────────────────────────────────────────────────────────

function backoffDelay(attempt) {
  const base = Math.min(30000, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

function assetKey(asset) {
  return asset.issuer ? `${asset.code}:${asset.issuer}` : asset.code;
}

function toBalanceMap(data) {
  const map = new Map([["XLM", data.xlm.balance]]);
  for (const entry of data.assets) map.set(assetKey(entry.asset), entry.balance);
  return map;
}

function printChanges(prev, next) {
  for (const [key, value] of next) {
    const before = prev ? prev.get(key) : undefined;
    if (before !== value) {
      console.log(`[${new Date().toISOString()}] ${key}: ${before ?? "—"} → ${value}`);
    }
  }
  if (prev) {
    for (const key of prev.keys()) {
      if (!next.has(key)) console.log(`[${new Date().toISOString()}] ${key}: removed`);
    }
  }
}

// ── REST: seed / reconcile ────────────────────────────────────────────────

async function fetchBalances() {
  const url = `${BASE_URL}/account/${ACCOUNT}/balances`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 404) throw new Error(`Account ${ACCOUNT} not found`);
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : backoffDelay(attempt);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    const body = await res.json();
    if (!body.success) throw new Error(body.error?.message || "Request failed");
    return toBalanceMap(body.data);
  }
}

async function refresh(reason) {
  try {
    const next = await fetchBalances();
    printChanges(balances, next);
    balances = next;
  } catch (err) {
    console.error(`refresh (${reason}) failed:`, err.message);
  }
}

// Collapse a burst of payment events into one balance fetch.
function scheduleRefresh(reason) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(reason), REFRESH_DEBOUNCE_MS);
}

// ── SSE: payments ─────────────────────────────────────────────────────────

function connectPayments(attempt = 0) {
  if (shuttingDown) return;
  es = new EventSource(`${BASE_URL}/stream/payments/${ACCOUNT}`);

  es.onopen = () => {
    attempt = 0;
    // Events may have been missed while disconnected — re-seed.
    refresh("payments stream (re)connected");
  };

  es.addEventListener("payment", (e) => {
    const p = JSON.parse(e.data);
    const direction = p.to === ACCOUNT ? "received" : "sent";
    console.log(`payment ${direction}: ${p.amount} ${p.asset.code}`);
    scheduleRefresh("payment");
  });

  // Fatal server-side stream error: close and reconnect with backoff.
  es.addEventListener("error", (e) => {
    if (!e.data) return; // transport error — EventSource reconnects on its own
    console.error("payment stream error:", e.data);
    es.close();
    setTimeout(() => connectPayments(attempt + 1), backoffDelay(attempt));
  });
}

// ── WebSocket: ledgers ────────────────────────────────────────────────────

function connectLedgers(attempt = 0) {
  if (shuttingDown) return;
  ws = new WebSocket(`${BASE_URL.replace(/^http/, "ws")}/stream/ledgers`);

  ws.on("open", () => {
    lastLedgerAt = Date.now();
  });

  ws.on("message", (raw) => {
    attempt = 0;
    lastLedgerAt = Date.now();
    const ledger = JSON.parse(raw);
    ledgersSinceReconcile++;
    if (ledgersSinceReconcile >= RECONCILE_EVERY_N_LEDGERS) {
      ledgersSinceReconcile = 0;
      refresh(`reconcile at ledger ${ledger.sequence}`);
    }
  });

  ws.on("close", () => {
    if (shuttingDown) return;
    const delay = backoffDelay(attempt);
    console.warn(`ledger stream closed, reconnecting in ${Math.round(delay)}ms`);
    setTimeout(() => {
      connectLedgers(attempt + 1);
      refresh("ledger stream reconnected");
    }, delay);
  });

  ws.on("error", (err) => {
    console.error("ledger stream error:", err.message);
    // 'close' follows 'error', which triggers the reconnect.
  });
}

// Treat a silent ledger stream as dead.
const staleCheck = setInterval(() => {
  if (Date.now() - lastLedgerAt > STALE_LEDGER_MS && ws) {
    console.warn("no ledger for 30s — forcing reconnect");
    lastLedgerAt = Date.now();
    ws.terminate(); // emits 'close' → reconnect
  }
}, 5000);

// ── Lifecycle ─────────────────────────────────────────────────────────────

async function main() {
  balances = await fetchBalances();
  printChanges(null, balances);
  connectPayments();
  connectLedgers();
}

function shutdown() {
  shuttingDown = true;
  clearInterval(staleCheck);
  clearTimeout(refreshTimer);
  if (es) es.close();
  if (ws) ws.close(1000);
  console.log("balance monitor stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

Why it is built this way:

- **Balances always come from REST.** Payment events only trigger a re-fetch, so fees, trades and other balance changes that do not appear on the payment stream are still picked up, and duplicate events cannot corrupt the totals.
- **Debounced re-fetches.** A burst of payments in one ledger causes a single balance request, which keeps the monitor well inside rate limits.
- **Re-seed after every reconnect.** Neither stream replays missed events, so the REST call closes the gap.

---

## Related Documentation

- [Streaming Guide](streaming.md) — full reference for every SSE and WebSocket endpoint
- [Account Endpoints Guide](account-endpoints.md) — balances, payments, pending effects and more
- [Caching Strategy](caching-strategy.md) — per-endpoint TTLs and `?fresh=true`
- [Rate Limiting](rate-limiting.md) — limits, headers and retry strategies
