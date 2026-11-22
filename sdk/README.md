# StellarKit JavaScript Client

A lightweight, fully-typed TypeScript/JavaScript client for the StellarKit API. Supports both ESM (`import`) and CommonJS (`require`) consumers out of the box.

## Installation

After building the SDK, install it from the local path or publish it as `@stellarkit/client`:

```bash
# Local development (from the repo root)
npm install ./sdk

# When published to npm
npm install @stellarkit/client
```

**ESM (Node 18+ or bundler):**
```javascript
import { StellarKitClient } from "@stellarkit/client";
```

**CommonJS:**
```javascript
const { StellarKitClient } = require("@stellarkit/client");
```

**Soroban sub-module:**
```javascript
// ESM
import { SorobanModule } from "@stellarkit/client/soroban";
// CJS
const { SorobanModule } = require("@stellarkit/client/soroban");
```

## Building the SDK

```bash
# From the repo root — compiles both CJS and ESM outputs
npm run build:sdk

# Verify that both import() and require() resolve correctly (Node 18/20)
npm run verify:exports
```

The build produces:
- `sdk/dist/cjs/` — CommonJS output for Node.js and bundlers in CJS mode
- `sdk/dist/esm/` — ESM output for bundlers (Webpack, Vite, Rollup, esbuild)

## Getting Started

```javascript
import { StellarKitClient } from "@stellarkit/client";

const client = new StellarKitClient({
  baseUrl: "http://localhost:3000", // or your production URL
  apiKey: "your-api-key",           // optional
});
```

## Usage Examples

### Network & Fees

```javascript
// Get current network status
const status = await client.getNetworkStatus();
console.log(`Latest Ledger: ${status.latestLedger.sequence}`);

// Get recommended fees for a transaction with 3 operations
const fees = await client.getFeeEstimate(3);
console.log(`Recommended Standard Fee: ${fees.totalFee.standard.stroops} stroops`);

// Check if there is a fee surge
const surge = await client.getFeeSurgeStatus();
if (surge.isSurging) {
  console.log("Warning: Fee surge in progress");
}
```

### Account Details

```javascript
const accountId = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// Get full account info
const account = await client.getAccount(accountId);
console.log(`XLM Balance: ${account.xlm.balance}`);

// Check if account can receive USDC
const canReceive = await client.getAccountCanReceive(
  accountId,
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);
if (!canReceive.canReceive) {
  console.log(`Reason: ${canReceive.reasons.join(", ")}`);
}
```

### Soroban Contracts

```javascript
import { SorobanModule } from "@stellarkit/client/soroban";

const soroban = new SorobanModule({ baseUrl: "http://localhost:3000" });

// Get contract metadata
const contract = await soroban.getContract("CABC123...");
console.log(contract.wasmHash);

// Get a Soroban transaction result
const tx = await soroban.getTransaction("abc1234...");
console.log(tx.status, tx.returnValue);
```

### Error Handling

Non-2xx responses throw `StellarKitError`:

```javascript
import { StellarKitClient, StellarKitError } from "@stellarkit/client";

try {
  const account = await client.getAccount("INVALID");
} catch (err) {
  if (err instanceof StellarKitError) {
    console.error(`${err.status}: ${err.message} (${err.type})`);
  }
}
```

## Methods Reference

| Category | Method | Description |
| --- | --- | --- |
| **Health** | `getHealth()` | Service health check including build info |
| **Network** | `getNetworkStatus()` | Latest ledger, fees, and protocol info |
| | `getNetworkLedgerTiming()` | Analyze ledger close time consistency |
| **Fees** | `getFeeEstimate(ops)` | Fee tiers for transaction submission |
| | `getFeeSurgeStatus()` | Identify current fee surge periods |
| | `getFeeTrends()` | Analyze fee trends across last 50 ledgers |
| **Account** | `getAccount(id)` | Full account details, balances, signers |
| | `getAccountBalances(id)` | XLM and asset balances |
| | `getAccountSequence(id)` | Current sequence number |
| | `getAccountCanReceive(id, code, issuer)` | Check if account can receive an asset |
| | `getAccountPoolPositions(id)` | Liquidity pool position values |
| | `searchAccountTransactions(id, memo)` | Search transactions by memo |
| **Soroban** | `getSorobanContract(id)` | Contract metadata |
| | `getSorobanTransaction(hash)` | Transaction status and decoded return value |
| **DEX** | `getDexSpread(sell, buy)` | Bid-ask spread for a trading pair |
| | `getDexPrice(sell, buy, amt)` | Effective exchange rate |
| **Assets** | `getAsset(code, issuer)` | Asset metadata and statistics |
| | `searchAssets(code)` | Search assets by code |
| **Utils** | `fundAccount(id)` | Fund testnet account via Friendbot |
| | `validateAccount(id)` | Validate public key format |
| | `decodeXdr(xdr)` | Decode transaction XDR to JSON |

