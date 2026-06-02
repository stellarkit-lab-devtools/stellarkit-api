const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");
const { parsePaginationParams } = require("../utils/pagination");
/**
 * GET /transactions/:id
 * Returns paginated transaction history for a Stellar account.
 *
 * Query params:
 *   - limit   (number, default: 10, max: 200)
 *   - cursor  (string, pagination cursor from previous response)
 *   - order   ("asc" | "desc", default: "desc")
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 * GET /transactions/GAAZI4...?limit=5&order=asc
 */

/**
 * Handler to fetch paginated transaction history for a Stellar account.
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
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query, 200);

    let query = server
      .transactions()
      .forAccount(id)
      .limit(limit)
      .order(order)
      .includeFailed(false);

    if (cursor) query = query.cursor(cursor);

    const txResponse = await query.call();

    const STROOPS_PER_XLM = 10_000_000;

    const transactions = txResponse.records.map((tx) => {
      const chargedInStroops = parseInt(tx.fee_charged, 10);
      const opCount = tx.operation_count || 1;
      const perOpStroops = Math.floor(chargedInStroops / opCount);

      return {
        id: tx.id,
        hash: tx.hash,
        ledger: tx.ledger,
        createdAt: tx.created_at,
        sourceAccount: tx.source_account,
        fee: {
          charged: tx.fee_charged,
          account: tx.fee_account,
        },
        feeSummary: {
          chargedInStroops,
          chargedInXLM: (chargedInStroops / STROOPS_PER_XLM).toFixed(7),
          perOperationInStroops: perOpStroops,
          perOperationInXLM: (perOpStroops / STROOPS_PER_XLM).toFixed(7),
        },
        operationCount: tx.operation_count,
        memoType: tx.memo_type,
        memo: tx.memo || null,
        successful: tx.successful,
        envelopeXdr: tx.envelope_xdr,
      };
    });

    const lastRecord = txResponse.records[txResponse.records.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, transactions, {
      meta: {
        count: transactions.length,
        limit,
        order,
        nextCursor,
        hasMore: transactions.length === limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /transactions/:id/operations
 * Returns the list of operations within each transaction for an account.
 *
 * Query params:
 *   - limit  (number, default: 10, max: 200)
 *   - order  ("asc" | "desc", default: "desc")
 *   - cursor (string)
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

    const { limit, order, cursor } = parsePaginationParams(req.query, 200);

    let query = server
      .operations()
      .forAccount(id)
      .limit(limit)
      .order(order);

    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();

    const operations = opResponse.records.map((op) => {
      const base = {
        id: op.id,
        type: op.type,
        createdAt: op.created_at,
        transactionHash: op.transaction_hash,
        transactionSuccessful: op.transaction_successful,
        sourceAccount: op.source_account,
      };

      switch (op.type) {
        case "payment":
          return {
            ...base,
            amount: op.amount,
            assetType: op.asset_type,
            assetCode: op.asset_code || "XLM",
            assetIssuer: op.asset_issuer || null,
            from: op.from,
            to: op.to,
          };
        case "create_account":
          return {
            ...base,
            account: op.account,
            funder: op.funder,
            startingBalance: op.starting_balance,
          };
        case "change_trust":
          return {
            ...base,
            assetCode: op.asset_code,
            assetIssuer: op.asset_issuer,
            limit: op.limit,
            trustee: op.trustee,
            trustor: op.trustor,
          };
        default:
          return base;
      }
    });

    const lastRecord = opResponse.records[opResponse.records.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, operations, {
      meta: {
        count: operations.length,
        limit,
        order,
        nextCursor,
        hasMore: operations.length === limit,
      },
    });
  } catch (err) {
    next(err);
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
      const err = new Error("Property 'hashes' is required and must be an array.");
      err.isValidation = true;
      throw err;
    }

    if (hashes.length === 0) {
      return success(res, []);
    }

    if (hashes.length > 20) {
      const err = new Error("Maximum of 20 hashes allowed per request.");
      err.isValidation = true;
      throw err;
    }

    // Validate each hash (64-character hex string)
    const hashRegex = /^[0-9a-fA-F]{64}$/;
    for (const hash of hashes) {
      if (!hashRegex.test(hash)) {
        const err = new Error(`Invalid transaction hash: "${hash}". Must be a 64-character hex string.`);
        err.isValidation = true;
        throw err;
      }
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
            ledger: tx.ledger,
            createdAt: tx.created_at,
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

    return success(res, statusResults);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
