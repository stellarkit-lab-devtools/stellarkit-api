# Implementation Guide: New Features and Configuration

## 1. Structured Logging with Pino

### Configuration

The logger is automatically configured based on `NODE_ENV`:

```env
# In .env file
LOG_LEVEL=info        # fatal, error, warn, info, debug, trace
NODE_ENV=development  # development (pretty-print) or production (JSON)
```

### Usage in Code

```javascript
const logger = require('./utils/logger');

// Simple message
logger.info('Server started');

// With context object
logger.warn({ userId: 'abc123', action: 'delete' }, 'User action attempted');

// Different log levels
logger.fatal({ error: err }, 'Critical error');
logger.error({ err }, 'Request failed');
logger.warn({ statusCode }, 'Rate limit approaching');
logger.info({ endpoint: '/api/users' }, 'Endpoint called');
logger.debug({ data: obj }, 'Debug information');
```

### Output Examples

**Development (pretty-printed):**
```
[11:45:23.123] INFO (pid=1234): User action attempted
    userId: "abc123"
    action: "delete"
```

**Production (JSON):**
```json
{"level":30,"time":1719313523123,"pid":1234,"hostname":"server1","msg":"User action attempted","userId":"abc123","action":"delete"}
```

### Log Levels

- `fatal` (60) - Server won't continue
- `error` (50) - Error state, needs attention
- `warn` (40) - Warning, potential issue
- `info` (30) - General information
- `debug` (20) - Debug-level information
- `trace` (10) - Very verbose debug

## 2. ETag Support for Caching

### How It Works

The ETag middleware automatically generates cache identifiers for GET responses:

1. **First Request**: Server calculates SHA256 hash of response body → sets `ETag` header
2. **Subsequent Request**: Client sends `If-None-Match` header with cached ETag
3. **Match**: Server returns `304 Not Modified` (no body, saves bandwidth)
4. **No Match**: Server returns `200` with full response and new ETag

### Client Implementation Examples

**JavaScript (Fetch API):**
```javascript
// First request
const res1 = await fetch('/network-status');
const etag = res1.headers.get('etag');
const data = await res1.json();

// Subsequent request - conditional
const res2 = await fetch('/network-status', {
  headers: { 'If-None-Match': etag }
});

if (res2.status === 304) {
  // Use cached data, save bandwidth
  console.log('Using cached data');
} else if (res2.status === 200) {
  // Data changed, update cache
  const newData = await res2.json();
  const newETag = res2.headers.get('etag');
}
```

**cURL:**
```bash
# First request
curl -i https://api.stellar.example.com/network-status
# Response includes: ETag: "a1b2c3d4e5f6..."

# Subsequent request with ETag
curl -i -H 'If-None-Match: "a1b2c3d4e5f6..."' \
  https://api.stellar.example.com/network-status
# Response: 304 Not Modified (no body)
```

### Cached Endpoints

The following endpoints support ETag caching:
- `/network-status`
- `/fee-estimate`
- `/account/*`
- `/asset/*`
- `/dex/*`
- `/liquidity-pools/*`
- `/claimable-balances/*`
- `/network/*`

## 3. Improved Rate Limiting

### Error Response Format

When rate limited (429):

```json
{
  "success": false,
  "error": {
    "type": "RateLimitExceeded",
    "message": "Too many requests, please try again later.",
    "retryAfter": 900,
    "resetAt": "2024-06-29T12:30:00Z"
  }
}
```

### Response Headers

All rate-limited responses include:

```
Retry-After: 900                                    # Seconds to retry
X-RateLimit-Limit: 100                             # Max requests in window
X-RateLimit-Remaining: 0                           # Requests remaining (0 when limited)
X-RateLimit-Reset: 2024-06-29T12:30:00Z           # ISO timestamp when limit resets
```

### Configuration

```env
# In .env file
RATE_LIMIT_MAX=100        # Global requests per 15 minutes per IP
```

### Client Backoff Strategy

```javascript
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '60');
      console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    
    if (res.status >= 200 && res.status < 300) {
      return res;
    }
    
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error('Max retries exceeded');
}
```

## 4. Timestamp Standardization

### Timestamp Format

All timestamps in API responses are **ISO 8601 strings**:
```
"2024-06-29T12:30:45.123Z"
```

### Common Timestamp Fields

- `createdAt` - When the resource was created
- `closedAt` - When a ledger was closed
- `updatedAt` - When the resource was last updated
- `firstSeenAt` - When we first observed the resource

### Examples in Responses

```json
{
  "data": {
    "latestLedger": {
      "sequence": 12345,
      "closedAt": "2024-06-29T12:30:00Z"
    },
    "transactions": [
      {
        "hash": "abc123...",
        "createdAt": "2024-06-29T12:15:30Z"
      }
    ],
    "lastSeenAt": "2024-06-29T12:25:00Z"
  }
}
```

## 5. Implementation Checklist

### For API Users

- [ ] Implement ETag-based caching with `If-None-Match` headers to reduce bandwidth
- [ ] Parse `Retry-After` header in rate limit errors for proper backoff
- [ ] Update parsing to handle ISO 8601 timestamp strings
- [ ] Log API responses using JSON parsing for better debugging

### For Operations

- [ ] Set `LOG_LEVEL` to `debug` in development environments
- [ ] Configure centralized log aggregation to parse Pino JSON output
- [ ] Monitor rate limiter response counts via `X-RateLimit-*` headers
- [ ] Set up alerts for high rate limiting (429 responses)

### For CI/CD

- [ ] Install dependencies: `npm install`
- [ ] Run tests: `npm test`
- [ ] Verify no console.* calls remain: `grep -r 'console\.' src/`
- [ ] Update log parsing in monitoring systems

## 6. Migration Path

### From console.log to logger

```javascript
// OLD
console.log('User logged in:', userId);
console.error('Failed to load:', err.message);

// NEW
logger.info({ userId }, 'User logged in');
logger.error({ err }, 'Failed to load');
```

### From unstructured errors to structured ETags + rate limits

1. Clients should check `ETag` header on responses
2. Send `If-None-Match` on subsequent requests
3. Handle `304` responses (no parsing needed, use cached data)
4. Implement retry logic using `Retry-After` header value

## 7. Troubleshooting

### Logger output not appearing

```javascript
// Check LOG_LEVEL is not set too high
process.env.LOG_LEVEL = 'debug';

// Verify logger is imported correctly
const logger = require('./utils/logger');
logger.info('Test message');  // Should appear
```

### ETag not matching

ETags are generated from exact response body. If cache busting is needed:
```javascript
// Force cache bypass
fetch('/network-status?bust=' + Date.now());

// Or use Cache-Control headers
// Server already sets: Cache-Control: public, max-age=3600
```

### Rate limiting too aggressive

```env
# Increase limit (default: 100 per 15 minutes)
RATE_LIMIT_MAX=200
```

## 8. Monitoring Queries

### Find rate-limited requests

```
# In centralized logging system
level: "error" AND type: "RateLimitExceeded"
```

### Find slow endpoints

```
# Via JSON logs
level: "warn" AND message: "slow endpoint"
```

### ETag hit rate

```
# Count 304 responses
status: 304
```

---

For more information, see `REFACTORING_SUMMARY.md` for complete implementation details.
