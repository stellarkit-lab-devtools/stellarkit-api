"use strict";

const fs = require("fs");
const path = require("path");
const { StrKey } = require("@stellar/stellar-sdk");
const { loadFixture, FIXTURE_DIR } = require("./fixtures");

const FIXTURE_NAMES = [
  "account-funded", "account-trustlines", "account-multisig", "account-pool",
  "transactions-page", "payments-page", "offers-page", "trades-page",
  "ledger", "fee-stats", "order-book", "liquidity-pool",
];

function collectAddresses(value, found = []) {
  if (typeof value === "string") {
    if (/^G[A-Z2-7]{55}$/.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectAddresses(item, found));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectAddresses(item, found));
  }
  return found;
}

describe("Horizon fixtures", () => {
  it.each(FIXTURE_NAMES)("loads %s as JSON", (name) => {
    expect(loadFixture(name)).toEqual(
      JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"))
    );
  });

  it("uses checksum-valid StrKeys for every address", () => {
    const addresses = FIXTURE_NAMES.flatMap((name) => collectAddresses(loadFixture(name)));
    expect(addresses.length).toBeGreaterThan(0);
    addresses.forEach((address) => {
      expect(StrKey.isValidEd25519PublicKey(address)).toBe(true);
    });
  });

  it("returns a deep copy and applies recursive overrides", () => {
    const first = loadFixture("account-multisig", {
      thresholds: { med_threshold: 9 },
    });
    expect(first.thresholds.med_threshold).toBe(9);
    expect(first.thresholds.high_threshold).toBe(4);

    first.signers[0].weight = 99;
    const second = loadFixture("account-multisig");
    expect(second.signers[0].weight).toBe(1);
    expect(second.thresholds.med_threshold).toBe(3);
  });

  it("throws for an unknown fixture", () => {
    expect(() => loadFixture("does-not-exist")).toThrow("Unknown Horizon fixture");
  });
});
