const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { operations: jest.fn() },
}));

const accountId = Keypair.random().publicKey();

const mockPayment = {
  type: "payment",
  asset_code: "XLM",
  asset_issuer: null,
  asset_type: "native",
  amount: "10.0000000",
  from: accountId,
  to: "GOTHER",
  created_at: "2024-01-01T00:00:00Z",
  paging_token: "token1",
};

function mockOps(capturedOrder) {
  const orderMock = jest.fn().mockImplementation((o) => {
    if (capturedOrder) capturedOrder.value = o;
    return { call: jest.fn().mockResolvedValue({ records: [mockPayment] }) };
  });
  server.operations.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: orderMock,
  });
  return orderMock;
}

beforeEach(() => jest.clearAllMocks());

describe("GET /account/:id/payments — ?order parameter", () => {
  it("defaults to desc when order is omitted", async () => {
    const captured = {};
    const orderMock = mockOps(captured);
    const res = await request(app).get(`/account/${accountId}/payments`);
    expect(res.statusCode).toBe(200);
    expect(orderMock).toHaveBeenCalledWith("desc");
  });

  it("passes order=asc through to Horizon", async () => {
    const captured = {};
    const orderMock = mockOps(captured);
    const res = await request(app).get(`/account/${accountId}/payments?order=asc`);
    expect(res.statusCode).toBe(200);
    expect(orderMock).toHaveBeenCalledWith("asc");
  });

  it("passes order=desc through to Horizon", async () => {
    const captured = {};
    const orderMock = mockOps(captured);
    const res = await request(app).get(`/account/${accountId}/payments?order=desc`);
    expect(res.statusCode).toBe(200);
    expect(orderMock).toHaveBeenCalledWith("desc");
  });

  it("returns 400 for an invalid order value", async () => {
    const res = await request(app).get(`/account/${accountId}/payments?order=invalid`);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });
});
