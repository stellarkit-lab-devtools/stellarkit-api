# StellarKit TypeScript SDK Reference

Complete reference for the StellarKit TypeScript/JavaScript SDK. Use this guide to install the client, initialise modules, and call every available method without reading source code.

The SDK wraps the [StellarKit API](https://github.com/stellarkit-lab-devtools/stellarkit-api) REST endpoints and returns the typed `data` field from each response envelope.

---

## Installation

```bash
npm install stellarkit-sdk
```

**Local development** (this repository): import directly from the `sdk/` folder:

```bash
# From the stellarkit-api repo root — no npm publish required
npm install
```

```typescript
import { AccountModule } from "../sdk/account";
import { DexModule } from "../sdk/dex";
import { FeesModule } from "../sdk/fees";
import { StellarKitClient } from "../sdk/stellarkit-client";
```

Bundled TypeScript definitions live in [`types/index.d.ts`](../types/index.d.ts).

---

## Initialisation

All modules accept the same constructor options:

| Option    | Type     | Required | Description                                      |
| --------- | -------- | -------- | ------------------------------------------------ |
| `baseUrl` | `string` | Yes      | StellarKit API base URL (e.g. `http://localhost:3000`) |
| `apiKey`  | `string` | No       | Sent as the `x-api-key` request header           |

### Modular clients (recommended)

Use focused modules for **account**, **dex**, and **fees**. Use **`StellarKitClient`** for **network** and all other endpoints.

```typescript
import { AccountModule } from "stellarkit-sdk/account";
import { DexModule } from "stellarkit-sdk/dex";
import { FeesModule } from "stellarkit-sdk/fees";
import { StellarKitClient } from "stellarkit-sdk";

const baseUrl = "https://api.example.com";
const apiKey = process.env.STELLARKIT_API_KEY;

const account = new AccountModule({ baseUrl, apiKey });
const dex = new DexModule({ baseUrl, apiKey });
const fees = new FeesModule({ baseUrl, apiKey });
const client = new StellarKitClient({ baseUrl, apiKey });
```

### Unified client

`StellarKitClient` exposes every endpoint in one class (network, fees, account, transactions, assets, DEX, pools, utils).

```typescript
import { StellarKitClient } from "stellarkit-sdk";

const client = new StellarKitClient({
  baseUrl: "http://localhost:3000",
  apiKey: "your-api-key", // optional
});

const status = await client.getNetworkStatus();
```

---

## Error handling

All modules throw **`StellarKitError`** on non-2xx responses:

```typescript
import { StellarKitError } from "stellarkit-sdk";

try {
  await account.getAccount("GINVALID...");
} catch (err) {
  if (err instanceof StellarKitError) {
    console.error(err.status, err.type, err.message);
  }
}
```

| Property  | Type     | Description                          |
| --------- | -------- | ------------------------------------ |
| `status`  | `number` | HTTP status code (e.g. `404`)        |
| `type`    | `string` | API error type (e.g. `ValidationError`) |
| `message` | `string` | Human-readable error message         |

---

## Account module (`AccountModule`)

Import: `import { AccountModule } from "stellarkit-sdk/account"`

Wraps `GET /account/:id/*` routes.

### `getAccount`

**Signature:** `getAccount(id: string): Promise<AccountResponse["data"]>`

Returns full account details: XLM balance, assets, signers, thresholds, and flags.

```typescript
const details = await account.getAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
console.log(details.xlm.balance);
```

### `getNativeBalance`

**Signature:** `getNativeBalance(id: string): Promise<NativeBalance>`

Returns native XLM balance and liabilities only.

```typescript
const native = await account.getNativeBalance("GAAZI4...");
console.log(native.balance, native.buyingLiabilities);
```

### `getBalances`

**Signature:** `getBalances(id: string): Promise<AccountBalancesResponse["data"]>`

Returns XLM and all asset balances without full account metadata.

```typescript
const balances = await account.getBalances("GAAZI4...");
console.log(balances.assets.length);
```

### `getTrustlines`

**Signature:** `getTrustlines(id: string, options?: { assetCode?: string }): Promise<TrustlineEntry[]>`

Returns trustlines with TOML metadata; optionally filter by asset code.

```typescript
const all = await account.getTrustlines("GAAZI4...");
const usdc = await account.getTrustlines("GAAZI4...", { assetCode: "USDC" });
```

### `getPayments`

**Signature:** `getPayments(id: string, options?: { limit?: number; cursor?: string }): Promise<PaginatedResponse<PaymentOperation>>`

Returns payment and create_account operations with pagination.

```typescript
const page1 = await account.getPayments("GAAZI4...", { limit: 20 });
const page2 = await account.getPayments("GAAZI4...", { cursor: page1.cursor });
```

### `getSigners`

**Signature:** `getSigners(id: string): Promise<AccountSignersResponse["data"]>`

Returns signers and threshold configuration extracted from the account record.

```typescript
const { signers, thresholds } = await account.getSigners("GAAZI4...");
console.log(thresholds.high_threshold);
```

### `getAge`

**Signature:** `getAge(id: string): Promise<AccountAgeResponse["data"]>`

Returns account age, creation ledger, and maturity metrics.

```typescript
const age = await account.getAge("GAAZI4...");
console.log(age.ageInDays, age.maturity);
```

### `getRiskScore`

**Signature:** `getRiskScore(id: string): Promise<AccountRiskScoreResponse["data"]>`

Returns a computed risk score and contributing factors.

```typescript
const risk = await account.getRiskScore("GAAZI4...");
console.log(risk.score, risk.rating);
```

### `getAccountData`

**Signature:** `getAccountData(id: string): Promise<AccountResponse["data"]>`

Alias for `getAccount` — returns the complete account payload.

```typescript
const data = await account.getAccountData("GAAZI4...");
```

### `getOffers`

**Signature:** `getOffers(id: string, options?: { limit?: number; cursor?: string }): Promise<PaginatedResponse<Offer>>`

Returns open DEX offers for the account with pagination.

```typescript
const offers = await account.getOffers("GAAZI4...", { limit: 50 });
console.log(offers.items[0]?.price);
```

---

## DEX module (`DexModule`)

Import: `import { DexModule } from "stellarkit-sdk/dex"`

Wraps `GET /dex/*` routes. Asset parameters accept `"CODE:ISSUER"` strings (e.g. `"XLM:native"`, `"USDC:G..."`) or `{ code, issuer }` objects.

### `getSpread`

**Signature:** `getSpread(sellAsset: AssetParam, buyAsset: AssetParam): Promise<SpreadData>`

Calculates bid-ask spread, mid price, and order book depth summary for a pair.

```typescript
const spread = await dex.getSpread(
  "XLM:native",
  "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);
console.log(spread.spreadPercent, spread.liquidity);
```

### `getImbalance`

**Signature:** `getImbalance(sellAsset: AssetParam, buyAsset: AssetParam): Promise<ImbalanceData>`

Detects buy/sell pressure imbalance on a trading pair.

```typescript
const imbalance = await dex.getImbalance(
  { code: "XLM", issuer: "native" },
  { code: "USDC", issuer: "GA5Z..." },
);
console.log(imbalance.pressure, imbalance.signal);
```

### `getArbitrage`

**Signature:** `getArbitrage(code: string, issuer: string): Promise<ArbitrageData>`

Finds circular arbitrage paths for an asset.

```typescript
const arb = await dex.getArbitrage("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
console.log(arb.pathsFound, arb.paths.length);
```

### `getOrderBook`

**Signature:** `getOrderBook(sellAsset: AssetParam, buyAsset: AssetParam): Promise<OrderBookData>`

Returns full order book depth analysis including top bids/asks and depth rating.

```typescript
const book = await dex.getOrderBook("XLM:native", "USDC:GA5Z...");
console.log(book.depthRating, book.totalBidVolume);
```

### `getPrice`

**Signature:** `getPrice(sellAsset: AssetParam, buyAsset: AssetParam, amount?: number): Promise<PriceData>`

Calculates effective exchange rate via the best payment path (default amount: `1`).

```typescript
const price = await dex.getPrice("XLM:native", "USDC:GA5Z...", 100);
console.log(price.buyAmount, price.effectiveRate);
```

---

## Fees module (`FeesModule`)

Import: `import { FeesModule } from "stellarkit-sdk/fees"`

Wraps `GET /fee-estimate/*` routes.

### `getFeeEstimate`

**Signature:** `getFeeEstimate(operations?: number, fresh?: boolean): Promise<FeeEstimateResponse["data"]>`

Returns economy, standard, and priority fee tiers for a transaction.

```typescript
const estimate = await fees.getFeeEstimate(3);
console.log(estimate.totalFee.standard.stroops);

// Bypass server cache for live data
const live = await fees.getFeeEstimate(1, true);
```

### `getSurgeStatus`

**Signature:** `getSurgeStatus(): Promise<SurgeStatusData>`

Identifies fee surge periods and returns actionable recommendations.

```typescript
const surge = await fees.getSurgeStatus();
if (surge.isSurging) {
  console.log(surge.recommendation, surge.suggestedFee);
}
```

### `getFeeTrends`

**Signature:** `getFeeTrends(): Promise<FeeTrendsData>`

Analyzes fee trends across the last 50 ledgers with statistical summary.

```typescript
const trends = await fees.getFeeTrends();
console.log(trends.summary.avgBaseFee, trends.ledgersAnalyzed);
```

---

## Network (`StellarKitClient`)

Network endpoints are exposed on the unified **`StellarKitClient`** (no separate `NetworkModule` yet).

Import: `import { StellarKitClient } from "stellarkit-sdk"`

### `getHealth`

**Signature:** `getHealth(): Promise<HealthResponse["data"]>`

Service health check — status, version, network, and timestamp.

```typescript
const health = await client.getHealth();
console.log(health.status, health.network);
```

### `getNetworkStatus`

**Signature:** `getNetworkStatus(): Promise<NetworkStatusResponse["data"]>`

Latest ledger, base fee, reserve, and protocol version.

```typescript
const status = await client.getNetworkStatus();
console.log(status.latestLedger.sequence, status.fees.baseFeeInXLM);
```

### `getNetworkLedgerTiming`

**Signature:** `getNetworkLedgerTiming(): Promise<unknown>`

Analyzes ledger close time consistency across recent ledgers.

```typescript
const timing = await client.getNetworkLedgerTiming();
console.log(timing);
```

---

## Unified client — additional methods (`StellarKitClient`)

The following methods are available on **`StellarKitClient`** for endpoints not yet split into focused modules. Signatures mirror [`sdk/stellarkit-client.ts`](../sdk/stellarkit-client.ts).

### Fees (unified client aliases)

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `getFeeEstimate` | `(operations?: number, fresh?: boolean) => Promise<FeeEstimateResponse["data"]>` | Fee tiers for transaction submission |
| `getFeeSurgeStatus` | `() => Promise<unknown>` | Fee surge detection and recommendations |
| `getFeeTrends` | `() => Promise<unknown>` | Fee trends over last 50 ledgers |

```typescript
const fees = await client.getFeeEstimate(2);
const surge = await client.getFeeSurgeStatus();
```

### Account (extended)

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `getAccountAge` | `(accountId: string) => Promise<AccountAgeResponse["data"]>` | Account age and longevity metrics |
| `getAccountXlmEquivalentBalances` | `(accountId: string) => Promise<unknown>` | Balances converted to XLM equivalents |
| `getAccountTrustlineHealth` | `(accountId: string) => Promise<unknown>` | Trustline health overview |
| `getAccountSequence` | `(accountId: string) => Promise<unknown>` | Current sequence number |
| `getAccountFreezeStatus` | `(accountId, assetCode, assetIssuer) => Promise<unknown>` | Asset freeze status on account |
| `getAccountCanReceive` | `(accountId, assetCode, assetIssuer) => Promise<unknown>` | Whether account can receive an asset |
| `getAccountInactivity` | `(accountId: string) => Promise<unknown>` | Days since last transaction |
| `getAccountSponsorship` | `(accountId: string) => Promise<unknown>` | Sponsorship structure |
| `getAccountSubentryHealth` | `(accountId: string) => Promise<unknown>` | Subentry usage vs protocol limit |
| `getAccountSummary` | `(accountId: string) => Promise<unknown>` | Consolidated account summary |
| `getAccountMergeEligibility` | `(accountId: string) => Promise<unknown>` | Whether account can be merged |
| `getAccountTimeline` | `(accountId, options?) => Promise<unknown>` | Unified chronological event timeline |
| `getAccountOperationBreakdown` | `(accountId: string) => Promise<unknown>` | Operation counts by type |
| `getAccountOfferHistory` | `(accountId, options?) => Promise<unknown>` | Historical offer operations |
| `getAccountVolume` | `(accountId, days?) => Promise<unknown>` | Volume by asset over N days |
| `validateAccountSigners` | `(accountId, signers: string[]) => Promise<unknown>` | Validate signer weight vs thresholds |
| `createMultisigPlan` | `(accountId, availableSigners: string[]) => Promise<unknown>` | Minimal signer combinations per threshold |
| `getEligibleClaimableBalances` | `(accountId: string) => Promise<unknown>` | Currently claimable balances |
| `getAccountData` | `(accountId: string) => Promise<unknown>` | All account data entries |
| `getAccountDataEntry` | `(accountId, key: string) => Promise<unknown>` | Single data entry by key |
| `searchAccountTransactions` | `(accountId, memo, options?) => Promise<TransactionSearchResponse["data"]>` | Search transactions by memo |
| `getAccountPoolPositions` | `(accountId: string) => Promise<PoolPositionsResponse["data"]>` | Liquidity pool share positions |
| `getAccountCounterparties` | `(accountId: string) => Promise<unknown>` | Top payment counterparties |

```typescript
const canReceive = await client.getAccountCanReceive(
  "GAAZI4...",
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);
console.log(canReceive.canReceive);
```

### Transactions

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `getTransactionHistory` | `(accountId, options?) => Promise<TransactionHistoryResponse["data"]>` | Paginated transaction history |
| `getTransactionOperations` | `(accountId, options?) => Promise<OperationHistoryResponse["data"]>` | Paginated operation history |
| `getBatchTransactionStatus` | `(hashes: string[]) => Promise<unknown>` | Confirmation status for up to 20 hashes |

```typescript
const txs = await client.getTransactionHistory("GAAZI4...", { limit: 50, order: "desc" });
const statuses = await client.getBatchTransactionStatus([txHash1, txHash2]);
```

### Assets

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `getAsset` | `(code, issuer) => Promise<AssetResponse["data"]>` | Asset metadata and statistics |
| `getAssetHolders` | `(code, issuer, options?) => Promise<unknown>` | Paginated asset holders |
| `getAssetDistribution` | `(code, issuer) => Promise<unknown>` | Holder distribution metrics |
| `getAssetSupply` | `(code, issuer) => Promise<unknown>` | Supply breakdown |
| `verifyAsset` | `(code, issuer) => Promise<unknown>` | Issuer verification via TOML |
| `searchAssets` | `(code, limit?) => Promise<AssetSearchResponse["data"]>` | Search assets by code |

```typescript
const usdc = await client.getAsset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
const matches = await client.searchAssets("USD", 10);
```

### DEX (unified client aliases)

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `getArbitragePaths` | `(assetCode, assetIssuer) => Promise<unknown>` | Circular arbitrage paths |
| `getDexSpread` | `(sellAsset, buyAsset) => Promise<unknown>` | Bid-ask spread for a pair |
| `getDexImbalance` | `(sellAsset, buyAsset) => Promise<unknown>` | Buy/sell pressure imbalance |
| `getDexDepth` | `(sellAsset, buyAsset) => Promise<unknown>` | Order book depth analysis |
| `getDexPrice` | `(sellAsset, buyAsset, amount?) => Promise<unknown>` | Effective exchange rate |

```typescript
const spread = await client.getDexSpread("XLM:native", "USDC:GA5Z...");
const price = await client.getDexPrice("XLM:native", "USDC:GA5Z...", 50);
```

Prefer **`DexModule`** for typed DEX responses when building TypeScript apps.

### Liquidity pools

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `getPoolProfitability` | `(poolId: string) => Promise<unknown>` | Annualized fee income estimate |
| `getPoolReserveRatio` | `(poolId: string) => Promise<unknown>` | Reserve ratio and drift |

```typescript
const profit = await client.getPoolProfitability(poolId);
const ratio = await client.getPoolReserveRatio(poolId);
```

### Claimable balances & utilities

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `evaluateClaimableBalance` | `(balanceId, accountId) => Promise<unknown>` | Evaluate claimability for an account |
| `fundAccount` | `(accountId: string) => Promise<unknown>` | Fund testnet account via Friendbot |
| `decodeMemo` | `(type, value) => Promise<unknown>` | Decode a Horizon memo |
| `base64` | `({ encode?, decode? }) => Promise<unknown>` | Base64 encode/decode helper |
| `validateAsset` | `(code: string) => Promise<unknown>` | Validate asset code format |
| `validateAccount` | `(accountId: string) => Promise<unknown>` | Validate public key format (no Horizon call) |
| `decodeXdr` | `(xdr: string) => Promise<unknown>` | Decode transaction XDR to JSON |
| `generateKeypair` | `() => Promise<unknown>` | Generate a random testnet keypair |
| `getStellarToml` | `(domain: string) => Promise<unknown>` | Fetch and parse `stellar.toml` |

```typescript
await client.fundAccount("GAAZI4...");
const decoded = await client.decodeXdr(base64Envelope);
const toml = await client.getStellarToml("stellar.org");
```

---

## Pagination

List endpoints accept optional query parameters:

| Parameter | Type     | Default | Description                    |
| --------- | -------- | ------- | ------------------------------ |
| `limit`   | `number` | `20`    | Page size (endpoint-specific max) |
| `order`   | `"asc" \| "desc"` | `"desc"` | Sort direction          |
| `cursor`  | `string` | —       | Paging token from prior response |

Paginated responses include `items`, `total`, `limit`, and `cursor` in the `data` payload.

---

## Cache bypass

Several API routes support server-side caching. Pass `fresh: true` (fees) or `?fresh=true` on the underlying HTTP request to bypass cache when using the unified client fee methods.

---

## Related documentation

- [Getting Started](getting-started.md) — run the API locally
- [API Design Guidelines](api-design.md) — response envelope, pagination, and error shapes
- [SDK README](../sdk/README.md) — JavaScript usage notes and browser setup
