const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { server, NETWORK } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const { validateAccountId, validateTransactionHash } = require("../utils/validators");
const { parsePaginationParams } = require("../utils/pagination");
const { makeAccountNotFoundError } = require("../utils/errors");
const { normalizeAsset } = require("../utils/asset");
const { parseStellarAmount } = require("../utils/parseStellarAmount");

function handleAccountNotFound(err, next, accountId) {
  if (err && err.response && err.response.status === 404) {
    return next(makeAccountNotFoundError(accountId, NETWORK));
  }
  if (err && err.isAccountNotFound) {
    return next(err);
  }
  next(err);
}

/**
 * Map a raw Horizon transaction record to the StellarKit normalised shape.
 *
 * Normalised fields (acceptance criteria):
 *   transactionHash  — the unique transaction hash (primary identifier)
 *   ledger           — ledger sequence number
 *   createdAt        — ISO 8601 timestamp
 *   operationCount   — number of operations inside the transaction
 *   memo             — decoded memo string or null
 *   successful       — whether the transaction was applied successfully
 *
 * Additional fields retained for full context:
 *   id, sourceAccount, fee / feeSummary, memoType, envelopeXdr
 *
 * @example
 * GET /transactions/GAAZI4TCR3TY5OJHCTJ2C4Q6SY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 * GET /transactions/GAAZI4...?limit=5&order=asc
 */
function normaliseTransaction(tx) {
  const chargedInStroops = parseInt(tx.fee_charged, 10) || 0;
  const opCount = tx.operation_count || 1;
  const perOpStroops = Math.floor(chargedInStroops / opCount);

  return {
    // Primary normalised fields (acceptance criteria)
    transactionHash: tx.hash,
    ledger: typeof tx.ledger === "number" ? tx.ledger : tx.ledger_attr,
    createdAt: toISOTimestamp(tx.created_at),
    operationCount: tx.operation_count,
    memo: tx.memo || null,
    successful: tx.successful,

    // Extended context fields
    id: tx.id,
    sourceAccount: tx.source_account,
    memoType: tx.memo_type,
    envelopeXdr: tx.envelope_xdr,
    fee: {
      charged: tx.fee_charged,
      chargedInXLM: parseStellarAmount(chargedInStroops),
      max: tx.max_fee,
      maxInXLM: parseStellarAmount(parseInt(tx.max_fee, 10) || 0),
      account: tx.fee_account,
    },
    feeSummary: {
      chargedInStroops,
      chargedInXLM: parseStellarAmount(chargedInStroops),
      perOperationInStroops: perOpStroops,
      perOperationInXLM: parseStellarAmount(perOpStroops),
    },
  };
}

/**
 * GET /transactions/:id
 *
 * Returns paginated transaction history for a Stellar account pulled live
 * from Horizon via server.transactions().forAccount(id).
 *
 * @returns {Promise<void>} Sends a JSON response:
 * {
 *   data: Array<[
 *     id: string,
 *     hash: string,
 *     ledger: number,
 *     createdAt: string,
 *     sourceAccount: string,
 *     fee: {
 *       charged: string,
 *       account: string
 *     },
 *     operationCount: number,
 *     memoType: string,
 *     memo: string | null,
 *     successful: boolean,
 *     envelopeXdr: string
 *   }],
 *   meta: {
 *     count: number,
 *     limit: number,
 *     order: "asc" | "desc",
 *     nextCursor: string | null,
 *     hasMore: boolean
 *   }
 *
 * @example
 *   GET /transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *   GET /transactions/GAAZI4...?limit=5&order=asc&cursor=<token>
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Supports limit, cursor, and order params (parsePaginationParams validates all three)
    const { limit, order, cursor } = parsePaginationParams(req.query, 200);

    // Build the Horizon query — calls server.transactions().forAccount(id)
    let query = server
      .transactions()
      .forAccount(id)
      .limit(limit)
      .order(order)
      .includeFailed(false);

    if (cursor) query = query.cursor(cursor);

    const txResponse = await query.call();
    const records = txResponse.records || [];

    const transactions = records.map(normaliseTransaction);

    const nextCursor = records.length > 0
      ? records[records.length - 1].paging_token
      : null;

    return success(res, {
      items: transactions,
      total: transactions.length,
      limit,
      cursor: nextCursor,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /transactions/:id/operations
 * Returns the list of operations within each transaction for a Stellar account.
 *
 * Query params:
 *   - limit   (number, default: 10, max: 200)
 *   - cursor  (string, pagination cursor from previous response)
 *   - order   ("asc" | "desc", default: "desc")
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /transactions/GAAZI4.../operations?limit=20
 */

