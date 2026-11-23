# Webhook Event Reference

Complete reference for every webhook event StellarKit emits: what triggers it,
the exact payload shape, and what each field means.

For registering, authenticating, and verifying webhooks, see
[webhooks.md](./webhooks.md). This document covers only the events themselves.

## Table of Contents

- [Event index](#event-index)
- [Delivery envelope](#delivery-envelope)
- [`payment.received`](#paymentreceived)
- [`trustline.changed`](#trustlinechanged)
- [`contract.event`](#contractevent)
- [Adding a new event type](#adding-a-new-event-type)

---

## Event index

| Event | Fires when | Emitted by |
| --- | --- | --- |
| [`payment.received`](#paymentreceived) | A `payment` or `create_account` operation touches an account with an open payment stream | `src/routes/stream.js` |
| [`trustline.changed`](#trustlinechanged) | A trustline is created, removed, updated, or has its authorization flags changed | `src/services/trustlineChangeDetector.js` |
| [`contract.event`](#contractevent) | A Soroban contract emits an on-chain event | `src/services/contractEventPoller.js` |

Subscription matching is **exact string equality** on the event name. Register
with the precise names above — `payment` will not receive `payment.received`
deliveries.

---

## Delivery envelope

Every event is delivered as an HTTP `POST` with a JSON body.

**Headers on every delivery:**

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `StellarKit-Webhook/1.0` |
| `X-Webhook-Event` | The `event` field from the JSON body |

**Fields common to every payload:**

| Field | Type | Description |
| --- | --- | --- |
| `event` | `string` | The event name. Always present, so one endpoint can fan-in multiple types. |

`payment.received` and `trustline.changed` additionally carry `accountId` and a
top-level `timestamp`. `contract.event` carries neither — it is scoped to a
contract, not an account. See each section below.

**Delivery and retries:** a delivery has a 30 second timeout. Any non-2xx
response, timeout, or network error counts as a failed attempt, retried with
exponential backoff at 5 s, 25 s, and 125 s — 4 attempts total, after which the
delivery is marked permanently failed. Retries are in-process and are abandoned
on restart, so **your endpoint must be idempotent**: the same event may arrive
more than once.

---

## `payment.received`

A payment credited to, or debited from, an account being streamed.

### Trigger conditions

Fires while an SSE stream is open on `GET /stream/payments/:id`, for each
Horizon payment operation on that account whose `type` is one of:

- `payment` — a standard payment operation
- `create_account` — account creation, where the starting balance is the payment

Operations of any other type (path payments, offers, and so on) are streamed to
the SSE client but do **not** trigger this webhook. The event fires only if at
least one active webhook is registered for the account under the exact event
name `payment.received`.

### Payload

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
  "timestamp": "2026-08-26T12:00:01.482Z"
}
```

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `event` | `string` | Always `"payment.received"`. |
| `accountId` | `string` | The streamed account — the `:id` from the stream URL, not necessarily the payment recipient. |
| `payment.type` | `string` | `"payment"` or `"create_account"`. |
| `payment.amount` | `string \| null` | Seven-decimal amount. For `create_account` this is the starting balance. `null` if Horizon reported neither. |
| `payment.asset.code` | `string` | Asset code, or `"XLM"` for native. |
| `payment.asset.issuer` | `string \| null` | Issuer public key, or `null` for native. |
| `payment.asset.type` | `string` | `"native"`, `"credit_alphanum4"`, or `"credit_alphanum12"`. |
| `payment.from` | `string \| null` | Sender. For `create_account` this is the funder. Falls back to the operation's source account. |
| `payment.to` | `string \| null` | Recipient. For `create_account` this is the newly created account. |
| `payment.timestamp` | `string \| null` | ISO 8601 close time of the ledger containing the operation. |
| `timestamp` | `string` | ISO 8601 time StellarKit built the payload. Later than `payment.timestamp`. |

Native XLM always serialises as
`{ "code": "XLM", "issuer": null, "type": "native" }`. All amounts are
seven-decimal strings — parse them as decimals, not floats.

---

## `trustline.changed`

A change to an account's trustline for an issued asset.

### Trigger conditions

Fires when transaction effects are processed for a monitored account and an
effect is one of the following Horizon effect types:

| Horizon effect | Resulting `changeType` |
| --- | --- |
| `trustline_created` | `added` |
| `trustline_removed` | `removed` |
| `trustline_updated` | `updated` |
| `trustline_flags_updated` | `updated` |
| `trustline_authorized` | `authorization_changed` |
| `trustline_deauthorized` | `authorization_changed` |

The effect must reference the monitored account as its `account`, `trustor`, or
`trustee`. Effects without both an `asset_code` and an `asset_issuer` are
skipped, so native XLM and liquidity-pool shares never produce this event.

### Payload

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

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `event` | `string` | Always `"trustline.changed"`. |
| `accountId` | `string` | Account whose trustline changed — the effect's `account`, else its `trustor`. |
| `trustline.asset.code` | `string` | Asset code from the effect. |
| `trustline.asset.issuer` | `string` | Issuer public key. Always present; assets without an issuer are skipped. |
| `trustline.asset.type` | `string` | `"credit_alphanum4"` or `"credit_alphanum12"`. Defaults to `"credit_alphanum4"` when Horizon omits it. |
| `trustline.balance` | `string` | Seven-decimal balance held. `"0.0000000"` when the effect carries no balance, which is the case for a removal. |
| `trustline.limit` | `string` | Seven-decimal trust limit. `"0.0000000"` when absent. |
| `trustline.isAuthorized` | `boolean \| null` | Whether the issuer has authorized the trustline. `null` when the effect does not report authorization. |
| `trustline.buyingLiabilities` | `string` | Seven-decimal buying liabilities, `"0.0000000"` when absent. |
| `trustline.sellingLiabilities` | `string` | Seven-decimal selling liabilities, `"0.0000000"` when absent. |
| `changeType` | `string` | `added`, `removed`, `updated`, or `authorization_changed`. See the mapping table above. |
| `timestamp` | `string` | ISO 8601 time the effects batch was processed. Shared across every event from the same batch. |
| `transactionHash` | `string` | Hash of the transaction that produced the effect. |

A single transaction can produce several `trustline.changed` deliveries — one
per matching effect. Use `transactionHash` to group them.

---

## `contract.event`

A Soroban smart contract emitted an on-chain event.

### Trigger conditions

The contract event poller calls the Soroban RPC `getEvents` on an interval
(`CONTRACT_POLL_INTERVAL_MS`, default `10000` ms), filtered to `contract` type
events, starting from the ledger after the last one it saw. Each returned event
is normalised into the payload below.

> **Current status:** contract events are polled and normalised, but delivery to
> subscribers is not yet wired up — `webhookDelivery.deliverContractEvent` has no
> subscriber registry behind it and logs instead of dispatching. The payload
> shape below is the contract to build against; it is what will be delivered once
> subscriber lookup lands. The poller also requires a configured Soroban RPC
> endpoint and does nothing without one.

### Payload

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

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `event` | `string` | Always `"contract.event"`. |
| `contractId` | `string` | Contract that emitted the event (`C…`). |
| `eventType` | `string` | First topic, stringified. By Soroban convention this is the event name symbol. `"unknown"` when the event has no topics. |
| `topic` | `array` | All topics, decoded from `ScVal` to native JS values in emission order. |
| `value` | `any \| null` | The event body, decoded from `ScVal`. `null` when the event carries no value. |
| `ledger` | `number` | Ledger sequence the event was emitted in. |

**Decoding notes.** `topic` entries and `value` are decoded with
`scValToNative`. Two consequences worth handling:

- `BigInt` results are converted to **strings**, since JSON cannot represent
  them. A `u128` amount arrives as `"100"`, not `100`.
- If a value cannot be decoded natively, it falls back to its **base-64 XDR**
  string, and to `null` if even that fails. Do not assume every entry is a
  decoded primitive.

Unlike the other events, `contract.event` has no `accountId` and no top-level
`timestamp`. Use `ledger` for ordering.

---

## Adding a new event type

Event documentation here follows one template. To add an event, copy the
structure of an existing section:

1. **Add a row to [Event index](#event-index)** — name, one-line trigger, and
   the file that emits it.
2. **Add a section** with the heading ``## `your.event` `` containing, in order:
   - a one-line summary
   - `### Trigger conditions` — the precise conditions, including any that
     *suppress* the event
   - `### Payload` — a complete, realistic JSON example, every field populated
   - `### Fields` — a table of `Field | Type | Description`, one row per field
     including nested ones, with nullability shown in the type (`string | null`)
   - any decoding, formatting, or ordering notes
3. **Add the anchor** to the [Table of Contents](#table-of-contents).
4. **Update the event table in [webhooks.md](./webhooks.md)** so the guide and
   this reference agree.

Keep field descriptions sourced from the emitting code rather than from intent —
note the actual fallback value when a field can be absent, as the tables above
do.

---

## Related documentation

- [webhooks.md](./webhooks.md) — registration, authentication, signature verification, retries
- [streaming.md](./streaming.md) — the SSE streams that produce `payment.received`
- [soroban.md](./soroban.md) — Soroban contract endpoints
- [error-reference.md](./error-reference.md) — error envelope shapes
