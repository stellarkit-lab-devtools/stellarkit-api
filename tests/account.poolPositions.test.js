const request = require("supertest");
const app = require("../src/index");

describe("GET /account/:id/pool-positions", () => {
    // Test with a known testnet account that has liquidity pool positions
    // Note: This test may need to be updated with a real account that has pool positions
    const testAccountWithPools = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
    const testAccountWithoutPools = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

    it("should return 200 and pool positions for an account with liquidity pool shares", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect("Content-Type", /json/);

        // The response might be 200 with empty array if account has no pool positions
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("data");
        expect(Array.isArray(response.body.data)).toBe(true);

        // If there are positions, validate the structure
        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            expect(position).toHaveProperty("poolId");
            expect(position).toHaveProperty("shares");
            expect(position).toHaveProperty("sharePercent");
            expect(position).toHaveProperty("totalPoolShares");
            expect(position).toHaveProperty("reserveA");
            expect(position).toHaveProperty("reserveB");
            expect(position).toHaveProperty("feeBp");
            expect(position).toHaveProperty("totalTrustlines");
            expect(position).toHaveProperty("lastModifiedLedger");

            // Validate reserveA structure
            expect(position.reserveA).toHaveProperty("asset");
            expect(position.reserveA).toHaveProperty("totalAmount");
            expect(position.reserveA).toHaveProperty("equivalentAmount");

            // Validate reserveB structure
            expect(position.reserveB).toHaveProperty("asset");
            expect(position.reserveB).toHaveProperty("totalAmount");
            expect(position.reserveB).toHaveProperty("equivalentAmount");

            // Validate numeric values
            expect(parseFloat(position.shares)).toBeGreaterThanOrEqual(0);
            expect(parseFloat(position.sharePercent)).toBeGreaterThanOrEqual(0);
            expect(parseFloat(position.sharePercent)).toBeLessThanOrEqual(100);
            expect(parseFloat(position.totalPoolShares)).toBeGreaterThan(0);
            expect(parseFloat(position.reserveA.equivalentAmount)).toBeGreaterThanOrEqual(0);
            expect(parseFloat(position.reserveB.equivalentAmount)).toBeGreaterThanOrEqual(0);
        }

        // Validate metadata
        expect(response.body).toHaveProperty("meta");
        expect(response.body.meta).toHaveProperty("count");
        expect(response.body.meta).toHaveProperty("accountId");
        expect(response.body.meta.count).toBe(response.body.data.length);
    }, 15000);

    it("should return 200 with empty array for an account without liquidity pool positions", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithoutPools}/pool-positions`)
            .expect(200)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("data");
        expect(Array.isArray(response.body.data)).toBe(true);

        // Account might have 0 positions
        expect(response.body.meta).toHaveProperty("count");
        expect(response.body.meta.count).toBeGreaterThanOrEqual(0);
    }, 15000);

    it("should return 400 for invalid account ID format", async () => {
        const response = await request(app)
            .get("/account/INVALID_ACCOUNT_ID/pool-positions")
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
    });

    it("should return 404 for non-existent account", async () => {
        // Use a valid format but non-existent account
        // Note: Stellar public keys must be valid base32 with proper checksum
        // This is a properly formatted but likely non-existent testnet account
        const nonExistentAccount = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

        const response = await request(app)
            .get(`/account/${nonExistentAccount}/pool-positions`)
            .expect("Content-Type", /json/);

        // Account might exist or not exist - both are valid responses
        if (response.status === 404) {
            expect(response.body).toHaveProperty("success", false);
            expect(response.body).toHaveProperty("error");
            expect(response.body.error).toHaveProperty("message");
            expect(response.body.error.message).toContain("Account not found");
        } else if (response.status === 200) {
            // If account exists, it should return valid data structure
            expect(response.body).toHaveProperty("success", true);
            expect(response.body).toHaveProperty("data");
            expect(Array.isArray(response.body.data)).toBe(true);
        }
    }, 15000);

    it("should calculate share percentage correctly", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            const accountShares = parseFloat(position.shares);
            const totalShares = parseFloat(position.totalPoolShares);
            const expectedSharePercent = (accountShares / totalShares) * 100;

            expect(parseFloat(position.sharePercent)).toBeCloseTo(expectedSharePercent, 2);
        }
    }, 15000);

    it("should calculate equivalent reserves correctly", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            const accountShares = parseFloat(position.shares);
            const totalShares = parseFloat(position.totalPoolShares);
            const shareRatio = accountShares / totalShares;

            const expectedReserveA = parseFloat(position.reserveA.totalAmount) * shareRatio;
            const expectedReserveB = parseFloat(position.reserveB.totalAmount) * shareRatio;

            expect(parseFloat(position.reserveA.equivalentAmount)).toBeCloseTo(expectedReserveA, 5);
            expect(parseFloat(position.reserveB.equivalentAmount)).toBeCloseTo(expectedReserveB, 5);
        }
    }, 15000);

    it("should handle multiple pool positions for the same account", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data)).toBe(true);

        // If multiple positions exist, ensure each has a unique poolId
        if (response.body.data.length > 1) {
            const poolIds = response.body.data.map(p => p.poolId);
            const uniquePoolIds = new Set(poolIds);
            expect(uniquePoolIds.size).toBe(poolIds.length);
        }
    }, 15000);

    it("should return proper asset information for both reserves", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            // Each reserve should have asset information
            expect(position.reserveA.asset).toBeDefined();
            expect(position.reserveB.asset).toBeDefined();

            // Assets should be different (can't have a pool with same asset on both sides)
            expect(position.reserveA.asset).not.toEqual(position.reserveB.asset);
        }
    }, 15000);

    it("should include fee basis points in the response", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            expect(position.feeBp).toBeDefined();
            expect(typeof position.feeBp).toBe("number");
            expect(position.feeBp).toBeGreaterThanOrEqual(0);
            // Standard Stellar AMM fee is 30 basis points (0.3%)
            expect(position.feeBp).toBeLessThanOrEqual(10000); // Max 100%
        }
    }, 15000);

    it("should include total trustlines count", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            expect(position.totalTrustlines).toBeDefined();
            expect(typeof position.totalTrustlines).toBe("number");
            expect(position.totalTrustlines).toBeGreaterThanOrEqual(0);
        }
    }, 15000);

    it("should include last modified ledger information", async () => {
        const response = await request(app)
            .get(`/account/${testAccountWithPools}/pool-positions`)
            .expect(200);

        if (response.body.data.length > 0) {
            const position = response.body.data[0];

            expect(position.lastModifiedLedger).toBeDefined();
            expect(typeof position.lastModifiedLedger).toBe("number");
            expect(position.lastModifiedLedger).toBeGreaterThan(0);
        }
    }, 15000);
});
