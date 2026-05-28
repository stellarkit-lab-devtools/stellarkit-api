# StellarKit API 🚀

<p align="center">
  <b>English 🇺🇸</b> | <a href="README.fr.md">Français 🇫🇷</a> | <a href="README.es.md">Español 🇪🇸</a>
</p>

> StellarKit API is a developer utility service that exposes the Stellar Horizon blockchain through a simple REST interface. It is designed for application developers who need fast, typed access to account details, fee estimates, transaction history, network health, and asset metadata.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Stellar](https://img.shields.io/badge/Stellar-SDK-blue)](https://stellar.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What is StellarKit API?

StellarKit API is a wrapper around the Stellar Horizon API, built with Express.js and the official `@stellar/stellar-sdk` library. It normalizes Horizon responses, provides a clean REST structure, and adds convenience endpoints for the most common Stellar developer workflows.

This project is ideal for:

- Web and mobile developers building on Stellar
- Server-side services consuming Stellar account and transaction data
- Wallet providers that need reliable fee estimation and account summaries
- Applications requiring typed API responses via bundled TypeScript definitions

---

## Key Features

- 🌐 **Network status and ledger health**
- 💰 **Dynamic fee estimation** for optimal transaction pricing
- 👥 **Account detail aggregation** including balances, signers, and thresholds
- 📜 **Paginated transaction history** and operation history per account
- 🪙 **Asset metadata search** and issuer lookup
- 🚫 **Built-in security middleware** with rate limiting, helmet headers, CORS, and HPP
- 🧪 **Test coverage** using Jest and Supertest
- 📦 **Bundled TypeScript types** for safe integration in TypeScript projects

---

## API Quick Reference

| Method | Endpoint                       | Description                                     |
| ------ | ------------------------------ | ----------------------------------------------- |
| GET    | `/`                            | Lists available API endpoints and descriptions  |
| GET    | `/health`                      | Returns basic service health status             |
| GET    | `/network-status`              | Returns current Stellar network and ledger info |
| GET    | `/fee-estimate`                | Calculates fee estimates for a transaction      |
| GET    | `/account/:id`                 | Retrieves full account details and balances     |
| GET    | `/account/:id/balances`        | Retrieves XLM and asset balances only           |
| GET    | `/account/:id/sequence`        | Retrieves the account sequence number           |
| GET    | `/account/:id/summary`         | Retrieves a compact account summary             |
| GET    | `/account/:id/payments`        | Lists payment and create_account operations     |
| GET    | `/transactions/:id`            | Retrieves paginated transaction history         |
| GET    | `/transactions/:id/operations` | Retrieves paginated operation history           |
| GET    | `/asset/:code/:issuer`         | Retrieves metadata and statistics for an asset  |
| GET    | `/asset/:code/:issuer/holders` | Lists holders of an asset trustline             |
| GET    | `/asset/search`                | Searches assets by code across issuers          |
| GET    | `/stream/transactions/:id`     | Streams live account transactions via SSE       |
| GET    | `/utils/friendbot/:accountId`  | Funds a testnet account via Friendbot           |
| GET    | `/utils/memo`                  | Decodes Horizon memo data                       |
| GET    | `/utils/base64`                | Encodes or decodes Base64 strings               |

---

## Project Structure

- `src/index.js` — application entry point
- `src/websocket.js` — WebSocket helper for Stellar streaming data
- `src/config/stellar.js` — Stellar network configuration
- `src/routes/` — Express route handlers for API endpoints
- `src/utils/` — shared helpers for formatting, validation, caching, response shaping
- `src/middleware/` — validation, error handling, rate limiting
- `tests/` — API and integration tests
- `types/index.d.ts` — exported TypeScript type definitions

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### Installation

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm install
copy .env.example .env
```

### Configuration

Open `.env` and configure your environment variables:

```env
STELLAR_NETWORK=testnet
PORT=3000
```

Supported values for `STELLAR_NETWORK` are `testnet` and `mainnet`.

### Run the API

```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

Visit `http://localhost:3000` after startup.

---

## Environment Variables Reference

| Variable | Default | Description | Required |
|----------------------|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|----------|
| `STELLAR_NETWORK` | `testnet` | Target Stellar network. Accepted values: `testnet` or `mainnet`. Controls which Horizon server is used and gates testnet-only endpoints such as Friendbot. | ⬜ No |
| `HORIZON_URL` | *(derived from `STELLAR_NETWORK`)* | Override the Horizon server URL. When omitted, defaults to `https://horizon-testnet.stellar.org` for `testnet` and `https://horizon.stellar.org` for `mainnet`. | ⬜ No |
| `PORT` | `3000` | TCP port the Express server listens on. | ⬜ No |
| `NODE_ENV` | `development` | Runtime environment. Set to `production` to enable combined HTTP logging and sanitised error messages. Set to `test` to suppress console output during test runs. | ⬜ No |
| `RATE_LIMIT_MAX` | `100` | Maximum number of requests allowed per IP address per 15-minute window. Applies to the global rate limiter. | ⬜ No |
| `CACHE_TTL_MS` | `5000` | Cache time-to-live in milliseconds for the `/network-status` and `/fee-estimate` endpoints. | ⬜ No |

> All variables are optional — the server starts with sensible defaults when none are set. Set `STELLAR_NETWORK=mainnet` explicitly before deploying to production to avoid accidentally pointing at testnet.

---

## Understanding Stellar Account Reserves

Stellar requires all accounts to maintain a **minimum XLM balance** to exist on the ledger. This mechanism deters ledger spam and ensures the network remains efficient.

- **Base Reserve:** The fundamental unit of reserve on Stellar, currently set to **0.5 XLM**.
- **Account Reserve:** To be activated, an account must hold at least **2 base reserves** (1 XLM).
- **Subentry Reserve:** Every item an account owns (such as a trustline for a new asset, an open offer, a data entry, or an additional signer) is called a subentry. Each subentry increases the account's minimum balance requirement by **1 base reserve** (0.5 XLM).

### Example Calculation

If an account is funded and holds **3 trustlines**, its minimum balance is calculated as follows:

- **Account Base:** 2 base reserves = 1 XLM
- **3 Trustlines:** 3 subentries × 0.5 XLM = 1.5 XLM
- **Total Minimum Balance:** 2.5 XLM

### Spendable Balance

An account's **spendable balance** is the amount of XLM it can freely transfer or spend. It is calculated as:
`Spendable Balance = Total Balance - Minimum Balance - Liabilities`

You don't need to calculate this manually! The `GET /account/:id` endpoint provided by this API automatically computes and returns both the `minimumBalance` and `spendableBalance` for any Stellar account.

---

## API Overview

### `GET /`

Returns a list of available API endpoints and a brief description.

### `GET /health`

Returns basic service health status.

### `GET /network-status`

Returns current Stellar network information, latest ledger data, fee settings, and protocol version.

### `GET /fee-estimate`

Calculates a fee estimate for a transaction using the current network base fee and requested operation count.

### `GET /account/:id`

Fetches account details, balances, signers, thresholds, flags, and spendable balance for the given Stellar public key.

### `GET /account/:id/balances`

Returns account balance details for XLM and all non-native assets.

### `GET /account/:id/summary`

Returns a compact account summary suitable for dashboards and quick views.

### `GET /account/:id/payments`

Lists payments and asset transfers for the account.

### `GET /transactions/:id`

Retrieves transaction history for an account, with pagination.

### `GET /transactions/:id/operations`

Retrieves operation history for an account, with pagination.

### `GET /asset/:code/:issuer`

Returns metadata and statistics for a specific Stellar asset.

### `GET /asset/search?code=:code`

Searches for assets by code and returns matching results, including issuer details.

---

## Common Horizon Errors

These are common Horizon transaction and operation result codes developers may see when submitting transactions to the Stellar network.

| Error code            | Meaning                                                                                         | How to fix it                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tx_bad_seq`          | The transaction sequence number does not match the account's current sequence number.           | Reload the source account from Horizon before building the transaction, then rebuild and sign it with the latest sequence number.    |
| `tx_insufficient_fee` | The transaction fee is too low for the number of operations or current network conditions.      | Increase the transaction fee, use the current base fee from Horizon, and multiply it by the number of operations in the transaction. |
| `op_no_trust`         | The destination account does not have a trustline for the asset being sent.                     | Have the destination account create a trustline for the asset before sending the payment.                                            |
| `op_line_full`        | The destination trustline exists but does not have enough remaining limit to receive the asset. | Ask the destination account to raise its trustline limit or reduce the payment amount.                                               |
| `op_no_destination`   | The destination account does not exist on the network.                                          | Create the account first with a `createAccount` operation, or confirm the destination public key is correct.                         |
| `tx_bad_auth`         | The transaction is missing a required signature or has an invalid signature.                    | Sign with every required signer for the source account and operations, and confirm the correct network passphrase is used.           |
| `op_underfunded`      | The source account does not have enough funds to complete the operation.                        | Add funds to the source account, reduce the operation amount, or account for fees and minimum reserve requirements.                  |
| `op_low_reserve`      | The operation would leave the account below its required minimum XLM reserve.                   | Keep more XLM in the account, remove unused subentries, or reduce the operation so the account stays above minimum reserve.          |

---

## Example Responses

### Health

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "StellarKit API",
    "version": "1.0.0",
    "network": "testnet"
  }
}
```

### Network Status

```json
{
  "success": true,
  "data": {
    "network": "testnet",
    "latestLedger": {
      "sequence": 123456,
      "closedAt": "2024-07-01T12:00:00Z",
      "transactionCount": 42,
      "operationCount": 89
    },
    "fees": {
      "baseFeeInStroops": 100,
      "baseFeeInXLM": "0.0000100"
    },
    "protocol": {
      "version": 21
    }
  }
}
```

### Fee Estimate

```json
{
  "success": true,
  "data": {
    "operationCount": 3,
    "perOperation": {
      "economy": { "stroops": 100, "xlm": "0.0000100" },
      "standard": { "stroops": 200, "xlm": "0.0000200" },
      "priority": { "stroops": 500, "xlm": "0.0000500" }
    },
    "totalFee": {
      "economy": { "stroops": 300, "xlm": "0.0000300" },
      "standard": { "stroops": 600, "xlm": "0.0000600" },
      "priority": { "stroops": 1500, "xlm": "0.0001500" }
    }
  }
}
```

---

## Understanding Stellar Fees

Stellar fees are paid in tiny units of XLM called stroops. One XLM equals 10,000,000 stroops, so a fee of 100 stroops is 0.0000100 XLM. Horizon and the Stellar protocol often report fees in stroops because they are exact integers, while wallets and user interfaces usually display the same value as XLM.

Every transaction starts with a base fee per operation. If a transaction contains three operations and the base fee is 100 stroops, the minimum fee is 300 stroops. When the network has spare capacity, transactions that pay the base fee are usually enough. When many transactions are competing for ledger space, Stellar uses surge pricing: transactions that offer higher fees are more likely to be included first.

Capacity usage is the practical signal to watch. Low usage means an economy fee can keep costs minimal. Moderate usage is a good time to choose the standard tier for a stronger chance of timely inclusion. High usage or time-sensitive flows, such as checkout, swaps, or account setup, may need the priority tier so the transaction competes better during surge pricing.

Use the `GET /fee-estimate` endpoint before submitting transactions. It returns economy, standard, and priority fee tiers in both stroops and XLM, already multiplied by the requested operation count, so clients can choose the lowest fee that still fits their urgency.

---

## TypeScript Support

This repository publishes type declarations in `types/index.d.ts`. Use these types to make your client integration type-safe.

### Example

```typescript
import type { AccountResponse, ApiError } from "stellarkit-api";

async function loadAccount(accountId: string) {
  const response = await fetch(`http://localhost:3000/account/${accountId}`);
  const payload = await response.json();

  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(error.error.message);
  }

  return payload as AccountResponse;
}
```

---

## Development

### Run tests

```bash
npm test
```

### Lint

```bash
npm run lint
npm run lint:fix
```

### Seed testnet data

```bash
npm run seed
```

---

## Contributing

Contributions are welcome! See `CONTRIBUTING.md` for guidelines on pull requests, issue reporting, and code style.

---

## License

This project is licensed under the MIT License.

---

### `GET /account/:id`

Returns full account details for a Stellar public key.

**Example:**

```
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

