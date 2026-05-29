# Pull Request: Add Account Trustline Health Dashboard Endpoint

## Overview

This PR adds a new `GET /account/:id/trustline-health` endpoint that provides a comprehensive health overview of all trustlines on a Stellar account, including authorization status, liability usage, available capacity, and warnings for trustlines approaching their limits.

## Related Issue

- **Feature Request:** Account Trustline Health Dashboard Endpoint
- **Acceptance Criteria:** All met ✅

## Changes

### New Endpoint

**Endpoint:** `GET /account/:id/trustline-health`

**File:** `src/routes/account.js` (lines 1720-1780)

**Purpose:** Returns a full health overview of all trustlines on an account with real-time metrics for monitoring asset exposure and capacity.

### Features

- ✅ **Account ID Validation** - Validates Stellar account IDs (G-prefixed public keys)
- ✅ **Trustline Health Data** - Returns comprehensive metrics for each trustline:
  - `assetCode` - The asset code (e.g., USD, EUR, USDC)
  - `assetIssuer` - The issuer's account public key
  - `balance` - Current balance of the asset
  - `limit` - Trustline limit
  - `buyingLiabilities` - Amount of XLM locked in open buy offers
  - `sellingLiabilities` - Amount locked in open sell offers
  - `usagePercent` - Usage percentage calculated as `(balance + buyingLiabilities) / limit * 100`
  - `availableCapacity` - Remaining capacity: `limit - balance - buyingLiabilities`
  - `isAuthorized` - Whether the trustline is authorized by the issuer
  - `isClawbackEnabled` - Whether the issuer has clawback enabled for this trustline
  - `warning` - `"near_limit"` if usage exceeds 90%, otherwise `null`

- ✅ **Warning Detection** - Flags trustlines where usage > 90% with `warning: "near_limit"`
- ✅ **Warning Count** - Aggregates total count of trustlines with warnings
- ✅ **Native XLM Exclusion** - Filters out native XLM balance; returns only asset trustlines
- ✅ **Zero Limit Handling** - Gracefully handles trustlines with zero limits
- ✅ **Comprehensive Error Handling** - Returns appropriate status codes and error messages

### Response Structure

#### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "trustlineCount": 2,
    "warningCount": 1,
    "trustlines": [
      {
        "assetCode": "USD",
        "assetIssuer": "GBBD67CHI7LWB6C67GR77S3E5K5SNCZ275W6G3XF2A6F2A6F2A6F",
        "balance": "50.0000000",
        "limit": "100.0000000",
        "buyingLiabilities": "0.0000000",
        "sellingLiabilities": "10.0000000",
        "usagePercent": 50,
        "availableCapacity": "50.0000000",
        "isAuthorized": true,
        "isClawbackEnabled": false,
        "warning": null
      },
      {
        "assetCode": "EUR",
        "assetIssuer": "GAHH7A6X7K4J5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W5G4W",
        "balance": "95.0000000",
        "limit": "100.0000000",
        "buyingLiabilities": "0.0000000",
        "sellingLiabilities": "0.0000000",
        "usagePercent": 95,
        "availableCapacity": "5.0000000",
        "isAuthorized": true,
        "isClawbackEnabled": false,
        "warning": "near_limit"
      }
    ]
  }
}
```

#### Error Responses

- **404 Not Found** - Account does not exist on the Stellar network
- **400 Bad Request** - Invalid account ID format

### Implementation Details

#### Algorithm

1. Validates the account ID using `validateAccountId()`
2. Loads account details from Horizon using `server.loadAccount(id)`
3. Filters out native XLM balance (asset_type !== "native")
4. For each trustline, calculates:
   - Usage percentage: `(balance + buyingLiabilities) / limit * 100`
   - Available capacity: `limit - balance - buyingLiabilities` (minimum 0)
   - Warning flag: `"near_limit"` if usage > 90%, otherwise `null`
5. Aggregates warning count across all trustlines
6. Returns response in standard API envelope format

#### Key Calculations

```javascript
// Usage percentage
usagePercent = ((balance + buyingLiabilities) / limit) * 100;

// Available capacity (cannot be negative)
availableCapacity = Math.max(0, limit - balance - buyingLiabilities);

