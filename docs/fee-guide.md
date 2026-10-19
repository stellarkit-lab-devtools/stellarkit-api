# Fee Guide

Choosing the right fee is one of the most practical decisions developers make when submitting transactions to the Stellar network. Too low and a transaction stalls or drops during congestion. Too high and you overpay on every submission. This guide explains every fee endpoint StellarKit exposes, what the data means, and how to act on it.

---

## What is a Stellar fee?

Every Stellar transaction pays a fee in **stroops** — the smallest unit of XLM (1 XLM = 10,000,000 stroops). A transaction with N operations costs at least `N × base_fee` stroops. When the network is congested, validators use **surge pricing**: they order transactions by the fee offered and include the highest-paying ones first. Transactions that offer too little may be queued or dropped entirely.

### Base fee vs. percentile fees

| Term | What it is | When to use it |
|---|---|---|
| **Base fee** | The protocol minimum — currently 100 stroops per operation. The network can raise this via validator vote. | A floor check. If `baseFeeStroops > 100`, the validator set has raised the minimum. |
| **Percentile fees** (p50, p95, p99) | Distribution of `fee_charged` across recent transactions. p50 is the median; p95 means 95 % of transactions paid this or less. | Choosing a competitive fee. Use p50 for standard submissions, p95 for time-sensitive ones. |
| **Capacity usage** | Percentage of the current ledger's transaction set that is filled (0.0–1.0). | Surge pricing signal. Above ~0.5 the network is entering surge territory. |

The key insight: **base fee is a minimum**, not a recommendation. During surge pricing the effective minimum rises to whatever the lowest-included transaction paid. Always check a live percentile before submitting.

---

## Fee Endpoints

### 1. `GET /fee-estimate`

Returns tiered fee recommendations for a transaction. Accepts an optional `?operations=N` parameter (default 1) and multiplies each tier by N so you get a ready-to-use `max_fee` value.

**Query params**

| Param | Type | Default | Description |
|---|---|---|---|
| `operations` | integer | `1` | Number of operations in your transaction |
| `fresh` | boolean | `false` | Bypass the cache and fetch live from Horizon |

**Response shape**

```json
{
  "success": true,
  "data": {
    "operationCount": 2,
    "networkCongestion": "low",
    "recommendation": "Economy tier is sufficient – network is not congested.",
    "perOperation": {
      "economy":  { "stroops": 100,  "xlm": "0.0000100" },
      "standard": { "stroops": 200,  "xlm": "0.0000200" },
      "priority": { "stroops": 500,  "xlm": "0.0000500" }
    },
    "totalFee": {
      "economy":  { "stroops": 200,  "xlm": "0.0000200" },
      "standard": { "stroops": 400,  "xlm": "0.0000400" },
      "priority": { "stroops": 1000, "xlm": "0.0001000" }
    },
    "networkStats": {
      "lastLedgerBaseFee": "100",
      "ledgerCapacityUsage": "0.12",
      "p50": "200",
      "p95": "500"
    }
  }
}
```

**curl example**

```bash
# Single-operation fee estimate
curl "http://localhost:3000/fee-estimate"

# Three-operation transaction (e.g. payment + two path hops)
curl "http://localhost:3000/fee-estimate?operations=3"

# Force a fresh fetch bypassing the cache
curl "http://localhost:3000/fee-estimate?fresh=true"
```

**How to read it**

- Use `totalFee.standard.stroops` as your `max_fee` for most transactions.
- Use `totalFee.priority.stroops` when you need guaranteed inclusion in the next ledger.
- The `recommendation` string summarises which tier to pick based on current capacity usage.

---

### 2. `GET /fee-estimate/surge-status`

Analyses the last 10 ledgers to decide whether the network is currently in a fee surge. Returns a `suggestedFee` and a plain-English `recommendation`.

**Response shape**

