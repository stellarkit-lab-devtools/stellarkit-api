# Webhooks

StellarKit can push event notifications to your server over HTTP as they happen, so you do not need to poll the API for state changes. When an event you have subscribed to occurs — a ledger closes, an account receives a payment, a transaction you submitted is confirmed — StellarKit sends a signed `POST` request to your registered endpoint.

---

## Table of Contents

1. [Overview](#overview)
2. [Event types](#event-types)
3. [Payload structure](#payload-structure)
4. [Delivery behavior and retries](#delivery-behavior-and-retries)
5. [Securing your endpoint](#securing-your-endpoint)
6. [Registering an endpoint](#registering-an-endpoint)
7. [Disabling and deleting endpoints](#disabling-and-deleting-endpoints)

---

## Overview

```
StellarKit ──── POST {your endpoint} ────► Your server
                  X-StellarKit-Signature: t=…,v1=…
                  Content-Type: application/json
                  { "event": "…", … }
```

Each delivery is:

- **Signed** with HMAC-SHA256 using a secret unique to your webhook registration. Always verify the signature before acting on the payload.
- **Retried** with exponential back-off if your server responds with a non-`2xx` status or does not respond within the timeout window.
- **Ordered on a best-effort basis** — deliveries for the same subscription are sent in the order events occur, but network conditions mean you should handle occasional out-of-order arrivals gracefully.

---

## Event types

| Event | Trigger |
|-------|---------|
| `ledger.closed` | A new ledger has been validated by the network |
| `account.payment_received` | An account you are watching received a payment |
| `account.payment_sent` | An account you are watching sent a payment |
| `transaction.confirmed` | A transaction hash you submitted has been confirmed |
| `transaction.failed` | A transaction hash you submitted was included in a ledger but failed |
| `asset.trustline_created` | A new trustline was created for a tracked asset |

> Additional event types are added as the platform evolves. Your endpoint should silently ignore event types it does not recognise so that new events do not break existing integrations.

---

## Payload structure

Every delivery shares a common envelope:

```json
{
  "id": "wh_01J9X2K4M8N3P7Q6R5S0T1U2V3",
  "event": "ledger.closed",
  "created_at": "2026-08-28T12:00:00Z",
  "api_version": "1.0",
  "data": {
    "sequence": 54321,
    "closed_at": "2026-08-28T12:00:00Z",
    "transaction_count": 42,
    "operation_count": 108
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique delivery ID. Use this to deduplicate retried events. |
| `event` | string | Event type (see table above). |
| `created_at` | ISO 8601 string | When the event was generated. |
| `api_version` | string | The API version that produced the event. |
| `data` | object | Event-specific payload. Shape varies by event type. |

---

## Delivery behavior and retries

StellarKit considers a delivery successful when your endpoint returns any `2xx` response within **5 seconds**. If the response is non-`2xx`, times out, or the connection is refused, the delivery is retried using an exponential back-off schedule:

| Attempt | Delay after previous attempt |
|---------|------------------------------|
| 1 (initial) | — |
| 2 | 30 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 (final) | 6 hours |

After the sixth failed attempt the delivery is marked as permanently failed and no further retries are made.

**Recommendations:**

- Respond with `200 OK` as fast as possible, then process the payload asynchronously (enqueue a job, write to a queue).
- Use the `id` field to deduplicate deliveries — retries carry the same `id` as the original attempt.
- Do not rely on delivery order for critical business logic; fetch the current state from the API if ordering matters.

---

## Securing your endpoint

Verifying that a delivery genuinely came from StellarKit is mandatory before processing the payload. StellarKit signs every request body with HMAC-SHA256 and includes the signature in the `X-StellarKit-Signature` header.

See the **[Webhook Security Guide](webhook-security.md)** for:

- A detailed explanation of how signatures are computed
- Verification code examples in **Node.js**, **Python**, and **Go**
- How to handle invalid or missing signatures
- Timestamp tolerance and replay-attack protection
- Secret storage best practices
- The **dual-secret rotation pattern** for zero-downtime secret rotation

---

## Registering an endpoint

Webhook endpoints are managed from the StellarKit dashboard or via the Management API.

**Dashboard:** Settings → Webhooks → Add Endpoint

**API (example):**

```bash
curl -X POST https://api.stellarkit.io/v1/webhooks \
  -H "X-API-Key: $STELLARKIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourapp.example.com/webhooks/stellarkit",
    "events": ["ledger.closed", "account.payment_received"],
    "description": "Production ledger monitor"
  }'
```

The response includes a `secret` field containing your webhook secret. **Copy it immediately** — it is shown only once. Store it securely as described in the [Secret storage best practices](webhook-security.md#secret-storage-best-practices) section.

---

## Disabling and deleting endpoints

To temporarily stop deliveries without losing your configuration, set the endpoint status to `disabled` from the dashboard or via:

```bash
curl -X PATCH https://api.stellarkit.io/v1/webhooks/{webhookId} \
  -H "X-API-Key: $STELLARKIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

To permanently remove an endpoint and stop all future deliveries:

```bash
curl -X DELETE https://api.stellarkit.io/v1/webhooks/{webhookId} \
  -H "X-API-Key: $STELLARKIT_API_KEY"
```

> Deleting an endpoint does not cancel in-flight retries that are already scheduled. Allow a few minutes after deletion for any queued retries to drain.

---

## See also

- [Webhook Security Guide](webhook-security.md) — signature verification, secret rotation, and best practices
- [Streaming Guide](streaming.md) — real-time SSE and WebSocket transports as an alternative to webhooks
- [Rate Limiting](rate-limiting.md) — API rate limits and retry guidance
