# Account Endpoints Guide

StellarKit API exposes over 25 endpoints under `/account/:id`. This guide groups them by the workflows they support, explains what each one returns, and shows when to combine them rather than calling them individually.

The `:id` path parameter is always a 56-character Stellar public key starting with `G`. Every endpoint returns `400 InvalidAccountId` for a malformed key and `404 AccountNotFound` when the account does not exist on the configured network.

---

## Quick reference: which endpoint to call first

| I want to … | Start here |
|---|---|
| Build a wallet dashboard | `GET /account/:id/summary` |
| Show all balances | `GET /account/:id/balances` |
| Page through payment history | `GET /account/:id/payments` |
| Page through effects / events | `GET /account/:id/effects` |
| Show open DEX offers | `GET /account/:id/offers` |
| Show offer history (created/updated/deleted) | `GET /account/:id/offer-history` |
| Inspect multisig configuration | `GET /account/:id/signers` |
| Run a KYC / compliance check | `GET /account/:id/risk-score` |
| Detect unusual transaction rates | `GET /account/:id/transaction-velocity` |
| Display recent trades | `GET /account/:id/trades` |
| See when an account is most active | `GET /account/:id/activity-heatmap` |
| Measure portfolio diversification | `GET /account/:id/asset-diversity` |
| Flag concentrated token holdings | `GET /account/:id/token-concentration` |

---

## Use case: Portfolio — account overview and balances

These endpoints give you everything needed to render a complete asset portfolio view.

### `GET /account/:id/summary`

The most commonly used account endpoint. Aggregates four parallel Horizon calls into a single response: balances, recent transactions, open offers, and claimable balances. Use this as the first call on any dashboard load — it avoids four separate round trips.

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountInfo` | object | Account ID, sequence, subentry count, home domain, thresholds, and flags |
| `balances` | object | `xlm` (native) and `assets` (trustlines) |
| `recentTransactions` | array | Up to 10 most recent transactions |
| `openOffers` | array | Up to 20 open DEX offers |
| `claimableBalances` | array | Claimable balances where the account is a claimant |

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/summary"
```

```json
{
  "success": true,
  "data": {
    "accountInfo": {
      "accountId": "GAAZI4TCR3...",
      "sequence": "165420053979136",
      "subentryCount": 3,
      "homeDomain": "example.com",
      "lastModifiedLedger": 52834901,
      "thresholds": { "lowThreshold": 0, "medThreshold": 0, "highThreshold": 0 },
      "flags": { "authRequired": false, "authRevocable": false, "authImmutable": false, "clawbackEnabled": false }
    },
    "balances": {
      "xlm": { "balance": "100.0000000", "buyingLiabilities": "0.0000000", "sellingLiabilities": "0.0000000" },
      "assets": [
        { "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }, "balance": "250.0000000", "limit": "10000.0000000", "isAuthorized": true }
      ]
    },
    "recentTransactions": [
      { "hash": "abc123...", "ledger": 52834901, "createdAt": "2026-09-20T14:32:11Z", "operationCount": 1, "successful": true }
    ],
    "openOffers": [],
    "claimableBalances": []
  }
}
```

**When to use `/summary` vs individual endpoints:**
- Use `/summary` for initial page loads and dashboard hydration — one call, four data sources.
- Use the individual endpoints when you need deeper pagination (e.g. all 500 payment records) or when refreshing only one section.

---

### `GET /account/:id/balances`

Returns XLM and all non-native asset balances. Supports filtering to specific assets.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `native` | boolean | When `true`, returns only the native XLM balance |
| `assets` | string | Comma-separated `CODE:ISSUER` identifiers to filter by |

```bash
# All balances
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CVWJH59IAJTGKIN2ER7LBNVKOCCWO/balances"

# XLM only
curl "http://localhost:3000/account/GAAZI4TCR3.../balances?native=true"

# Filter to specific assets
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CVWJH59IAJTGKIN2ER7LBNVKOCCWO/balances?assets=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPPPRE34K4KZVN"
```

---

### `GET /account/:id/native-balance`

