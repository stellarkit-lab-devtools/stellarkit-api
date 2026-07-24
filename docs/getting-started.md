# Getting Started with StellarKit API

Welcome to StellarKit API! This guide will help you set up the project, understand the basics, and make your first API calls. If you encounter unfamiliar Stellar terminology, check the [Glossary](glossary.md).

---

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** >= 18 (see [nodejs.org](https://nodejs.org/))
- **npm** >= 9 (comes with Node.js)
- A **text editor** or IDE (VS Code, Sublime Text, WebStorm, etc.)
- **Git** (optional, for cloning the repository)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
```

Or, if you don't have Git, download the repository as a ZIP and extract it.

### 2. Install Dependencies

```bash
npm install
```

This installs all required packages, including Express, the Stellar SDK, and testing tools.

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` in your text editor and review the settings:

```env
STELLAR_NETWORK=testnet
PORT=3000
NODE_ENV=development
RATE_LIMIT_MAX=100
CACHE_TTL_MS=5000
```

**Key settings:**

- `STELLAR_NETWORK`: Use `testnet` for development (free, resets periodically). Use `mainnet` for production.
- `PORT`: The port where the API will listen. Default is `3000`.
- `NODE_ENV`: Set to `development` for detailed logs. Use `production` for a live server.

For now, keep the defaults and save the file.

---

## Starting the API

### Development Mode (Recommended)

```bash
npm run dev
```

The API will start with auto-reload enabled. When you edit files, the server automatically restarts.

**Output:**

```
Server running on http://localhost:3000
Network: testnet
```

### Production Mode

```bash
npm start
```

The server starts without file watching, suitable for deployment.

---

## Your First API Call

### Using a Browser

Open your browser and visit:

```
http://localhost:3000
```

You'll see a list of all available endpoints.

### Using cURL

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:

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

### Using Postman or Insomnia

1. Create a new GET request to `http://localhost:3000/health`
2. Send the request
3. You'll see the same JSON response as above

---

## Key Concepts

Before making more advanced calls, understand these core Stellar ideas:

### Accounts

A **Stellar account** is a public/private key pair. The public key (starting with `G`) is your address; the private key is your secret. Every account must hold at least 1 XLM to exist on the network.

### Transactions

A **transaction** is a signed request to the network (e.g., send XLM, create a trustline, trade assets). Transactions are bundled into a **ledger** every ~5 seconds.

### Stroops vs XLM

Stellar measures fees and reserves in **stroops**, the smallest unit of XLM. 1 XLM = 10,000,000 stroops. APIs often report values in stroops because they're exact integers.

For more terms, see the [Glossary](glossary.md).

---

## Common Tasks

### Get Account Information

Fetch details for any Stellar account:

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
```

Response includes:

- XLM balance
- Asset balances (if any)
- Sequence number
- Signers and thresholds
- Minimum reserve requirement
- Spendable balance

### Check Network Status

See current fee estimates and ledger info:

```bash
curl http://localhost:3000/network-status
```

Response includes:

- Latest ledger sequence
- Base fee in stroops and XLM
- Protocol version
- Transaction count

### Estimate Transaction Fees

Calculate how much a transaction will cost:

```bash
curl "http://localhost:3000/fee-estimate?operationCount=3"
```

Response includes economy, standard, and priority fee tiers.

### Get Transaction History

Retrieve recent transactions for an account:

```bash
curl "http://localhost:3000/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
```

### Search for an Asset

Find all issuers of a given asset code:

```bash
curl "http://localhost:3000/asset/search?code=USDC"
```

---

## Working with Testnet

### Create a Test Account

Use Friendbot (Stellar's testnet faucet) to create and fund a new account:

```bash
npm run seed
```

This script generates a keypair and funds it with 10,000 XLM on testnet. Save the public key—you'll use it in API calls.

### Use an Existing Test Account

If you already have a testnet public key, you can query it directly:

```bash
curl "http://localhost:3000/account/YOUR_PUBLIC_KEY"
```

Replace `YOUR_PUBLIC_KEY` with an actual Stellar testnet account (starting with `G`).

---

## Testing

StellarKit API includes comprehensive tests. Run them with:

```bash
npm test
```

Tests validate all endpoints, error handling, and edge cases. If you modify the code, run tests to ensure nothing breaks.

---

## Connecting from Your App

### JavaScript/Node.js Example

```javascript
async function getAccount(accountId) {
  const response = await fetch(`http://localhost:3000/account/${accountId}`);
  const payload = await response.json();

  if (!response.ok) {
    console.error("Error:", payload.error.message);
    return null;
  }

  return payload.data;
}

// Usage
const account = await getAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
console.log("XLM Balance:", account.xlm.balance);
```

### TypeScript Example

```typescript
import type { AccountResponse } from "stellarkit-api";

async function getAccount(accountId: string): Promise<AccountResponse | null> {
  const response = await fetch(`http://localhost:3000/account/${accountId}`);
  const payload = await response.json();

  if (!response.ok) {
    console.error("Error:", payload.error.message);
    return null;
  }

  return payload.data as AccountResponse;
}
```

---

## API Response Format

Every response from StellarKit API follows a standard envelope:

### Success Response

```json
{
  "success": true,
  "data": { /* endpoint-specific data */ },
  "meta": { /* optional pagination or metadata */ }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "type": "ACCOUNT_NOT_FOUND",
    "message": "Account does not exist on the Stellar network"
  }
}
```

Always check `success` to know whether to process `data` or `error`.

---

## Troubleshooting

### Port Already in Use

If you get "Error: listen EADDRINUSE", the default port 3000 is already in use. Change it:

```bash
PORT=3001 npm run dev
```

Then access the API at `http://localhost:3001`.

### Network Connection Error

If you see "Error: Unable to connect to Horizon," check:

- Your internet connection
- The value of `STELLAR_NETWORK` in `.env` (should be `testnet` or `mainnet`)
- Try restarting the server

### Invalid Account ID

Stellar account IDs must:

- Start with `G`
- Be exactly 56 characters long
- Contain only alphanumeric characters

If you see "Invalid Stellar account ID," double-check the key you're using.

---

## Next Steps

1. **Explore the API:** Visit `http://localhost:3000` to browse all endpoints.
2. **Read the README:** Check [README.md](../README.md) for full endpoint documentation.
3. **Review the Glossary:** See [Glossary](glossary.md) for Stellar terminology.
4. **Check Examples:** Look in the `examples/` folder for real-world scripts.
5. **Contribute:** See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to contribute.

---

## Getting Help

- **Documentation:** [developers.stellar.org](https://developers.stellar.org/)
- **Community:** [Stellar Developers Slack](https://stellar-community.slack.com/)
- **GitHub Issues:** [stellarkit-lab-devtools/stellarkit-api](https://github.com/stellarkit-lab-devtools/stellarkit-api/issues)

---

Happy building! 🚀
