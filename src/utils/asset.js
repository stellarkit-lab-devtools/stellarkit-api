const { Asset } = require("@stellar/stellar-sdk");
const { validateAssetCode, validateAccountId } = require("./validators");

/**
 * Parses a Stellar asset string in the format "CODE:ISSUER" or "XLM:native".
 * 
 * @param {string} assetString - Asset string to parse.
 * @returns {Asset} A Stellar SDK Asset object.
 * @throws {Error} If the asset format is invalid.
 */
function parseStellarAsset(assetString) {
  if (!assetString || typeof assetString !== "string") {
    throw new Error("Asset string is required.");
  }

  const parts = assetString.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid asset format: "${assetString}". Expected format: CODE:ISSUER`);
  }

  const [code, issuer] = parts;
  const upperCode = code.toUpperCase();
  const lowerIssuer = issuer.toLowerCase();

  // Validate XLM Native
  if (upperCode === "XLM" && lowerIssuer === "native") {
    return Asset.native();
  }

  // Validate general assets
  validateAssetCode(code);
  validateAccountId(issuer);

  return new Asset(upperCode, issuer);
}

module.exports = { parseStellarAsset };
