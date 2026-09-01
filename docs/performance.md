# Performance Guide

This guide covers latency expectations, cache TTL tuning, Horizon dependency optimization, and how to identify performance bottlenecks in a production StellarKit deployment.

**See also:**
- [Monitoring Guide](monitoring.md) — alert thresholds, tool integrations, and the full monitoring checklist
- [Observability Guide](observability.md) — cache stats, request tracing, and log queries
- [Caching Strategy](caching-strategy.md) — full per-endpoint TTL reference

---

## Table of Contents

1. [Latency Expectations](#1-latency-expectations)
2. [Cache TTL Tuning](#2-cache-ttl-tuning)
3. [Horizon Dependency Optimization](#3-horizon-dependency-optimization)
4. [Identifying Bottlenecks](#4-identifying-bottlenecks)
5. [Scaling Recommendations](#5-scaling-recommendations)

---

## 1. Latency Expectations

Response times in StellarKit API depend on whether a response is served from cache or requires a live Horizon call.

| Request type | Expected P50 | Expected P95 | Notes |
|-------------|-------------|-------------|-------|
| Cache hit | < 5 ms | < 20 ms | Pure in-memory lookup |
| Horizon single-call miss | 200–800 ms | 1 500 ms | Public Horizon latency varies |
| Horizon multi-call miss | 500–2 000 ms | 3 000 ms | Endpoints like `/account/:id/summary` fan out to several Horizon requests |
| Soroban RPC call | 300–1 500 ms | 3 000 ms | Depends on RPC provider |

Alert thresholds (P95 > 2 000 ms warning, P99 > 5 000 ms critical) are defined in the [Monitoring Guide](monitoring.md#3-recommended-alert-thresholds).

---

## 2. Cache TTL Tuning

The cache is the primary lever for controlling Horizon load and improving response times. See [Caching Strategy](caching-strategy.md) for a complete per-endpoint TTL reference.

### General guidance

- **High-traffic deployments:** Increase TTLs for stable data (validators, asset metadata, account balances) to reduce redundant Horizon calls. A 2–5× increase from defaults is reasonable.
- **Low-latency requirements:** Keep fee estimate and price TTLs short (≤ 5 seconds). These endpoints change with every ledger close.
- **Debugging stale data:** Use `?fresh=true` on individual requests to bypass cache without changing TTLs globally.

### Measuring cache effectiveness

```bash
# Check current hit rate
curl -s https://your-api.example.com/cache/stats | jq '.data.hitRate'
```

A sustained hit rate below `0.70` in production means TTLs may be too short. Increase the relevant `CACHE_TTL_*_MS` variables and monitor whether the hit rate recovers. See [Observability Guide](observability.md#1-cache-stats-endpoint) for details on the `/cache/stats` endpoint.

### Example: high-traffic production tuning

```bash
# .env — production TTL overrides for high-traffic deployment
CACHE_TTL_NETWORK_STATUS_MS=10000     # 10s (default: 5s)
CACHE_TTL_BASE_FEE_MS=10000           # 10s (default: 5s)
CACHE_TTL_FEE_ESTIMATE_MS=10000       # 10s (default: 5s)
CACHE_TTL_ASSET_MS=60000              # 60s (default: 30s)
CACHE_TTL_ACCOUNT_MS=20000            # 20s (default: 10s)
CACHE_TTL_VALIDATORS_MS=600000        # 10 min (default: 5 min)
```

---

## 3. Horizon Dependency Optimization

The Stellar Horizon API is StellarKit's only upstream dependency. Its performance directly determines your worst-case response times.

### Public vs. private Horizon

| Option | Latency | Rate limits | Cost |
|--------|---------|-------------|------|
| SDF public Horizon (`horizon.stellar.org`) | 200–800 ms | Shared, can throttle under load | Free |
| Private Horizon instance | 50–200 ms (co-located) | Dedicated | Infrastructure cost |

For high-throughput production workloads, running a private Horizon instance and setting `HORIZON_URL` to point at it significantly reduces tail latency and eliminates shared rate-limit risk.

### Reducing Horizon fan-out

Some StellarKit endpoints make multiple sequential or parallel Horizon requests per call (e.g. `/account/:id/summary`, `/account/:id/risk-score`). For these:

- Set longer cache TTLs so the fan-out only happens on cache misses.
- Avoid calling them in tight loops — batch data at the application layer instead.
- Use the dedicated single-purpose endpoints (e.g. `/account/:id/balances` instead of the full summary) when you only need a subset of the data.

---

## 4. Identifying Bottlenecks

### Step 1 — Find slow endpoints

```bash
# Top 10 slowest endpoint paths by average response time
cat production.ndjson \
  | jq 'select(.responseTimeMs != null) | {path: (.path | split("?")[0]), responseTimeMs}' \
  | jq -s 'group_by(.path) | map({path: .[0].path, avg_ms: (map(.responseTimeMs) | add / length), count: length}) | sort_by(-.avg_ms) | .[0:10]'
```

### Step 2 — Distinguish cache hits from misses

Check the `X-Cache` response header on slow requests:
- `X-Cache: HIT` — the slow response came from cache; investigate application processing overhead.
- `X-Cache: MISS` — the slow response required a Horizon call; investigate Horizon latency.

```bash
curl -I https://your-api.example.com/network-status | grep X-Cache
```

### Step 3 — Check Horizon directly

If StellarKit is slow on cache misses, verify Horizon response time independently:

```bash
time curl -s https://horizon.stellar.org/ > /dev/null
```

If Horizon itself is slow, check https://stellar.statuspage.io and consider routing to a private Horizon instance.

### Step 4 — Check event loop lag

Sustained high CPU or a blocked event loop will cause all requests to slow uniformly, even cache hits. Symptoms:
- All endpoints slow, not just Horizon-dependent ones.
- `responseTimeMs` high even for `/health`.
- Node.js process at high CPU in `pm2 monit` or `docker stats`.

Use [clinic.js](https://clinicjs.org/) or a Node.js APM (Datadog APM, New Relic) to profile the event loop.

---

## 5. Scaling Recommendations

### Vertical scaling

- Default `max_memory_restart` in the PM2 config is `1G`. If heap regularly exceeds 800 MB, increase instance memory before raising this limit.
- StellarKit is I/O-bound (Horizon calls), not CPU-bound. Adding CPU cores helps concurrency but won't fix Horizon latency.

### Horizontal scaling

StellarKit is stateless — no session or shared state between instances. Scale out freely:

```bash
# PM2 cluster mode (uses all CPU cores)
pm2 start ecosystem.config.js --env production
# ecosystem.config.js: instances: 'max', exec_mode: 'cluster'

# Kubernetes: increase replica count
kubectl scale deployment stellarkit-api --replicas=4
```

Note: Each instance has its own in-memory cache. With multiple instances, cache hit rates per-instance will be lower than with a single instance, but aggregate throughput increases. If cache coherence across instances is important, consider replacing the default in-memory cache with a shared Redis cache.

### Rate limit considerations when scaling

The default per-IP rate limits (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`) are tracked in-memory per instance. In a multi-instance deployment behind a load balancer, a single client's requests may hit different instances, effectively multiplying their effective rate limit. If consistent rate limiting across instances is required, use a Redis-backed rate limiter.

---

## Related Documentation

- [Monitoring Guide](monitoring.md) — Alert thresholds and tool integrations
- [Observability Guide](observability.md) — Cache stats endpoint and log queries
- [Caching Strategy](caching-strategy.md) — Full per-endpoint TTL reference and `?fresh=true` usage
- [Deployment Guide](deployment.md) — PM2 cluster mode, Docker, and Kubernetes configuration
- [Rate Limiting](rate-limiting.md) — Rate limit configuration and retry strategies
