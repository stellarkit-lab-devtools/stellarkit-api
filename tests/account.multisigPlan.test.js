const request = require("supertest");
const app = require("../src/index");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
    const originalModule = jest.requireActual("../src/config/stellar");
    return {
        ...originalModule,
        server: {
            loadAccount: jest.fn(),
        },
    };
});

const { server } = require("../src/config/stellar");

describe("Account Multisig Plan API", () => {
    const accountId = Keypair.random().publicKey();
    const signer1 = Keypair.random().publicKey();
    const signer2 = Keypair.random().publicKey();
    const signer3 = Keypair.random().publicKey();
    const unknownSigner = Keypair.random().publicKey();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns valid combinations for all thresholds with matching signers", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 3 },
                { key: signer2, type: "ed25519_public_key", weight: 2 },
                { key: signer3, type: "ed25519_public_key", weight: 5 },
            ],
            thresholds: {
                low_threshold: 3,
                med_threshold: 5,
                high_threshold: 8,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1, signer2, signer3],
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("lowThreshold", 3);
        expect(res.body.data).toHaveProperty("medThreshold", 5);
        expect(res.body.data).toHaveProperty("highThreshold", 8);
        expect(res.body.data).toHaveProperty("signerWeights");
        expect(res.body.data).toHaveProperty("validCombinations");

        // signer1 (3) meets low threshold, signer3 (5) also meets it alone
        expect(res.body.data.validCombinations.low).toHaveLength(2);
        expect(
            res.body.data.validCombinations.low.some(combo =>
                combo.some(s => s.key === signer1)
            )
        ).toBe(true);
        expect(
            res.body.data.validCombinations.low.some(combo =>
                combo.some(s => s.key === signer3)
            )
        ).toBe(true);

        // med threshold (5) can be met by signer3 alone (weight 5)
        expect(res.body.data.validCombinations.med.length).toBeGreaterThan(0);
        expect(res.body.data.validCombinations.med).toContainEqual(
            expect.arrayContaining([expect.objectContaining({ key: signer3 })])
        );

        // signer3 (5) + signer1 (3) = 8 meets high threshold
        expect(res.body.data.validCombinations.high.length).toBeGreaterThan(0);
    });

    it("returns only signers that exist on the account", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 5 },
                { key: signer2, type: "ed25519_public_key", weight: 3 },
            ],
            thresholds: {
                low_threshold: 2,
                med_threshold: 4,
                high_threshold: 6,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1, signer2, unknownSigner],
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.signerWeights).toHaveLength(2);
        expect(res.body.data.signerWeights.map(s => s.key)).toEqual(
            expect.arrayContaining([signer1, signer2])
        );
        expect(res.body.data.signerWeights.map(s => s.key)).not.toContain(unknownSigner);
    });

    it("returns empty combinations if threshold cannot be met", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 2 },
            ],
            thresholds: {
                low_threshold: 5,
                med_threshold: 10,
                high_threshold: 15,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1],
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.validCombinations.low).toEqual([]);
        expect(res.body.data.validCombinations.med).toEqual([]);
        expect(res.body.data.validCombinations.high).toEqual([]);
    });

    it("returns multiple valid combinations for a threshold", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 5 },
                { key: signer2, type: "ed25519_public_key", weight: 5 },
                { key: signer3, type: "ed25519_public_key", weight: 5 },
            ],
            thresholds: {
                low_threshold: 5,
                med_threshold: 10,
                high_threshold: 15,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1, signer2, signer3],
            });

        expect(res.statusCode).toBe(200);
        // low threshold (5) can be met by any single signer
        expect(res.body.data.validCombinations.low).toHaveLength(3);

        // med threshold (10) can be met by any two signers
        expect(res.body.data.validCombinations.med).toHaveLength(3);

        // high threshold (15) requires all three signers
        expect(res.body.data.validCombinations.high).toHaveLength(1);
    });

    it("returns 400 for invalid signer key", async () => {
        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: ["INVALID_KEY"],
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toContain("Invalid signer key");
    });

    it("returns 400 for invalid account ID", async () => {
        const res = await request(app)
            .post("/account/INVALID_ID/multisig-plan")
            .send({
                availableSigners: [signer1],
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 if availableSigners is not an array", async () => {
        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: "not an array",
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toContain("availableSigners must be an array");
    });

    it("returns 400 if availableSigners is missing", async () => {
        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({});

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when account does not exist", async () => {
        const horizonError = new Error("Not found");
        horizonError.response = {
            status: 404,
            data: {
                title: "Resource Not Found",
                detail: "The resource at the url requested was not found.",
            },
        };

        server.loadAccount.mockRejectedValue(horizonError);

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1],
            });

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns signer weights with correct details", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 3 },
                { key: signer2, type: "sha256_hash", weight: 2 },
            ],
            thresholds: {
                low_threshold: 2,
                med_threshold: 4,
                high_threshold: 6,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1, signer2],
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.signerWeights).toEqual([
            { key: signer1, weight: 3, type: "ed25519_public_key" },
            { key: signer2, weight: 2, type: "sha256_hash" },
        ]);
    });

    it("handles zero threshold correctly", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 5 },
            ],
            thresholds: {
                low_threshold: 0,
                med_threshold: 5,
                high_threshold: 10,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1],
            });

        expect(res.statusCode).toBe(200);
        // Zero threshold can be met with empty combination
        expect(res.body.data.validCombinations.low).toEqual([[]]);
    });

    it("finds minimal combinations avoiding larger sets", async () => {
        server.loadAccount.mockResolvedValue({
            id: accountId,
            signers: [
                { key: accountId, type: "ed25519_public_key", weight: 1 },
                { key: signer1, type: "ed25519_public_key", weight: 10 },
                { key: signer2, type: "ed25519_public_key", weight: 5 },
                { key: signer3, type: "ed25519_public_key", weight: 3 },
            ],
            thresholds: {
                low_threshold: 5,
                med_threshold: 10,
                high_threshold: 15,
            },
        });

        const res = await request(app)
            .post(`/account/${accountId}/multisig-plan`)
            .send({
                availableSigners: [signer1, signer2, signer3],
            });

        expect(res.statusCode).toBe(200);
        // For low (5): both signer1 (10) and signer2 (5) meet it individually
        expect(res.body.data.validCombinations.low).toHaveLength(2);

        // For med (10): only signer1 alone meets it
        expect(res.body.data.validCombinations.med).toEqual([
            [expect.objectContaining({ key: signer1 })],
        ]);

        // For high (15): signer1 + signer2 is minimal
        expect(res.body.data.validCombinations.high[0]).toHaveLength(2);
    });
});
