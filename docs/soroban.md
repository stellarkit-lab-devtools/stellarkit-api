# Soroban Contract Endpoints

This guide covers StellarKit API's Soroban endpoints: `GET /soroban/contract/:id`, `GET /soroban/contract/:id/storage`, and `GET /soroban/contract/:id/functions`. It explains what Soroban is, how contract IDs work, what each response field means, and how to use the endpoints to debug a deployed contract.

## What is Soroban?

Soroban is Stellar's smart contract platform. Unlike traditional Stellar operations — payments, trustline changes, account settings — which are fixed, built-in ledger operations, a Soroban contract is a small program (compiled to WebAssembly, or "WASM") that runs on the Stellar network and can implement arbitrary logic: token contracts, AMMs, escrow, governance, and so on.

A deployed contract lives on the ledger as a **contract instance**. That instance record holds two things:

- **Executable** — either a reference to the contract's compiled WASM code (identified by its **WASM hash**, the SHA-256 digest of the binary), or, for tokens created via the classic Stellar asset model, a built-in "Stellar Asset Contract" executable with no separate WASM code.
- **Instance storage** — a small key/value map the contract can use to store data directly on its own instance record (via the contract SDK's `env.storage().instance()` API). This is the one form of contract storage these endpoints can list — see [Contract storage entries](#contract-storage-entries) below.

## Contract IDs

A Soroban contract is referenced by its **contract ID** — a StrKey-encoded address starting with `C`, e.g.:

```
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

This is analogous to a Stellar account's `G...` public key, but it identifies a contract instance rather than an account. You get a contract ID when you deploy a contract (or, for classic assets, it's deterministically derived from the asset code and issuer — the example above is the native XLM Stellar Asset Contract on testnet).

Both endpoints below validate that `:id` is a well-formed contract address before doing anything else, and return `400 ValidationError` if it isn't.

## `GET /soroban/contract/:id`

Returns the contract's instance-level details: its executable type, WASM hash (if applicable), and ledger metadata.

### Example request

```bash
curl https://your-stellarkit-instance.example.com/soroban/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

### Example response

```json
{
  "success": true,
  "data": {
    "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "wasmHash": null,
    "deployer": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "deployedAt": "2024-06-01T12:00:00.000Z",
    "deployedLedger": 689,
    "isExpired": false,
    "executable": {
      "type": "stellar_asset",
      "wasmHash": null
    },
    "lastModifiedLedger": 689,
    "expiryLedger": 6549127
  }
}
```

### Response fields

| Field | Description |
| --- | --- |
| `contractId` | The contract address you queried. |
| `wasmHash` | Top-level hex-encoded SHA-256 hash of the contract's WASM binary (64 characters), or `null` for Stellar Asset Contract executables. |
| `deployer` | Stellar account (`G...`) that deployed the contract, or `null` if deployment metadata is unavailable. |
| `deployedAt` | ISO 8601 timestamp of the deployment transaction, or `null` when unknown. |
| `deployedLedger` | Ledger sequence number in which the contract was deployed, or `null` when unknown. |
| `isExpired` | `true` when the current ledger is past `expiryLedger`; otherwise `false`. |
| `executable.type` | `"wasm"` for a contract backed by uploaded WASM code, or `"stellar_asset"` for the built-in Stellar Asset Contract executable used by classic Stellar assets. |
| `executable.wasmHash` | Same as top-level `wasmHash` — the hex-encoded SHA-256 hash of the contract's WASM binary, or `null` when `executable.type` is `"stellar_asset"`. |
| `lastModifiedLedger` | The ledger sequence number the instance entry was last written in. |
| `expiryLedger` | The ledger sequence number until which the instance entry is guaranteed to stay live on the ledger (its TTL), or `null` if unavailable. Once the network passes this ledger, the entry is archived and must be restored before it can be read or invoked again. |

### Contract not found

If no contract exists at that address, you get a `404`:

```json
{
  "success": false,
  "error": {
    "type": "ContractNotFound",
    "message": "Contract CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L was not found on the Stellar testnet network.",
    "suggestion": "Verify the contract ID is correct and that the contract has been deployed."
  }
}
```

## `GET /soroban/contract/:id/storage`

Returns the contract's **instance storage** entries — the key/value pairs the contract has stored directly on its own instance record.

### Query parameters

| Param | Default | Description |
| --- | --- | --- |
| `limit` | `50` | Maximum number of entries to return (1–200). |
| `fresh` | `false` | Set to `true` to bypass the cache and fetch directly from the Soroban RPC server. |

### Example request

```bash
curl "https://your-stellarkit-instance.example.com/soroban/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC/storage"
```

### Example response

```json
{
  "success": true,
  "data": {
    "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "entries": [
      {
        "key": "METADATA",
        "value": { "decimal": 7, "name": "native", "symbol": "native" },
        "type": "decoded"
      },
      {
        "key": ["AssetInfo"],
        "value": ["Native"],
        "type": "decoded"
      }
    ],
    "lastModifiedLedger": 689,
    "expiryLedger": 6549127
  }
}
```

The response also carries an `X-Cache: HIT` or `X-Cache: MISS` header so you can see whether a given response came from cache (see [Caching](#caching) below).

### Response fields

| Field | Description |
| --- | --- |
| `contractId` | The contract address you queried. |
| `entries[].key` / `entries[].value` | The decoded storage key and value. Soroban values (`ScVal`) are decoded into plain JSON — strings, numbers, booleans, objects, and arrays. 64-bit and 128-bit integers are returned as numeric strings (they don't fit safely in a JSON number), and raw byte values are returned as hex strings. |
| `entries[].type` | `"decoded"` when the key/value were successfully converted to native JSON, or `"raw"` when decoding failed and the raw base64 XDR is returned instead as a fallback. |
| `lastModifiedLedger` | Ledger sequence number the instance entry (and therefore its storage) was last written in. |
| `expiryLedger` | Ledger sequence number until which the entry stays live, or `null` if unavailable. |

### Contract storage entries

Soroban gives contracts three kinds of key-value storage: **instance**, **persistent**, and **temporary**. The important distinction for this endpoint is how each is stored on the ledger:

- **Instance storage** lives *inside* the contract's own `ContractInstance` ledger entry, as a small embedded map. Because it's part of the entry you already have to fetch to look up the contract at all, it's fully enumerable — this is what `/soroban/contract/:id/storage` returns.
- **Persistent** and **temporary** storage are each stored as their own *separate* ledger entries, addressed by an arbitrary key the contract chooses. The Stellar ledger (and the Soroban RPC API) is a key-value lookup, not an index — there is no RPC call that lists "every persistent/temporary entry belonging to contract X" without already knowing the keys. Building that would require replaying ledger history or running a dedicated indexer, which is out of scope for this endpoint.

In practice, contracts that keep small amounts of config, metadata, or admin state (token metadata, feature flags, an admin address) often use instance storage, exactly like the native asset contract example above. Contracts with large or per-user datasets (balances, allowances) generally use persistent storage instead, which this endpoint won't show.

### Caching

Contract storage only changes when the contract executes a state-changing transaction, so responses are cached in memory, keyed by contract ID and `limit`:

- Default TTL: 15 seconds, configurable via `CACHE_TTL_CONTRACT_STORAGE_MS` (milliseconds) in your `.env`.
- Every response includes an `X-Cache` header (`HIT` or `MISS`).
- Pass `?fresh=true` to bypass the cache and force a fresh RPC fetch (the fresh result is still written back to the cache).

```bash
# First call: MISS, fetched from RPC
curl -i "https://your-stellarkit-instance.example.com/soroban/contract/<id>/storage" | grep -i x-cache
# X-Cache: MISS

# Second call within the TTL window: HIT, served from cache
curl -i "https://your-stellarkit-instance.example.com/soroban/contract/<id>/storage" | grep -i x-cache
# X-Cache: HIT

# Force a fresh fetch regardless of cache state
curl -i "https://your-stellarkit-instance.example.com/soroban/contract/<id>/storage?fresh=true" | grep -i x-cache
# X-Cache: MISS
```

## `GET /soroban/contract/:id/functions`

Returns the contract's exported function signatures parsed from its WASM ABI (`contractspecv0`). Use this before building invoke transactions so you know function names, parameter types, and return types.

Stellar Asset Contracts and WASM binaries with no exported functions return an empty `functions` array rather than an error. Missing contracts return `404 ContractNotFound`. Responses are cached for 60 seconds (`CACHE_TTL_CONTRACT_FUNCTIONS_MS`).

### Example request

```bash
curl https://your-stellarkit-instance.example.com/soroban/contract/CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2/functions
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
          { "name": "from", "type": "Address" },
          { "name": "to", "type": "Address" },
          { "name": "amount", "type": "I128" }
        ],
        "returnType": "Void"
      },
      {
        "name": "balance",
        "params": [{ "name": "id", "type": "Address" }],
        "returnType": "I128"
      }
    ]
  }
}
```

## Configuration

These endpoints require a reachable Soroban RPC server, configured via `SOROBAN_RPC_URL`:

```env
# Testnet default (used automatically if unset): https://soroban-testnet.stellar.org
# Mainnet has no free SDF-hosted RPC — you must set your own provider URL
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

If `SOROBAN_RPC_URL` is unset and `STELLAR_NETWORK=mainnet`, these endpoints return a `500 ConfigError` telling you to set it.
