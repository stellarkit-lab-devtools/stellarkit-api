# Logging Guide

StellarKit API uses **Pino**, a structured logging library, to provide consistent, queryable logs across all environments. This guide explains log levels, configuration, log entry structure, and how to parse logs in production.

## Quick Start

The logging system works out of the box with sensible defaults. To adjust verbosity:

```bash
# Set log level (development terminal)
LOG_LEVEL=debug node src/index.js

# Or in .env
LOG_LEVEL=debug
```

## Log Levels

Pino supports six log levels, ordered by severity. Only messages at or above the configured level are emitted:

| Level | Priority | Use Case | Example |
|-------|----------|----------|---------|
| `fatal` | 60 | Critical failures; process will likely exit | Database connection lost, unrecoverable startup error |
| `error` | 50 | Runtime errors that need attention | Request failed, Horizon timeout, validation error |
| `warn` | 40 | Unexpected but recoverable conditions | Cache miss on expected hit, slow request, deprecated API usage |
| `info` | 30 | Important state changes and request events | Request completed, cache stats snapshot, configuration loaded |
| `debug` | 20 | Developer-focused diagnostic info | Cache hit/miss details, environment config, retry attempts |
| `trace` | 10 | Extremely detailed execution flow | Function entry/exit, variable values, data transformations |

**Default:** `info` — logs important events without debug noise.

### Setting Log Levels

Use the `LOG_LEVEL` environment variable:

```bash
# Production: catch errors and important events only
LOG_LEVEL=info

# Development: include debug diagnostics
LOG_LEVEL=debug

# Troubleshooting: maximum detail
LOG_LEVEL=trace
```

If not set, defaults to `info`.

## Log Output Formats

### Development Format (Pretty-Print)

By default, logs are pretty-printed with colors and human-readable formatting:

```
  [16:45:32.123] INFO (12345): [a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6] GET /account/GABC123 200 45.123ms
      requestId: "a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6"
      method: "GET"
      path: "/account/GABC123"
      statusCode: 200
      responseTimeMs: 45.123
```

### Production Format (JSON)

In production (when `NODE_ENV=production`), logs emit as newline-delimited JSON (NDJSON):

```json
{"level":30,"time":1692374732123,"pid":12345,"hostname":"api-prod-1","requestId":"a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6","method":"GET","path":"/account/GABC123","statusCode":200,"responseTimeMs":45.123,"msg":"[a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6] GET /account/GABC123 200 45.123ms"}
```

The format is controlled automatically based on the `NODE_ENV` environment variable:

- `NODE_ENV != production` → Pretty-print (development/testing)
- `NODE_ENV=production` → JSON (machine-parseable for log aggregation)

## Log Entry Structure

Every log entry contains structured metadata fields alongside a human-readable message:

### Request Logs

All HTTP requests are logged with this structure:

```json
{
  "requestId": "a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6",
  "method": "GET",
  "path": "/account/GABC123?limit=10",
  "statusCode": 200,
  "responseTimeMs": 45.123
}
```

**Fields:**

- **requestId** (string): Unique identifier for this request, generated from `X-Request-ID` header or randomly. Used for distributed tracing across logs and error responses.
- **method** (string): HTTP verb (`GET`, `POST`, `PUT`, `DELETE`, etc.).
- **path** (string): Full request URL including query parameters.
- **statusCode** (number): HTTP response status code.
- **responseTimeMs** (number): Time elapsed from request received to response sent, in milliseconds. Sub-millisecond precision is preserved.

**Message:** `[requestId] method path statusCode responseTimeMs`

**Example:**
```
[a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6] GET /account/GABC123 200 45.123ms
```

### Error Logs

Errors are logged at `error` (5xx) or `warn` (4xx) level with error context:

```json
{
  "requestId": "a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6",
  "method": "POST",
  "path": "/transactions",
  "status": 400,
  "msg": "Invalid account ID"
}
```

