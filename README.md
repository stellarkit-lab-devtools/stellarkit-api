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

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/` | Lists available API endpoints and descriptions |
| GET | `/health` | Returns basic service health status |
| GET | `/network-status` | Returns current Stellar network and ledger info |
| GET | `/fee-estimate` | Calculates fee estimates for a transaction |
| GET | `/account/:id` | Retrieves full account details and balances |
| GET | `/account/:id/balances` | Retrieves XLM and asset balances only |
| GET | `/account/:id/sequence` | Retrieves the account sequence number |
| GET | `/account/:id/summary` | Retrieves a compact account summary |
| GET | `/account/:id/payments` | Lists payment and create_account operations |
| GET | `/account/:id/sponsorship` | Returns sponsorship relationships for the account (sponsor id and sponsored ledger entries) |
| GET | `/transactions/:id` | Retrieves paginated transaction history |
| GET | `/transactions/:id/operations` | Retrieves paginated operation history |
| GET | `/asset/:code/:issuer` | Retrieves metadata and statistics for an asset |
| GET | `/asset/:code/:issuer/holders` | Lists holders of an asset trustline |
| GET | `/asset/search` | Searches assets by code across issuers |
| GET | `/stream/transactions/:id` | Streams live account transactions via SSE |
| GET | `/utils/friendbot/:accountId` | Funds a testnet account via Friendbot |
| GET | `/utils/memo` | Decodes Horizon memo data |
| GET | `/utils/base64` | Encodes or decodes Base64 strings |
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
| GET    | `/utils/convert`               | Converts between XLM and stroops                |

---

## Soroban Smart Contracts

Soroban is Stellar’s smart contract platform for running WebAssembly (WASM) contracts on the Stellar ledger. It differs from traditional Stellar operations because it allows developers to execute programmable contract logic, instead of only submitting payments, trustline updates, account settings, and other built-in ledger operations.

A Soroban contract is referenced by a **contract ID**, which is the address used to invoke the contract after it has been deployed. The contract’s **WASM hash** is the digest of the compiled contract binary and uniquely identifies the contract code that is stored and executed on the network.

StellarKit API currently supports Soroban contract inspection through the `/soroban/contract/:id` endpoint. This endpoint enables developers to look up contract details by contract ID, including the associated WASM hash and contract metadata, making it easier to combine traditional Stellar account workflows with Soroban contract interactions.

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

| Variable          | Default                            | Description                                                                                                                                                       | Required |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `STELLAR_NETWORK` | `testnet`                          | Target Stellar network. Accepted values: `testnet` or `mainnet`. Controls which Horizon server is used and gates testnet-only endpoints such as Friendbot.        | ⬜ No    |
| `HORIZON_URL`     | _(derived from `STELLAR_NETWORK`)_ | Override the Horizon server URL. When omitted, defaults to `https://horizon-testnet.stellar.org` for `testnet` and `https://horizon.stellar.org` for `mainnet`.   | ⬜ No    |
| `PORT`            | `3000`                             | TCP port the Express server listens on.                                                                                                                           | ⬜ No    |
| `NODE_ENV`        | `development`                      | Runtime environment. Set to `production` to enable combined HTTP logging and sanitised error messages. Set to `test` to suppress console output during test runs. | ⬜ No    |
| `RATE_LIMIT_MAX`  | `100`                              | Maximum number of requests allowed per IP address per 15-minute window. Applies to the global rate limiter.                                                       | ⬜ No    |
| `CACHE_TTL_MS`    | `5000`                             | Cache time-to-live in milliseconds for the `/network-status` and `/fee-estimate` endpoints.                                                                       | ⬜ No    |

> All variables are optional — the server starts with sensible defaults when none are set. Set `STELLAR_NETWORK=mainnet` explicitly before deploying to production to avoid accidentally pointing at testnet.

---


## Optional API Key Authentication (Issue #198)

StellarKit API supports optional API key protection using environment variables:

```env
REQUIRE_API_KEY=true
API_KEYS=key1,key2,key3
```

When `REQUIRE_API_KEY` is enabled, clients must send the API key in the `X-API-Key` request header. The `/health` and `/` endpoints remain public even when authentication is enabled.

This feature is implemented in `src/middleware/apiKey.js` and covered by unit tests in `tests/apiKeyMiddleware.test.js`.

## FAQ

### What is the difference between testnet and mainnet?
The testnet is a free Stellar network for development and experimentation. Mainnet is the real network for live value transfers. Use testnet while building and switch to mainnet only when you are ready for production.

### How do I get a testnet account?
You can create a testnet account using Stellar's Friendbot service. In StellarKit API, use `GET /utils/friendbot/:accountId` with a valid public key to fund a new testnet account instantly.

### What are stroops?
A stroop is the smallest unit of XLM, just like a cent is the smallest unit of a dollar. One XLM equals 10 million stroops, so balances and fees are often measured in stroops internally.

### Why does Stellar require a minimum balance?
Stellar requires a minimum balance to prevent spam and keep the ledger efficient. Each account and each ledger entry (trustline, offer, data entry, signer) increases the reserve required to keep the account active.

### What is XDR?
XDR is the binary format Stellar uses to encode transactions, ledger entries, and protocol data. It lets Stellar transmit structured data in a compact, predictable way across the network.

### How can I read claimable balance predicates?
Claimable balance predicates are conditions that control when a claim is allowed. Common types include `unconditional`, `abs_before`, and `abs_after`. You can also combine them with `and`, `or`, and `not` to build more complex rules.

