const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      ...originalModule.server,
      transactions: jest.fn(),
      operations: jest.fn(),
      effects: jest.fn(),
    },
  };
});

const VALID_HASH = "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";
const ACCOUNT_A = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
const ACCOUNT_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT_C = "GAAAAACAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC";
const ISSUER = "GBZXBZSBAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function mockTx(tx) {
  server.transactions.mockReturnValue({
    transaction: jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue(tx),
    }),
  });
}

function mockTxNotFound() {
  server.transactions.mockReturnValue({
    transaction: jest.fn().mockReturnValue({
      call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
    }),
  });
}

function mockOps(records) {
  server.operations.mockReturnValue({
    forTransaction: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function mockEffects(records) {
  server.effects.mockReturnValue({
    forTransaction: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function mockEffectsError() {
  server.effects.mockReturnValue({
    forTransaction: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockRejectedValue(new Error("effects failed")),
  });
}

describe("GET /transaction/:hash/participants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 400 for a malformed hash", async () => {
    const res = await request(app).get("/transaction/not-a-hash/participants");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(["ValidationError", "InvalidTransactionHash"]).toContain(res.body.error.type);
  });

  it("returns 404 for an unknown hash", async () => {
    mockTxNotFound();

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("NotFound");
  });

  it("returns participants for a simple payment", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_A,
    };
    mockTx(tx);
    mockOps([
      {
        type: "payment",
        source_account: ACCOUNT_A,
        from: ACCOUNT_A,
        to: ACCOUNT_B,
        asset_type: "native",
      },
    ]);
    mockEffects([]);

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hash).toBe(VALID_HASH);
    expect(res.body.data.ledger).toBe(12345);

    const participants = res.body.data.participants;
    expect(participants).toHaveLength(2);

    // Sorted by address
    const addrs = participants.map((p) => p.address);
    expect(addrs).toEqual([...addrs].sort());

    const aParticipant = participants.find((p) => p.address === ACCOUNT_A);
    expect(aParticipant).toBeDefined();
    expect(aParticipant.roles).toContain("source");

    const bParticipant = participants.find((p) => p.address === ACCOUNT_B);
    expect(bParticipant).toBeDefined();
    expect(bParticipant.roles).toContain("destination");
  });

  it("returns participants for a multi-operation transaction with different sources", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_A,
    };
    mockTx(tx);
    mockOps([
      {
        type: "payment",
        source_account: ACCOUNT_B,
        from: ACCOUNT_B,
        to: ACCOUNT_A,
        asset_type: "native",
      },
      {
        type: "payment",
        source_account: ACCOUNT_C,
        from: ACCOUNT_C,
        to: ACCOUNT_A,
        asset_type: "native",
      },
    ]);
    mockEffects([]);

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    const participants = res.body.data.participants;
    expect(participants).toHaveLength(3);

    expect(participants.find((p) => p.address === ACCOUNT_A).roles).toContain("destination");
    expect(participants.find((p) => p.address === ACCOUNT_B).roles).toContain("source");
    expect(participants.find((p) => p.address === ACCOUNT_C).roles).toContain("source");
  });

  it("returns fee_payer for a fee-bump transaction", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_B,
    };
    mockTx(tx);
    mockOps([
      {
        type: "payment",
        source_account: ACCOUNT_A,
        from: ACCOUNT_A,
        to: ACCOUNT_C,
        asset_type: "native",
      },
    ]);
    mockEffects([]);

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    const participants = res.body.data.participants;

    const feePayer = participants.find((p) => p.address === ACCOUNT_B);
    expect(feePayer).toBeDefined();
    expect(feePayer.roles).toContain("fee_payer");
  });

  it("returns participants for an account merge", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_A,
    };
    mockTx(tx);
    mockOps([
      {
        type: "account_merge",
        source_account: ACCOUNT_A,
        destination: ACCOUNT_B,
      },
    ]);
    mockEffects([]);

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    const participants = res.body.data.participants;
    expect(participants).toHaveLength(2);

    expect(participants.find((p) => p.address === ACCOUNT_A).roles).toContain("source");
    expect(participants.find((p) => p.address === ACCOUNT_B).roles).toContain("destination");
  });

  it("returns participants for a create-account operation", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_A,
    };
    mockTx(tx);
    mockOps([
      {
        type: "create_account",
        source_account: ACCOUNT_A,
        funder: ACCOUNT_A,
        account: ACCOUNT_B,
      },
    ]);
    mockEffects([]);

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    const participants = res.body.data.participants;
    expect(participants).toHaveLength(2);

    expect(participants.find((p) => p.address === ACCOUNT_A).roles).toContain("source");
    expect(participants.find((p) => p.address === ACCOUNT_B).roles).toContain("destination");
  });

  it("deduplicates participants and merges roles", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_A,
    };
    mockTx(tx);
    // Two payments from A to B: A should be source, B should be destination
    mockOps([
      {
        type: "payment",
        source_account: ACCOUNT_A,
        from: ACCOUNT_A,
        to: ACCOUNT_B,
        asset_type: "native",
      },
      {
        type: "payment",
        source_account: ACCOUNT_A,
        from: ACCOUNT_A,
        to: ACCOUNT_B,
        asset_type: "native",
      },
    ]);
    // Effects add balance_change role
    mockEffects([
      { type: "account_debited", account: ACCOUNT_A },
      { type: "account_credited", account: ACCOUNT_B },
    ]);

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    const participants = res.body.data.participants;

    // Only 2 unique participants
    expect(participants).toHaveLength(2);

    const aParticipant = participants.find((p) => p.address === ACCOUNT_A);
    expect(aParticipant.roles).toContain("source");
    expect(aParticipant.roles).toContain("balance_change");

    const bParticipant = participants.find((p) => p.address === ACCOUNT_B);
    expect(bParticipant.roles).toContain("destination");
    expect(bParticipant.roles).toContain("balance_change");
  });

  it("works when effects call fails", async () => {
    const tx = {
      hash: VALID_HASH,
      ledger: 12345,
      source_account: ACCOUNT_A,
      fee_account: ACCOUNT_A,
    };
    mockTx(tx);
    mockOps([
      {
        type: "payment",
        source_account: ACCOUNT_A,
        from: ACCOUNT_A,
        to: ACCOUNT_B,
        asset_type: "native",
      },
    ]);
    mockEffectsError();

    const res = await request(app).get(`/transaction/${VALID_HASH}/participants`);

    expect(res.statusCode).toBe(200);
    const participants = res.body.data.participants;
    expect(participants).toHaveLength(2);

    // Still has source and destination from operations
    expect(participants.find((p) => p.address === ACCOUNT_A).roles).toContain("source");
    expect(participants.find((p) => p.address === ACCOUNT_B).roles).toContain("destination");
  });
});
