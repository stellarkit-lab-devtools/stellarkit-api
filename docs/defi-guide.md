# StellarKit DeFi Guide

A practical walkthrough for developers building DeFi applications on Stellar — DEX trading, liquidity provision, yield analysis, and arbitrage detection — using StellarKit endpoints.

---

## Table of Contents

1. [Checking Pool Profitability](#1-checking-pool-profitability)
2. [Estimating Trade Price Impact](#2-estimating-trade-price-impact)
3. [Monitoring LP Positions](#3-monitoring-lp-positions)
4. [Identifying Arbitrage Opportunities](#4-identifying-arbitrage-opportunities)

---

## 1. Checking Pool Profitability

Before committing capital to a liquidity pool, you want to know whether the fees being generated justify the impermanent loss risk. StellarKit gives you the raw numbers to make that call.

### Step 1 — List available pools and find candidates

```bash
curl "https://api.stellarkit.io/liquidity-pools?limit=20&order=desc"
```

The response includes each pool's `totalTrustlines` (a proxy for popularity) and `fee` (basis points). Pools with more trustlines and higher volume are generally more profitable.

### Step 2 — Inspect a specific pool's profitability metrics

```bash
POOL_ID="dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7"

curl "https://api.stellarkit.io/liquidity-pools/${POOL_ID}/profitability"
```

Response shape (abbreviated):

```json
{
  "success": true,
  "data": {
    "poolId": "dd7b1ab...",
    "feeBp": 30,
    "totalVolume7d": "142500.0000000",
    "estimatedDailyFeeIncome": "6.0750000",
    "estimatedAnnualFeeIncome": "2217.3750000",
    "reserveA": { "asset": { "code": "XLM" }, "amount": "500000.0000000" },
    "reserveB": { "asset": { "code": "USDC" }, "amount": "100000.0000000" }
  }
}
```

`estimatedAnnualFeeIncome` is computed as `(7-day volume / 7) * (feeBp / 10000) * 365`. Divide by total pool value to get an approximate APR.

### Step 3 — Check the reserve balance ratio

A severely imbalanced pool signals a large price move has occurred, which correlates with higher impermanent loss for existing LPs.

```bash
curl "https://api.stellarkit.io/liquidity-pools/${POOL_ID}/reserve-ratio"
```

```json
{
  "success": true,
  "data": {
    "poolId": "dd7b1ab...",
    "ratioA": "0.8333333",
    "ratioB": "0.1666667",
    "driftFromEqual": "33.33",
    "driftRating": "imbalanced"
  }
}
```

`driftRating` is `"balanced"` (<5% drift), `"moderate"` (5–20%), or `"imbalanced"` (>20%). An imbalanced pool is a yellow flag for new deposits.

---

## 2. Estimating Trade Price Impact

Large trades move the price in a constant-product pool. Before executing, estimate the effective rate and compare it to the mid-market price to quantify slippage.

### Step 1 — Get the current mid-market price and spread

```bash
# Asset format: CODE:ISSUER, or XLM:native
SELL="XLM:native"
BUY="USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

curl "https://api.stellarkit.io/dex/spread/${SELL}/${BUY}"
```

```json
{
  "success": true,
  "data": {
    "bestBid": "0.2010000",
    "bestAsk": "0.2030000",
    "midPrice": "0.2020000",
    "spreadAbsolute": "0.0020000",
    "spreadPercent": "0.99",
    "liquidityRating": "moderate"
  }
}
```

The `midPrice` is your baseline. A `liquidityRating` of `"shallow"` means your trade is more likely to move the price significantly.

### Step 2 — Simulate the exact effective rate for your trade size

```bash
AMOUNT=5000   # selling 5000 XLM

curl "https://api.stellarkit.io/dex/price/${SELL}/${BUY}?amount=${AMOUNT}"
```

```json
{
  "success": true,
  "data": {
    "sellAsset": { "code": "XLM" },
    "buyAsset": { "code": "USDC" },
    "sellAmount": "5000.0000000",
    "bestDestinationAmount": "995.3210000",
    "effectiveRate": "0.1990642",
    "path": []
  }
}
```

`effectiveRate` is the actual rate you will receive. Compare it to the `midPrice` from Step 1:

```
priceImpact = (midPrice - effectiveRate) / midPrice * 100
            = (0.2020000 - 0.1990642) / 0.2020000 * 100
            ≈ 1.45%
```

A price impact above 1–2% usually warrants splitting the order or routing via a path payment.

### Step 3 — Check order book depth before large trades

```bash
curl "https://api.stellarkit.io/dex/depth/${SELL}/${BUY}"
```

```json
{
  "success": true,
  "data": {
    "bidsCount": 18,
    "asksCount": 22,
    "totalBidVolume": "48500.0000000",
    "totalAskVolume": "39200.0000000",
    "depthRating": "moderate",
    "topBids": [...],
    "topAsks": [...]
  }
}
```

If `totalAskVolume` is less than your intended trade size, you will exhaust available liquidity and face severe slippage.

---

## 3. Monitoring LP Positions

Once capital is deployed, LPs need to track their current position value, accumulated fees, and impermanent loss in one call.

### Step 1 — Get a full LP summary for an account

```bash
ACCOUNT="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

curl "https://api.stellarkit.io/account/${ACCOUNT}/liquidity-contribution"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "totalPositions": 2,
    "totalDepositedXLM": "10420.0000000",
    "currentValueXLM": "9980.4320000",
    "estimatedFeesEarnedXLM": "47.2310000",
    "impermanentLossPercent": "5.7190476",
    "positions": [
      {
        "poolId": "dd7b1ab...",
        "depositedValue": "6000.0000000",
        "currentValue": "5720.2400000",
        "feesEarned": "28.1050000"
      },
      {
        "poolId": "cc3f9ba...",
        "depositedValue": "4420.0000000",
        "currentValue": "4260.1920000",
        "feesEarned": "19.1260000"
      }
    ]
  }
}
```

`impermanentLossPercent` is a weighted average across all positions. `estimatedFeesEarnedXLM` lets you compare fee income against the IL cost — if fees exceed IL, the position is net-profitable.

### Step 2 — Drill into individual pool positions for share details

```bash
curl "https://api.stellarkit.io/account/${ACCOUNT}/pool-positions"
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "poolId": "dd7b1ab...",
        "shares": "150.0000000",
        "sharePercent": "0.0150000",
        "totalPoolShares": "1000000.0000000",
        "reserveA": {
          "asset": { "code": "XLM", "type": "native" },
          "totalAmount": "500000.0000000",
          "equivalentAmount": "75.0000000"
        },
        "reserveB": {
          "asset": { "code": "USDC", "issuer": "GBBD47..." },
          "totalAmount": "100000.0000000",
          "equivalentAmount": "15.0000000"
        },
        "feeBp": 30
      }
    ],
    "total": 1
  }
}
```

`equivalentAmount` shows exactly how many tokens you would receive if you withdrew right now, which is the ground truth for exit planning.

### Step 3 — Check trustline limits before adding more liquidity

Before depositing into a new pool, verify the account can receive both reserve assets:

```bash
curl "https://api.stellarkit.io/account/${ACCOUNT}/trustline-limits"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "trustlineCount": 3,
    "trustlines": [
      {
        "assetCode": "USDC",
        "assetIssuer": "GBBD47...",
        "limit": "10000.0000000",
        "balance": "1250.0000000",
        "availableCapacity": "8750.0000000",
        "utilizationPercent": "12.50",
        "isAuthorized": true
      }
    ]
  }
}
```

If `availableCapacity` for a reserve asset is below your intended deposit, you need to raise the trustline limit via `change_trust` before depositing.

---

## 4. Identifying Arbitrage Opportunities

Price discrepancies between Stellar's AMM pools and its central limit order book create arbitrage opportunities. StellarKit surfaces the signals; your bot acts on them.

### Step 1 — Scan for circular path-payment opportunities

```bash
ASSET_CODE="USDC"
ASSET_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

curl "https://api.stellarkit.io/dex/arbitrage/${ASSET_CODE}/${ASSET_ISSUER}"
```

```json
{
  "success": true,
  "data": {
    "asset": { "code": "USDC", "issuer": "GBBD47..." },
    "opportunities": [
      {
        "path": ["USDC", "XLM", "yUSDC", "USDC"],
        "inputAmount": "100.0000000",
        "outputAmount": "101.3240000",
        "profitAmount": "1.3240000",
        "profitPercent": "1.32"
      }
    ],
    "checkedAt": "2026-10-21T14:32:00Z"
  }
}
```

`profitPercent > 0` means a circular trade returns more than it costs (before fees and slippage). The endpoint uses `strictReceivePaths` under the hood to find the best multi-hop route.

### Step 2 — Confirm the opportunity by checking the spread on each leg

A circular path profit can evaporate if any leg has a wide spread. Chain the spread endpoint for each hop:

```bash
# Check XLM→USDC spread (leg 1)
curl "https://api.stellarkit.io/dex/spread/XLM:native/USDC:GBBD47..."

# Check USDC→yUSDC spread (leg 2)
curl "https://api.stellarkit.io/dex/spread/USDC:GBBD47.../yUSDC:GABCD..."
```

If the `spreadPercent` on any leg exceeds the `profitPercent` from Step 1, the arbitrage is not viable after market friction.

### Step 3 — Check for buy/sell pressure imbalance before executing

A short-term imbalance signal confirms that the price discrepancy is real and not already being corrected:

```bash
curl "https://api.stellarkit.io/dex/imbalance/XLM:native/USDC:GBBD47..."
```

```json
{
  "success": true,
  "data": {
    "bidVolume": "95000.0000000",
    "askVolume": "42000.0000000",
    "imbalanceRatio": "1.2619",
    "pressure": "buy",
    "signal": "Strong buy-side pressure — price likely to rise"
  }
}
```

`pressure: "buy"` with a high `imbalanceRatio` means the market is pushing the price up, consistent with an arbitrage that profits by selling into that demand. Execute the circular path payment only when both the spread check and the imbalance signal support it.

---

## Chaining It Together — A Complete DeFi Loop

A production DeFi bot typically chains these endpoints in sequence:

```
1. /liquidity-pools/:id/profitability   → identify high-yield pools
2. /dex/spread/:sell/:buy               → check entry cost
3. /account/:id/liquidity-contribution  → review current LP exposure + IL
4. /dex/arbitrage/:code/:issuer         → scan for rebalancing opportunities
5. /dex/imbalance/:sell/:buy            → confirm signal before execution
```

All endpoints support `?fresh=true` to bypass the cache and get the latest on-chain data before time-sensitive decisions.