All methods return `Promise<data>` where `data` is the `data` field from the API response envelope.


## Getting Started

Initialize the client with your API base URL and an optional API key.

```javascript
const client = new StellarKitClient({
  baseUrl: 'http://localhost:3000', // or your production URL
  apiKey: 'your-api-key'            // optional
});
```

## Usage Examples

### Network & Fees

```javascript
// Get current network status
const status = await client.getNetworkStatus();
console.log(`Latest Ledger: ${status.latestLedger.sequence}`);

// Get recommended fees for a transaction with 3 operations
const fees = await client.getFeeEstimate(3);
console.log(`Recommended Standard Fee: ${fees.totalFee.standard.stroops} stroops`);

// Check if there is a fee surge
const surge = await client.getFeeSurgeStatus();
if (surge.isSurging) {
  console.log('Warning: Fee surge in progress');
}
```

### Account Details

```javascript
const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

// Get full account info
const account = await client.getAccount(accountId);
console.log(`XLM Balance: ${account.xlm.balance}`);

// Get account age and activity
const inactivity = await client.getAccountInactivity(accountId);
console.log(`Account status: ${inactivity.status}`);

// Check if account can receive USDC
const canReceive = await client.getAccountCanReceive(
  accountId, 
  'USDC', 
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
);
if (!canReceive.canReceive) {
  console.log(`Reason: ${canReceive.reasons.join(', ')}`);
}
```

### Assets & DEX

```javascript
// Get asset statistics
const asset = await client.getAsset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
console.log(`Total Supply: ${asset.amount}`);

// Calculate DEX spread for XLM/USDC
const spread = await client.getDexSpread(
  'XLM:native', 
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
);
console.log(`Bid-Ask Spread: ${spread.spreadPercent}%`);

// Find effective exchange rate for 100 XLM to USDC
const price = await client.getDexPrice(
  'XLM:native', 
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  100
);
console.log(`You will receive: ${price.buyAmount} USDC`);
```

### Utilities

```javascript
// Validate a public key locally
const validation = await client.validateAccount('GAAZI4...');
if (!validation.isValid) {
  console.error(`Invalid key: ${validation.reason}`);
}

// Fund a testnet account
await client.fundAccount('GAAZI4...');
```

### Streaming

`client.stream` wraps the real-time endpoints and handles reconnection for you:

| Helper | Endpoint | Event type |
|--------|----------|------------|
| `client.stream.payments(accountId, options)` | SSE `GET /stream/payments/:id` | `PaymentStreamEvent` |
| `client.stream.transactions(accountId, options)` | SSE `GET /stream/transactions/:id` | `TransactionStreamEvent` |
| `client.stream.ledgers(options)` | WS `/stream/ledgers` | `LedgerStreamEvent` |

```javascript
const controller = new AbortController();

const sub = client.stream.payments('GAAZI4...', {
  onOpen: () => console.log('connected'),
  onMessage: (payment) => console.log(payment.amount, payment.asset.code),
  onError: (err) => console.warn(err.code, err.message, 'retrying:', err.willRetry),
  signal: controller.signal, // optional — abort() closes the stream
  maxRetries: 10,            // consecutive reconnect attempts before giving up
  heartbeatMs: 60_000,       // reconnect if nothing arrives for 60 s
});

sub.close(); // stops the stream and cancels any pending reconnect
```

Each helper returns `{ close() }`. Options:

| Option | Default | Description |
|--------|---------|-------------|
| `onMessage(event)` | — | Called once per event, in order |
| `onError(err)` | — | Called on every failure; `err.willRetry` says whether a reconnect follows |
| `onOpen()` | — | Called on every (re)connection |
| `signal` | — | `AbortSignal`; aborting closes the stream |
| `cursor` | `"now"` | Cursor to start from |
| `maxRetries` | `10` | Consecutive reconnect attempts before giving up (`MAX_RETRIES_EXCEEDED`) |
| `initialDelayMs` / `maxDelayMs` | `1000` / `30000` | Exponential backoff bounds; each delay is jittered within `[d/2, d]` |
| `heartbeatMs` | off | Force a reconnect when no data (events or server keep-alives) arrives in this window. The server sends keep-alives every 25–30 s, so use a value above 30 000 |

