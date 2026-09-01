# Observability Guide

This guide covers the runtime visibility tools built into StellarKit API: the cache stats endpoint, request tracing via `requestId`, and a structured field reference for querying production logs.

**See also:**
- [Monitoring Guide](monitoring.md) — alert thresholds, tool integrations, and the full monitoring checklist
- [Logging Guide](logging.md) — Pino configuration, log levels, and log aggregation setup
- [Performance Guide](performance.md) — cache TTL tuning and latency optimization

---

## Table of Contents

1. [Cache Stats Endpoint](#1-cache-stats-endpoint)
2. [Request Tracing](#2-request-tracing)
3. [Structured Log Field Reference](#3-structured-log-field-reference)
4. [Useful Log Queries](#4-useful-log-queries)

---

## 1. Cache Stats Endpoint

`GET /cache/stats` returns a live snapshot of cache performance. Use this to measure how effectively the cache is absorbing Horizon load.

```bash
curl https://your-api.example.com/cache/stats
```

```json
{
  "success": true,
  "data": {
    "hits": 9420,
    "misses": 580,
    "hitRate": 0.942,
    "size": 87
  }
}
```

| Field | Description |
|-------|-------------|
| `hits` | Cumulative requests served from cache since last restart |
| `misses` | Cumulative requests that bypassed cache (live Horizon calls) |
| `hitRate` | `hits / (hits + misses)` — target ≥ 0.70 in production |
| `size` | Number of entries currently held in cache |

A `hitRate` below `0.70` sustained for more than 15 minutes suggests cache TTLs may be too short for your traffic volume, or requests are being made with `?fresh=true` too frequently. See [Caching Strategy](caching-strategy.md) and [Performance Guide](performance.md) for tuning guidance.

---

## 2. Request Tracing

Every request through StellarKit is assigned a unique `requestId`. This ID appears in the response body and in every log line generated during that request, making it possible to trace a single call end-to-end across distributed systems.

### How request IDs are assigned

- If the caller sends an `X-Request-ID` header, that value is used as the request ID.
- If no header is present, a random UUID is generated.

```bash
# Provide your own trace ID
curl -H "X-Request-ID: my-trace-001" https://your-api.example.com/network-status
```

```json
{
  "success": true,
  "data": { ... },
  "requestId": "my-trace-001"
}
```

### Finding a request in logs

```bash
# jq — find all log lines for a specific request
cat production.ndjson | jq 'select(.requestId == "my-trace-001")'
```

```
# Kibana KQL
requestId: "my-trace-001"

# Datadog
@requestId:my-trace-001

# CloudWatch Insights
fields @timestamp, method, path, statusCode, responseTimeMs
| filter requestId = "my-trace-001"
```

---

## 3. Structured Log Field Reference

When `NODE_ENV=production`, every log line is a JSON object. The fields below are present on all HTTP request log entries.

| Field | Type | Description |
|-------|------|-------------|
| `level` | number | Pino severity: `10` trace · `20` debug · `30` info · `40` warn · `50` error · `60` fatal |
| `time` | number | Unix timestamp in milliseconds |
| `pid` | number | Node.js process ID |
| `hostname` | string | Server hostname — useful when running multiple replicas |
| `requestId` | string | Unique request identifier (UUID or custom `X-Request-ID`) |
| `method` | string | HTTP verb: `GET`, `POST`, etc. |
| `path` | string | Full path including query string |
| `statusCode` | number | HTTP response status code |
| `responseTimeMs` | number | Request duration from receipt to response, in milliseconds |
| `msg` | string | Human-readable summary: `[requestId] METHOD path statusCode Xms` |

Error log entries add:

| Field | Type | Description |
|-------|------|-------------|
| `status` | number | HTTP status code (mirrors `statusCode`) |
| `error.type` | string | StellarKit error type, e.g. `HorizonError`, `ValidationError` |

---

## 4. Useful Log Queries

### Count requests by status code class

```bash
cat production.ndjson \
  | jq -r '(.statusCode / 100 | floor | tostring) + "xx"' \
  | sort | uniq -c | sort -rn
```

### Identify the slowest endpoints

```bash
cat production.ndjson \
  | jq 'select(.responseTimeMs != null) | {path, responseTimeMs}' \
  | jq -s 'group_by(.path) | map({path: .[0].path, avg_ms: (map(.responseTimeMs) | add / length)}) | sort_by(-.avg_ms) | .[0:10]'
```

### Find all requests that triggered a 429

```bash
cat production.ndjson | jq 'select(.statusCode == 429) | {time, path, requestId}'
```

### Spot HorizonError bursts

```bash
cat production.ndjson \
  | jq 'select(.msg | test("HorizonError"; "i")) | (.time / 60000 | floor)' \
  | sort | uniq -c
# Output: count per minute — look for spikes
```

---

## Related Documentation

- [Monitoring Guide](monitoring.md) — Complete monitoring setup, alert thresholds, and tool integrations
- [Logging Guide](logging.md) — Log levels, configuration, and log aggregation
- [Performance Guide](performance.md) — Cache TTL tuning and latency optimization
- [Caching Strategy](caching-strategy.md) — Per-endpoint TTLs and `?fresh=true` usage
