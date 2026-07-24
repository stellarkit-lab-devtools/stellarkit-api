# Frequently Asked Questions (FAQ)

Welcome to the StellarKit API FAQ! Here are answers to the most common questions new contributors and developers have when evaluating or working with this project.

### 1. Why is the API needed when Horizon already exists?
StellarKit API acts as a developer-friendly wrapper around the Stellar Horizon API. It normalizes Horizon responses into a standardized, predictable JSON envelope (with `success`, `data`, and `error` fields). Additionally, it adds convenience endpoints for the most common Stellar developer workflows, aggregates account details (like balances, signers, and reserve breakdowns), and provides clear, human-readable error messages.

### 2. Can it be used on mainnet?
Yes! StellarKit API fully supports both the Stellar testnet and mainnet. You can configure this via the `STELLAR_NETWORK` environment variable in your `.env` file. By default, it runs on `testnet`, but setting `STELLAR_NETWORK=mainnet` will route requests to the main network. Ensure this is explicitly set before deploying to production.

### 3. Is an API key required?
By default, no API key is required (`REQUIRE_API_KEY` is set to `false`). The API is open for local development and testing out of the box. However, if you are deploying StellarKit API to production, you can set `REQUIRE_API_KEY=true` and provide a comma-separated list of valid keys in the `API_KEYS` environment variable. Clients will then need to pass the key via the `X-API-Key` header.

### 4. Why are some endpoints cached and others not?
StellarKit API uses an in-memory TTL cache to store responses for high-traffic endpoints whose data changes relatively slowly or is requested frequently across users (for example, `/network-status` and `/fee-estimate`). Caching these prevents unnecessary load on the Horizon server and speeds up response times. On the other hand, real-time endpoints (such as specific account balances or live transaction streams) are not cached to guarantee you always receive the most accurate, up-to-date state from the ledger.

### 5. How are Stellar Wave points awarded?
StellarKit API participates in the Stellar Wave Program on Drips. During each monthly Wave (a 7-day sprint), contributors can earn points by solving issues. To participate:
1. Browse open issues labeled with point values in the repository.
2. Apply to work on an issue via the Drips Wave app.
3. Submit a Pull Request that solves the issue.
4. Once merged, you earn points which are converted to real rewards.

### 6. What is the standard response envelope?
All API endpoints return a standardized JSON envelope. 
- For **success**, the root object contains `"success": true`, and the core payload is nested under the `"data"` key. Optional metadata (like pagination details) is placed under `"meta"`.
- For **errors**, the root object contains `"success": false` and a detailed `"error"` object with the type and a clear message explaining the failure.

### 7. How are Stellar amounts and fees formatted?
Stellar amounts are handled as decimal strings with up to 7 decimal places to avoid precision loss in JavaScript. In StellarKit API:
- **Raw/API Amounts** are returned as flat decimal strings (e.g., `"100.1234567"`).
- **Formatted Display Amounts** (often used for XLM balances) include thousands separators (e.g., `"1,234.5678900"`).
- Fees are often returned in both **stroops** (the smallest integer unit of XLM, where 1 XLM = 10,000,000 stroops) and formatted XLM decimals.

### 8. How does pagination work?
Endpoints returning lists of records support cursor-based pagination. You can control the results using `limit`, `order` (asc/desc), and a `cursor` token. The paginated records are returned in the `data` array, while a `meta` block is provided alongside it containing details like `nextCursor`, `count`, and `hasMore` so your application can easily fetch the next page.
