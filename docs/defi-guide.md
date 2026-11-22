# DeFi Workflows with StellarKit

A guide for developers building DeFi applications on Stellar using StellarKit endpoints. This guide covers the key use cases: checking pool profitability, estimating trade price impact, monitoring liquidity provider positions, and identifying arbitrage opportunities.

---

## Table of Contents

- [Pool Profitability Analysis](#pool-profitability-analysis)
- [Price Impact Estimation](#price-impact-estimation)
- [Liquidity Provider Monitoring](#liquidity-provider-monitoring)
- [Arbitrage Opportunity Detection](#arbitrage-opportunity-detection)

---

## Pool Profitability Analysis

**Goal:** Determine if a liquidity pool is profitable for market makers before depositing.

A profitable pool has positive fee revenue relative to impermanent loss. StellarKit makes this simple by aggregating pool data and LP contribution summaries.

### Workflow

1. **List all DEX pools and their volumes:**

```bash
curl -s https://api.stellarkit.io/dex/market-summary
```

Response includes `totalTradingVolumeXLM` per pool, helping you identify high-volume pools.

2. **Check a specific pool's profitability metrics:**

```bash
curl -s https://api.stellarkit.io/liquidity-pools/{poolId}
```

This returns reserves, total shares, and the pool's current TVL and fee structure.

3. **Compare against historical fee revenue:**

For a pool you're considering, fetch trade history to estimate average daily fees:

```bash
curl -s https://api.stellarkit.io/liquidity-pools/{poolId}/trades
```

Divide total fees by days active to project APY. If APY > projected impermanent loss, the pool is profitable.

---

## Price Impact Estimation

**Goal:** Before executing a large trade, estimate the price impact so you don't pay excessive slippage.

StellarKit's DEX price impact endpoint simulates the trade without executing it, letting you decide if the slippage is acceptable.

### Workflow

1. **Check current pool prices and your trade's impact:**

```bash
curl -s "https://api.stellarkit.io/dex/price-impact?pool={poolId}&amount={xlmAmount}&assetIn=native&assetOut={issuer}:{code}"
```

Response includes:
- `executionPrice`: what you'll actually pay
- `impactPercent`: how much the price worsens vs. the spot rate
- `slippageXLM`: absolute slippage amount

2. **Compare multiple pools for the same pair:**

If multiple pools trade the same pair, query each:

```bash
# Pool A
curl -s "https://api.stellarkit.io/dex/price-impact?pool={poolIdA}&amount=1000&assetIn=native"

# Pool B
curl -s "https://api.stellarkit.io/dex/price-impact?pool={poolIdB}&amount=1000&assetIn=native"
```

Choose the pool with the lowest `impactPercent`.

3. **Make an informed decision on trade size:**

If impact is too high, reduce the trade size or split across multiple pools to minimize slippage.

---

## Liquidity Provider Monitoring

**Goal:** Track your LP positions across all pools — see how much you've deposited, current value, fees earned, and impermanent loss.

### Workflow

1. **Get aggregate LP summary for your account:**

```bash
curl -s https://api.stellarkit.io/account/{accountId}/liquidity-contribution
```

Response includes:
- `totalPositions`: number of pools you're in
- `totalDepositedXLM`: total value you deposited across all pools
- `currentValueXLM`: current value of all positions combined
- `estimatedFeesEarnedXLM`: total fees collected
- `impermanentLossPercent`: aggregate IL estimate
- `positions`: breakdown per pool

2. **Break down the response to identify problem pools:**

```javascript
const response = await fetch('https://api.stellarkit.io/account/{accountId}/liquidity-contribution')
  .then(r => r.json());

const { positions, impermanentLossPercent } = response.data;

// Find positions with high IL
const problematicPools = positions.filter(p => {
  const il = ((p.currentValue - p.depositedValue) / p.depositedValue * 100);
  return il < -10; // More than 10% IL
});

console.log("Pools with high impermanent loss:", problematicPools);
```

3. **Monitor over time:**

Query the endpoint regularly (with `?fresh=true` to bypass cache) to track how fees and IL change. If IL exceeds expected fee revenue, consider withdrawing.

---

## Arbitrage Opportunity Detection

**Goal:** Identify price discrepancies across pools where you can profit from buying low in one pool and selling high in another.

### Workflow

1. **Get market summary across all DEX pools:**

```bash
curl -s https://api.stellarkit.io/dex/market-summary
```

This returns all active pools and their current prices. Look for the same trading pair in multiple pools.

2. **Compare prices for the same asset pair:**

```bash
# Get all XLM/USDC prices (may exist in multiple pools)
curl -s "https://api.stellarkit.io/dex/market-summary" | jq '.data[] | select(.assetA.code == "USDC" and .assetB.code == "XLM")'
```

3. **For each pool with the pair, calculate the spread:**

```javascript
const pools = [
  { id: 'poolA', priceXlmPerUsdc: 0.51 },
  { id: 'poolB', priceXlmPerUsdc: 0.50 },
];

const spread = pools[0].priceXlmPerUsdc - pools[1].priceXlmPerUsdc;
const spreadPercent = (spread / pools[1].priceXlmPerUsdc * 100);

if (spreadPercent > 0.5) {
  console.log(`Arbitrage opportunity: ${spreadPercent.toFixed(2)}% spread`);
  // Buy in Pool B at 0.50, sell in Pool A at 0.51, profit 0.01
}
```

4. **Check execution costs:**

Use the price impact endpoint to confirm your arbitrage remains profitable after slippage:

```bash
# Simulate buying 1000 USDC in Pool B
curl -s "https://api.stellarkit.io/dex/price-impact?pool={poolB}&amount=1000&assetIn={usdcCode}:{usdcIssuer}&assetOut=native"

# Then selling that XLM in Pool A
curl -s "https://api.stellarkit.io/dex/price-impact?pool={poolA}&amount={xlmReceived}&assetIn=native&assetOut={usdcCode}:{usdcIssuer}"
```

If profit (outAmount from Pool A - inAmount to Pool B) covers transaction fees, execute the arbitrage.

---

## Integration Best Practices

- **Cache responses:** Fee-history and market data update on a 5–10 second cycle. Cache locally to reduce API calls.
- **Error handling:** Always check for `success: false` in responses. Horizon may be temporarily unavailable.
- **Rate limiting:** StellarKit has rate limits. Batch requests and cache aggressively for production apps.
- **Use `?fresh=true` sparingly:** Only bypass cache when you need real-time data (e.g., executing a trade right now).

---

## Related Endpoints

- [DEX Endpoints Reference](dex-endpoints.md)
- [Liquidity Pool Guide](liquidity-pool-guide.md)
- [Network Fee Estimation](network-endpoints.md)
- [Code Patterns Guide](code-patterns.md)