**Response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "sequence": "12345678",
    "xlm": {
      "balance": "100.0000000",
      "minimumBalance": "1.0000000",
      "spendableBalance": "99.0000000"
    },
    "assets": [...],
    "signers": [...],
    "flags": {...}
  }
}
```

---

### `GET /transactions/:id`

Returns paginated transaction history for an account.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `10` | Number of results (max 200) |
| `order` | string | `desc` | `asc` or `desc` |
| `cursor` | string | — | Pagination cursor from previous response |

---

### `GET /transactions/:id/operations`

Returns paginated operation history for an account. Same query params as above.

---

### `GET /asset/:code/:issuer`

Returns metadata and statistics for a specific Stellar asset.

**Example:**

```
GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

---

### `GET /asset/:code/:issuer/holders`

Returns paginated accounts holding a trustline for a specific Stellar asset.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `10` | Number of holders (max 200) |
| `order` | string | `desc` | `asc` or `desc` |
| `cursor` | string | — | Pagination cursor from previous response |

**Example:**

```
GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/holders
```

---

### `GET /asset/search?code=:code`

Searches for all assets with a given code across all issuers.

**Example:**

```
GET /asset/search?code=USDC
```

---

## 📡 Streaming & WebSockets

### `WS /stream/ledgers`

Establishes a live, real-time WebSocket connection to stream Stellar ledger updates. As new ledgers are closed on the Stellar blockchain, the API receives them via the Stellar Horizon SDK subscription, parses them, and immediately broadcasts them to connected WebSocket clients.

