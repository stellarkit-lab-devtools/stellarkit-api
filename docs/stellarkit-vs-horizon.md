# StellarKit vs raw Horizon: the same five tasks, side by side

This guide answers a practical question: **what does StellarKit actually save me?**
Each task below shows the raw Horizon call(s), the equivalent StellarKit call,
and trimmed responses from the Stellar **testnet**. All addresses, hashes and
amounts below are real-shaped testnet data; responses are shortened with `…`
where only illustration matters.

Horizon base URL: `https://horizon-testnet.stellar.org`
StellarKit base URL: `http://localhost:3000` (or your deployed API URL)

**Horizon remains the source of truth.** StellarKit is a read-through adapter:
every value it serves originates in Horizon (or the Stellar SDK talking to
Horizon). It changes the *shape* and the *number* of calls, not the underlying
chain data.

---

## 1. Account balances

### Raw Horizon

```http
GET https://horizon-testnet.stellar.org/accounts/GCF3.../ 
```

```json
{
  "id": "GCF3...",
  "sequence": "123456789012",
  "subentry_count": 3,
  "balances": [
    { "balance": "1042.1234567", "asset_type": "native", "buying_liabilities": "0.0000000", "selling_liabilities": "0.0000000" },
    { "balance": "250.5000000", "asset_type": "credit_alphanum4", "asset_code": "USDC",
      "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", "limit": "10000.0000000" },
    { "balance": "12.0000000", "asset_type": "credit_alphanum12", "asset_code": "LONGTOKEN", "asset_issuer": "GA7Y…", "limit": "1000.0000000" }
  ],
  "signers": [ … ],
  "thresholds": { "low_threshold": 0, "med_threshold": 0, "high_threshold": 0 },
  "flags": { "auth_required": false, "auth_revocable": false },
  "home_domain": "example.com"
}
```

You receive the whole account resource, then split native from trustlines,
camel-case fields, and compute spendable balance yourself.

### StellarKit

```http
GET http://localhost:3000/account/GCF3.../balances
```

```json
{
  "success": true,
  "data": {
    "xlm": { "balance": "1042.1234567", "buyingLiabilities": "0.0000000", "sellingLiabilities": "0.0000000" },
    "assets": [
      { "asset": { "code": "USDC", "issuer": "GBBD47IF…", "type": "credit_alphanum4" },
        "balance": "250.5000000", "limit": "10000.0000000" },
      { "asset": { "code": "LONGTOKEN", "issuer": "GA7Y…", "type": "credit_alphanum12" }, … }
    ],
    "total": 1042.1234567
  }
}
```

**What changed:** native XLM is separated from non-native trustlines; every
field is camelCase (`buyingLiabilities`); amounts remain fixed seven-decimal
strings; each asset uses the standard `{ code, issuer, type }` shape; and the
body is wrapped in the `{ success, data }` envelope.

---

## 2. Filtered payments

### Raw Horizon

```http
GET https://horizon-testnet.stellar.org/accounts/GCF3.../payments?limit=100&order=desc
```

```json
{
  "_embedded": {
    "records": [
      { "id": "12345", "type": "payment", "from": "GCF3...", "to": "GD42…",
        "asset_type": "credit_alphanum4", "asset_code": "USDC", "asset_issuer": "GBBD47IF…",
        "amount": "12.5000000", "created_at": "2025-06-12T09:14:31Z",
        "transaction_hash": "8f3a…", "paging_token": "1688123456" },
      { "id": "12344", "type": "path_payment_strict_send", … },
      { "id": "12343", "type": "payment", "asset_code": "XLM", … }
    ]
  },
  "_links": { "next": { "href": "…cursor=1688123456" }, "self": { … } }
}
```

To get *only* USD Coin payments you filter client-side, unwrap `_embedded`,
and follow `_links.next` for paging.

### StellarKit

```http
GET http://localhost:3000/account/GCF3.../payments?assetCode=USDC&limit=20&order=desc
```

