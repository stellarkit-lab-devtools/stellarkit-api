const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId, validateLimit } = require("../utils/validators");
const { accountSummaryRateLimiter } = require("../middleware/rateLimiter");

const handleAccountNotFound = (err, next) => {
  if (err.response && err.response.status === 404) {
    const notFoundErr = new Error("Account not found.");
    notFoundErr.status = 404;
    return next(notFoundErr);
  }
  next(err);
};

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
    const STROOPS_PER_XLM = 10_000_000;
    const accountReserve = 2 * baseReserve;
    const subentryReserve = account.subentry_count * baseReserve;
    const totalLocked = accountReserve + subentryReserve;
    const xlmBalance = parseFloat(balances.xlm.balance || "0");
    const spendable = Math.max(0, xlmBalance - totalLocked);

    const toXLM = (xlm) => xlm.toFixed(7);
    const toStroops = (xlm) => Math.round(xlm * STROOPS_PER_XLM);

    return success(res, {
      accountId: account.id,
      sequence: account.sequence,
      subentryCount: account.subentry_count,
      xlm: {
        ...balances.xlm,
        minimumBalance: totalLocked.toFixed(7),
        spendableBalance: spendable.toFixed(7),
      },
      reserveBreakdown: {
        baseReserve:       { xlm: toXLM(baseReserve),     stroops: toStroops(baseReserve) },
        accountReserve:    { xlm: toXLM(accountReserve),  stroops: toStroops(accountReserve) },
        subentryReserve:   { xlm: toXLM(subentryReserve), stroops: toStroops(subentryReserve) },
        totalLocked:       { xlm: toXLM(totalLocked),     stroops: toStroops(totalLocked) },
        spendable:         { xlm: toXLM(spendable),       stroops: toStroops(spendable) },
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
    handleAccountNotFound(err, next);
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
    handleAccountNotFound(err, next);
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
    handleAccountNotFound(err, next);
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
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/merge-eligibility
 * Checks whether an account is eligible to be merged.
 *
 * Verifies:
 * - Zero non-native asset balances
 * - No open offers
 * - No open trustlines (excluding native XLM)
 * - No data entries
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/merge-eligibility
 */
router.get("/:id/merge-eligibility", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);
    const blockers = [];

    // 1. Check for non-native asset balances and open trustlines
    const nonNativeBalances = account.balances.filter(b => b.asset_type !== "native");
    if (nonNativeBalances.length > 0) {
      const hasPositiveBalance = nonNativeBalances.some(b => parseFloat(b.balance) > 0);
      if (hasPositiveBalance) {
        blockers.push("Account has non-native asset balances. All assets must be sent or burned before merging.");
      }
      blockers.push(`Account has ${nonNativeBalances.length} open trustline(s). All trustlines must be removed.`);
    }

    // 2. Check for open offers
    const offers = await server.offers().forAccount(id).limit(1).call();
    if (offers.records.length > 0) {
      blockers.push("Account has open offers. All offers must be cancelled.");
    }

    // 3. Check for data entries
    const dataEntries = Object.keys(account.data_attr || {});
    if (dataEntries.length > 0) {
      blockers.push(`Account has ${dataEntries.length} data entry/entries. All data entries must be removed.`);
    }

    return success(res, {
      eligible: blockers.length === 0,
      blockers,
      accountDetails: {
        accountId: account.id,
        subentryCount: account.subentry_count,
        balances: account.balances.map(b => ({
          asset: b.asset_type === "native" ? "XLM" : `${b.asset_code}:${b.asset_issuer}`,
          balance: b.balance
        }))
      }
    });
  } catch (err) {
    handleAccountNotFound(err, next);
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
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/timeline
 * Returns a unified chronological array of meaningful events for a Stellar account.
 * Events include account creation, payments, trustline changes, and offer activity,
 * formatted for easy display in a wallet UI.
 *
 * Query params:
 *   - limit  (number, default: 10, max: 50)
 *   - cursor (string, pagination cursor)
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/timeline
 * GET /account/GAAZI4.../timeline?limit=20
 */
router.get("/:id/timeline", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = validateLimit(req.query.limit || 10, 50);
    const cursor = req.query.cursor || undefined;

    let query = server
      .operations()
      .forAccount(id)
      .limit(limit)
      .order("desc");

    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();
    const records = opResponse.records;

    const timeline = records.map((op) => {
      const base = {
        id: op.id,
        timestamp: op.created_at,
        transactionHash: op.transaction_hash,
      };

      switch (op.type) {
        case "create_account":
          if (op.account === id) {
            return {
              ...base,
              type: "account_created",
              description: `Account created with ${op.starting_balance} XLM by ${op.funder}`,
              amount: op.starting_balance,
              asset: "XLM",
              counterparty: op.funder,
            };
          } else {
            return {
              ...base,
              type: "payment_sent",
              description: `Sent ${op.starting_balance} XLM to create account ${op.account}`,
              amount: op.starting_balance,
              asset: "XLM",
              counterparty: op.account,
            };
          }

        case "payment":
          const isSent = op.from === id;
          const assetCode = op.asset_type === "native" ? "XLM" : op.asset_code;
          return {
            ...base,
            type: isSent ? "payment_sent" : "payment_received",
            description: isSent
              ? `Sent ${op.amount} ${assetCode} to ${op.to}`
              : `Received ${op.amount} ${assetCode} from ${op.from}`,
            amount: op.amount,
            asset: assetCode,
            counterparty: isSent ? op.to : op.from,
          };

        case "path_payment_strict_receive":
        case "path_payment_strict_send":
          const isPathSent = op.from === id;
          const sentAsset = op.source_asset_type === "native" ? "XLM" : op.source_asset_code;
          const receivedAsset = op.asset_type === "native" ? "XLM" : op.asset_code;

          if (isPathSent) {
            return {
              ...base,
              type: "payment_sent",
              description: `Sent ${op.source_amount} ${sentAsset} (converted to ${op.amount} ${receivedAsset}) to ${op.to}`,
              amount: op.source_amount,
              asset: sentAsset,
              counterparty: op.to,
            };
          } else {
            return {
              ...base,
              type: "payment_received",
              description: `Received ${op.amount} ${receivedAsset} (converted from ${op.source_amount} ${sentAsset}) from ${op.from}`,
              amount: op.amount,
              asset: receivedAsset,
              counterparty: op.from,
            };
          }

        case "change_trust":
          const isAdded = parseFloat(op.limit) > 0;
          return {
            ...base,
            type: isAdded ? "trustline_added" : "trustline_removed",
            description: isAdded
              ? `Added trustline for ${op.asset_code}`
              : `Removed trustline for ${op.asset_code}`,
            amount: op.limit,
            asset: op.asset_code,
            counterparty: op.asset_issuer,
          };

        case "manage_sell_offer":
        case "manage_buy_offer":
        case "create_passive_sell_offer":
          const isRemove = (op.type !== "create_passive_sell_offer" && parseFloat(op.amount) === 0 && op.offer_id !== "0");
          const sellAsset = op.selling_asset_type === "native" ? "XLM" : op.selling_asset_code;
          const buyAsset = op.buying_asset_type === "native" ? "XLM" : op.buying_asset_code;

          if (isRemove) {
            return {
              ...base,
              type: "offer_removed",
              description: `Cancelled offer #${op.offer_id}`,
              amount: null,
              asset: null,
              counterparty: null,
            };
          } else {
            return {
              ...base,
              type: "offer_created",
              description: `Created offer to sell ${op.amount} ${sellAsset} for ${buyAsset}`,
              amount: op.amount,
              asset: sellAsset,
              counterparty: null,
            };
          }

        default:
          return {
            ...base,
            type: op.type,
            description: `Operation of type ${op.type}`,
            amount: null,
            asset: null,
            counterparty: null,
          };
      }
    });

    const lastRecord = records[records.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, timeline, {
      meta: {
        count: timeline.length,
        limit,
        nextCursor,
        hasMore: records.length === limit,
      },
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * POST /account/:id/validate-signers
 * Checks whether a given set of signers has enough combined weight to meet
 * an account's low, medium, or high thresholds.
 *
 * Body: { signers: ["G...", "G..."] }
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * POST /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/validate-signers
 * Body: { "signers": ["GBA...", "GBC..."] }
 */
router.post("/:id/validate-signers", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { signers } = req.body;
    if (!signers || !Array.isArray(signers)) {
      const err = new Error("Signers must be an array of public keys.");
      err.status = 400;
      return next(err);
    }

    // Validate each signer key
    for (const signerKey of signers) {
      try {
        validateAccountId(signerKey);
      } catch (e) {
        const err = new Error(`Invalid signer key: "${signerKey}".`);
        err.status = 400;
        return next(err);
      }
    }

    const account = await server.loadAccount(id);
    const accountSigners = account.signers || [];
    const thresholds = account.thresholds;

    // Calculate combined weight
    let combinedWeight = 0;
    const matchedSigners = [];

    for (const providedSigner of signers) {
      const match = accountSigners.find(s => s.key === providedSigner);
      if (match) {
        combinedWeight += match.weight;
        matchedSigners.push({
          key: match.key,
          weight: match.weight
        });
      }
    }

    return success(res, {
      lowThreshold: thresholds.low_threshold,
      medThreshold: thresholds.med_threshold,
      highThreshold: thresholds.high_threshold,
      combinedWeight,
      canSignLow: combinedWeight >= thresholds.low_threshold,
      canSignMed: combinedWeight >= thresholds.med_threshold,
      canSignHigh: combinedWeight >= thresholds.high_threshold,
      matchedSigners
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * Helper to evaluate Stellar claimable balance predicates.
 * 
 * @param {Object} predicate - The predicate object from Horizon
 * @param {number} currentTime - Current unix timestamp in seconds
 * @returns {boolean} Whether the predicate is satisfied
 */
function evaluatePredicate(predicate, currentTime) {
  if (predicate.unconditional) return true;

  if (predicate.abs_before) {
    // Horizon might return ISO string or unix timestamp
    const beforeTime = isNaN(predicate.abs_before) 
      ? Math.floor(new Date(predicate.abs_before).getTime() / 1000)
      : parseInt(predicate.abs_before);
    return currentTime < beforeTime;
  }

  if (predicate.abs_after) {
    const afterTime = isNaN(predicate.abs_after)
      ? Math.floor(new Date(predicate.abs_after).getTime() / 1000)
      : parseInt(predicate.abs_after);
    return currentTime >= afterTime;
  }

  if (predicate.and) {
    return predicate.and.every(p => evaluatePredicate(p, currentTime));
  }

  if (predicate.or) {
    return predicate.or.some(p => evaluatePredicate(p, currentTime));
  }

  if (predicate.not) {
    return !evaluatePredicate(predicate.not, currentTime);
  }

  return false;
}

/**
 * GET /account/:id/claimable-balances/eligible
 * Returns claimable balances that the account is eligible to claim right now,
 * along with those that are not yet claimable or have expired.
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/claimable-balances/eligible
 */
router.get("/:id/claimable-balances/eligible", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Fetch all claimable balances where this account is a claimant
    const balancesResponse = await server
      .claimableBalances()
      .forClaimant(id)
      .limit(100)
      .call();

    const records = balancesResponse.records;
    const currentTime = Math.floor(Date.now() / 1000);

    const result = {
      eligible: [],
      notYetClaimable: [],
      expired: []
    };

    records.forEach(cb => {
      const claimant = cb.claimants.find(c => c.destination === id);
      if (!claimant) return;

      const isClaimable = evaluatePredicate(claimant.predicate, currentTime);

      // We categorize as:
      // - eligible: currently claimable
      // - notYetClaimable: has an abs_after predicate that isn't met yet
      // - expired: has an abs_before predicate that has passed
      
      const formattedBalance = {
        id: cb.id,
        asset: cb.asset,
        amount: cb.amount,
        sponsor: cb.sponsor,
        lastModifiedLedger: cb.last_modified_ledger,
        claimants: cb.claimants
      };

      if (isClaimable) {
        result.eligible.push(formattedBalance);
      } else {
        // Simple heuristic for categorization
        const predStr = JSON.stringify(claimant.predicate);
        if (predStr.includes("abs_before") && !predStr.includes("abs_after")) {
          result.expired.push(formattedBalance);
        } else if (predStr.includes("abs_after")) {
          result.notYetClaimable.push(formattedBalance);
        } else {
          // If it's a complex predicate and false, we'll put it in notYetClaimable by default
          result.notYetClaimable.push(formattedBalance);
        }
      }
    });

    return success(res, result);
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/data
 * Returns all data entries for an account with both raw and decoded values.
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/data
 */
router.get("/:id/data", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);
    const dataEntries = account.data_attr || {};

    const formattedData = Object.entries(dataEntries).map(([key, rawValue]) => {
      let decodedValue = null;
      try {
        decodedValue = Buffer.from(rawValue, "base64").toString("utf8");
      } catch (e) {
        // Not decodable as UTF-8
      }

      return {
        key,
        rawValue,
        decodedValue,
      };
    });

    return success(res, formattedData);
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/data/:key
 * Returns a single data entry by key.
 *
 * @param {string} id - Stellar account public key (G...)
 * @param {string} key - The data entry key
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/data/my_key
 */
router.get("/:id/data/:key", async (req, res, next) => {
  try {
    const { id, key } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);
    const rawValue = account.data_attr ? account.data_attr[key] : null;

    if (!rawValue) {
      const err = new Error(`Data entry with key "${key}" not found.`);
      err.status = 404;
      return next(err);
    }

    let decodedValue = null;
    try {
      decodedValue = Buffer.from(rawValue, "base64").toString("utf8");
    } catch (e) {
      // Not decodable as UTF-8
    }

    return success(res, {
      key,
      rawValue,
      decodedValue,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

module.exports = router;
