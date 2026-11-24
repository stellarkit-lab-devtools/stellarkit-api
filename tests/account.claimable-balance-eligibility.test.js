/**
 * Unit tests for GET /account/:id/claimable-balance-eligibility endpoint
 * Tests the predicate evaluation logic without requiring full app initialization
 */

describe("Claimable Balance Predicate Evaluation", () => {
  /**
   * Helper: Evaluate claimable balance predicate
   * Mirrors endpoint logic for testing
   */
  function evaluateClaimablePredicate(predicate, currentTimeMs) {
    const predicatesMet = [];
    const predicatesNotMet = [];
    let claimableAt = null;

    if (!predicate) {
      predicatesMet.push("unconditional");
      return { predicatesMet, predicatesNotMet, claimableAt };
    }

    const type = predicate.predicate_type;

    if (type === "unconditional" || type === "predicate_unconditional") {
      predicatesMet.push("unconditional");
      return { predicatesMet, predicatesNotMet, claimableAt };
    }

    // Handle time-based predicates
    if (type === "predicate_left_greater" || type === "predicate_left_greater_or_equal") {
      const timestamp = parseInt(predicate.time_bounds?.min_time || 0, 10) * 1000;
      if (currentTimeMs > timestamp || (type === "predicate_left_greater_or_equal" && currentTimeMs >= timestamp)) {
        predicatesMet.push(`time_lock (after ${new Date(timestamp).toISOString()})`);
      } else {
        predicatesNotMet.push(`time_lock (before ${new Date(timestamp).toISOString()})`);
        claimableAt = new Date(timestamp).toISOString();
      }
    }

    if (type === "predicate_right_less" || type === "predicate_right_less_or_equal") {
      const timestamp = parseInt(predicate.time_bounds?.max_time || 0, 10) * 1000;
      if (currentTimeMs < timestamp || (type === "predicate_right_less_or_equal" && currentTimeMs <= timestamp)) {
        predicatesMet.push(`time_window_open (until ${new Date(timestamp).toISOString()})`);
      } else {
        predicatesNotMet.push(`time_window_closed (expired at ${new Date(timestamp).toISOString()})`);
      }
    }

    // Handle composite predicates (and/or)
    if (type === "predicate_and") {
      const left = evaluateClaimablePredicate(predicate.left_predicate, currentTimeMs);
      const right = evaluateClaimablePredicate(predicate.right_predicate, currentTimeMs);
      predicatesMet.push(...left.predicatesMet, ...right.predicatesMet);
      predicatesNotMet.push(...left.predicatesNotMet, ...right.predicatesNotMet);
      if (left.claimableAt || right.claimableAt) {
        claimableAt = new Date(Math.max(
          new Date(left.claimableAt || 0).getTime(),
          new Date(right.claimableAt || 0).getTime()
        )).toISOString();
      }
    }

    if (type === "predicate_or") {
      const left = evaluateClaimablePredicate(predicate.left_predicate, currentTimeMs);
      const right = evaluateClaimablePredicate(predicate.right_predicate, currentTimeMs);
      const leftEligible = left.predicatesNotMet.length === 0;
      const rightEligible = right.predicatesNotMet.length === 0;
      if (leftEligible || rightEligible) {
        predicatesMet.push(...(leftEligible ? left.predicatesMet : right.predicatesMet));
      } else {
        predicatesNotMet.push(...left.predicatesNotMet, ...right.predicatesNotMet);
        claimableAt = new Date(Math.min(
          new Date(left.claimableAt || Date.now()).getTime(),
          new Date(right.claimableAt || Date.now()).getTime()
        )).toISOString();
      }
    }

    return { predicatesMet, predicatesNotMet, claimableAt };
  }

  describe("Unconditional Predicates", () => {
    it("evaluates null predicate as unconditional", () => {
      const result = evaluateClaimablePredicate(null, Date.now());
      expect(result.predicatesMet).toContain("unconditional");
      expect(result.predicatesNotMet).toHaveLength(0);
      expect(result.claimableAt).toBeNull();
    });

    it("evaluates predicate_unconditional type", () => {
      const predicate = { predicate_type: "predicate_unconditional" };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesMet).toContain("unconditional");
      expect(result.predicatesNotMet).toHaveLength(0);
      expect(result.claimableAt).toBeNull();
    });

    it("evaluates unconditional type", () => {
      const predicate = { predicate_type: "unconditional" };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesMet).toContain("unconditional");
      expect(result.predicatesNotMet).toHaveLength(0);
      expect(result.claimableAt).toBeNull();
    });
  });

  describe("Time-Based Predicates", () => {
    it("evaluates predicate_left_greater when future time", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: futureTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesNotMet.length).toBeGreaterThan(0);
      expect(result.claimableAt).not.toBeNull();
    });

    it("evaluates predicate_left_greater when past time", () => {
      const pastTime = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: pastTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesMet.length).toBeGreaterThan(0);
      expect(result.predicatesNotMet).toHaveLength(0);
    });

    it("evaluates predicate_right_less when future expiry", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_right_less",
        time_bounds: { max_time: futureTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesMet.length).toBeGreaterThan(0);
    });

    it("evaluates predicate_right_less when expired", () => {
      const pastTime = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_right_less",
        time_bounds: { max_time: pastTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesNotMet.length).toBeGreaterThan(0);
    });

    it("computes correct claimableAt for time-locked balance", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: futureTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.claimableAt).toBeDefined();
      expect(new Date(result.claimableAt)).toEqual(new Date(futureTime * 1000));
    });
  });

  describe("Composite Predicates (AND/OR)", () => {
    it("evaluates AND with both conditions met", () => {
      const pastTime = Math.floor((Date.now() - 1000) / 1000);
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      
      const predicate = {
        predicate_type: "predicate_and",
        left_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: pastTime }
        },
        right_predicate: {
          predicate_type: "predicate_right_less",
          time_bounds: { max_time: futureTime }
        }
      };
      
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesNotMet).toHaveLength(0);
      expect(result.predicatesMet.length).toBeGreaterThan(0);
      expect(result.claimableAt).toBeNull();
    });

    it("evaluates AND with one condition not met", () => {
      const futureTime1 = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const futureTime2 = Math.floor((Date.now() + 48 * 60 * 60 * 1000) / 1000);
      
      const predicate = {
        predicate_type: "predicate_and",
        left_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: futureTime1 }
        },
        right_predicate: {
          predicate_type: "predicate_right_less",
          time_bounds: { max_time: futureTime2 }
        }
      };
      
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesNotMet.length).toBeGreaterThan(0);
    });

    it("evaluates OR with at least one condition met", () => {
      const pastTime = Math.floor((Date.now() - 1000) / 1000);
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      
      const predicate = {
        predicate_type: "predicate_or",
        left_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: pastTime }
        },
        right_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: futureTime }
        }
      };
      
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesMet.length).toBeGreaterThan(0);
    });

    it("evaluates OR with no conditions met", () => {
      const futureTime1 = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const futureTime2 = Math.floor((Date.now() + 48 * 60 * 60 * 1000) / 1000);
      
      const predicate = {
        predicate_type: "predicate_or",
        left_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: futureTime1 }
        },
        right_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: futureTime2 }
        }
      };
      
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesNotMet.length).toBeGreaterThan(0);
    });
  });

  describe("Eligibility Status", () => {
    it("returns isEligible true when all predicates met", () => {
      const pastTime = Math.floor((Date.now() - 1000) / 1000);
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      
      const predicate = {
        predicate_type: "predicate_and",
        left_predicate: {
          predicate_type: "predicate_left_greater",
          time_bounds: { min_time: pastTime }
        },
        right_predicate: {
          predicate_type: "predicate_right_less",
          time_bounds: { max_time: futureTime }
        }
      };
      
      const result = evaluateClaimablePredicate(predicate, Date.now());
      const isEligible = result.predicatesNotMet.length === 0;
      expect(isEligible).toBe(true);
    });

    it("returns isEligible false when any predicate not met", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: futureTime }
      };
      
      const result = evaluateClaimablePredicate(predicate, Date.now());
      const isEligible = result.predicatesNotMet.length === 0;
      expect(isEligible).toBe(false);
    });

    it("returns claimableAt null for eligible balance", () => {
      const predicate = { predicate_type: "unconditional" };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      const isEligible = result.predicatesNotMet.length === 0;
      const claimableAt = isEligible ? null : result.claimableAt;
      expect(claimableAt).toBeNull();
    });

    it("returns claimableAt timestamp for time-locked balance", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: futureTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      const isEligible = result.predicatesNotMet.length === 0;
      const claimableAt = isEligible ? null : result.claimableAt;
      expect(claimableAt).not.toBeNull();
      expect(typeof claimableAt).toBe("string");
    });
  });

  describe("Edge Cases", () => {
    it("handles missing time_bounds gracefully", () => {
      const predicate = { predicate_type: "predicate_left_greater" };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result).toHaveProperty("predicatesMet");
      expect(result).toHaveProperty("predicatesNotMet");
      expect(result).toHaveProperty("claimableAt");
    });

    it("handles zero timestamp", () => {
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: 0 }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesMet.length).toBeGreaterThan(0);
    });

    it("handles very large timestamps", () => {
      const largeTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year in future
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: largeTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.predicatesNotMet.length).toBeGreaterThan(0);
      expect(result.claimableAt).toBeDefined();
    });

    it("produces ISO 8601 formatted dates", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: futureTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(result.claimableAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("Response Format", () => {
    it("returns array of predicates met", () => {
      const pastTime = Math.floor((Date.now() - 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: pastTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(Array.isArray(result.predicatesMet)).toBe(true);
    });

    it("returns array of predicates not met", () => {
      const futureTime = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
      const predicate = {
        predicate_type: "predicate_left_greater",
        time_bounds: { min_time: futureTime }
      };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(Array.isArray(result.predicatesNotMet)).toBe(true);
    });

    it("returns claimableAt as string or null", () => {
      const predicate = { predicate_type: "unconditional" };
      const result = evaluateClaimablePredicate(predicate, Date.now());
      expect(typeof result.claimableAt === "string" || result.claimableAt === null).toBe(true);
    });
  });
});