### What is a home domain?
A home domain is an optional string attached to a Stellar account that identifies the account's website or service. Wallets and anchors use it for branding, federation lookups, and verifying issuer relationships.

### Are there rate limits for StellarKit API?
Yes. StellarKit API uses a global rate limiter by default to protect the service and the underlying Horizon endpoints. The default limit is 100 requests per IP per 15 minutes, and it can be adjusted with `RATE_LIMIT_MAX`.

---

## Stellar Glossary

This glossary defines key Stellar-specific terms that appear throughout the API responses and Stellar documentation. Use this reference to understand the fundamental concepts of the Stellar ecosystem.

### Base Reserve
The fundamental unit of account reserve on the Stellar network, currently set to 0.5 XLM. Every account must hold a minimum of 2 base reserves (1 XLM) to exist, and each subentry increases the reserve requirement by 1 base reserve.

### Claimable Balance
A Stellar ledger entry that holds funds on behalf of one or more future recipients without requiring those recipients to exist on the network. Claimable balances can have predicates that control when funds can be claimed, enabling conditional and deferred transfers.

### DEX
The Decentralized Exchange built into Stellar's ledger. It allows users to create and fill limit orders for any pair of assets, forming automatic order books without a central operator.

### Home Domain
An optional string attached to a Stellar account that identifies the account's website or service. Used for branding, federation lookups, and verifying issuer relationships in wallets and anchors.

### Horizon
Stellar's REST API that provides access to the ledger, transactions, operations, and account data. Horizon is the primary interface for querying the Stellar network state and submitting transactions.

### Ledger
The main database of the Stellar blockchain that stores all accounts, balances, trustlines, offers, data entries, and other ledger entries. Each ledger closes approximately every 5-6 seconds, creating permanent historical records.

### Liquidity Pool
An automated market maker (AMM) that holds equal-value reserves of two assets and facilitates swaps between them. Pool shares represent ownership stakes, and traders pay fees that are distributed to share holders.

### Memo
An optional text, ID, hash, or return value attached to a transaction. Memos help organize and reference transactions but do not affect transaction logic or validation.

### Sequence Number
A counter maintained for each Stellar account that increments with each transaction. The sequence number ensures transactions are processed in order and prevents transaction replays. Clients must increment the sequence number when building multiple transactions.

### Soroban
Stellar's smart contract platform that allows developers to write WebAssembly (WASM) programs and execute them on the Stellar ledger. Soroban enables complex business logic beyond traditional Stellar operations.

### Stellar TOML
A configuration file hosted on an organization's domain that describes its Stellar-enabled services, supported assets, and federation information. Wallets and applications use Stellar TOML to verify issuer authenticity and discover federated addresses.\n\n### Stroop
The smallest unit of XLM, similar to a cent in traditional currency. One XLM equals 10 million stroops. Fees and small balances are often expressed in stroops internally.

### Subentry
Any ledger entry owned by an account other than the account itself. Trustlines, open offers, data entries, and additional signers are all subentries. Each subentry increases the account's minimum balance requirement by 1 base reserve (0.5 XLM).

### Trustline
A connection between an account and a specific asset (identified by code and issuer). An account must establish a trustline before it can hold or receive a non-native asset. Trustlines have limits that control the maximum amount of an asset an account can hold.

### XDR
External Data Representation; the binary serialization format Stellar uses to encode transactions, operations, and ledger data. XDR ensures compact, deterministic encoding for signing and network transmission.

---


## Testnet vs Mainnet

Stellar operates two public networks: **testnet** and **mainnet**. StellarKit API supports both and switches between them with a single environment variable.

| Feature | Testnet | Mainnet |
|---|---|---|
| Real funds | ❌ No — test XLM only | ✅ Yes — real XLM and assets |
| Network resets | ✅ Periodic resets (quarterly) | ❌ Never resets |
| Friendbot availability | ✅ Free account funding via `GET /utils/friendbot/:accountId` | ❌ Not available |
| Horizon URL | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| Recommended for | Development and testing | Production only |

### Switching Between Networks

Open your `.env` file and change `STELLAR_NETWORK`. That is the only value you need to update — `HORIZON_URL` is automatically derived from it and can be left blank.

**Testnet (default):**
```env
STELLAR_NETWORK=testnet
HORIZON_URL=
```

**Mainnet:**
```env
STELLAR_NETWORK=mainnet
HORIZON_URL=
```

Restart the server after changing environment variables for the new values to take effect.

### Mainnet Safety Considerations

> ⚠️ **Before switching to mainnet, read this carefully.**
>
> - **Real funds are at risk.** Every transaction on mainnet moves real XLM and real assets. Mistakes cannot be undone.
> - **Friendbot is not available.** You cannot fund accounts for free on mainnet. Accounts must be funded with real XLM.
> - **The network never resets.** Unlike testnet, mainnet state is permanent. There is no way to undo a transaction or recover a lost private key.
> - **Never use testnet keypairs on mainnet.** Keys generated or printed during `npm run seed` are for testnet only. Generate fresh keypairs for mainnet and keep private keys secure.
> - **Test thoroughly on testnet first.** Only switch to `STELLAR_NETWORK=mainnet` when your integration is fully validated.

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

## Multisig and Account Thresholds

Stellar accounts can be configured with multiple signers and a threshold system that controls which transactions are allowed. Each signer has a **weight**, and the account also has three transaction thresholds:

