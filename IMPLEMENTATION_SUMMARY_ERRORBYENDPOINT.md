# Per-Endpoint Error Rate Tracking Implementation

## Summary
Successfully implemented per-endpoint error rate tracking for the StellarKit API metrics system. The implementation extends the existing metrics tracking to record error counts per route and method combination, and exposes the top 5 error-prone endpoints in the GET /metrics response.

## Changes Made

### 1. **Updated [src/services/metrics.js](src/services/metrics.js)**

#### New Constants
- `MAX_ERROR_ENDPOINTS = 5` - Maximum number of error-prone endpoints to track

#### New Instance Variable
- `_endpointErrors` - Map that tracks errors per endpoint (route + method)
  - Key: `"METHOD:route"` (e.g., `"GET:/account/:id"`)
  - Value: `{ method, route, errorCount, errorsByStatus: Map<statusCode, count> }`

#### New Method: `incrementErrorByEndpoint(method, route, statusCode)`
Records an error for a specific endpoint and tracks error type distribution.
- Normalizes method names to uppercase
- Validates inputs (method, route, statusCode)
- Accumulates error counts per endpoint
- Tracks distribution of error types per endpoint

#### New Method: `_computeErrorsByEndpoint()`
Computes and returns the top 5 error-prone endpoints sorted by error count descending.
- Iterates through all tracked endpoints
- Identifies the `topErrorType` (most common HTTP status code) for each endpoint
- Sorts by `errorCount` descending
- Returns up to 5 entries

#### Updated Method: `getSnapshot()`
Now includes `errorsByEndpoint` in the returned snapshot object.

#### Updated Method: `reset()`
Clears the `_endpointErrors` Map when resetting metrics.

### 2. **Updated [src/middleware/errorHandler.js](src/middleware/errorHandler.js)**

#### Enhanced `errorResponse()` Function
- Now tracks errors per-endpoint via `metrics.incrementErrorByEndpoint()`
- Extracts the request object from the response (`res.req`)
- Extracts route pattern using the same logic as requestLogger:
  - Uses `req.route.path` when available (Express matched route pattern)
  - Falls back to `req.path` for unmatched routes
- Calls `incrementErrorByEndpoint()` alongside `incrementError()`

### 3. **Updated [src/routes/metrics.js](src/routes/metrics.js)**

#### Enhanced Route Documentation
Added comprehensive documentation for the new `errorsByEndpoint` field in the GET /metrics response, including:
- Response shape example
- Field descriptions
- Notes about sorting and limiting

### 4. **Fixed [src/index.js](src/index.js)**

#### Middleware Order Fix
Moved the `incrementRequests()` middleware to run BEFORE the metrics router mount, ensuring that ALL requests (including /metrics) are counted in totalRequests.

## Metrics Response Format

### GET /metrics Response Structure
```json
{
  "success": true,
  "data": {
    "totalRequests": 120,
    "totalErrors": 19,
    "errorsByStatus": {
      "400": 12,
      "404": 5,
      "429": 0,
      "500": 2,
      "503": 0
    },
    "errorsByEndpoint": [
      {
        "route": "/dex/pairs",
        "method": "GET",
        "errorCount": 8,
        "topErrorType": 404
      },
      {
        "route": "/account/:id",
        "method": "GET",
        "errorCount": 5,
        "topErrorType": 400
      },
      ...
    ],
    "slowestEndpoints": [
      {
        "route": "/account/:id",
        "method": "GET",
        "averageResponseTimeMs": 320.5,
        "requestCount": 42
      },
      ...
    ]
  }
}
```

### errorsByEndpoint Array
- **Limited to 5 entries** (top error-prone endpoints)
- **Sorted by errorCount descending** (most errors first)
- Each entry includes:
  - `route`: Express route pattern (e.g., `/account/:id`)
  - `method`: HTTP method (e.g., `GET`, `POST`)
  - `errorCount`: Total number of errors on this endpoint
  - `topErrorType`: Most common HTTP status code for errors on this endpoint

## Test Coverage

