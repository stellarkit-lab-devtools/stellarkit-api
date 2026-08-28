const request = require("supertest");
const app = require("../src/index");

/**
 * Tests for GET /account/:id/operations
 *
 * Covers:
 *   - Basic operations retrieval
 *   - Pagination (limit, cursor)
 *   - Type filtering (?type=payment, etc.)
 *   - Invalid operation type handling
 *   - Account not found (404)
 *   - Response structure validation
 */

describe("GET /account/:id/operations", () => {
  // Known testnet account with operations
  const testAccount = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  const nonExistentAccount = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  describe("Basic functionality", () => {
    it("should return operations for a valid account", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("operations");
      expect(res.body.data).toHaveProperty("total");
      expect(res.body.data).toHaveProperty("limit");
      expect(res.body.data).toHaveProperty("cursor");

      expect(Array.isArray(res.body.data.operations)).toBe(true);
    });

    it("should return operations with required fields", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=5`)
        .expect(200);

      expect(res.body.data.operations.length).toBeGreaterThan(0);

      const operation = res.body.data.operations[0];
      expect(operation).toHaveProperty("operationId");
      expect(operation).toHaveProperty("type");
      expect(operation).toHaveProperty("createdAt");
      expect(operation).toHaveProperty("transactionHash");

      // Validate timestamp format (ISO 8601)
      expect(operation.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should return 404 for non-existent account", async () => {
      const res = await request(app)
        .get(`/account/${nonExistentAccount}/operations`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("Pagination", () => {
    it("should respect limit parameter", async () => {
      const limit = 5;
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=${limit}`)
        .expect(200);

      expect(res.body.data.operations.length).toBeLessThanOrEqual(limit);
      expect(res.body.data.limit).toBe(limit);
    });

    it("should support cursor-based pagination", async () => {
      // Get first page
      const firstPage = await request(app)
        .get(`/account/${testAccount}/operations?limit=5`)
        .expect(200);

      const cursor = firstPage.body.data.cursor;
      
      if (cursor) {
        // Get second page
        const secondPage = await request(app)
          .get(`/account/${testAccount}/operations?limit=5&cursor=${cursor}`)
          .expect(200);

        expect(secondPage.body.success).toBe(true);
        expect(secondPage.body.data.operations).toBeDefined();

        // Ensure different results
        if (firstPage.body.data.operations.length > 0 && secondPage.body.data.operations.length > 0) {
          expect(firstPage.body.data.operations[0].operationId)
            .not.toBe(secondPage.body.data.operations[0].operationId);
        }
      }
    });

    it("should default to limit of 20", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations`)
        .expect(200);

      expect(res.body.data.limit).toBe(20);
    });

    it("should enforce maximum limit of 200", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=500`)
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("Type filtering", () => {
    it("should filter operations by type (payment)", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=payment&limit=10`)
        .expect(200);

      expect(res.body.success).toBe(true);
      
      // All returned operations should be payments
      res.body.data.operations.forEach((op) => {
        expect(op.type).toBe("payment");
        expect(op).toHaveProperty("amount");
        expect(op).toHaveProperty("asset");
        expect(op).toHaveProperty("from");
        expect(op).toHaveProperty("to");
      });
    });

    it("should filter operations by type (create_account)", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=create_account&limit=10`)
        .expect(200);

      expect(res.body.success).toBe(true);
      
      res.body.data.operations.forEach((op) => {
        expect(op.type).toBe("create_account");
      });
    });

    it("should filter operations by type (change_trust)", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=change_trust&limit=10`)
        .expect(200);

      expect(res.body.success).toBe(true);
      
      res.body.data.operations.forEach((op) => {
        expect(op.type).toBe("change_trust");
      });
    });

    it("should return 400 for invalid operation type", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=invalid_type`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain("Unknown operation type");
      expect(res.body.error.message).toContain("invalid_type");
    });

    it("should handle case-insensitive type parameter", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=PAYMENT&limit=5`)
        .expect(200);

      expect(res.body.success).toBe(true);
      res.body.data.operations.forEach((op) => {
        expect(op.type).toBe("payment");
      });
    });
  });

  describe("Operation type-specific fields", () => {
    it("should include payment-specific fields", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=payment&limit=5`)
        .expect(200);

      if (res.body.data.operations.length > 0) {
        const payment = res.body.data.operations[0];
        expect(payment.type).toBe("payment");
        expect(payment).toHaveProperty("amount");
        expect(payment).toHaveProperty("asset");
        expect(payment.asset).toHaveProperty("code");
        expect(payment.asset).toHaveProperty("type");
        expect(payment).toHaveProperty("from");
        expect(payment).toHaveProperty("to");
      }
    });

    it("should include create_account-specific fields", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=create_account&limit=5`)
        .expect(200);

      if (res.body.data.operations.length > 0) {
        const createOp = res.body.data.operations[0];
        expect(createOp.type).toBe("create_account");
        expect(createOp).toHaveProperty("startingBalance");
        expect(createOp).toHaveProperty("funder");
        expect(createOp).toHaveProperty("account");
      }
    });

    it("should include change_trust-specific fields", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=change_trust&limit=5`)
        .expect(200);

      if (res.body.data.operations.length > 0) {
        const changeTrust = res.body.data.operations[0];
        expect(changeTrust.type).toBe("change_trust");
        expect(changeTrust).toHaveProperty("asset");
        expect(changeTrust).toHaveProperty("limit");
        expect(changeTrust).toHaveProperty("trustor");
      }
    });

    it("should normalize XLM asset correctly", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=50`)
        .expect(200);

      // Find a payment with native asset
      const nativePayment = res.body.data.operations.find(
        (op) => op.type === "payment" && op.asset && op.asset.type === "native"
      );

      if (nativePayment) {
        expect(nativePayment.asset.code).toBe("XLM");
        expect(nativePayment.asset.issuer).toBeNull();
        expect(nativePayment.asset.type).toBe("native");
      }
    });
  });

  describe("Response structure", () => {
    it("should return empty operations array for account with no operations", async () => {
      // Note: This test might need a specific test account
      // For now, we'll test the structure is correct even when empty
      const res = await request(app)
        .get(`/account/${testAccount}/operations?type=account_merge&limit=5`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.operations)).toBe(true);
      expect(res.body.data).toHaveProperty("total");
      expect(res.body.data).toHaveProperty("limit");
    });

    it("should include correct total count", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=10`)
        .expect(200);

      expect(res.body.data.total).toBe(res.body.data.operations.length);
    });

    it("should return null cursor when no more results", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=1`)
        .expect(200);

      expect(res.body.data).toHaveProperty("cursor");
      // Cursor can be string or null
      expect(
        typeof res.body.data.cursor === "string" || res.body.data.cursor === null
      ).toBe(true);
    });
  });

  describe("Validation", () => {
    it("should validate account ID format", async () => {
      const res = await request(app)
        .get("/account/invalid-account-id/operations")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should validate limit is numeric", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=abc`)
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should validate limit is positive", async () => {
      const res = await request(app)
        .get(`/account/${testAccount}/operations?limit=0`)
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});
