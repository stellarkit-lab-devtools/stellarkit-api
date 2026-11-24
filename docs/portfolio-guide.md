# Portfolio Tracker Guide

This guide shows how to combine StellarKit API endpoints to build a complete investment portfolio view for a Stellar account. It covers balance aggregation, historical tracking, diversity measurement, liquidity pool monitoring, and total portfolio value computation.

## Endpoints Covered

| Endpoint | Purpose |
|---|---|
| `GET /account/:id/portfolio` | Full financial snapshot: XLM, assets with DEX prices, total value in XLM, open offers, LP positions |
| `GET /account/:id/historical-balances` | Balance snapshots over time reconstructed from payment and trade history |
| `GET /account/:id/asset-diversity` | Herfindahl-Hirschman Index (HHI) of portfolio weights with diversity level |
| `GET /account/:id/liquidity-contribution` | Aggregate liquidity pool positions: deposited value, current value, fees earned |
| `GET /account/:id/token-holdings` | Non-native asset balances with resolved TOML metadata (name, description, image) |

---

## 1. Account Balance Aggregation

### `GET /account/:id/portfolio`

Returns a complete financial snapshot in a single call: native XLM balance, all asset balances priced against current DEX order books, total portfolio value in XLM, open DEX offers, and liquidity pool positions.

```bash
curl "https://api.stellarkit.io/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/portfolio"
```

**Response structure:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "xlm": {
      "balance": "9.9999800",
      "buyingLiabilities": "0.0000000",
      "sellingLiabilities": "0.0000000"
    },
    "assets": [
      {
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "balance": "100.0000000",
        "valueInXLM": "45.2300000",
        "price": { "rate": "0.4523", "sellAsset": "USDC:GA5Z...", "buyAsset": "native" }
      }
    ],
    "totalValueXLM": "55.2299800",
    "offers": [
      {
        "id": "12345",
        "selling": { "code": "USDC", "issuer": "GA5Z...", "amount": "50.0000000" },
        "buying": { "code": "XLM", "issuer": null },
        "price": "0.45"
      }
    ],
    "liquidityPoolPositions": [
      {
        "poolId": "abc123...",
        "reserves": [
          { "asset": "USDC:GA5Z...", "amount": "25.0000000" },
          { "asset": "native", "amount": "12.5000000" }
        ]
      }
    ]
  }
}
```

**Key fields:**

- `totalValueXLM` — sum of XLM balance and all priced assets converted to XLM at current DEX rates. Assets without an active DEX market have `valueInXLM: null` and are excluded from the total.
- `offers` — open DEX offers that represent unrealized asset commitments.
- `liquidityPoolPositions` — current LP positions with reserve breakdowns.

**Caching:** Cached for 10 seconds by default (`CACHE_TTL_ACCOUNT_MS`). Pass `?fresh=true` to bypass cache.

---

## 2. Historical Balance Tracking

### `GET /account/:id/historical-balances`

Reconstructs balance snapshots at regular intervals by walking backward through the account's payment and trade history. Useful for charting portfolio value over time.

```bash
curl "https://api.stellarkit.io/account/GAAZI4.../historical-balances?asset=native&interval=86400&limit=30"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `asset` | string | `native` | Asset to track: `native`/`XLM` or `CODE:ISSUER` |
| `interval` | number | `86400` | Seconds between snapshots (86400 = daily) |
| `limit` | number | `30` | Number of snapshots to return |

**Response structure:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "asset": { "code": "XLM", "issuer": null, "type": "native" },
    "snapshots": [
      {
        "timestamp": "2024-01-30T00:00:00Z",
        "balance": "150.0000000",
        "ledger": 50000000
      },
      {
        "timestamp": "2024-01-29T00:00:00Z",
        "balance": "145.0000000",
        "ledger": 49993000
      }
    ],
    "interval": 86400,
    "count": 30
  }
}
```

**Notes:**

- Balances are reconstructed from Horizon operations, so the precision depends on ledger history availability.
- Only payments and trades affect the reconstructed balance. Operations like `set_options` (which change reserves) are not replayed.
- For assets, the trustline must exist at each snapshot point; pre-trustline snapshots return `balance: "0.0000000"`.

---

## 3. Asset Diversity Measurement

### `GET /account/:id/asset-diversity`

Measures portfolio concentration using the Herfindahl-Hirschman Index (HHI) of asset weights (converted to XLM via DEX prices).

```bash
curl "https://api.stellarkit.io/account/GAAZI4.../asset-diversity"
```

**Response structure:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "hhi": 4200.50,
    "diversityLevel": "moderate",
    "breakdown": [
      {
        "asset": { "code": "XLM", "issuer": null, "type": "native" },
        "portfolioPercent": 45.50,
        "valueInXLM": "25.0000000"
      },
      {
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "portfolioPercent": 30.00,
        "valueInXLM": "16.5000000"
      },
      {
        "asset": { "code": "EURC", "issuer": "GDBOI...", "type": "credit_alphanum4" },
        "portfolioPercent": 24.50,
        "valueInXLM": "13.4750000"
      }
    ]
  }
}
```

