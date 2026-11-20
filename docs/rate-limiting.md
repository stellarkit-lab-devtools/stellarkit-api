# Rate Limiting

StellarKit API applies per-IP rate limiting to protect the service and the upstream Stellar Horizon servers it depends on. This guide covers the default limits, how to configure them, the headers clients should read to track usage, and how to handle a `429` response.

> **Building a high-volume app?** See **[Staying Within Rate Limits: A Practical Strategies Guide](rate-limiting-strategies.md)** for request batching, caching, `?fresh=true` timing, polling cadence, and a complete exponential-backoff implementation.

---

## Default Limits

Rate limits are tracked per client IP address within a sliding time window (15 minutes by default). Three limiters are active:

| Limiter | Applies to | Default max requests / window |
| --- | --- | --- |
| Global | Every route except `/health` | `100` |
| Account summary | `GET /account/:id/summary` | `20` |
| Asset holders | `GET /asset/:code/:issuer/holders` | `10` |

The account summary and asset holders limiters exist because those endpoints fan out into several Horizon requests per call and are more expensive to serve. `/health` is exempt from rate limiting so uptime checks are never blocked.

---

## Configuration

Rate limiting behavior is controlled via environment variables — no code changes are required.

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 minutes) | Length of the rate-limit window, in milliseconds. Applies to all three limiters. |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per window per IP for the **global** limiter. |

The account summary (`20`) and asset holders (`10`) limits are currently fixed and not configurable via environment variables — only their window length follows `RATE_LIMIT_WINDOW_MS`.

Example `.env`:

```bash
# 10-minute window, 200 requests per window on the global limiter
RATE_LIMIT_WINDOW_MS=600000
RATE_LIMIT_MAX=200
```

Both variables are optional; the server falls back to the defaults above when they're unset, invalid, or non-positive. Restart the service after changing them for the new values to take effect.

---

## Response Headers

Because of how the limiter is configured, StellarKit API does **not** send `X-RateLimit-*` headers on ordinary, successful requests — only when a request is rejected for exceeding the limit. When that happens, the `429` response includes:

| Header | Description |
| --- | --- |
| `X-RateLimit-Limit` | The max requests allowed in the current window for the limiter that was triggered (e.g. `100` for the global limiter, `20` for account summary). |
| `X-RateLimit-Remaining` | Always `0` on a `429` response — the request was rejected because the budget was exhausted. |
| `X-RateLimit-Reset` | ISO 8601 timestamp of when the current window resets and the counter goes back to `0`. |
| `Retry-After` | Seconds to wait before retrying, equivalent to the remaining time in the current window. |

Since there is no way to read remaining quota from a successful response, treat a `429` as the first signal that you're near (or over) the limit, and use `Retry-After` / `X-RateLimit-Reset` to pace subsequent requests. If you need proactive usage tracking, count requests on the client side against the configured `RATE_LIMIT_MAX` and window.

---

## Example Rate Limit Error Response

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 900
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2026-07-24T15:32:10.000Z
```

```json
{
  "success": false,
  "error": {
    "type": "RateLimitExceeded",
    "message": "Too many requests, please try again later.",
    "retryAfter": 900,
    "resetAt": "2026-07-24T15:32:10.000Z"
  }
}
```

- `error.retryAfter` — seconds until the window resets (same value as the `Retry-After` header).
- `error.resetAt` — ISO 8601 timestamp of the reset (same value as `X-RateLimit-Reset`).

---

## Recommended Retry Strategy

1. **Don't retry immediately in a loop.** On a `429`, read `Retry-After` (seconds) or `X-RateLimit-Reset` (timestamp) and wait at least that long before the next attempt.
2. **Use exponential backoff with jitter** for repeated failures (including transient `5xx` errors), rather than retrying at a fixed interval:
   ```js
   async function requestWithBackoff(fn, attempt = 0) {
     try {
       return await fn();
     } catch (err) {
       if (err.status !== 429 || attempt >= 5) throw err;

       const retryAfterMs = err.retryAfter
         ? err.retryAfter * 1000
         : Math.min(2 ** attempt * 1000, 30_000);
       const jitter = Math.random() * 250;

       await new Promise((resolve) => setTimeout(resolve, retryAfterMs + jitter));
       return requestWithBackoff(fn, attempt + 1);
     }
   }
   ```
3. **Cache and batch where possible.** Endpoints like `/network-status` and `/fee-estimate` are already cached server-side (see `CACHE_TTL_MS` in the [README](../README.md#environment-variables-reference)); avoid polling them faster than that TTL.
4. **Spread load across time** for bulk operations (e.g. scanning many accounts) instead of firing requests in parallel bursts — a small delay between requests keeps you comfortably under the window limit.
5. **Surface `RateLimitExceeded` distinctly** in your own error handling so it's not confused with validation or Horizon errors — see the [Error Reference](error-reference.md#ratelimiterror) for the full error shape.

---

## Related Docs

- [Staying Within Rate Limits: A Practical Strategies Guide](rate-limiting-strategies.md) — batching, caching, `?fresh=true` timing, polling priority, and exponential backoff
- [Error Reference](error-reference.md) — all error types and status codes
- [Getting Started Guide](getting-started.md) — initial setup and environment variables
- [Environment Configuration](environment-configuration.md) — full `.env` reference