```json
{
  "success": true,
  "data": {
    "isSurging": false,
    "avgCapacityUsage": 0.18,
    "surgeThreshold": 0.5,
    "ledgersAnalyzed": 10,
    "suggestedFee": 100,
    "suggestedFeeInXLM": "0.0000100",
    "recommendation": "Network is operating normally with low congestion. The economy fee tier is sufficient for transaction inclusion.",
    "currentNetworkStats": {
      "lastLedgerBaseFee": "100",
      "ledgerCapacityUsage": "0.18",
      "p50Fee": "200",
      "p95Fee": "500"
    }
  }
}
```

**curl example**

```bash
curl "http://localhost:3000/fee-estimate/surge-status"
```

**When to use it**

Poll this endpoint before submitting high-value or time-sensitive transactions. If `isSurging` is `true`, switch to the priority fee tier immediately. If `avgCapacityUsage` is trending upward across several polls, pre-emptively move to standard even before the threshold is crossed.

---

### 3. `GET /fee-estimate/trends`

Compares the most recent 25 ledgers against the previous 25 to detect whether fees are rising, falling, or stable. Useful for scheduling batch submissions during cheaper windows.

**Response shape**

```json
{
  "success": true,
  "data": {
    "ledgersAnalyzed": 50,
    "avgBaseFee": 112.4,
    "minBaseFee": 100,
    "maxBaseFee": 500,
    "avgCapacityUsage": 0.31,
    "trend": "rising",
    "recommendation": "Fees are rising. Consider using a standard or priority fee to ensure timely transaction inclusion."
  }
}
```

**Trend values**

| Value | Meaning |
|---|---|
| `stable` | Recent and older averages are approximately equal |
| `rising` | Recent average is higher than the older half |
| `falling` | Recent average is lower than the older half |

**curl example**

```bash
curl "http://localhost:3000/fee-estimate/trends"
```

**When to use it**

- Before a batch job: if the trend is `falling`, wait a few seconds. If `rising`, submit at once or use priority.
- In a fee-estimation UI: show users whether fees are going up or down to help them decide when to confirm.

---

### 4. `GET /fee-estimate/recommendation`

> This endpoint is served through `/network/recommended-fee`. It returns explicit low, medium, and high priority tiers with estimated confirmation ledger counts.

```bash
curl "http://localhost:3000/network/recommended-fee"
```

**Response shape**

```json
{
  "success": true,
  "data": {
    "low":    { "feeStroops": "100", "feeXLM": "0.0000100", "estimatedConfirmationLedgers": 1 },
    "medium": { "feeStroops": "200", "feeXLM": "0.0000200", "estimatedConfirmationLedgers": 1 },
    "high":   { "feeStroops": "500", "feeXLM": "0.0000500", "estimatedConfirmationLedgers": 1 }
  }
}
```

`estimatedConfirmationLedgers` rises under surge conditions, giving you a direct latency signal per tier.

---

### 5. `GET /network/fee-history`

Returns per-ledger fee data for recent ledgers, ordered by sequence descending (newest first). Each entry shows the base fee, inferred p50 and p95 fees, and capacity usage for that ledger. Useful for building fee charts and historical analysis tools.

**Query params**

| Param | Type | Default | Max | Description |
|---|---|---|---|---|
| `ledgers` | integer | `20` | `100` | Number of recent ledgers to return |
| `fresh` | boolean | `false` | — | Bypass the cache |

**Response shape**

```json
{
  "success": true,
  "data": {
    "ledgers": [
      {
        "sequence":      52834920,
        "closedAt":      "2026-10-20T14:01:12Z",
        "baseFee":       100,
        "p50Fee":        200,
        "p95Fee":        500,
        "capacityUsage": 0.12
      }
    ],
    "count": 20,
    "limit": 20
  }
}
```

**curl examples**

```bash
# Default — last 20 ledgers
curl "http://localhost:3000/network/fee-history"

# Last 5 ledgers
curl "http://localhost:3000/network/fee-history?ledgers=5"

# Fresh data (bypass cache)
curl "http://localhost:3000/network/fee-history?ledgers=10&fresh=true"
```

**How to read it**

