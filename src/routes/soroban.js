const express = require("express");
const router = express.Router();

const { Contract, scValToNative, xdr } = require("@stellar/stellar-sdk");
const { sorobanServer, NETWORK } = require("../config/stellar");
const { validateContractId, validateLimit } = require("../utils/validators");
const { success } = require("../utils/response");
const { fetchContractDeployment } = require("../utils/contractDeployment");
const StellarKitError = require("../utils/StellarKitError");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");
const { parseFunctionsFromWasm } = require("../utils/contractSpec");

const EXECUTABLE_TYPES = {
  contractExecutableWasm: "wasm",
  contractExecutableStellarAsset: "stellar_asset",
};

/**
 * Recursively converts scValToNative() output into JSON-safe values:
 * BigInt (from u64/i128/u256 etc.) -> string, Buffer (from bytes) -> hex string.
 */
function toJsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

/**
 * Decodes an ScVal to a clean native value where possible, falling back to
 * the raw base64 XDR (tagged as such) if decoding fails.
 */
function decodeScVal(scVal) {
  try {
    return { value: toJsonSafe(scValToNative(scVal)), type: "decoded" };
  } catch {
    return { value: scVal.toXDR("base64"), type: "raw" };
  }
}

function requireSorobanServer() {
  if (!sorobanServer) {
    throw new StellarKitError(
      "Soroban RPC is not configured for this network.",
      500,
      "ConfigError",
      null,
      "Set SOROBAN_RPC_URL to a reachable Soroban RPC endpoint."
    );
  }
  return sorobanServer;
}

async function loadContractInstanceEntry(contractId) {
  const rpcServer = requireSorobanServer();
  const footprint = new Contract(contractId).getFootprint();
  const response = await rpcServer.getLedgerEntries(footprint);

  if (!response.entries || response.entries.length === 0) {
    throw new StellarKitError(
      `Contract ${contractId} was not found on the Stellar ${NETWORK} network.`,
      404,
      "ContractNotFound",
      null,
      "Verify the contract ID is correct and that the contract has been deployed."
    );
  }

  return response.entries[0];
}

async function loadContractWasm(wasmHash) {
  const rpcServer = requireSorobanServer();
  const codeKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: wasmHash }),
  );
  const response = await rpcServer.getLedgerEntries(codeKey);
  if (!response.entries || response.entries.length === 0) {
    return null;
  }

  const code = response.entries[0].val.contractCode().code();
  return Buffer.isBuffer(code) ? code : Buffer.from(code);
}

/**
 * GET /soroban/contract/:id/functions
 *
 * Returns the contract's exported function signatures parsed from its WASM ABI
 * (the `contractspecv0` custom section). Stellar Asset Contracts and WASM
 * binaries with no spec entries return an empty functions array.
 *
 * Response is cached for 60 seconds.
 */
