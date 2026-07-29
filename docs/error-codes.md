# HTTP Status Codes Reference

This document lists all HTTP status codes returned by the StellarKit API, along with descriptions, example scenarios, and sample response bodies.

---

## 200 OK

**Description:** The request succeeded and the response contains the requested data.

**When returned:**
- Successful GET requests returning account data, balances, transactions, etc.
- Any successful read operation

**Example scenario:** Fetching account details for an existing account.

**Sample response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "sequence": "123456789",
    "xlm": {
      "balance": "100.0000000"
    }
  }
}
```

---

## 201 Created

**Description:** The request succeeded and a new resource was created.

**When returned:**
- Successful POST requests that create new resources
- Transaction submission that results in account creation

**Example scenario:** Successfully submitting a transaction that creates a new account.

**Sample response:**

```json
{
  "success": true,
  "data": {
    "transactionHash": "5ebd5c0af4385500b53dd63b0ef5f6e8feef1a7e2035c5dd1f2539e2f817349c",
    "status": "success"
  }
}
```

---

## 400 Bad Request

**Description:** The request is malformed or contains invalid parameters.

**When returned:**
- Invalid account ID format (not 56 characters or doesn't start with G)
- Invalid asset code (empty, too long, or contains special characters)
- Invalid query parameters
- Malformed request body

**Example scenario:** Requesting account details with an invalid account ID.

**Sample response:**

```json
{
  "success": false,
  "error": {
    "type": "InvalidAccountId",
    "message": "Invalid account ID format. Account addresses must start with 'G' and be 56 characters long.",
    "suggestion": "Account addresses start with G and are 56 characters long."
  }
}
```

---

## 401 Unauthorized

**Description:** Authentication is required but was not provided or is invalid.

**When returned:**
- API key authentication is enabled but no `X-API-Key` header was provided
- The provided API key is invalid or expired

**Example scenario:** Accessing a protected endpoint without providing an API key.

**Sample response:**

```json
{
  "success": false,
  "error": {
    "type": "Unauthorized",
    "message": "API key is required to access this endpoint.",
    "suggestion": "Provide a valid API key in the X-API-Key header."
  }
}
```

---

## 404 Not Found

**Description:** The requested resource does not exist.

**When returned:**
- Requesting data for an account that doesn't exist on the network
- Requesting a transaction that doesn't exist
- Requesting an asset that isn't found
- Invalid API route

**Example scenario:** Requesting details for an unfunded account.

**Sample response:**

```json
{
  "success": false,
  "error": {
    "type": "AccountNotFound",
    "message": "Account GABC123... was not found on the Stellar testnet network.",
    "suggestion": "Verify the account address is correct and that the account has been funded."
  }
}
```

---

## 413 Payload Too Large

**Description:** The request body exceeds the maximum allowed size.

**When returned:**
- POST/PUT request body is larger than the configured `MAX_BODY_SIZE` (default: 10kb)

**Example scenario:** Submitting a transaction with an extremely large memo or data payload.

**Sample response:**

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

---

## 422 Unprocessable Entity

**Description:** The request is well-formed but cannot be processed due to semantic errors or business logic violations.

**When returned:**
- Horizon transaction submission failures (transaction rejected by the network)
- Insufficient XLM reserve
- Trustline limit reached
- Insufficient balance for operation
- Invalid transaction sequence number

**Example scenario:** Attempting a payment that would leave the account below the minimum reserve.

**Sample response:**

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

---

## 429 Too Many Requests

**Description:** The client has exceeded the rate limit.

**When returned:**
- Making too many requests within the configured time window
- Global limit: 100 requests per 15 minutes (configurable)
- Account summary: 20 requests per 15 minutes
- Asset holders: 10 requests per 15 minutes

**Example scenario:** Making 101 requests within 15 minutes when the limit is 100.

**Sample response:**

```json
{
  "success": false,
  "error": {
    "type": "RateLimitError",
    "message": "Too many requests, please try again after 15 minutes."
  }
}
```

**Response headers:**
- `Retry-After`: Seconds until the rate limit resets
- `RateLimit-Limit`: Maximum requests allowed
- `RateLimit-Remaining`: Requests remaining in current window
- `RateLimit-Reset`: Unix timestamp when the limit resets

---

## 500 Internal Server Error

**Description:** An unexpected error occurred on the server.

**When returned:**
- Unhandled exceptions in application code
- Runtime errors (TypeError, ReferenceError)
- Unexpected server-side failures

**Example scenario:** A bug in the application code causes an unhandled exception.

**Sample response (production):**

```json
{
  "success": false,
  "error": {
    "type": "InternalError",
    "title": "Internal Server Error",
    "detail": "An unexpected error occurred."
  }
}
```

**Sample response (development):**

```json
{
  "success": false,
  "error": {
    "type": "InternalError",
    "title": "Internal Server Error",
    "detail": "Cannot read property 'balance' of undefined"
  }
}
```

**Note:** In production environments, error details are sanitized to avoid exposing internal implementation details.

---

## 503 Service Unavailable

**Description:** The service is temporarily unavailable, usually due to maintenance or overload.

**When returned:**
- Server is starting up or shutting down
- Database connection is unavailable
- Horizon node is unreachable

**Example scenario:** The Stellar Horizon node is temporarily down for maintenance.

**Sample response:**

```json
{
  "success": false,
  "error": {
    "type": "ServiceUnavailable",
    "message": "The service is temporarily unavailable. Please try again later.",
    "suggestion": "Check https://status.stellar.org for Stellar network status updates."
  }
}
```

---

## 504 Gateway Timeout

**Description:** The upstream Horizon server did not respond in time.

**When returned:**
- Horizon node is slow to respond
- Network connectivity issues between StellarKit and Horizon
- Horizon query takes longer than the configured timeout

**Example scenario:** A complex account query to Horizon times out after 30 seconds.

**Sample response:**

```json
{
  "success": false,
  "error": {
    "type": "HorizonTimeout",
    "message": "The Stellar Horizon node did not respond in time.",
    "suggestion": "Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org."
  }
}
```

---

## Error Response Structure

All error responses follow this consistent envelope format:

```json
{
  "success": false,
  "error": {
    "type": "ErrorType",
    "message": "Human-readable error message",
    "suggestion": "How to fix or work around the error (optional)"
  }
}
```

Some errors include additional fields:
- `detail`: More detailed technical information
- `code`: Horizon result code (for transaction failures)
- `resultCodes`: Full result codes from Horizon (for transaction failures)
- `field`: The parameter that failed validation
- `expectedFormat`: The expected format for a validation error

---

## See Also

- [Error Reference](./error-reference.md) - Detailed documentation of error types
- [API Documentation](./api-design.md) - Complete API endpoint reference
- [Rate Limiting](./rate-limiting.md) - Rate limit configuration and headers