Returns only the native XLM balance with buying and selling liabilities. Lighter than `/balances` when you only need XLM.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../native-balance"
```

```json
{
  "success": true,
  "data": {
    "balance": "100.0000000",
    "buyingLiabilities": "0.0000000",
    "sellingLiabilities": "5.0000000"
  }
}
```

---

### `GET /account/:id/trustlines`

Returns all trustlines with optional TOML metadata from each issuer's home domain. Useful for building an asset management screen.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `assetCode` | string | Filter to a single asset code (case-insensitive) |
| `sponsored` | boolean | `true` returns only sponsored trustlines; `false` returns only unsponsored |
| `includeMetadata` | boolean | When `true`, resolves TOML metadata for each issuer |

```bash
# All trustlines
curl "http://localhost:3000/account/GAAZI4TCR3.../trustlines"

# Only USDC trustlines
curl "http://localhost:3000/account/GAAZI4TCR3.../trustlines?assetCode=USDC"
```

---

### `GET /account/:id/historical-balances`

Reconstructs balance snapshots at regular intervals by starting from the current balance and replaying payment and trade history backwards. Useful for portfolio charts and tax tools. Snapshots are approximations: transaction fees and balance changes from other operation types are not replayed.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `asset` | string | `CODE:ISSUER` to track a single asset. Defaults to native XLM. |
| `resolution` | string | Interval between snapshots: `7d` (default) or `30d`. Any other value returns `400`. |

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../historical-balances?resolution=30d"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3...",
    "asset": { "code": "XLM", "issuer": null, "type": "native" },
    "resolution": "30d",
    "snapshots": [
      { "timestamp": "2025-11-22T10:00:00.000Z", "balance": "120.0000000" },
      { "timestamp": "2026-10-18T10:00:00.000Z", "balance": "250.5000000" }
    ]
  }
}
```

---

### `GET /account/:id/liquidity-contribution`

Aggregates the account's liquidity pool positions: per-pool share percentage and equivalent reserves, plus totals per asset across all pools. Cached per account (`CACHE_TTL_LIQUIDITY_CONTRIBUTION_MS`, default 15 s); responses carry `X-Cache: HIT|MISS`. Pass `?fresh=true` to bypass the cache.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../liquidity-contribution"
```

---

### `GET /account/:id/token-concentration`

Measures how concentrated an account's token (non-native) portfolio is. Uses the same HHI (Herfindahl-Hirschman Index) methodology as `/asset-diversity`, but ignores the native XLM balance so that portfolio risk tools can flag accounts holding most of their token value in a single illiquid asset.

Each token balance is treated as an equal-weighted share of total token balance; the HHI is the sum of the squared percentage shares (ranging from 0 to 10000). The concentration risk label is derived from the HHI:

| HHI interval | `concentrationRisk` |
|---|---|
| > 8000 | `critical` |
| 5001 – 8000 | `high` |
| 2501 – 5000 | `moderate` |
| ≤ 2500 | `low` |

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountId` | string | The 56-character account public key |
| `concentrationRisk` | string | One of `critical`, `high`, `moderate`, ``low` |
| `topHoldingPercent` | number | Share of total token value held in the largest position (0 – 100) |
| `topHoldingAsset` | object | null | Asset identifier of the largest position, or `null` when the account holds no tokens |
| `tokenCount` | number | Number of non-native token positions with a non-zero balance |
| `hhi` | number | Herfindahl-Hirschman Index over token positions (0 – 10000) |

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../token-concentration"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3...",
    "concentrationRisk": "critical",
    "topHoldingPercent": 92.5,
    "topHoldingAsset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
    "tokenCount": 2,
    "hhi": 8562.5
  }
}
```

An account with no token positions returns `concentrationRisk`: ``low`, `topHoldingPercent`: 0, `topHoldingAsset`: `null`, `tokenCount`: 0, and `hhi`: 0. Returns `404 AccountNotFound` when the account does not exist.

---

## Use case: Activity — transaction and payment history

These endpoints let you page through an account's historical activity.

### `GET /account/:id/transactions`

Paginated transaction history. Each record includes the fee summary, memo, and operation count.

**Query params:** `limit` (default 20, max 200), `order` (`asc`|`desc`), `cursor`, `type` (filter by operation type).

```bash
# Latest 20 transactions
curl "http://localhost:3000/account/GAAZI4TCR3.../transactions"

# Oldest first, paginate
curl "http://localhost:3000/account/GAAZI4TCR3.../transactions?order=asc&limit=50"

# Only transactions containing a payment operation
curl "http://localhost:3000/account/GAAZI4TCR3.../transactions?type=payment"
```

---

### `GET /account/:id/payments`

Returns payment and create_account operations only — a narrower view than full transactions. Supports filtering by asset code and date range.

**Query params:** `limit`, `order`, `cursor`, `assetCode`, `assetIssuer`, `startDate` (ISO 8601), `endDate` (ISO 8601).

```bash
# Latest payments
curl "http://localhost:3000/account/GAAZI4TCR3.../payments"

