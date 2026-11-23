/**
 * Transaction participants endpoint.
 *
 * GET /transaction/:hash/participants
 *
 * Returns the set of accounts involved in a transaction, each with the
 * roles they played.  Roles are derived from the transaction's operations
 * and effects.
 *
 * Response shape:
 *   { hash, ledger, participants: [{ address, roles: [string, ...] }] }
 *
 * Participants are deduplicated by address, roles are merged, and the list
 * is sorted by address.
 *
 * Roles:
 *   source          — operation source or transaction source account
 *   fee_payer       — fee-bump transactions only (fee_account differs from source)
 *   destination     — payment / create_account / path_payment destination
 *   issuer          — asset issuer referenced in an operation or effect
 *   claimant        — claim_claimable_balance claimant
 *   balance_change  — credited or debited effect
 *   contract        — Soroban contract address
 */

const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);

const { server, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateTransactionHash } = require("../utils/validators");
const { StrKey } = require("@stellar/stellar-sdk");

/**
 * Build a participant map from a list of operations.
 *
 * @param {object[]} ops - Horizon operation records.
 * @param {object} tx - The Horizon transaction record.
 * @returns {Map<string, Set<string>>} address → roles
 */
function participantsFromOperations(ops, tx) {
  const map = new Map();

  function addRole(address, role) {
    if (!address || typeof address !== "string") return;
    if (!map.has(address)) map.set(address, new Set());
    map.get(address).add(role);
  }

  // Transaction-level source account
  if (tx.source_account) {
    addRole(tx.source_account, "source");
  }

  // Fee-bump: fee_account is the fee payer, distinct from source
  if (tx.fee_account && tx.fee_account !== tx.source_account) {
    addRole(tx.fee_account, "fee_payer");
  }

  for (const op of ops) {
    // Operation source (may differ from transaction source)
    if (op.source_account) {
      addRole(op.source_account, "source");
    }

    switch (op.type) {
      case "payment":
        if (op.from) addRole(op.from, "source");
        if (op.to) addRole(op.to, "destination");
        if (op.asset_issuer) addRole(op.asset_issuer, "issuer");
        break;

      case "create_account":
        if (op.funder) addRole(op.funder, "source");
        if (op.account) addRole(op.account, "destination");
        break;

      case "path_payment_strict_receive":
      case "path_payment_strict_send":
        if (op.from) addRole(op.from, "source");
        if (op.to) addRole(op.to, "destination");
        if (op.asset_issuer) addRole(op.asset_issuer, "issuer");
        if (op.source_asset_issuer) addRole(op.source_asset_issuer, "issuer");
        break;

      case "change_trust":
        if (op.trustor) addRole(op.trustor, "source");
        if (op.asset_issuer) addRole(op.asset_issuer, "issuer");
        break;

      case "allow_trust":
        if (op.trustor) addRole(op.trustor, "source");
        if (op.asset_issuer) addRole(op.asset_issuer, "issuer");
        break;

      case "account_merge":
        if (op.source_account || op.from) addRole(op.source_account || op.from, "source");
        if (op.destination) addRole(op.destination, "destination");
        break;

      case "create_claimable_balance":
        if (op.source_account) addRole(op.source_account, "source");
        if (op.asset_issuer) addRole(op.asset_issuer, "issuer");
        if (Array.isArray(op.claimants)) {
          for (const c of op.claimants) {
            if (c.destination) addRole(c.destination, "claimant");
          }
        }
        break;

      case "claim_claimable_balance":
        if (op.source_account) addRole(op.source_account, "source");
        if (op.claimant) addRole(op.claimant, "claimant");
        break;

      case "clawback":
        if (op.from) addRole(op.from, "source");
        if (op.asset_issuer) addRole(op.asset_issuer, "issuer");
        break;

      case "clawback_claimable_balance":
        if (op.source_account) addRole(op.source_account, "source");
        if (op.claimant) addRole(op.claimant, "claimant");
        break;

      case "set_options":
        if (op.source_account) addRole(op.source_account, "source");
        break;

      case "manage_sell_offer":
      case "manage_buy_offer":
      case "create_passive_sell_offer":
        if (op.source_account) addRole(op.source_account, "source");
        if (op.selling_asset_issuer) addRole(op.selling_asset_issuer, "issuer");
        if (op.buying_asset_issuer) addRole(op.buying_asset_issuer, "issuer");
        break;

      case "liquidity_pool_deposit":
      case "liquidity_pool_withdraw":
        if (op.source_account) addRole(op.source_account, "source");
        if (op.asset_issuer_a) addRole(op.asset_issuer_a, "issuer");
        if (op.asset_issuer_b) addRole(op.asset_issuer_b, "issuer");
        break;

      case "invoke_host_function":
        if (op.source_account) addRole(op.source_account, "source");
        break;

      default:
        // For any other operation type, at least capture the source
        if (op.source_account) addRole(op.source_account, "source");
        break;
    }
  }

  return map;
}

