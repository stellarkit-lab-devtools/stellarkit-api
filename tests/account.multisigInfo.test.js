/**
 * Tests for GET /account/:id/multisig-info
 *
 * Covers:
 *   - Returns isMultisig, thresholds (low/medium/high), masterWeight, signers list
 *   - isMultisig=true  when multiple signers exist
 *   - isMultisig=false when account has only the master key with default thresholds
 *   - isMultisig=true  when thresholds exceed the master key weight
 *   - isMultisig is always a strict boolean (true/false), never truthy/falsy
 *   - Signer types are normalised to human-readable strings (hash_x, pre_auth_tx, ed25519_public_key)
 *   - No snake_case field names in the response
 *   - sponsoredBy is always present on each signer as a string or null
 *   - Returns 404 when account does not exist
 *   - Returns 400 for an invalid account address
 */
const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const accountId = Keypair.random().publicKey();
const signer1 = Keypair.random().publicKey();
const signer2 = Keypair.random().publicKey();
const sponsorId = Keypair.random().publicKey();

// ── Happy path: multisig account ──────────────────────────────────────────

describe("GET /account/:id/multisig-info — multisig account", () => {
  beforeEach(() => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
        { key: signer1, type: "ed25519_public_key", weight: 3 },
        { key: signer2, type: "sha256_hash", weight: 2 },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 3,
        high_threshold: 5,
      },
    });
  });

  it("returns HTTP 200", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(200);
  });

  it("success flag is true", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.success).toBe(true);
  });

  it("isMultisig is true when there are multiple signers", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.isMultisig).toBe(true);
  });

  it("isMultisig is a strict boolean (not just truthy)", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(typeof res.body.data.isMultisig).toBe("boolean");
  });

  it("returns the correct accountId", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.accountId).toBe(accountId);
  });

  it("thresholds object contains low, medium, high", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const { thresholds } = res.body.data;
    expect(thresholds).toEqual({ low: 1, medium: 3, high: 5 });
  });

  it("masterWeight equals the weight of the account's own key", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.masterWeight).toBe(1);
  });

  it("signers array includes all registered signers", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.signers).toHaveLength(3);
  });

  it("signerCount matches the length of signers array", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.signerCount).toBe(res.body.data.signers.length);
  });

  it("each signer has key, weight, type, and sponsoredBy fields", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    for (const signer of res.body.data.signers) {
      expect(signer).toHaveProperty("key");
      expect(signer).toHaveProperty("weight");
      expect(signer).toHaveProperty("type");
      expect(signer).toHaveProperty("sponsoredBy");
    }
  });

  it("sha256_hash signer type is normalised to human-readable 'hash_x'", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const hashXSigner = res.body.data.signers.find((s) => s.key === signer2);
    expect(hashXSigner).toBeDefined();
    expect(hashXSigner.type).toBe("hash_x");
  });

  it("ed25519_public_key signer type is preserved as-is", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const ed25519Signer = res.body.data.signers.find((s) => s.key === signer1);
    expect(ed25519Signer.type).toBe("ed25519_public_key");
  });

  it("sponsoredBy is null for unsponsored signers", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    for (const signer of res.body.data.signers) {
      expect(signer.sponsoredBy).toBeNull();
    }
  });

  it("no snake_case field names in the response data", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const json = JSON.stringify(res.body.data);
    // Spot-check that raw Horizon snake_case names are absent
    expect(json).not.toMatch(/"low_threshold":/);
    expect(json).not.toMatch(/"med_threshold":/);
    expect(json).not.toMatch(/"high_threshold":/);
    expect(json).not.toMatch(/"sponsored_by":/);
  });
});

// ── sponsoredBy is present when a signer has a sponsor ──────────────────

describe("GET /account/:id/multisig-info — sponsored signer", () => {
  it("sponsoredBy is the sponsor public key when the signer is sponsored", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
        { key: signer1, type: "ed25519_public_key", weight: 2, sponsor: sponsorId },
      ],
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    });

    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(200);

    const sponsored = res.body.data.signers.find((s) => s.key === signer1);
    expect(sponsored).toBeDefined();
    expect(sponsored.sponsoredBy).toBe(sponsorId);
  });

  it("sponsoredBy is always present even when no signers have a sponsor", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
      ],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    });

    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(200);

    const master = res.body.data.signers[0];
    expect(master).toHaveProperty("sponsoredBy");
    expect(master.sponsoredBy).toBeNull();
  });
});

// ── pre_auth_tx signer type ───────────────────────────────────────────────

describe("GET /account/:id/multisig-info — pre_auth_tx signer type", () => {
  it("preauth_tx is normalised to 'pre_auth_tx'", async () => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
        { key: signer1, type: "preauth_tx", weight: 1 },
      ],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    });

    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const preAuthSigner = res.body.data.signers.find((s) => s.key === signer1);
    expect(preAuthSigner.type).toBe("pre_auth_tx");
  });
});

// ── Single-signer account (not multisig) ─────────────────────────────────

describe("GET /account/:id/multisig-info — single signer account", () => {
  beforeEach(() => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 1,
        high_threshold: 1,
      },
    });
  });

  it("isMultisig is false for a single-signer account", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.isMultisig).toBe(false);
  });

  it("isMultisig is a strict boolean false (not null/undefined/0)", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.isMultisig).toStrictEqual(false);
    expect(typeof res.body.data.isMultisig).toBe("boolean");
  });

  it("signerCount is 1", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.signerCount).toBe(1);
  });
});

// ── isMultisig=true via threshold exceeding master weight ─────────────────

describe("GET /account/:id/multisig-info — high threshold exceeds master weight", () => {
  beforeEach(() => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
        { key: signer1, type: "ed25519_public_key", weight: 5 },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 3,
        high_threshold: 6,
      },
    });
  });

  it("isMultisig is true because high threshold (6) exceeds master weight (1)", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.isMultisig).toBe(true);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────

describe("GET /account/:id/multisig-info — error cases", () => {
  it("returns 404 when account does not exist on Horizon", async () => {
    const horizonError = new Error("Not found");
    horizonError.response = { status: 404, data: { title: "Resource Missing" } };
    server.loadAccount.mockRejectedValue(horizonError);

    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for an invalid account address", async () => {
    const res = await request(app).get("/account/NOTAVALIDKEY/multisig-info");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