- **Low threshold** for simple operations like account reads, data updates, and trustline management.
- **Medium threshold** for typical payment and offer operations.
- **High threshold** for sensitive actions such as setting account options, adding/removing signers, or changing thresholds.

### Signer Weights and Combined Weight

Each signer on an account contributes its configured weight toward authorizing a transaction. Stellar evaluates the combined weight of all signers that sign a transaction and compares it to the threshold required by the operation.

- If the combined weight is equal to or greater than the operation's threshold, the transaction is valid.
- If the combined weight is lower than the required threshold, the transaction is rejected.

For example, an account could have:

- signer A with weight `1`
- signer B with weight `1`
- signer C with weight `2`

If a medium-threshold operation requires `2`, then either signer C alone or signers A and B together can authorize it.

### Working with Multisig Accounts in StellarKit API

StellarKit API exposes the account's multisignature details through dedicated account endpoints:

- `GET /account/:id/signers` returns the account's current signers and their weights.
- `GET /account/:id/multisig-plan` returns the account's threshold plan and how signers contribute to low, medium, and high threshold requirements.

These endpoints let developers inspect who can sign transactions, how much combined weight is available, and whether the account is configured correctly for its intended security model.

> Use `GET /account/:id/signers` to verify signer keys and weights, and `GET /account/:id/multisig-plan` to understand the threshold requirements before submitting multisig transactions.

---

## Understanding Claimable Balances

A **claimable balance** is a Stellar ledger entry that holds funds on behalf of one or more future recipients without requiring those recipients to exist on the network or take any action in advance. Think of it as placing money in a secure lockbox and handing out keys — each key can have conditions attached that control _when_ it can be used.

### How Claimable Balances Differ from Regular Payments

With a regular `payment` operation, the destination account must already exist, must have a trustline for non-native assets, and receives the funds immediately. A claimable balance removes all three constraints:

- **No destination account required at creation time.** The recipient's public key is listed as a claimant, but their account does not need to be funded yet. They can create and fund their account later and then claim the balance.
- **No trustline required in advance.** The claimant does not need a pre-existing trustline for the asset. Stellar creates the necessary trustline automatically when the balance is claimed.
- **Funds are not delivered instantly.** The balance sits on the ledger until a claimant actively submits a `claimClaimableBalance` operation. This makes claimable balances ideal for deferred, conditional, or opt-in transfers.

The account that creates the claimable balance pays the base reserves to keep the entry on the ledger. Those reserves are returned when the balance is eventually claimed or reclaimed.

### Predicates — Controlling When Funds Can Be Claimed

Every claimant in a claimable balance is paired with a **predicate** — a rule that determines whether the claim is allowed at a given moment. Stellar supports five predicate types that can be nested to build arbitrarily complex conditions.

#### Unconditional

```
{ "unconditional": true }
```

The claimant can claim the balance **at any time**, with no restrictions. This is the simplest predicate and is useful when you just want to park funds for someone to pick up whenever they are ready.

#### Time-Based: `abs_before`

```
{ "abs_before": "2026-12-31T23:59:59Z" }
```

The claim must happen **before** the specified timestamp. Once the deadline passes, this predicate evaluates to `false` and the claimant can no longer claim through it. Use this to set expiration dates — for example, a promotional reward that expires at the end of the quarter.

#### Time-Based: `abs_after`

```
{ "abs_after": "2026-06-01T00:00:00Z" }
```

The claim is only allowed **on or after** the specified timestamp. Before that moment the predicate evaluates to `false`. This is useful for vesting schedules, release dates, or any scenario where funds should be locked until a future date.

#### Compound: `and`

```json
{
  "and": [
    { "abs_after": "2026-06-01T00:00:00Z" },
    { "abs_before": "2026-12-31T23:59:59Z" }
  ]
}
```

**Both** sub-predicates must be true at the same time. The example above creates a claim window: the funds can only be claimed between June 1 and December 31, 2026. Outside that window the claim is denied.

#### Compound: `or`

```json
{
  "or": [{ "abs_after": "2026-06-01T00:00:00Z" }, { "unconditional": true }]
}
```

**At least one** sub-predicate must be true. Compound `or` predicates are less common but can model fallback conditions — for example, "claimable after a certain date, _or_ claimable unconditionally by a backup account."

#### Compound: `not`

```json
{
  "not": { "abs_before": "2026-06-01T00:00:00Z" }
}
```

Inverts the inner predicate. `not(abs_before X)` is logically equivalent to `abs_after X`. While `not` is rarely needed on its own, it becomes powerful when nested inside `and`/`or` trees to express precise business rules.

### Practical Use Cases

| Use Case                         | How Claimable Balances Help                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Onboarding new users**         | Send tokens to a public key that does not exist yet. The new user creates their account later and claims the balance — no coordination needed.                                        |
| **Vesting schedules**            | Create a balance with an `abs_after` predicate set to the vesting date. The employee or contributor can only claim once the date arrives.                                             |
| **Time-limited promotions**      | Use an `and` predicate combining `abs_after` (start) and `abs_before` (expiry) to define a claim window for airdrops or rewards.                                                      |
| **Escrow / conditional release** | The sender and a mediator are both listed as claimants. The sender's predicate uses `abs_after` (allowing reclaim after a timeout), while the recipient's predicate is unconditional. |
| **Recurring grants**             | Create multiple claimable balances with staggered `abs_after` dates to simulate a payment schedule without requiring the recipient to be online.                                      |

### Claimable Balance Endpoints in StellarKit API

StellarKit API exposes claimable balance data through two surfaces:

