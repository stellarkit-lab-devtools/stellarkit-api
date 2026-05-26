const express = require("express");
const router = express.Router();
const { server, horizonUrl, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");

/**
 * GET /network-status
 * Returns current Stellar network info: latest ledger, base fee, network passphrase.
 *
 * @example
 * GET /network-status
 */

/**
 * Handler to retrieve the current Stellar network status and latest ledger details.
 *
 * @async
 * @function
 * @param {import("express").Request} req - Express request object
 * @param {Object} req.params - Route parameters (none)
 * @param {Object} req.query - Query parameters (none)
 * @param {import("express").Response} res - Express response object
 * @param {import("express").NextFunction} next - Express next middleware function
 *
 * @returns {Promise<void>} Sends a JSON response with the following structure:
 * {
 *   network: string,
 *   horizonUrl: string,
 *   latestLedger: {
 *     sequence: number,
 *     closedAt: string,
 *     transactionCount: number,
 *     operationCount: number,
 *     totalCoins: string,
 *     feePool: string
 *   },
 *   fees: {
 *     baseFeeInStroops: number,
 *     baseFeeInXLM: string,
 *     basereserveInStroops: number,
 *     baseReserveInXLM: string
 *   },
 *   protocol: {
 *     version: number
 *   }
 * }
 *
 * @throws Will pass any errors to the next middleware
 */
router.get("/", async (req, res, next) => {
  try {
    const ledger = await server.ledgers().order("desc").limit(1).call();
    const latest = ledger.records[0];

    return success(res, {
      network: NETWORK,
      horizonUrl,
      latestLedger: {
        sequence: latest.sequence,
        closedAt: latest.closed_at,
        transactionCount: latest.successful_transaction_count,
        operationCount: latest.operation_count,
        totalCoins: latest.total_coins,
        feePool: latest.fee_pool,
      },
      fees: {
        baseFeeInStroops: latest.base_fee_in_stroops,
        baseFeeInXLM: (latest.base_fee_in_stroops / 1e7).toFixed(7),
        basereserveInStroops: latest.base_reserve_in_stroops,
        baseReserveInXLM: (latest.base_reserve_in_stroops / 1e7).toFixed(7),
      },
      protocol: {
        version: latest.protocol_version,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
