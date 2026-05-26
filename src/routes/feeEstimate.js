const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");

/**
 * GET /fee-estimate
 * Returns fee statistics for recent ledgers to help developers pick a competitive fee.
 *
 * Query params:
 *   - operations (number, default: 1) — number of operations in your transaction
 *
 * @example
 * GET /fee-estimate
 * GET /fee-estimate?operations=3
 */

/**
 * Handler to fetch Stellar network fee estimates based on recent ledger data.
 *
 * @async
 * @function
 * @param {import("express").Request} req - Express request object
 * @param {Object} req.query - Query parameters
 * @param {string|number} [req.query.operations=1] - Number of operations in the transaction (minimum 1)
 * @param {import("express").Response} res - Express response object
 * @param {import("express").NextFunction} next - Express next middleware function
 *
 * @returns {Promise<void>} Sends a JSON response with the following structure:
 * {
 *   note: string,
 *   operationCount: number,
 *   perOperation: {
 *     economy: {
 *       stroops: number,
 *       xlm: string,
 *       description: string
 *     },
 *     standard: {
 *       stroops: number,
 *       xlm: string,
 *       description: string
 *     },
 *     priority: {
 *       stroops: number,
 *       xlm: string,
 *       description: string
 *     }
 *   },
 *   totalFee: {
 *     economy: { stroops: number, xlm: string },
 *     standard: { stroops: number, xlm: string },
 *     priority: { stroops: number, xlm: string }
 *   },
 *   networkStats: {
 *     lastLedgerBaseFee: string,
 *     ledgerCapacityUsage: string,
 *     maxFeeCharged: string,
 *     p10: string,
 *     p50: string,
 *     p95: string,
 *     p99: string
 *   }
 * }
 *
 * @throws Will pass any errors to the next middleware
 */
router.get("/", async (req, res, next) => {
  try {
    const operations = Math.max(1, parseInt(req.query.operations) || 1);

    const feeStats = await server.feeStats();

    const base = parseInt(feeStats.fee_charged.p10);
    const recommended = parseInt(feeStats.fee_charged.p50);
    const priority = parseInt(feeStats.fee_charged.p95);

    return success(res, {
      note: `Fee estimates for a transaction with ${operations} operation(s). Fees are in stroops (1 XLM = 10,000,000 stroops).`,
      operationCount: operations,
      perOperation: {
        economy: {
          stroops: parseInt(feeStats.fee_charged.min),
          xlm: (parseInt(feeStats.fee_charged.min) / 1e7).toFixed(7),
          description: "Minimum — may be slow during congestion",
        },
        standard: {
          stroops: recommended,
          xlm: (recommended / 1e7).toFixed(7),
          description: "Recommended for most transactions",
        },
        priority: {
          stroops: priority,
          xlm: (priority / 1e7).toFixed(7),
          description: "Fast inclusion even during high network load",
        },
      },
      totalFee: {
        economy: {
          stroops: parseInt(feeStats.fee_charged.min) * operations,
          xlm: ((parseInt(feeStats.fee_charged.min) * operations) / 1e7).toFixed(7),
        },
        standard: {
          stroops: recommended * operations,
          xlm: ((recommended * operations) / 1e7).toFixed(7),
        },
        priority: {
          stroops: priority * operations,
          xlm: ((priority * operations) / 1e7).toFixed(7),
        },
      },
      networkStats: {
        lastLedgerBaseFee: feeStats.last_ledger_base_fee,
        ledgerCapacityUsage: feeStats.ledger_capacity_usage,
        maxFeeCharged: feeStats.fee_charged.max,
        p10: feeStats.fee_charged.p10,
        p50: feeStats.fee_charged.p50,
        p95: feeStats.fee_charged.p95,
        p99: feeStats.fee_charged.p99,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
