const express = require("express");
const router = express.Router();

const { scValToNative, xdr, TransactionBuilder, Networks, Operation, Contract, nativeToScVal, Account } = require("@stellar/stellar-sdk");
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

  let response;
  try {
    response = await rpcServer.getContractData(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance(),
    );
  } catch (err) {
    if (err && /not found/i.test(err.message)) {
      throw new StellarKitError(
        `Contract ${contractId} was not found on the Stellar ${NETWORK} network.`,
        404,
        "ContractNotFound",
        null,
        "Verify the contract ID is correct and that the contract has been deployed."
      );
    }
    throw err;
  }

  if (!response || !response.contractData) {
    throw new StellarKitError(
      `Contract ${contractId} was not found on the Stellar ${NETWORK} network.`,
      404,
      "ContractNotFound",
      null,
      "Verify the contract ID is correct and that the contract has been deployed."
    );
  }

  const contractData = response.contractData;
  const contractDataEntry =
    contractData.xdr instanceof xdr.ContractDataEntry
      ? contractData.xdr
      : xdr.ContractDataEntry.fromXDR(contractData.xdr, "base64");

  return {
    val: xdr.LedgerEntryData.contractData(contractDataEntry),
    lastModifiedLedgerSeq: contractData.lastModifiedLedgerSeq ?? null,
    liveUntilLedgerSeq: contractData.liveUntilLedgerSeq ?? null,
  };
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
 * Ledger window scanned for cross-contract call history (~24h at 5s/ledger).
 */
const CONTRACT_DEPENDENCIES_LEDGER_WINDOW = 17280;

/** Cache TTL (seconds) for the /dependencies endpoint. */
const CONTRACT_DEPENDENCIES_CACHE_TTL = 60;

/** Max number of getEvents pages to walk to avoid unbounded loops. */
const CONTRACT_DEPENDENCIES_MAX_PAGES = 10;

/**
 * Decodes a getEvents topic entry (either a parsed ScVal or a base64 XDR
 * string) into its native JS value.
 */
function decodeEventTopic(topic) {
  const scVal =
    topic instanceof xdr.ScVal ? topic : xdr.ScVal.fromXDR(topic, "base64");
  return scValToNative(scVal);
}

/**
 * Inspects a Soroban diagnostic event and, when it represents a cross-contract
 * `fn_call`, returns the callee contract ID. Returns null otherwise.
 *
 * Diagnostic `fn_call` events are emitted by the *calling* contract with topics
 * [ "fn_call", <callee contract address>, <function symbol> ], so the event's
 * source contract is the caller and topics[1] is the contract being called.
 */
function extractCallDependency(event, sourceContractId) {
  try {
    const topics = event.topic || event.topics || [];
    if (topics.length < 2) return null;
    if (decodeEventTopic(topics[0]) !== "fn_call") return null;

    const calleeRaw = decodeEventTopic(topics[1]);
    const callee = typeof calleeRaw === "string" ? calleeRaw : String(calleeRaw);
    if (!callee || callee === sourceContractId) return null;

    return callee;
  } catch {
    return null;
  }
}

/**
 * Walks the contract's diagnostic-event history and aggregates the other
 * contracts it has invoked, tracking call frequency and the most recent call.
 *
 * Returns an array of { contractId, callCount, lastCallLedger, lastCallAt }.
 */
