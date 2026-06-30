# Error Reference

This document lists the machine-readable error types returned by the StellarKit API. All error responses use the envelope `{ success: false, error: { ... } }`. See [API Design Guidelines](api-design.md) for the full error shape specification.

## HorizonTimeout

Returned when the Stellar Horizon node does not respond before the request timeout (HTTP **504**).

| Field | Value |
| --- | --- |
| `type` | `"HorizonTimeout"` |
| `message` | `"The Stellar Horizon node did not respond in time."` |
| `suggestion` | `"Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org."` |

### Example

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
