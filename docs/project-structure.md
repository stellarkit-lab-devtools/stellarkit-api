# Project Structure Guide

This document explains the full codebase layout, conventions for adding new code, and the middleware execution order.

## Table of Contents

- [Directory Overview](#directory-overview)
- [Core Concepts](#core-concepts)
- [src/ Folder Layout](#src-folder-layout)
- [Adding New Routes](#adding-new-routes)
- [Adding Utilities](#adding-utilities)
- [Adding Middleware](#adding-middleware)
- [Middleware Execution Order](#middleware-execution-order)
- [Configuration and Stellar SDK](#configuration-and-stellar-sdk)
- [Error Handling](#error-handling)

---

## Directory Overview

```
stellarkit-api/
├── src/                      # Application source code
│   ├── index.js             # Express app setup and middleware registration
│   ├── websocket.js         # WebSocket streaming helpers
│   ├── config/              # Configuration and Stellar SDK setup
│   │   ├── stellar.js       # Shared Horizon server instance (required import)
│   │   └── cacheConfig.js   # Cache TTL configuration
│   ├── routes/              # API endpoint implementations
│   ├── middleware/          # Request processing middleware
│   ├── utils/               # Shared utility functions
│   └── services/            # Higher-level business logic services
├── tests/                   # API and integration tests
├── docs/                    # Extended documentation
├── types/                   # TypeScript type definitions
├── examples/                # Example usage scripts
└── package.json             # Dependencies and scripts
```

---

## Core Concepts

### The Shared Stellar Server Instance

**The most important principle:** All routes must use the shared Horizon server instance from `src/config/stellar.js`, not create their own.

```javascript
// ✅ CORRECT
const { server, NETWORK, sorobanServer } = require("../config/stellar");
const horizonAccount = await server.accounts().accountId(publicKey).call();

// ❌ WRONG - creates a separate instance
const { Horizon } = require("@stellar/stellar-sdk");
const myServer = new Horizon.Server("https://horizon-testnet.stellar.org");
const horizonAccount = await myServer.accounts().accountId(publicKey).call();
```

**Why?**
- Ensures consistent configuration across all endpoints
- Makes testing easier — we can mock one server for all routes
- Simplifies environment variable handling (HORIZON_URL, STELLAR_NETWORK)
- Prevents connection pool exhaustion from multiple instances
- All routes automatically get the correct network (testnet/mainnet) without repeated configuration

**Audit Result:** All 21 route files in the codebase follow this pattern correctly — no route file creates its own Horizon.Server or rpc.Server instance.

### Error Handling Pattern

All routes must follow the `next(err)` pattern for errors. Never call `res.json()` with an error directly.

```javascript
// ✅ CORRECT
router.get("/account/:id", async (req, res, next) => {
  try {
    const account = await server.accounts().accountId(req.params.id).call();
    success(res, account);
  } catch (err) {
    next(err);  // Let errorHandler middleware format it
  }
});

// ❌ WRONG - bypasses centralized error handling
router.get("/account/:id", async (req, res) => {
  try {
    const account = await server.accounts().accountId(req.params.id).call();
    res.json({ success: true, data: account });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### Response Formatting

Use the `success()` helper from `src/utils/response.js` to format all successful responses:

```javascript
const { success } = require("../utils/response");

// Simple response
success(res, data);

// Response with metadata
success(res, data, { 
  page: 1, 
  total: 100,
  cacheHit: true 
});
```

---

## src/ Folder Layout

### src/index.js

The Express application entry point. This file:

1. Loads environment variables via `dotenv`
2. Creates the Express app
3. Registers global middleware
4. Mounts route handlers
5. Starts the server

When adding new middleware, register it here in the correct order (see [Middleware Execution Order](#middleware-execution-order)).

### src/config/

**stellar.js** — The central place for Stellar SDK configuration.

Exports:
- `server` — Shared Horizon server instance (use this in all routes)
- `sorobanServer` — Soroban RPC instance (use this in Soroban routes)
- `horizonUrl` — Current Horizon URL (derived from env or defaults)
- `NETWORK` — Current network ("testnet" or "mainnet")
- `fetchAccountCreation()` — Helper to get account creation details
- `fetchContract()` — Helper to get Soroban contract data

**cacheConfig.js** — Cache TTL settings for different endpoints. Adjust here to tune performance.

### src/routes/

Contains 21 route handler files. Each file exports an Express router with one or more related endpoints.

**Naming convention:**
- `account.js` — Account endpoints (GET /account/:id, etc.)
- `accounts.js` — Batch account endpoints (POST /accounts/batch, etc.)
- `asset.js` — Asset endpoints
- `dex.js` — DEX trading endpoints
- `network.js` — Network status endpoints
- `soroban.js` — Soroban contract endpoints
- `webhooks.js` — Webhook registration endpoints
- etc.

**File structure for a new route:**

```javascript
const express = require("express");
const router = express.Router();
const { server, NETWORK, sorobanServer } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");

// Validation middleware (optional, for this router only)
router.use(someMiddleware);

// Route handler
router.get("/my-endpoint/:id", async (req, res, next) => {
  try {
    validateAccountId(req.params.id);
    
    const result = await server.accounts()
      .accountId(req.params.id)
      .call();
    
    success(res, result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

### src/utils/

30 utility files providing shared logic:

**Response and validation:**
- `response.js` — Format success responses and timestamps
- `validators.js` — Validate query params, account IDs, asset codes
- `StellarKitError.js` — Custom error class

**Error translation:**
- `errors.js` — Detect Horizon timeouts
- `horizonErrors.js` — Translate Horizon error codes to English
- `horizonStatusMapper.js` — Map errors to HTTP status codes

**Formatting:**
- `formatAmount.js` — Format amounts to 7 decimals
- `formatBalance.js` — Add thousand separators
- `formatTransaction.js` — Format transaction for SSE
- `operationFormatter.js` — Normalize operation shape
- `toCamelCase.js` — Convert snake_case to camelCase

**Asset and account logic:**
- `asset.js` — Parse asset strings (CODE:ISSUER)
- `assetHelpers.js` — Native asset detection
- `assetToml.js` — TOML asset metadata resolution
- `accountAge.js` — Calculate account age metrics
- `memo.js` — Decode memo fields

**Data mapping:**
- `mapAccountTrade.js` — Normalize trade records
- `mapFeeEstimate.js` — Normalize fee estimates
- `mapNetworkStatus.js` — Normalize network status

**Infrastructure:**
- `cache.js` — Shared NodeCache instances
- `logger.js` — Structured Pino logger
- `pagination.js` — Resolve page numbers to cursors
- `contractDeployment.js` — Find contract deployment data
- `contractSpec.js` — Parse contract ABIs
- `crypto.js` — HMAC and hash utilities
- `effectTypes.js` — Valid effect type list
- `horizonHealth.js` — Health check Horizon connectivity
- `tomlResolver.js` — Cache and fetch TOML files

### src/middleware/

17 middleware files that process requests. See [Middleware Execution Order](#middleware-execution-order) for the order they run.

---

## Adding New Routes

### Step 1: Create a Route File

Create a new file in `src/routes/` (e.g., `src/routes/my-feature.js`):

```javascript
const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");

router.get("/my-feature/:accountId", async (req, res, next) => {
  try {
    validateAccountId(req.params.accountId);
    
    const data = await server.accounts()
      .accountId(req.params.accountId)
      .call();
    
    success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

### Step 2: Register the Route in src/index.js

```javascript
const myFeatureRouter = require("./routes/my-feature");
app.use("/", myFeatureRouter);
```

### Step 3: Add Tests

Create `tests/routes/my-feature.test.js`:

```javascript
const request = require("supertest");
const app = require("../../src/index");

describe("GET /my-feature/:accountId", () => {
  it("returns feature data", async () => {
    const res = await request(app)
      .get("/my-feature/GXXX...")
      .expect(200);
    
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});
```

---

## Adding Utilities

Utilities in `src/utils/` are small, focused functions used across routes.

### When to Create a Utility

- **Reusable logic** — If two or more routes or files need the same function, move it to utils
- **Pure functions** — Utilities should be stateless and not depend on request context
- **Formatting** — Converting data shapes, encoding, decoding

### Example: Adding a New Formatter

```javascript
// src/utils/myNewFormatter.js
function myNewFormatter(data) {
  // Transform data
  return transformed;
}

module.exports = { myNewFormatter };
```

Then import where needed:

```javascript
const { myNewFormatter } = require("../utils/myNewFormatter");

// Use in route
const formatted = myNewFormatter(data);
```

---

## Adding Middleware

Middleware processes requests before they reach route handlers.

### When to Create Middleware

- **Cross-cutting concerns** — Logging, authentication, rate limiting
- **Request transformation** — Normalizing params, coercing types
- **Global validation** — Checking headers, rejecting bad methods

### Example: Adding New Middleware

Create `src/middleware/my-middleware.js`:

```javascript
/**
 * My middleware does X, Y, Z.
 */
function myMiddleware(req, res, next) {
  // Process or modify request
  req.myData = "value";
  
  // Call next to continue
  next();
}

module.exports = myMiddleware;
```

Register in `src/index.js` **in the correct order** (see below):

```javascript
const myMiddleware = require("./middleware/my-middleware");
app.use(myMiddleware);
```

---

## Middleware Execution Order

The order middleware is registered in `src/index.js` **matters**. Middleware runs top to bottom. Each middleware can pass control to the next via `next()`.

### Recommended Order

```javascript
// 1. Body parsing and safety
app.use(express.json());
app.use(bodySizeLimit);

// 2. Request identification and logging startup
app.use(requestId);
app.use(requestLogger);

// 3. Validation and normalization
app.use(restrictHttpMethods);
app.use(contentTypeValidator);
app.use(sanitize);
app.use(rejectDuplicateQueryParams);
app.use(coerceQueryParams);
app.use(normalizeAssetCode);

// 4. Authentication and authorization
app.use(apiKeyAuth);

// 5. Rate limiting (after auth so we rate-limit per key)
app.use(rateLimiter);

// 6. Route mounting
app.use("/", routes);

// 7. Post-response processing
app.use(metricsCollector);
app.use(etag);

// 8. Error handling (MUST be last)
app.use(errorHandler);
```

**Why this order?**

1. **Body parsing first** — Routes need parsed JSON
2. **Identification early** — So subsequent middleware can log with request ID
3. **Validation before routes** — Catch bad requests before expensive operations
4. **Authentication before rate limiting** — We want to rate-limit per user, not just globally
5. **Routes in the middle** — After setup, before cleanup
6. **Post-processing before error handler** — So we can modify successful responses
7. **Error handler absolutely last** — Catches all errors from middleware and routes

---

## Configuration and Stellar SDK

### Using the Shared Stellar Server

**Every route must import the shared server:**

```javascript
const { server, NETWORK, sorobanServer, horizonUrl } = require("../config/stellar");
```

Available exports:
- `server` — Horizon server instance (use for account, transaction, asset, etc.)
- `sorobanServer` — Soroban RPC instance (use for contract calls)
- `NETWORK` — Current network string ("testnet" or "mainnet")
- `horizonUrl` — Current Horizon URL
- `NETWORKS` — Object with all network URLs
- `fetchAccountCreation(publicKey)` — Helper to get account creation date
- `fetchContract(contractId)` — Helper to get contract details

### Environment Variables

These env vars control Stellar SDK configuration:

- `STELLAR_NETWORK` — "testnet" or "mainnet" (default: testnet)
- `HORIZON_URL` — Override Horizon URL
- `SOROBAN_RPC_URL` — Override Soroban RPC URL

See [Environment Variables Reference](environment-configuration.md) for all options.

---

## Error Handling

### Error Handling Pattern

All async route handlers must follow this pattern:

```javascript
router.get("/endpoint", async (req, res, next) => {
  try {
    // Your logic here
    success(res, data);
  } catch (err) {
    // Always pass to next() — never call res.json() directly
    next(err);
  }
});
```

The `errorHandler` middleware catches the error and formats it consistently.

### Custom Error Types

For application errors, use `StellarKitError`:

```javascript
const StellarKitError = require("../utils/StellarKitError");

const err = new StellarKitError(
  "NOT_FOUND",
  400,
  "Account not found",
  "Check the account ID and try again."
);

throw err;
```

### Horizon Error Translation

Horizon errors are automatically translated to user-friendly messages via the error handler. The flow:

1. Horizon throws an error (e.g., "Account not found")
2. `errorHandler` catches it
3. `horizonErrors.js` translates the code
4. `horizonStatusMapper.js` maps to HTTP status
5. User receives a consistent JSON error response

---

## Testing Conventions

- Tests live in `tests/` matching the `src/` structure
- Use Jest and Supertest for route tests
- Mock the Horizon server using Jest mocks
- Tests should pass without touching the real network

Example test:

```javascript
describe("GET /account/:id", () => {
  it("returns account data", async () => {
    const res = await request(app)
      .get("/account/GXXX...")
      .expect(200);
    
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
  });
});
```

---

## Summary: Checklist for New Features

- [ ] Created route file in `src/routes/` (or added to existing)
- [ ] Route imports shared `server` from `src/config/stellar.js`
- [ ] Route uses `success()` helper for responses
- [ ] Route uses `next(err)` for errors
- [ ] Registered route in `src/index.js`
- [ ] Added tests in `tests/routes/`
- [ ] Created utility files in `src/utils/` for shared logic
- [ ] Created middleware files in `src/middleware/` if needed
- [ ] Registered middleware in correct order in `src/index.js`
- [ ] Updated CONTRIBUTING.md if introducing new conventions
- [ ] Updated README.md project structure if adding new files

---

For questions or suggestions, open an issue or discussion on [GitHub](https://github.com/stellarkit-lab-devtools/stellarkit-api).