# Only USDC payments in the last month
curl "http://localhost:3000/account/GAAZI4TCR3.../payments?assetCode=USDC&startDate=2026-08-01T00:00:00Z"
```

```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "paymentId": "216532748304662529",
        "type": "payment",
        "from": "GBBD47IF6LWK7P7MDEVSWR7DPUWV3NY3DTQEVFL4NAT4AQH3HLFLA5",
        "to": "GAAZI4TCR3...",
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "amount": "50.0000000",
        "createdAt": "2026-09-20T14:32:11Z",
        "transactionHash": "abc123..."
      }
    ],
    "total": 1,
    "limit": 20,
    "cursor": "216532748304662529"
  }
}
```

---

### `GET /account/:id/effects`

Paginated ledger effects for the account. Effects are the low-level side effects of operations — credits, debits, trustline changes, signer updates, and more. Use this when you need a complete audit trail rather than a payment-only view.

**Query params:** `limit`, `order`, `cursor`, `type` (filter to a specific effect type), `fresh`.

```bash
# Latest effects
curl "http://localhost:3000/account/GAAZI4TCR3.../effects"

# Only account_credited effects
curl "http://localhost:3000/account/GAAZI4TCR3.../effects?type=account_credited"
```

---

### `GET /account/:id/pending-effects`

Lists operations the account has submitted that have not yet produced confirmed effects. Each entry has `operationType`, `estimatedLedger` and `submittedAt`; `pendingEffects` is empty when nothing is pending. Returns `404` for unknown accounts. Never cached — the response is sent with `Cache-Control: no-store`.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../pending-effects"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3...",
    "pendingEffects": [
      {
        "operationId": "225180887986176001",
        "operationType": "payment",
        "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
        "estimatedLedger": 52430100,
        "submittedAt": "2026-10-18T10:00:05.000Z"
      }
    ],
    "count": 1
  }
}
```

---

### `GET /account/:id/trades`

Returns DEX trades for the account, showing both sides (sold/bought) and the price at execution.

**Query params:** `limit`, `order`, `cursor`, `startDate`, `endDate`, `fresh`.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../trades"
```

```json
{
  "success": true,
  "data": {
    "trades": [
      {
        "tradeId": "216532748304662529-0",
        "ledgerCloseTime": "2026-09-20T14:32:11Z",
        "selling": { "code": "XLM", "issuer": null, "type": "native" },
        "buying": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "soldAmount": "100.0000000",
        "boughtAmount": "8.5000000",
        "price": "0.0850000",
        "offerId": "12345"
      }
    ],
    "total": 1,
    "limit": 20,
    "cursor": "216532748304662529-0"
  }
}
```

---

## Use case: Analytics — activity patterns and portfolio diversification

These endpoints summarise an account's behaviour rather than listing raw records. They are intended for analytics tools, wallet dashboards, and financial reporting.

### `GET /account/:id/activity-heatmap`

Returns a 7×24 matrix of transaction counts by day of week and hour of day, computed from the account's recent transaction history. Use this to show when an account is most active — for example, a "when do I transact?" chart in a wallet app.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `days` | integer | Lookback period in days. Defaults to `30`. |

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountId` | string | The account the heatmap was computed for |
| `heatmap` | object | Keys `monday` … `sunday`; each value is an array of exactly 24 hourly transaction counts (index `0` = 00:00–00:59, index `23` = 23:00–23:59) |
| `peakDay` | string | Day of week with the highest total transaction count |
| `peakHour` | integer | Hour of day (0–23) with the highest total transaction count across all days |
| `totalAnalysed` | integer | Total number of transactions included in the analysis |

Returns `404 AccountNotFound` when the account does not exist.

```bash
# Default 30-day lookback
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/activity-heatmap"

# Last 7 days only
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/activity-heatmap?days=7"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "heatmap": {
      "monday":    [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 2, 0, 0, 1, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0],
      "tuesday":   [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      "wednesday": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "thursday":  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "friday":    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "saturday":  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "sunday":    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    "peakDay": "monday",
    "peakHour": 14,
    "totalAnalysed": 14
  }
}
```

---

### `GET /account/:id/asset-diversity`