| Endpoint                                       | Description                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /account/:id/summary`                     | Returns the account's open claimable balances alongside recent transactions, open offers, and account details.                                                                                                                                        |
| `GET /account/:id/claimable-balances/eligible` | Evaluates every claimable balance where the account is a claimant and categorizes each one as **eligible** (claimable right now), **not yet claimable** (a future time predicate has not been met), or **expired** (a deadline predicate has passed). |

Use the `/claimable-balances/eligible` endpoint to build dashboards that show users exactly which funds are available to claim today and which are still locked. The API handles predicate evaluation server-side, so clients do not need to implement their own predicate logic.

---

## Understanding Liquidity Pools

Stellar's Liquidity Pools are automated market makers (AMMs) that enable decentralized asset swaps. This guide explains how pools work, how liquidity providers earn fees, and the fundamental concepts behind pool mechanics.

### What is a Liquidity Pool?

A liquidity pool is a smart ledger contract that holds equal-value reserves of two assets and facilitates swaps between them. Instead of relying on a central order book operator, the pool uses an automated pricing algorithm to execute trades and reward liquidity providers.

**Key characteristics:**
- Holds two assets in a **constant product invariant**: the product of the two reserve amounts remains constant before and after each swap.
- Issues **pool share tokens** to liquidity providers, representing fractional ownership of both reserves.
- Charges a **trading fee** (typically 0.3%) on every swap, which accrues to share holders.
- Operates on Stellar's native ledger without requiring external oracles or complicated governance.

### Pool Shares and Ownership

When you deposit assets into a liquidity pool, you receive **pool share tokens** proportional to your contribution. These shares represent your ownership stake in both reserves.

**Example:**
If you deposit 1,000 XLM and 50,000 USDC into an empty pool, you receive 7,071 pool shares (calculated as $\sqrt{1000 \times 50000}$). Your ownership is 100% of the pool. If you later withdraw your shares, you receive your proportional share of both reserves plus any fees earned.

If the pool price changes and another user deposits at a different ratio, your percentage ownership dilutes — but the total value of your shares typically increases because of accumulated fees.

### Reserve Ratios and the 50/50 Rule

Stellar liquidity pools maintain a **50/50 reserve ratio** by value. This means the total value of reserve A should equal the total value of reserve B at all times.

When a user swaps one asset for another, the pool adjusts prices according to the constant product formula, driving the ratio back toward 50/50. This self-correcting mechanism ensures the pool remains balanced and prevents depletion of either reserve.

**Why 50/50?**
- Minimizes impermanent loss for liquidity providers by keeping prices stable.
- Ensures neither reserve can be exhausted by extreme trades.
- Creates natural price discovery through the swap mechanism.

### Fee Mechanics

Every swap in a liquidity pool incurs a **trading fee**, typically **0.3%** (expressed as 30 basis points). This fee is taken from the input amount and distributed to all pool share holders in proportion to their ownership.

**Example:**
If you hold 10% of a pool's shares and the pool earns 100 USDC in fees over a period, you automatically receive 10 USDC when you withdraw or check your position. Fees are not claimed separately — they accrue directly to your share's proportional value.

The fee mechanism incentivizes liquidity provision: share holders earn passive income simply by holding their shares and allowing others to trade through the pool.

### Liquidity Pool Endpoints in StellarKit API

StellarKit API provides several endpoints to interact with and analyze liquidity pools:

| Endpoint                                  | Description                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /liquidity-pools`                    | Retrieves a list of all liquidity pools on the network with reserve details and fee information.                |
| `GET /liquidity-pools/:id`                | Fetches detailed information about a specific pool, including reserves, share count, and fee basis points.      |
| `GET /account/:id/pool-positions`         | Returns all liquidity pool positions for an account with calculated share values and equivalent reserves.       |
| `GET /dex/pool-share-value/:poolId/:shares` | Calculates the equivalent value of a specific number of pool shares in both reserve assets.                    |

Use these endpoints to build pool analysis dashboards, calculate LP returns, and help users decide when to provide or withdraw liquidity.

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

## Response Structure

All StellarKit API endpoints follow a standardized JSON response envelope. This ensures developers know exactly what structure to expect from every API call, whether it succeeds or fails.

### Success Response Envelope

Every successful response includes the following structure:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

**Fields:**

- `success` **(boolean)**: Always `true` for successful responses.
- `data` **(object)**: The actual response payload. Structure varies by endpoint.
- `meta` **(object)**: Optional metadata about the response, such as pagination information.

