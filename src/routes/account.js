const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId, validateLimit } = require("../utils/validators");
const { accountSummaryRateLimiter } = require("../middleware/rateLimiter");

function formatAccountBalances(account) {
  const xlmBalance = account.balances.find((b) => b.asset_type === "native");
  const assets = account.balances
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

  return {
    xlm: {
      balance: xlmBalance ? xlmBalance.balance : "0.0000000",
      buyingLiabilities: xlmBalance ? xlmBalance.buying_liabilities : "0",
      sellingLiabilities: xlmBalance ? xlmBalance.selling_liabilities : "0",
    },
    assets,
  };
}

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

    const balances = formatAccountBalances(account);

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
        ...balances.xlm,
        minimumBalance: minBalance.toFixed(7),
        spendableBalance: balances.xlm.balance
          ? Math.max(0, parseFloat(balances.xlm.balance) - minBalance).toFixed(7)
          : "0.0000000",
      },
      assets: balances.assets,
      assetCount: balances.assets.length,
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

/**
 * GET /account/:id/balances
 * Returns only native XLM and asset balances for a Stellar account.
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/balances
 */
router.get("/:id/balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    return success(res, formatAccountBalances(account));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /account/:id/sequence
 * Returns only the current sequence number for a Stellar account.
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/sequence
 */
router.get("/:id/sequence", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    return success(res, {
      accountId: account.id,
      sequence: account.sequence,
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/summary", accountSummaryRateLimiter, async (req, res, next) => {
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
        const isPayment = op.type === "payment";

        paymentOps.push({
          type: op.type,
          amount: isPayment ? op.amount : op.starting_balance,
          asset: {
            code: isPayment ? (op.asset_code || "XLM") : "XLM",
            issuer: isPayment ? (op.asset_issuer || null) : null,
            type: isPayment ? (op.asset_type || "native") : "native",
          },
          sender: isPayment ? op.from : op.funder,
          receiver: isPayment ? op.to : op.account,
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
