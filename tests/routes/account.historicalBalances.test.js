"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const OTHER_ID = Keypair.random().publicKey();
const ISSUER_ID = Keypair.random().publicKey();
const DAY_MS = 24 * 60 * 60 * 1000;

function payment({ daysAgo, amount, direction = "in", asset = "native" }) {
  const isNative = asset === "native";
  return {
    type: "payment",
    transaction_successful: true,
    created_at: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
    paging_token: `token-${daysAgo}-${asset}`,
    asset_type: isNative ? "native" : "credit_alphanum4",
    asset_code: isNative ? undefined : asset,
    asset_issuer: isNative ? undefined : ISSUER_ID,
    amount,
    from: direction === "in" ? OTHER_ID : ACCOUNT_ID,
    to: direction === "in" ? ACCOUNT_ID : OTHER_ID,
  };
}

function mockAccount(balance = "100.0000000") {
  jest.spyOn(server, "loadAccount").mockResolvedValue({
    id: ACCOUNT_ID,
    balances: [{ asset_type: "native", balance }],
  });
}

function mockPayments(records) {
  jest.spyOn(server, "payments").mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function mockHistory() {
  mockAccount();
  mockPayments([
    payment({ daysAgo: 90, amount: "10.0000000" }),
    payment({ daysAgo: 60, amount: "5.0000000", direction: "out" }),
    payment({ daysAgo: 30, amount: "20.0000000" }),
    payment({ daysAgo: 7, amount: "3.0000000", direction: "out" }),
    payment({ daysAgo: 1, amount: "2.0000000" }),
    payment({ daysAgo: 30, amount: "50.0000000", asset: "USDC" }),
  ]);
}

function expectSnapshotsSpacedBy(snapshots, days) {
  expect(snapshots.length).toBeGreaterThan(1);

  const intervalMs = days * DAY_MS;
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = new Date(snapshots[index - 1].timestamp).getTime();
    const current = new Date(snapshots[index].timestamp).getTime();
    expect(Math.abs(current - previous)).toBe(intervalMs);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/historical-balances", () => {
  it("returns snapshots spaced 7 days apart", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expectSnapshotsSpacedBy(res.body.data.snapshots, 7);
  });

  it("returns snapshots spaced 30 days apart", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=30d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expectSnapshotsSpacedBy(res.body.data.snapshots, 30);
  });

  it("returns each snapshot timestamp as an ISO 8601 string", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.snapshots.length).toBeGreaterThan(0);
    for (const snapshot of res.body.data.snapshots) {
      expect(snapshot.timestamp).toEqual(new Date(snapshot.timestamp).toISOString());
    }
  });

  it("returns native XLM balance history when asset=XLM", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d&asset=XLM`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.snapshots.length).toBeGreaterThan(0);
    expect(res.body.data.asset).toMatchObject({ code: "XLM", type: "native" });
    for (const snapshot of res.body.data.snapshots) {
      expect(snapshot.balance).toEqual(expect.any(String));
    }
  });

  it("returns 400 for an invalid resolution", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=12h`,
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(server.payments).not.toHaveBeenCalled();
  });

  // ── Issue #1048 required cases ───────────────────────────────────────────

  it("shows balance growing over time for 3 inbound payments at different timestamps", async () => {
    // Current balance: 30 XLM (sum of the 3 inbound payments)
    mockAccount("30.0000000");
    // Three inbound payments spaced apart, returned newest-first as Horizon does
    mockPayments([
      payment({ daysAgo: 1,  amount: "10.0000000", direction: "in" }),
      payment({ daysAgo: 40, amount: "10.0000000", direction: "in" }),
      payment({ daysAgo: 70, amount: "10.0000000", direction: "in" }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=30d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { snapshots } = res.body.data;
    expect(snapshots.length).toBeGreaterThan(1);

    // Walking forward in time the balance should be non-decreasing
    // (each inbound payment adds to the balance)
    for (let i = 1; i < snapshots.length; i++) {
      expect(parseFloat(snapshots[i].balance)).toBeGreaterThanOrEqual(
        parseFloat(snapshots[i - 1].balance),
      );
    }

    // The most-recent snapshot should equal the current balance
    const last = snapshots[snapshots.length - 1];
    expect(parseFloat(last.balance)).toBeCloseTo(30, 4);
  });

  it("returns balance history for a specific asset when ?asset=USDC:ISSUER is given", async () => {
    // Current state: account holds 50 USDC, received in one payment 10 days ago
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [
        { asset_type: "native", balance: "100.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: ISSUER_ID,
          balance: "50.0000000",
        },
      ],
    });
    mockPayments([
      payment({ daysAgo: 1, amount: "50.0000000", direction: "in", asset: "USDC" }),
      payment({ daysAgo: 5, amount: "20.0000000", direction: "in" }), // XLM payment — should be ignored
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d&asset=USDC:${ISSUER_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.asset).toMatchObject({ code: "USDC", issuer: ISSUER_ID });

    // The most recent snapshot should reflect the USDC balance (not XLM)
    const { snapshots } = res.body.data;
    expect(snapshots.length).toBeGreaterThan(0);
    const latest = snapshots[snapshots.length - 1];
    expect(parseFloat(latest.balance)).toBeCloseTo(50, 4);

    // Older snapshots (before the USDC payment) should show ~0
    const oldest = snapshots[0];
    expect(parseFloat(oldest.balance)).toBeCloseTo(0, 4);
  });

  it("returns snapshots all showing zero balance for an account with no payment history", async () => {
    // Account exists but has never received any payments
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [{ asset_type: "native", balance: "0.0000000" }],
    });
    mockPayments([]); // no records

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { snapshots } = res.body.data;
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(parseFloat(snapshot.balance)).toBe(0);
    }
  });

  it("returns 404 for a non-existent account", async () => {
    jest.spyOn(server, "loadAccount").mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances`,
    );

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});