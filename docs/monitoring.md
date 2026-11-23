# Production Monitoring Guide

This guide covers everything you need to run StellarKit API confidently in production: which metrics matter, what thresholds to alert on, how to wire up common monitoring stacks, and a checklist to verify your setup before going live.

**See also:**
- [Observability Guide](observability.md) — cache stats endpoint, request tracing, and structured log queries
- [Performance Guide](performance.md) — latency budgets, Horizon dependency tuning, and cache TTL optimization
- [Logging Guide](logging.md) — Pino log structure, fields, and log aggregation setup
- [Deployment Guide](deployment.md) — health check probe configuration for Kubernetes, Docker, and PaaS platforms

---

## Table of Contents

1. [Health Check Endpoint](#1-health-check-endpoint)
2. [Key Metrics to Watch](#2-key-metrics-to-watch)
3. [Recommended Alert Thresholds](#3-recommended-alert-thresholds)
4. [Health Check Polling Strategy](#4-health-check-polling-strategy)
5. [Integration Patterns](#5-integration-patterns)
   - [Prometheus + Grafana](#51-prometheus--grafana)
   - [Datadog](#52-datadog)
   - [AWS CloudWatch](#53-aws-cloudwatch)
   - [Uptime monitoring (UptimeRobot / BetterUptime)](#54-uptime-monitoring)
   - [PagerDuty / OpsGenie alerting](#55-pagerduty--opsgenie)
6. [Log-Based Monitoring](#6-log-based-monitoring)
7. [Horizon Upstream Monitoring](#7-horizon-upstream-monitoring)
8. [Monitoring Checklist](#8-monitoring-checklist)

---

## 1. Health Check Endpoint

The primary health signal is `GET /health`. Poll this endpoint from every monitoring layer — load balancers, uptime checkers, and synthetic monitors.

```bash
curl https://your-api.example.com/health
```

### Healthy response (`200 OK`)

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "StellarKit API",
    "version": "1.0.0",
    "timestamp": "2026-08-28T10:30:00.000Z",
    "network": "mainnet"
  }
}
```

### What to validate

| Field | Expected value | Why it matters |
|-------|---------------|----------------|
| HTTP status | `200` | Anything else means the process is unhealthy or not listening |
| `success` | `true` | A `200` with `success: false` indicates a partial failure |
| `data.status` | `"ok"` | Explicit status string — check this, not just HTTP status |
| `data.network` | `"mainnet"` (in production) | Guards against accidental testnet deployments |

The `/health` endpoint is intentionally excluded from rate limiting so monitoring traffic never gets throttled.

---

## 2. Key Metrics to Watch

### 2.1 Application availability

| Metric | Source | Description |
|--------|--------|-------------|
| **Uptime / health check pass rate** | `/health` polling | Percentage of health checks that return `200 ok` over a rolling window |
| **Process restart count** | PM2 / Docker / K8s | How many times the process has crashed and restarted |
| **Active instance count** | PM2 cluster / K8s replicas | Drop in running instances signals a crash loop |

### 2.2 Request throughput and errors

All HTTP request data flows through Pino's structured logs. Each log line contains `statusCode`, `responseTimeMs`, `method`, `path`, and `requestId`.

| Metric | How to derive it | Description |
|--------|-----------------|-------------|
| **Requests per minute (RPM)** | Count log lines per minute | Overall traffic volume |
| **Error rate (5xx)** | `statusCode >= 500` / total requests | Percentage of server-side failures |
| **Client error rate (4xx)** | `statusCode >= 400 AND < 500` / total requests | High rate may indicate bad clients or misconfiguration |
| **Rate limit hit rate (429)** | `statusCode == 429` / total requests | Clients hitting limits — may need limit tuning |
| **P50 / P95 / P99 response time** | `responseTimeMs` percentiles | Tail latency reveals Horizon bottlenecks before averages do |

### 2.3 Horizon upstream health

StellarKit proxies the Stellar Horizon API. Horizon degradation surfaces as elevated response times and 5xx errors from StellarKit.

| Metric | Source | Description |
|--------|--------|-------------|
| **Horizon response time** | `responseTimeMs` on slow requests | High values indicate upstream slowness |
| **HorizonError count** | `error.type == "HorizonError"` in logs | Errors propagated from Horizon |
| **Stellar network status** | `GET /network-status` | Ledger close time, protocol version — deviation signals network issues |
| **Stellar status page** | https://stellar.statuspage.io | Canonical upstream incident source |

### 2.4 Cache performance

The cache reduces Horizon load. A significant drop in hit rate means more traffic is hitting Horizon directly.

| Metric | Source | Description |
|--------|--------|-------------|
| **Cache hit rate** | `GET /cache/stats` → `hitRate` | Percentage of requests served from cache |
| **Cache miss rate** | `1 - hitRate` | Each miss is a live Horizon call |
| **Cache entry count** | `GET /cache/stats` → `size` | Unexpected growth may indicate a key leak |

```bash
# Sample cache stats response
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

### 2.5 Process-level resources

| Metric | Source | Description |
|--------|--------|-------------|
| **Heap memory usage** | PM2 monit / Docker stats / Node.js metrics | `max_memory_restart` in PM2 triggers a restart at 1 GB by default |
| **CPU utilization** | PM2 / container metrics | Sustained >80% per-core signals need to scale out |
| **Event loop lag** | Node.js APM (clinic.js, Datadog APM) | High lag means the JS thread is blocked — investigate synchronous work |
| **Open file descriptors** | OS metrics | Exhaustion causes new connections to fail |

---

## 3. Recommended Alert Thresholds

These thresholds are starting points. Tune them against your actual baseline traffic after running for a week.

### Availability alerts (page immediately)

| Condition | Threshold | Severity | Notes |
|-----------|-----------|----------|-------|
| Health check failures | ≥ 2 consecutive failures | **Critical** | Use a 30s poll interval; two failures = ~1 min of downtime |
| HTTP 5xx error rate | > 5% over 5 minutes | **Critical** | Persistent server errors need immediate investigation |
| Process restart count | ≥ 3 restarts in 10 minutes | **Critical** | Crash loop in progress |
| Instance count below expected | Any instance missing | **Critical** | At least one replica must always be running |

### Performance alerts (notify, may not page)

| Condition | Threshold | Severity | Notes |
|-----------|-----------|----------|-------|
| P95 response time | > 2 000 ms over 5 minutes | **Warning** | Likely Horizon slowness; check upstream |
| P99 response time | > 5 000 ms over 5 minutes | **Critical** | Severe latency — check for cascading failures |
| HTTP 4xx error rate | > 10% over 10 minutes | **Warning** | High volume may indicate a broken client or bad deploy |
| 429 rate limit hit rate | > 2% over 10 minutes | **Warning** | Clients are being throttled; consider raising `RATE_LIMIT_MAX` |

### Resource alerts

| Condition | Threshold | Severity | Notes |
|-----------|-----------|----------|-------|
| Heap memory usage | > 800 MB per instance | **Warning** | Approaching the 1 GB PM2 restart threshold |
| CPU usage | > 80% sustained for 5 minutes | **Warning** | Scale out or investigate hot paths |
| Cache hit rate | < 70% over 15 minutes | **Warning** | Cache may have been cleared or TTLs are too short |

### Horizon upstream alerts

| Condition | Threshold | Severity | Notes |
|-----------|-----------|----------|-------|
| `HorizonError` log count | > 10 per minute | **Warning** | Horizon instability; check https://stellar.statuspage.io |
| `/network-status` ledger age | > 30 seconds behind current time | **Warning** | Horizon is not receiving new ledgers |
| `GET /network-status` response time | > 3 000 ms | **Warning** | Horizon endpoint is degraded |

---

## 4. Health Check Polling Strategy

Use a layered polling strategy: fast checks for load balancers, moderate for uptime monitoring, and synthetic end-to-end tests for full-stack validation.

### Layer 1 — Load balancer / orchestrator probes (every 10–30 seconds)

These probes control traffic routing. A failed probe removes the instance from rotation.

```yaml
# Kubernetes liveness + readiness probes
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3        # 3 failures = 90 seconds before restart

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3        # 3 failures = 30 seconds before traffic removal
```

```dockerfile
# Docker HEALTHCHECK
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

### Layer 2 — External uptime monitor (every 1–5 minutes)

An external check confirms reachability from outside your infrastructure — it catches DNS failures, firewall issues, and TLS certificate expiry that internal probes miss.

- **Endpoint:** `GET https://your-api.example.com/health`
- **Expected status:** `200`
- **Response body assertion:** `"status":"ok"` and `"network":"mainnet"`
- **Timeout:** 10 seconds
- **Alert after:** 2 consecutive failures

Recommended tools: UptimeRobot (free tier, 5-minute interval), BetterUptime (1-minute interval), Pingdom, Checkly.

### Layer 3 — Synthetic end-to-end test (every 5–15 minutes)

A synthetic test exercises a real API path beyond `/health` to confirm Horizon connectivity is live.

```bash
# Minimal synthetic check: confirms Horizon connectivity
curl -f -s "https://your-api.example.com/network-status" \
  | jq -e '.data.ledger.sequence > 0'

# More thorough: confirm a known mainnet account responds
curl -f -s "https://your-api.example.com/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" \
  | jq -e '.success == true'
```

Alert if either check fails or takes longer than 5 seconds to respond.

### Layer 4 — `/cache/stats` periodic snapshot (every 5 minutes)

Poll cache stats and push to your metrics pipeline:

```bash
curl -s https://your-api.example.com/cache/stats \
  | jq '{hitRate: .data.hitRate, size: .data.size}'
```

Alert if `hitRate` drops below `0.70` sustained for more than 15 minutes.

---

## 5. Integration Patterns

### 5.1 Prometheus + Grafana

StellarKit does not expose a native `/metrics` endpoint, but you can scrape metrics from two sources: a Prometheus exporter sidecar for Node.js process metrics, and a custom scrape job that hits `/health` and `/cache/stats`.

#### Option A — `prom-client` integration (recommended)

Add `prom-client` to the application and expose a `/metrics` endpoint:

```bash
npm install prom-client
```

```js
// src/metrics.js
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom: cache hit rate gauge
const cacheHitRate = new client.Gauge({
  name: 'stellarkit_cache_hit_rate',
  help: 'Cache hit rate (0–1)',
  registers: [register],
});

// Custom: http request duration histogram
const httpDuration = new client.Histogram({
  name: 'stellarkit_http_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

module.exports = { register, cacheHitRate, httpDuration };
```

```js
// In src/index.js — add metrics endpoint
const { register } = require('./metrics');

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

#### Option B — Blackbox exporter (no code changes)

Use the [Prometheus Blackbox Exporter](https://github.com/prometheus/blackbox_exporter) to probe `/health` externally:

```yaml
# prometheus.yml scrape config
scrape_configs:
  - job_name: stellarkit_health
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - https://your-api.example.com/health
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

#### Grafana dashboard panels

| Panel | Query (PromQL) | Visualization |
|-------|---------------|---------------|
| Uptime | `probe_success{job="stellarkit_health"}` | Stat (0/1) |
| P95 response time | `histogram_quantile(0.95, rate(stellarkit_http_duration_seconds_bucket[5m]))` | Time series |
| Error rate | `rate(stellarkit_http_duration_seconds_count{status_code=~"5.."}[5m]) / rate(stellarkit_http_duration_seconds_count[5m])` | Time series |
| Cache hit rate | `stellarkit_cache_hit_rate` | Gauge (0–1) |
| Heap memory | `process_heap_bytes` | Time series |

---

### 5.2 Datadog

#### Log pipeline

With `NODE_ENV=production`, StellarKit emits NDJSON. Wire it to the Datadog Agent log intake:

```yaml
# /etc/datadog-agent/conf.d/stellarkit.d/conf.yaml
logs:
  - type: file
    path: /var/log/stellarkit-api/combined.log
    service: stellarkit-api
    source: nodejs
    sourcecategory: sourcecode
```

Or, for containerized deployments, set the Docker log labels:

```yaml
# docker-compose.prod.yml
services:
  stellarkit-api:
    labels:
      com.datadoghq.ad.logs: '[{"source":"nodejs","service":"stellarkit-api"}]'
```

#### Datadog monitors

**High error rate:**
```
avg(last_5m):sum:trace.express.request.hits{service:stellarkit-api,http.status_code:5*}.as_rate() /
sum:trace.express.request.hits{service:stellarkit-api}.as_rate() > 0.05
```

**P95 latency:**
```
avg(last_5m):p95:trace.express.request{service:stellarkit-api} > 2000
```

**Health check down:**
```
# Synthetics test on https://your-api.example.com/health
# Alert condition: test failure ≥ 2 consecutive runs
```

**Log-based monitor — HorizonError spike:**
```
logs("service:stellarkit-api \"HorizonError\"").rollup("count").last("5m") > 10
```

#### APM setup

```bash
npm install dd-trace
```

```js
// At the very top of src/index.js, before any other require()
require('dd-trace').init({
  service: 'stellarkit-api',
  env: process.env.NODE_ENV,
  version: process.env.npm_package_version,
});
```

This gives you distributed traces, flame graphs, and automatic correlation between APM traces and logs via `requestId`.

---

### 5.3 AWS CloudWatch

#### Log group setup

Ship Pino JSON logs to a CloudWatch Log Group, then use Metric Filters to extract numeric metrics:

```bash
# Create log group
aws logs create-log-group --log-group-name /stellarkit-api/production

# Create metric filter: P95 response time
aws logs put-metric-filter \
  --log-group-name /stellarkit-api/production \
  --filter-name ResponseTime \
  --filter-pattern '{ $.responseTimeMs = * }' \
  --metric-transformations \
    metricName=ResponseTimeMs,metricNamespace=StellarKit,metricValue='$.responseTimeMs'

# Create metric filter: error count
aws logs put-metric-filter \
  --log-group-name /stellarkit-api/production \
  --filter-name ErrorCount \
  --filter-pattern '{ $.statusCode >= 500 }' \
  --metric-transformations \
    metricName=ErrorCount,metricNamespace=StellarKit,metricValue=1,defaultValue=0
```

#### CloudWatch Alarms

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "StellarKit-HighErrorRate" \
  --metric-name ErrorCount \
  --namespace StellarKit \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:stellarkit-alerts

# P95 latency alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "StellarKit-HighLatency" \
  --metric-name ResponseTimeMs \
  --namespace StellarKit \
  --extended-statistic p95 \
  --period 300 \
  --threshold 2000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:stellarkit-alerts
```

#### CloudWatch Insights queries

```
# Top slow endpoints in the last hour
fields path, responseTimeMs
| filter responseTimeMs > 1000
| stats avg(responseTimeMs) as avg_ms, count() as request_count by path
| sort avg_ms desc
| limit 20

# Error breakdown by type
fields @timestamp, error.type, path
| filter statusCode >= 500
| stats count() as occurrences by error.type, path
| sort occurrences desc

# 429 rate-limit events by path
fields path, @timestamp
| filter statusCode = 429
| stats count() as throttled_requests by path
| sort throttled_requests desc
```

---

### 5.4 Uptime Monitoring

External uptime monitors are your last line of defense — they catch outages that internal tooling can miss.

#### UptimeRobot (free tier)

1. Add a new **HTTP(s)** monitor
2. **URL:** `https://your-api.example.com/health`
3. **Monitoring Interval:** 5 minutes (1 minute on paid plans)
4. **Keyword:** `"status":"ok"` (keyword present = up)
5. Alert contacts: email, Slack webhook, PagerDuty

#### BetterUptime

```bash
# BetterUptime also supports response time SLA tracking and on-call routing
# Configure via dashboard or API:
POST https://betteruptime.com/api/v2/monitors
{
  "url": "https://your-api.example.com/health",
  "monitor_type": "keyword",
  "required_keyword": "\"status\":\"ok\"",
  "check_frequency": 60,
  "request_timeout": 10,
  "call": false,
  "sms": false,
  "email": true
}
```

#### Checkly (with assertions)

Checkly supports full assertion chains, useful for verifying the `network` field:

```js
// checkly check script
const { expect } = require('@playwright/test');

const response = await fetch('https://your-api.example.com/health');
const body = await response.json();

expect(response.status).toBe(200);
expect(body.success).toBe(true);
expect(body.data.status).toBe('ok');
expect(body.data.network).toBe('mainnet');  // Guards against testnet slip
```

---

### 5.5 PagerDuty / OpsGenie

Route critical alerts (health down, 5xx spike, process crash loop) to an on-call rotation.

#### PagerDuty integration via webhook

Most monitoring tools (UptimeRobot, Datadog, CloudWatch) have native PagerDuty integrations. For a manual webhook from any HTTP-capable alerting tool:

```bash
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "YOUR_INTEGRATION_KEY",
    "event_action": "trigger",
    "payload": {
      "summary": "StellarKit API health check failed",
      "severity": "critical",
      "source": "https://your-api.example.com/health",
      "custom_details": {
        "environment": "production",
        "network": "mainnet"
      }
    }
  }'
```

#### Alert severity routing recommendations

| Alert | Severity | Route to |
|-------|----------|----------|
| Health check down 2+ checks | Critical | On-call engineer (page immediately) |
| 5xx rate > 5% for 5 min | Critical | On-call engineer |
| Process crash loop | Critical | On-call engineer |
| P95 latency > 2 000 ms | Warning | Slack `#alerts` channel |
| Cache hit rate < 70% | Warning | Slack `#alerts` channel |
| Horizon status page incident | Info | Slack `#stellar-status` channel |

---

## 6. Log-Based Monitoring

StellarKit's structured Pino logs are the richest source of operational data. The following queries work in any system that ingests the NDJSON output.

### Fields available in every request log

| Field | Type | Example |
|-------|------|---------|
| `level` | number | `50` (error), `30` (info) |
| `time` | number | Unix ms timestamp |
| `requestId` | string | UUID or custom `X-Request-ID` |
| `method` | string | `"GET"` |
| `path` | string | `"/account/GABC123"` |
| `statusCode` | number | `200`, `429`, `500` |
| `responseTimeMs` | number | `45.123` |

### Essential log queries

**Error rate over time (jq, local):**
```bash
# Count 5xx per minute from a log file
cat production.ndjson \
  | jq -r 'select(.statusCode >= 500) | (.time / 60000 | floor | tostring)' \
  | sort | uniq -c
```

**Slow requests above 1 second:**
```bash
cat production.ndjson | jq 'select(.responseTimeMs > 1000) | {path, responseTimeMs, requestId}'
```

**Rate limit events by path:**
```bash
cat production.ndjson \
  | jq 'select(.statusCode == 429) | .path' \
  | sort | uniq -c | sort -rn
```

**HorizonError occurrences:**
```bash
cat production.ndjson | jq 'select(.msg | test("HorizonError"))' | wc -l
```

**Elasticsearch / Kibana KQL:**
```
statusCode >= 500 and responseTimeMs > 1000
```

**Datadog log search:**
```
service:stellarkit-api @statusCode:>=500
```

**CloudWatch Insights:**
```
fields @timestamp, path, statusCode, responseTimeMs
| filter statusCode >= 500
| sort @timestamp desc
| limit 100
```

---

## 7. Horizon Upstream Monitoring

StellarKit depends on the Stellar Horizon API. Horizon incidents will surface as elevated response times and `HorizonError` log entries before they appear on the Stellar status page.

### Early-warning signals

1. **Rising `responseTimeMs` on `/network-status`** — this endpoint has a 5-second cache TTL; slow responses on cache misses point to Horizon.
2. **`HorizonError` log entries** — filter for `"HorizonError"` in your log aggregator and alert if the count exceeds 10 per minute.
3. **Ledger close time deviation** — `GET /network-status` returns `data.ledger.closedAt`; if the timestamp is more than 30 seconds behind wall-clock time, Horizon is not receiving new ledgers.

### Polling network status for upstream health

```bash
# Simple shell check: alert if ledger is stale
LEDGER_TIME=$(curl -sf https://your-api.example.com/network-status \
  | jq -r '.data.ledger.closedAt')
LEDGER_EPOCH=$(date -d "$LEDGER_TIME" +%s 2>/dev/null || \
               date -jf "%Y-%m-%dT%H:%M:%S" "${LEDGER_TIME%.*}" +%s)
NOW_EPOCH=$(date +%s)
STALENESS=$(( NOW_EPOCH - LEDGER_EPOCH ))

if [ "$STALENESS" -gt 30 ]; then
  echo "WARNING: ledger is ${STALENESS}s stale"
fi
```

### Stellar status page

Subscribe to incident notifications at **https://stellar.statuspage.io** via email, RSS, or webhook. When a Horizon incident is posted there, acknowledge your corresponding StellarKit alert as expected behavior and wait for Stellar SDF to resolve it — there is nothing to fix on the StellarKit side during a pure Horizon outage.

### Custom Horizon endpoint

If you run a private Horizon instance (set via `HORIZON_URL`), add its health endpoint to your uptime monitors directly in addition to monitoring StellarKit's `/health`. This distinguishes StellarKit process failures from Horizon failures.

---

## 8. Monitoring Checklist

Work through this checklist before your production launch and revisit it after any significant infrastructure change.

### Health checks
- [ ] `GET /health` responds `200` with `"status":"ok"` and `"network":"mainnet"`
- [ ] Load balancer / orchestrator liveness probe configured (`periodSeconds: 30`, `failureThreshold: 3`)
- [ ] Load balancer / orchestrator readiness probe configured (`periodSeconds: 10`, `failureThreshold: 3`)
- [ ] External uptime monitor polling `/health` every 1–5 minutes from outside your infrastructure
- [ ] Uptime monitor asserts `"network":"mainnet"` in response body

### Alerting
- [ ] Critical alert: health check fails 2+ consecutive checks → pages on-call
- [ ] Critical alert: 5xx error rate > 5% over 5 minutes → pages on-call
- [ ] Critical alert: process restart count ≥ 3 in 10 minutes → pages on-call
- [ ] Warning alert: P95 response time > 2 000 ms → Slack notification
- [ ] Warning alert: heap memory > 800 MB → Slack notification
- [ ] Warning alert: cache hit rate < 70% sustained → Slack notification
- [ ] Warning alert: `HorizonError` count > 10 per minute → Slack notification
- [ ] Stellar status page subscription configured (https://stellar.statuspage.io)

### Log pipeline
- [ ] `NODE_ENV=production` set so logs emit as NDJSON
- [ ] Logs shipped to centralized aggregator (Datadog, Elastic, CloudWatch, Loki)
- [ ] Log retention policy set (minimum 30 days recommended)
- [ ] `requestId` indexed for fast trace lookup
- [ ] `responseTimeMs` and `statusCode` indexed as numeric fields for aggregation

### Metrics and dashboards
- [ ] Request throughput (RPM) visible on dashboard
- [ ] P50 / P95 / P99 response time visible on dashboard
- [ ] 5xx error rate visible on dashboard
- [ ] Cache hit rate visible on dashboard (sourced from `/cache/stats`)
- [ ] Heap memory and CPU usage visible on dashboard

### Horizon upstream
- [ ] Synthetic check on `GET /network-status` every 5 minutes
- [ ] Alert on ledger close time staleness > 30 seconds
- [ ] Alert on `HorizonError` log spike
- [ ] Stellar status page notifications enabled
- [ ] Custom Horizon instance health monitored separately (if using `HORIZON_URL`)

### Production configuration validation
- [ ] `STELLAR_NETWORK=mainnet` confirmed via `/health` → `"network":"mainnet"`
- [ ] `REQUIRE_API_KEY=true` with valid `API_KEYS` set
- [ ] `LOG_LEVEL=info` (not `debug` or `trace` — excess I/O in production)
- [ ] Rate limits tuned to expected traffic (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`)
- [ ] Cache TTLs tuned for your traffic patterns (see [Performance Guide](performance.md))

---

## Related Documentation

- [Observability Guide](observability.md) — Cache stats, request tracing, and structured log field reference
- [Performance Guide](performance.md) — Latency budgets, cache TTL tuning, and Horizon optimization
- [Logging Guide](logging.md) — Full Pino log field reference, log aggregation, and parsing examples
- [Deployment Guide](deployment.md) — Health check probe config for Kubernetes, Docker, and PaaS
- [Rate Limiting](rate-limiting.md) — Rate limit configuration, 429 handling, and retry strategies
- [Error Reference](error-reference.md) — All error types including `HorizonError` and `ServerError`
- [Caching Strategy](caching-strategy.md) — Per-endpoint TTLs and cache configuration