**Additional fields for errors:**
- **requestId**: Trace back to the originating request.
- **method**: HTTP method.
- **path**: Request path.
- **status**: HTTP response status code (4xx or 5xx).
- **msg**: Human-readable error message.

### Cache Debug Logs

Cache operations emit debug-level logs (only visible when `LOG_LEVEL=debug`):

```
[16:45:32.456] DEBUG (12345): Cache hit: asset:USDC:GBUQWP3BOUZX34LOCALCOMMODO4QPC6B5LJ6E33ZM7QZ2H4E7BUCA63OP2
```

Useful for diagnosing cache effectiveness during development.

### Standard Fields

All log entries include Pino's standard fields:

- **level** (number): Log level as a number (60=fatal, 50=error, 40=warn, 30=info, 20=debug, 10=trace).
- **time** (number): UNIX timestamp in milliseconds.
- **pid** (number): Process ID (omitted in pretty-print mode).
- **hostname** (string): Server hostname (omitted in pretty-print mode).
- **msg** (string): Human-readable message.

## Parsing Production Logs

In production, logs are JSON — one object per line. Use standard JSON tools to query and analyze:

### jq Examples

**List all request IDs:**
```bash
cat logs.ndjson | jq -r '.requestId' | sort | uniq -c
```

**Filter errors only:**
```bash
cat logs.ndjson | jq 'select(.level >= 50)'
```

**Find slow requests (>500ms):**
```bash
cat logs.ndjson | jq 'select(.responseTimeMs > 500)'
```

**Pretty-print a specific request:**
```bash
cat logs.ndjson | jq 'select(.requestId == "a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6")'
```

**Count requests by status code:**
```bash
cat logs.ndjson | jq -r '.statusCode' | sort | uniq -c
```

### Log Aggregation (ELK, Datadog, CloudWatch)

Most log aggregation platforms natively parse NDJSON and allow querying by field:

**Elasticsearch / Kibana:**
```
statusCode >= 400 AND responseTimeMs > 1000
```

**Datadog:**
```
status:error responseTimeMs:[1000 TO *]
```

**AWS CloudWatch Insights:**
```
fields requestId, method, path, statusCode, responseTimeMs
| filter statusCode >= 400
| stats avg(responseTimeMs) as avg_time by requestId
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Set verbosity: fatal, error, warn, info, debug, trace |
| `NODE_ENV` | `development` | Set to `production` for JSON logging; otherwise pretty-print |

### Disabling Pretty-Print Globally

If you want JSON output in development (e.g., for testing log parsing):

```bash
NODE_ENV=production LOG_LEVEL=debug node src/index.js
```

## Request Tracing

Every request is assigned a unique ID for end-to-end tracing:

### Automatic Generation

If no `X-Request-ID` header is sent, the API generates a random UUID:

```bash
curl http://localhost:3000/account/GABC123
# Log: [a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6] GET /account/GABC123 200 45.123ms
```

### Custom Request ID

Pass your own ID in the request header for distributed tracing:

```bash
curl -H "X-Request-ID: my-trace-12345" http://localhost:3000/account/GABC123
# Log: [my-trace-12345] GET /account/GABC123 200 45.123ms
```

The request ID is also returned in every response:

```json
{
  "success": true,
  "data": {...},
  "requestId": "my-trace-12345"
}
```

## Log Examples

### Development Session

```bash
$ LOG_LEVEL=debug node src/index.js

[16:45:30.010] INFO (12345): StellarKit API listening on port 3000
[16:45:30.025] DEBUG (12345): Environment: testnet, LOG_LEVEL: debug
[16:45:32.100] DEBUG (12345): Cache hit: network-status
[16:45:32.110] INFO (12345): [abc-def-ghi] GET /network 200 10.234ms
[16:45:35.200] DEBUG (12345): Cache miss: asset:USDC:GBUQWP3BOUZX34LOCALCOMMODO4QPC6B5LJ6E33ZM7QZ2H4E7BUCA63OP2
[16:45:36.400] WARN (12345): [jkl-mno-pqr] POST /transactions 404 1200.123ms
    requestId: "jkl-mno-pqr"
    method: "POST"
    path: "/transactions"
    status: 404
