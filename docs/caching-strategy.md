# StellarKit API Caching Strategy

This guide explains the caching philosophy and per-endpoint cache configuration used by StellarKit API. Understanding cache TTLs helps developers make informed decisions about when to use the `fresh` parameter and how to configure cache behavior for their deployment.

---

## Table of Contents

1. [Caching Philosophy](#caching-philosophy)
2. [Cache Configuration](#cache-configuration)
3. [Cached Endpoints Reference](#cached-endpoints-reference)
4. [Using the Fresh Parameter](#using-the-fresh-parameter)
5. [Custom Cache TTL Configuration](#custom-cache-ttl-configuration)

---

## Caching Philosophy

StellarKit API caches responses from the Stellar Horizon API to reduce latency and minimize load on upstream servers. Cache TTLs are chosen based on:

- **Data volatility**: How frequently the underlying data changes
- **User expectations**: Balance between freshness and performance
- **Network impact**: Minimize redundant calls to Horizon for immutable or slow-changing data

### When to Use Short TTLs (≤ 5 seconds)

Use short TTLs for data that changes frequently and where staleness impacts user experience:
- Fee estimates (network congestion changes rapidly)
- Network base fee (updates with each ledger close)
- DEX arbitrage opportunities (market conditions shift quickly)
- Asset prices (real-time market data)

### When to Use Medium TTLs (15-30 seconds)

Use medium TTLs for data that changes occasionally but isn't time-critical:
- Account effects (historical data, append-only)
- Asset metadata (issuer information changes rarely)
- Pool positions (updates only on liquidity events)
- Claimable balances (changes only on create/claim operations)

### When to Use Long TTLs (≥ 1 minute)

Use long TTLs for data that changes very rarely:
- Network validators (validator set changes infrequently)
- DEX top markets (aggregated over longer time windows)

---

## Cache Configuration

All cache TTLs are configurable via environment variables (in milliseconds). If no environment variable is set, the default value is used.

**Global Fallback:**
```bash
CACHE_TTL_MS=5000  # Default for endpoints without specific config (5 seconds)
```

See [Cached Endpoints Reference](#cached-endpoints-reference) below for per-endpoint configuration.

---

## Cached Endpoints Reference

| Endpoint | Default TTL | Env Variable | Rationale |
|----------|-------------|--------------|-----------|
| `/network-status` | 5 sec | `CACHE_TTL_NETWORK_STATUS_MS` | Updates every ledger close (~5s on mainnet) |
| `/network/base-fee` | 5 sec | `CACHE_TTL_BASE_FEE_MS` | Base fee can change each ledger during congestion |
| `/network/fee-percentiles` | 5 sec | `CACHE_TTL_BASE_FEE_MS` | Fee distribution updates with each ledger |
| `/network/validators` | 300 sec (5 min) | `CACHE_TTL_VALIDATORS_MS` | Validator list changes infrequently |
| `/fee-estimate` | 5 sec | `CACHE_TTL_FEE_ESTIMATE_MS` | Network congestion changes rapidly |
| `/fee-estimate/surge-status` | 5 sec | `CACHE_TTL_FEE_ESTIMATE_MS` | Surge detection requires recent data |
| `/fee-estimate/trends` | 5 sec | `CACHE_TTL_FEE_ESTIMATE_MS` | Historical trends updated each ledger |
| `/asset/:code/:issuer` | 30 sec | `CACHE_TTL_ASSET_MS` | Asset metadata changes rarely |
| `/asset/:code/:issuer/price` | 5 sec | `CACHE_TTL_ASSET_PRICE_MS` | Market prices update frequently |
| `/asset/:code/:issuer/holders` | 30 sec | `CACHE_TTL_ASSET_HOLDERS_MS` | Holder count changes gradually |
| `/account/:id` | 10 sec | `CACHE_TTL_ACCOUNT_MS` | Account state changes on transactions |
| `/account/:id/sequence` | 20 sec | `CACHE_TTL_SEQUENCE_MS` | Sequence increments only on account transactions |
| `/account/:id/claimable-balances` | 20 sec | `CACHE_TTL_CLAIMABLE_BALANCES_MS` | Changes only on create/claim operations |
| `/account/:id/effects` | 30 sec | `CACHE_TTL_EFFECTS_MS` | Historical ledger effects are immutable |
| `/account/:id/signing-keys` | 20 sec | `CACHE_TTL_SIGNING_KEYS_MS` | Signers change only via set_options operations |
| `/account/:id/pool-positions` | 15 sec | `CACHE_TTL_POOL_POSITIONS_MS` | Updates only on join/exit liquidity pool events |
| `/account/:id/transaction-count` | 20 sec | `CACHE_TTL_TX_COUNT_MS` | Increments only on new transactions |
| `/dex/top-markets` | 60 sec | `CACHE_TTL_TOP_MARKETS_MS` | Trade aggregation over longer time windows |
| `/dex/arbitrage` | 5 sec | `CACHE_TTL_ARBITRAGE_MS` | Arbitrage opportunities expire quickly |
| `/soroban/contract/:id/storage` | 15 sec | `CACHE_TTL_CONTRACT_STORAGE_MS` | Contract storage updates on invocations |

---

## Using the Fresh Parameter

Most cached endpoints support a `fresh` query parameter to bypass the cache and fetch live data from Horizon.

**Syntax:**
```
GET /endpoint?fresh=true
```

**Response Headers:**
- `X-Cache: HIT` — Response served from cache
- `X-Cache: MISS` — Response fetched from Horizon and cached

**Example:**
```bash
# Use cached data (if available)
curl "https://api.stellarkit.io/fee-estimate"

# Force fresh data from Horizon
curl "https://api.stellarkit.io/fee-estimate?fresh=true"
```

**When to use `fresh=true`:**
- Real-time transaction submission (fee estimates must be current)
- Post-transaction validation (checking sequence number after submission)
- Time-sensitive operations (asset prices, arbitrage detection)
- Debugging stale data issues

**When NOT to use `fresh=true`:**
- Displaying historical data (effects, transactions)
- Bulk queries or background processing
- User-facing dashboards (cached data is sufficient)

---

## Custom Cache TTL Configuration

To customize cache TTLs for your deployment, set the corresponding environment variables in your `.env` file:

```bash
# Network endpoints (milliseconds)
CACHE_TTL_NETWORK_STATUS_MS=5000
CACHE_TTL_BASE_FEE_MS=5000
CACHE_TTL_VALIDATORS_MS=300000

# Fee estimation endpoints
CACHE_TTL_FEE_ESTIMATE_MS=5000

# Asset endpoints
CACHE_TTL_ASSET_MS=30000
CACHE_TTL_ASSET_PRICE_MS=5000
CACHE_TTL_ASSET_HOLDERS_MS=30000

# Account endpoints
CACHE_TTL_ACCOUNT_MS=10000
CACHE_TTL_SEQUENCE_MS=20000
CACHE_TTL_CLAIMABLE_BALANCES_MS=20000
CACHE_TTL_EFFECTS_MS=30000
CACHE_TTL_SIGNING_KEYS_MS=20000
CACHE_TTL_POOL_POSITIONS_MS=15000
CACHE_TTL_TX_COUNT_MS=20000

# DEX endpoints
CACHE_TTL_TOP_MARKETS_MS=60000
CACHE_TTL_ARBITRAGE_MS=5000

# Soroban endpoints
CACHE_TTL_CONTRACT_STORAGE_MS=15000

# Global fallback (used when specific TTL not set)
CACHE_TTL_MS=5000
```

**Tips:**
- For high-traffic production deployments, increase TTLs to reduce Horizon load
- For development or testing, decrease TTLs to see changes more quickly
- Monitor cache hit rates via `/cache-stats` endpoint to tune TTL values

---

## Related Documentation

- [Environment Configuration](environment-configuration.md) — All configuration options
- [API Design Guidelines](api-design.md) — Response format and conventions
- [Response Format Guide](response-format.md) — Standard response envelopes

---

**Note:** Cache configuration is defined in `src/config/cacheConfig.js`. The cached response metadata is always indicated via the `X-Cache` response header.
