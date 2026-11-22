# Security, Documentation, and Type Safety Improvements

This PR implements four critical improvements to the StellarKit API: fuzz testing for validators, ready-to-run request collections, Soroban contract ID derivation, and SDK type-level testing.

## Changes

### Issue #1251: Fuzz and ReDoS checks for validators

**Problem**: Validators run on hostile input and must never crash or exhibit catastrophic backtracking on large inputs.

**Solution**: 
- Added comprehensive fuzz tests using `fast-check` library
- Tests cover all exported validators in `src/utils/validators.js`
- Validates handling of Unicode, null bytes, control characters, and 100KB inputs
- Enforces 50ms execution time limit to catch ReDoS vulnerabilities
- All validators tested against arbitrary inputs without crashes
- Typed validation errors ensure consistent error handling

**Files Added**:
- `tests/security/validators.fuzz.test.js` - Comprehensive fuzz test suite

**Dependencies Added**:
- `fast-check@^3.22.0` - Property-based testing library for fuzzing

**Test Coverage**:
- 13 validators tested with 1000+ random inputs each
- Unicode and special character handling
- Large input performance validation (100KB strings)
- Adversarial pattern detection
- Null/undefined handling

---

### Issue #1252: Ready-to-run request collections

**Problem**: Developers waste time writing curl commands from scratch when trying API endpoints.

**Solution**:
- Created Postman collection with 42 requests covering all major endpoint groups
- Added testnet and mainnet environment files with pre-configured variables
- Created .http files for VS Code REST Client and JetBrains HTTP Client
- All requests use `{{baseUrl}}` variable for portability
- Postman requests include test scripts asserting `success: true`
- Collection validator script ensures JSON validity and standards compliance

**Files Added**:
- `examples/collections/stellarkit-api.postman_collection.json` - Complete Postman collection
- `examples/collections/testnet.postman_environment.json` - Testnet environment variables
- `examples/collections/mainnet.postman_environment.json` - Mainnet environment variables
- `examples/http/account.http` - Account endpoint requests
- `examples/http/dex.http` - DEX endpoint requests
- `examples/http/network.http` - Network endpoint requests
- `examples/http/soroban.http` - Soroban smart contract requests
- `examples/http/utils.http` - Utility endpoint requests
- `examples/http/assets.http` - Asset endpoint requests
- `scripts/validate-collections.js` - Collection validator script
- `tests/utils/validate-collections.test.js` - Validator tests

**Endpoint Groups**:
- **Account** (18 requests): Info, balances, payments, transactions, operations, trades, signers, risk, multisig, pool positions, sponsorships, claimable balances, timeline, transaction count
- **DEX** (8 requests): Orderbook, spread, depth, top markets, trades, price history, arbitrage, imbalance
- **Network** (9 requests): Status, fee estimate, recommended fee, base fee, percentiles, ledger stats, timing, protocol version, validators
- **Soroban** (5 requests): Contract info, storage, functions, expiry, simulation
- **Utils** (13 requests): Validate account/asset/hash, convert XLM/stroops, network passphrase, keypair, memo decode/validate, base64, ledger date, decode transaction/XDR, simulate payment, asset contract ID
- **Assets** (8 requests): Asset info, price, price history, holders, distribution, overview, by issuer, by code
- **Health** (1 request): Health check

**Variables**:
- `{{baseUrl}}` - API base URL
- `{{account}}` - Sample Stellar account
- `{{assetCode}}` - Sample asset code (USDC)
- `{{assetIssuer}}` - Sample asset issuer
- `{{apiKey}}` - Optional API key

**Validation**:
```bash
node scripts/validate-collections.js
```

Checks:
- ✓ Valid JSON structure
- ✓ All requests use `{{baseUrl}}`
- ✓ Unique request names
- ✓ No literal API keys
- ✓ Required environment variables present

---

### Issue #1253: GET /utils/asset-contract-id

**Problem**: Computing Soroban contract IDs for Stellar assets requires the SDK and correct network passphrase.

**Solution**:
- New endpoint derives deterministic contract addresses for any Stellar asset
- Supports native XLM and credit assets (CODE:ISSUER format)
- Optional `network` parameter overrides configured network
- Returns asset, contractId, network, and networkPassphrase
- Comprehensive validation of asset format and issuer addresses

**Endpoint**:
```
GET /utils/asset-contract-id?asset=XLM
GET /utils/asset-contract-id?asset=USDC:GA5ZSEJYB...&network=mainnet
```

**Response**:
```json
{
  "success": true,
  "data": {
    "asset": "XLM",
    "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "network": "testnet",
    "networkPassphrase": "Test SDF Network ; September 2015"
  }
}
```

**Files Added**:
- `src/routes/utils.js` - Added new endpoint
- `tests/utils/asset-contract-id.test.js` - Comprehensive endpoint tests

**Test Coverage**:
- Native XLM on testnet and mainnet
- Different contract IDs for different networks
- Credit assets with valid issuers
- Network override parameter
- Invalid asset format rejection
- Overlong asset codes
- Invalid issuer addresses
- Unknown network values
- Various asset code lengths (1-12 chars)
- Case-insensitive XLM handling

---

### Issue #1254: SDK type-level tests

**Problem**: Type regressions in the SDK are silent until a consumer's build breaks.

**Solution**:
- Added `tsd` for compile-time type testing
- Created comprehensive type tests for public API methods
- Tests verify return types, parameter types, and error shapes
- Validates that options objects reject unknown keys
- Includes deliberate failure fixture to prove type checking works

**Files Added**:
- `sdk/tests/types/client.test-d.ts` - Client method type tests
- `sdk/tests/types/responses.test-d.ts` - Response type tests
- `sdk/tests/types/deliberate-failure.test-d.ts` - Failure fixture
- `sdk/tsd.json` - TSD configuration

**Script Added**:
```json
"test:types": "tsd --files 'sdk/tests/types/**/*.test-d.ts'"
```

**Dependencies Added**:
- `tsd@^0.31.0` - TypeScript definition testing

**Type Tests**:
- ✓ Client constructor requires baseUrl
- ✓ Return types for 15+ public methods
- ✓ StellarKitError shape (type, message, status)
- ✓ Union types (risk levels: low | medium | high | unknown)
- ✓ Options objects reject unknown keys
- ✓ Readonly properties enforcement
- ✓ Response data structure validation
- ✗ Deliberately wrong assertion proves checker works

**Running Type Tests**:
```bash
npm run test:types
```

The deliberate failure fixture ensures the type checker actually catches errors rather than passing everything.

---

## Testing

All features include comprehensive test coverage:

```bash
# Run all tests including new fuzz tests
npm test

# Run type-level tests
npm run test:types

# Validate Postman collections
node scripts/validate-collections.js
```

---

## Documentation Updates

- README updated with links to request collections
- Collection files include inline documentation
- .http files include example variables
- Type definitions ensure SDK autocomplete works correctly

---

## Breaking Changes

None. All changes are additive.

---

## Closes

- Closes #1251
- Closes #1252
- Closes #1253
- Closes #1254
