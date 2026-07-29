# Streaming Guide

StellarKit API exposes two real-time streaming transports: **Server-Sent Events (SSE)** for account transactions, account payments, and live ledgers, and a **WebSocket** channel for live ledger updates. This guide explains how each transport works, what events you will receive, how to reconnect gracefully, and how to close streams cleanly.

---

## Table of Contents

1. [Choosing a Transport](#choosing-a-transport)
2. [SSE — `/stream/transactions/:id`](#sse--streamtransactionsid)
3. [SSE — `/stream/payments/:id`](#sse--streampaymentsid)
4. [SSE — `/stream/ledgers` (SSE)](#sse--streamledgers-sse)
5. [WebSocket — `/stream/ledgers`](#websocket--streamledgers)
6. [Reconnection Guidance](#reconnection-guidance)
7. [Clean Close Handling](#clean-close-handling)
8. [Error Reference](#error-reference)

---

## Choosing a Transport

| Endpoint | Transport | Best for |
|----------|-----------|----------|
| `GET /stream/transactions/:id` | SSE | Watching a specific account for new transactions |
| `GET /stream/payments/:id` | SSE | Watching a specific account for incoming/outgoing payments |
| `GET /stream/ledgers` | SSE or WebSocket | Live ledger heartbeat, dashboards, block explorers |

Both SSE and WebSocket deliver the same ledger payload on `/stream/ledgers`. Use **SSE** when you want a fire-and-forget stream that works through standard `fetch`/`EventSource` APIs and HTTP/2 multiplexing. Use **WebSocket** when your application already manages a WS connection, needs bidirectional messaging later, or runs in an environment where SSE is unsupported.

---

## SSE — `/stream/transactions/:id`

Streams new transactions for a Stellar account in real time, starting from the moment the connection is opened (historical transactions are not replayed).

### Connection

```
GET /stream/transactions/:id
```

**Path parameter:**

| Name | Type | Description |
|------|------|-------------|
| `id` | string | Stellar account public key (`G...`, 56 characters) |

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

### Events

| Event name | When emitted | Payload |
|------------|--------------|---------|
| `connected` | Immediately after the account is validated | `{ account, timestamp }` |
| `transaction` | Each time a new transaction is confirmed for the account | Normalised transaction object (see below) |
| `heartbeat` | Every 25 seconds to keep the connection alive through proxies | `{ timestamp }` |
| `error` | On a fatal stream error before the connection is closed | `{ code, message }` |

### Sample event payloads

**`connected`**
```
event: connected
data: {"account":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN","timestamp":"2026-07-28T10:00:00.000Z"}
```

**`transaction`**
```
event: transaction
data: {
  "id": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
  "hash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
  "ledger": 45123456,
  "createdAt": "2026-07-28T10:00:05.000Z",
  "sourceAccount": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "fee": {
    "charged": 100,
    "chargedInXLM": "0.0000100"
  },
  "operationCount": 1,
  "successful": true
}
```

**`heartbeat`**
```
event: heartbeat
data: {"timestamp":"2026-07-28T10:00:25.000Z"}
```

**`error`**
```
event: error
data: {"code":"STREAM_ERROR","message":"Transaction stream encountered an error"}
```

### Error codes

| Code | Description |
|------|-------------|
| `STREAM_ERROR` | The underlying Horizon stream emitted an error |
| `HORIZON_UNAVAILABLE` | Could not establish the Horizon stream during setup |

### Node.js example

```js
const EventSource = require("eventsource"); // npm install eventsource

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const url = `http://localhost:3000/stream/transactions/${ACCOUNT}`;

const es = new EventSource(url);

es.addEventListener("connected", (e) => {
  const { account, timestamp } = JSON.parse(e.data);
  console.log(`Stream opened for ${account} at ${timestamp}`);
});

es.addEventListener("transaction", (e) => {
  const tx = JSON.parse(e.data);
  console.log(`New transaction: ${tx.hash} (ledger ${tx.ledger})`);
});

es.addEventListener("heartbeat", (e) => {
  // Optionally log keep-alive ticks
});

es.addEventListener("error", (e) => {
  if (e.data) {
    const { code, message } = JSON.parse(e.data);
    console.error(`Stream error [${code}]: ${message}`);
  }
  es.close();
});

// Close when done
// es.close();
```

### Browser example

```html
<script>
const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const es = new EventSource(`/stream/transactions/${ACCOUNT}`);

es.addEventListener("connected", (e) => {
  const { account } = JSON.parse(e.data);
  console.log("Watching account:", account);
});

es.addEventListener("transaction", (e) => {
  const tx = JSON.parse(e.data);
  console.log("New tx:", tx.hash);
  // Update your UI here
});

es.addEventListener("heartbeat", () => {
  // Connection is alive — no action needed
});

es.addEventListener("error", (e) => {
  if (e.data) {
    console.error("Fatal stream error:", JSON.parse(e.data));
  }
  es.close();
});

// Clean up when the user navigates away
window.addEventListener("beforeunload", () => es.close());
</script>
```

---

## SSE — `/stream/payments/:id`

Streams incoming and outgoing payment events for a Stellar account. Only `payment` and `create_account` operation types are forwarded — all other operation types are filtered server-side.

### Connection

```
GET /stream/payments/:id
```

**Path parameter:**

| Name | Type | Description |
|------|------|-------------|
| `id` | string | Stellar account public key (`G...`, 56 characters) |

### Events

| Event name | When emitted | Payload |
|------------|--------------|---------|
| `payment` | Each time a qualifying payment operation is confirmed | `{ type, amount, asset, from, to, timestamp }` |
| `: ping` (comment) | Every 30 seconds | SSE keep-alive comment — no named event, no data |

The periodic `: ping` comment is an SSE comment line, not a named event. The `EventSource` API ignores it automatically; you do not need to handle it.

### Sample event payloads

**`payment` — incoming XLM**
```
event: payment
data: {
  "type": "payment",
  "amount": "10.0000000",
  "asset": {
    "code": "XLM",
    "issuer": null,
    "type": "native"
  },
  "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "timestamp": "2026-07-28T10:01:00.000Z"
}
```

**`payment` — incoming USDC**
```
event: payment
data: {
  "type": "payment",
  "amount": "25.0000000",
  "asset": {
    "code": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "type": "credit_alphanum4"
  },
  "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "timestamp": "2026-07-28T10:01:05.000Z"
}
```

**`payment` — account creation**
```
event: payment
data: {
  "type": "create_account",
  "amount": "1.0000000",
  "asset": {
    "code": "XLM",
    "issuer": null,
    "type": "native"
  },
  "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "timestamp": "2026-07-28T10:01:10.000Z"
}
```

### Asset shape

The `asset` field always uses the normalised object form:

| Field | Type | Notes |
|-------|------|-------|
| `code` | string | `"XLM"` for native; otherwise the asset code |
| `issuer` | string \| null | `null` for native XLM |
| `type` | string | `"native"`, `"credit_alphanum4"`, or `"credit_alphanum12"` |

### Node.js example

```js
const EventSource = require("eventsource");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const es = new EventSource(`http://localhost:3000/stream/payments/${ACCOUNT}`);

es.addEventListener("payment", (e) => {
  const { type, amount, asset, from, to, timestamp } = JSON.parse(e.data);
  console.log(`[${timestamp}] ${type}: ${amount} ${asset.code} from ${from} → ${to}`);
});

es.onerror = () => {
  console.error("Payment stream disconnected");
  es.close();
};

// Close when done
// es.close();
```

### Browser example

```html
<script>
const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const es = new EventSource(`/stream/payments/${ACCOUNT}`);

es.addEventListener("payment", (e) => {
  const p = JSON.parse(e.data);
  const label = p.type === "create_account" ? "Account created" : "Payment";
  console.log(`${label}: ${p.amount} ${p.asset.code} from ${p.from}`);
});

es.onerror = () => {
  console.warn("Payment stream lost. Will auto-reconnect...");
  // EventSource reconnects automatically — see Reconnection section
};

window.addEventListener("beforeunload", () => es.close());
</script>
```

---

## SSE — `/stream/ledgers` (SSE)

Streams live Stellar ledger closes. A new ledger closes approximately every 5 seconds. Each message carries ledger metadata — no named event type is set, so messages arrive on the default `message` event.

### Connection

```
GET /stream/ledgers
```

No path parameters or query parameters.

### Events

| Event name | When emitted | Payload |
|------------|--------------|---------|
| _(default `message`)_ | Each time a new ledger closes | `{ sequence, closedAt, baseFee, transactionCount, operationCount }` |
| `: keep-alive` (comment) | Every 15 seconds | SSE comment, no data — ignored by `EventSource` automatically |

### Sample event payload

```
data: {
  "sequence": 52430100,
  "closedAt": "2026-07-28T10:02:00.000Z",
  "baseFee": 100,
  "transactionCount": 14,
  "operationCount": 23
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sequence` | number | Ledger sequence number, monotonically increasing |
| `closedAt` | string | ISO 8601 UTC timestamp of ledger close |
| `baseFee` | number | Network base fee in stroops (1 XLM = 10,000,000 stroops) |
| `transactionCount` | number | Successful transactions in this ledger |
| `operationCount` | number | Total operations across all transactions |

### Node.js example

```js
const EventSource = require("eventsource");

const es = new EventSource("http://localhost:3000/stream/ledgers");

es.onmessage = (e) => {
  const ledger = JSON.parse(e.data);
  console.log(
    `Ledger #${ledger.sequence} closed at ${ledger.closedAt} ` +
    `| ${ledger.transactionCount} txs | base fee ${ledger.baseFee} stroops`
  );
};

es.onerror = () => {
  console.error("Ledger SSE stream disconnected");
  // EventSource reconnects automatically
};
```

### Browser example

```html
<script>
const es = new EventSource("/stream/ledgers");

es.onmessage = (e) => {
  const ledger = JSON.parse(e.data);
  document.getElementById("sequence").textContent = ledger.sequence;
  document.getElementById("closedAt").textContent = ledger.closedAt;
  document.getElementById("txCount").textContent = ledger.transactionCount;
};

es.onerror = () => {
  console.warn("Ledger stream interrupted. Reconnecting...");
};

window.addEventListener("beforeunload", () => es.close());
</script>
```

---

## WebSocket — `/stream/ledgers`

The same live ledger data is also available as a WebSocket stream. Messages are plain JSON text frames — no subprotocol is required.

### Connection

Upgrade an HTTP connection to WebSocket on the `/stream/ledgers` path:

```
ws://localhost:3000/stream/ledgers
wss://your-host.example.com/stream/ledgers   (TLS)
```

Connecting to any other WebSocket path will result in the socket being destroyed immediately.

### Message payload

Each message is a JSON text frame:

```json
{
  "sequence": 52430100,
  "closedAt": "2026-07-28T10:02:00.000Z",
  "baseFee": 100,
  "transactionCount": 14
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sequence` | number | Ledger sequence number |
| `closedAt` | string | ISO 8601 UTC close timestamp |
| `baseFee` | number | Network base fee in stroops |
| `transactionCount` | number | Successful transactions in this ledger |

> **Note:** The WebSocket payload omits `operationCount`. If you need that field, use the SSE `/stream/ledgers` endpoint instead.

### Connection lifecycle

1. Client sends an HTTP `Upgrade: websocket` request to `/stream/ledgers`.
2. Server upgrades the connection and begins forwarding live ledger events immediately.
3. Server sends JSON frames as ledgers close (~every 5 seconds).
4. Either party can close the connection at any time using a standard WebSocket close frame.
5. On client disconnect the server automatically cancels its Horizon subscription to avoid background resource leaks.

### Close codes

The server sends a close frame with code `1011` (Internal Error) if the Horizon stream subscription fails during setup. All other disconnects use standard close code `1000` (Normal Closure) or are initiated by the client.

### Node.js example

```js
const WebSocket = require("ws"); // npm install ws

const ws = new WebSocket("ws://localhost:3000/stream/ledgers");

ws.on("open", () => {
  console.log("WebSocket connected to /stream/ledgers");
});

ws.on("message", (data) => {
  const ledger = JSON.parse(data.toString());
  console.log(
    `Ledger #${ledger.sequence} | ` +
    `${ledger.transactionCount} txs | ` +
    `base fee ${ledger.baseFee} stroops`
  );
});

ws.on("close", (code, reason) => {
  console.log(`Connection closed — code ${code}: ${reason}`);
});

ws.on("error", (err) => {
  console.error("WebSocket error:", err.message);
});

// Clean close
// ws.close(1000, "Done");
```

### Browser example

```html
<script>
const ws = new WebSocket("wss://your-host.example.com/stream/ledgers");

ws.addEventListener("open", () => {
  console.log("Connected to ledger stream");
});

ws.addEventListener("message", (e) => {
  const ledger = JSON.parse(e.data);
  console.log(`Ledger #${ledger.sequence} closed: ${ledger.closedAt}`);
  // Update your UI
});

ws.addEventListener("close", (e) => {
  console.warn(`WebSocket closed (code ${e.code}). Scheduling reconnect...`);
  scheduleReconnect();
});

ws.addEventListener("error", () => {
  // "error" always fires before "close" for abnormal closures
  console.error("WebSocket connection error");
});

// Clean close on page unload
window.addEventListener("beforeunload", () => ws.close(1000, "page unload"));
</script>
```

---

## Reconnection Guidance

### SSE — automatic reconnection

The browser `EventSource` API reconnects automatically when the connection drops. It waits a short interval (typically 3 seconds, or the value from the `retry:` SSE field if set) and then opens a fresh connection.

You do not need to implement reconnection logic for `EventSource` — it is built in. You **do** need to handle reconnection yourself when using Node.js `eventsource` or a custom HTTP client.

**Node.js SSE reconnection example (transactions)**

```js
const EventSource = require("eventsource");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const BASE_URL = "http://localhost:3000";

let es;
let retryDelay = 1000;      // Start at 1 second
const MAX_DELAY = 30_000;   // Cap at 30 seconds

function connect() {
  es = new EventSource(`${BASE_URL}/stream/transactions/${ACCOUNT}`);

  es.addEventListener("connected", () => {
    retryDelay = 1000; // Reset backoff on successful connection
    console.log("Stream connected");
  });

  es.addEventListener("transaction", (e) => {
    const tx = JSON.parse(e.data);
    console.log("New tx:", tx.hash);
  });

  es.onerror = () => {
    es.close();
    console.warn(`Stream lost. Reconnecting in ${retryDelay}ms...`);
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY); // Exponential backoff
      connect();
    }, retryDelay);
  };
}

connect();
```

### WebSocket — manual reconnection

The WebSocket API does not reconnect automatically. You must handle the `close` event and schedule a new `WebSocket` constructor call.

**Node.js WebSocket reconnection example**

```js
const WebSocket = require("ws");

const WS_URL = "ws://localhost:3000/stream/ledgers";

let ws;
let retryDelay = 1000;
const MAX_DELAY = 30_000;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    retryDelay = 1000; // Reset on success
    console.log("WebSocket connected");
  });

  ws.on("message", (data) => {
    const ledger = JSON.parse(data.toString());
    console.log(`Ledger #${ledger.sequence}`);
  });

  ws.on("close", (code) => {
    // Don't reconnect on a deliberate client-side close (1000)
    if (code === 1000) {
      console.log("Closed cleanly. Not reconnecting.");
      return;
    }
    console.warn(`WS closed (code ${code}). Reconnecting in ${retryDelay}ms...`);
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
      connect();
    }, retryDelay);
  });

  ws.on("error", (err) => {
    console.error("WS error:", err.message);
    // "close" will fire after "error" — reconnect logic lives there
  });
}

connect();
```

**Browser WebSocket reconnection example**

```html
<script>
const WS_URL = "wss://your-host.example.com/stream/ledgers";

let ws;
let retryDelay = 1000;
const MAX_DELAY = 30_000;
let intentionalClose = false;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    retryDelay = 1000;
    console.log("Connected");
  });

  ws.addEventListener("message", (e) => {
    const ledger = JSON.parse(e.data);
    console.log(`Ledger #${ledger.sequence}`);
  });

  ws.addEventListener("close", (e) => {
    if (intentionalClose) return;
    console.warn(`Reconnecting in ${retryDelay}ms...`);
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
      connect();
    }, retryDelay);
  });

  ws.addEventListener("error", () => {
    // "close" fires next — reconnection is handled there
  });
}