```json
{
  "success": true,
  "meta": { "count": 1, "limit": 20, "nextCursor": "1688123456", "hasMore": true },
  "data": {
    "payments": [
      { "paymentId": "12345", "type": "payment", "from": "GCF3...", "to": "GD42…",
        "asset": { "code": "USDC", "issuer": "GBBD47IF…", "type": "credit_alphanum4" },
        "amount": "12.5000000", "createdAt": "2025-06-12T09:14:31.000Z",
        "transactionHash": "8f3a…" }
    ]
  }
}
```

Spreadsheets are a first-class output: append `&format=csv` to the same URL to
get `text/csv` with one page, `assetCode`/`assetIssuer` columns, escaped cells,
and the next cursor in `X-Next-Cursor`.

**What changed:** filtering is server-side; `_embedded` and `_links` are gone;
`createdAt` is a normalized ISO 8601 timestamp; camelCase keys and the standard
asset shape are used; `meta.nextCursor` replaces link-following; and CSV export
needs no client-side formatting.

---

## 3. DEX spread

### Raw Horizon (two calls)

```http
GET https://horizon-testnet.stellar.org/orderbook?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=GBBD47IF…
```

```json
{
  "bids": [ { "price": "0.0995000", "amount": "320.0000000" }, … ],
  "asks": [ { "price": "0.1010000", "amount": "180.0000000" }, … ],
  "base": { "asset_type": "native" },
  "counter": { "asset_code": "USDC", "asset_issuer": "GBBD47IF…" }
}
```

You pick the best bid/ask, convert price strings, and compute the percentage
spread yourself; for a second pair you repeat the call.

### StellarKit

```http
GET http://localhost:3000/dex/spread/native/USDC:GBBD47IF…
```

```json
{
  "success": true,
  "data": {
    "sellAsset": { "code": "XLM", "issuer": null, "type": "native" },
    "buyAsset": { "code": "USDC", "issuer": "GBBD47IF…", "type": "credit_alphanum4" },
    "bestBid": "0.0995000",
    "bestAsk": "0.1010000",
    "spread": "0.0015000",
    "spreadPercent": "1.4925",
    "checkedAt": "2025-06-12T09:15:02.412Z"
  }
}
```

**What changed:** order-book selection and spread arithmetic move to the API;
both assets use one standard shape (native assets use `code: "XLM"` and
`issuer: null`); prices stay seven-decimal strings; timestamps are ISO 8601;
and the response uses the standard envelope.

---

## 4. Account risk

### Raw Horizon (four calls, then your own scoring)

```http
GET /accounts/GCF3...                       → home_domain, signers, flags, thresholds
GET /accounts/GCF3.../transactions?limit=50 → recent activity
GET /accounts/GCF3.../offers?limit=50       → open offers
GET /accounts/GCF3.../payments?limit=50     → counterparties
```

Each response is a Horizon `_embedded` page with snake_case fields such as
`auth_required`, `ledger_close_time` and `source_account`; you combine them
into a risk signal in your own code.

### StellarKit

```http
GET http://localhost:3000/account/GCF3.../risk-score
```

```json
{
  "success": true,
  "data": {
    "accountId": "GCF3...",
    "score": 35,
    "level": "low",
    "factors": [
      { "name": "accountAge", "value": 412, "score": 0, "description": "Account is well established" },
      { "name": "homeDomain", "value": "example.com", "score": 10, "description": "Home domain is set" }
    ],
    "checkedAt": "2025-06-12T09:16:11.008Z"
  }
}
```

Related single-call endpoints cover the same ground in more depth:
`/account/:id/compliance-check`, `/account/:id/transaction-velocity`,
`/account/:id/counterparty-risk`, and
`/account/:id/home-domain-check` (mutual account ↔ `stellar.toml` verification).

**What changed:** four Horizon pages plus client-side scoring become one call;
every field is camelCase; timestamps are ISO 8601; amounts are seven-decimal
strings; errors arrive in the StellarKit error format; and repeated checks are
served from the cache.

---

## 5. Claimable-balance eligibility

### Raw Horizon (one call plus local predicate logic)

```http
GET https://horizon-testnet.stellar.org/claimable_balances?claimant=GCF3...&limit=50
```

