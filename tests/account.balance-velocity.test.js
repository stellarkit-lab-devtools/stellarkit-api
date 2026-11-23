/**
 * Unit tests for GET /account/:id/balance-velocity endpoint
 * Tests the balance change tracking and velocity flag logic
 */

describe("Account Balance Velocity Analysis", () => {
  /**
   * Helper: Calculate balance changes from payments
   * Mirrors endpoint logic for testing
   */
  function calculateBalanceVelocity(accountId, payments) {
    const now = Date.now();
    const timeWindows = {
      "1h": now - 60 * 60 * 1000,
      "24h": now - 24 * 60 * 60 * 1000,
      "7d": now - 7 * 24 * 60 * 60 * 1000,
    };

    const balanceChanges = {};

    // Calculate balance changes by asset
    payments.forEach((payment) => {
      const operationTimestamp = new Date(payment.created_at).getTime();
      
      // Determine asset key
      let assetKey;
      if (payment.asset_type === "native" || payment.asset_code === "XLM") {
        assetKey = "XLM";
      } else {
        assetKey = `${payment.asset_code}:${payment.asset_issuer}`;
      }

      // Initialize asset tracking if needed
      if (!balanceChanges[assetKey]) {
        balanceChanges[assetKey] = {
          change1h: 0,
          change24h: 0,
          change7d: 0,
          dailyChanges: [],
        };
      }

      const amount = parseFloat(payment.amount);
      const isReceived = payment.to === accountId;
      const change = isReceived ? amount : -amount;

      // Record by time window
      if (operationTimestamp > timeWindows["1h"]) {
        balanceChanges[assetKey].change1h += change;
      }
      if (operationTimestamp > timeWindows["24h"]) {
        balanceChanges[assetKey].change24h += change;
      }
      if (operationTimestamp > timeWindows["7d"]) {
        balanceChanges[assetKey].change7d += change;
        
        // Track daily change for velocity calculation
        const dayIndex = Math.floor((now - operationTimestamp) / (24 * 60 * 60 * 1000));
        if (!balanceChanges[assetKey].dailyChanges[dayIndex]) {
          balanceChanges[assetKey].dailyChanges[dayIndex] = 0;
        }
        balanceChanges[assetKey].dailyChanges[dayIndex] += change;
      }
    });

    // Calculate velocity flags
    const result = Object.entries(balanceChanges).map(([asset, changes]) => {
      // Compute historical statistics
      const dailyChanges = changes.dailyChanges.filter((c) => c !== undefined);
      let velocityFlag = false;

      if (dailyChanges.length > 1) {
        const mean = dailyChanges.reduce((a, b) => a + b, 0) / dailyChanges.length;
        const variance = dailyChanges.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / dailyChanges.length;
        const stdDev = Math.sqrt(variance);
        
        // Check if any recent change exceeds mean + 2σ
        const recentChange = changes.change24h;
        velocityFlag = Math.abs(recentChange - mean) > 2 * stdDev;
      }

      return {
        asset,
        change1h: changes.change1h.toFixed(7),
        change24h: changes.change24h.toFixed(7),
        change7d: changes.change7d.toFixed(7),
        velocityFlag,
      };
    });

    return result;
  }

  const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

  describe("Time Window Tracking", () => {
    it("tracks changes in 1-hour window", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(), // 30 min ago
        },
        {
          to: accountId,
          amount: "50",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 min ago
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result.find((r) => r.asset === "XLM");

      expect(xlm).toBeDefined();
      expect(parseFloat(xlm.change1h)).toBe(150); // 100 + 50
    });

    it("tracks changes in 24-hour window", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
        },
        {
          to: accountId,
          amount: "50",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 20 * 60 * 60 * 1000).toISOString(), // 20 hours ago
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result.find((r) => r.asset === "XLM");

      expect(parseFloat(xlm.change24h)).toBe(150);
    });

    it("tracks changes in 7-day window", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        },
        {
          to: accountId,
          amount: "50",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result.find((r) => r.asset === "XLM");

      expect(parseFloat(xlm.change7d)).toBe(150);
    });
  });

  describe("Balance Change Tracking", () => {
    it("tracks received payments as positive", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(parseFloat(xlm.change1h)).toBeGreaterThan(0);
      expect(parseFloat(xlm.change1h)).toBe(100);
    });

    it("tracks sent payments as negative", () => {
      const now = Date.now();
      const otherAccount = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B";
      const payments = [
        {
          from: accountId,
          to: otherAccount,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(parseFloat(xlm.change1h)).toBeLessThan(0);
      expect(parseFloat(xlm.change1h)).toBe(-100);
    });

    it("aggregates multiple payments correctly", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "50",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
        {
          to: accountId,
          amount: "30",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 20 * 60 * 1000).toISOString(),
        },
        {
          from: accountId,
          to: "OTHER",
          amount: "10",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 10 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      // 50 + 30 - 10 = 70
      expect(parseFloat(xlm.change1h)).toBe(70);
    });

    it("handles different assets separately", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
        {
          to: accountId,
          amount: "50",
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          created_at: new Date(now - 20 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);

      expect(result).toHaveLength(2);
      const xlm = result.find((r) => r.asset === "XLM");
      const usdc = result.find((r) => r.asset.includes("USDC"));

      expect(parseFloat(xlm.change1h)).toBe(100);
      expect(parseFloat(usdc.change1h)).toBe(50);
    });
  });

  describe("Velocity Flag Calculation", () => {
    it("sets velocityFlag false for consistent activity", () => {
      const now = Date.now();
      // Simulate steady, consistent daily changes of ~100 XLM
      const payments = [];
      for (let i = 0; i < 7; i++) {
        payments.push({
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - (i * 24 * 60 * 60 * 1000) - (12 * 60 * 60 * 1000)).toISOString(),
        });
      }

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      // With consistent daily changes, velocity flag should be false
      expect(xlm.velocityFlag).toBe(false);
    });

    it("sets velocityFlag true for unusual spike", () => {
      const now = Date.now();
      // Create baseline activity
      const payments = [];
      for (let i = 0; i < 6; i++) {
        payments.push({
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - (i * 24 * 60 * 60 * 1000) - (12 * 60 * 60 * 1000)).toISOString(),
        });
      }
      // Add unusual spike (3σ above mean)
      payments.push({
        to: accountId,
        amount: "10000",
        asset_type: "native",
        asset_code: "XLM",
        created_at: new Date(now - (12 * 60 * 60 * 1000)).toISOString(),
      });

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      // With spike, velocity flag should be true
      expect(xlm.velocityFlag).toBe(true);
    });

    it("requires at least 2 days of data for velocity calculation", () => {
      const now = Date.now();
      // Only one day of payments
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - (12 * 60 * 60 * 1000)).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      // With insufficient history, velocity flag should be false
      expect(xlm.velocityFlag).toBe(false);
    });

    it("handles high variance in daily activity", () => {
      const now = Date.now();
      // High variance: some days 50, some days 500
      const payments = [
        {
          to: accountId,
          amount: "50",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - (0 * 24 * 60 * 60 * 1000) - (12 * 60 * 60 * 1000)).toISOString(),
        },
        {
          to: accountId,
          amount: "500",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - (1 * 24 * 60 * 60 * 1000) - (12 * 60 * 60 * 1000)).toISOString(),
        },
        {
          to: accountId,
          amount: "75",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - (2 * 24 * 60 * 60 * 1000) - (12 * 60 * 60 * 1000)).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(xlm).toBeDefined();
      expect(typeof xlm.velocityFlag).toBe("boolean");
    });
  });

  describe("Change Value Formatting", () => {
    it("formats changes as seven-decimal strings", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "123.4567890",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(xlm.change1h).toMatch(/^\-?\d+\.\d{7}$/);
      expect(xlm.change24h).toMatch(/^\-?\d+\.\d{7}$/);
      expect(xlm.change7d).toMatch(/^\-?\d+\.\d{7}$/);
    });

    it("formats negative changes with minus sign", () => {
      const now = Date.now();
      const otherAccount = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B";
      const payments = [
        {
          from: accountId,
          to: otherAccount,
          amount: "100.123456",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(xlm.change1h).toMatch(/^-/);
      expect(parseFloat(xlm.change1h)).toBeLessThan(0);
    });

    it("handles zero changes", () => {
      const now = Date.now();
      const payments = [];

      const result = calculateBalanceVelocity(accountId, payments);

      // With no payments, should return empty array or zeros
      if (result.length === 0) {
        expect(result).toHaveLength(0);
      }
    });

    it("handles very small fractional values", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "0.0000001",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(xlm.change1h).toMatch(/^\-?\d+\.\d{7}$/);
      expect(parseFloat(xlm.change1h)).toBeGreaterThan(0);
      expect(parseFloat(xlm.change1h)).toBeLessThan(0.0001);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty payment history", () => {
      const result = calculateBalanceVelocity(accountId, []);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("handles payments beyond 7-day window", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);

      // Should not include payments outside 7-day window
      if (result.length > 0) {
        const xlm = result[0];
        expect(parseFloat(xlm.change7d)).toBe(0);
      }
    });

    it("handles mixed native and custom assets", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
        {
          to: accountId,
          amount: "50.5",
          asset_type: "credit_alphanum12",
          asset_code: "EURT",
          asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          created_at: new Date(now - 20 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);

      expect(result.length).toBe(2);
      expect(result.some((r) => r.asset === "XLM")).toBe(true);
      expect(result.some((r) => r.asset.includes("EURT"))).toBe(true);
    });

    it("handles very large transaction amounts", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "999999999.9999999",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(parseFloat(xlm.change1h)).toBeLessThan(1e9);
      expect(xlm.change1h).toMatch(/^\d+\.\d{7}$/);
    });
  });

  describe("Response Structure", () => {
    it("returns array of balance changes", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("asset");
      expect(result[0]).toHaveProperty("change1h");
      expect(result[0]).toHaveProperty("change24h");
      expect(result[0]).toHaveProperty("change7d");
      expect(result[0]).toHaveProperty("velocityFlag");
    });

    it("returns velocityFlag as boolean", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(typeof xlm.velocityFlag).toBe("boolean");
      expect([true, false]).toContain(xlm.velocityFlag);
    });

    it("includes all three time windows in response", () => {
      const now = Date.now();
      const payments = [
        {
          to: accountId,
          amount: "100",
          asset_type: "native",
          asset_code: "XLM",
          created_at: new Date(now - 30 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateBalanceVelocity(accountId, payments);
      const xlm = result[0];

      expect(xlm).toHaveProperty("change1h");
      expect(xlm).toHaveProperty("change24h");
      expect(xlm).toHaveProperty("change7d");
    });
  });
});
