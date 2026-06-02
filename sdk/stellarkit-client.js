"use strict";

class StellarKitError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "StellarKitError";
    this.status = status;
  }
}

class StellarKitClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl - Base URL of the StellarKit API (e.g. "http://localhost:3000")
   * @param {string} [options.apiKey] - Optional API key sent as X-API-Key header
   */
  constructor({ baseUrl, apiKey } = {}) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey || null;
  }

  async _request(path) {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;

    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    const json = await res.json();

    if (!res.ok) {
      const message = json?.error?.message || res.statusText;
      throw new StellarKitError(res.status, message);
    }

    return json.data;
  }

  // ── Health & Network ────────────────────────────────────────────────────────

  getHealth() {
    return this._request("/health");
  }

  getNetworkStatus() {
    return this._request("/network-status");
  }

  getFeeEstimate(operations) {
    const qs = operations != null ? `?operations=${operations}` : "";
    return this._request(`/fee-estimate${qs}`);
  }

  // ── Account ─────────────────────────────────────────────────────────────────

  getAccount(id) {
    return this._request(`/account/${encodeURIComponent(id)}`);
  }

  getAccountBalances(id) {
    return this._request(`/account/${encodeURIComponent(id)}/balances`);
  }

  getAccountSequence(id) {
    return this._request(`/account/${encodeURIComponent(id)}/sequence`);
  }

  getAccountSummary(id) {
    return this._request(`/account/${encodeURIComponent(id)}/summary`);
  }

  getAccountPayments(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._request(`/account/${encodeURIComponent(id)}/payments${qs ? `?${qs}` : ""}`);
  }

  // ── Transactions ─────────────────────────────────────────────────────────────

  getTransactions(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._request(`/transactions/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
  }

  getTransactionOperations(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._request(`/transactions/${encodeURIComponent(id)}/operations${qs ? `?${qs}` : ""}`);
  }

  // ── Assets ──────────────────────────────────────────────────────────────────

  getAsset(code, issuer) {
    return this._request(`/asset/${encodeURIComponent(code)}/${encodeURIComponent(issuer)}`);
  }

  getAssetHolders(code, issuer, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._request(`/asset/${encodeURIComponent(code)}/${encodeURIComponent(issuer)}/holders${qs ? `?${qs}` : ""}`);
  }

  searchAssets(code) {
    return this._request(`/asset/search?code=${encodeURIComponent(code)}`);
  }
}

module.exports = { StellarKitClient, StellarKitError };
