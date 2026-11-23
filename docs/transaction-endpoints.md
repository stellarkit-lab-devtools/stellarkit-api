# Transaction Endpoints Guide

This guide covers all transaction and operation endpoints in StellarKit, explaining what each returns and how to use them together for building transaction explorers and submission tools.

## Overview

StellarKit provides several endpoints for querying transactions and their constituent operations:

| Endpoint | Route | Purpose |
|----------|-------|---------|
| Account Transactions | `GET /account/:id/transactions` | List all transactions for an account |
| Account Operations | `GET /account/:id/operations` | List all operations within transactions |
| Transaction Details | `GET /transactions/:id` | Get a specific transaction by hash |
| Transaction Operations | `GET /transactions/:id/operations` | Get all operations within a specific transaction |
| Transaction Effects | `GET /transactions/:hash/effects` | Get effects triggered by a transaction |
| Batch Status | `POST /transactions/batch-status` | Check multiple transaction hashes at once |

## Transactions vs Operations

Understanding the difference between transactions and operations is essential for building Stellar applications:

### Transactions
- **A transaction** is a atomic bundle of operations that either succeeds entirely or fails entirely
- Each transaction has a **single source account** (the account that paid the fee)
- Transactions include: fee, sequence number, memo, list of operations, and signatures
- A transaction is identified by its **hash** (64-character hex string)

### Operations
- **Operations** are the individual actions within a transaction
- Common operation types: `payment`, `create_account`, `change_trust`, `manage_sell_offer`, `set_options`
- Each operation has its own operation ID and can include different source accounts
- Operations are where the actual asset transfers, trustline changes, and other actions occur

**Example**: A user might send a payment and set up a trustline in a single transaction. The transaction contains two operations, but the trustline operation only executes if the payment succeeds — this is atomic batching.

## Endpoint Details

### GET /account/:id/transactions

Returns paginated transaction history for a Stellar account.

**Query Parameters:**
- `limit` — Number of results (default: 20, max: 200)
- `order` — Sort direction: `asc` or `desc` (default: `desc`)
- `cursor` — Pagination cursor for fetching next page
- `type` — Filter by operation type (e.g., `payment`, `change_trust`)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "transactionHash": "abc123...",
        "ledger": 12345,
        "createdAt": "2024-01-15T10:30:00Z",
        "operationCount": 2,
        "memo": "Hello",
        "successful": true,
        "sourceAccount": "GAAAAAAA...",
        "fee": { "charged": "100", "max": "200" }
      }
    ],
    "total": 20,
    "limit": 20,
    "cursor": "next-page-token",
    "hasMore": true
  }
}
```

**Use case**: Display a transaction history timeline for an account.

**curl example:**
```bash
curl "http://localhost:3000/account/GAAAAAAAADKM4/transactions?limit=10&order=desc"
```

---

### GET /account/:id/operations

Returns paginated operations for a Stellar account. Operations are the individual actions that make up transactions.

**Query Parameters:**
- `limit` — Number of results (default: 20, max: 200)
- `order` — Sort direction: `asc` or `desc` (default: `desc`)
- `cursor` — Pagination cursor
- `type` — Filter by operation type (e.g., `payment`, `create_account`, `change_trust`)

**Response:**
```json
{
  "success": true,
  "data": {
    "operations": [
      {
        "operationId": "1234567890",
        "type": "payment",
        "createdAt": "2024-01-15T10:30:00Z",
        "transactionHash": "abc123...",
        "amount": "100.0000000",
        "asset": { "code": "XLM", "issuer": null, "type": "native" },
        "from": "GAAAAAAA...",
        "to": "GCCCCCCC..."
      }
    ],
    "total": 20,
    "limit": 20,
    "cursor": "next-page-token"
  }
}
```

**Use case**: Analyze specific types of operations (e.g., all payments, all trustline changes).

**curl example:**
```bash
# Get all payment operations for an account
curl "http://localhost:3000/account/GAAAAAAAADKM4/operations?type=payment&limit=50"

# Get all operations sorted chronologically
curl "http://localhost:3000/account/GAAAAAAAADKM4/operations?order=asc&limit=20"
```

---

### GET /transactions/:id

Returns details for a specific transaction by its hash.

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionHash": "abc123def456...",
    "ledger": 12345,
    "createdAt": "2024-01-15T10:30:00Z",
    "operationCount": 3,
    "memo": "Payment for order #123",
    "successful": true,
    "sourceAccount": "GAAAAAAA...",
    "fee": {
      "charged": "100",
      "chargedInXLM": "0.00001",
      "max": "200",
      "maxInXLM": "0.00002"
    },
    "feeSummary": {
      "chargedInStroops": 100,
      "chargedInXLM": "0.00001",
      "perOperationInStroops": 33,
      "perOperationInXLM": "0.0000033"
    }
  }
}
```