#### Client Connection Example (Vanilla JS)

```javascript
const ws = new WebSocket("ws://localhost:3000/stream/ledgers");

ws.onopen = () => {
  console.log("Connected to StellarKit ledger stream!");
};

ws.onmessage = (event) => {
  const ledger = JSON.parse(event.data);
  console.log("New ledger closed:", ledger);
  // Example output:
  // {
  //   "sequence": 51234567,
  //   "closedAt": "2026-05-26T20:15:00Z",
  //   "baseFee": 100,
  //   "transactionCount": 54
  // }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("WebSocket connection closed.");
};
```

---

## Development

To create a funded Stellar testnet account for local development/testing, run:

```bash
npm run seed
```

This script:

- generates a new keypair
- funds the public key on Stellar testnet using Friendbot
- prints the public/private keys to the console

**Note:** keep the printed private key secret.

---

## 🧪 Running Tests

```bash
npm test
```

Tests use [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest). Coverage report is generated at `coverage/`.

---

## 🤝 Contributing

Contributions are very welcome! This project participates in the **[Stellar Wave Program on Drips](https://www.drips.network/wave/stellar)** — you can earn rewards for solving open issues.

**To contribute:**

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push and open a Pull Request

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting.

---

## 📁 Project Structure

```
stellarkit-api/
├── scripts/
│   └── ws-client-demo.js  # Runnable CLI demo for real-time ledger stream
├── src/
│   ├── config/
│   │   └── stellar.js         # Stellar SDK + Horizon setup
│   ├── middleware/
│   │   ├── errorHandler.js    # Centralised error formatting
│   │   └── rateLimiter.js     # Rate limiting
│   ├── routes/
│   │   ├── account.js         # /account endpoints
│   │   ├── asset.js           # /asset endpoints
│   │   ├── feeEstimate.js     # /fee-estimate endpoint
│   │   ├── networkStatus.js   # /network-status endpoint
│   │   └── transactions.js    # /transactions endpoints
│   ├── utils/
│   │   ├── response.js        # Response helpers
│   │   └── validators.js      # Input validation helpers
│   ├── index.js               # App entry point
│   └── websocket.js           # WebSocket stream handler
├── tests/
│   ├── api.test.js
│   └── websocket.test.js      # WebSocket stream integration tests
├── .env.example
├── package.json
└── README.md
```

---

## 🌐 Stellar Resources

- [Stellar Developers Portal](https://developers.stellar.org)
- [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk)
- [Horizon API Reference](https://developers.stellar.org/api/horizon)
- [Stellar Discord](https://discord.gg/stellardev)
- [Stellar Wave Program](https://www.drips.network/wave/stellar)

---

## 📄 License

[MIT](LICENSE)

---

## Rate Limiting

The StellarKit API enforces request limits to protect the service and provide fair access for all clients. By default the API applies the following limit per originating IP address:

- **Default:** 100 requests per 15 minutes (per IP)

When requests are served, the API includes the following response headers so clients can observe and adapt to limits:

- `RateLimit-Limit`: The maximum number of requests allowed in the current window.
- `RateLimit-Remaining`: How many requests remain in the current window.
- `RateLimit-Reset`: UNIX epoch timestamp (seconds) when the current window resets.

If a client exceeds the configured limit the API will return HTTP `429 Too Many Requests`. Example HTTP headers for a 429 response:

```
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 1710000000
Content-Type: application/json
```

Example JSON body returned on rate limit exceed:

```json
{
  "success": false,
  "error": {
    "status": 429,
    "message": "Too many requests, rate limit exceeded"
  }
}
```

Configuration

Rate limiting behavior can be adjusted via environment variables — no code changes are required. The API supports the following variables (defaults shown):

- `RATE_LIMIT_MAX_REQUESTS` — Maximum requests per window (default: `100`)
- `RATE_LIMIT_WINDOW_MINUTES` — Window size in minutes (default: `15`)

After changing environment variables, restart the service for the new values to take effect.

Client recommendations

- Watch `RateLimit-Remaining` and proactively delay requests when it is low.
- On `429` responses, use the `RateLimit-Reset` timestamp to wait until the window resets.
- Implement retries with exponential backoff and jitter instead of tight loops.

Note: This README section documents runtime behavior only — there are intentionally no code changes in this PR.