On reconnect the client resumes from the last event it received via `?cursor=`, so nothing is duplicated or skipped. Client errors such as `400` or `404` are not retried.

In Node.js without a global `WebSocket`, pass one in: `new StellarKitClient({ baseUrl, WebSocket: require('ws') })`.

| Option    | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `baseUrl` | string | Yes      | Base URL of the StellarKit API       |
| `apiKey`  | string | No       | Sent as `X-API-Key` request header   |
| `fetch`   | function | No     | `fetch` implementation for SSE streams (defaults to global `fetch`) |
| `WebSocket` | constructor | No | WebSocket implementation for `stream.ledgers` (defaults to global `WebSocket`) |

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

### Issue #204: JavaScript Client SDK Implementation

This SDK wraps StellarKit API endpoints into documented async methods that return the `data` field from the response. It is designed to simplify integration with the StellarKit API and avoid raw `fetch` usage.

- `new StellarKitClient({ baseUrl, apiKey? })`
- `getAccount(id)`
- `getNetworkStatus()`
- `getFeeEstimate(operations)`
- `getAsset(code, issuer)`

The SDK implementation lives at `sdk/stellarkit-client.js` and includes error handling via `StellarKitError`.


```js
err.status   // HTTP status code (e.g. 404)
err.message  // Human-readable error message from the API
err.name     // "StellarKitError"
```

## Methods Reference

Every endpoint in the StellarKit API has a corresponding method. All methods return a `Promise` that resolves to the `data` field of the API response.

| Category | Method | Description |
| --- | --- | --- |
| **Network** | `getNetworkStatus()` | Latest ledger, fees, and protocol info |
| | `getNetworkLedgerTiming()` | Analyze network ledger close time consistency |
| **Fees** | `getFeeEstimate(ops)` | Fee tiers for transaction submission |
| | `getFeeSurgeStatus()` | Identify current fee surge periods |
| | `getFeeTrends()` | Analyze fee trends across last 50 ledgers |
| **Account** | `getAccount(id)` | Full account details, balances, signers |
| | `getAccountBalances(id)` | Native XLM and asset balances |
| | `getAccountSequence(id)` | Current sequence number |
| | `getAccountInactivity(id)` | Detect account inactivity (dormancy) |
| | `getAccountCanReceive(id, code, issuer)` | Check if account can receive an asset |
| | `getAccountSummary(id)` | Consolidated account, tx, and offer summary |
| | `getAccountTrustlines(id)` | Trustlines with resolved TOML metadata |
| | `getAccountPoolPositions(id)` | Share values in all liquidity pools |
| | `searchAccountTransactions(id, memo)` | Search transactions by memo content |
| | `getEffects(id, {limit?, cursor?, type?, order?, fresh?})` | Paginated ledger effects (Effect {effectId, type, createdAt, asset?, amount?}) — `GET /account/:id/effects` (fresh bypasses cache) |
| **DEX** | `getDexSpread(sell, buy)` | Calculate bid-ask spread for a pair |
| | `getDexPrice(sell, buy, amt)` | Best effective exchange rate |
| | `getDexDepth(sell, buy)` | Full order book depth analysis |
| **Liquidity Pools** | `getPoolProfitability(id)` | Annualized fee income estimate |
| | `getPoolReserveRatio(id)` | Current reserve ratio and drift |
| **Utils** | `fundAccount(id)` | Fund testnet account via Friendbot |
| | `validateAccount(id)` | Validate public key format locally |
| | `decodeXdr(xdr)` | Decode transaction XDR to JSON |

... and many more. See `sdk/stellarkit-client.js` for the full list and JSDoc documentation.
# Exact amount helpers

Import `amounts` from `./index`, or import individual helpers from `./amounts`.
`amounts.toStroops("0.1")` returns `1000000n` and
`amounts.add("0.1", "0.2")` returns `"0.3000000"`.
`fromStroops`, `add`, `sub`, `min`, `max`, and `sum` return seven-decimal
strings. `cmp` returns -1, 0, or 1. Negative net amounts are supported.
Malformed input and signed int64 overflow throw `InvalidAmount`.