**Use case**: Verify transaction success, check fees paid, view memo.

**curl example:**
```bash
curl "http://localhost:3000/transactions/abc123def456789012345678901234567890123456789012345678901234"
```

---

### GET /transactions/:id/operations

Returns all operations within a specific transaction.

**Response:**
```json
{
  "success": true,
  "data": {
    "operations": [
      {
        "operationId": "1234567890",
        "type": "create_account",
        "createdAt": "2024-01-15T10:30:00Z",
        "transactionHash": "abc123...",
        "startingBalance": "1000.0000000",
        "funder": "GAAAAAAA...",
        "account": "GCCCCCCC..."
      },
      {
        "operationId": "1234567891",
        "type": "payment",
        "createdAt": "2024-01-15T10:30:00Z",
        "transactionHash": "abc123...",
        "amount": "500.0000000",
        "asset": { "code": "USDC", "issuer": "GBABCD...", "type": "credit_alphanum4" },
        "from": "GCCCCCCC...",
        "to": "GDDDDDDD..."
      }
    ]
  }
}
```

**Use case**: Understand the exact sequence of actions within a transaction.

**curl example:**
```bash
curl "http://localhost:3000/transactions/abc123.../operations"
```

---

### GET /transactions/:hash/effects

Returns the effects triggered by a transaction. Effects are the state changes that result from operations.

**Query Parameters:**
- `limit` — Number of results (default: 20, max: 200)
- `order` — Sort direction: `asc` or `desc`

**Response:**
```json
{
  "success": true,
  "data": {
    "effects": [
      {
        "effectId": "1234567890-1",
        "type": "account_credited",
        "account": "GCCCCCCC...",
        "createdAt": "2024-01-15T10:30:00Z",
        "asset": { "code": "USDC", "issuer": "GBABCD...", "type": "credit_alphanum4" },
        "amount": "500.0000000"
      }
    ]
  }
}
```

**Use case**: Track balance changes, trade effects, and other state mutations.

**curl example:**
```bash
curl "http://localhost:3000/transactions/abc123.../effects?limit=10"
```

---

### POST /transactions/batch-status

Check the confirmation status of multiple transaction hashes in a single request. This is optimized for checking many transactions at once.

**Request Body:**
```json
{
  "hashes": ["hash1", "hash2", "hash3"]
}
```

**Constraints:**
- Maximum 20 hashes per request
- Each hash must be a valid 64-character hex string

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "hash": "abc123...",
        "found": true,
        "successful": true,
        "ledger": 12345,
        "createdAt": "2024-01-15T10:30:00Z",
        "fee": "100"
      },
      {
        "hash": "def456...",
        "found": false,
        "error": "Transaction not found"
      }
    ]
  }
}
```

**Use case**: Track pending transactions, check if multiple transactions have been confirmed.

**curl example:**
```bash
curl -X POST "http://localhost:3000/transactions/batch-status" \
  -H "Content-Type: application/json" \
  -d '{"hashes": ["abc123...", "def456...", "ghi789..."]}'
```

---

## When to Use Which Endpoint

### Building a transaction explorer
1. Start with `GET /account/:id/transactions` to get the transaction list
2. Use `GET /transactions/:id` to show full transaction details
3. Use `GET /transactions/:id/operations` to show what the transaction did

### Analyzing payment flows
1. Use `GET /account/:id/operations?type=payment` to get all payments
2. Filter by direction (from/to) in your application code

### Checking transaction confirmations
- Use `POST /transactions/batch-status` for multiple hashes (recommended)
- Use `GET /transactions/:id` for single transactions

### Understanding operation types
- Use `GET /account/:id/operations?type=change_trust` to see all trustline changes
- Use `GET /account/:id/operations?type=manage_sell_offer` to see DEX activity

## Response Envelope

All endpoints return a consistent response format:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "latencyMs": 45,
    "horizonCalls": 1
  }
}
```

Error responses:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "type": "ErrorType",
  "statusCode": 400
}
```

## Pagination

Most list endpoints support pagination via:
- `cursor` — Opaque token from previous response
- `limit` — Max items to return
- `order` — Sort direction (`asc` or `desc`)

Example pagination flow:
```bash
# First request
curl "http://localhost:3000/account/GAAAAAAAADKM4/transactions?limit=10"

# Response includes cursor
# {"data": {...,"cursor": "1234567890"}}

# Next page
curl "http://localhost:3000/account/GAAAAAAAADKM4/transactions?limit=10&cursor=1234567890"
```

## Related Documentation

- [Account Endpoints Guide](account-endpoints.md) — Full account API reference
- [API Design Guidelines](api-design.md) — Response formats and conventions
- [Streaming Guide](streaming.md) — Real-time transaction and operation streams