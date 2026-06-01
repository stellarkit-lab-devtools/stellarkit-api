const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

describe("Account Data API", () => {
  const realValidAccountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/data", () => {
    it("returns all data entries with decoded values", async () => {
      const mockData = {
        "test_key": Buffer.from("test_value").toString("base64"),
        "another_key": Buffer.from("another_value").toString("base64"),
      };

      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        data_attr: mockData,
      });

      const res = await request(app).get(`/account/${realValidAccountId}/data`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      
      const testEntry = res.body.data.find(e => e.key === "test_key");
      expect(testEntry.decodedValue).toBe("test_value");
      expect(testEntry.rawValue).toBe(mockData["test_key"]);
    });

    it("returns empty array if account has no data", async () => {
      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        data_attr: {},
      });

      const res = await request(app).get(`/account/${realValidAccountId}/data`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/data");
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /account/:id/data/:key", () => {
    it("returns a single data entry by key", async () => {
      const mockData = {
        "target_key": Buffer.from("target_value").toString("base64"),
      };

      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        data_attr: mockData,
      });

      const res = await request(app).get(`/account/${realValidAccountId}/data/target_key`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.key).toBe("target_key");
      expect(res.body.data.decodedValue).toBe("target_value");
    });

    it("returns 404 if key not found", async () => {
      server.loadAccount.mockResolvedValue({
        id: realValidAccountId,
        data_attr: { "other_key": "val" },
      });

      const res = await request(app).get(`/account/${realValidAccountId}/data/missing_key`);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.message).toContain("not found");
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/data/key");
      expect(res.statusCode).toBe(400);
    });
  });
});
