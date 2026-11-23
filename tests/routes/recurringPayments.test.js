const request = require("supertest");
const express = require("express");

const mockServer = {
  payments: jest.fn()
};

jest.mock("../../src/config/stellar", () => ({
  server: mockServer
}));

const recurringPaymentsRouter = require("../../src/routes/recurringPayments");

describe("GET /account/:id/recurring-payments", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/account", recurringPaymentsRouter);
    jest.clearAllMocks();
  });

  describe("weekly pattern detection", () => {
    it("detects weekly payments with CV <= 0.25", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GBEN", amount: "1000", asset_type: "native", created_at: new Date(now - 4 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GBEN", amount: "1000", asset_type: "native", created_at: new Date(now - 3 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GBEN", amount: "1000", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GBEN", amount: "1000", asset_type: "native", created_at: new Date(now - weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments?days=60");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].cadence).toBe("weekly");
      expect(res.body.data.items[0].occurrences).toBe(4);
    });
  });

  describe("monthly pattern detection", () => {
    it("detects monthly payments with CV <= 0.25", async () => {
      const now = Date.now();
      const monthMs = 30 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GXYZ", amount: "2500", asset_type: "native", created_at: new Date(now - 3 * monthMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GXYZ", amount: "2500", asset_type: "native", created_at: new Date(now - 2 * monthMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GXYZ", amount: "2500", asset_type: "native", created_at: new Date(now - monthMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments?days=120");
      expect(res.status).toBe(200);
      expect(res.body.data.items[0].cadence).toBe("monthly");
    });
  });

  describe("irregular pattern rejection", () => {
    it("rejects payments with CV > 0.25", async () => {
      const now = Date.now();
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GRAND", amount: "500", asset_type: "native", created_at: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GRAND", amount: "500", asset_type: "native", created_at: new Date(now - 50 * 24 * 60 * 60 * 1000).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GRAND", amount: "500", asset_type: "native", created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments");
      expect(res.body.data.items.length).toBe(0);
    });
  });

  describe("minimum occurrences cutoff", () => {
    it("excludes groups with fewer than minOccurrences", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GONE", amount: "100", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GONE", amount: "100", asset_type: "native", created_at: new Date(now - weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments?minOccurrences=3");
      expect(res.body.data.items.length).toBe(0);
    });
  });

  describe("different amounts split groups", () => {
    it("separates payments with different amounts into different groups", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GSPLIT", amount: "1000", asset_type: "native", created_at: new Date(now - 3 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GSPLIT", amount: "1000", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GSPLIT", amount: "1000", asset_type: "native", created_at: new Date(now - weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GSPLIT", amount: "2000", asset_type: "native", created_at: new Date(now - 3 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GSPLIT", amount: "2000", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GSPLIT", amount: "2000", asset_type: "native", created_at: new Date(now - weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments");
      expect(res.body.data.items.length).toBe(2);
      const amounts = res.body.data.items.map(i => i.amount);
      expect(amounts).toContain("1000.0000000");
      expect(amounts).toContain("2000.0000000");
    });
  });

  describe("lapsed vs active status", () => {
    it("marks payment as lapsed when past threshold", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GLAPSE", amount: "500", asset_type: "native", created_at: new Date(now - 5 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GLAPSE", amount: "500", asset_type: "native", created_at: new Date(now - 4 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GLAPSE", amount: "500", asset_type: "native", created_at: new Date(now - 3 * weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments");
      expect(res.body.data.items[0].status).toBe("lapsed");
    });

    it("marks payment as active when within threshold", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GACTIVE", amount: "500", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GACTIVE", amount: "500", asset_type: "native", created_at: new Date(now - weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GACTIVE", amount: "500", asset_type: "native", created_at: new Date(now - 0.5 * weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments");
      expect(res.body.data.items[0].status).toBe("active");
    });
  });

  describe("inbound direction", () => {
    it("filters inbound payments when direction=inbound", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GSENDER", from: "GSENDER", to: "GACC", amount: "1000", asset_type: "native", created_at: new Date(now - 3 * weekMs).toISOString() },
        { type: "payment", source_account: "GSENDER", from: "GSENDER", to: "GACC", amount: "1000", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GSENDER", from: "GSENDER", to: "GACC", amount: "1000", asset_type: "native", created_at: new Date(now - weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments?direction=inbound");
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].counterparty).toBe("GSENDER");
    });
  });

  describe("partial flag", () => {
    it("sets partial=true when payments are capped at MAX_PAYMENTS", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = Array(2000).fill(null).map((_, i) => ({
        type: "payment", source_account: "GACC", from: "GACC", to: "GPART", amount: "100", asset_type: "native", created_at: new Date(now - i * weekMs).toISOString()
      }));

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments");
      expect(res.body.data.meta.partial).toBe(true);
    });
  });

  describe("path payment exclusion", () => {
    it("excludes path payment operations", async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      
      const mockRecords = [
        { type: "payment", source_account: "GACC", from: "GACC", to: "GPAY", amount: "1000", asset_type: "native", created_at: new Date(now - 3 * weekMs).toISOString() },
        { type: "path_payment", source_account: "GACC", from: "GACC", to: "GPAY", amount: "1000", asset_type: "native", created_at: new Date(now - 2 * weekMs).toISOString() },
        { type: "payment", source_account: "GACC", from: "GACC", to: "GPAY", amount: "1000", asset_type: "native", created_at: new Date(now - weekMs).toISOString() }
      ];

      mockServer.payments.mockReturnValue({
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: async () => ({ records: mockRecords })
            })
          })
        })
      });

      const res = await request(app).get("/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ4NZJ2J2X4/recurring-payments");
      expect(res.body.data.items[0].occurrences).toBe(2);
    });
  });
});