**Diversity levels:**

| HHI Range | Level | Interpretation |
|---|---|---|
| `≤ 1500` | `diversified` | Well-spread holdings across multiple assets |
| `1501 – 2500` | `moderate` | Some concentration but not dominated by one asset |
| `> 2500` | `concentrated` | Heavy concentration in one or two assets |

HHI is calculated as the sum of squared portfolio percentages (on a 0–100 scale). A portfolio 100% in one asset has HHI = 10,000; an even split across N assets has HHI = 10,000/N.

---

## 4. LP Position Monitoring

### `GET /account/:id/liquidity-contribution`

Aggregates the account's liquidity pool positions into a comprehensive summary: deposited value, current value, estimated fees earned, and impermanent loss estimate.

```bash
curl "https://api.stellarkit.io/account/GAAZI4.../liquidity-contribution"
```

**Response structure:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "totalDepositedXLM": "100.0000000",
    "totalCurrentValueXLM": "115.5000000",
    "estimatedFeesEarnedXLM": "5.2000000",
    "impermanentLossPercent": "3.5000000",
    "positions": [
      {
        "poolId": "abc123...",
        "reserves": [
          { "asset": "USDC:GA5Z...", "amount": "50.0000000" },
          { "asset": "native", "amount": "25.0000000" }
        ],
        "shares": "100.0000000",
        "totalShares": "5000.0000000",
        "sharePercent": 2.00,
        "currentValueXLM": "57.7500000",
        "depositedValueXLM": "50.0000000",
        "feesEarnedXLM": "2.6000000"
      }
    ]
  }
}
```

**Key fields:**

- `totalDepositedXLM` — estimated original deposit value across all pools, in XLM.
- `totalCurrentValueXLM` — current value of all LP shares, in XLM.
- `estimatedFeesEarnedXLM` — accumulated fee income estimate.
- `impermanentLossPercent` — divergence between holding-vs-pooling returns.
- `positions` — per-pool breakdown with share percentage and reserve amounts.

**Caching:** Cached for 15 seconds (`CACHE_TTL_LIQUIDITY_CONTRIBUTION_MS`). Pass `?fresh=true` to bypass.

---

## 5. Token Holdings with Metadata

### `GET /account/:id/token-holdings`

Returns the account's non-native asset balances (token holdings) with issuer metadata resolved from stellar.toml where available. This is the asset-only view that a portfolio tracker needs — native XLM is excluded.

```bash
curl "https://api.stellarkit.io/account/GAAZI4.../token-holdings"
```

**Response structure:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "holdings": [
      {
        "asset": {
          "code": "USDC",
          "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          "type": "credit_alphanum4"
        },
        "balance": "100.0000000",
        "limit": "10000.0000000",
        "isAuthorized": true,
        "toml": {
          "name": "USD Coin",
          "desc": "USDC is a fully collateralized US dollar stablecoin.",
          "image": "https://example.com/usdc.png"
        }
      }
    ],
    "count": 1
  }
}
```

**Key fields:**

- `balance` — current token balance as a seven-decimal string.
- `limit` — trustline limit.
- `isAuthorized` — whether the issuer has authorized the trustline.
- `toml` — resolved TOML metadata (name, description, image) or `null` if unavailable.

**Caching:** Cached for 30 seconds (`CACHE_TTL_ASSET_MS`). Pass `?fresh=true` to bypass.

---

## 6. Worked Example: Building a Complete Portfolio Snapshot

This example combines all five endpoints to build a dashboard view for an investment portfolio tracker.

### Step 1: Fetch the portfolio summary

Start with `/account/:id/portfolio` for the headline numbers.

```bash
ACCOUNT="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
curl "https://api.stellarkit.io/account/$ACCOUNT/portfolio" | jq '.data'
```

Extract `totalValueXLM` as the portfolio's headline value. The `assets` array shows each holding with its DEX-priced XLM equivalent.

