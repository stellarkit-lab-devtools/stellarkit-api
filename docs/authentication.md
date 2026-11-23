# Authentication

## API keys

Set `REQUIRE_API_KEY=true` to require an `X-API-Key` header on protected routes.
`/` and `/health` remain public. With `REQUIRE_API_KEY=false` (the default),
keys and scopes are not enforced.

Keys are configured in `API_KEYS` as a comma-separated list. Each entry may
carry an optional scope suffix:

```
API_KEYS=readonly-key:read,ops-key:admin,legacy-key
```

* `:read` — allowed on normal API routes (this is also the default for an
  unsuffixed, legacy key).
* `:admin` — additionally allowed on operational endpoints:
  `GET /cache/stats` and every `/metrics*` route.

A read-scoped key calling an operational endpoint receives `403` with:

```json
{
  "success": false,
  "error": {
    "type": "InsufficientScope",
    "message": "This API key does not have the scope required for this endpoint.",
    "requiredScope": "admin"
  }
}
```

Unknown scope values are rejected at startup with a logged error and the
affected entry is not registered. Missing or invalid keys return `401` with
`type: "Unauthorized"`. Keys are hashed with SHA-256 and compared using a
constant-time comparison.