router.get("/contract/:id/functions", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);

    const cacheKey = `contract-functions:${id}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }

    const entry = await loadContractInstanceEntry(id);
    const instance = entry.val.contractData().val().instance();
    const executable = instance.executable();
    const executableTypeName = executable.switch().name;
    const executableType = EXECUTABLE_TYPES[executableTypeName] || executableTypeName;

    let functions = [];
    if (executableType === "wasm") {
      const wasmBytes = await loadContractWasm(executable.wasmHash());
      if (wasmBytes) {
        functions = parseFunctionsFromWasm(wasmBytes);
      }
    }

    const data = { functions };
    cacheService.set(cacheKey, data, cacheTTL.contractFunctions);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /soroban/contract/:id
 * Returns contract instance details: executable type/wasm hash and ledger metadata.
 */
router.get("/contract/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);

    const rpcServer = requireSorobanServer();
    const [entry, deployment, latestLedger] = await Promise.all([
      loadContractInstanceEntry(id),
      fetchContractDeployment(id),
      rpcServer.getLatestLedger(),
    ]);

    const instance = entry.val.contractData().val().instance();
    const executable = instance.executable();
    const executableTypeName = executable.switch().name;
    const executableType = EXECUTABLE_TYPES[executableTypeName] || executableTypeName;
    const wasmHash =
      executableType === "wasm" ? executable.wasmHash().toString("hex") : null;
    const expiryLedger = entry.liveUntilLedgerSeq ?? null;
    const currentLedger = latestLedger.sequence;
    const isExpired =
      expiryLedger !== null && typeof currentLedger === "number" && currentLedger > expiryLedger;

    return success(res, {
      contractId: id,
      wasmHash,
      deployer: deployment.deployer,
      deployedAt: deployment.deployedAt,
      deployedLedger: deployment.deployedLedger,
      isExpired,
      executable: {
        type: executableType,
        wasmHash,
      },
      lastModifiedLedger: entry.lastModifiedLedgerSeq,
      expiryLedger,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /soroban/contract/:id/storage
 *
 * Returns the contract's persistent instance-storage entries — the key/value
 * map embedded inside the ContractInstance ledger entry. This is the only
 * form of contract storage that is directly enumerable without a full ledger
 * indexer. See docs/soroban.md for background on storage types.
 *
 * Path param:
 *   - id: Soroban contract address (C... address, 56 chars)
 *
 * Query params:
 *   - limit  (number, 1–50, default: 50) — Maximum number of entries to return.
 *   - fresh  ("true") — Bypass the cache and force a live RPC fetch.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       entries: [
 *         {
 *           key:               <decoded ScVal or raw base64 XDR>,
 *           value:             <decoded ScVal or raw base64 XDR>,
 *           lastModifiedLedger: <number>,
 *           expiryLedger:      <number | null>
 *         }
 *       ],
 *       total: <number>   // total entries in instance storage (before limit)
 *     }
 *   }
 *
 * Errors:
 *   400 — invalid contract ID or invalid limit value
 *   404 — contract not found on the network
 *   500 — Soroban RPC not configured (SOROBAN_RPC_URL missing)
 *
 * @example
 * GET /soroban/contract/CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2/storage?limit=10
 */
router.get("/contract/:id/storage", async (req, res, next) => {
  try {
    const { id } = req.params;

    // ── 1. Validate inputs ──────────────────────────────────────────────────
    validateContractId(id);

    // limit: 1–50, default 50. validateLimit throws a structured 400 on failure.
    const rawLimit = req.query.limit !== undefined ? req.query.limit : 50;
    const limit = validateLimit(rawLimit, 50);

    const fresh = req.query.fresh === "true";

    // ── 2. Cache check ──────────────────────────────────────────────────────
    const cacheKey = `contract-storage:${id}:${limit}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // ── 3. Fetch from Soroban RPC ───────────────────────────────────────────
    // loadContractInstanceEntry throws a structured 404 (StellarKitError) when
    // the contract does not exist, and a 500 when the RPC server is not configured.
    const entry = await loadContractInstanceEntry(id);
    const instance = entry.val.contractData().val().instance();
    const storageMap = instance.storage() || [];

    // total reflects the full number of instance-storage entries before slicing
    const total = storageMap.length;

    // ── 4. Normalise entries ────────────────────────────────────────────────
    const entries = storageMap.slice(0, limit).map((mapEntry) => {
      const { value: key } = decodeScVal(mapEntry.key());
      const { value, type } = decodeScVal(mapEntry.val());
      return {
        key,
        value,
        lastModifiedLedger: entry.lastModifiedLedgerSeq,
        expiryLedger: entry.liveUntilLedgerSeq ?? null,
      };
    });

    // ── 5. Cache and respond ────────────────────────────────────────────────
    const data = { entries, total };

    cacheService.set(cacheKey, data, cacheTTL.contractStorage);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /soroban/contract/:id/expiry
 *
 * Returns the expiry ledger for a Soroban contract instance, whether it is at
 * risk of expiring soon, and an estimated time remaining in seconds.
 *
 * Soroban contract instances expire when their live-until ledger is reached
 * unless the owner extends the TTL via a RestoreFootprint or ExtendFootprintTTL
 * operation. This endpoint exposes the information needed for wallet UIs,
 * monitoring dashboards, and automated renewal tooling.
 *
 * Path param:
 *   - id: Soroban contract address (C... address, 56 chars)
 *
 * Query params:
 *   - fresh ("true") — Bypass the cache and force a live RPC fetch.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       contractId:                    string,  // C... address
 *       expiryLedger:                  number,  // liveUntilLedgerSeq
 *       currentLedger:                 number,  // latest ledger on-chain
 *       ledgersRemaining:              number,  // expiryLedger - currentLedger (≥ 0)
 *       estimatedTimeRemainingSeconds: number,  // ledgersRemaining × avg close time
 *       isExpiringSoon:                boolean  // true when ledgersRemaining < 10 000
 *     }
 *   }
 *
 * Errors:
 *   400 — invalid contract ID
 *   404 — contract not found (not deployed or already expired/deleted)
 *   500 — Soroban RPC not configured (SOROBAN_RPC_URL missing)
 *
 * Cache TTL: 30 seconds (configurable via CACHE_TTL_CONTRACT_EXPIRY_MS)
 *
 * @example
 * GET /soroban/contract/CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2/expiry
 */