async function loadContractDependencies(contractId) {
  const rpcServer = requireSorobanServer();
  const { sequence: latestLedger } = await rpcServer.getLatestLedger();
  const startLedger = Math.max(
    1,
    latestLedger - CONTRACT_DEPENDENCIES_LEDGER_WINDOW,
  );

  const dependencies = new Map();
  let cursor = null;
  let pages = 0;

  do {
    const request = cursor
      ? { cursor, filters: [{ type: "diagnostic", contractIds: [contractId] }] }
      : {
          startLedger,
          filters: [{ type: "diagnostic", contractIds: [contractId] }],
        };

    const response = await rpcServer.getEvents(request);
    const events = response.events || [];

    for (const event of events) {
      const callee = extractCallDependency(event, contractId);
      if (!callee) continue;

      const ledger = event.ledger ?? null;
      const at = event.ledgerClosedAt ?? null;
      const existing = dependencies.get(callee);

      if (existing) {
        existing.callCount += 1;
        if (
          ledger !== null &&
          (existing.lastCallLedger === null || ledger > existing.lastCallLedger)
        ) {
          existing.lastCallLedger = ledger;
          existing.lastCallAt = at;
        }
      } else {
        dependencies.set(callee, {
          contractId: callee,
          callCount: 1,
          lastCallLedger: ledger,
          lastCallAt: at,
        });
      }
    }

    cursor = events.length > 0 ? events[events.length - 1].pagingToken : null;
    pages += 1;
  } while (cursor && pages < CONTRACT_DEPENDENCIES_MAX_PAGES);

  return Array.from(dependencies.values());
}

function parseLedgerSequenceParam(rawLedger, fieldName = "ledger") {
  if (rawLedger === undefined || rawLedger === null || String(rawLedger).trim() === "") {
    const err = new Error(`Query parameter '${fieldName}' is required.`);
    err.isValidation = true;
    err.status = 400;
    err.field = fieldName;
    throw err;
  }

  const ledger = Number(rawLedger);
  if (!Number.isInteger(ledger) || ledger <= 0) {
    const err = new Error(`Query parameter '${fieldName}' must be a positive integer.`);
    err.isValidation = true;
    err.status = 400;
    err.field = fieldName;
    err.receivedValue = rawLedger;
    throw err;
  }

  return ledger;
}

