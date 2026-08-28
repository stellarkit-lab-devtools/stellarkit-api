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
router.get("/:id/operations", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query);

    let query = server
      .operations()
      .forAccount(id)
      .limit(limit)
      .order(order);

    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();

    const operations = opResponse.records.map((op) => {
      const formatted = {
        id: op.id,
        type: op.type,
        createdAt: toISOTimestamp(op.created_at),
        transactionHash: op.transaction_hash,
        transactionSuccessful: op.transaction_successful,
        sourceAccount: op.source_account,
      };

      // Add type-specific fields
      if (op.type === "payment") {
        formatted.asset = normalizeAsset(
          op.asset_code || "XLM",
          op.asset_issuer || null,
          op.asset_type || "native",
        );
        formatted.amount = op.amount;
        formatted.from = op.from;
        formatted.to = op.to;
      } else if (op.type === "create_account") {
        formatted.startingBalance = op.starting_balance;
        formatted.funder = op.funder;
        formatted.account = op.account;
      } else if (op.type === "change_trust") {
        formatted.asset = normalizeAsset(op.asset_code, op.asset_issuer, op.asset_type);
        formatted.trustor = op.trustor;
        formatted.trustee = op.trustee;
      }

      return formatted;
    });

    const lastRecord = opResponse.records[opResponse.records.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, {
      items: operations,
      total: operations.length,
      limit,
      cursor: nextCursor,
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