```json
{
  "_embedded": {
    "records": [
      { "id": "00000000…", "asset_type": "credit_alphanum4", "asset_code": "USDC",
        "asset_issuer": "GBBD47IF…", "amount": "5.0000000",
        "claimants": [
          { "destination": "GCF3...", "predicate": { "type": "conditional",
            "conditions": [ { "type": "time", "abs_before": "2025-07-01T00:00:00Z" } ] } }
        ],
        "paging_token": "…" }
    ]
  },
  "_links": { "next": { … } }
}
```

Your code must parse nested predicates, compare the current time, check
trustlines, and decide which balances this account can actually claim now.

### StellarKit

```http
GET http://localhost:3000/account/GCF3.../claimable-balance-eligibility
```

```json
{
  "success": true,
  "data": {
    "eligible": [
      { "id": "00000000…", "asset": { "code": "USDC", "issuer": "GBBD47IF…", "type": "credit_alphanum4" },
        "amount": "5.0000000", "reason": "unconditional", "expiresAt": null }
    ],
    "pending": [
      { "id": "00000001…", "asset": { … }, "amount": "2.0000000",
        "reason": "time_not_reached", "expiresAt": "2025-07-01T00:00:00.000Z" }
    ],
    "count": 1
  }
}
```

**What changed:** predicate interpretation is server-side; `asset` follows the
standard shape; amounts are seven-decimal strings; dates are ISO 8601; the
envelope and cache headers are consistent with every other StellarKit endpoint.

---

## What changes across all five tasks

| Concern | Raw Horizon | StellarKit |
| --- | --- | --- |
| Response envelope | Resource or `_embedded.records` + `_links` | `{ success: true, data, meta? }` |
| Field names | snake_case / SCREAMING_SNAKE in some resources | camelCase everywhere |
| Amounts | decimal strings (variable precision) | fixed seven-decimal strings |
| Timestamps | mixed formats (`2025-06-12T09:14:31Z`) | ISO 8601 (`…09:14:31.000Z`) |
| Assets | `asset_type` + `asset_code` + `asset_issuer` | `{ code, issuer, type }` (native: `XLM` / `null` / `native`) |
| Errors | Horizon problem JSON, per-service conventions | `{ success: false, error: { type, message, suggestion } }` with an HTTP status |
| Caching | none — you build it | short per-endpoint TTLs, `X-Cache: HIT/MISS`, `?fresh=true` override, `/cache/stats` counters |
| Concurrent identical calls | each caller hits Horizon | a single upstream call is shared (single-flight) |

---

## When to call Horizon directly

StellarKit intentionally exposes a convenience subset. Call Horizon directly
when you need:

- **Submission and signing flows** — building, simulating and submitting
  transactions, or any operation type StellarKit does not wrap.
- **Endpoints with no StellarKit equivalent** — Soroban-specific Horizon
  resources, raw ledger/effect streams, or brand-new protocol features.
- **Raw fidelity** — fields StellarKit drops from its normalized shape (for
  example `_links`, raw `extras`, or a field added in a newer Horizon release).
- **Streaming exactly at the source** — long-lived SSE cursors against Horizon
  when StellarKit's SSE/WebSocket bridge is not a fit.
- **Debugging** — confirming whether a surprising value originates in Horizon
  or in StellarKit's mapping.

Calling Horizon directly is fully supported: StellarKit never hides it, and its
`X-Cache` / `/cache/stats` tooling exists precisely so you can reason about the
trade-off.

---

## What stays the same

- **Horizon is the source of truth.** StellarKit proxies and normalizes live
  Horizon data; it is not an indexer, a database, or a consensus participant.
- The same Stellar **network and passphrase** apply (testnet in these examples;
  mainnet with `HORIZON_URL` pointing at the public Horizon instance).
- The same **account IDs, asset codes/issuers, transaction hashes and paging
  tokens** are used; you can move between the two APIs without translating
  identifiers.
- The same **eventual consistency and ledger latency** apply — a cached
  StellarKit response may be a few seconds behind, exactly as a Horizon read is
  only as fresh as the last ledger it has ingested.
- The same **Horizon rate limits and availability** ultimately apply; StellarKit
  reduces the number of calls but does not remove the upstream dependency.
