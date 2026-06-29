# StellarKit API Design Guidelines & Conventions

This document explains the standard design guidelines and API response conventions used across StellarKit API. Following these conventions ensures consistency for contributors when implementing new endpoints, and predictability for consumers of the API.

---

## Table of Contents

1. [Response Envelope](#1-response-envelope)
2. [Pagination Shape](#2-pagination-shape)
3. [Asset Format](#3-asset-format)
4. [Timestamp Format](#4-timestamp-format)
5. [Amount Format](#5-amount-format)
6. [Error Shape](#6-error-shape)

---

## 1. Response Envelope

All API endpoints must return a standardized JSON envelope. 

### Success Envelope
For successful operations, the root object must contain `success: true`. The core payload must be nested under the `data` key. Additional keys (like `meta`) can be placed at the root level alongside `success` and `data` for pagination or context metadata.

Standard success responses are wrapped using the [success()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/response.js#L9) helper function in [src/utils/response.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/response.js).

#### Success JSON Example
```json
{
  "success": true,
  "data": {
    "id": "GD6WU54JYAEX23MBDYWRE6GGDJ426SWJCA55X5KIKXWDXN5Z3XWRLA65",
    "sequence": "1234567"
  }
}
```

---

## 2. Pagination Shape

Endpoints that return lists of records (e.g. transactions, operations, holders) support pagination. 

### Pagination Request Parameters
StellarKit API uses pagination query parameters parsed and validated via the [parsePaginationParams()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/pagination.js#L27) helper inside [src/utils/pagination.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/pagination.js):
- `limit` (number, default: `10`, max: `200`): The maximum number of records to return.
- `order` (string, default: `"desc"`): The sort order, either `"asc"` or `"desc"`.
- `cursor` (string, optional): A unique paging token from a previous response to resume fetching from.

### Pagination Response Metadata
The success envelope returns paginated records in the `data` array. Metadata about the page is returned in the `meta` object alongside `success` and `data`. The `meta` block must contain:
- `count` (number): The number of items returned in the current page.
- `limit` (number): The requested page size limit.
- `order` (string): The sort order.
- `nextCursor` (string | null): The cursor token of the last item in the page (to be used as the `cursor` query parameter for the next page). Returns `null` if no more records are available.
- `hasMore` (boolean): A quick indicator showing if there are potentially more records to fetch (usually determined by `count === limit`).

#### Paginated Response JSON Example
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

## 3. Asset Format

Stellar assets in StellarKit API are represented in a unified string identifier format.

- **Native Asset (Lumen):** Represented simply as `"XLM"`.
- **Issued Assets (Credit):** Represented as `"CODE:ISSUER"`, where `CODE` is the asset code (1-12 alphanumeric characters) and `ISSUER` is the 56-character Stellar public key of the issuing account.

Assets can be parsed into Stellar SDK Asset objects using the [parseStellarAsset()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/asset.js#L11) utility in [src/utils/asset.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/asset.js).

#### Asset JSON Example
```json
{
  "sellingAsset": "XLM",
  "buyingAsset": "USDC:GBBD47R2LWK7P7CQA4B27USF672QHWWT7MQFGCVQD6ISVJVCGLOWW657"
}
```

---

## 4. Timestamp Format

All timestamps in StellarKit API must be normalized to **ISO 8601 strings** in UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`). If a timestamp value is missing or invalid, it must resolve to `null`.

The standardization is handled using the [toISOTimestamp()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/response.js#L30) helper function in [src/utils/response.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/response.js), which gracefully handles Unix timestamps in seconds, milliseconds, JavaScript Date objects, and ISO date strings.

#### Timestamp JSON Example
```json
{
  "createdAt": "2026-06-28T11:15:30.000Z",
  "closedAt": null
}
```

---

## 5. Amount Format

Amounts on the Stellar ledger are internally handled as decimal strings with up to 7 decimal places (to avoid JavaScript float-precision loss). 

StellarKit API uses two conventions depending on whether the response is display-oriented or data-oriented:
- **Raw/API Amounts:** Represented as flat decimal strings without formatting (e.g. `"10000.1234567"` or `"0.0000100"`).
- **Formatted Display Amounts:** Represented with thousands separators (commas) while preserving all decimal digits (e.g. `"10,000.1234567"`). This formatting is applied in display-centric endpoints (such as XLM balances) using the [formatBalance()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/formatBalance.js#L14) utility in [src/utils/formatBalance.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/formatBalance.js).
- **Stroops:** Represented as integers. A stroop is the smallest unit of XLM (1 XLM = 10,000,000 stroops). Fees are often returned in both stroops and XLM decimals.

#### Amount JSON Example
```json
{
  "balance": "1,234,567.8900000",
  "rawBalance": "1234567.8900000",
  "fee": {
    "charged": "100",
    "chargedInXLM": "0.0000100"
  }
}
```

---

## 6. Error Shape

If an API request fails, the root object must contain `success: false` and a detailed `error` object. The structure of the `error` object depends on the error type and is handled centrally by the [errorHandler()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/middleware/errorHandler.js#L27) middleware in [src/middleware/errorHandler.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/middleware/errorHandler.js).

### HorizonError
Thrown when an operation fails on the Stellar Horizon network. It maps Horizon responses and translates standard Stellar transaction/operation result codes into plain-English instructions using [translateHorizonError()](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/horizonErrors.js#L30) from [src/utils/horizonErrors.js](file:///c:/Users/cisat/.antigravity-ide/stellarkit-api-1/src/utils/horizonErrors.js).
- `type`: Always `"HorizonError"`.
- `title`: Short summary of the error from Horizon.
- `detail`: Detailed explanation from Horizon.
- `status`: HTTP status code from Horizon.
- `code` (optional): The specific Stellar transaction or operation result code (e.g. `"op_underfunded"`, `"tx_bad_seq"`).
- `message` (optional): A user-friendly plain-English translation of the result code.
- `extras` (optional): Additional details containing operation details, transaction/result XDR, and result codes.

#### HorizonError JSON Example
```json
{
  "success": false,
  "error": {
    "type": "HorizonError",
    "title": "Transaction Failed",
    "detail": "The transaction was rejected because the source account lacks sufficient funds to cover the payment.",
    "status": 400,
    "code": "op_underfunded",
    "message": "The sending account does not have enough funds to complete this payment.",
    "extras": {
      "envelope_xdr": "AAAAAg...",
      "result_xdr": "AAAAAf...",
      "result_codes": {
        "transaction": "tx_failed",
        "operations": ["op_underfunded"]
      }
    }
  }
}
```

### ValidationError
Thrown when request inputs (query params, path params, or request body) fail validation.
- `type`: Always `"ValidationError"`.
- `message`: Specific message detailing what is wrong.
- `field` (optional): The name of the field that failed validation.
- `receivedValue` (optional): The invalid value that was provided.
- `expectedFormat` (optional): Description of the expected format/type.

#### ValidationError JSON Example
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

### PayloadTooLargeError
Thrown when request body parsing limits are exceeded (e.g., maximum request body size exceeded).
- `type`: Always `"PayloadTooLargeError"`.
- `message`: Details about the size limit exceeded.

#### PayloadTooLargeError JSON Example
```json
{
  "success": false,
  "error": {
    "type": "PayloadTooLargeError",
    "message": "Payload too large. Maximum request body size is 10kb."
  }
}
```

### ServerError
Thrown for unhandled internal exceptions. Under a production environment (`NODE_ENV=production`), the message is sanitized to protect system internals.
- `type`: Always `"ServerError"`.
- `message`: The raw error message (in development/test) or `"An unexpected error occurred."` (in production).

#### ServerError JSON Example
```json
{
  "success": false,
  "error": {
    "type": "ServerError",
    "message": "An unexpected error occurred."
  }
}
```