#### Non-Paginated Success Example

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "sequence": "12345678",
    "xlm": {
      "balance": "100.0000000",
      "minimumBalance": "1.0000000",
      "spendableBalance": "99.0000000"
    }
  },
  "meta": {}
}
```

#### Paginated Success Example

When an endpoint returns paginated results, the `meta` field includes pagination details:

```json
{
  "success": true,
  "data": [
    {
      "id": "txn_001",
      "type": "payment",
      "amount": "50.0000000"
    },
    {
      "id": "txn_002",
      "type": "payment",
      "amount": "25.5000000"
    }
  ],
  "meta": {
    "cursor": "eyJpZCI6InR4bl8wMDIifQ==",
    "limit": 10,
    "order": "desc"
  }
}
```

### Error Response Envelope

When an error occurs, the response structure differs:

```json
{
  "success": false,
  "error": {
    "type": "ACCOUNT_NOT_FOUND",
    "message": "Account does not exist on the Stellar network"
  }
}
```

**Fields:**

- `success` **(boolean)**: Always `false` for error responses.
- `error.type` **(string)**: A machine-readable error code for programmatic handling (e.g., `ACCOUNT_NOT_FOUND`, `INVALID_REQUEST`, `RATE_LIMITED`).
- `error.message` **(string)**: A human-readable error message describing what went wrong.

#### Error Response Example

```json
{
  "success": false,
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Invalid Stellar account ID. Must be a valid public key starting with 'G'."
  }
}
```

---

## Pagination Guide

Several endpoints in the StellarKit API return lists of records and support cursor-based pagination. This allows clients to fetch large datasets efficiently in smaller chunks.

### Query Parameters

When querying a paginated endpoint, the following optional parameters can be used:

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `limit` | number | `10` | The maximum number of records to return in a single page (Max 200, except `/account/:id/timeline` which has a max of 50). |
| `order` | string | `desc` | The chronological sorting order of the records: `desc` (newest first) or `asc` (oldest first). *(Not supported by `/account/:id/timeline`)*. |
| `cursor` | string | — | A pointer to a specific location in the dataset from which to resume fetching. |

### How Cursor-based Pagination Works

1. **Initial Request**: Make a request to a paginated endpoint without specifying a `cursor`. You can optionally set the `limit` and `order` parameters.
2. **Metadata Inspection**: The successful response contains a `meta` object.
   - If `nextCursor` has a string value (and `hasMore` is `true`), there is more data available.
   - If `nextCursor` is `null` (or not present), you have reached the end of the dataset.
3. **Subsequent Request**: To fetch the next page of results, make the same API call but include the `nextCursor` value as the `cursor` query parameter.

### Step-by-Step Example

Below is a step-by-step example showing how to paginate through transaction history for an account.

#### Step 1: Fetch the first page
Request a page of transactions with a `limit` of 2:
```http
GET /transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?limit=2
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "51234567-001",
      "hash": "8f8c4bc6f...",
      "ledger": 51234567,
      "createdAt": "2026-05-29T12:00:00Z",
      "sourceAccount": "GAAZI4..."
    },
    {
      "id": "51234566-002",
      "hash": "4a3b8cd12...",
      "ledger": 51234566,
      "createdAt": "2026-05-29T11:58:00Z",
      "sourceAccount": "GAAZI4..."
    }
  ],
  "meta": {
    "count": 2,
    "limit": 2,
    "order": "desc",
    "nextCursor": "51234566-002",
    "hasMore": true
  }
}
```

#### Step 2: Fetch the next page using the cursor
Extract `"nextCursor": "51234566-002"` from the first response and send it as the `cursor` query parameter:
```http
GET /transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?limit=2&cursor=51234566-002
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "51234560-001",
      "hash": "1d2e3f4a...",
      "ledger": 51234560,
      "createdAt": "2026-05-29T11:45:00Z",
      "sourceAccount": "GAAZI4..."
    }
  ],
  "meta": {
    "count": 1,
    "limit": 2,
    "order": "desc",
    "nextCursor": null,
    "hasMore": false
  }
}
```
Since `nextCursor` is `null` and `hasMore` is `false`, the client knows that there are no additional records to fetch.

### Paginated Endpoints

The following StellarKit API endpoints support cursor-based pagination:

* **`GET /transactions/:id`**: Returns paginated transaction history for an account.
* **`GET /transactions/:id/operations`**: Returns paginated operation history for an account.
* **`GET /account/:id/payments`**: Returns paginated payment and create_account operations for an account.
* **`GET /account/:id/timeline`**: Returns a unified chronological timeline of events for an account.
* **`GET /account/:id/transactions/search`**: Searches transaction history filtered by memo content.
* **`GET /asset/:code/:issuer/holders`**: Returns accounts holding a trustline for a specific asset.

---

## Asset Format Reference

Stellar represents assets in different formats depending on the context. This reference explains how native and non-native assets are formatted in API responses and request parameters.

### Native XLM Representation

XLM, the native asset of Stellar, is represented in one of two ways:

**In most API responses:**
```json
{
  "asset_type": "native"
}
```

**In CODE:ISSUER format (used in DEX and path endpoints):**
```
XLM:native
```

The keyword `native` is always used in place of an issuer for XLM, since XLM has no issuer — it is the platform's native currency.

### Alphanum4 Format

Assets with 4-character or shorter codes are formatted as **alphanum4**. Examples include USD, EUR, CNY, and custom codes like JPY or EURT.

**In API responses:**
```json
{
  "asset_type": "credit_alphanum4",
  "asset_code": "USD",
  "asset_issuer": "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIYU2IYLLU2DENJCAHE4WREQDFT"
}
```

**In CODE:ISSUER format:**
```
USD:GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIYU2IYLLU2DENJCAHE4WREQDFT
```

### Alphanum12 Format

Assets with codes longer than 4 characters (up to 12) are formatted as **alphanum12**. Examples include yXLM, abcdef123xyz, and longer custom asset codes.

**In API responses:**
```json
{
  "asset_type": "credit_alphanum12",
  "asset_code": "yXLM",
  "asset_issuer": "GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE"
}
```

**In CODE:ISSUER format:**
```
yXLM:GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE
```

### Common Asset Examples

| Asset | CODE:ISSUER Format | Description |
| --- | --- | --- |
| **XLM (Native)** | `XLM:native` | Stellar's native asset |
| **USDC (USD Coin)** | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | Stablecoin issued by Circle |
| **yXLM (Yield XLM)** | `yXLM:GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE` | Yield-bearing XLM wrapper |
| **EUR (Euro)** | `EUR:GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIYU2IYLLU2DENJCAHE4WREQDFT` | Fiat-backed asset |
| **BTC (Bitcoin)** | `BTC:GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH` | Bitcoin-backed asset |

### Using Asset Formats in API Requests

**DEX Endpoints:**
When querying DEX endpoints like `/dex/orderbook`, `/dex/depth`, or `/dex/spread`, always use the CODE:ISSUER format:

```
GET /dex/orderbook?buyingAsset=USDC:GBBD47IF...&sellingAsset=XLM:native
GET /dex/spread?buyingAsset=yXLM:GARDN...&sellingAsset=USDC:GBBD...
```

**Asset Lookup Endpoints:**
When querying specific asset information via `/asset/:code/:issuer`, use the path parameters directly:

```
GET /asset/USDC/GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
GET /asset/yXLM/GARDNV3Q7YGH5JEKUJE2QG7MEMBZA47GYUYFQ6EVJYY3YKGU6EBQABE
```

---

## Stellar Memo Types Reference

Stellar transactions can include an optional memo field to help identify and organize payments. Each memo type serves a specific use case, and understanding when to use each type is important for building reliable payment systems.

### MEMO_NONE

**Max Size:** N/A (no memo)

**Use Case:**
No memo is attached to the transaction. Use this when the transaction is self-documenting or when no reference is needed. Most system-to-system transfers or internal account movements use MEMO_NONE.

**Example:**
```
Transfer: Internal wallet sweep between accounts
```

### MEMO_TEXT

**Max Size:** 28 bytes (approximately 28 ASCII characters)

**Use Case:**
Attach human-readable text that describes the transaction purpose. Common for payment references, invoice numbers, order IDs, or short descriptions. Useful for customer support and transaction reconciliation.

**Example:**
```
memo: "INV-2024-0512"
memo: "Salary June 2024"
memo: "Airbot withdrawal"
```

### MEMO_ID

**Max Size:** 64-bit unsigned integer (0 to 18,446,744,073,709,551,615)

**Use Case:**
Attach a numeric identifier to a transaction. Use this when you want to reference a specific transaction against a numeric database ID or unique number. Many payment processors use memo IDs to link blockchain transactions to internal records.

**Example:**
```
memo_id: 123456789        // Links to customer ID in payment processor
memo_id: 987654321        // References an internal invoice number
memo_id: 1234567890123456 // Unique transaction identifier
```

### MEMO_HASH

**Max Size:** 32 bytes (SHA-256 hash digest)

**Use Case:**
Attach a cryptographic hash to represent a document, contract, or data commitment. Use this when you need to prove a transaction relates to specific data without disclosing the data itself, or when you want to anchor a transaction to a specific document hash.

**Example:**
```
memo_hash: "8f7c4b8c3f8c9e7f4c1a2b3c4d5e6f7g"  // Hash of a contract
memo_hash: "sha256(order_data)"                 // Hash of order details
```

### MEMO_RETURN

**Max Size:** 32 bytes (return hash for payment errors)

**Use Case:**
Used by receivers to send a payment back to the sender, typically when a payment cannot be processed. The memo_return value echoes the hash from the original transaction. This is most common in automated return/refund flows.

**Example:**
```
Original transaction memo_hash: "abc123def456"
Return transaction memo_return: "abc123def456"  // Echoes original to link refund
```

### Choosing a Memo Type

Use this decision tree to select the right memo type for your use case:

| Scenario | Recommended Type | Reason |
| --- | --- | --- |
| No reference needed | MEMO_NONE | Simplest, no overhead |
| Readable invoice or order reference | MEMO_TEXT | Human-friendly, easy to track |
| Link to numeric database ID | MEMO_ID | Efficient, indexed database lookups |
| Cryptographic proof of document | MEMO_HASH | Immutable, non-repudiable commitment |
| Automated refund or return flow | MEMO_RETURN | Tracks original transaction |

### Querying Transactions by Memo

Use the `GET /account/:id/transactions/search` endpoint to find transactions by memo content. The endpoint supports filtering by memo type:

```
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions/search?memo=INV-2024-0512&memo_type=text
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions/search?memo=123456789&memo_type=id
```

Also use the `GET /utils/memo` endpoint to decode raw memo data from transaction responses:

```
GET /utils/memo?memo=SGVsbG8gV29ybGQ=&memo_type=text
```

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

## Understanding XDR

XDR (External Data Representation) is the binary serialization format Stellar uses to encode transactions, operations, and results on the ledger. Every transaction that is built, signed, and submitted to the network is serialized into XDR before it travels anywhere. Horizon stores and returns this serialized form alongside the human-readable fields in its responses.

In practice, XDR looks like a long Base64-encoded string — for example:

```
AAAAAgAAAAA1YmS1mXvUjD7Zq0L0m3i4XN6T8z7j8X7X8X7X8X7XAAAAZAAA...
```

It is compact and deterministic, which makes it ideal for signing and network transmission, but it is not human-readable on its own. That is why a decoder is useful during development.

### Where XDR Appears in API Responses

You will encounter XDR fields in several places across the StellarKit API:

| Field             | Endpoint                                                        | Description                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envelopeXdr`     | `GET /transactions/:id`, `GET /account/:id/transactions/search` | The full signed transaction envelope. Contains the transaction body, all operations, and all signatures. This is the exact bytes that were submitted to the network. |
| `envelope_xdr`    | `GET /stream/transactions/:id` (SSE stream)                     | Same envelope data, returned in the raw Horizon field name format used by the streaming formatter.                                                                   |
| `result_xdr`      | `GET /stream/transactions/:id` (SSE stream)                     | The transaction result as recorded by the ledger. Encodes whether the transaction succeeded and the result code for each operation.                                  |
| `result_meta_xdr` | `GET /stream/transactions/:id` (SSE stream)                     | Ledger entry changes produced by the transaction — which accounts, trustlines, offers, or data entries were created, updated, or deleted.                            |

