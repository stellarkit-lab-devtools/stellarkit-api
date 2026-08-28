/**
 * Contract event poller.
 *
 * Polls the Soroban RPC for on-chain contract events and forwards each one to
 * the webhook delivery service. The poller is deliberately thin — it resolves
 * the raw Soroban event into a clean, serialisable payload and then delegates
 * delivery to `webhookDelivery.deliverContractEvent`.
 *
 * Usage (start once at server boot):
 *   const poller = require('./contractEventPoller');
 *   poller.start();   // begins polling
 *   poller.stop();    // cancels the interval (useful in tests)
 */

const { sorobanServer } = require("../config/stellar");
const logger = require("../utils/logger");
const { deliverContractEvent } = require("./webhookDelivery");

const POLL_INTERVAL_MS = parseInt(process.env.CONTRACT_POLL_INTERVAL_MS || "10000", 10);

let _intervalId = null;
let _lastLedger = 0;

/**
 * Decode a raw xdr.ScVal entry to a plain string/number/object, falling back
 * to the base-64 XDR representation when native conversion is unavailable.
 */
function decodeVal(scVal) {
  // Plain JS primitives (e.g. from mocked / test data) pass through as-is.
  if (scVal === null || scVal === undefined) return scVal;
  if (typeof scVal !== "object") return scVal;

  try {
    const { scValToNative } = require("@stellar/stellar-sdk");
    const native = scValToNative(scVal);
    // BigInt is not JSON-serialisable
    if (typeof native === "bigint") return native.toString();
    return native;
  } catch {
    try {
      return scVal.toXDR("base64");
    } catch {
      return null;
    }
  }
}

/**
 * Normalise a raw Soroban event object into the canonical webhook payload.
 *
 * @param {object} rawEvent  Raw event as returned by sorobanServer.getEvents()
 * @returns {object}  Normalised contract.event payload.
 */
function normaliseEvent(rawEvent) {
  const topics = (rawEvent.topic || []).map(decodeVal);
  // By Soroban convention the first topic is the event type symbol
  const eventType = topics[0] != null ? String(topics[0]) : "unknown";
  const value = rawEvent.value ? decodeVal(rawEvent.value) : null;

  return {
    event: "contract.event",
    contractId: rawEvent.contractId,
    eventType,
    topic: topics,
    value,
    ledger: rawEvent.ledger,
  };
}

/**
 * Fetch new contract events since `_lastLedger` and deliver them.
 */
async function poll() {
  if (!sorobanServer) return;

  try {
    const startLedger = _lastLedger > 0 ? _lastLedger + 1 : undefined;
    const response = await sorobanServer.getEvents({
      startLedger,
      filters: [{ type: "contract" }],
    });

    const events = response.events || [];

    for (const rawEvent of events) {
      try {
        const payload = normaliseEvent(rawEvent);
        await deliverContractEvent(payload);

        if (rawEvent.ledger > _lastLedger) {
          _lastLedger = rawEvent.ledger;
        }
      } catch (eventErr) {
        logger.error(
          { err: eventErr.message, contractId: rawEvent.contractId },
          "[POLLER] Failed to process contract event",
        );
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, "[POLLER] Contract event poll failed");
  }
}

/**
 * Start the polling interval.
 * Calling start() when already running is a no-op.
 */
function start() {
  if (_intervalId) return;
  _intervalId = setInterval(poll, POLL_INTERVAL_MS);
  logger.info(`[POLLER] Contract event polling started (interval: ${POLL_INTERVAL_MS}ms)`);
}

/**
 * Stop the polling interval.
 */
function stop() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info("[POLLER] Contract event polling stopped");
  }
}

module.exports = { start, stop, poll, normaliseEvent };
