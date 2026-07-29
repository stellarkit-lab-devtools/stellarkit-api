# StellarKit API Response Format Guide

This guide explains the standard response format conventions used across all StellarKit API endpoints. Following these conventions ensures predictable parsing and error handling for API consumers.

---

## Table of Contents

1. [Success Envelope](#success-envelope)
2. [Error Envelope](#error-envelope)
3. [Paginated Response Shape](#paginated-response-shape)
4. [Asset Shape](#asset-shape)
5. [Timestamp Format](#timestamp-format)
6. [Amount Format](#amount-format)

---

## Success Envelope

All successful API responses return a JSON object with `success: true` and the core payload nested under the `data` key.

**Standard Structure:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Example:**
```json
{
  "success": true,
  "data": {
    "accountId": "GD6WU54JYAEX23MBDYWRE6GGDJ426SWJCA55X5KIKXWDXN5Z3XWRLA65",
    "sequence": "1234567890"
  }
}
```

Additional metadata (like `meta` for pagination) may appear at the root level alongside `success` and `data`.

---

## Error Envelope

When a request fails, the response contains `success: false` and a detailed `error` object describing what went wrong.

**Standard Structure:**
```json
{
  "success": false,
  "error": {
    "type": "ErrorType",
    "message": "Human-readable error description"
  }
}
```

**Common Error Types:**
- `ValidationError` — Invalid input parameters
- `HorizonError` — Stellar Horizon API error
- `NotFound` — Resource not found
- `ServerError` — Internal server error

**Example (ValidationError):**
```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Invalid account ID format. Must be a 56-character string starting with 'G'.",
    "field": "id",
    "receivedValue": "invalid-id",
    "expectedFormat": "Stellar Public Key (G...)"
  }
}
```

**Example (NotFound):**
```json
{
  "success": false,
  "error": {
    "type": "NotFound",
    "message": "Account GD6WU54JYAEX23MBDYWRE6GGDJ426SWJCA55X5KIKXWDXN5Z3XWRLA65 not found on testnet"
  }
}
```

See [Error Reference](error-reference.md) for comprehensive error documentation.

---

## Paginated Response Shape

Endpoints that return lists of records (transactions, payments, operations, etc.) support pagination and include metadata in the `meta` object.

**Request Parameters:**
- `limit` (number, default: 10, max: 200) — Number of records to return
- `order` (string, default: "desc") — Sort order ("asc" or "desc")
- `cursor` (string, optional) — Pagination token from previous response

**Response Structure:**
```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "count": 2,
    "limit": 10,
    "order": "desc",
    "nextCursor": "137424838656-1",
    "hasMore": true
  }
}
```

**Meta Fields:**
- `count` — Number of items in current response
- `limit` — Requested page size
- `order` — Sort order used
- `nextCursor` — Token for next page (null if no more pages)
- `hasMore` — Boolean indicating if more pages exist

**Example:**
```json
{
  "success": true,
  "meta": {
    "count": 2,
    "limit": 2,
    "order": "desc",
    "nextCursor": "137424838656-1",
    "hasMore": true
  },
  "data": [
    {
      "id": "tx_1",
      "ledger": 100,
      "createdAt": "2026-06-28T11:15:30.000Z"
    },
    {
      "id": "tx_2",
      "ledger": 99,
      "createdAt": "2026-06-28T11:15:25.000Z"
    }
  ]
}
```

---

## Asset Shape

Stellar assets are represented in a standardized string format for clarity and consistency.

**Native Asset (XLM):**
```
"XLM"
```

**Issued Assets:**
```
"CODE:ISSUER"
```

Where:
- `CODE` — Asset code (1-12 alphanumeric characters)
- `ISSUER` — 56-character Stellar public key (starts with G)

**Example:**
```json
{
  "sellingAsset": "XLM",
  "buyingAsset": "USDC:GBBD47R2LWK7P7CQA4B27USF672QHWWT7MQFGCVQD6ISVJVCGLOWW657"
}
```

Some endpoints return assets as structured objects instead:
```json
{
  "asset": {
    "code": "USDC",
    "issuer": "GBBD47R2LWK7P7CQA4B27USF672QHWWT7MQFGCVQD6ISVJVCGLOWW657",
    "type": "credit_alphanum4"
  }
}
```

---

## Timestamp Format

All timestamps are returned in **ISO 8601 format** in **UTC** timezone.

**Format:** `YYYY-MM-DDTHH:mm:ss.sssZ`

**Example:**
```json
{
  "createdAt": "2026-06-28T11:15:30.000Z",
  "closedAt": "2026-06-28T11:15:35.000Z"
}
```

If a timestamp is unavailable or invalid, the field will be `null`:
```json
{
  "createdAt": "2026-06-28T11:15:30.000Z",
  "closedAt": null
}
```

---

## Amount Format

Stellar amounts are represented as decimal strings with up to **7 decimal places** to avoid floating-point precision issues.

**Raw Amounts:**
Plain decimal strings without formatting.
```json
{
  "balance": "1234567.8900000",
  "limit": "922337203685.4775807"
}
```

**Formatted Amounts:**
Display-oriented amounts with thousands separators (commas).
```json
{
  "balance": "1,234,567.8900000"
}
```

**Stroops:**
The smallest unit of XLM (1 XLM = 10,000,000 stroops). Fees are often represented in both stroops and XLM.
```json
{
  "fee": {
    "stroops": 100,
    "xlm": "0.0000100"
  }
}
```

**Example:**
```json
{
  "xlm": {
    "balance": "1,234.5678900",
    "buyingLiabilities": "0.0000000",
    "sellingLiabilities": "100.0000000"
  },
  "totalFee": {
    "economy": {
      "stroops": 100,
      "xlm": "0.0000100"
    }
  }
}
```

---

## Related Documentation

- [API Design Guidelines](api-design.md) — Comprehensive design conventions and domain examples
- [Error Reference](error-reference.md) — All error types and resolution guidance
- [Getting Started Guide](getting-started.md) — Setup and first API calls

---

**Note:** This guide is consistent with the conventions documented in [API Design Guidelines](api-design.md). When implementing new endpoints, always follow these response format standards.
