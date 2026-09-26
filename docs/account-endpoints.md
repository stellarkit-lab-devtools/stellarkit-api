# Account Endpoints Guide

StellarKit API exposes over 25 endpoints under `/account/:id`. This guide groups them by the workflows they support, explains what each one returns, and shows when to combine them rather than calling them individually.

The `:id` path parameter is always a 56-character Stellar public key starting with `G`. Every endpoint returns `400 InvalidAccountId` for a malformed key and `404 AccountNotFound` when the account does not exist on the configured network.

---

## Quick reference: which endpoint to call first

| I want to… | Start here |
|---|---|
| Build a wallet dashboard | `GET /account/:id/summary` |
| Show all balances | `GET /account/:id/balances` |
| Page through payment history | `GET /account/:id/payments` |
| Page through effects / events | `GET /account/:id/effects` |
| Show open DEX offers | `GET /account/:id/offers` |
| Show offer history (created/updated/deleted) | `GET /account/:id/offer-history` |
| Inspect multisig configuration | `GET /account/:id/signers` |
| Run a KYC / compliance check | `GET /account/:id/risk-score` |
| Display recent trades | `GET /account/:id/trades` |

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
      "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
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
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/balances"

# XLM only
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/balances?native=true"

# Filter to specific assets
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/balances?assets=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

---

### `GET /account/:id/native-balance`

Returns only the native XLM balance with buying and selling liabilities. Lighter than `/balances` when you only need XLM.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/native-balance"
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
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/trustlines"

# Only USDC trustlines
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/trustlines?assetCode=USDC"
```

---

## Use case: Activity — transaction and payment history

These endpoints let you page through an account's historical activity.

### `GET /account/:id/transactions`

Paginated transaction history. Each record includes the fee summary, memo, and operation count.

**Query params:** `limit` (default 20, max 200), `order` (`asc`|`desc`), `cursor`, `type` (filter by operation type).

```bash
# Latest 20 transactions
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions"

# Oldest first, paginate
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions?order=asc&limit=50"

# Only transactions containing a payment operation
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions?type=payment"
```

---

### `GET /account/:id/payments`

Returns payment and create_account operations only — a narrower view than full transactions. Supports filtering by asset code and date range.

**Query params:** `limit`, `order`, `cursor`, `assetCode`, `assetIssuer`, `startDate` (ISO 8601), `endDate` (ISO 8601).

```bash
# Latest payments
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payments"

# Only USDC payments in the last month
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payments?assetCode=USDC&startDate=2026-08-01T00:00:00Z"
```

```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "paymentId": "216532748304662529",
        "type": "payment",
        "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
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
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/effects"

# Only account_credited effects
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/effects?type=account_credited"
```

---

### `GET /account/:id/trades`

Returns DEX trades for the account, showing both sides (sold/bought) and the price at execution.

**Query params:** `limit`, `order`, `cursor`, `startDate`, `endDate`, `fresh`.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/trades"
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
2. GET /account/:id/inactivity      → activity status
3. GET /account/:id/freeze-status/:code/:issuer  → per-asset authorization
4. POST /account/freeze-status      → bulk check across many accounts
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