Measures how diversified an account's asset holdings are. The score is based on the number of distinct assets held, their relative weights, and the Herfindahl-Hirschman Index (HHI) — a standard measure of market concentration. Both the raw HHI and a human-readable `diversityLevel` are returned.

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountId` | string | The account the analysis was computed for |
| `assetCount` | integer | Number of distinct assets held |
| `hhi` | number | Herfindahl-Hirschman Index, computed from the squared portfolio percentages (range 0–10000) |
| `diversityLevel` | string | `"concentrated"` when `hhi > 2500`, `"moderate"` when `hhi` is 1000–2500, `"diversified"` when `hhi < 1000` |
| `breakdown` | array | Per-asset entries, each with `asset` and `portfolioPercent` |

Returns `404 AccountNotFound` when the account does not exist.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/asset-diversity"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "assetCount": 3,
    "hhi": 4235.5,
    "diversityLevel": "concentrated",
    "breakdown": [
      { "asset": { "code": "XLM", "issuer": null, "type": "native" }, "portfolioPercent": 60.0 },
      { "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }, "portfolioPercent": 30.0 },
      { "asset": { "code": "AQUA", "issuer": "GBNZ...", "type": "credit_alphanum4" }, "portfolioPercent": 10.0 }
    ]
  }
}
```

**Interpreting `diversityLevel`:**
- `"concentrated"` — one asset dominates the portfolio; a single price move drives most of the account's value.
- `"moderate"` — holdings are spread across a few assets but still meaningfully weighted.
- `"diversified"` — value is spread broadly across many assets.

---

## Use case: DEX — offers and offer history

These endpoints cover an account's activity on the Stellar decentralised exchange.

### `GET /account/:id/offers`

Returns currently open DEX offers. Each offer shows the selling asset, amount, buying asset, and price.

**Query params:** `limit`, `cursor`, `offerId` (fetch a single offer by ID).

```bash
# All open offers
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/offers"

# Single offer by ID
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/offers?offerId=123456"
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "offerId": "123456",
        "seller": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "selling": {
          "asset": { "code": "XLM", "issuer": null, "type": "native" },
          "amount": "500.0000000"
        },
        "buying": {
          "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }
        },
        "price": "0.0850000",
        "lastModifiedLedger": 52834901
      }
    ],
    "total": 1,
    "limit": 20,
    "cursor": "123456"
  }
}
```

---

### `GET /account/:id/offer-history`

Returns historical offer operations — every time the account created, updated, or deleted a DEX offer. Use this alongside `/offers` to understand an account's full trading activity: `/offers` for the current state, `/offer-history` for the timeline.

**Query params:** `limit`, `order`, `cursor`.

**Response fields per entry:**

| Field | Type | Description |
|---|---|---|
| `offerId` | string | Horizon offer ID |
| `type` | string | `"created"`, `"updated"`, or `"deleted"` |
| `sellingAsset` | object | `{ code, issuer, type }` |
| `buyingAsset` | object | `{ code, issuer, type }` |
| `amount` | string | Amount of the selling asset |
| `price` | string | Exchange rate (seven decimals) |
| `timestamp` | string | ISO 8601 timestamp of the operation |
| `transactionHash` | string | Hash of the containing transaction |

```bash
# Most recent offer activity
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/offer-history"

# Oldest first, 50 per page
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/offer-history?order=asc&limit=50"
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "offerId": "123456",
        "type": "created",
        "sellingAsset": { "code": "XLM", "issuer": null, "type": "native" },
        "buyingAsset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "amount": "500.0000000",
        "price": "0.0850000",
        "timestamp": "2026-09-01T10:00:00Z",
        "transactionHash": "abc123..."
      },
      {
        "offerId": "123456",
        "type": "deleted",
        "sellingAsset": { "code": "XLM", "issuer": null, "type": "native" },
        "buyingAsset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "amount": "0.0000000",
        "price": "0.0850000",
        "timestamp": "2026-09-02T08:15:00Z",
        "transactionHash": "def456..."
      }
    ],
    "total": 2,
    "limit": 20,
    "cursor": "216532748304662529"
  }
}
```

**Combining `/offers` and `/offer-history`:**
Call `/offers` to display the current open book. Call `/offer-history` to show the account's DEX activity over time — useful for trading dashboards that want to display fill/cancel history alongside live positions.

---

## Use case: Multisig — inspecting signing configuration

These endpoints are the building blocks for multisig-aware wallets and signing UIs.

