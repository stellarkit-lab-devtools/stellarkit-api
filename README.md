# StellarKit API 🚀

<p align="center">
  <b>English 🇺🇸</b> | <a href="README.fr.md">Français 🇫🇷</a> | <a href="README.es.md">Español 🇪🇸</a>
</p>

> A developer utility REST API for the Stellar blockchain — built with Express.js and the official Stellar SDK.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Stellar](https://img.shields.io/badge/Stellar-SDK-blue)](https://stellar.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

StellarKit API wraps the [Stellar Horizon API](https://developers.stellar.org/api/horizon) into clean, developer-friendly REST endpoints. It helps developers building on Stellar quickly access fee estimates, account data, transaction history, network status, and asset metadata — without having to read through raw Horizon responses.

---

## ✨ Features

- 📊 **Network Status** — Latest ledger info, base fee, protocol version
- 💸 **Fee Estimation** — Economy / Standard / Priority fee tiers for any operation count
- 👤 **Account Info** — Balances (XLM + all assets), signers, thresholds, spendable balance
- 📜 **Transaction History** — Paginated transactions and operations per account
- 🪙 **Asset Metadata** — Stats for any Stellar asset, plus multi-issuer search
- 🛡️ **Production-ready** — Rate limiting, helmet security headers, centralised error handling
- ✅ **Tested** — Jest test suite with coverage

---

## 🚀 Getting Started


### Prerequisites

- Node.js >= 18
- npm >= 9

### Installation

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm install
cp .env.example .env
```

### Configuration

Edit `.env`:

```env
STELLAR_NETWORK=testnet     # or "mainnet"
PORT=3000
```

### Run

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`.

---

## 📡 API Endpoints

### `GET /`
Returns the full list of available endpoints.

---

### `GET /health`
Service health check.

**Response:**
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

---

### `GET /network-status`
Returns the latest ledger info, fees, and protocol version.

**Response:**
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
    "protocol": { "version": 21 }
  }
}
```

---

### `GET /fee-estimate`
Returns Economy / Standard / Priority fee tiers based on live network stats.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `operations` | number | `1` | Number of operations in your transaction |

**Example:**
```
GET /fee-estimate?operations=3
```

**Response:**
```json
{
  "success": true,
  "data": {
    "operationCount": 3,
    "perOperation": {
      "economy":  { "stroops": 100, "xlm": "0.0000100" },
      "standard": { "stroops": 200, "xlm": "0.0000200" },
      "priority": { "stroops": 500, "xlm": "0.0000500" }
    },
    "totalFee": {
      "economy":  { "stroops": 300, "xlm": "0.0000300" },
      "standard": { "stroops": 600, "xlm": "0.0000600" },
      "priority": { "stroops": 1500, "xlm": "0.0001500" }
    }
  }
}
```

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
const ws = new WebSocket('ws://localhost:3000/stream/ledgers');

ws.onopen = () => {
  console.log('Connected to StellarKit ledger stream!');
};

ws.onmessage = (event) => {
  const ledger = JSON.parse(event.data);
  console.log('New ledger closed:', ledger);
  // Example output:
  // {
  //   "sequence": 51234567,
  //   "closedAt": "2026-05-26T20:15:00Z",
  //   "baseFee": 100,
  //   "transactionCount": 54
  // }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket connection closed.');
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
