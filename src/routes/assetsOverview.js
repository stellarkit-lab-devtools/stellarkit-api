const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const cacheService = require("../services/cache");
const { success } = require("../utils/response");

const CACHE_KEY = "assets-overview";
const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

async function fetchAllRecords(query) {
  let records = [];
  let page = await query.call();
  records = records.concat(page.records);

  while (page.records.length > 0 && typeof page.next === "function") {
    page = await page.next();
    if (page.records.length === 0) break;
    records = records.concat(page.records);
  }

  return records;
}

/**
 * GET /assets-overview
 * Returns a summary of the Stellar network's asset ecosystem:
 * total assets, total trustlines, total liquidity pools, and top 5 assets by trustline count.
 *
 * Cached with a 5 minute TTL.
 *
 * @example
 * GET /assets-overview
 */
router.get("/", async (req, res, next) => {
  try {
    const cached = cacheService.get(CACHE_KEY);
    if (cached) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }

    // OPTIMIZATION: fetch assets and liquidity pools in parallel
    const [assets, liquidityPools] = await Promise.all([
      fetchAllRecords(server.assets().limit(200)),
      fetchAllRecords(server.liquidityPools().limit(200)),
    ]);

    const totalAssets = assets.length;
    const totalTrustlines = assets.reduce(
      (sum, asset) => sum + (asset.num_accounts || 0),
      0,
    );
    const totalLiquidityPools = liquidityPools.length;

    const topAssets = [...assets]
      .sort((a, b) => (b.num_accounts || 0) - (a.num_accounts || 0))
      .slice(0, 5)
      .map((asset) => ({
        code: asset.asset_code,
        issuer: asset.asset_issuer,
        trustlineCount: asset.num_accounts,
      }));

    const data = {
      totalAssets,
      totalTrustlines,
      totalLiquidityPools,
      topAssets,
    };

    cacheService.set(CACHE_KEY, data, CACHE_TTL_SECONDS);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;