/**
 * Augment the participant map with roles derived from effects.
 *
 * Effects tell us who was actually credited or debited, which may differ
 * from the operation-level addresses (e.g. a path payment that routes
 * through multiple accounts).
 *
 * @param {Map<string, Set<string>>} map - existing participant map
 * @param {object[]} effects - Horizon effect records
 */
function addParticipantsFromEffects(map, effects) {
  function addRole(address, role) {
    if (!address || typeof address !== "string") return;
    if (!map.has(address)) map.set(address, new Set());
    map.get(address).add(role);
  }

  for (const eff of effects) {
    // Account that received or sent in this effect
    if (eff.account) {
      const type = eff.type || "";
      if (type.includes("_credited") || type.includes("_debited") || type.includes("_deauthorized") || type.includes("_authorized") || type.includes("_trustline")) {
        addRole(eff.account, "balance_change");
      }
    }

    // Contract addresses from effects
    if (eff.type === "contract_credited" || eff.type === "contract_debited") {
      if (eff.contract_id) addRole(eff.contract_id, "contract");
      if (eff.account) addRole(eff.account, "balance_change");
    }

    // Claimant in claimable balance effects
    if (eff.type === "claimable_balance_claimed") {
      if (eff.claimant) addRole(eff.claimant, "claimant");
    }

    // Issuer from asset effects
    if (eff.asset_issuer) {
      addRole(eff.asset_issuer, "issuer");
    }
  }
}

/**
 * Convert the participant map to the sorted, deduplicated array.
 *
 * @param {Map<string, Set<string>>} map
 * @returns {Array<{ address: string, roles: string[] }>}
 */
function finalizeParticipants(map) {
  const result = [];
  for (const [address, roleSet] of map) {
    result.push({
      address,
      roles: [...roleSet].sort(),
    });
  }
  // Sort by address
  result.sort((a, b) => a.address.localeCompare(b.address));
  return result;
}

/**
 * GET /transaction/:hash/participants
 *
 * Returns the participants and their roles in a transaction.
 */
router.get("/:hash/participants", async (req, res, next) => {
  try {
    const { hash } = req.params;
    validateTransactionHash(hash);

    // Fetch the transaction — 404 if not found
    let tx;
    try {
      tx = await server.transactions().transaction(hash).call();
    } catch (err) {
      if (err && err.response && err.response.status === 404) {
        const notFound = new Error(
          `Transaction '${hash}' was not found on the Stellar ${NETWORK} network.`
        );
        notFound.isTransactionNotFound = true;
        notFound.status = 404;
        return next(notFound);
      }
      throw err;
    }

    // Fetch all operations for the transaction
    const opsResponse = await server.operations().forTransaction(hash).limit(200).call();
    const operations = opsResponse.records || [];

    // Build participant map from operations
    const map = participantsFromOperations(operations, tx);

    // Fetch effects and augment
    try {
      const effectsResponse = await server.effects().forTransaction(hash).limit(200).call();
      const effects = effectsResponse.records || [];
      addParticipantsFromEffects(map, effects);
    } catch (_) {
      // Effects are best-effort; if they fail we still return operation-derived participants
    }

    const participants = finalizeParticipants(map);

    return success(res, {
      hash,
      ledger: typeof tx.ledger === "number" ? tx.ledger : tx.ledger_attr,
      participants,
    });
  } catch (err) {
    if (err.isInvalidTransactionHash) {
      return next(err);
    }
    if (err.isTransactionNotFound) {
      return next(err);
    }
    next(err);
  }
});

module.exports = router;
