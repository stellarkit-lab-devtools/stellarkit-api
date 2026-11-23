/**
 * Single registry of API error types and the headings that document them in
 * docs/error-reference.md. Every error body gains a `docsUrl` built from this
 * registry so developers can jump straight to the relevant explanation.
 */

const DEFAULT_DOCS_BASE_URL =
  "https://github.com/stellarkit-lab-devtools/stellarkit-api/blob/main/docs/error-reference.md";

/** type -> exact heading text in docs/error-reference.md */
const ERROR_TYPES = {
  AccountNotFound: "AccountNotFound",
  AssetNotFound: "AssetNotFound",
  ConfigError: "ConfigError",
  ContractNotFound: "ContractNotFound",
  DuplicateParameter: "DuplicateParameter",
  Forbidden: "Forbidden",
  Gone: "Gone",
  HorizonError: "HorizonError",
  HorizonTimeout: "HorizonTimeout",
  HorizonUnavailable: "HorizonUnavailable",
  InsufficientReserve: "InsufficientReserve",
  InsufficientScope: "InsufficientScope",
  InternalError: "InternalError",
  InvalidAccountId: "InvalidAccountId",
  InvalidAsset: "InvalidAsset",
  InvalidContentType: "InvalidContentType",
  InvalidHorizonResponse: "InvalidHorizonResponse",
  InvalidLimit: "InvalidLimit",
  InvalidParameter: "InvalidParameter",
  InvalidTransactionHash: "InvalidTransactionHash",
  LiquidityPoolNotFound: "LiquidityPoolNotFound",
  MethodNotAllowed: "MethodNotAllowed",
  NoLedgerData: "NoLedgerData",
  NoPathFound: "NoPathFound",
  NotFound: "NotFound",
  OfferNotFound: "OfferNotFound",
  OrderBookEmpty: "OrderBookEmpty",
  PayloadTooLargeError: "PayloadTooLargeError",
  RateLimitError: "RateLimitError",
  RateLimitExceeded: "RateLimitExceeded",
  ServerError: "ServerError",
  TomlFetchFailed: "TomlFetchFailed",
  TransactionSubmissionFailed: "TransactionSubmissionFailed",
  TrustlineNotFound: "TrustlineNotFound",
  Unauthorized: "Unauthorized",
  UpstreamUnavailable: "UpstreamUnavailable",
  ValidationError: "ValidationError",
  WebhookNotFound: "WebhookNotFound",
};

function getDocsBaseUrl() {
  return (process.env.DOCS_BASE_URL || DEFAULT_DOCS_BASE_URL).replace(/\/+$/, "");
}

function toAnchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
}

/** Link to the type's heading, or to the top of the document for unknown types. */
function getDocsUrl(type) {
  const heading = ERROR_TYPES[type];
  const base = getDocsBaseUrl();
  return heading ? `${base}#${toAnchor(heading)}` : base;
}

/** Add docsUrl to an error object without altering any other field. */
function withDocsUrl(error) {
  if (error && typeof error === "object") {
    error.docsUrl = getDocsUrl(error.type);
  }
  return error;
}

module.exports = {
  ERROR_TYPES,
  DEFAULT_DOCS_BASE_URL,
  getDocsBaseUrl,
  getDocsUrl,
  toAnchor,
  withDocsUrl,
};
