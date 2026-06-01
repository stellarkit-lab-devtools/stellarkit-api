const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const {
  calculateAgeInDays,
  daysToMonths,
  daysToYears,
  getMaturityLabel,
  buildAccountAgeResponse,
  MATURITY_NEW_THRESHOLD_DAYS,
  MATURITY_ESTABLISHED_THRESHOLD_DAYS,
  AVG_DAYS_PER_MONTH,
  AVG_DAYS_PER_YEAR,
} = require("../src/utils/accountAge");

describe("Account Age and Longevity", () => {
  const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UNIT TESTS: accountAge utilities
  // ─────────────────────────────────────────────────────────────────────────

  describe("calculateAgeInDays", () => {
    it("returns 0 for a timestamp equal to now", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const result = calculateAgeInDays(now.toISOString(), now);
      expect(result).toBe(0);
    });

    it("returns 1 for a timestamp exactly 24 hours ago", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2026-05-28T12:00:00Z");
      const result = calculateAgeInDays(createdAt.toISOString(), now);
      expect(result).toBe(1);
    });

    it("returns 29 for 29 days ago (not yet 'established')", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2026-04-30T12:00:00Z");
      const result = calculateAgeInDays(createdAt.toISOString(), now);
      expect(result).toBe(29);
    });

    it("returns 30 for exactly 30 days ago", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2026-04-29T12:00:00Z");
      const result = calculateAgeInDays(createdAt.toISOString(), now);
      expect(result).toBe(30);
    });

    it("returns 364 for 364 days ago (not yet 'veteran')", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2025-05-30T12:00:00Z");
      const result = calculateAgeInDays(createdAt.toISOString(), now);
      expect(result).toBe(364);
    });

    it("returns 365 for exactly 365 days ago", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2025-05-29T12:00:00Z");
      const result = calculateAgeInDays(createdAt.toISOString(), now);
      expect(result).toBe(365);
    });

    it("uses current time when now is not provided", () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = calculateAgeInDays(oneDayAgo.toISOString());
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("daysToMonths", () => {
    it("returns 0 for 0 days", () => {
      expect(daysToMonths(0)).toBe(0);
    });

    it("returns 0 for 30 days", () => {
      expect(daysToMonths(30)).toBe(0);
    });

    it("returns 1 for 31 days", () => {
      expect(daysToMonths(31)).toBe(1);
    });

    it("returns 1 for 60 days", () => {
      expect(daysToMonths(60)).toBe(1);
    });

    it("returns 40 for 1234 days", () => {
      // 1234 / 30.4375 = 40.54..., floored = 40
      expect(daysToMonths(1234)).toBe(40);
    });

    it("always floors (never rounds up)", () => {
      expect(daysToMonths(100)).toBe(3); // 100 / 30.4375 = 3.28..., floored = 3
    });
  });

  describe("daysToYears", () => {
    it("returns 0 for 0 days", () => {
      expect(daysToYears(0)).toBe(0);
    });

    it("returns 0 for 364 days", () => {
      expect(daysToYears(364)).toBe(0);
    });

    it("returns 0 for 365 days (365 / 365.25 = 0.9986..., floored = 0)", () => {
      expect(daysToYears(365)).toBe(0);
    });

    it("returns 1 for 729 days", () => {
      expect(daysToYears(729)).toBe(1);
    });

    it("returns 3 for 1234 days", () => {
      // 1234 / 365.25 = 3.37..., floored = 3
      expect(daysToYears(1234)).toBe(3);
    });

    it("always floors (never rounds up)", () => {
      expect(daysToYears(500)).toBe(1); // 500 / 365.25 = 1.36..., floored = 1
    });
  });

  describe("getMaturityLabel", () => {
    it("returns 'new' for 0 days", () => {
      expect(getMaturityLabel(0)).toBe("new");
    });

    it("returns 'new' for 29 days", () => {
      expect(getMaturityLabel(29)).toBe("new");
    });

    it("returns 'established' for 30 days", () => {
      expect(getMaturityLabel(30)).toBe("established");
    });

    it("returns 'established' for 364 days", () => {
      expect(getMaturityLabel(364)).toBe("established");
    });

    it("returns 'veteran' for 365 days", () => {
      expect(getMaturityLabel(365)).toBe("veteran");
    });

    it("returns 'veteran' for 1000 days", () => {
      expect(getMaturityLabel(1000)).toBe("veteran");
    });
  });

  describe("buildAccountAgeResponse", () => {
    it("correctly computes all fields for a 45-day-old account", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2026-04-14T12:00:00Z").toISOString();
      const publicKey = ACCOUNT_ID;
      const createdAtLedger = 12345678;

      const response = buildAccountAgeResponse({
        publicKey,
        createdAtLedger,
        createdAt,
        now,
      });

      expect(response.publicKey).toBe(publicKey);
      expect(response.createdAtLedger).toBe(createdAtLedger);
      expect(response.createdAt).toBe(createdAt);
      expect(response.ageInDays).toBe(45);
      expect(response.ageInMonths).toBe(1); // 45 / 30.4375 = 1.47..., floored = 1
      expect(response.ageInYears).toBe(0); // 45 / 365.25 = 0.12..., floored = 0
      expect(response.maturity).toBe("established");
    });

    it("correctly computes all fields for a 400-day-old account", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2025-04-24T12:00:00Z").toISOString();
      const publicKey = ACCOUNT_ID;
      const createdAtLedger = 12345678;

      const response = buildAccountAgeResponse({
        publicKey,
        createdAtLedger,
        createdAt,
        now,
      });

      expect(response.ageInDays).toBe(400);
      expect(response.ageInMonths).toBe(13); // 400 / 30.4375 = 13.14..., floored = 13
      expect(response.ageInYears).toBe(1); // 400 / 365.25 = 1.09..., floored = 1
      expect(response.maturity).toBe("veteran");
    });

    it("maturity matches the computed ageInDays", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const testCases = [
        { daysAgo: 15, expectedMaturity: "new" },
        { daysAgo: 30, expectedMaturity: "established" },
        { daysAgo: 180, expectedMaturity: "established" },
        { daysAgo: 365, expectedMaturity: "veteran" },
        { daysAgo: 500, expectedMaturity: "veteran" },
      ];

      testCases.forEach(({ daysAgo, expectedMaturity }) => {
        const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
        const response = buildAccountAgeResponse({
          publicKey: ACCOUNT_ID,
          createdAtLedger: 12345678,
          createdAt,
          now,
        });
        expect(response.maturity).toBe(expectedMaturity);
      });
    });

    it("ageInMonths and ageInYears are always integers (floor)", () => {
      const now = new Date("2026-05-29T12:00:00Z");
      const createdAt = new Date("2025-03-15T12:00:00Z").toISOString();

      const response = buildAccountAgeResponse({
        publicKey: ACCOUNT_ID,
        createdAtLedger: 12345678,
        createdAt,
        now,
      });

      expect(Number.isInteger(response.ageInDays)).toBe(true);
      expect(Number.isInteger(response.ageInMonths)).toBe(true);
      expect(Number.isInteger(response.ageInYears)).toBe(true);
    });

    it("publicKey and createdAt are passed through unchanged", () => {
      const publicKey = ACCOUNT_ID;
      const createdAt = "2020-06-15T10:30:45Z";
      const createdAtLedger = 12345678;

      const response = buildAccountAgeResponse({
        publicKey,
        createdAtLedger,
        createdAt,
      });

      expect(response.publicKey).toBe(publicKey);
      expect(response.createdAt).toBe(createdAt);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRATION / ROUTE TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("GET /account/:id/age", () => {
    it("returns 200 with correct age data for a valid funded account", async () => {
      const createdAt = "2020-06-15T10:30:45Z";
      const ledgerAttr = 12345678;

      const mockTxResponse = {
        records: [
          {
            id: "tx1",
            ledger_attr: ledgerAttr,
            created_at: createdAt,
            hash: "abc123",
          },
        ],
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockResolvedValue(mockTxResponse),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("publicKey", ACCOUNT_ID);
      expect(res.body.data).toHaveProperty("createdAtLedger", ledgerAttr);
      expect(res.body.data).toHaveProperty("createdAt", createdAt);
      expect(res.body.data).toHaveProperty("ageInDays");
      expect(res.body.data).toHaveProperty("ageInMonths");
      expect(res.body.data).toHaveProperty("ageInYears");
      expect(res.body.data).toHaveProperty("maturity");
      expect(Number.isInteger(res.body.data.ageInDays)).toBe(true);
      expect(res.body.data.ageInMonths).toBeGreaterThanOrEqual(0);
      expect(res.body.data.ageInYears).toBeGreaterThanOrEqual(0);
    });

    it("returns 400 for an invalid public key", async () => {
      const res = await request(app).get("/account/notakey/age");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("does not call Horizon for an invalid public key", async () => {
      const transactionSpy = jest.spyOn(server, "transactions");

      await request(app).get("/account/notakey/age");

      expect(transactionSpy).not.toHaveBeenCalled();
    });

    it("returns 404 when Horizon returns account not found", async () => {
      const mockError = new Error("Not found");
      mockError.response = { status: 404 };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockRejectedValue(mockError),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 when account has no transactions", async () => {
      const mockTxResponse = {
        records: [],
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockResolvedValue(mockTxResponse),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 500 when Horizon is unreachable", async () => {
      const mockError = new Error("Network error");
      mockError.response = { status: 500 };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockRejectedValue(mockError),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it("maturity is 'new' for account created 15 days ago", async () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();

      const mockTxResponse = {
        records: [
          {
            id: "tx1",
            ledger_attr: 12345678,
            created_at: createdAt,
            hash: "abc123",
          },
        ],
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockResolvedValue(mockTxResponse),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.maturity).toBe("new");
    });

    it("maturity is 'established' for account created 180 days ago", async () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();

      const mockTxResponse = {
        records: [
          {
            id: "tx1",
            ledger_attr: 12345678,
            created_at: createdAt,
            hash: "abc123",
          },
        ],
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockResolvedValue(mockTxResponse),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.maturity).toBe("established");
    });

    it("maturity is 'veteran' for account created 500 days ago", async () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 500 * 24 * 60 * 60 * 1000).toISOString();

      const mockTxResponse = {
        records: [
          {
            id: "tx1",
            ledger_attr: 12345678,
            created_at: createdAt,
            hash: "abc123",
          },
        ],
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockResolvedValue(mockTxResponse),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.maturity).toBe("veteran");
    });

    it("publicKey in response matches the request param", async () => {
      const mockTxResponse = {
        records: [
          {
            id: "tx1",
            ledger_attr: 12345678,
            created_at: "2020-06-15T10:30:45Z",
            hash: "abc123",
          },
        ],
      };

      jest.spyOn(server, "transactions").mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              call: jest.fn().mockResolvedValue(mockTxResponse),
            }),
          }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/age`);

      expect(res.body.data.publicKey).toBe(ACCOUNT_ID);
    });
  });
});