/** Ledger threshold below which a contract is considered "expiring soon". */
const EXPIRING_SOON_THRESHOLD = 10000;

/** Average Stellar ledger close time in seconds (≈ 5 s per ledger). */
const AVG_LEDGER_CLOSE_TIME_SECONDS = 5;

/** Cache TTL for the /expiry endpoint (seconds). Default: 30 s. */
const CONTRACT_EXPIRY_CACHE_TTL = Math.max(
  1,
  Math.floor(
    (parseInt(process.env.CACHE_TTL_CONTRACT_EXPIRY_MS, 10) || 30000) / 1000
  )
);

router.get("/contract/:id/expiry", async (req, res, next) => {
  try {
    const { id } = req.params;

    // ── 1. Validate input ────────────────────────────────────────────────────
    validateContractId(id);

    // coerceQueryParams converts "true" → true (boolean), so handle both forms
    const fresh = req.query.fresh === true || req.query.fresh === "true";

    // ── 2. Cache check ───────────────────────────────────────────────────────
    const cacheKey = `contract-expiry:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // ── 3. Fetch from Soroban RPC ────────────────────────────────────────────
    const rpcServer = requireSorobanServer();

    // loadContractInstanceEntry throws a structured 404 (StellarKitError) when
    // the contract does not exist or has already been evicted from the ledger.
    const entry = await loadContractInstanceEntry(id);

    // expiryLedger may be null for contracts with no TTL (e.g. stellar asset contracts)
    const expiryLedger = entry.liveUntilLedgerSeq ?? null;

    // Fetch the latest ledger sequence so we can compute how many ledgers remain
    const latestLedgerResponse = await rpcServer.getLatestLedger();
    const currentLedger = latestLedgerResponse.sequence;

    // ── 4. Compute derived fields ────────────────────────────────────────────
    const ledgersRemaining =
      expiryLedger !== null ? Math.max(0, expiryLedger - currentLedger) : null;

    const estimatedTimeRemainingSeconds =
      ledgersRemaining !== null
        ? ledgersRemaining * AVG_LEDGER_CLOSE_TIME_SECONDS
        : null;

    const isExpiringSoon =
      ledgersRemaining !== null && ledgersRemaining < EXPIRING_SOON_THRESHOLD;

    // ── 5. Build response ────────────────────────────────────────────────────
    const data = {
      contractId: id,
      expiryLedger,
      currentLedger,
      ledgersRemaining,
      estimatedTimeRemainingSeconds,
      isExpiringSoon,
    };

    // ── 6. Cache and respond ─────────────────────────────────────────────────
    cacheService.set(cacheKey, data, CONTRACT_EXPIRY_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
