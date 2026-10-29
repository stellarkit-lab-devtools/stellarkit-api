# Liquidity Pool Guide

This guide covers all six liquidity pool endpoints in StellarKit API. Use these endpoints to build LP dashboards, evaluate pool profitability, monitor reserve health, and compute the value of pool positions.

---

## Table of Contents

- [Background: How Stellar AMM Pools Work](#background-how-stellar-amm-pools-work)
- [Endpoints at a Glance](#endpoints-at-a-glance)
- [GET /liquidity-pools/:id](#get-liquidity-poolsid)
- [GET /liquidity-pools/:id/profitability](#get-liquidity-poolsidprofitability)
- [GET /liquidity-pools/:id/reserve-ratio](#get-liquidity-poolsidreserve-ratio)
- [GET /liquidity-pools/:id/trades](#get-liquidity-poolsidtrades)
- [GET /dex/pool-share-value/:poolId/:shares](#get-dexpool-share-valuepoolidshares)
- [GET /asset/:code/:issuer/liquidity-pools](#get-assetcodeissuerliquidity-pools)
- [Worked Example: Evaluating a Pool Position](#worked-example-evaluating-a-pool-position)
- [Response Field Reference](#response-field-reference)

---

## Background: How Stellar AMM Pools Work

Stellar uses a **constant-product AMM** (automated market maker) model, identical to the `x * y = k` formula popularised by Uniswap v2. Each pool holds exactly two assets (reserve A and reserve B). Liquidity providers deposit both assets in equal value and receive **pool shares** in return. When a trader swaps, the reserves shift and the constant `k` is maintained; the pool charges a fee (expressed in basis points, e.g. 30 bp = 0.30%) that accrues to liquidity providers.

Key concepts:

| Term | Meaning |
|------|---------|
| **Pool ID** | 64-character hex string uniquely identifying the pool on Stellar |
| **Shares** | Fungible tokens representing your ownership slice of the pool |
| **Reserve ratio** | The current split between the two assets; ideally 50/50 |
| **Fee bp** | Swap fee in basis points; 30 is the Stellar default |
| **Total trustlines** | Number of accounts that hold at least one pool share |

---

## Endpoints at a Glance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/liquidity-pools/:id` | Full pool details — reserves, shares, fee |
| GET | `/liquidity-pools/:id/profitability` | Estimated annualised fee income from 7-day trade volume |
| GET | `/liquidity-pools/:id/reserve-ratio` | Reserve split and drift from 50/50 |
| GET | `/liquidity-pools/:id/trades` | Paginated trade history for the pool |
| GET | `/dex/pool-share-value/:poolId/:shares` | Value of a specific number of pool shares in both reserve assets |
| GET | `/asset/:code/:issuer/liquidity-pools` | All pools containing a given asset |

All endpoints require a valid 64-character hex pool ID unless otherwise noted. The `POOL_ID` used in the examples below is a real Stellar testnet pool — replace it with any valid pool ID from your target network.

```
POOL_ID=67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026
USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
BASE=http://localhost:3000
```

---

## GET /liquidity-pools/:id

Returns the full current state of a liquidity pool: both reserve assets and their amounts, total pool shares outstanding, fee basis points, total trustlines, and the last modified ledger.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | 64-character hex pool ID |

**Query params**

None.

**Example**

```bash
curl "$BASE/liquidity-pools/$POOL_ID"
```

**Sample response**

```json
{
  "success": true,
  "data": {
    "poolId": "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026",
    "fee": "30.0000000",
    "totalShares": "14523.4200000",
    "reserveA": {
      "asset": { "code": "XLM", "issuer": null, "type": "native" },
      "amount": "48210.5000000"
    },
    "reserveB": {
      "asset": {
        "code": "USDC",
        "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "type": "credit_alphanum4"
      },
      "amount": "9640.1000000"
    },
    "totalTrustlines": 87,
    "lastModifiedLedger": 48391022
  }
}
```

**Error responses**

| Status | Type | When |
|--------|------|------|
| 404 | `LiquidityPoolNotFound` | Pool ID does not exist on the configured network |

---

## GET /liquidity-pools/:id/profitability

Estimates annualised fee income for a pool based on its last 7 days of trade volume. The estimate is derived by extrapolating the 7-day volume to 365 days and applying the pool's fee rate.

> **Formula:** `estimatedAnnualFeeIncome = (totalVolume7d / 7) × feeRate × 365`

This is a fee-income estimate only — it does not account for impermanent loss, which depends on price movements of the two assets.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | 64-character hex pool ID |

**Query params**

None.

**Example**

```bash
curl "$BASE/liquidity-pools/$POOL_ID/profitability"
```

**Sample response**

```json
{
  "success": true,
  "data": {
    "poolId": "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026",
    "feeRate": "0.30%",
    "feeBp": 30,
    "tradeVolume7d": "312450.0000000",
    "tradeCount7d": 1043,
    "estimatedDailyFeeIncome": "133.9071428",
    "estimatedAnnualFeeIncome": "48876.1071428",
    "reserveA": {
      "asset": { "code": "XLM", "issuer": null, "type": "native" },
      "amount": "48210.5000000"
    },
    "reserveB": {
      "asset": {
        "code": "USDC",
        "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "type": "credit_alphanum4"
      },
      "amount": "9640.1000000"
    },
    "totalShares": "14523.4200000",
    "totalTrustlines": 87
  }
}
```

**Notes**

- `tradeVolume7d` is measured in the pool's base asset (reserve A) amounts.
- Pools with little or no recent activity will show `0.0000000` for both fee income fields.
- The estimate becomes less reliable for low-liquidity pools with irregular trade patterns.

**Error responses**

| Status | Type | When |
|--------|------|------|
| 404 | `LiquidityPoolNotFound` | Pool ID does not exist |

---

## GET /liquidity-pools/:id/reserve-ratio

Returns the current percentage split between the two pool assets and quantifies how far the pool has drifted from the ideal 50/50 ratio. A large drift indicates that one asset has appreciated significantly against the other.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | 64-character hex pool ID |

**Query params**

None.

**Example**

```bash
curl "$BASE/liquidity-pools/$POOL_ID/reserve-ratio"
```

**Sample response**

```json
{
  "success": true,
  "data": {
    "reserveA": {
      "asset": { "code": "XLM", "issuer": null, "type": "native" },
      "amount": "48210.5000000"
    },
    "reserveB": {
      "asset": {
        "code": "USDC",
        "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "type": "credit_alphanum4"
      },
      "amount": "9640.1000000"
    },
    "ratioA": "83.33%",
    "ratioB": "16.67%",
    "driftFromEqual": "33.33%",
    "driftRating": "imbalanced"
  }
}
```

**`driftRating` values**

| Value | Drift from 50/50 | Meaning |
|-------|-----------------|---------|
| `balanced` | ≤ 5% | Pool is near equilibrium |
| `moderate` | 5%–20% | Noticeable but common drift |
| `imbalanced` | > 20% | Strong price divergence; higher impermanent loss risk |

**Error responses**

| Status | Type | When |
|--------|------|------|
| 404 | `LiquidityPoolNotFound` | Pool ID does not exist |

---

## GET /liquidity-pools/:id/trades

Returns a paginated list of trades that have been executed against the pool, newest first. Supports optional filtering by base or counter asset.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | 64-character hex pool ID |

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 20 | Page size (max 200) |
| `order` | `asc` \| `desc` | `desc` | Sort direction |
| `cursor` | string | — | Paging token from a previous response |
| `baseAsset` | string | — | Filter by base asset: `XLM` or `CODE:ISSUER` |
| `counterAsset` | string | — | Filter by counter asset: `XLM` or `CODE:ISSUER` |
| `fresh` | boolean | `false` | Bypass cache and fetch live data |

**Example — all recent trades**

```bash
curl "$BASE/liquidity-pools/$POOL_ID/trades?limit=5"
```

**Example — trades involving USDC as counter asset**

```bash
curl "$BASE/liquidity-pools/$POOL_ID/trades?counterAsset=USDC:$USDC_ISSUER"
```

**Sample response**

```json
{
  "success": true,
  "data": {
    "trades": [
      {
        "tradeId": "215959692836864001",
        "ledgerCloseTime": "2024-07-01T10:23:45.000Z",
        "baseAsset": { "code": "XLM", "issuer": null, "type": "native" },
        "counterAsset": {
          "code": "USDC",
          "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          "type": "credit_alphanum4"
        },
        "baseAmount": "500.0000000",
        "counterAmount": "100.0200000",
        "price": "0.2000400"
      }
    ]
  },
  "meta": {
    "count": 1,
    "limit": 5,
    "order": "desc",
    "nextCursor": "215959692836864001",
    "hasMore": true
  }
}
```

**Paginating through results**

```bash
# First page
curl "$BASE/liquidity-pools/$POOL_ID/trades?limit=20"

# Next page — pass nextCursor from the previous response
curl "$BASE/liquidity-pools/$POOL_ID/trades?limit=20&cursor=215959692836864001"
```

**Error responses**

| Status | Type | When |
|--------|------|------|
| 400 | `ValidationError` | Pool ID is not a valid 64-character hex string |
| 404 | `LiquidityPoolNotFound` | Pool ID does not exist |

---

## GET /dex/pool-share-value/:poolId/:shares

Calculates the equivalent reserve amounts you would receive if you redeemed a specified number of pool shares right now. This is useful for displaying a user's position value on a dashboard without requiring them to actually withdraw.

> **Formula:** `equivalentAmount = (shares / totalShares) × reserveAmount`

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `poolId` | string | 64-character hex pool ID |
| `shares` | number | Number of pool shares to value (supports decimals, e.g. `150.5`) |

**Query params**

None.

**Example — value 500 shares**

```bash
curl "$BASE/dex/pool-share-value/$POOL_ID/500"
```

**Example — fractional shares**

```bash
curl "$BASE/dex/pool-share-value/$POOL_ID/12.3456789"
```

**Sample response**

```json
{
  "success": true,
  "data": {
    "poolId": "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026",
    "shares": "500.0000000",
    "totalShares": "14523.4200000",
    "sharePercent": "3.4427120",
    "reserveA": {
      "asset": { "code": "XLM", "issuer": null, "type": "native" },
      "equivalentAmount": "1660.2793480"
    },
    "reserveB": {
      "asset": {
        "code": "USDC",
        "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "type": "credit_alphanum4"
      },
      "equivalentAmount": "331.9936714"
    },
    "feeBp": 30
  }
}
```

**Error responses**

| Status | Type | When |
|--------|------|------|
| 400 | `ValidationError` | Pool ID is malformed or shares is not a positive number |
| 404 | `LiquidityPoolNotFound` | Pool ID does not exist |

---

## GET /asset/:code/:issuer/liquidity-pools

Returns all liquidity pools that include the specified asset as one of their two reserves. Useful for discovering available markets for a given asset or displaying a pool selector in a wallet UI.

Use `XLM/native` for the native Stellar asset.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Asset code (e.g. `USDC`, `XLM`) |
| `issuer` | string | Issuer public key, or `native` for XLM |

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 20 | Page size (max 100) |
| `cursor` | string | — | Paging token from a previous response |

**Example — pools containing USDC**

```bash
curl "$BASE/asset/USDC/$USDC_ISSUER/liquidity-pools?limit=5"
```

**Example — pools containing native XLM**

```bash
curl "$BASE/asset/XLM/native/liquidity-pools"
```

**Sample response**

```json
{
  "success": true,
  "data": {
    "pools": [
      {
        "poolId": "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026",
        "fee": 30,
        "totalShares": "14523.4200000",
        "reserveA": {
          "asset": { "code": "XLM", "issuer": null, "type": "native" },
          "amount": "48210.5000000"
        },
        "reserveB": {
          "asset": {
            "code": "USDC",
            "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            "type": "credit_alphanum4"
          },
          "amount": "9640.1000000"
        },
        "totalTrustlines": 87
      }
    ],
    "total": 1,
    "limit": 5,
    "cursor": null
  }
}
```

**Error responses**

| Status | Type | When |
|--------|------|------|
| 400 | `ValidationError` | Asset code or issuer is invalid |

---

## Worked Example: Evaluating a Pool Position

This example walks through a complete workflow for a DeFi dashboard: fetch the pool state, check its health, estimate profitability, and compute the current value of a user's share position.

### Step 1 — Get pool details

```bash
curl "$BASE/liquidity-pools/$POOL_ID"
```

Note the `totalShares` and both `reserveA.amount` / `reserveB.amount` values. These change with every trade.

### Step 2 — Check reserve balance

```bash
curl "$BASE/liquidity-pools/$POOL_ID/reserve-ratio"
```

A `driftRating` of `balanced` means the pool is near 50/50 — impermanent loss risk is currently low. An `imbalanced` rating (drift > 20%) means one asset has moved significantly in price; LPs holding shares are exposed to more impermanent loss if they withdraw now.

### Step 3 — Estimate fee income

```bash
curl "$BASE/liquidity-pools/$POOL_ID/profitability"
```

Divide `estimatedAnnualFeeIncome` by `totalShares` to get fee income per share per year. Multiply by your share count to estimate your annual earnings from fees alone.

```
annualFeePerShare = estimatedAnnualFeeIncome / totalShares
myAnnualFeeIncome = annualFeePerShare × myShares
```

### Step 4 — Calculate position value

```bash
# Replace 500 with the actual share balance from /account/:id/pool-positions
curl "$BASE/dex/pool-share-value/$POOL_ID/500"
```

The response gives `reserveA.equivalentAmount` and `reserveB.equivalentAmount` — these are the exact amounts of each asset you would receive if you withdrew right now.

### Step 5 — Check recent pool activity

```bash
curl "$BASE/liquidity-pools/$POOL_ID/trades?limit=10"
```

A pool with no recent trades has no fee income accruing. Cross-reference `tradeCount7d` from the profitability endpoint with your withdrawal decision.

### Step 6 — Find other pools for the same asset

If the pool looks less attractive, discover alternatives:

```bash
curl "$BASE/asset/USDC/$USDC_ISSUER/liquidity-pools"
```

Compare `totalShares`, reserve amounts, and `fee` across pools to find the most liquid market.

---

## Response Field Reference

### Pool object (shared across endpoints)

| Field | Type | Description |
|-------|------|-------------|
| `poolId` | string | 64-character hex pool identifier |
| `fee` | string | Swap fee in basis points, formatted as 7-decimal string (e.g. `"30.0000000"`) |
| `totalShares` | string | Total pool shares issued, 7-decimal string |
| `reserveA` | object | First reserve: `{ asset, amount }` |
| `reserveB` | object | Second reserve: `{ asset, amount }` |
| `totalTrustlines` | integer | Accounts currently holding pool shares |
| `lastModifiedLedger` | integer | Ledger sequence of the most recent pool state change |

### Asset object

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Asset code (`"XLM"` for native) |
| `issuer` | string \| null | Issuer public key; `null` for native XLM |
| `type` | string | `"native"`, `"credit_alphanum4"`, or `"credit_alphanum12"` |

### Profitability object

| Field | Type | Description |
|-------|------|-------------|
| `feeRate` | string | Human-readable fee percentage (e.g. `"0.30%"`) |
| `feeBp` | integer | Fee in basis points (e.g. `30`) |
| `tradeVolume7d` | string | Total base-asset volume over the last 7 days |
| `tradeCount7d` | integer | Number of trades in the last 7 days |
| `estimatedDailyFeeIncome` | string | Projected daily fee income at current trade rate |
| `estimatedAnnualFeeIncome` | string | Projected annual fee income at current trade rate |

### Reserve ratio object

| Field | Type | Description |
|-------|------|-------------|
| `ratioA` | string | Reserve A as a percentage of total reserves (e.g. `"52.10%"`) |
| `ratioB` | string | Reserve B as a percentage of total reserves |
| `driftFromEqual` | string | Absolute deviation from 50% (e.g. `"2.10%"`) |
| `driftRating` | string | `"balanced"`, `"moderate"`, or `"imbalanced"` |

---

## See Also

- [Account Endpoints Guide](account-endpoints.md) — `GET /account/:id/pool-positions` and `GET /account/:id/liquidity-contribution`
- [DEX Endpoints Guide](dex-endpoints.md) — Spread, depth, price, top-markets, and arbitrage endpoints
- [Caching Strategy](caching-strategy.md) — Cache TTLs for pool endpoints
