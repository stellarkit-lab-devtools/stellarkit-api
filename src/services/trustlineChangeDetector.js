const logger = require("../utils/logger");
const webhookService = require("./webhookService");

/**
 * Detects trustline changes from transaction effects and triggers webhooks.
 */
class TrustlineChangeDetector {
  /**
   * Trustline effect types that indicate changes.
   */
  static TRUSTLINE_EFFECTS = new Set([
    "trustline_created",
    "trustline_removed",
    "trustline_updated",
    "trustline_authorized",
    "trustline_deauthorized",
    "trustline_flags_updated",
  ]);

  /**
   * Map effect types to change types for webhook payload.
   */
  static EFFECT_TO_CHANGE_TYPE = {
    trustline_created: "added",
    trustline_removed: "removed",
    trustline_authorized: "authorization_changed",
    trustline_deauthorized: "authorization_changed",
    trustline_updated: "updated",
    trustline_flags_updated: "updated",
  };

  /**
   * Process transaction effects and detect trustline changes.
   * Triggers webhook deliveries for relevant accounts.
   *
   * @param {string} accountId - Account to check effects for
   * @param {object[]} effects - Array of Horizon effects from a transaction
   * @param {string} transactionHash - Transaction hash for context
   * @returns {Promise<void>}
   */
  static async processTransactionEffects(
    accountId,
    effects,
    transactionHash
  ) {
    if (!Array.isArray(effects) || effects.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();

    for (const effect of effects) {
      if (!this.TRUSTLINE_EFFECTS.has(effect.type)) {
        continue;
      }

      // Determine if this effect is for the monitored account
      const isRelevantAccount =
        (effect.account === accountId) ||
        (effect.trustor === accountId) ||
        (effect.trustee === accountId);

      if (!isRelevantAccount) {
        continue;
      }

      // Build trustline object from effect
      const trustline = this.buildTrustlineFromEffect(effect);
      if (!trustline) {
        continue;
      }

      // Determine which account to trigger webhooks for
      const triggerAccountId = effect.account || effect.trustor || accountId;

      // Build webhook payload
      const payload = {
        event: "trustline.changed",
        accountId: triggerAccountId,
        trustline,
        changeType: this.EFFECT_TO_CHANGE_TYPE[effect.type] || "updated",
        timestamp,
        transactionHash,
      };

      try {
        await webhookService.triggerTrustlineWebhooks(triggerAccountId, payload);
      } catch (err) {
        logger.error(
          `Error triggering trustline webhooks for ${triggerAccountId}: ${err.message}`
        );
      }
    }
  }

  /**
   * Build normalized trustline object from effect.
   * @param {object} effect - Horizon effect
   * @returns {object|null} Trustline object or null if cannot build
   */
  static buildTrustlineFromEffect(effect) {
    if (!effect.asset_code || !effect.asset_issuer) {
      return null;
    }

    return {
      asset: {
        code: effect.asset_code,
        issuer: effect.asset_issuer,
        type: effect.asset_type || "credit_alphanum4",
      },
      balance: effect.balance || "0.0000000",
      limit: effect.limit || "0.0000000",
      isAuthorized:
        effect.authorized !== undefined ? effect.authorized : null,
      buyingLiabilities: effect.buying_liabilities || "0.0000000",
      sellingLiabilities: effect.selling_liabilities || "0.0000000",
    };
  }
}

module.exports = TrustlineChangeDetector;
