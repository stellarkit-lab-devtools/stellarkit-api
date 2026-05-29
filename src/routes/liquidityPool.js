const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");

/**
 * GET /liquidity-pools/:id/profitability
 * Estimates the current annualized fee income for a Stellar liquidity pool
 * based on its last 7 days of trade volume.
 *
 * @param {string} id - Liquidity Pool ID (64-char hex string)
 *
 * @example
 * GET /liquidity-pools/67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026/profitability
 */
router.get("/:id/profitability", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch pool details
    let pool;
    try {
      pool = await server.liquidityPools().liquidityPoolId(id).call();
    } catch (err) {
      if (err.response && err.response.status === 404) {
        const notFoundErr = new Error("Liquidity pool not found.");
        notFoundErr.status = 404;
        return next(notFoundErr);
      }
      throw err;
    }

    // Fetch trades for the pool
    // We fetch up to 200 trades. For high-volume pools, this might not cover 7 days.
    // In a real-world scenario, we'd paginate or use a specialized aggregator.
    const tradesResponse = await server
      .trades()
      .forLiquidityPool(id)
      .limit(200)
      .order("desc")
      .call();

    const trades = tradesResponse.records;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let totalVolume7d = 0;
    let tradeCount7d = 0;

    trades.forEach((trade) => {
      const tradeTime = new Date(trade.ledger_close_time);
      if (tradeTime >= sevenDaysAgo) {
        // We sum the base_amount as a proxy for volume.
        // Usually volume is measured in USD, but here we'll use the pool's base asset amount.
        // For a more accurate USD volume, we'd need price conversion logic.
        totalVolume7d += parseFloat(trade.base_amount);
        tradeCount7d++;
      }
    });

    // Fee rate is in basis points (e.g., 30 = 0.3%)
    const feeBp = pool.fee_bp || 30;
    const feeRate = feeBp / 10000;

    const estimatedDailyFeeIncome = (totalVolume7d / 7) * feeRate;
    const estimatedAnnualFeeIncome = estimatedDailyFeeIncome * 365;

    return success(res, {
      poolId: pool.id,
      feeRate: `${(feeRate * 100).toFixed(2)}%`,
      feeBp,
      tradeVolume7d: totalVolume7d.toFixed(7),
      tradeCount7d,
      estimatedDailyFeeIncome: estimatedDailyFeeIncome.toFixed(7),
      estimatedAnnualFeeIncome: estimatedAnnualFeeIncome.toFixed(7),
      reserveA: {
        asset: pool.reserves[0].asset,
        amount: pool.reserves[0].amount,
      },
      reserveB: {
        asset: pool.reserves[1].asset,
        amount: pool.reserves[1].amount,
      },
      totalShares: pool.total_shares,
      totalTrustlines: pool.total_trustlines,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /liquidity-pools/:id/reserve-ratio
 * Returns the current reserve ratio between the two assets in a Stellar AMM liquidity pool
 * and tracks how far it has drifted from a 50/50 ratio.
 *
 * @param {string} id - Liquidity Pool ID (64-char hex string)
 */
router.get("/:id/reserve-ratio", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch pool details
    let pool;
    try {
      pool = await server.liquidityPools().liquidityPoolId(id).call();
    } catch (err) {
      if (err.response && err.response.status === 404) {
        const notFoundErr = new Error("Liquidity pool not found.");
        notFoundErr.status = 404;
        return next(notFoundErr);
      }
      throw err;
    }

    const reserveA = {
      asset: pool.reserves[0].asset,
      amount: pool.reserves[0].amount,
    };
    const reserveB = {
      asset: pool.reserves[1].asset,
      amount: pool.reserves[1].amount,
    };

    const amountA = parseFloat(reserveA.amount);
    const amountB = parseFloat(reserveB.amount);
    const totalAmount = amountA + amountB;

    let ratioA = "0.00";
    let ratioB = "0.00";
    let driftFromEqual = 0;
    let driftRating = "balanced";

    if (totalAmount > 0) {
      const numRatioA = (amountA / totalAmount) * 100;
      const numRatioB = (amountB / totalAmount) * 100;
      ratioA = numRatioA.toFixed(2);
      ratioB = numRatioB.toFixed(2);
      
      driftFromEqual = Math.abs(numRatioA - 50);
      
      if (driftFromEqual > 20) {
        driftRating = "imbalanced";
      } else if (driftFromEqual > 5) {
        driftRating = "moderate";
      }
    }

    return success(res, {
      reserveA,
      reserveB,
      ratioA: `${ratioA}%`,
      ratioB: `${ratioB}%`,
      driftFromEqual: `${driftFromEqual.toFixed(2)}%`,
      driftRating,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
