# Batch Endpoints Guide

Several StellarKit endpoints accept a list of accounts or transaction hashes and return a result **per entry** in one round trip. Use them when you would otherwise fan out many identical Horizon lookups from the client.

This guide lists every batch endpoint, its input limits, how per-entry errors are returned, curl examples, and when a batch call is the wrong tool.

---

## Table of Contents

1. [Overview](#overview)
2. [POST /accounts/trust-status](#post-accountstrust-status)
3. [POST /account/freeze-status](#post-accountfreeze-status)
4. [POST /transactions/batch-status](#post-transactionsbatch-status)
5. [When to use batch vs individual](#when-to-use-batch-vs-individual)
6. [Error handling summary](#error-handling-summary)

---

## Overview

| Endpoint | Input | Limit | Per-entry failure | Request fails entirely |
| --- | --- | --- | --- | --- |
| `POST /accounts/trust-status` | `addresses` + `asset` | **30** addresses | Missing accounts / missing trustlines become a result object | Invalid body, >30 addresses, or a bad address/asset |
| `POST /account/freeze-status` | `addresses` + `asset` | **20** addresses | Missing accounts / missing trustlines become `status: "error"` | Invalid body, >20 addresses, or a bad address/asset |
| `POST /transactions/batch-status` | `hashes` | **20** hashes | Unknown hashes return `found: false` | Invalid body, >20 hashes, or any malformed hash |

Horizon lookups for a valid batch run in **parallel**. A 404 for one account or hash never fails the whole request. A malformed address or hash **does** fail the whole request with `400 ValidationError` — fix the input and retry.

All successful responses use the standard envelope: `{ "success": true, "data": { ... } }`.

---

## POST /accounts/trust-status

Checks whether each account holds a specific issued asset and whether that trustline is authorized.

**Limit:** 1–30 Stellar public keys (`G...`).

### curl

```bash
curl -sS -X POST "http://localhost:3000/accounts/trust-status" \
  -H "Content-Type: application/json" \
  -d '{
    "addresses": [
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    ],
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    }
  }'
```

### Success

```json
{
  "success": true,
  "data": {
    "results": {
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN": {
        "hasTrustline": true,
        "isAuthorized": true,
        "balance": "100.5000000"
      },
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5": {
        "hasTrustline": false,
        "isAuthorized": false,
        "balance": null
      }
    }
  }
}
```

### Per-entry behaviour

| Situation | Result |
| --- | --- |
| Account exists and holds the asset | `hasTrustline: true`, `isAuthorized` from the trustline, `balance` as a seven-decimal string |
| Account exists but has no trustline | `hasTrustline: false`, `isAuthorized: false`, `balance: null` |
| Account does not exist on the network | Same as no trustline (`hasTrustline: false`, …). **Not** a 404 for the batch |

### Request-level errors (`400`)

- `addresses` missing, not an array, or empty
- More than **30** addresses
- Any address not a valid `G...` public key
- `asset.code` or `asset.issuer` missing or invalid

Native XLM is not a trustline asset. This endpoint is for issued assets (`code` + `issuer`) only. For a single native balance use `GET /account/:id/native-balance`.

---

## POST /account/freeze-status

Batch authorization / freeze check for up to 20 accounts against one issued asset. Use this when you need freeze state (`authorized`, `frozen`, `frozen_maintain_liabilities`), not just “does a trustline exist?”.

**Limit:** 1–20 Stellar public keys (`G...`).

The single-account variant remains `GET /account/:id/freeze-status/:assetCode/:assetIssuer`.

### curl

```bash
curl -sS -X POST "http://localhost:3000/account/freeze-status" \
  -H "Content-Type: application/json" \
  -d '{
    "addresses": [
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    ],
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    }
  }'
```

### Success

```json
{
  "success": true,
  "data": {
    "results": {
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN": {
        "status": "authorized",
        "isAuthorized": true,
        "isAuthorizedToMaintainLiabilities": true
      },
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5": {
        "status": "error",
        "error": "Account GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 was not found on the Stellar testnet network.",
        "isAuthorized": null,
        "isAuthorizedToMaintainLiabilities": null
      }
    }
  }
}
```

### Per-entry `status` values

| `status` | Meaning |
| --- | --- |
| `authorized` | Trustline exists and `is_authorized` is true |
| `frozen` | Trustline exists, not authorized, and cannot maintain liabilities |
| `frozen_maintain_liabilities` | Frozen for new payments but allowed to reduce liabilities |
| `error` | Account missing, Horizon lookup failed, or the account does not hold the asset |

Error entries still occupy a key in `results`. Inspect `status === "error"` (and `error`) instead of assuming every key is a freeze state.

### Request-level errors (`400`)

- Empty or missing `addresses`
- More than **20** addresses
- Invalid public key or asset fields

---

## POST /transactions/batch-status

Looks up confirmation status for up to 20 transaction hashes.

**Limit:** 0–20 64-character hex hashes. An empty `hashes` array returns `{ items: [], total: 0 }` rather than 400.

### curl

```bash
curl -sS -X POST "http://localhost:3000/transactions/batch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "hashes": [
      "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ]
  }'
```

### Success

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "hash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
        "found": true,
        "successful": true,
        "ledger": 51234567,
        "createdAt": "2026-08-26T12:00:00.000Z",
        "fee": "100.0000000"
      },
      {
        "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "found": false
      }
    ],
    "total": 2
  }
}
```

`items` is aligned with the request order. `fee` is the charged fee as a seven-decimal string.

### Per-entry behaviour

| Situation | Result |
| --- | --- |
| Transaction exists | `found: true` plus `successful`, `ledger`, `createdAt`, `fee` |
| Horizon 404 | `found: false` only |
| Other Horizon/network error for that hash | `found: false` with `error: "Lookup failed"` |

### Request-level errors (`400`)

- `hashes` missing or not an array
- More than **20** hashes
- Any hash that is not exactly 64 hex characters — the **entire** request is rejected, even if other hashes are valid

There is no per-hash 404 at the HTTP layer. Check `found` on each item.

---

## When to use batch vs individual

Use **batch** when:

- You already have a list of accounts or hashes (airdrop allowlists, exchange deposits, ops dashboards).
- You care about a **single asset** across many accounts (`trust-status`, `freeze-status`) or confirmation of many submissions (`batch-status`).
- You want one HTTP round trip and parallel Horizon work on the server.
- A missing account or unknown hash should not abort the rest of the list.

Use **individual** endpoints when:

- You need **one** account or one transaction and want the richer payload (`GET /account/:id`, `GET /account/:id/freeze-status/:code/:issuer`, `GET /transactions/:id` for history).
- You need fields the batch APIs do not return (signers, offers, operations, memos, effects).
- The list is larger than the address/hash cap — page it yourself (chunks of 20 or 30) rather than sending 200 keys in one body.
- You are polling a single in-flight transaction. A tight loop on one hash is clearer than batching a list of one.

### Practical rule of thumb

| Job | Prefer |
| --- | --- |
| “Does this one account hold USDC?” | `GET /account/:id/can-receive/USDC/:issuer` or the single freeze-status route |
| “Which of these 25 addresses can receive USDC?” | `POST /accounts/trust-status` |
| “Are any of these 12 accounts frozen for USDC?” | `POST /account/freeze-status` |
| “Did these 8 submissions land?” | `POST /transactions/batch-status` |
| “Show this account’s full history” | `GET /transactions/:id` (not batch) |

Chunk oversized lists: 30 for trust-status, 20 for freeze-status and batch-status. Stay under the JSON body size limit (`MAX_BODY_SIZE`, default 10kb).

---

## Error handling summary

**Fail the request (HTTP 400)** for bad *shape*: wrong types, over the address/hash limit, invalid public keys, invalid asset, invalid hex hashes.

**Do not fail the request** for bad *ledger state*: account not found, no trustline, transaction not on chain. Those show up inside `results` or `items` so the client can display a row-level error.

Handle mixed batches like this:

```javascript
const { results } = data;

for (const [address, row] of Object.entries(results)) {
  if (row.status === "error" || row.hasTrustline === false) {
    // row-level: skip, retry later, or show in the UI
    continue;
  }
  // row-level success
}
```

Do not retry the whole batch on a single missing account. Retry only entries that failed for transient reasons (`error: "Lookup failed"` on batch-status, or freeze-status `status: "error"` with a non-not-found message).
