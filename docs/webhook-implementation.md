# Webhook Receiver Implementation Guide

This guide walks through building the **receiving end** of a StellarKit webhook in Node.js and Express: accepting the delivery, verifying its HMAC signature, acknowledging it at the right moment so StellarKit doesn't retry it, de-duplicating repeat deliveries, and handling errors. It ends with a complete receiver you can copy and run.

Related guides:

- [Webhooks Guide](webhooks.md): registering webhooks, events, and payload shapes
- [Webhook Events Reference](webhook-events.md): every field of every event
- [Webhook Security Guide](webhook-security.md): signature scheme details, secret storage, and rotation

---

## Table of Contents

1. [How a delivery reaches you](#how-a-delivery-reaches-you)
2. [Express receiver setup](#express-receiver-setup)
3. [HMAC signature verification](#hmac-signature-verification)
4. [Responding with 200 at the right time](#responding-with-200-at-the-right-time)
5. [Idempotency for duplicate deliveries](#idempotency-for-duplicate-deliveries)
6. [Error handling](#error-handling)
7. [Complete working example](#complete-working-example)
8. [Testing your receiver locally](#testing-your-receiver-locally)
9. [Production checklist](#production-checklist)

---

## How a delivery reaches you

StellarKit sends every event as an HTTP `POST` with a JSON body:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `StellarKit-Webhook/1.0` |
| `X-Webhook-Event` | The event type, e.g. `payment.received` (`batch` for batched deliveries) |
| `X-Webhook-Signature` | `hex(HMAC-SHA256(raw_body, WEBHOOK_SECRET))` |

Delivery rules that shape how you write the receiver ([src/services/webhookDelivery.js](../src/services/webhookDelivery.js)):

| Rule | Value |
| --- | --- |
| Success | Any `2xx` response |
| Failure | Network error, timeout, or any non-`2xx` status, **including `4xx`** |
| Per-attempt timeout | 30 seconds |
| Attempts | 4 in total: the first try plus 3 retries |
| Backoff | 5 s, then 25 s, then 125 s |
| Batching | Events for the same webhook fired within 500 ms are sent together as `{ "event": "batch", "events": [ ... ] }` |

A retry re-sends **exactly the same payload**. If your server handled the event but the response never reached StellarKit (for example, a timeout or a dropped connection), the same event arrives again. Your receiver has to be idempotent.

---

## Express receiver setup

The one rule that catches most people out: **the signature is computed over the raw bytes**, so the webhook route must get the body as a `Buffer`, not as a parsed object.

```javascript
const express = require("express");
const app = express();

// Mount the webhook route BEFORE any global express.json(). Once a JSON
// parser has consumed the stream, the original bytes are gone.
app.post(
  "/webhooks/stellarkit",
  express.raw({ type: "application/json", limit: "1mb" }),
  handleStellarKitWebhook,
);

// The rest of your API can use the normal JSON parser.
app.use(express.json());
```

If you must keep a global `express.json()`, use its `verify` hook to save the raw buffer instead:

```javascript
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
```

Either way, verify the signature against the raw buffer and never against `JSON.stringify(req.body)`. Re-serialising can change whitespace or key order and break the comparison.

---

## HMAC signature verification

Compute the HMAC of the raw body with your secret and compare it to the header **in constant time**:

```javascript
const crypto = require("crypto");

/**
 * @param {Buffer} rawBody
 * @param {string|undefined} signatureHeader - hex digest from X-Webhook-Signature
 * @param {string[]} secrets - current secret first, plus the previous one during rotation
 * @returns {boolean}
 */
function isValidSignature(rawBody, signatureHeader, secrets) {
  if (typeof signatureHeader !== "string" || !/^[0-9a-f]{64}$/i.test(signatureHeader)) {
    return false;
  }
  const provided = Buffer.from(signatureHeader, "hex");

  return secrets.some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
    return crypto.timingSafeEqual(provided, expected);
  });
}
```

Why it is written this way:

- **Format check first.** `timingSafeEqual` throws if the buffers differ in length. Requiring exactly 64 hex characters means both sides are always 32 bytes.
- **Compare decoded bytes.** Comparing the 32-byte digests avoids differences in hex letter case.
- **Accept several secrets.** During a [dual-secret rotation](webhook-security.md#dual-secret-rotation) you accept the old and new secrets until the switch is complete.
- **Verify before parsing.** Don't call `JSON.parse` on a body you haven't authenticated.

On failure, return `401` and do nothing else. StellarKit counts the `401` as a failed attempt and retries, so a misconfigured secret shows up in your logs four times over about 2.5 minutes. That's useful: you get an alert and a short window to fix the secret.

---

## Responding with 200 at the right time

StellarKit waits up to 30 seconds and treats anything other than `2xx` as a failure. The correct moment to return `200` is:

> **After** you have verified the signature and **durably recorded** the event (or confirmed it is a duplicate), and **before** you do the slow business work.

| Respond with `200` too early (before you record the event) | Respond with `200` too late (after all the work) |
| --- | --- |
| If your process crashes after replying, the event is lost. StellarKit thinks it was delivered and won't retry. | Slow downstream calls push you toward the 30 s timeout. StellarKit retries while your first attempt is still running, which causes concurrent duplicates. |

The pattern:

```text
receive → verify signature → parse → claim idempotency key → enqueue → 200
                                                                   ↓
                                               background worker processes the event
```

What to return in each case:

| Situation | Status | StellarKit behaviour |
| --- | --- | --- |
| Event accepted and queued | `200` | Done |
| Duplicate of an event already accepted | `200` | Done (the retry stops) |
| Event type you don't handle | `200` | Done (no retries for events you will never process) |
| Signature missing or invalid | `401` | Retries, then gives up |
| Body is not valid JSON | `400` | Retries, then gives up |
| Your storage or queue is down | `503` | Retries with backoff, which is what you want |

Never return `5xx` for an event you have already recorded. That just triggers a retry you will discard.

---

## Idempotency for duplicate deliveries

Build the idempotency key from the **webhook ID**, the **event type**, and the **event timestamp**, plus a digest of the event body to separate two events that share a timestamp:

```javascript
function idempotencyKey(webhookId, event) {
  // payment.received and trustline.changed carry an ISO `timestamp`;
  // contract.event carries a `ledger` sequence instead.
  const eventTime = event.timestamp ?? `ledger:${event.ledger ?? "unknown"}`;
  const digest = crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
  return `${webhookId}:${event.event}:${eventTime}:${digest}`;
}
```

- **`webhookId`** scopes the key to one registration. If two webhooks deliver the same ledger event to your service, both are processed, once each. `POST /webhooks` returns the `webhookId` at registration. Save it in your config and give each registration its own callback path (for example `/webhooks/stellarkit/payments`) so the receiver can map path → `webhookId`.
- **Event type plus `timestamp`** identify the event. A retry re-sends the identical payload, so the timestamp and digest match exactly.
- **Digest.** It's cheap, and it ensures that two different events created in the same millisecond never collide.

### Claim, then process

Use an atomic "insert if absent" so two concurrent deliveries can't both pass the check:

| Store | Atomic claim |
| --- | --- |
| Redis | `SET key 1 NX EX 86400` |
| PostgreSQL | `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` |
| In-memory `Map` | Fine for one process or local development only |

Keep keys for **at least as long as your timestamp tolerance window** (see below). 24 hours is a safe default: StellarKit's whole retry cycle finishes in about 2.5 minutes.

### Use the timestamp to reject stale replays

Signature checks prove the body came from StellarKit, but they don't stop someone from replaying a captured request later. Reject events whose `timestamp` is older than your tolerance window:

```javascript
const MAX_EVENT_AGE_MS = 60 * 60 * 1000; // 1 hour; must be <= the idempotency key TTL

function isStale(event, now = Date.now()) {
  if (!event.timestamp) return false; // contract.event has no wall-clock timestamp
  const time = Date.parse(event.timestamp);
  return Number.isFinite(time) && now - time > MAX_EVENT_AGE_MS;
}
```

Return `200` for stale events. They're authentic, and retrying them won't make them fresh.

### Batched deliveries

When several events fire within 500 ms, they arrive as one request:

```json
{ "event": "batch", "events": [ { "event": "payment.received", "...": "..." }, { "...": "..." } ] }
```

The signature covers the whole batch body. De-duplicate **each inner event** on its own key, because a retried batch can overlap with events you have already processed.

---

## Error handling

| Failure | Handling |
| --- | --- |
| Body larger than your limit | `express.raw({ limit })` raises `entity.too.large`. Return `413`. |
| Malformed JSON | Return `400` after the signature check (an attacker without the secret never reaches `JSON.parse`). |
| Idempotency store unavailable | Return `503` so StellarKit retries. Don't guess. |
| Queue push fails after the claim | **Release the claim**, then return `503`. Otherwise the retry is treated as a duplicate and the event is lost. |
| Business logic fails in the worker | StellarKit already got its `200`, so retries are now your job. Retry in the worker with backoff, and park events that keep failing in a dead-letter table for inspection. |
| Unexpected exception | An Express error handler logs it and returns `500` without leaking stack traces. |

Log the idempotency key, event type, and outcome for every delivery, but **never log the secret or the signature header**.

---

## Complete working example

The receiver below needs only Node.js 18+ and Express. It covers everything in this guide: raw-body capture, constant-time HMAC verification with rotation support, per-path webhook IDs, batch handling, atomic idempotency claims, stale-event rejection, fast `200` responses, background processing with retries, and error handling.

The idempotency store and queue are in-memory so the file runs as is. Each is behind a small async interface, so you can swap in Redis or PostgreSQL without touching the request handler.

```javascript
// webhook-receiver.js
"use strict";

const crypto = require("crypto");
const express = require("express");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 4000;

// Current secret first; set WEBHOOK_SECRET_PREV only during a rotation window.
const SECRETS = [process.env.WEBHOOK_SECRET, process.env.WEBHOOK_SECRET_PREV].filter(Boolean);
if (SECRETS.length === 0) {
  console.error("WEBHOOK_SECRET is required");
  process.exit(1);
}

// Map each callback path to the webhookId returned by POST /webhooks.
// Registering one URL per webhook makes the ID available without trusting the body.
const WEBHOOK_IDS = {
  payments: process.env.STELLARKIT_PAYMENTS_WEBHOOK_ID || "wh_payments_local",
  trustlines: process.env.STELLARKIT_TRUSTLINES_WEBHOOK_ID || "wh_trustlines_local",
};

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EVENT_AGE_MS = 60 * 60 * 1000; // must not exceed IDEMPOTENCY_TTL_MS
const WORKER_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Idempotency store: swap for Redis `SET NX EX` or a unique DB column
// ---------------------------------------------------------------------------

class InMemoryIdempotencyStore {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map(); // key -> expiresAt
    setInterval(() => this.sweep(), 60_000).unref();
  }

  /** Atomically claims a key. Resolves true if this caller is first. */
  async claim(key) {
    const now = Date.now();
    const expiresAt = this.entries.get(key);
    if (expiresAt && expiresAt > now) return false;
    this.entries.set(key, now + this.ttlMs);
    return true;
  }

  /** Releases a claim so a retried delivery can be accepted again. */
  async release(key) {
    this.entries.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Job queue: swap for BullMQ, SQS, a jobs table, etc.
// ---------------------------------------------------------------------------

class InMemoryQueue {
  constructor(handler) {
    this.handler = handler;
  }

  async push(job) {
    // Run on a later tick so the HTTP response is never blocked by processing.
    setImmediate(() => this.run(job, 1));
  }

  async run(job, attempt) {
    try {
      await this.handler(job);
    } catch (err) {
      if (attempt >= WORKER_MAX_ATTEMPTS) {
        console.error("[dead-letter]", job.key, err.message);
        return;
      }
      const delayMs = 1000 * 2 ** attempt;
      console.warn(`[retry] ${job.key} attempt ${attempt} failed: ${err.message}; retrying in ${delayMs}ms`);
      setTimeout(() => this.run(job, attempt + 1), delayMs).unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Business logic: runs in the background, after StellarKit got its 200
// ---------------------------------------------------------------------------

const eventHandlers = {
  async "payment.received"(event) {
    const { payment } = event;
    console.log(
      `[payment] ${payment.amount} ${payment.asset.code} from ${payment.from} to ${payment.to}`,
    );
    // e.g. credit the user's balance in your database
  },

  async "trustline.changed"(event) {
    console.log(`[trustline] ${event.accountId} ${event.changeType} ${event.trustline.asset.code}`);
  },

  async "contract.event"(event) {
    console.log(`[contract] ${event.contractId} ${event.eventType} @ ledger ${event.ledger}`);
  },
};

async function processJob({ event }) {
  await eventHandlers[event.event](event);
}

// ---------------------------------------------------------------------------
// Delivery helpers
// ---------------------------------------------------------------------------

function isValidSignature(rawBody, signatureHeader, secrets) {
  if (typeof signatureHeader !== "string" || !/^[0-9a-f]{64}$/i.test(signatureHeader)) {
    return false;
  }
  const provided = Buffer.from(signatureHeader, "hex");
  return secrets.some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
    return crypto.timingSafeEqual(provided, expected);
  });
}

function idempotencyKey(webhookId, event) {
  const eventTime = event.timestamp ?? `ledger:${event.ledger ?? "unknown"}`;
  const digest = crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
  return `${webhookId}:${event.event}:${eventTime}:${digest}`;
}

function isStale(event, now = Date.now()) {
  if (!event.timestamp) return false;
  const time = Date.parse(event.timestamp);
  return Number.isFinite(time) && now - time > MAX_EVENT_AGE_MS;
}

/** Flattens a delivery into individual events (batches carry an `events` array). */
function unpackEvents(body) {
  if (body && body.event === "batch" && Array.isArray(body.events)) return body.events;
  return [body];
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

const store = new InMemoryIdempotencyStore(IDEMPOTENCY_TTL_MS);
const queue = new InMemoryQueue(processJob);
const app = express();

app.post(
  "/webhooks/stellarkit/:target",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res, next) => {
    try {
      const webhookId = WEBHOOK_IDS[req.params.target];
      if (!webhookId) return res.status(404).json({ error: "Unknown webhook target" });

      // 1. Authenticate the raw bytes before trusting anything in them.
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!isValidSignature(rawBody, req.get("x-webhook-signature"), SECRETS)) {
        console.warn(`[reject] invalid signature for ${webhookId} from ${req.ip}`);
        return res.status(401).json({ error: "Invalid signature" });
      }

      // 2. Parse only after the signature is valid.
      let body;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Body is not valid JSON" });
      }

      // 3. Claim and enqueue every event. Duplicates and unsupported or stale
      //    events are acknowledged so StellarKit stops retrying them.
      const results = [];
      for (const event of unpackEvents(body)) {
        if (!event || typeof event.event !== "string") {
          results.push({ status: "ignored", reason: "missing event type" });
          continue;
        }
        if (!eventHandlers[event.event]) {
          results.push({ event: event.event, status: "ignored", reason: "unsupported event" });
          continue;
        }
        if (isStale(event)) {
          results.push({ event: event.event, status: "ignored", reason: "stale" });
          continue;
        }

        const key = idempotencyKey(webhookId, event);
        if (!(await store.claim(key))) {
          results.push({ event: event.event, status: "duplicate" });
          continue;
        }

        try {
          await queue.push({ key, webhookId, event });
        } catch (err) {
          // Without this release, StellarKit's retry would look like a
          // duplicate and the event would be silently dropped.
          await store.release(key);
          throw Object.assign(err, { status: 503 });
        }
        results.push({ event: event.event, status: "accepted" });
      }

      // 4. Acknowledge quickly; processing continues in the background.
      return res.status(200).json({ received: true, results });
    } catch (err) {
      return next(err);
    }
  },
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  const status = err.status && err.status >= 400 ? err.status : 500;
  console.error(`[error] ${req.method} ${req.path}: ${err.message}`);
  return res.status(status).json({
    error: status === 503 ? "Temporarily unavailable, retry later" : "Internal error",
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StellarKit webhook receiver listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, isValidSignature, idempotencyKey, unpackEvents };
```

Run it:

```bash
npm install express
WEBHOOK_SECRET="replace-me-with-a-long-random-string" node webhook-receiver.js
```

Then register it with StellarKit, pointing each webhook at its own path, and copy the returned `webhookId` values into `STELLARKIT_PAYMENTS_WEBHOOK_ID` and `STELLARKIT_TRUSTLINES_WEBHOOK_ID`. See [Registration](webhooks.md#registration).

---

## Testing your receiver locally

Sign a sample payload exactly as StellarKit does and post it:

```bash
export WEBHOOK_SECRET="replace-me-with-a-long-random-string"
BODY='{"event":"payment.received","accountId":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN","payment":{"type":"payment","amount":"100.0000000","asset":{"code":"XLM","issuer":null,"type":"native"},"from":"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5","to":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN","timestamp":"2026-10-19T12:00:00Z"},"timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -sS -X POST http://localhost:4000/webhooks/stellarkit/payments \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: payment.received" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

What to expect:

1. The first request returns `200` with `"status": "accepted"`, and the worker logs the payment.
2. Sending the **same command again** returns `200` with `"status": "duplicate"`, and nothing is processed.
3. Changing one character of `BODY` without re-signing returns `401`.

---

## Production checklist

- [ ] The webhook route reads the raw body (`express.raw` or a `verify` hook).
- [ ] Signatures are compared with `crypto.timingSafeEqual` after a length/format check.
- [ ] Both current and previous secrets are accepted during rotation, and secrets come from env or a secrets manager.
- [ ] The response is sent within a few seconds, after the event is durably recorded and before heavy work.
- [ ] Idempotency keys combine `webhookId`, event type, and event timestamp, and are claimed atomically (Redis `NX`, a unique DB constraint).
- [ ] Idempotency TTL ≥ stale-event window ≥ StellarKit's retry cycle (~2.5 minutes).
- [ ] Batched deliveries (`event: "batch"`) are unpacked and each event is de-duplicated on its own.
- [ ] Unsupported, duplicate, and stale events get `200`. Infrastructure failures get `503`. The claim is released if enqueueing fails.
- [ ] Background processing retries on its own and dead-letters events that keep failing.
- [ ] Logs include the idempotency key and outcome, but never secrets or signatures.
