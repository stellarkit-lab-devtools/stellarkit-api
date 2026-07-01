# StellarKit API Error Reference

Every error response follows the same envelope:

```json
{
  "success": false,
  "error": {
    "type": "ErrorType",
    "message": "Human-readable description."
  }
}
```

Some error types include additional fields such as `detail`, `suggestion`, `field`, `receivedValue`, `expectedFormat`, or Horizon-specific `extras`.

---

## ValidationError

Returned when a request parameter or body value fails validation.

**Status:** `400`

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "<ErrorType>",
    "message": "...",
    ...
  }
}
```

## Error Types

| Type              | HTTP Status | Description                                                           |
| ----------------- | ----------- | --------------------------------------------------------------------- |
| `ValidationError` | 400         | Input validation failed (invalid account ID, asset code, limit, etc.) |
| `HorizonError`    | varies      | Error propagated from the Stellar Horizon API                         |
| `OfferNotFound`   | 404         | A specific offer was requested but does not exist on the network      |
| `NotFound`        | 404         | Route or resource not found                                           |
| `RateLimitError`  | 429         | Too many requests from the same IP                                    |
| `ServerError`     | 500         | Unexpected internal error                                             |

---

### OfferNotFound

Returned when `GET /account/:id/offers?offerId=<id>` is called with an offer ID that does not exist, or when any operation references a non-existent offer.

**Example response:**

```json
{
  "success": false,
  "error": {
    "type": "AccountNotFound",
    "message": "Account GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN was not found on the Stellar testnet network.",
    "suggestion": "Verify the account address is correct and that the account has been funded."
  }
}
```

**Common causes:**
- The public key is valid but the account has not been created on the network
- The account was merged and no longer exists
- Using a testnet key on mainnet or vice versa

**Suggested fix:** Verify the account address. If on testnet, fund the account using Friendbot (`GET /utils/friendbot/:accountId`).

---

## InvalidAsset

Returned when an asset code or issuer is invalid.

**Status:** `400`

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "InvalidAsset",
    "message": "Asset code is required.",
    "suggestion": "Provide a valid asset code (1–12 alphanumeric characters), e.g. USDC."
  }
}
```

**Common causes:**
- Missing asset code or issuer in the request
- Asset code longer than 12 characters or contains special characters
- Issuer is not a valid Ed25519 public key

**Suggested fix:** Follow the `suggestion` field. Asset codes must be 1–12 uppercase alphanumeric characters. Issuers must be valid G-prefixed Stellar public keys.

---

## RateLimitError

Returned when the client exceeds the allowed request rate.

**Status:** `429`

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "RateLimitError",
    "message": "Too many requests, please try again after 15 minutes."
  }
}
```

**Rate limits:**
- Global: 100 requests per 15-minute window (configurable via `RATE_LIMIT_MAX`)
- Account summary: 20 requests per 15-minute window
- Asset holders: 10 requests per 15-minute window

**Suggested fix:** Reduce request frequency. Check the `Retry-After` and `RateLimit-*` response headers for timing information.

---

## HorizonError

Returned when the Stellar Horizon API returns an error. The response includes the original Horizon error details.

**Status:** Varies (typically `400`, `403`, `404`, `409`, `422`)

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "HorizonError",
    "title": "Transaction Failed",
    "detail": "The transaction failed when submitted to the stellar network.",
    "status": 400,
    "code": "tx_insufficient_fee",
    "message": "Transaction fee is too low. Increase the fee or use the current base fee from Horizon multiplied by the number of operations.",
    "extras": {
      "result_codes": {
        "transaction": "tx_insufficient_fee"
      }
    }
  }
}
```

**Common Horizon result codes:**

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `tx_bad_seq` | 409 | Sequence number mismatch — reload the account and rebuild |
| `tx_insufficient_fee` | 422 | Fee too low — increase fee or use current base fee |
| `tx_bad_auth` | 403 | Missing or invalid signature |
| `tx_no_source_account` | 400 | Source account does not exist |
| `tx_bad_auth_extra` | 400 | Too many signatures on the transaction |
| `tx_internal_error` | 400 | Internal Horizon error — retry later |
| `tx_not_supported` | 400 | Transaction type not supported on this network |
| `tx_fee_bump_inner_failed` | 400 | Inner transaction of a fee bump failed |
| `op_no_destination` | 404 | Destination account does not exist |
| `op_no_trust` | 422 | Destination has no trustline for this asset |
| `op_line_full` | 422 | Destination trustline limit reached |
| `op_underfunded` | 422 | Insufficient funds in source account |
| `op_low_reserve` | 422 | Would drop below minimum XLM reserve |
| `op_bad_auth` | 400 | Operation missing required authorization |
| `op_no_account` | 400 | Account does not exist |
| `op_not_authorized` | 400 | Not authorized for this operation on the asset |
| `op_malformed` | 400 | Operation is malformed or has invalid parameters |

**Suggested fix:** Check the `code` and `message` fields. See the [Stellar documentation](https://developers.stellar.org/docs/data/horizon/api-reference/errors) for details on each result code.

---

## PayloadTooLargeError

Returned when the request body exceeds the maximum allowed size.

**Status:** `413`

**Example:**

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

**Suggested fix:** Reduce the size of the request body. The default limit is 10 KB (configurable via `MAX_BODY_SIZE` environment variable).

---

## Unauthorized

Returned when API key authentication is enabled and the request is missing or has an invalid API key.

**Status:** `401`

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "Unauthorized",
    "message": "Missing API key. Please provide X-API-Key header."
  }
}
```

**Common causes:**
- `X-API-Key` header is missing
- The provided key does not match any configured key
- API key authentication is enabled but no keys are configured

**Suggested fix:** Include a valid API key in the `X-API-Key` request header. Contact the API administrator if you need a key.

---

## ServerError

Returned for unexpected internal errors that do not match any specific error type.

**Status:** `500`

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "ServerError",
    "message": "An unexpected error occurred."
  }
}
```

**Note:** In non-production environments, the `message` field contains the original error message for debugging. In production, it is replaced with a generic message.

**Suggested fix:** Retry the request. If the error persists, report it with the `X-Request-ID` response header value for troubleshooting.