### When You Need to Decode XDR

Most of the time you can ignore XDR fields entirely — the API already surfaces the important data (fee, memo, operation count, success status) as plain JSON. XDR becomes relevant when you need to:

- **Inspect raw operations** — verify exactly what operations a transaction contained, including source accounts and parameters not surfaced in the summary fields.
- **Debug failed transactions** — `result_xdr` encodes the precise failure reason for each operation, which is more detailed than the top-level `successful` flag.
- **Audit ledger state changes** — `result_meta_xdr` shows every ledger entry that was modified, useful for reconciliation and auditing.
- **Re-sign or resubmit** — if you need to take an existing envelope, inspect it, and resubmit or modify it, you start from the `envelopeXdr` value.

### Decoding XDR

Use the `POST /utils/decode-xdr` endpoint to convert any Base64-encoded transaction envelope into a readable JSON object. Pass the XDR string in the request body:

```
POST /utils/decode-xdr
Content-Type: application/json

{ "xdr": "AAAAAgAAAAD..." }
```

The response breaks the envelope down into its component parts:

```json
{
  "success": true,
  "data": {
    "sourceAccount": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "fee": "100",
    "sequenceNumber": "12345678",
    "memo": { "type": "text", "value": "invoice-123" },
    "timeBounds": null,
    "operations": [
      {
        "type": "payment",
        "destination": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "asset": { "code": "USDC", "issuer": "GA5Z..." },
        "amount": "50.0000000"
      }
    ]
  }
}
```

