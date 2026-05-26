const axios = require("axios");
const toml = require("toml");

function normalizeHomeDomain(homeDomain) {
  if (!homeDomain || typeof homeDomain !== "string") return null;

  const trimmed = homeDomain.trim();
  if (!trimmed) return null;

  return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function findCurrency(currencies, assetCode, assetIssuer) {
  if (!Array.isArray(currencies)) return null;

  return currencies.find(
    (currency) =>
      currency &&
      currency.code === assetCode &&
      (!currency.issuer || currency.issuer === assetIssuer),
  );
}

function toAssetToml(currency) {
  if (!currency) return null;

  return {
    name: currency.name || null,
    description: currency.desc || currency.description || null,
    image: currency.image || null,
  };
}

function getAssetToml(stellarToml, assetCode, assetIssuer) {
  if (!stellarToml) return null;
  return toAssetToml(
    findCurrency(stellarToml.CURRENCIES, assetCode, assetIssuer),
  );
}

async function fetchStellarToml(homeDomain) {
  const domain = normalizeHomeDomain(homeDomain);
  if (!domain) return null;

  try {
    const { data } = await axios.get(
      `https://${domain}/.well-known/stellar.toml`,
      {
        responseType: "text",
        timeout: 5000,
      },
    );
    return toml.parse(data);
  } catch (_) {
    return null;
  }
}

async function fetchAssetToml(homeDomain, assetCode, assetIssuer) {
  return getAssetToml(
    await fetchStellarToml(homeDomain),
    assetCode,
    assetIssuer,
  );
}

module.exports = {
  fetchAssetToml,
  fetchStellarToml,
  getAssetToml,
  normalizeHomeDomain,
};