/**
 * Handler to fetch operations for a Stellar account.
 *
 * @async
 * @function
 * @param {import("express").Request} req - Express request object
 * @param {Object} req.params - Route parameters
 * @param {string} req.params.id - Stellar account public key (G...)
 * @param {Object} req.query - Query parameters
 * @param {string|number} [req.query.limit=10] - Number of records to return (max 200)
 * @param {string} [req.query.cursor] - Pagination cursor
 * @param {"asc"|"desc"} [req.query.order="desc"] - Sort order
 * @param {import("express").Response} res - Express response object
 * @param {import("express").NextFunction} next - Express next middleware function
 *
 * @returns {Promise<void>} Sends a JSON response:
 * {
 *   data: Array<{
 *     id: string,
 *     type: string,
 *     createdAt: string,
 *     transactionHash: string,
 *     transactionSuccessful: boolean,
 *     sourceAccount: string,
 *     // Additional fields vary by operation type:
 *     // payment | create_account | change_trust | others
 *   }>,
 *   meta: {
 *     count: number,
 *     limit: number,
 *     order: "asc" | "desc",
 *     nextCursor: string | null,
 *     hasMore: boolean
 *   }
 * }
 *
 * @throws Will pass validation or network errors to next middleware
 */
const VALID_OPERATION_TYPES = new Set([
  "create_account", "payment", "path_payment_strict_receive", "path_payment_strict_send",
  "manage_sell_offer", "manage_buy_offer", "create_passive_sell_offer", "set_options",
  "change_trust", "allow_trust", "account_merge", "inflation", "manage_data",
  "bump_sequence", "create_claimable_balance", "claim_claimable_balance",
  "begin_sponsoring_future_reserves", "end_sponsoring_future_reserves",
  "revoke_sponsorship", "clawback", "clawback_claimable_balance",
  "set_trust_line_flags", "liquidity_pool_deposit", "liquidity_pool_withdraw",
  "invoke_host_function", "bump_footprint_expiration", "restore_footprint", "extend_footprint_ttl",
]);

function isNativeType(type) {
  return !type || type === "native";
}

function normalizeOpAsset(code, issuer, type) {
  if (isNativeType(type)) return { code: "XLM", issuer: null, type: "native" };
  return { code: code || null, issuer: issuer || null, type };
}

function mapOperation(op) {
  const base = {
    operationId: op.id,
    type: op.type,
    createdAt: toISOTimestamp(op.created_at),
    transactionHash: op.transaction_hash,
    sourceAccount: op.source_account,
  };

  if (op.type === "payment") {
    return {
      ...base,
      amount: op.amount,
      asset: normalizeOpAsset(op.asset_code, op.asset_issuer, op.asset_type),
      from: op.from,
      to: op.to,
    };
  }
  if (op.type === "create_account") {
    return {
      ...base,
      startingBalance: op.starting_balance,
      funder: op.funder,
      account: op.account,
    };
  }
  if (op.type === "change_trust") {
    return {
      ...base,
      asset: normalizeOpAsset(op.asset_code, op.asset_issuer, op.asset_type),
      limit: op.limit,
      trustor: op.trustor,
    };
  }
  if (op.type === "manage_sell_offer" || op.type === "manage_buy_offer" || op.type === "create_passive_sell_offer") {
    return {
      ...base,
      amount: op.amount,
      price: op.price,
      offerId: op.offer_id,
      sellingAsset: normalizeOpAsset(op.selling_asset_code, op.selling_asset_issuer, op.selling_asset_type),
      buyingAsset: normalizeOpAsset(op.buying_asset_code, op.buying_asset_issuer, op.buying_asset_type),
    };
  }
  if (op.type === "path_payment_strict_receive" || op.type === "path_payment_strict_send") {
    return {
      ...base,
      amount: op.amount,
      sourceAmount: op.source_amount,
      from: op.from,
      to: op.to,
      asset: normalizeOpAsset(op.asset_code, op.asset_issuer, op.asset_type),
      sourceAsset: normalizeOpAsset(op.source_asset_code, op.source_asset_issuer, op.source_asset_type),
    };
  }
  return base;
}

