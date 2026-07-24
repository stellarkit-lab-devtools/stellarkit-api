# Error Reference

All StellarKit API errors are returned as JSON in the same envelope:

```json
{
  "success": false,
  "error": {
    "type": "ErrorType",
    "message": "Human-readable description.",
    "suggestion": "Optional guidance on how to resolve the error."
  }
}
```

`detail`, `suggestion`, `field`, `receivedValue`, and `expectedFormat` are included only when relevant to the error type.

## Error types

### ValidationError
**HTTP status:** `400`

Returned when a request parameter, query string value, or body field fails validation (e.g. an invalid Stellar account ID, malformed asset code, out-of-range `limit`, wrong `Content-Type`).

```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Query parameter 'accountId' must be a valid Ed25519 public key starting with \"G\".",
    "suggestion": "Expected format: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
  }
}
```

### AccountNotFound
**HTTP status:** `404`

Returned when a Stellar account ID does not exist on the configured network.

```json
{
  "success": false,
  "error": {
    "type": "AccountNotFound",
    "message": "Account GAAZI4... was not found on the Stellar testnet network.",
    "suggestion": "Verify the account address is correct and that the account has been funded."
  }
}
```

### NotFound
**HTTP status:** `404`

Returned when a requested resource (asset, transaction, payment path, etc.) does not exist. See also `OrderBookEmpty` for the DEX-specific case.

```json
{
  "success": false,
  "error": {
    "type": "NotFound",
    "message": "No payment path exists between these two assets."
  }
}
```

### OrderBookEmpty
**HTTP status:** `404`

Returned by DEX endpoints (`GET /dex/spread/:sellAsset/:buyAsset`, `GET /dex/imbalance/:sellAsset/:buyAsset`, `GET /dex/depth/:sellAsset/:buyAsset`) when the requested trading pair has no active order book (no bids or asks).

```json
{
  "success": false,
  "error": {
    "type": "OrderBookEmpty",
    "message": "No active order book found for XLM/USDC.",
    "suggestion": "Verify both assets exist on the Stellar network and that there are active offers for this pair."
  }
}
```

### RateLimitError
**HTTP status:** `429`

Returned when a client exceeds the request rate limit for the global API or a specific rate-limited route (e.g. asset holders, account summary).

```json
{
  "success": false,
  "error": {
    "type": "RateLimitError",
    "message": "Too many requests, please try again after 15 minutes."
  }
}
```

### PayloadTooLargeError
**HTTP status:** `413`

Returned when a request body exceeds the configured maximum size (`MAX_BODY_SIZE`).

```json
{
  "success": false,
  "error": {
    "type": "PayloadTooLargeError",
    "message": "Payload too large. Maximum request body size is 10kb.",
    "suggestion": "Reduce your request body size to under 10kb."
  }
}
```

### HorizonError
**HTTP status:** varies (mapped from the underlying Horizon/Stellar error, defaults to `400`)

Returned when the Stellar Horizon server rejects a request (e.g. an invalid transaction submission). Includes the original Horizon `title`, `detail`, and `extras` for debugging.

```json
{
  "success": false,
  "error": {
    "type": "HorizonError",
    "title": "Transaction Failed",
    "detail": "The transaction failed when submitted to the Stellar network.",
    "status": 400,
    "extras": { "result_codes": { "transaction": "tx_failed" } },
    "code": "tx_failed",
    "message": "tx_failed"
  }
}
```

### ServerError
**HTTP status:** `500` (or another 5xx status when set upstream)

Returned for unexpected errors not covered by another error type. In production, the message is generic (`"An unexpected error occurred."`) to avoid leaking internals; the full message is included outside of production.

```json
{
  "success": false,
  "error": {
    "type": "ServerError",
    "message": "An unexpected error occurred."
  }
}
```
