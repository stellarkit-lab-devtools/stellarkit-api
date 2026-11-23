const { toISOTimestamp } = require("./response");
const { parseStellarAmount } = require("./parseStellarAmount");
const { formatLedgerSequence } = require("./formatLedgerSequence");

/**
 * Maps a Horizon GET / (serverInfo/root) payload plus the latest ledger
 * record onto the normalised StellarKit /network-status shape.
 *
 * @param {object} info - Raw Horizon serverInfo/root response (snake_case).
 * @param {object} [latest={}] - Latest ledger record from server.ledgers().
 * @param {{ network: string, horizonUrl: string }} context
 * @returns {object} CamelCase network status payload.
 */
function mapNetworkStatus(info, latest = {}, { network, horizonUrl } = {}) {
  const currentLedger = formatLedgerSequence(
    info.core_latest_ledger ?? info.current_ledger ?? info.ingest_latest_ledger,
  );
  const historyLatestLedger = formatLedgerSequence(info.history_latest_ledger);

  return {
    network,
    horizonUrl,
    horizonVersion: info.horizon_version ?? null,
    coreVersion: info.core_version ?? null,
    networkPassphrase: info.network_passphrase ?? null,
    currentLedger,
    historyLatestLedger,
    isSynced:
      currentLedger !== null &&
      historyLatestLedger !== null &&
      currentLedger === historyLatestLedger,
    latestLedger: {
      sequence: latest.sequence,
      closedAt: toISOTimestamp(latest.closed_at),
      transactionCount: latest.successful_transaction_count,
      operationCount: latest.operation_count,
      totalCoins: latest.total_coins,
      feePool: latest.fee_pool,
    },
    fees: {
      baseFeeInStroops: latest.base_fee_in_stroops,
      baseFeeInXLM: parseStellarAmount(latest.base_fee_in_stroops),
      basereserveInStroops: latest.base_reserve_in_stroops,
      baseReserveInXLM: parseStellarAmount(latest.base_reserve_in_stroops),
    },
    protocol: {
      version: latest.protocol_version,
    },
  };
}

/**
 * Fetches live Horizon server info + the latest ledger and maps them.
 *
 * `server.serverInfo()` is an alias for Horizon.Server#root (GET /).
 *
 * @param {object} server - Stellar SDK Horizon.Server instance.
 * @param {{ network: string, horizonUrl: string }} context
 */
async function fetchNetworkStatus(server, context) {
  const ping =
    typeof server.serverInfo === "function"
      ? server.serverInfo()
      : server.root();

  const [info, ledger] = await Promise.all([
    ping,
    server.ledgers().order("desc").limit(1).call(),
  ]);

  const latest = (ledger && ledger.records && ledger.records[0]) || {};
  return mapNetworkStatus(info, latest, context);
}

module.exports = { mapNetworkStatus, fetchNetworkStatus };
