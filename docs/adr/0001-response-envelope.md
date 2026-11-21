# ADR 0001: Every response uses the `{ success, data | error }` envelope

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

StellarKit wraps Horizon, Soroban RPC and stellar.toml lookups behind one API.
Those upstreams return very different shapes: Horizon wraps lists in
`_embedded.records` with HAL `_links`, Horizon errors are RFC 7807 problem
documents, and Soroban RPC uses JSON-RPC errors. Clients integrating several
endpoints kept writing per-route parsing and could not tell success from
failure without inspecting the HTTP status and the body shape together.

## Decision

Every JSON response is an object with a boolean `success` flag:

- Success: `{ "success": true, "data": <payload> }`, with optional sibling keys
  such as `meta` for pagination (`count`, `limit`, `order`, `nextCursor`, `hasMore`).
- Error: `{ "success": false, "error": { "type", "message", ... } }`, where
  `type` is a stable machine-readable name (e.g. `AccountNotFound`,
  `RateLimitExceeded`) and `suggestion` is included where useful.

Implemented in:

- `src/utils/response.js` — `success(res, data, meta)` builds the success
  envelope (`{ success: true, ...meta, data }`); routes call it instead of
  `res.json` directly. It also adds the RFC 8288 `Link: rel="next"` header when
  `meta.hasMore` is true. `stripLinks()` removes Horizon `_links`.
- `src/middleware/errorHandler.js` — the global error handler converts thrown
  errors (validation, Horizon, timeouts, `StellarKitError`) into the error
  envelope and attaches `requestId`.
- `src/utils/StellarKitError.js` — the structured error class whose `toJSON()`
  produces the `error` object.
- `src/middleware/rateLimiter.js`, `src/middleware/validateRouteParams.js`,
  `src/middleware/sanitize.js` — middleware that responds early still emits
  `{ success: false, error: { type, message } }`.
- `src/index.js` — the 404 fallback uses the same error envelope.

The full shape is documented for consumers in `docs/response-format.md`.

## Consequences

- Clients can branch on `body.success` and read `body.error.type` uniformly,
  and the SDK in `sdk/` can parse every endpoint the same way.
- New routes must use `success()` and pass errors to `next(err)`; writing a raw
  `res.json(...)` bypasses shared behaviour such as the pagination `Link`
  header. A few older routes still call `res.json({ success: true, ... })`
  directly — they keep the envelope but should be migrated when touched.
- Horizon-specific fields (`_links`, snake_case names) are not passed through
  verbatim; routes normalise them, which means more mapping code per route.