The decoder accepts `envelopeXdr` values from any StellarKit response and works for both testnet and mainnet transactions.

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

### Understanding Account Sponsorship

Account sponsorship in Stellar allows one account (the sponsor) to cover the base reserve and associated subentry reserves for ledger entries owned or created for another account. Sponsorship makes it possible for custodial services, marketplaces, or onboarding flows to pay ledger costs on behalf of users while sponsorship is active.

- What it means: sponsorship ties specific ledger entries (accounts, trustlines, signers, data entries, offers, claimable balances, etc.) to a sponsoring account that pays the associated reserve while the sponsorship exists.
- Sponsored reserves: while sponsorship is active, the sponsor is responsible for the base reserve required by those sponsored ledger entries. If sponsorship ends, the sponsored account must meet the reserve requirements itself or the network may require cleanup or disallow some entries.
- Why it exists: to simplify onboarding, reduce friction for new users, and enable managed services to cover ledger costs temporarily or indefinitely.

Using this API:

- Inspect sponsorship relationships using `GET /account/:id/sponsorship`. This endpoint helps determine whether an account or its ledger entries are sponsored, who the sponsor is, and which entries are covered — useful for UI indicators, billing reconciliation, or migration workflows.

Note: This repository documents the sponsorship inspection endpoint; it does not change any runtime behavior or add sponsorship logic.

  }
}
```

---

### `GET /account/:id/pool-positions`

Returns all liquidity pool positions for an account with calculated share values and equivalent reserves.

**Example:**

```
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/pool-positions
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "poolId": "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026",
      "shares": "1000.0000000",
      "sharePercent": "5.2500",
      "totalPoolShares": "19047.6190476",
      "reserveA": {
        "asset": "native",
        "totalAmount": "50000.0000000",
        "equivalentAmount": "2625.0000000"
      },
      "reserveB": {
        "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "totalAmount": "50000.0000000",
        "equivalentAmount": "2625.0000000"
      },
      "feeBp": 30,
      "totalTrustlines": 42,
      "lastModifiedLedger": 12345678
    }
  ],
  "meta": {
    "count": 1,
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
  }
}
```

**Key Fields:**

- `shares`: The account's pool share tokens
- `sharePercent`: Percentage of total pool ownership
- `equivalentAmount`: The account's proportional share of each reserve asset
- `feeBp`: Pool fee in basis points (30 = 0.3%)

---

### `GET /account/:id/transactions/search`

Searches transaction history for a Stellar account and filters results by memo content. Useful for developers building payment reference tracking systems.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memo` | string | Yes | Memo value to search for |
| `memo_type` | string | No | Filter by memo type: `text`, `id`, `hash`, `return` |
| `limit` | number | No | Number of results (default: 10, max: 200) |
| `cursor` | string | No | Pagination cursor from previous response |
| `order` | string | No | Sort order: `asc` or `desc` (default: `desc`) |

**Example:**

```
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions/search?memo=invoice-123
GET /account/GAAZI4.../transactions/search?memo=12345&memo_type=id
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "123456789",
      "hash": "abc123...",
      "ledger": 12345678,
      "createdAt": "2024-07-01T12:00:00Z",
      "sourceAccount": "GAAZI4...",
      "fee": {
        "charged": "100",
        "account": "GAAZI4..."
      },
      "feeSummary": {
        "chargedInStroops": 100,
        "chargedInXLM": "0.0000100",
        "perOperationInStroops": 100,
        "perOperationInXLM": "0.0000100"
      },
      "operationCount": 1,
      "memoType": "text",
      "memo": "invoice-123",
      "successful": true,
      "envelopeXdr": "..."
    }
  ],
  "meta": {
    "count": 1,
    "limit": 10,
    "order": "desc",
    "searchQuery": {
      "memo": "invoice-123",
      "memoType": "any"
    },
    "nextCursor": "123456789",
    "hasMore": false
  }
}
```

