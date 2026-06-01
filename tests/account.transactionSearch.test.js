const request = require("supertest");
const app = require("../src/index");

describe("GET /account/:id/transactions/search", () => {
    // Test with a known testnet account
    const testAccount = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

    it("should return 400 if memo parameter is missing", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search`)
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toHaveProperty("message");
        expect(response.body.error.message).toContain("memo");
    });

    it("should return 400 for invalid account ID format", async () => {
        const response = await request(app)
            .get("/account/INVALID_ACCOUNT_ID/transactions/search?memo=test")
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
    });

    it("should return 400 for invalid memo_type parameter", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test&memo_type=invalid`)
            .expect(400)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error.message).toContain("memo_type");
    });

    it("should return 200 with valid memo search query", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test`)
            .expect(200)
            .expect("Content-Type", /json/);

        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("data");
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body).toHaveProperty("meta");

        // Validate meta structure
        expect(response.body.meta).toHaveProperty("count");
        expect(response.body.meta).toHaveProperty("limit");
        expect(response.body.meta).toHaveProperty("order");
        expect(response.body.meta).toHaveProperty("searchQuery");
        expect(response.body.meta.searchQuery).toHaveProperty("memo", "test");
        expect(response.body.meta.searchQuery).toHaveProperty("memoType");
    }, 15000);

    it("should return transactions in the same shape as /transactions/:id", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test`)
            .expect(200);

        if (response.body.data.length > 0) {
            const transaction = response.body.data[0];

            // Validate transaction structure matches /transactions/:id format
            expect(transaction).toHaveProperty("id");
            expect(transaction).toHaveProperty("hash");
            expect(transaction).toHaveProperty("ledger");
            expect(transaction).toHaveProperty("createdAt");
            expect(transaction).toHaveProperty("sourceAccount");
            expect(transaction).toHaveProperty("fee");
            expect(transaction.fee).toHaveProperty("charged");
            expect(transaction.fee).toHaveProperty("account");
            expect(transaction).toHaveProperty("feeSummary");
            expect(transaction).toHaveProperty("operationCount");
            expect(transaction).toHaveProperty("memoType");
            expect(transaction).toHaveProperty("memo");
            expect(transaction).toHaveProperty("successful");
            expect(transaction).toHaveProperty("envelopeXdr");
        }
    }, 15000);

    it("should support limit parameter", async () => {
        const limit = 5;
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test&limit=${limit}`)
            .expect(200);

        expect(response.body.meta.limit).toBe(limit);
        expect(response.body.data.length).toBeLessThanOrEqual(limit);
    }, 15000);

    it("should support order parameter", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test&order=asc`)
            .expect(200);

        expect(response.body.meta.order).toBe("asc");
    }, 15000);

    it("should support memo_type filter for text memos", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test&memo_type=text`)
            .expect(200);

        expect(response.body.meta.searchQuery.memoType).toBe("text");

        // All returned transactions should have memo_type === "text"
        response.body.data.forEach(tx => {
            expect(tx.memoType).toBe("text");
        });
    }, 15000);

    it("should support memo_type filter for id memos", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=12345&memo_type=id`)
            .expect(200);

        expect(response.body.meta.searchQuery.memoType).toBe("id");

        // All returned transactions should have memo_type === "id"
        response.body.data.forEach(tx => {
            expect(tx.memoType).toBe("id");
        });
    }, 15000);

    it("should support memo_type filter for hash memos", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=abcd1234&memo_type=hash`)
            .expect(200);

        expect(response.body.meta.searchQuery.memoType).toBe("hash");

        // All returned transactions should have memo_type === "hash"
        response.body.data.forEach(tx => {
            expect(tx.memoType).toBe("hash");
        });
    }, 15000);

    it("should support memo_type filter for return memos", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=abcd1234&memo_type=return`)
            .expect(200);

        expect(response.body.meta.searchQuery.memoType).toBe("return");

        // All returned transactions should have memo_type === "return"
        response.body.data.forEach(tx => {
            expect(tx.memoType).toBe("return");
        });
    }, 15000);

    it("should perform case-insensitive search for text memos", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=TEST`)
            .expect(200);

        // If there are results, they should match case-insensitively
        response.body.data.forEach(tx => {
            if (tx.memoType === "text") {
                expect(tx.memo.toLowerCase()).toContain("test");
            }
        });
    }, 15000);

    it("should perform substring match for text memos", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=inv`)
            .expect(200);

        // If there are text memo results, they should contain the substring
        response.body.data.forEach(tx => {
            if (tx.memoType === "text") {
                expect(tx.memo.toLowerCase()).toContain("inv");
            }
        });
    }, 15000);

    it("should return empty array when no transactions match", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=NONEXISTENT_MEMO_VALUE_12345`)
            .expect(200);

        expect(response.body.data).toEqual([]);
        expect(response.body.meta.count).toBe(0);
    }, 15000);

    it("should include pagination metadata", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test`)
            .expect(200);

        expect(response.body.meta).toHaveProperty("hasMore");
        expect(typeof response.body.meta.hasMore).toBe("boolean");
        expect(response.body.meta).toHaveProperty("nextCursor");
    }, 15000);

    it("should support cursor pagination", async () => {
        const firstResponse = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test&limit=2`)
            .expect(200);

        if (firstResponse.body.meta.nextCursor) {
            const secondResponse = await request(app)
                .get(`/account/${testAccount}/transactions/search?memo=test&limit=2&cursor=${firstResponse.body.meta.nextCursor}`)
                .expect(200);

            expect(secondResponse.body).toHaveProperty("success", true);
            expect(Array.isArray(secondResponse.body.data)).toBe(true);
        }
    }, 15000);

    it("should validate limit parameter range", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test&limit=999`)
            .expect(400);

        expect(response.body).toHaveProperty("success", false);
        expect(response.body.error.message).toContain("Limit");
    });

    it("should return only successful transactions", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test`)
            .expect(200);

        // All returned transactions should be successful
        response.body.data.forEach(tx => {
            expect(tx.successful).toBe(true);
        });
    }, 15000);

    it("should include fee summary in response", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test`)
            .expect(200);

        if (response.body.data.length > 0) {
            const transaction = response.body.data[0];

            expect(transaction.feeSummary).toHaveProperty("chargedInStroops");
            expect(transaction.feeSummary).toHaveProperty("chargedInXLM");
            expect(transaction.feeSummary).toHaveProperty("perOperationInStroops");
            expect(transaction.feeSummary).toHaveProperty("perOperationInXLM");

            expect(typeof transaction.feeSummary.chargedInStroops).toBe("number");
            expect(typeof transaction.feeSummary.chargedInXLM).toBe("string");
        }
    }, 15000);

    it("should handle accounts with no transactions gracefully", async () => {
        // Use a valid but likely empty account
        const emptyAccount = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

        const response = await request(app)
            .get(`/account/${emptyAccount}/transactions/search?memo=test`)
            .expect("Content-Type", /json/);

        // Should return 200 (account exists) or 404 (account doesn't exist)
        // Both are valid responses
        if (response.status === 200) {
            // If account exists, should return valid structure
            expect(response.body).toHaveProperty("success", true);
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.meta).toHaveProperty("count");
        } else if (response.status === 404) {
            expect(response.body).toHaveProperty("success", false);
        }
    }, 15000);

    it("should not return transactions with memo_type none", async () => {
        const response = await request(app)
            .get(`/account/${testAccount}/transactions/search?memo=test`)
            .expect(200);

        // No transaction should have memo_type === "none"
        response.body.data.forEach(tx => {
            expect(tx.memoType).not.toBe("none");
        });
    }, 15000);
});
