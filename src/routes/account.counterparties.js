const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { server, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");
const { makeAccountNotFoundError } = require("../utils/errors");

/**
 * GET /account/:id/counterparties
 * Analyzes frequent payment counterparties for an account.
 * Returns top senders and top receivers. For now, returns empty arrays if no data.
 */
router.get("/:id/counterparties", async (req, res, next) => {
  try {
    const { id } = req.params;
    // Basic validation (same relaxed check as elsewhere)
    if (!id || typeof id !== "string" || !id.startsWith("G")) {
      const err = new Error("Invalid account ID.");
      err.isValidation = true;
      err.status = 400;
      return next(err);
    }
    // Verify account exists via Horizon (ignore errors for placeholder accounts)
    try {
      await server.loadAccount(id);
    } catch (e) {
      if (e.response && e.response.status === 404) {
        return next(makeAccountNotFoundError(id, NETWORK));
      }
      // For other errors, continue with empty data
    }
    // Placeholder implementation – return empty counterparties list
    return success(res, { topSenders: [], topReceivers: [] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
