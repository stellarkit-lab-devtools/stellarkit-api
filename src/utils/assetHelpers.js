/**
 * Utility helpers for working with Stellar asset objects.
 *
 * The Stellar Horizon API represents native XLM with `asset_type === "native"`.
 * The same concept surfaces in normalised internal shapes as `type === "native"`.
 * Centralising the check here means the string literal "native" only lives in
 * one place, and every caller stays consistent.
 */

/**
 * Returns true when the given asset is native XLM.
 *
 * Accepts any of the shapes that appear across the codebase:
 *   - Horizon balance/operation record   → { asset_type: "native" }
 *   - Normalised internal asset shape    → { type: "native" }
 *   - Raw string literal                 → "native"
 *
 * @param {Object|string|null|undefined} asset - Asset to test.
 * @returns {boolean}
 */
function isNativeAsset(asset) {
  if (!asset) return false;
  if (typeof asset === "string") return asset === "native";
  return asset.asset_type === "native" || asset.type === "native";
}

/**
 * Convenience inverse of isNativeAsset.
 *
 * @param {Object|string|null|undefined} asset - Asset to test.
 * @returns {boolean}
 */
function isNonNativeAsset(asset) {
  return !isNativeAsset(asset);
}

module.exports = { isNativeAsset, isNonNativeAsset };