```

### Production (JSON) Log Stream

```json
{"level":30,"time":1692374730010,"pid":12345,"hostname":"api-prod-1","msg":"StellarKit API listening on port 3000"}
{"level":30,"time":1692374732100,"pid":12345,"hostname":"api-prod-1","requestId":"abc-def-ghi","method":"GET","path":"/network","statusCode":200,"responseTimeMs":10.234,"msg":"[abc-def-ghi] GET /network 200 10.234ms"}
{"level":40,"time":1692374736400,"pid":12345,"hostname":"api-prod-1","requestId":"jkl-mno-pqr","method":"POST","path":"/transactions","status":404,"msg":"Invalid transaction payload"}
```

## Monitoring and Alerting

### Slow Request Warnings

While StellarKit doesn't emit automatic slow-request warnings, you can monitor `responseTimeMs` to alert on performance degradation:

**CloudWatch Alarm Example:**
```
Alert if: Average(responseTimeMs) > 1000ms over 5 minutes
```

**jq One-Liner (Local Monitoring):**
```bash
cat logs.ndjson | jq 'select(.responseTimeMs > 1000)' | wc -l
# Count requests slower than 1 second
```

### Error Rate Monitoring

Track error logs to catch spikes in failures:

**jq:**
```bash
cat logs.ndjson | jq 'select(.level >= 50)' | wc -l
# Count all error-level logs
```

**Kibana:**
```
level >= 50 | stats count() as error_count
```

## Best Practices

### For Developers

1. **Use structured fields**, not string concatenation:
   ```javascript
   // ✓ Good
   logger.info({ userId, action, duration }, "User action completed");
   
   // ✗ Bad
   logger.info(`User ${userId} performed ${action} in ${duration}ms`);
   ```

2. **Set `LOG_LEVEL=debug` during development** to spot issues early.

3. **Use request IDs** for tracing multi-step operations across services.

### For Operations

1. **Always use JSON logs in production** (`NODE_ENV=production`).

2. **Ship logs to a centralized platform** (Datadog, Elastic, CloudWatch) for:
   - Persistent storage beyond container restarts.
   - Full-text search and filtering.
   - Alerting on error rates and anomalies.

3. **Monitor response times** — high `responseTimeMs` values often indicate:
   - Slow Horizon queries.
   - Database/cache issues.
   - Network congestion.

4. **Correlate with metrics** — cross-reference logs with request/error rates to diagnose production issues.

## Troubleshooting

### Logs Not Appearing

**Problem:** No logs in output.  
**Solution:** Ensure `LOG_LEVEL` is not set too high. Try `LOG_LEVEL=info` or lower.

### Output Not Pretty-Printed

**Problem:** Seeing JSON in development.  
**Solution:** Ensure `NODE_ENV` is not set to `production`. Try `NODE_ENV=development node src/index.js`.

### Missing Request IDs in Logs

**Problem:** Logs show `-` instead of UUID.  
**Solution:** This is normal fallback behavior; the request ID middleware should be registered. Check `src/index.js` to confirm middleware order.

### High Memory Usage with Verbose Logging

**Problem:** Process memory grows with `LOG_LEVEL=debug` or `trace`.  
**Solution:** Debug logs are normal; consider rotating logs or buffering to a file-based transport for production.

## Related Documentation

- [Environment Configuration](./environment-configuration.md) — How to set `LOG_LEVEL` in `.env`
- [Observability](#) — Caching strategy, cache stats endpoint, and performance monitoring
- [Response Format](./response-format.md) — How `requestId` is included in API responses
- [Error Reference](./error-reference.md) — Error types and structured error response formats