### New Test File: [tests/metrics.errorsByEndpoint.test.js](tests/metrics.errorsByEndpoint.test.js)

Comprehensive test suite with 24 tests covering:

#### Unit Tests (MetricsService)
- Recording single and multiple errors per endpoint
- Tracking different endpoints independently
- Tracking different HTTP methods independently
- Identifying and updating topErrorType correctly
- Input validation (ignoring missing/invalid parameters)

#### Ranking & Sorting Tests
- Endpoints sorted by errorCount descending
- List limited to 5 entries maximum
- Top 5 endpoints contain highest error counts
- Empty array when no errors recorded

#### Integration Tests
- GET /metrics response includes errorsByEndpoint
- Correct entry shape (route, method, errorCount, topErrorType)
- Endpoint with most errors ranks first
- topErrorType values are valid HTTP status codes
- Maximum 5 entries in response

#### Edge Cases
- Method names normalized to uppercase
- Various HTTP methods supported (GET, POST, PUT, PATCH, DELETE)
- Various HTTP error codes tracked (400, 404, 429, 500, 503, 502)
- Snapshot mutations don't affect service state

## Test Results

All tests passing:
- **metrics.test.js**: 22 tests ✓
- **metrics.slowestEndpoints.test.js**: 20 tests ✓
- **metrics.errorsByEndpoint.test.js**: 24 tests ✓
- **Total**: 66 tests passing

## Acceptance Criteria Met

✅ **GET /metrics includes errorsByEndpoint** - Array of objects with route, method, errorCount, topErrorType

✅ **Sorted by error count descending** - Endpoints with most errors appear first

✅ **Limited to 5 entries** - Maximum of 5 error-prone endpoints in response

✅ **Tracks most common error type per endpoint** - topErrorType field shows the most frequently occurring HTTP status code for each endpoint

✅ **Tests verify correct ranking** - Multiple test cases confirm the endpoint with most errors is ranked first

## Usage Example

```javascript
const metrics = require('./src/services/metrics');

// Record an error for a specific endpoint
metrics.incrementErrorByEndpoint("GET", "/account/:id", 404);
metrics.incrementErrorByEndpoint("GET", "/account/:id", 400);
metrics.incrementErrorByEndpoint("GET", "/account/:id", 404);

// Get metrics snapshot
const snap = metrics.getSnapshot();
console.log(snap.errorsByEndpoint);
// Output:
// [
//   {
//     route: "/account/:id",
//     method: "GET",
//     errorCount: 3,
//     topErrorType: 404  // Most common error type (2x 404, 1x 400)
//   }
// ]
```

## Implementation Details

### Error Tracking Flow
1. Request comes in → requestLogger middleware measures response time
2. Error response generated → errorHandler.errorResponse() called
3. errorResponse() calls:
   - `metrics.incrementError(statusCode)` - Global error counter
   - `metrics.incrementErrorByEndpoint(method, route, statusCode)` - Per-endpoint tracking
4. GET /metrics endpoint returns snapshot including errorsByEndpoint

### Data Structures
- **errorsByStatus**: `Record<string, number>` - Simple count per HTTP status
- **_endpointErrors**: `Map<string, EndpointErrorData>` - Tracks per-endpoint error distribution
  - Allows identification of topErrorType without needing to sort maps

### Performance Considerations
- O(1) lookups for incrementing errors (Map-based)
- O(n log n) sorting only happens on getSnapshot() call
- Maximum 5 entries returned, so sorting is minimal
- No impact on request handling latency

## Files Modified
1. [src/services/metrics.js](src/services/metrics.js) - Core metrics service
2. [src/middleware/errorHandler.js](src/middleware/errorHandler.js) - Error tracking integration
3. [src/routes/metrics.js](src/routes/metrics.js) - Route documentation
4. [src/index.js](src/index.js) - Middleware order fix
5. [tests/metrics.errorsByEndpoint.test.js](tests/metrics.errorsByEndpoint.test.js) - New test suite

## Backwards Compatibility
✅ Fully backwards compatible - new errorsByEndpoint field added to response without removing any existing fields. Existing code will continue to work as expected.
