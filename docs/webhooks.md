# Webhooks Guide

StellarKit API can push ledger events to your HTTPS endpoint instead of requiring you to poll Horizon. This guide covers how to register a webhook, which events are emitted, the payload shape of each event, how to authenticate management requests, how retries work, and how to unregister.

Webhook registrations are stored in process memory. They are lost on server restart. For production, run a dedicated StellarKit instance and re-register after deploys.

For the complete per-event reference — trigger conditions, full payload examples, and a description of every field — see [webhook-events.md](./webhook-events.md).

---

## Table of Contents

1. [Authentication](#authentication)
2. [Registration](#registration)
3. [Available events](#available-events)
4. [Payload shape](#payload-shape)
5. [Signature verification](#signature-verification)
6. [Retry behaviour](#retry-behaviour)
7. [Listing webhooks](#listing-webhooks)
8. [Unregistration](#unregistration)
9. [Error reference](#error-reference)
10. [Securing deliveries](#securing-deliveries)

---

## Authentication

All `/webhooks` management routes require an HMAC-SHA256 signature of the **raw JSON request body**, sent in the `X-Webhook-Signature` header.

Set a shared secret on the server:

```env
WEBHOOK_ADMIN_SECRET=replace-me-with-a-long-random-string
```

If `WEBHOOK_ADMIN_SECRET` is unset, every management request returns `401 Unauthorized`. Delivery to your callback URL does not use this secret; it is only for registering, listing, and deleting webhooks.

The signature is:

```
hex(HMAC-SHA256(raw_request_body, WEBHOOK_ADMIN_SECRET))
```

GET and DELETE bodies are empty. Sign the empty string (`""`) for those methods.

---

## Registration

`POST /webhooks` creates a webhook. The callback URL must be `http://` or `https://`, and `events` must be a non-empty array of event type strings.

### curl example

```bash
export WEBHOOK_ADMIN_SECRET="replace-me-with-a-long-random-string"
BODY='{"url":"https://example.com/hooks","events":["payment.received","trustline.changed"]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_ADMIN_SECRET" | awk '{print $2}')

curl -sS -X POST "http://localhost:3000/webhooks" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

### Success response (`201`)

```json
{
  "success": true,
  "data": {
    "webhookId": "wh_1710000000000_ab12cd34_1",
    "url": "https://example.com/hooks",
    "events": ["payment.received", "trustline.changed"],
    "registeredAt": "2026-08-26T12:00:00.000Z"
  }
}
```

Save `webhookId`. You need it to unregister later.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | HTTPS (or HTTP) callback that accepts `POST` JSON |
| `events` | string[] | yes | Event types to subscribe to. Must contain at least one non-empty string |

---

## Available events

The registration API accepts any event name string. StellarKit currently **emits** the following:

| Event | When it fires | Typical subscriber |
| --- | --- | --- |
| `payment.received` | A payment or `create_account` operation is observed for a streamed account | Wallets, notification services |
| `trustline.changed` | A trustline is created, removed, updated, or (de)authorized | Asset issuers, compliance tools |
| `contract.event` | A Soroban contract emits an on-chain event | dApps, indexers |
| `payment` | Alias used at registration time for payment activity | Same as `payment.received` |
| `account_funded` | Alias used at registration time for account-creation funding | Onboarding flows |

Subscribe only to events you handle. Unknown names are stored but never delivered until the server starts emitting them.

Each event's trigger conditions and full field-by-field payload description live in [webhook-events.md](./webhook-events.md).

---

## Payload shape

Deliveries are `POST` requests with `Content-Type: application/json`. Every payload includes an `event` field so a single URL can fan-in multiple types.

The examples below are a summary; [webhook-events.md](./webhook-events.md) documents every field, its type, and its fallback value.

Common headers on each delivery:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `StellarKit-Webhook/1.0` |
| `X-Webhook-Event` | The `event` string from the JSON body |

### `payment.received`

```json
{
  "event": "payment.received",
  "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "payment": {
    "type": "payment",
    "amount": "100.0000000",
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "type": "credit_alphanum4"
    },
    "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "timestamp": "2026-08-26T12:00:00Z"
  },
  "timestamp": "2026-08-26T12:00:01.000Z"
}
```

Native XLM uses `{ "code": "XLM", "issuer": null, "type": "native" }`. Amounts are seven-decimal strings.

### `trustline.changed`

```json
{
  "event": "trustline.changed",
  "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "trustline": {
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "type": "credit_alphanum4"
    },
    "balance": "10.0000000",
    "limit": "922337203685.4775807",
    "isAuthorized": true,
    "buyingLiabilities": "0.0000000",
    "sellingLiabilities": "0.0000000"
  },
  "changeType": "added",
  "timestamp": "2026-08-26T12:00:00.000Z",
  "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234"
}
```

`changeType` is one of `added`, `removed`, `updated`, or `authorization_changed`.

### `contract.event`

```json
{
  "event": "contract.event",
  "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
  "eventType": "transfer",
  "topic": ["transfer", "alice", "bob"],
  "value": "100",
  "ledger": 12345
}
```

`eventType` is the first topic symbol when present, otherwise `"unknown"`. `topic` and `value` are decoded ScVal values (BigInts become strings).

Your handler should return HTTP `2xx` quickly. Do heavy work asynchronously. StellarKit treats any non-success (network error, timeout, or non-2xx from axios) as a failed attempt.

---

## Signature verification

Management requests (register / list / delete) are authenticated with HMAC-SHA256 over the raw body. Verify the same way if you are proxying those calls, or to confirm a signature you generated locally.

```javascript
const crypto = require("crypto");

/**
 * Verify an X-Webhook-Signature header.
 *
 * @param {string} rawBody - Exact bytes/string that were hashed (do not re-JSON.stringify)
 * @param {string} signatureHeader - Value of the X-Webhook-Signature header (hex)
 * @param {string} secret - WEBHOOK_ADMIN_SECRET
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const provided = Buffer.from(String(signatureHeader || ""), "utf8");
  const computed = Buffer.from(expected, "utf8");

  if (provided.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, computed);
}

// Express example: capture raw body, then verify
app.post("/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  const ok = verifyWebhookSignature(
    rawBody,
    req.headers["x-webhook-signature"],
    process.env.WEBHOOK_ADMIN_SECRET
  );

  if (!ok) {
    return res.status(401).json({ success: false, error: { type: "Unauthorized" } });
  }

  // ... handle registration
});
```

Always hash the **raw** body. Re-serializing JSON can change key order or whitespace and will fail the check.

---

## Retry behaviour

Failed deliveries are retried automatically.

| Setting | Value |
| --- | --- |
| Maximum attempts | 3 (initial try + 2 retries) |
| Backoff | Exponential: 1s after the first failure, 2s after the second |
| Per-attempt timeout | 30 seconds |
| Success | HTTP response received without a transport error |
| After exhaustion | Delivery is dropped and logged. There is no dead-letter queue |

Retries happen in-process. A process restart abandons in-flight retries. Your endpoint should be **idempotent** — the same payment or contract event may be delivered more than once if a timeout succeeded on your side but failed on ours.

Trustline deliveries use a separate worker with the same 3-attempt cap and delays of 5s then 10s.

---

## Listing webhooks

```bash
SIG=$(printf '' | openssl dgst -sha256 -hmac "$WEBHOOK_ADMIN_SECRET" | awk '{print $2}')

curl -sS "http://localhost:3000/webhooks" \
  -H "X-Webhook-Signature: $SIG"
```

```json
{
  "success": true,
  "data": {
    "webhooks": [
      {
        "webhookId": "wh_1710000000000_ab12cd34_1",
        "url": "https://example.com/hooks",
        "events": ["payment.received"],
        "registeredAt": "2026-08-26T12:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

---

## Unregistration

`DELETE /webhooks/:webhookId` removes a registration. A missing ID returns `404 WebhookNotFound`.

```bash
WEBHOOK_ID="wh_1710000000000_ab12cd34_1"
SIG=$(printf '' | openssl dgst -sha256 -hmac "$WEBHOOK_ADMIN_SECRET" | awk '{print $2}')

curl -sS -X DELETE "http://localhost:3000/webhooks/${WEBHOOK_ID}" \
  -H "X-Webhook-Signature: $SIG"
```

```json
{
  "success": true,
  "data": {
    "webhookId": "wh_1710000000000_ab12cd34_1",
    "unregistered": true
  }
}
```

A second DELETE of the same ID also returns 404. Other webhooks are left untouched.

---

## Error reference

| Status | Type | When |
| --- | --- | --- |
| 400 | `ValidationError` | Missing/invalid `url`, empty `events`, or non-string event names |
| 401 | `Unauthorized` | Missing secret, missing `X-Webhook-Signature`, or bad HMAC |
| 404 | `WebhookNotFound` | `DELETE` with an unknown `webhookId` |

Your callback should respond with `2xx` within 30 seconds. Returning `4xx`/`5xx` or dropping the TCP connection counts as a failed attempt and consumes a retry.

---

## Securing deliveries

The retry and payload sections above describe *what* StellarKit sends. To confirm a delivery really came from StellarKit and was not tampered with, verify the `X-Webhook-Signature` header on every request. See the dedicated [Webhook Security Guide](webhook-security.md) for HMAC-SHA256 details, verification examples in Node.js / Python / Go, how to handle invalid signatures, secret-storage best practices, and the dual-secret rotation pattern.
