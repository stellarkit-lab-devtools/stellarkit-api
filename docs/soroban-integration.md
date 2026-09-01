# Soroban Integration Guide

This guide walks through a complete developer workflow for interacting with Soroban smart contracts using StellarKit API — from inspecting a deployed contract to monitoring its events, checking its expiry, and simulating invocations. Each step uses a realistic token contract scenario with working `curl` examples you can run against any StellarKit API instance.

---

## Table of Contents

1. [Overview](#overview)
2. [Example Contract Scenario](#example-contract-scenario)
3. [Prerequisites](#prerequisites)
4. [Step 1 — Query Contract Metadata](#step-1--query-contract-metadata)
5. [Step 2 — Inspect Contract Storage](#step-2--inspect-contract-storage)
6. [Step 3 — Discover Contract Functions](#step-3--discover-contract-functions)
7. [Step 4 — Check Contract Expiry](#step-4--check-contract-expiry)
8. [Step 5 — Monitor Contract Events](#step-5--monitor-contract-events)
9. [Step 6 — Simulate a Contract Invocation](#step-6--simulate-a-contract-invocation)
10. [Putting It All Together](#putting-it-all-together)
11. [Error Reference](#error-reference)
12. [Configuration](#configuration)

---

## Overview

Soroban is Stellar's smart contract platform. Contracts are compiled to WebAssembly (WASM) and executed on-chain. Each deployed contract has:

- A **contract ID** — a `C...` StrKey address (56 characters) that uniquely identifies the contract instance on the ledger.
- An **executable** — either a reference to uploaded WASM bytecode (identified by its SHA-256 `wasmHash`) or the built-in Stellar Asset Contract (SAC) used for classic Stellar assets.
- **Instance storage** — a small key/value map embedded in the contract's own ledger entry.
- A **TTL (time-to-live)** — expressed as a ledger sequence number (`expiryLedger`) beyond which the entry is archived and must be restored before it can be called.

StellarKit API exposes all of this through a set of dedicated endpoints that handle Soroban RPC communication, decoding, and caching transparently.

---

## Example Contract Scenario

Throughout this guide, we use a fictional **StellarPay Token** — a Soroban-based SEP-41 fungible token contract deployed on testnet. The contract:

- Has a 7-decimal precision token called `SPAY` with a fixed supply of 1,000,000,000 units
- Stores token metadata (name, symbol, decimals) in instance storage
- Emits `transfer` events whenever tokens move between accounts
- Exposes standard functions: `transfer`, `balance`, `allowance`, `approve`, `mint`, `burn`

**Contract ID (testnet example):**
```
CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2
```

> Replace this with your actual deployed contract ID in every `curl` example below.

---

## Prerequisites

- A running StellarKit API instance (see [Getting Started](getting-started.md))
- `SOROBAN_RPC_URL` configured (defaults to `https://soroban-testnet.stellar.org` on testnet — no setup needed for testnet)
- `curl` installed, or any HTTP client

```bash
# Set a convenience variable for all examples below
export API="http://localhost:3000"
export CONTRACT="CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2"
```

---

## Step 1 — Query Contract Metadata

Start by fetching the contract's instance-level metadata: executable type, WASM hash, deployment info, and whether it has expired.

### Endpoint

```
GET /soroban/contract/:id
```

### curl

```bash
curl -sS "$API/soroban/contract/$CONTRACT" | jq .
```

### Example response

```json
{
  "success": true,
  "data": {
    "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
    "wasmHash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    "deployer": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "deployedAt": "2026-01-15T09:00:00.000Z",
    "deployedLedger": 51000000,
    "isExpired": false,
    "executable": {
      "type": "wasm",
      "wasmHash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    },
    "lastModifiedLedger": 51000000,
    "expiryLedger": 61000000
  }
}
```

### What to check

| Field | What it tells you |
|---|---|
| `executable.type` | `"wasm"` — custom logic; `"stellar_asset"` — built-in SAC for a classic Stellar asset |
| `wasmHash` | The SHA-256 fingerprint of the contract bytecode. Use this to verify the deployed code matches a known audit |
| `isExpired` | `true` means the contract entry has been archived; it cannot be invoked until restored |
| `expiryLedger` | The last ledger at which the instance is guaranteed live. Monitor this and extend the TTL before it passes |
| `deployer` | The Stellar account that deployed the contract. `null` when deployment metadata is unavailable |

### Checking a Stellar Asset Contract (SAC)

The native XLM SAC on testnet uses `executable.type: "stellar_asset"` and has no `wasmHash`. The same endpoint works:

```bash
# XLM SAC on testnet
curl -sS "$API/soroban/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" | jq .data.executable
```

```json
{
  "type": "stellar_asset",
  "wasmHash": null
}
```

---

## Step 2 — Inspect Contract Storage

Contract instance storage holds the small amount of global state the contract stores directly on its own ledger entry — typically metadata, configuration, or admin settings.

For the StellarPay Token contract this includes token name, symbol, and decimals.

### Endpoint

```
GET /soroban/contract/:id/storage[?limit=N&fresh=true]
```

### Query parameters

| Param | Default | Description |
|---|---|---|
| `limit` | `50` | Maximum entries to return (1–50) |
| `fresh` | `false` | Set to `true` to bypass the cache |

### curl

```bash
curl -sS "$API/soroban/contract/$CONTRACT/storage" | jq .
```

### Example response

```json
{
  "success": true,
  "data": {
    "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
    "entries": [
      {
        "key": "METADATA",
        "value": {
          "decimal": 7,
          "name": "StellarPay Token",
          "symbol": "SPAY"
        },
        "lastModifiedLedger": 51000000,
        "expiryLedger": 61000000
      },
      {
        "key": ["Admin"],
        "value": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "lastModifiedLedger": 51000000,
        "expiryLedger": 61000000
      }
    ],
    "total": 2
  }
}
```

### Understanding storage entries

Each entry has:
- `key` — the decoded storage key (string, array, or object depending on the contract)
- `value` — the decoded storage value. 64-bit and 128-bit integers are returned as numeric strings; raw bytes are hex-encoded
- `lastModifiedLedger` — when the entry was last written
- `expiryLedger` — when the instance entry (and all its storage) expires

> **Note:** This endpoint returns **instance storage** only — the key/value map embedded directly in the `ContractInstance` ledger entry. Persistent and temporary storage entries are stored as separate ledger entries and require knowing their keys in advance to fetch individually. Contracts that store per-user data (balances, allowances) use persistent storage; you cannot enumerate those entries through this endpoint.

### Bypassing the cache

```bash
# Force a fresh RPC fetch — useful after a contract state-changing transaction
curl -sS "$API/soroban/contract/$CONTRACT/storage?fresh=true" | jq .data.entries
```

---

## Step 3 — Discover Contract Functions

Before building a transaction to invoke the contract, fetch its exported function signatures. This tells you function names, parameter names, parameter types, and return types — parsed directly from the contract's WASM ABI spec.

### Endpoint

```
GET /soroban/contract/:id/functions
```

### curl

```bash
curl -sS "$API/soroban/contract/$CONTRACT/functions" | jq .
```

### Example response

```json
{
  "success": true,
  "data": {
    "functions": [
      {
        "name": "transfer",
        "params": [
          { "name": "from",   "type": "Address" },
          { "name": "to",     "type": "Address" },
          { "name": "amount", "type": "I128" }
        ],
        "returnType": "Void"
      },
      {
        "name": "balance",
        "params": [
          { "name": "id", "type": "Address" }
        ],
        "returnType": "I128"
      },
      {
        "name": "approve",
        "params": [
          { "name": "from",             "type": "Address" },
          { "name": "spender",          "type": "Address" },
          { "name": "amount",           "type": "I128" },
          { "name": "expiration_ledger","type": "U32" }
        ],
        "returnType": "Void"
      },
      {
        "name": "allowance",
        "params": [
          { "name": "from",    "type": "Address" },
          { "name": "spender", "type": "Address" }
        ],
        "returnType": "I128"
      },
      {
        "name": "mint",
        "params": [
          { "name": "to",     "type": "Address" },
          { "name": "amount", "type": "I128" }
        ],
        "returnType": "Void"
      }
    ]
  }
}
```

### Mapping Soroban types to your language

| Soroban type | JavaScript / TypeScript equivalent |
|---|---|
| `Address` | `string` (Stellar public key or contract ID) |
| `I128` / `U128` | `BigInt` (use `BigInt("100000000")` for 10 SPAY at 7 decimals) |
| `I64` / `U64` | `BigInt` |
| `U32` / `I32` | `number` |
| `Bool` | `boolean` |
| `Symbol` / `String` | `string` |
| `Void` | no return value |

Responses are cached for 60 seconds. Function signatures only change when the contract WASM is upgraded, so longer caching is safe.

---

## Step 4 — Check Contract Expiry

Soroban contract instances have a TTL — they expire at a specific ledger sequence number and are archived unless the TTL is extended. An archived contract cannot be invoked until it is restored via a `RestoreFootprint` operation.

### Endpoint

```
GET /soroban/contract/:id/expiry[?fresh=true]
```

### curl

```bash
curl -sS "$API/soroban/contract/$CONTRACT/expiry" | jq .
```

### Example response

```json
{
  "success": true,
  "data": {
    "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
    "expiryLedger": 61000000,
    "currentLedger": 51234567,
    "ledgersRemaining": 9765433,
    "estimatedTimeRemainingSeconds": 48827165,
    "isExpiringSoon": false
  }
}
```

### Response fields

| Field | Description |
|---|---|
| `expiryLedger` | The `liveUntilLedgerSeq` from the ledger entry — the last ledger at which the contract is alive |
| `currentLedger` | The most recently closed ledger on-chain at the time of this request |
| `ledgersRemaining` | `expiryLedger - currentLedger`. Zero means the contract has already expired |
| `estimatedTimeRemainingSeconds` | Approximate wall-clock time remaining (assumes ~5 seconds per ledger) |
| `isExpiringSoon` | `true` when fewer than 10,000 ledgers remain (~14 hours at 5 s/ledger) |

### When to call this

- **Before invoking:** Check `isExpiringSoon` before building any transaction. If `true`, extend the TTL first using the Stellar SDK's `ExtendFootprintTTL` operation.
- **Monitoring dashboard:** Poll this endpoint at intervals (e.g. every 10 minutes) and alert when `ledgersRemaining` drops below a threshold.
- **After deploy:** Call immediately to confirm the initial TTL was set correctly.

```bash
# Check if action is needed before interacting with the contract
EXPIRY=$(curl -sS "$API/soroban/contract/$CONTRACT/expiry" | jq .data.isExpiringSoon)
if [ "$EXPIRY" = "true" ]; then
  echo "Warning: contract is expiring soon — extend TTL before invoking"
fi
```

---

## Step 5 — Monitor Contract Events

Soroban contracts emit structured events when executing state-changing operations. StellarKit API provides a streaming endpoint for real-time event delivery and a polling mechanism for catching up on missed events.

### Server-Sent Events (SSE) stream

```
GET /stream/ledgers
```

This endpoint streams live ledger data as each ledger closes. Your client can filter for events from a specific contract.

```bash
# Stream live ledger updates (press Ctrl+C to stop)
curl -sS -N -H "Accept: text/event-stream" "$API/stream/ledgers"
```

Each event payload contains ledger metadata. For contract events you need to combine the stream with your own event filtering using the Soroban RPC `getEvents` call directly, or set up a StellarKit webhook (see [Webhooks Guide](webhooks.md)).

### Webhook for contract events

Register a webhook to receive a HTTP POST whenever a specific contract emits an event:

```bash
curl -sS -X POST "$API/webhooks" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.example.com/webhook/soroban",
    "events": ["contract_event"],
    "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2"
  }'
```

The webhook payload will contain the event topics and data decoded from XDR.

### Polling for recent events

If you need to catch up on events since the last ledger you processed, query the Soroban RPC `getEvents` endpoint directly via the StellarKit network configuration. The StellarKit network status gives you the current ledger:

```bash
# Get the current ledger to use as a starting point
LEDGER=$(curl -sS "$API/network-status" | jq .data.currentLedger)
echo "Current ledger: $LEDGER"
```

Use this ledger sequence number as the `startLedger` parameter in your Soroban RPC `getEvents` call to fetch events since a known checkpoint.

### Example transfer event shape

When the StellarPay Token's `transfer` function executes, it emits an event with these topics and data:

```json
{
  "type": "contract",
  "contractId": "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2",
  "topics": [
    "transfer",
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  ],
  "data": {
    "amount": "1000000000"
  },
  "ledger": 51234600,
  "ledgerClosedAt": "2026-08-28T10:05:00.000Z"
}
```

Topics follow the `[event_name, from_address, to_address]` convention used by SEP-41 tokens. The `amount` is in stroops equivalent (raw integer units — divide by `10^decimals` to get the human-readable value).

---

## Step 6 — Simulate a Contract Invocation

Before submitting a state-changing transaction, simulate it to check whether it will succeed and to get a fee estimate. Use `GET /fee-estimate` to size your transaction fees based on operation count, and inspect the contract's function signatures (Step 3) to build the correct parameter list.

### Estimate the fee for your invocation

A Soroban invocation is a single Stellar operation. Use the fee estimate endpoint to pick an appropriate fee:

```bash
# Estimate fee for a 1-operation Soroban invocation
curl -sS "$API/fee-estimate?operations=1" | jq .data.perOperation
```

```json
{
  "economy": {
    "stroops": 100,
    "xlm": "0.0000100",
    "description": "Minimum — may be slow during congestion"
  },
  "standard": {
    "stroops": 200,
    "xlm": "0.0000200",
    "description": "Recommended for most transactions"
  },
  "priority": {
    "stroops": 500,
    "xlm": "0.0000500",
    "description": "Fast inclusion even during high network load"
  }
}
```

For Soroban transactions, the **actual** resource fee is computed at simulation time and depends on the contract's computational complexity. Use the priority tier as a safe base fee and let the simulation result override it with the resource fee.

### Build and simulate using the Stellar SDK

After confirming the contract is live (Step 1), not expired (Step 4), and you have the correct function signature (Step 3), build the transaction using the Stellar SDK:

```javascript
import { StellarKitClient } from "./sdk/stellarkit-client";
import {
  Keypair,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";

const client = new StellarKitClient({ baseUrl: "http://localhost:3000" });
const rpc = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

const CONTRACT_ID = "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2";
const SENDER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

async function simulateTransfer(fromKeypair, toAddress, amountUnits) {
  // 1. Check the contract is not expired before proceeding
  const expiry = await client._request(`/soroban/contract/${CONTRACT_ID}/expiry`);
  if (expiry.isExpiringSoon) {
    throw new Error("Contract is expiring soon — extend TTL before invoking");
  }

  // 2. Get the sender's current sequence number
  const account = await rpc.getAccount(fromKeypair.publicKey());

  // 3. Build the invocation transaction
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "transfer",
        new Address(fromKeypair.publicKey()).toScVal(),
        new Address(toAddress).toScVal(),
        nativeToScVal(BigInt(amountUnits), { type: "i128" }),
      )
    )
    .setTimeout(30)
    .build();

  // 4. Simulate — this computes the actual resource fee
  const simulation = await rpc.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  console.log("Simulation result:", {
    minResourceFee: simulation.minResourceFee,
    readBytes:  simulation.cost?.readBytes,
    writeBytes: simulation.cost?.writeBytes,
  });

  return simulation;
}
```

### Check fee surge before submitting

For time-sensitive invocations, check surge status before broadcasting:

```bash
curl -sS "$API/fee-estimate/surge-status" | jq '{isSurging: .data.isSurging, recommendation: .data.recommendation}'
```

If `isSurging` is `true`, either wait for congestion to subside or use the `suggestedFee` from the response.

---

## Putting It All Together

Here is the complete end-to-end workflow for interacting with the StellarPay Token contract:

```bash
# 1. Confirm the contract exists and is not expired
curl -sS "$API/soroban/contract/$CONTRACT" | jq '{type: .data.executable.type, isExpired: .data.isExpired}'

# 2. Read the token metadata from instance storage
curl -sS "$API/soroban/contract/$CONTRACT/storage" | jq '.data.entries[] | select(.key == "METADATA")'

# 3. Discover available functions before building a transaction
curl -sS "$API/soroban/contract/$CONTRACT/functions" | jq '[.data.functions[].name]'

# 4. Check expiry — extend TTL if isExpiringSoon is true
curl -sS "$API/soroban/contract/$CONTRACT/expiry" | jq '{ledgersRemaining: .data.ledgersRemaining, isExpiringSoon: .data.isExpiringSoon}'

# 5. Get a fee estimate for the invocation (1 operation)
curl -sS "$API/fee-estimate?operations=1" | jq '.data.perOperation.standard'

# 6. Check for fee surges before submitting
curl -sS "$API/fee-estimate/surge-status" | jq '{isSurging: .data.isSurging, recommendation: .data.recommendation}'

# 7. Confirm the network is synced before broadcasting
curl -sS "$API/network-status" | jq '{isSynced: .data.isSynced, currentLedger: .data.currentLedger}'
```

---

## Error Reference

| Error type | HTTP status | Meaning |
|---|---|---|
| `ContractNotFound` | 404 | No contract at the given `C...` address on this network. The contract may not be deployed, or may have been evicted |
| `ValidationError` | 400 | The contract ID is not a valid 56-character StrKey `C...` address, or a query parameter (e.g. `limit`) is out of range |
| `ConfigError` | 500 | `SOROBAN_RPC_URL` is not set for the configured network. Set it in your `.env` file |
| `HorizonUnavailable` | 503 | The Soroban RPC server or Horizon node is unreachable |
| `HorizonTimeout` | 504 | The RPC server did not respond in time. Retry after a brief delay |

All errors follow the standard StellarKit error envelope:

```json
{
  "success": false,
  "error": {
    "type": "ContractNotFound",
    "message": "Contract CAEQ... was not found on the Stellar testnet network.",
    "suggestion": "Verify the contract ID is correct and that the contract has been deployed."
  }
}
```

See [Error Reference](error-reference.md) for the full list of error types.

---

## Configuration

All Soroban endpoints require a reachable Soroban RPC server configured in your `.env`:

```env
# Testnet (default when STELLAR_NETWORK=testnet and SOROBAN_RPC_URL is unset)
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Mainnet — no SDF-hosted public RPC; set your own provider
# SOROBAN_RPC_URL=https://your-mainnet-rpc-provider.example.com

# Optional: cache TTL overrides (milliseconds)
CACHE_TTL_CONTRACT_STORAGE_MS=15000   # storage endpoint (default 15 s)
CACHE_TTL_CONTRACT_FUNCTIONS_MS=60000 # functions endpoint (default 60 s)
CACHE_TTL_CONTRACT_EXPIRY_MS=30000    # expiry endpoint (default 30 s)
```

If `SOROBAN_RPC_URL` is unset and the network is `mainnet`, all Soroban endpoints return `500 ConfigError`. For testnet the SDF-hosted RPC is used automatically.