router.get("/:id/operations", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const rawType = req.query.type;
    if (rawType !== undefined) {
      const normalizedType = String(rawType).toLowerCase().trim();
      if (!VALID_OPERATION_TYPES.has(normalizedType)) {
        const err = new Error(`Unknown operation type "${rawType}". Valid types are: ${[...VALID_OPERATION_TYPES].sort().join(", ")}.`);
        err.isValidation = true;
        return next(err);
      }
    }

    const { limit, order, cursor } = parsePaginationParams(req.query, 200);

    let query = server.operations().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();
    const records = opResponse.records || [];

    const filtered = rawType
      ? records.filter((op) => op.type === String(rawType).toLowerCase().trim())
      : records;

    const operations = filtered.map(mapOperation);

    const lastRecord = filtered[filtered.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, {
      operations,
      total: operations.length,
      limit,
      cursor: operations.length ? nextCursor : null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * POST /transactions/batch-status
 * Checks the confirmation status of multiple Stellar transaction hashes in a single request.
 *
 * Acceptance Criteria:
 * - Accepts body { hashes: ["abc...", "def...", ...] } (max 20)
 * - Returns status for each hash: { hash, found: true/false, successful, ledger, createdAt, fee }
 * - All Horizon lookups made in parallel using Promise.all
 * - Returns 400 if more than 20 hashes provided
 * - Returns 400 if any hash is not a valid 64-character hex string
 *
 * @example
 * POST /transactions/batch-status
 * { "hashes": ["hash1", "hash2"] }
 */
router.post("/batch-status", async (req, res, next) => {
  try {
    const { hashes } = req.body;

    if (!hashes || !Array.isArray(hashes)) {
      const err = new Error("property 'hashes' is required and must be an array.");
      err.isValidation = true;
      throw err;
    }

    if (hashes.length === 0) {
      return success(res, { items: [], total: 0 });
    }

    if (hashes.length > 20) {
      const err = new Error("Maximum of 20 hashes allowed per request.");
      err.isValidation = true;
      throw err;
    }

    // Validate each hash (64-character hex string)
    for (const hash of hashes) {
      validateTransactionHash(hash);
    }

    // Perform lookups in parallel
    const statusResults = await Promise.all(
      hashes.map(async (hash) => {
        try {
          const tx = await server.transactions().transaction(hash).call();
          return {
            hash: hash,
            found: true,
            successful: tx.successful,
            ledger: typeof tx.ledger === "number" ? tx.ledger : tx.ledger_attr,
            createdAt: toISOTimestamp(tx.created_at),
            fee: tx.fee_charged,
          };
        } catch (err) {
          // If 404, the transaction was not found
          if (err.response && err.response.status === 404) {
            return {
              hash: hash,
              found: false,
            };
          }
          // For other errors, we might want to log it or return a specific failure status
          // But for now, let's treat it as not found or unreachable
          return {
            hash: hash,
            found: false,
            error: "Lookup failed",
          };
        }
      })
    );

    return success(res, { items: statusResults, total: statusResults.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