function closeStream() {
  intentionalClose = true;
  ws.close(1000, "user action");
}

connect();
window.addEventListener("beforeunload", closeStream);
</script>
```

---

## Clean Close Handling

### SSE

Call `EventSource.close()` to terminate the connection. The browser will not attempt to reconnect after an explicit close.

```js
// Node.js
es.close();

// Browser
es.close();
```

The server detects the client disconnect via the `req.on("close")` event and immediately cancels the underlying Horizon subscription and any heartbeat intervals. No further data is sent and no resources are leaked on the server side.

### WebSocket

Call `ws.close(code, reason)` with close code `1000` to signal a normal closure. Pass a short reason string to help with server-side logging.

```js
// Node.js
ws.close(1000, "client shutting down");

// Browser
ws.close(1000, "user navigated away");
```

The server handles the `close` event on the socket, cancels its Horizon stream subscription, and logs the disconnection. The `isClosed` guard in the server prevents the cleanup function from running twice if both `close` and `error` fire for the same disconnection event.

---

## Error Reference

### Pre-stream HTTP errors (SSE endpoints)

Before SSE headers are sent, the server returns standard HTTP JSON errors if validation fails. These are not SSE events — they are plain HTTP responses.

| Status | Error type | Cause |
|--------|------------|-------|
| `400` | `ValidationError` | `id` is not a valid `G...` Stellar public key |
| `404` | `NotFound` | No account exists on the network for that public key |

```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Invalid Stellar account ID",
    "detail": "Must be a valid G... address"
  }
}
```

### In-stream SSE error events

Once SSE headers have been sent, errors are delivered as `error` events rather than HTTP status codes.

| Code | Cause |
|------|-------|
| `STREAM_ERROR` | Horizon stream emitted an error mid-connection |
| `HORIZON_UNAVAILABLE` | Failed to set up the Horizon stream during connection |

### WebSocket close code `1011`

The server sends close code `1011` (Internal Error) when it cannot subscribe to the Horizon ledger stream. Implement a reconnect with backoff when you receive this code.

---

## Related Documentation

- [Getting Started Guide](getting-started.md) — Initial setup and environment variables
- [Response Format Guide](response-format.md) — Normalised response shapes used across the API
- [Rate Limiting](rate-limiting.md) — Request limits and retry strategies
- [Error Reference](error-reference.md) — Full error type catalogue
