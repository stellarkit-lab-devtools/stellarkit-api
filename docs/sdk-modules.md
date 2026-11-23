# SDK modules

The StellarKit TypeScript SDK is organised into focused modules. See
[`docs/sdk.md`](sdk.md) for the full client reference.

| Module | Source | Wrapped endpoints |
| ------ | ------ | ----------------- |
| `AccountModule` | `sdk/account.ts` | `/account/*`, `/accounts/*` |
| `DexModule` | `sdk/dex.ts` | `/dex/*` |
| `FeesModule` | `sdk/fees.ts` | `/fee-estimate/*`, `/network/fee-percentiles` |
| `NetworkModule` | `sdk/network.ts` | `/network/*` |
| `UtilsModule` | `sdk/utils.ts` | `/utils/*` (selected endpoints) |
| `StellarKitClient` | `sdk/stellarkit-client.ts` | Unified client |

All modules accept `{ baseUrl, apiKey? }` and throw `StellarKitError` with
`status` and `type` fields on non-2xx responses.

## UtilsModule

```ts
import { UtilsModule } from "stellarkit-sdk/utils";

const utils = new UtilsModule({
  baseUrl: "https://api.example.com",
  apiKey: process.env.STELLARKIT_API_KEY,
  network: "testnet", // "mainnet" disables Friendbot
});

const converted = await utils.convert({ xlm: "1.5" });   // { xlm, stroops }
const account = await utils.validateAccount("GABC...");   // { input, isValid, reason }
const asset = await utils.validateAsset("USDC");          // { input, isValid, assetType, reason }
const date = await utils.ledgerDate(1234567);             // { sequence, estimatedDate, note }
const decoded = await utils.decodeXdr("AAAA...");        // { sourceAccount, operations, ... }
const funded = await utils.fundTestnetAccount("GABC..."); // { accountId, message, transaction }
```

Every method has an explicit return interface (`ConvertResult`,
`ValidateAccountResult`, `ValidateAssetResult`, `LedgerDateResult`,
`DecodeXdrResult`, `FundTestnetAccountResult`) and JSDoc with `@example`.
`fundTestnetAccount()` throws `MainnetNotSupportedError` (a typed
`StellarKitError` with `type: "MainnetNotSupported"` and status 403) when the
client is configured for `mainnet`/`public`.

### Why `/utils/keypair` is excluded

`UtilsModule` deliberately does **not** wrap `GET /utils/keypair`. Generating a
secret key on a remote server means the private key exists outside the
caller's trust boundary and may be logged, cached, or intercepted in transit.
Secrets should be generated locally, for example:

```ts
import { Keypair } from "@stellar/stellar-sdk";
const keypair = Keypair.random(); // publicKey + secretKey stay on this device
```

The server endpoint remains available for backwards compatibility and local
development, but it is not part of the typed SDK surface.