- `baseFee` is the protocol minimum for that ledger (stroops).
- `p50Fee` / `p95Fee` are derived from the global fee stats at the time of the request (they are the same for all entries unless the network stats change between requests).
- `capacityUsage` is the ratio of successful transactions to the maximum transaction set size (0.0–1.0). Values above 0.5 indicate surge conditions.

---

## Fee Strategy by Urgency

### Low urgency — batch jobs, background indexing

Use the **economy** tier. Network fees on Stellar are cheap in absolute terms, but at scale the savings add up.

```
max_fee = base_fee × operation_count
       = 100 × N stroops
```

Check `/fee-estimate/trends` first. If the trend is `rising`, bump to standard.

```bash
# Check whether economy is safe right now
curl "http://localhost:3000/fee-estimate/surge-status"
```

### Medium urgency — standard payments, trustline changes, user-initiated actions

Use the **standard** tier (p50). This is the median fee paid by recent transactions, meaning roughly half of all transactions compete at this level or below. It reliably lands in the next few ledgers under normal conditions.

```bash
curl "http://localhost:3000/fee-estimate?operations=1"
# use data.totalFee.standard.stroops as your max_fee
```

If `networkCongestion` is `"medium"`, consider stepping up to priority.

### High urgency — checkout flows, time-sensitive swaps, account creation, arbitrage

Use the **priority** tier (p95). You are paying more than 95 % of recent transactions, giving you a strong chance of landing in the very next ledger even during mild surge pricing.

```bash
curl "http://localhost:3000/fee-estimate?operations=2"
# use data.totalFee.priority.stroops as your max_fee
```

If `isSurging` is `true` from `/fee-estimate/surge-status`, use the `suggestedFee` returned by that endpoint directly — it may be higher than the static p95 tier.

---

## Combining Endpoints in Practice

A typical fee-selection flow:

1. **On app startup or periodically**, poll `/fee-estimate/surge-status` to get a snapshot of network health. Cache it for 5–10 seconds.
2. **Before each submission**, read the cached snapshot:
   - `isSurging === false` and `avgCapacityUsage < 0.25` → economy
   - `isSurging === false` and `avgCapacityUsage < 0.5` → standard
   - `isSurging === true` or `avgCapacityUsage >= 0.5` → use `suggestedFee` from surge-status
3. **For multi-operation transactions**, multiply the per-operation fee by your operation count. Always use `/fee-estimate?operations=N` to get pre-multiplied totals.
4. **For scheduled batch work**, check `/fee-estimate/trends` and delay submission if the trend is `rising` and urgency is low.

```bash
# Example: resolve fee for a 3-operation time-sensitive swap
SURGE=$(curl -s "http://localhost:3000/fee-estimate/surge-status")
IS_SURGING=$(echo "$SURGE" | jq '.data.isSurging')

if [ "$IS_SURGING" = "true" ]; then
  FEE=$(echo "$SURGE" | jq '.data.suggestedFee')
else
  FEE=$(curl -s "http://localhost:3000/fee-estimate?operations=3" \
        | jq '.data.totalFee.standard.stroops')
fi

echo "Using fee: $FEE stroops"
```

---

## Quick Reference

| Endpoint | Purpose | Typical polling interval |
|---|---|---|
| `GET /fee-estimate` | Tiered fee for N operations | Per transaction or 5 s cache |
| `GET /fee-estimate/surge-status` | Is the network surging right now? | 5–10 s |
| `GET /fee-estimate/trends` | Are fees rising or falling? | 30–60 s |
| `GET /network/recommended-fee` | Low/medium/high tiers with confirmation estimate | 5–10 s |
| `GET /network/fee-history` | Per-ledger historical fee data | On demand / chart refresh |

---

## See Also

- [Network Endpoints Guide](network-endpoints.md) — all network and ledger endpoints
- [Rate Limiting](rate-limiting.md) — avoid hitting the fee endpoints too aggressively
- [Getting Started Guide](getting-started.md) — first-time setup