### `GET /account/:id/signers`

Returns all signers for an account with their weights and types, plus the three threshold levels. This is the first endpoint to call when building a signing workflow.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/signers"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "signers": [
      { "key": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", "weight": 1, "type": "ed25519_public_key", "sponsor": null },
      { "key": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", "weight": 2, "type": "ed25519_public_key", "sponsor": null }
    ],
    "thresholds": {
      "lowThreshold": 1,
      "medThreshold": 2,
      "highThreshold": 3
    },
    "lastModifiedLedger": 52834901
  }
}
```

---

### `POST /account/:id/multisig-plan`

Given a list of available signers, returns the minimal combinations of those signers that can authorise each threshold level. Use this to build signing UIs that tell users exactly which keys are needed before they sign.

**Request body:** `{ "availableSigners": ["G...", "G..."] }`

```bash
curl -X POST "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/multisig-plan" \
  -H "Content-Type: application/json" \
  -d '{"availableSigners": ["GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"]}'
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "lowThreshold": 1,
    "medThreshold": 2,
    "highThreshold": 3,
    "signerWeights": [
      { "key": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", "weight": 2 }
    ],
    "validCombinations": {
      "low":  [ [{ "key": "GBBD47IF...", "weight": 2 }] ],
      "med":  [ [{ "key": "GBBD47IF...", "weight": 2 }] ],
      "high": []
    }
  }
}
```

**Typical multisig workflow:**
1. Call `/account/:id/signers` to fetch the current signer list and thresholds.
2. Present the signing keys to the user so they can select which keys are available.
3. POST to `/account/:id/multisig-plan` with the selected keys.
4. Use `validCombinations.high` (or `med`/`low` depending on the operation) to determine which subset of keys must sign.

---

## Use case: Compliance — risk and freeze status

These endpoints are designed for KYC/AML workflows, issuer tools, and compliance dashboards.

### `GET /account/:id/risk-score`

Returns a computed risk score (0–100) and a list of contributing factors. The score is derived from account age, home domain presence, multisig usage, trustline count, and recent transaction volume.

**Rating labels:** `"low"` (≥ 70), `"medium"` (40–69), `"high"` (< 40).

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/risk-score"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "score": 80,
    "rating": "low",
    "factors": [
      { "name": "Account Age", "value": "730 days", "impact": "positive", "detail": "Account is over 1 year old, established reputation" },
      { "name": "Home Domain", "value": "example.com", "impact": "positive", "detail": "Account has a home domain set" },
      { "name": "Multi-signature", "value": "Single signer", "impact": "neutral", "detail": "Account uses single signature" },
      { "name": "Trustline Count", "value": "2 trustlines", "impact": "positive", "detail": "Low number of trustlines" },
      { "name": "Recent Activity", "value": "3 transactions in last limit", "impact": "positive", "detail": "Low recent transaction activity" }
    ]
  }
}
```

---

### `GET /account/:id/freeze-status/:assetCode/:assetIssuer`

Checks whether a specific asset trustline is frozen, partially frozen, or fully authorized on an account. Returns `isFrozen`, `isPartiallyFrozen`, `canSend`, and `canReceive`.

```bash
# Check USDC freeze status
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/freeze-status/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
    "isFrozen": false,
    "isPartiallyFrozen": false,
    "canSend": true,
    "canReceive": true,
    "detail": "The trustline is authorized and the account can send and receive this asset normally."
  }
}
```

**Compliance workflow — checking multiple accounts:**
Use `POST /account/freeze-status` (batch endpoint) to check up to 20 accounts against one asset in a single request, rather than looping over individual calls.

```bash
curl -X POST "http://localhost:3000/account/freeze-status" \
  -H "Content-Type: application/json" \
  -d '{
    "addresses": [
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    ],
    "asset": { "code": "USDC", "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }
  }'
```

---

### `GET /account/:id/transaction-velocity`

Returns how quickly the account is transacting. Compliance and fraud detection tools use this to spot automated activity or unusual behaviour: a sudden burst of transactions relative to the account's historical average is a common signal of a compromised key or a bot.

