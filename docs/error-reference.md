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

For a complete reference of HTTP status codes returned by the API, see [Error Codes](./error-codes.md).

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

| Type                  | HTTP Status | Description                                                           |
| --------------------- | ----------- | --------------------------------------------------------------------- |
| `ValidationError`     | 400         | Input validation failed (invalid account ID, asset code, limit, etc.) |
| `HorizonError`        | varies      | Error propagated from the Stellar Horizon API                         |
| `InsufficientReserve` | 422         | Account does not have enough XLM to cover the minimum reserve requirement |
| `OfferNotFound`       | 404         | A specific offer was requested but does not exist on the network      |
| `LiquidityPoolNotFound` | 404       | A specific liquidity pool was requested but does not exist on the network |
| `TrustlineNotFound`   | 404         | The requested asset trustline does not exist on the account           |
| `TomlFetchFailed`     | 502         | The issuer's stellar.toml could not be fetched (network error, missing file, or invalid format) |
| `NotFound`            | 404         | Route or resource not found                                           |
| `RateLimitError`      | 429         | Too many requests from the same IP                                    |
| `ServerError`         | 500         | Unexpected internal error                                             |

---

### OfferNotFound

Returned when `GET /account/:id/offers?offerId=<id>` is called with an offer ID that does not exist, or when any operation references a non-existent offer.

**Example response:**

```json
{
  "success": false,
  "error": {
    "type": "OfferNotFound",
    "message": "Offer '12345' was not found on the Stellar testnet network.",
    "suggestion": "The offer may have already been filled, cancelled, or the offer ID may be incorrect."
  }
}
```

---

### TrustlineNotFound

Returned when an endpoint looks up a specific asset trustline for an account and that trustline does not exist.

**Status:** `404`

**Affected endpoints:**
- `GET /account/:id/asset-balance/:assetCode/:assetIssuer`
- `GET /account/:id/freeze-status/:assetCode/:assetIssuer`
- `GET /account/:id/can-receive/:assetCode/:assetIssuer`

**Example response:**

```json
{
  "success": false,
  "error": {
    "type": "TrustlineNotFound",
    "message": "Account 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN' does not hold a trustline for USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN.",
    "suggestion": "The account must establish a trustline before holding this asset."
  }
}
```

**Common causes:**
- The account has never created a trustline for the requested asset
- The trustline was removed by the account holder
- The wrong issuer address was supplied

**Suggested fix:** The account must submit a `changeTrust` operation for the asset before it can hold a balance or interact with it.

---

### LiquidityPoolNotFound

Returned when a liquidity pool endpoint (`GET /liquidity-pools/:id`, `GET /liquidity-pools/:id/trades`, `GET /liquidity-pools/:id/profitability`, `GET /liquidity-pools/:id/reserve-ratio`) is called with a pool ID that does not exist on the network. The raw Horizon `404` is translated into this structured error.

**Status:** `404`

**Affected endpoints:**
- `GET /liquidity-pools/:id`
- `GET /liquidity-pools/:id/trades`
- `GET /liquidity-pools/:id/profitability`
- `GET /liquidity-pools/:id/reserve-ratio`

**Example response:**

```json
{
  "success": false,
  "error": {
    "type": "LiquidityPoolNotFound",
    "message": "Liquidity pool '67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026' was not found on the Stellar mainnet network.",
    "suggestion": "Verify the pool ID is correct and that the pool has not been dissolved."
  }
}
```

**Common causes:**
- The pool ID is misspelled or truncated
- The liquidity pool has been dissolved and removed from the network
- The pool exists on a different network (e.g., looking up a mainnet pool on testnet)

**Suggested fix:** Verify the pool ID is a valid 64-character hex string and that the pool exists on the configured network. See [Mainnet vs Testnet Configuration](./deployment.md#mainnet-vs-testnet-configuration) for guidance.

---

## TomlFetchFailed

Returned by `GET /asset/:code/:issuer/toml` when the issuer's `stellar.toml` file cannot be fetched — due to a network error, a missing file, or invalid TOML content.

**Status:** `502`

**Example response:**

```json
{
  "success": false,
  "error": {
    "type": "TomlFetchFailed",
    "message": "Could not fetch stellar.toml for issuer 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'.",
    "suggestion": "Verify the issuer has a valid stellar.toml at their home domain. See https://developers.stellar.org/docs/issuing-assets/publishing-asset-info for requirements."
  }
}
```

**Common causes:**
- The issuer account has no `home_domain` set
- The issuer's home domain is unreachable or times out
- `/.well-known/stellar.toml` does not exist at the issuer's home domain (404)
- The file exists but is not valid TOML

**Suggested fix:** The issuer must publish a valid `stellar.toml` at `https://<home_domain>/.well-known/stellar.toml`.

---

## InsufficientReserve

Returned when an operation fails because the account does not have enough XLM to meet the minimum reserve requirement. This occurs when a Horizon operation returns the `op_low_reserve` error code.

**Status:** `422`

**Example:**

```json
{
  "success": false,
  "error": {
    "type": "InsufficientReserve",
    "message": "Account does not have enough XLM to cover the minimum reserve requirement.",
    "suggestion": "Fund the account with additional XLM. Each account requires a base reserve of 1 XLM plus 0.5 XLM per subentry."
  }
}
```

**Common causes:**
- The account does not have enough XLM to cover the base reserve (1 XLM) plus 0.5 XLM for each subentry (trustlines, offers, signers, data entries)
- The operation would create a subentry that would push the account below the minimum reserve
- The account is trying to send XLM that would leave it below the reserve

**Suggested fix:** Fund the account with additional XLM. Calculate the required reserve as: `1 XLM + (0.5 XLM × number of subentries)`. Each trustline, offer, signer, and data entry counts as one subentry.

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

---

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

**Note:** In non-production environments, the `message` field contains the original error message for debugging. In production, it is replaced with a generic message.

**Suggested fix:** Retry the request. If the error persists, report it with the `X-Request-ID` response header value for troubleshooting.