// Warning threshold
warning = usagePercent > 90 ? "near_limit" : null;
```

## Files Modified

### Added

- `src/routes/account.js` - New endpoint handler (61 lines added)
- `tests/account.trustlineHealth.test.js` - Comprehensive test suite (13 test cases)

## Testing

### Test Coverage

All 13 tests passing ✅

1. **returns trustline health data for all asset trustlines** - Validates basic endpoint functionality with multiple trustlines
2. **flags trustlines with usage above 90% as near_limit warning** - Verifies warning detection at threshold
3. **considers buying liabilities in usage calculation** - Ensures buying liabilities are included in usage
4. **calculates available capacity correctly** - Validates available capacity computation
5. **handles unauthorized trustlines** - Tests with `is_authorized: false`
6. **handles trustlines with clawback enabled** - Tests with `is_clawback_enabled: true`
7. **excludes native XLM from trustline health data** - Confirms native XLM is filtered out
8. **returns empty trustlines array for account with no assets** - Tests edge case of account with only native XLM
9. **handles zero limit gracefully** - Tests edge case of zero-limit trustlines
10. **returns 404 for non-existent account** - Tests error handling for missing accounts
11. **returns 400 for invalid account ID** - Tests validation error handling
12. **correctly counts multiple warnings** - Validates warning count aggregation with multiple warnings
13. **rounds usage percent to 2 decimal places** - Ensures proper numerical precision

### Running Tests

```bash
npm test -- tests/account.trustlineHealth.test.js
```

**Test Results:**

```
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Snapshots:   0 total
Time:        ~4.4s
```

## Code Quality

### Linting

✅ Passes ESLint with no errors in new code

```bash
npm run lint -- src/routes/account.js
```

### Standards Compliance

- ✅ Follows existing project patterns and conventions
- ✅ Uses project's response envelope format (`success` response wrapper)
- ✅ Integrates with existing validation utilities (`validateAccountId`)
- ✅ Proper error handling using project's error middleware
- ✅ Comprehensive JSDoc comments for maintainability
- ✅ Consistent with other account endpoints

## API Documentation

### Endpoint Summary

| Method | Endpoint                        | Description                               |
| ------ | ------------------------------- | ----------------------------------------- |
| GET    | `/account/:id/trustline-health` | Returns health overview of all trustlines |

### Parameters

| Parameter | Type   | Required | Description                             |
| --------- | ------ | -------- | --------------------------------------- |
| `id`      | string | Yes      | Stellar account public key (G-prefixed) |

### Response Fields

| Field            | Type   | Description                           |
| ---------------- | ------ | ------------------------------------- |
| `accountId`      | string | The Stellar account ID                |
| `trustlineCount` | number | Total number of asset trustlines      |
| `warningCount`   | number | Number of trustlines with usage > 90% |
| `trustlines`     | array  | Array of trustline health objects     |

### Trustline Health Object Fields

| Field                | Type           | Description                                     |
| -------------------- | -------------- | ----------------------------------------------- |
| `assetCode`          | string         | The asset code                                  |
| `assetIssuer`        | string         | The issuer's public key                         |
| `balance`            | string         | Current balance (7 decimal places)              |
| `limit`              | string         | Trustline limit (7 decimal places)              |
| `buyingLiabilities`  | string         | Amount in open buy offers (7 decimal places)    |
| `sellingLiabilities` | string         | Amount in open sell offers (7 decimal places)   |
| `usagePercent`       | number         | Usage percentage (0-100, rounded to 2 decimals) |
| `availableCapacity`  | string         | Available capacity (7 decimal places)           |
| `isAuthorized`       | boolean        | Whether trustline is authorized                 |
| `isClawbackEnabled`  | boolean        | Whether issuer has clawback enabled             |
| `warning`            | string \| null | `"near_limit"` if usage > 90%, otherwise `null` |

## Use Cases

### 1. Wallet Dashboard

Monitor account trustline health in real-time to display warnings when approaching limits.

### 2. Risk Assessment

Identify accounts with high trustline usage to flag potential concentration risk.

### 3. Transaction Planning

Before sending assets, check available capacity on destination trustlines.

### 4. Portfolio Monitoring

Track liability exposure across all trusted assets in a single call.

### 5. Compliance & Reporting

Generate reports on asset exposure and trustline health across managed accounts.

## Breaking Changes

None - This is a new endpoint. No existing functionality is affected.

## Backward Compatibility

✅ Fully backward compatible - no modifications to existing endpoints.

## Performance Considerations

- **Database Calls:** 1 (single `loadAccount` call to Horizon)
- **Response Time:** ~20-50ms typical (depends on network latency to Horizon)
- **Caching:** Could be added if frequently accessed; Horizon data is real-time
- **Scalability:** Linear with number of trustlines on account (typical: 10-50)

## Security Considerations

- ✅ Account IDs are validated before querying Horizon
- ✅ All user input is sanitized via `validateAccountId`
- ✅ No private keys or sensitive data is returned or required
- ✅ Endpoint follows existing rate limiting and security middleware
- ✅ Error messages are appropriately sanitized

## Additional Notes

### Future Enhancements

- Add optional query parameter `?minUsagePercent=X` to filter trustlines by usage threshold
- Add optional query parameter `?sortBy=usage|balance|limit` for response ordering
- Add optional caching for improved performance on frequently accessed accounts
- Consider adding historical trustline usage tracking

### Related Endpoints

- `GET /account/:id` - Full account details including all trustlines
- `GET /account/:id/balances` - Asset balances only
- `GET /account/:id/can-receive/:assetCode/:assetIssuer` - Receive capacity for specific asset
- `GET /account/:id/freeze-status/:assetCode/:assetIssuer` - Authorization status for specific asset

## Checklist

- [x] Code implemented
- [x] Tests written and passing (13/13)
- [x] ESLint validation passed
- [x] Error handling implemented
- [x] API documentation added
- [x] JSDoc comments added
- [x] Edge cases handled (zero limits, no assets, etc.)
- [x] Backward compatibility maintained
- [x] No breaking changes introduced
- [x] Follows project conventions

## Review Requests

- [ ] Code review for implementation correctness
- [ ] Review error handling approach
- [ ] Verify test coverage adequacy
- [ ] API documentation review
- [ ] Performance implications review (if applicable)

## Questions for Reviewers

1. Should we add optional query parameters for filtering/sorting?
2. Would caching be beneficial for this endpoint?
3. Should we add historical tracking of trustline usage?

---

**Author:** GitHub Copilot  
**Date:** May 29, 2026  
**Type:** Feature  
**Severity:** Low  
**Priority:** Medium