The endpoint counts transactions per hour for the last 24 hours and compares the peak rate against the account's historical average.

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountId` | string | The account the velocity was computed for |
| `hourlyBreakdown` | array | Exactly 24 entries, one per hour, oldest first. Each entry has `hour` (ISO 8601 start of the hour) and `count` (transactions in that hour) |
| `peakHour` | string \| null | ISO 8601 start of the hour with the highest `count`; `null` when there is no activity |
| `peakCount` | number | Transaction count in the peak hour (0 when inactive) |
| `averagePerHour` | number | Mean transactions per hour across the 24-hour window |
| `velocityScore` | number | 0–100 indicating how unusual the rate is relative to the account's historical average. `0` for inactive accounts; higher values mean the current rate is further above normal |

Returns `404 AccountNotFound` when the account does not exist on the configured network.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transaction-velocity"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "hourlyBreakdown": [
      { "hour": "2026-10-17T11:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T12:00:00.000Z", "count": 1 },
      { "hour": "2026-10-17T13:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T14:00:00.000Z", "count": 2 },
      { "hour": "2026-10-17T15:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T16:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T17:00:00.000Z", "count": 1 },
      { "hour": "2026-10-17T18:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T19:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T20:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T21:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T22:00:00.000Z", "count": 0 },
      { "hour": "2026-10-17T23:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T00:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T01:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T02:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T03:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T04:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T05:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T06:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T07:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T08:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T09:00:00.000Z", "count": 0 },
      { "hour": "2026-10-18T10:00:00.000Z", "count": 14 }
    ],
    "peakHour": "2026-10-18T10:00:00.000Z",
    "peakCount": 14,
    "averagePerHour": 0.75,
    "velocityScore": 87
  }
}
```

An account with no transactions in the window returns 24 zero-count entries, `peakHour: null`, `peakCount: 0`, `averagePerHour: 0` and `velocityScore: 0`.

---

### `GET /account/:id/inactivity`

Returns how many days have passed since the account's last transaction and a status label: `"active"` (< 30 days), `"idle"` (30–180 days), or `"dormant"` (> 180 days).

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/inactivity"
```

```json
{
  "success": true,
  "data": {
    "lastTransactionAt": "2026-08-15T09:22:00Z",
    "lastTransactionHash": "abc123...",
    "daysSinceLastTransaction": 42,
    "status": "idle"
  }
}
```

---

## Combining endpoints by use case

### Build a wallet portfolio screen

```
1. GET /account/:id/summary         → balances + recent activity in one call
2. GET /account/:id/trustlines      → full trustline list with metadata
3. GET /account/:id/pool-positions  → LP positions (if any)
```

### Build a compliance dashboard

```
1. GET /account/:id/risk-score      → overall risk rating and factors
2. GET /account/:id/transaction-velocity  → unusual transaction-rate detection
3. GET /account/:id/inactivity      → activity status
4. GET /account/:id/freeze-status/:code/:issuer  → per-asset authorization
5. POST /account/freeze-status      → bulk check across many accounts
```

### Build a multisig signing UI

```
1. GET /account/:id/signers         → current signers and thresholds
2. POST /account/:id/multisig-plan  → which keys are needed to sign
```

### Build a DEX trading dashboard

```
1. GET /account/:id/summary         → open offers overview
2. GET /account/:id/offers          → current live offers
3. GET /account/:id/offer-history   → full offer timeline
4. GET /account/:id/trades          → executed trade history
```

### Audit an account's full activity

```
1. GET /account/:id/effects         → complete ledger effect stream
2. GET /account/:id/transactions    → full transaction history
3. GET /account/:id/payments        → payment-only filtered view
```

### Build an analytics dashboard

```
1. GET /account/:id/activity-heatmap  → when the account transacts (7×24 matrix)
2. GET /account/:id/asset-diversity   → how concentrated the portfolio is (HHI)
3. GET /account/:id/historical-balances → balance trend over time
```

---

## Error responses

All account endpoints return errors in the standard StellarKit envelope:

```json
{
  "success": false,
  "error": {
    "type": "AccountNotFound",
    "message": "Account GAAZI4... was not found on the Stellar testnet network.",
    "suggestion": "Verify the account address is correct and that the account has been funded."
  }
}
```

| Scenario | HTTP status | `error.type` |
|---|---|---|
| Malformed account ID | 400 | `InvalidAccountId` |
| Account does not exist | 404 | `AccountNotFound` |
| Asset trustline missing | 404 | `TrustlineNotFound` |
| Validation failure (bad limit, etc.) | 400 | `ValidationError` |
| Horizon did not respond | 504 | `HorizonTimeout` |

See [docs/error-reference.md](./error-reference.md) for the full error type catalogue.