async function loadContractInstanceEntryAtLedger(contractId, ledger) {
  const entry = await loadContractInstanceEntry(contractId);
  const lastModifiedLedger = entry.lastModifiedLedgerSeq ?? null;

  if (lastModifiedLedger !== null && ledger < lastModifiedLedger) {
    throw new StellarKitError(
      `Contract ${contractId} did not exist on the Stellar ${NETWORK} network at ledger ${ledger}.`,
      404,
      "ContractNotFound",
      null,
      "Verify the contract ID and ledger sequence are correct."
    );
  }

  return entry;
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
    const [entry, latestLedger] = await Promise.all([
      loadContractInstanceEntry(id),
      rpcServer.getLatestLedger(),
    ]);

    let deployment = {};
    try {
      deployment = (await fetchContractDeployment(id)) || {};
    } catch (err) {
      deployment = {};
    }

    const instance = entry.val.contractData().val().instance();
    const executable = instance.executable();
    const executableTypeName = executable.switch().name;
    const executableType = EXECUTABLE_TYPES[executableTypeName] || executableTypeName;
    const wasmHash =
      executableType === "wasm" ? executable.wasmHash().toString("hex") : null;
    let deployer = null;
    let deployedLedger = null;
    let deployedAt = null;

    if (wasmHash) {
      const codeEntry = await loadContractCodeEntry(wasmHash);
      if (codeEntry) {
        const ext = codeEntry.ext;
        const extensionV1 =
          ext && typeof ext.switch === "function" && ext.switch() === 1 && typeof ext.v1 === "function"
            ? ext.v1()
            : null;
        const sponsoringId =
          extensionV1 && typeof extensionV1.sponsoringId === "function"
            ? extensionV1.sponsoringId()
            : null;
        deployer = sponsoringId ? sponsoringId.toString() : null;
        deployedLedger = codeEntry.lastModifiedLedgerSeq ?? null;
      }
    }

    deployer = deployer ?? deployment.deployer ?? null;
    deployedLedger = deployedLedger ?? deployment.deployedLedger ?? null;
    deployedAt = deployment.deployedAt ?? null;

    const expiryLedger = entry.liveUntilLedgerSeq ?? null;
    const currentLedger = latestLedger.sequence;
    const isExpired =
      expiryLedger !== null && typeof currentLedger === "number" && currentLedger >= expiryLedger;

    return success(res, {
      contractId: id,
      wasmHash,
      deployer,
      deployedAt,
      deployedLedger,
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

    const fresh = req.query.fresh === true || req.query.fresh === "true";

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
 * GET /soroban/contract/:id/storage/snapshot
 *
 * Returns the contract storage entries as they existed at the requested ledger
 * sequence. This is the historical snapshot view needed for debugging state
 * changes across time.
 */
router.get("/contract/:id/storage/snapshot", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);

    const ledger = parseLedgerSequenceParam(req.query.ledger, "ledger");
    const entry = await loadContractInstanceEntryAtLedger(id, ledger);
    const instance = entry.val.contractData().val().instance();
    const storageMap = instance.storage() || [];

    const entries = storageMap.map((mapEntry) => {
      const { value: key } = decodeScVal(mapEntry.key());
      const { value } = decodeScVal(mapEntry.val());
      return {
        key,
        value,
        lastModifiedLedger: entry.lastModifiedLedgerSeq,
        expiryLedger: entry.liveUntilLedgerSeq ?? null,
      };
    });

    return success(res, {
      contractId: id,
      ledger,
      entries,
    });
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

/**
 * GET /soroban/contract/:id/dependencies
 *
 * Analyses the contract's diagnostic-event (`fn_call`) history and returns the
 * other contracts it has invoked, along with how often and when it last called
 * each one.
 *
 * Path param:
 *   - id: Soroban contract address (C... address, 56 chars)
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       contractId: string,
 *       dependencies: [
 *         {
 *           contractId:     string,       // called contract ID
 *           callCount:      number,       // number of observed calls
 *           lastCallLedger: number | null,
 *           lastCallAt:     string | null // ISO timestamp of last call
 *         }
 *       ]
 *     }
 *   }
 *
 * Errors:
 *   400 — invalid contract ID
 *   404 — contract not found on the network
 *   500 — Soroban RPC not configured (SOROBAN_RPC_URL missing)
 *
 * Cache TTL: 60 seconds.
 */
router.get("/contract/:id/dependencies", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);

    const cacheKey = `contract-dependencies:${id}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }

    // Ensure the contract exists — throws a structured 404 (StellarKitError)
    // when it does not, and a 500 when the RPC server is not configured.
    await loadContractInstanceEntry(id);

    const dependencies = await loadContractDependencies(id);

    const data = { contractId: id, dependencies };
    cacheService.set(cacheKey, data, CONTRACT_DEPENDENCIES_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /soroban/contract/:id/invoke-simulation
 *
 * Simulates a Soroban contract function invocation without submitting it to
 * the network. Useful for estimating fees, checking for errors, and
 * understanding resource consumption before committing a transaction.
 *
 * Uses the Stellar RPC `simulateTransaction` method internally.
 *
 * Path param:
 *   - id: Soroban contract address (C... address, 56 chars)
 *
 * Query params:
 *   - function (string, required) — contract function name to invoke
 *   - args     (string, optional) — JSON-encoded array of arguments to pass to
 *              the function. Each element is converted to an ScVal.
 *              Supported types: string, number, boolean.
 *              Example: ?args=["hello",42,true]
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       estimatedFee:   string,   // estimated fee in stroops as a string
 *       resourceUsage:  {
 *         cpuInstructions:  number | null,
 *         memBytes:         number | null,
 *         ledgerReadBytes:  number | null,
 *         ledgerWriteBytes: number | null
 *       },
 *       error:          string | null,  // error message if simulation failed
 *       success:        boolean         // true when simulation did not error
 *     }
 *   }
 *
 * Errors:
 *   400 — missing ?function= param or invalid contract ID
 *   500 — Soroban RPC not configured (SOROBAN_RPC_URL missing)
 *
 * @example
 *   GET /soroban/contract/CCJZ5.../invoke-simulation?function=get_balance
 *   GET /soroban/contract/CCJZ5.../invoke-simulation?function=transfer&args=["GABC...",1000]
 */
router.get("/contract/:id/invoke-simulation", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);

    const rpcServer = requireSorobanServer();

    // ── 1. Validate required ?function= param ────────────────────────────────
    const functionName = req.query.function;
    if (!functionName || typeof functionName !== "string" || functionName.trim() === "") {
      throw new StellarKitError(
        "Query parameter 'function' is required.",
        400,
        "ValidationError",
        "Provide the name of the contract function to simulate.",
        "Example: ?function=get_balance"
      );
    }

    // ── 2. Parse optional ?args= param ───────────────────────────────────────
    let parsedArgs = [];
    if (req.query.args !== undefined && req.query.args !== "") {
      try {
        const decoded = JSON.parse(req.query.args);
        if (!Array.isArray(decoded)) {
          throw new StellarKitError(
            "Query parameter 'args' must be a JSON-encoded array.",
            400,
            "ValidationError",
            "args must be a JSON array, e.g. [\"value1\", 42, true]",
            "Encode the arguments as a JSON array in the URL query string."
          );
        }
        parsedArgs = decoded;
      } catch (parseErr) {
        if (parseErr instanceof StellarKitError) throw parseErr;
        throw new StellarKitError(
          "Query parameter 'args' contains invalid JSON.",
          400,
          "ValidationError",
          `JSON parse error: ${parseErr.message}`,
          "Ensure 'args' is a valid JSON array, e.g. ?args=[\"hello\",42]"
        );
      }
    }

    // ── 3. Convert JS args to ScVals ─────────────────────────────────────────
    // nativeToScVal handles string, number, boolean, and bigint natively.
    // For anything else we fall back to a string ScVal so the simulation
    // can still proceed and the caller sees the resulting error (if any).
    const scValArgs = parsedArgs.map((arg) => {
      try {
        return nativeToScVal(arg);
      } catch (_) {
        return nativeToScVal(String(arg));
      }
    });

    // ── 4. Build a minimal transaction for simulation ─────────────────────────
    // simulateTransaction requires a full TransactionEnvelope XDR.  We build
    // a minimal placeholder transaction using a well-known testnet source
    // account (sequence 0 is accepted by the simulator because it never
    // lands on the ledger).
    const SIMULATION_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const networkPassphrase =
      NETWORK === "mainnet"
        ? Networks.PUBLIC
        : Networks.TESTNET;

    const contract = new Contract(id);
    const operation = contract.call(functionName.trim(), ...scValArgs);

    const sourceAccount = new Account(SIMULATION_SOURCE, "0");
    const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // ── 5. Simulate ────────────────────────────────────────────────────────────
    const simResult = await rpcServer.simulateTransaction(tx);

    // ── 6. Extract results ────────────────────────────────────────────────────
    // simulateTransaction returns { error } on simulation failure or
    // { minResourceFee, cost, results } on success.
    const hasError = Boolean(simResult.error);
    const errorMessage = hasError ? String(simResult.error) : null;

    // Fee: prefer minResourceFee (post-simulation recommended fee in stroops)
    const estimatedFee = simResult.minResourceFee != null
      ? String(simResult.minResourceFee)
      : "0";

    // Resource usage is present in simResult.cost (RestorePreamble / simulate cost)
    const cost = simResult.cost || {};
    const resourceUsage = {
      cpuInstructions: cost.cpuInsns != null ? Number(cost.cpuInsns) : null,
      memBytes: cost.memBytes != null ? Number(cost.memBytes) : null,
      ledgerReadBytes: simResult.latestLedger != null ? null : null,
      ledgerWriteBytes: null,
    };

    // Also try to extract from transactionData footprint when available
    if (simResult.transactionData) {
      try {
        const txData = typeof simResult.transactionData === "string"
          ? xdr.SorobanTransactionData.fromXDR(simResult.transactionData, "base64")
          : simResult.transactionData;
        const resources = txData.resources();
        if (resources) {
          resourceUsage.ledgerReadBytes = resources.readBytes != null
            ? Number(resources.readBytes())
            : null;
          resourceUsage.ledgerWriteBytes = resources.writeBytes != null
            ? Number(resources.writeBytes())
            : null;
        }
      } catch (_) {
        // transactionData parsing failure is non-fatal — leave as null
      }
    }

    return success(res, {
      estimatedFee,
      resourceUsage,
      error: errorMessage,
      success: !hasError,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
