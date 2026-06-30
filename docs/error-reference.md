# Error Reference

All error responses follow the shape:
This document lists the machine-readable error types returned by the StellarKit API. All error responses use the envelope `{ success: false, error: { ... } }`. See [API Design Guidelines](api-design.md) for the full error shape specification.

## HorizonTimeout

Returned when the Stellar Horizon node does not respond before the request timeout (HTTP **504**).

| Field        | Value                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `type`       | `"HorizonTimeout"`                                                                                                    |
| `message`    | `"The Stellar Horizon node did not respond in time."`                                                                 |
| `suggestion` | `"Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org."` |

### Example

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
    "type": "OfferNotFound",
    "message": "Offer '123456' was not found on the Stellar testnet network.",
    "suggestion": "The offer may have already been filled, cancelled, or the offer ID may be incorrect."
  }
}
```

**Possible causes:**

- The offer ID is incorrect or malformed.
- The offer has already been filled or claimed.
- The offer was cancelled by the creator.
  "type": "HorizonTimeout",
  "message": "The Stellar Horizon node did not respond in time.",
  "suggestion": "Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org."
  }
  }

```

```
