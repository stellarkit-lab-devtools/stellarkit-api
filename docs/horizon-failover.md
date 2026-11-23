# Horizon failover

Set `HORIZON_URLS` to an ordered, comma-separated list of Horizon base URLs for
the **same Stellar network**. A non-empty list takes precedence over
`HORIZON_URL`; when the list is empty, the existing single URL or network default
still applies.

```dotenv
HORIZON_URLS=https://primary.example.com,https://backup.example.com
HORIZON_FAILOVER_STICKY_MS=60000
```

Shared SDK requests and raw Horizon fetches retry connection/DNS failures,
timeouts and HTTP 5xx responses on the next configured endpoint. Each endpoint
is attempted at most once per request; 4xx responses stop immediately. If all
attempted endpoints are unavailable, routes receive HTTP 503 with error type
`UpstreamUnavailable`. Each SDK/raw request has a five-second timeout.

After a successful backup response, new requests prefer that endpoint until
`HORIZON_FAILOVER_STICKY_MS` expires (default 60000 milliseconds). Successful
requests during that window do not extend it. After expiry the next request
tries the primary again; if primary is still down, a successful backup starts
a new window. Zero disables stickiness. This is request-driven recovery, not a
background probe or circuit breaker.

`GET /health` reports `data.horizon.host` for the last successful endpoint,
initially the primary. This contains only hostname and optional port, with no
scheme, credentials, path or query. Public network-status URL metadata also
strips URL credentials. Failover errors discard raw SDK request/config objects
and redact configured URL credentials before the error handler can log them.

SSE and WebSocket Horizon subscriptions stay on the primary and retain their
existing reconnection behavior; failover does not replay streaming subscriptions.
When adding a raw Horizon request, use `fetchHorizon(path, options)` from
`src/config/stellar.js` so it shares the same endpoint preference and retry rules.
