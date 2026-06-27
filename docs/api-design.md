# API Design Decisions

This document explains why StellarKit responses are shaped the way they are.

## Response Envelope

Every StellarKit response is wrapped in a consistent envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

On error:
```json
{
  "success": false,
  "data": null,
  "error": {
    "message": "Account not found",
    "type": "NOT_FOUND",
    "status": 404
  }
}
```

### Why an envelope?
- Clients can check `success` without inspecting HTTP status codes
- `error` is always structured, never a raw string
- Consistent for both single-resource and list responses

## Asset Representation

Assets are always represented as:
```json
{ "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }
```
Native XLM is:
```json
{ "code": "XLM", "issuer": null, "type": "native" }
```

## Pagination

All list endpoints support cursor-based pagination:
```
GET /transactions?cursor=<id>&limit=20&order=desc
```
Response always includes `{ items, cursor, has_more, total }`.

## Error Types

| Type | Status | Meaning |
|------|--------|---------|
| NOT_FOUND | 404 | Resource not found |
| INVALID_REQUEST | 400 | Bad input |
| UPSTREAM_ERROR | 502 | Horizon API error |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL | 500 | Unexpected error |
