# StellarKit Client SDK

A lightweight Node.js client that wraps all StellarKit API endpoints into clean async functions. Uses native `fetch` — no extra dependencies.

## Installation

Copy `stellarkit-client.js` into your project, or require it directly:

```js
const { StellarKitClient, StellarKitError } = require("./stellarkit-client");
```

## Usage

```js
const { StellarKitClient, StellarKitError } = require("./stellarkit-client");

const client = new StellarKitClient({
  baseUrl: "http://localhost:3000",
  apiKey: "optional-api-key",   // omit if not using API key auth
});

// Each method returns a Promise resolving to the `data` field of the response
const health = await client.getHealth();
console.log(health.status); // "ok"

// Errors throw StellarKitError with .status and .message
try {
  const account = await client.getAccount("INVALID_KEY");
} catch (err) {
  if (err instanceof StellarKitError) {
    console.error(err.status, err.message);
  }
}
```

## API

### Constructor

```js
new StellarKitClient({ baseUrl, apiKey? })
```

| Option    | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `baseUrl` | string | Yes      | Base URL of the StellarKit API       |
| `apiKey`  | string | No       | Sent as `X-API-Key` request header   |

### Methods

| Method | Endpoint |
|--------|----------|
| `getHealth()` | `GET /health` |
| `getNetworkStatus()` | `GET /network-status` |
| `getFeeEstimate(operations?)` | `GET /fee-estimate` |
| `getAccount(id)` | `GET /account/:id` |
| `getAccountBalances(id)` | `GET /account/:id/balances` |
| `getAccountSequence(id)` | `GET /account/:id/sequence` |
| `getAccountSummary(id)` | `GET /account/:id/summary` |
| `getAccountPayments(id, params?)` | `GET /account/:id/payments` |
| `getTransactions(id, params?)` | `GET /transactions/:id` |
| `getTransactionOperations(id, params?)` | `GET /transactions/:id/operations` |
| `getAsset(code, issuer)` | `GET /asset/:code/:issuer` |
| `getAssetHolders(code, issuer, params?)` | `GET /asset/:code/:issuer/holders` |
| `searchAssets(code)` | `GET /asset/search?code=:code` |

All methods return `Promise<data>` where `data` is the `data` field from the API response envelope.

### Error handling

Non-2xx responses throw `StellarKitError`:

```js
err.status   // HTTP status code (e.g. 404)
err.message  // Human-readable error message from the API
err.name     // "StellarKitError"
```