### Step 2: Enrich with token metadata

Call `/account/:id/token-holdings` to get TOML-resolved names and images for display.

```bash
curl "https://api.stellarkit.io/account/$ACCOUNT/token-holdings" | jq '.data.holdings[] | {code: .asset.code, name: .toml.name, balance}'
```

### Step 3: Assess diversification

Call `/account/:id/asset-diversity` to get the HHI and diversity level.

```bash
curl "https://api.stellarkit.io/account/$ACCOUNT/asset-diversity" | jq '.data | {hhi, diversityLevel, breakdown}'
```

Use `diversityLevel` to show a concentration warning (e.g., "Your portfolio is concentrated — 80% in USDC").

### Step 4: Monitor LP positions

Call `/account/:id/liquidity-contribution` for liquidity pool performance.

```bash
curl "https://api.stellarkit.io/account/$ACCOUNT/liquidity-contribution" | jq '.data | {totalDepositedXLM, totalCurrentValueXLM, estimatedFeesEarnedXLM, impermanentLossPercent}'
```

### Step 5: Fetch historical balance trend

Call `/account/:id/historical-balances` to chart portfolio value over time.

```bash
curl "https://api.stellarkit.io/account/$ACCOUNT/historical-balances?asset=native&interval=86400&limit=30" | jq '.data.snapshots'
```

### Complete Node.js Example

```javascript
const BASE = "https://api.stellarkit.io";
const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

async function buildPortfolioSnapshot() {
  // 1. Portfolio summary (balances + DEX prices + total value)
  const portfolioRes = await fetch(`${BASE}/account/${ACCOUNT}/portfolio`);
  const portfolio = (await portfolioRes.json()).data;

  // 2. Token holdings with metadata
  const holdingsRes = await fetch(`${BASE}/account/${ACCOUNT}/token-holdings`);
  const holdings = (await holdingsRes.json()).data;

  // 3. Diversification score
  const diversityRes = await fetch(`${BASE}/account/${ACCOUNT}/asset-diversity`);
  const diversity = (await diversityRes.json()).data;

  // 4. LP positions
  const lpRes = await fetch(`${BASE}/account/${ACCOUNT}/liquidity-contribution`);
  const lp = (await lpRes.json()).data;

  // 5. 30-day historical balance trend
  const historyRes = await fetch(
    `${BASE}/account/${ACCOUNT}/historical-balances?asset=native&interval=86400&limit=30`
  );
  const history = (await historyRes.json()).data;

  // Combine into a single dashboard object
  return {
    accountId: ACCOUNT,
    totalValueXLM: portfolio.totalValueXLM,
    nativeBalance: portfolio.xlm,
    assets: portfolio.assets,
    tokenHoldings: holdings.holdings,
    openOffers: portfolio.offers,
    liquidityPools: lp.positions,
    totalLPDepositedXLM: lp.totalDepositedXLM,
    totalLPValueXLM: lp.totalCurrentValueXLM,
    feesEarnedXLM: lp.estimatedFeesEarnedXLM,
    impermanentLossPercent: lp.impermanentLossPercent,
    hhi: diversity.hhi,
    diversityLevel: diversity.diversityLevel,
    diversityBreakdown: diversity.breakdown,
    historicalBalances: history.snapshots,
    timestamp: new Date().toISOString(),
  };
}

buildPortfolioSnapshot().then((snapshot) => {
  console.log(`Portfolio value: ${snapshot.totalValueXLM} XLM`);
  console.log(`Diversity: ${snapshot.diversityLevel} (HHI: ${snapshot.hhi})`);
  console.log(`LP value: ${snapshot.totalLPValueXLM} XLM`);
  console.log(`Fees earned: ${snapshot.feesEarnedXLM} XLM`);
  console.log(`Holdings: ${snapshot.tokenHoldings.length} tokens`);
  console.log(`History: ${snapshot.historicalBalances.length} snapshots`);
});
```

### Caching Considerations

Each endpoint has its own server-side cache TTL. For a portfolio tracker that refreshes on an interval:

- `/portfolio` and `/token-holdings` change with account state (10–30 s TTL) — refresh every 30–60 seconds.
- `/asset-diversity` and `/liquidity-contribution` are derived from balances (15–30 s TTL) — refresh every 30–60 seconds.
- `/historical-balances` is historical and changes slowly — refresh every 5 minutes or on user request.

Pass `?fresh=true` when the user explicitly requests updated data (e.g., clicking a "Refresh" button) to bypass the cache for that single call.
