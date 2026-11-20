const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

describe("GET /account/:id/delegated-signers", () => {
  const accountId = Keypair.random().publicKey();
  const delegatedSignerId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("never includes the primary account master key", async () => {
    server.loadAccount
      .mockResolvedValueOnce({
        id: accountId,
        signers: [
          { key: accountId, weight: 1, type: "ed25519_public_key" },
          { key: delegatedSignerId, weight: 2, type: "ed25519_public_key" },
        ],
      })
      .mockResolvedValueOnce({
        id: delegatedSignerId,
        signers: [{ key: delegatedSignerId, weight: 1 }],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      });

    const res = await request(app).get(`/account/${accountId}/delegated-signers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.delegatedSigners.map((signer) => signer.key)).toEqual([
      delegatedSignerId,
    ]);
    expect(res.body.data.delegatedSigners.some((signer) => signer.key === accountId)).toBe(false);
    expect(server.loadAccount).toHaveBeenNthCalledWith(1, accountId);
    expect(server.loadAccount).toHaveBeenNthCalledWith(2, delegatedSignerId);
  });

  it("marks a signer account with multiple keys as multisig", async () => {
    const secondSigner = Keypair.random().publicKey();
    server.loadAccount
      .mockResolvedValueOnce({
        id: accountId,
        signers: [{ key: delegatedSignerId, weight: 1, type: "ed25519_public_key" }],
      })
      .mockResolvedValueOnce({
        id: delegatedSignerId,
        signers: [
          { key: delegatedSignerId, weight: 1 },
          { key: secondSigner, weight: 1 },
        ],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      });

    const res = await request(app).get(`/account/${accountId}/delegated-signers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.delegatedSigners).toEqual([
      expect.objectContaining({ key: delegatedSignerId, isMultisig: true }),
    ]);
    expect(server.loadAccount).toHaveBeenNthCalledWith(2, delegatedSignerId);
  });

  it("marks a signer account with only its master key as not multisig", async () => {
    server.loadAccount
      .mockResolvedValueOnce({
        id: accountId,
        signers: [{ key: delegatedSignerId, weight: 1, type: "ed25519_public_key" }],
      })
      .mockResolvedValueOnce({
        id: delegatedSignerId,
        signers: [{ key: delegatedSignerId, weight: 1 }],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      });

    const res = await request(app).get(`/account/${accountId}/delegated-signers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.delegatedSigners).toEqual([
      expect.objectContaining({ key: delegatedSignerId, isMultisig: false }),
    ]);
    expect(server.loadAccount).toHaveBeenNthCalledWith(1, accountId);
    expect(server.loadAccount).toHaveBeenNthCalledWith(2, delegatedSignerId);
  });

  it("returns an empty list when there are no additional signers", async () => {
    server.loadAccount.mockResolvedValueOnce({
      id: accountId,
      signers: [{ key: accountId, weight: 1, type: "ed25519_public_key" }],
    });

    const res = await request(app).get(`/account/${accountId}/delegated-signers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.delegatedSigners).toEqual([]);
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
    expect(server.loadAccount).toHaveBeenCalledWith(accountId);
  });
});