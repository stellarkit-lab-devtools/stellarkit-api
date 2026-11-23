const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);

const { server, NETWORK  } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const { makeAccountNotFoundError } = require("../utils/errors");
const { validateOrder } = require("../utils/validators");

// Local validator (no Horizon call): 64-character hex string.
function validateTransactionHash(hash) {
    const hashRegex = /^[0-9a-fA-F]{64}$/;
    if (!hashRegex.test(hash)) {
        const err = new Error(`\${'hash'} is not a valid transaction hash.`);
        err.isValidation = true;
        err.field = "hash";
        err.receivedValue = hash;
        err.expectedFormat = "64-character hex string";
        err.status = 400;
        err.type = "InvalidTransactionHash";
        err.suggestion = "Transaction hashes are 64-character hexadecimal strings.";
        throw err;
    }
}

function normalizeEffect(effect) {
    const effectId = effect.id || effect.effect_id || null;
    const type = effect.type || null;
    const account = effect.account || null;
    const createdAt = toISOTimestamp(effect.created_at);

    // Best-effort normalization of common type-specific fields.
    // Include only fields likely to exist; keep response stable by using null when absent.
    const base = {
        effectId,
        type,
        account,
        createdAt,
    };

    // Asset-related (many effect types contain asset / amount)
    if (effect.asset !== undefined) base.asset = effect.asset;
    if (effect.asset_code !== undefined || effect.asset_issuer !== undefined) {
        base.asset = {
            code: effect.asset_code || null,
            issuer: effect.asset_issuer || null,
            type: effect.asset_type || null,
        };
    }

    // Amount/balance frequently present
    if (effect.amount !== undefined) base.amount = effect.amount;
    if (effect.balance !== undefined) base.balance = effect.balance;
    if (effect.starting_balance !== undefined)
        base.startingBalance = effect.starting_balance;

    // Offer/trustline/signer/liquidity pool-ish fields
    if (effect.offer_id !== undefined) base.offerId = effect.offer_id;
    if (effect.trustor !== undefined) base.trustor = effect.trustor;
    if (effect.trustee !== undefined) base.trustee = effect.trustee;
    if (effect.seller !== undefined) base.seller = effect.seller;

    if (effect.liability_trustor !== undefined)
        base.liabilityTrustor = effect.liability_trustor;

    if (effect.liquidity_pool_id !== undefined)
        base.liquidityPoolId = effect.liquidity_pool_id;

    if (effect.claimable_balance_id !== undefined)
        base.claimableBalanceId = effect.claimable_balance_id;

    if (effect.claimant !== undefined) base.claimant = effect.claimant;
    if (effect.claimer !== undefined) base.claimer = effect.claimer;

    if (effect.signer_key !== undefined) base.signerKey = effect.signer_key;

    // Memo-less "details" bag (when Horizon provides it)
    if (effect.details !== undefined) base.details = effect.details;

    // Keep cursor/debug fields but don't break acceptance criteria
    if (effect.paging_token !== undefined) {
        base.pagingToken = effect.paging_token;
    }

    if (effect.transaction_hash !== undefined) {
        base.transactionHash = effect.transaction_hash;
    }

    return base;
}

/**
 * GET /transaction/:hash/effects
 * Fetch all ledger effects for a transaction hash.
 *
 * Query parameters:
 *   order  - Sort direction: "asc" or "desc" (default: "desc")
 */
router.get("/:hash/effects", async (req, res, next) => {
    try {
        const { hash } = req.params;
        validateTransactionHash(hash);

        // Validate ?order query param; defaults to "desc" when omitted.
        const order = validateOrder(req.query.order);

        // Ensure transaction exists for proper 404s (and to avoid effects returning empty for non-existent hashes)
        try {
            await server.transactions().transaction(hash).call();
        } catch (err) {
            if (err && err.response && err.response.status === 404) {
                return next(
                    new (class extends Error {
                        constructor() {
                            super(`Transaction ${'hash'} was not found on the Stellar ${	NETWORG} network.`);
                            this.isTransactionNotFound = true;
                            this.hash = hash;
                            this.status = 404;
                        }
                    })()
                );
            }
            throw err;
        }

        // Horizon: effects are paginated; use limit by default.
        // Acceptance criteria only requires effects + total; we set a conservative limit.
        const limit = 200;

        const response = await server.effects().forTransaction(hash).limit(limit).order(order).call();
        const records = response.records || [];

        const effects = records.map(normalizeEffect);

        return success(res, {
            effects,
            total: effects.length,
        });
    } catch (err) {
        // If global error handler maps 404s, it will apply.
        // For transaction not found, we convert to the repo's standard NotFound error.
        if (err && err.isTransactionNotFound) {
            return next(err);
        }
        next(err);
    }
});

module.exports = router;