**Search Behavior:**

- **Text memos**: Case-insensitive substring match (e.g., "inv" matches "invoice-123")
- **ID/Hash/Return memos**: Exact match only
- Transactions with `memo_type: none` are excluded from results
- Only successful transactions are returned

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

### `GET /dex/spread/:sellAsset/:buyAsset`

Calculates the bid-ask spread for a trading pair on the Stellar DEX. Helps developers and traders assess market liquidity at a glance.

**Asset Format**: `CODE:ISSUER` (e.g., `XLM:native`, `USDC:GA5Z...`)

**Example:**

```
GET /dex/spread/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
GET /dex/spread/USDC:GA5Z.../EURC:GB...
```

**Response:**

```json
{
  "success": true,
  "data": {
    "bestBid": {
      "price": "0.0850000",
      "amount": "1000.0000000"
    },
    "bestAsk": {
      "price": "0.0855000",
      "amount": "500.0000000"
    },
    "spreadAbsolute": "0.0005000",
    "spreadPercent": "0.5882",
    "midPrice": "0.0852500",
    "liquidity": "high",
    "orderBookDepth": {
      "bids": 25,
      "asks": 30,
      "totalBidVolume": "50000.0000000",
      "totalAskVolume": "45000.0000000",
      "totalVolume": "95000.0000000"
    }
  }
}
```

**Key Fields:**

- `bestBid`: Highest buy order price and amount
- `bestAsk`: Lowest sell order price and amount
- `spreadAbsolute`: Difference between ask and bid prices
- `spreadPercent`: Spread as percentage of mid price
- `midPrice`: Average of best bid and ask
- `liquidity`: Market depth assessment (high/medium/low)
  - **high**: Total volume ≥ 10,000
  - **medium**: Total volume ≥ 1,000
  - **low**: Total volume < 1,000

**Error Responses:**

- `400`: Invalid asset format
- `404`: No order book exists for trading pair

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

## Understanding the Stellar DEX

The Stellar network includes a built-in decentralized exchange (DEX) that lets anyone trade assets directly on the ledger — no third-party exchange required. Understanding how it works helps you build trading tools, wallets, and payment flows that take full advantage of Stellar's on-chain liquidity.

### Offers, Bids, and Asks

Trading on the Stellar DEX works through **offers** — on-ledger orders that say "I will sell X amount of asset A for Y amount of asset B." Every offer is stored on the ledger and remains open until it is filled, cancelled, or the account no longer has sufficient balance.

The order book for a trading pair is made up of two sides:

- **Bids** — buy orders. These are offers from accounts willing to buy the base asset. The best bid is the highest price a buyer is prepared to pay.
- **Asks** — sell orders. These are offers from accounts willing to sell the base asset. The best ask is the lowest price a seller will accept.

The difference between the best ask and the best bid is the **spread**. A tight spread signals a liquid, competitive market. A wide spread means fewer participants and potentially worse execution prices.

### Trading Pairs

A trading pair on the Stellar DEX is simply any two assets. Because every asset on Stellar is identified by its code and issuer (e.g., `USDC:GA5Z...`), any two assets can form a pair. Native XLM is represented as `XLM:native`.

There is no central listing process — if two accounts create matching offers for any pair of assets, a market exists. This means the DEX supports thousands of pairs simultaneously, including stablecoins, tokenized commodities, and custom project tokens.

### Path Payments

A **path payment** is a special Stellar operation that lets you send one asset while the recipient receives a different asset. Stellar automatically finds a conversion route through one or more intermediate assets on the DEX, executing the trades atomically in a single transaction.

For example, you can send XLM and have the recipient receive USDC — Stellar handles the swap on-chain. If no direct XLM/USDC market exists, Stellar can route through intermediate assets (e.g., XLM → BTC → USDC) to complete the payment.

Path payments are useful because:

- **Cross-currency payments** — senders and recipients can each hold their preferred asset without needing to share a common currency.
- **Atomic execution** — the entire conversion and delivery either succeeds completely or fails with no partial state.
- **Best-rate routing** — Stellar evaluates available paths and selects the one that delivers the most to the recipient for a given source amount (or costs the sender the least for a fixed destination amount).
- **Arbitrage detection** — circular paths (asset A → ... → asset A) can reveal price inefficiencies across the DEX.

### DEX Endpoints

| Endpoint                                     | Description                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /dex/spread/:sellAsset/:buyAsset`       | Fetches the live order book for a trading pair and returns the best bid, best ask, spread, mid price, and order book depth. Useful for displaying market data or deciding whether conditions are favorable before submitting a trade. |
| `GET /dex/arbitrage/:assetCode/:assetIssuer` | Uses Horizon's strict-receive path finding to check whether a circular route exists from an asset back to itself. Returns all discovered paths and flags which ones are profitable (source amount less than destination amount).      |

**Asset format for DEX endpoints:** `CODE:ISSUER` — for example `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`. Use `XLM:native` for the native asset.

These endpoints wrap Horizon's order book and path-finding APIs, normalizing the responses into the standard StellarKit envelope so you get consistent `success`, `data`, and `error` fields across all calls.

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
