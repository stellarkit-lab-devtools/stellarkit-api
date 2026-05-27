const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId, validateLimit } = require("../utils/validators");

/**
 * GET /account/:id
 * Returns full account details including XLM balance, all asset balances,
 * signers, thresholds, flags, and sequence number.
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    // Separate native XLM from other assets
    const xlmBalance = account.balances.find((b) => b.asset_type === "native");
    const tokenBalances = account.balances
      .filter((b) => b.asset_type !== "native")
      .map((b) => ({
        assetCode: b.asset_code,
        assetIssuer: b.asset_issuer,
        assetType: b.asset_type,
        balance: b.balance,
        limit: b.limit,
        buyingLiabilities: b.buying_liabilities,
        sellingLiabilities: b.selling_liabilities,
        isAuthorized: b.is_authorized,
        isClawbackEnabled: b.is_clawback_enabled,
      }));

    // Minimum balance calculation
    // Min balance = (2 + subentries) * base_reserve
    // We use 0.5 XLM as the current base reserve
    const baseReserve = 0.5;
    const minBalance = (2 + account.subentry_count) * baseReserve;

    return success(res, {
      accountId: account.id,
      sequence: account.sequence,
      subentryCount: account.subentry_count,
      xlm: {
        balance: xlmBalance ? xlmBalance.balance : "0.0000000",
        buyingLiabilities: xlmBalance ? xlmBalance.buying_liabilities : "0",
        sellingLiabilities: xlmBalance ? xlmBalance.selling_liabilities : "0",
        minimumBalance: minBalance.toFixed(7),
        spendableBalance: xlmBalance
          ? Math.max(0, parseFloat(xlmBalance.balance) - minBalance).toFixed(7)
          : "0.0000000",
      },
      assets: tokenBalances,
      assetCount: tokenBalances.length,
      signers: account.signers.map((s) => ({
        key: s.key,
        type: s.type,
        weight: s.weight,
      })),
      thresholds: account.thresholds,
      flags: account.flags,
      homeDomain: account.home_domain || null,
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/summary", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const [
      accountResult,
      txResult,
      offersResult,
      claimableResult,
    ] = await Promise.allSettled([
      server.loadAccount(id),
      server.transactions().forAccount(id).limit(10).order("desc").call(),
      server.offers().forAccount(id).limit(50).call(),
      server.claimableBalances().forAccount(id).limit(50).call(),
    ]);

    return success(res, {
      account:
        accountResult.status === "fulfilled"
          ? accountResult.value
          : null,

      recentTransactions:
        txResult.status === "fulfilled"
          ? txResult.value.records
          : [],

      openOffers:
        offersResult.status === "fulfilled"
          ? offersResult.value.records
          : [],

      claimableBalances:
        claimableResult.status === "fulfilled"
          ? claimableResult.value.records
          : [],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /account/:id/offers
 * Returns all open DEX offers for an account.
 *
 * Query params:
 *   - limit   (number, default: 10, max: 200)
 *   - cursor  (string, pagination cursor from previous response)
 *
 * @param {string} id - Stellar account public key (G...)
 */
router.get("/:id/offers", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = validateLimit(req.query.limit || 10, 200);
    const cursor = req.query.cursor || undefined;

    let query = server.offers().forAccount(id).limit(limit);
    if (cursor) query = query.cursor(cursor);

    const offerResponse = await query.call();
    const offers = offerResponse.records.map((offer) => {
      const buildAsset = (assetType, assetCode, assetIssuer) => {
        if (assetType === "native") {
          return {
            assetType: "native",
            assetCode: "XLM",
            assetIssuer: null,
          };
        }

        return {
          assetType,
          assetCode,
          assetIssuer,
        };
      };

      return {
        id: offer.id,
        selling: {
          ...buildAsset(
            offer.selling_asset_type,
            offer.selling_asset_code,
            offer.selling_asset_issuer
          ),
          amount: offer.amount,
        },
        buying: buildAsset(
          offer.buying_asset_type,
          offer.buying_asset_code,
          offer.buying_asset_issuer
        ),
        price: offer.price,
        lastModifiedLedger: offer.last_modified_ledger,
      };
    });

    const hasMore = offerResponse.records.length === limit;
    const nextCursor = hasMore
      ? offerResponse.records[offerResponse.records.length - 1].paging_token
      : null;

    return success(res, offers, {
      meta: {
        count: offers.length,
        limit,
        nextCursor,
        hasMore,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /account/:id/payments
 * Returns only payment and create_account operations for an account,
 * filtered from the full operations list.
 *
 * Query params:
 *   - limit   (number, default: 10, max: 200)
 *   - cursor  (string, pagination cursor from previous response)
 *   - order   ("asc" | "desc", default: "desc")
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payments
 * GET /account/GAAZI4.../payments?limit=20&order=asc
 */
router.get("/:id/payments", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = validateLimit(req.query.limit || 10, 200);
    const order = ["asc", "desc"].includes(req.query.order)
      ? req.query.order
      : "desc";
    const cursor = req.query.cursor || undefined;

    let query = server
      .operations()
      .forAccount(id)
      .limit(limit)
      .order(order);

    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();
    const rawRecords = opResponse.records;

    const paymentOps = [];
    let lastPaymentIndex = -1;

    rawRecords.forEach((op, idx) => {
      if (op.type === "payment" || op.type === "create_account") {
        paymentOps.push({
          amount: op.type === "payment" ? op.amount : op.starting_balance,
          assetCode: op.type === "payment"
            ? (op.asset_code || "XLM")
            : "XLM",
          assetIssuer: op.type === "payment"
            ? (op.asset_issuer || null)
            : null,
          from: op.type === "payment" ? op.from : op.funder,
          to: op.type === "payment" ? op.to : op.account,
          createdAt: op.created_at,
        });
        lastPaymentIndex = idx;
      }
    });

    const nextCursor = lastPaymentIndex >= 0
      ? rawRecords[lastPaymentIndex].paging_token
      : rawRecords.length > 0
        ? rawRecords[rawRecords.length - 1].paging_token
        : null;

    return success(res, paymentOps, {
      meta: {
        count: paymentOps.length,
        limit,
        order,
        nextCursor,
        hasMore: rawRecords.length === limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
