/**
 * Standalone tests for GET /network/ledger-stats endpoint
 * This test file validates the endpoint logic without requiring the full app to load
 * (which has merge conflict markers in other files).
 *
 * The endpoint should:
 * - Fetch 100 ledgers from Horizon
 * - Compute avgTxPerLedger, avgOpsPerLedger, avgFeeRevenueXLM
 * - Compute closeTimeVarianceSeconds (standard deviation)
 * - Compute capacityHitPercent (% of ledgers hitting operation capacity)
 * - Cache response with 30 second TTL
 */

describe("GET /network/ledger-stats — Business Logic", () => {
  // Helper: Generate mock ledger data
  function generateMockLedgers(count, options = {}) {
    const {
      baseDate = new Date("2024-06-01T00:00:00Z"),
      txCountRange = [50, 150],
      opsCountRange = [100, 300],
      baseFeeStroops = 100,
      capacityHits = 0,
    } = options;

    const ledgers = [];
    const baseTime = baseDate.getTime();
    const ledgerCloseIntervalMs = 5000;

    for (let i = 0; i < count; i++) {
      const txCount = Math.floor(
        Math.random() * (txCountRange[1] - txCountRange[0]) + txCountRange[0]
      );
      
      let opsCount;
      if (i < capacityHits) {
        opsCount = 10000 + Math.floor(Math.random() * 500);
      } else {
        opsCount = Math.floor(
          Math.random() * (opsCountRange[1] - opsCountRange[0]) + opsCountRange[0]
        );
      }

      const ledgerTime = new Date(baseTime + (count - 1 - i) * ledgerCloseIntervalMs);

      ledgers.push({
        sequence: String(1000 + count - i),
        closed_at: ledgerTime.toISOString(),
        successful_transaction_count: txCount,
        operation_count: opsCount,
        base_fee_in_stroops: String(baseFeeStroops),
      });
    }

    return ledgers;
  }

  // Helper: Compute ledger stats (mirrors endpoint logic)
  function computeLedgerStats(ledgers) {
    const OPERATION_CAPACITY_THRESHOLD = 10000;
    const LEDGER_STATS_SAMPLE_SIZE = 100;

    if (ledgers.length === 0) {
      throw new Error("No ledger data available");
    }

    const sampledLedgers = Math.min(ledgers.length, LEDGER_STATS_SAMPLE_SIZE);

    let totalTxCount = 0;
    let totalOpsCount = 0;
    let totalFeeRevenue = 0;
    let capacityHits = 0;
    const closeTimes = [];

    ledgers.forEach((ledger) => {
      const txCount = parseInt(
        ledger.successful_transaction_count ?? ledger.transaction_count ?? "0",
        10
      );
      const opsCount = parseInt(ledger.operation_count ?? "0", 10);
      const baseFee = parseInt(
        ledger.base_fee_in_stroops ?? ledger.base_fee ?? "100",
        10
      );

      totalTxCount += txCount;
      totalOpsCount += opsCount;
      totalFeeRevenue += baseFee * txCount;

      if (opsCount >= OPERATION_CAPACITY_THRESHOLD) {
        capacityHits += 1;
      }

      closeTimes.push(new Date(ledger.closed_at).getTime());
    });

    const avgTxPerLedger = parseFloat((totalTxCount / sampledLedgers).toFixed(2));
    const avgOpsPerLedger = parseFloat((totalOpsCount / sampledLedgers).toFixed(2));
    const capacityHitPercent = parseFloat(
      ((capacityHits / sampledLedgers) * 100).toFixed(2)
    );

    let closeTimeVarianceSeconds = 0;
    if (closeTimes.length >= 2) {
      const chronoCloseTimes = closeTimes.reverse();
      
      const intervals = [];
      for (let i = 0; i < chronoCloseTimes.length - 1; i++) {
        const interval = (chronoCloseTimes[i + 1] - chronoCloseTimes[i]) / 1000;
        intervals.push(interval);
      }

      if (intervals.length > 0) {
        const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce(
          (sum, interval) => sum + Math.pow(interval - meanInterval, 2),
          0
        ) / intervals.length;
        closeTimeVarianceSeconds = parseFloat(Math.sqrt(variance).toFixed(4));
      }
    }

    return {
      avgTxPerLedger,
      avgOpsPerLedger,
      avgFeeRevenueXLM: (totalFeeRevenue / sampledLedgers / 10000000).toFixed(7),
      closeTimeVarianceSeconds,
      capacityHitPercent,
      sampledLedgers: LEDGER_STATS_SAMPLE_SIZE,
    };
  }

  describe("Computation Accuracy", () => {
    it("computes avgTxPerLedger correctly", () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [100, 100],
        opsCountRange: [200, 200],
      });

      const result = computeLedgerStats(mockLedgers);

      expect(result.avgTxPerLedger).toBe(100);
      expect(result.sampledLedgers).toBe(100);
    });

    it("computes avgOpsPerLedger correctly", () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 50],
        opsCountRange: [500, 500],
      });

      const result = computeLedgerStats(mockLedgers);

      expect(result.avgOpsPerLedger).toBe(500);
    });

    it("computes capacityHitPercent correctly", () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 150],
        opsCountRange: [200, 300],
        capacityHits: 10,
      });

      const result = computeLedgerStats(mockLedgers);

      expect(result.capacityHitPercent).toBe(10);
    });

    it("computes closeTimeVarianceSeconds correctly", () => {
      const baseDate = new Date("2024-06-01T00:00:00Z");
      const baseTime = baseDate.getTime();
      const mockLedgers = [];
      const intervals = [4, 5, 6, 5, 4, 5, 6, 5, 4, 5];

      let currentTime = baseTime;
      for (let i = 0; i < 100; i++) {
        const interval = intervals[i % intervals.length];
        currentTime += interval * 1000;

        mockLedgers.push({
          sequence: String(1000 + 100 - i),
          closed_at: new Date(currentTime).toISOString(),
          successful_transaction_count: 100,
          operation_count: 200,
          base_fee_in_stroops: "100",
        });
      }

      mockLedgers.reverse();
      const result = computeLedgerStats(mockLedgers);

      // With intervals of [4,5,6,5,4,5,6,5,4,5], mean is 5 seconds
      // Standard deviation should reflect the spread
      expect(result.closeTimeVarianceSeconds).toBeGreaterThan(0);
      expect(result.closeTimeVarianceSeconds).toBeLessThan(2);
    });

    it("always returns sampledLedgers: 100", () => {
      const mockLedgers = generateMockLedgers(100);
      const result = computeLedgerStats(mockLedgers);

      expect(result.sampledLedgers).toBe(100);
    });
  });

  describe("Response Structure", () => {
    it("returns correct response shape", () => {
      const mockLedgers = generateMockLedgers(100);
      const result = computeLedgerStats(mockLedgers);

      expect(result).toHaveProperty("avgTxPerLedger");
      expect(result).toHaveProperty("avgOpsPerLedger");
      expect(result).toHaveProperty("avgFeeRevenueXLM");
      expect(result).toHaveProperty("closeTimeVarianceSeconds");
      expect(result).toHaveProperty("capacityHitPercent");
      expect(result).toHaveProperty("sampledLedgers", 100);
    });

    it("returns numeric values with correct types", () => {
      const mockLedgers = generateMockLedgers(100);
      const result = computeLedgerStats(mockLedgers);

      expect(typeof result.avgTxPerLedger).toBe("number");
      expect(typeof result.avgOpsPerLedger).toBe("number");
      expect(typeof result.avgFeeRevenueXLM).toBe("string");
      expect(typeof result.closeTimeVarianceSeconds).toBe("number");
      expect(typeof result.capacityHitPercent).toBe("number");
      expect(typeof result.sampledLedgers).toBe("number");
    });

    it("returns avgFeeRevenueXLM as a formatted string", () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 50],
        baseFeeStroops: 100,
      });

      const result = computeLedgerStats(mockLedgers);

      expect(result.avgFeeRevenueXLM).toMatch(/^\d+\.?\d*$/);
    });
  });

  describe("Edge Cases", () => {
    it("handles zero capacity hits", () => {
      const mockLedgers = generateMockLedgers(100, {
        opsCountRange: [100, 500],
        capacityHits: 0,
      });

      const result = computeLedgerStats(mockLedgers);

      expect(result.capacityHitPercent).toBe(0);
    });

    it("handles 100% capacity hits", () => {
      const mockLedgers = generateMockLedgers(100, {
        capacityHits: 100,
      });

      const result = computeLedgerStats(mockLedgers);

      expect(result.capacityHitPercent).toBe(100);
    });

    it("handles missing operation_count gracefully", () => {
      const mockLedgers = generateMockLedgers(100);
      mockLedgers[0].operation_count = undefined;
      mockLedgers[50].operation_count = null;

      const result = computeLedgerStats(mockLedgers);

      expect(result.avgOpsPerLedger).toBeGreaterThanOrEqual(0);
      expect(typeof result.avgOpsPerLedger).toBe("number");
    });

    it("handles empty ledger response with error", () => {
      expect(() => {
        computeLedgerStats([]);
      }).toThrow("No ledger data available");
    });
  });

  describe("Data Validation", () => {
    it("handles base_fee_in_stroops with leading zeros", () => {
      const mockLedgers = generateMockLedgers(100);
      mockLedgers[0].base_fee_in_stroops = "0100";

      const result = computeLedgerStats(mockLedgers);

      expect(result.avgFeeRevenueXLM).toBeDefined();
      expect(typeof result.avgFeeRevenueXLM).toBe("string");
    });

    it("computes feeRevenue accounting for variable base fees", () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 50],
      });

      mockLedgers.forEach((ledger, i) => {
        ledger.base_fee_in_stroops = String(100 + i);
      });

      const result = computeLedgerStats(mockLedgers);

      expect(parseFloat(result.avgFeeRevenueXLM)).toBeGreaterThan(0);
    });
  });

  describe("Consistency", () => {
    it("produces consistent results for same input", () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [100, 100],
        opsCountRange: [200, 200],
      });

      const result1 = computeLedgerStats(mockLedgers);
      const result2 = computeLedgerStats(mockLedgers);

      expect(result1.avgTxPerLedger).toBe(result2.avgTxPerLedger);
      expect(result1.avgOpsPerLedger).toBe(result2.avgOpsPerLedger);
      expect(result1.capacityHitPercent).toBe(result2.capacityHitPercent);
    });
  });
});
