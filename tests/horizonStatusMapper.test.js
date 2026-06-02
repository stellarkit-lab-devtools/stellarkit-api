const { mapHorizonErrorToStatus } = require("../src/utils/horizonStatusMapper");

describe("Horizon Status Mapper Utility", () => {
  it("should map transaction result codes correctly", () => {
    expect(mapHorizonErrorToStatus("tx_bad_seq")).toBe(409);
    expect(mapHorizonErrorToStatus("tx_bad_auth")).toBe(403);
    expect(mapHorizonErrorToStatus("tx_insufficient_fee")).toBe(422);
  });

  it("should map operation result codes correctly", () => {
    expect(mapHorizonErrorToStatus("op_no_trust")).toBe(422);
    expect(mapHorizonErrorToStatus("op_line_full")).toBe(422);
    expect(mapHorizonErrorToStatus("op_no_destination")).toBe(404);
    expect(mapHorizonErrorToStatus("op_underfunded")).toBe(422);
    expect(mapHorizonErrorToStatus("op_low_reserve")).toBe(422);
  });

  it("should map common error codes correctly", () => {
    expect(mapHorizonErrorToStatus("transaction_failed")).toBe(422);
    expect(mapHorizonErrorToStatus("not_found")).toBe(404);
  });

  it("should return null for unrecognized error codes", () => {
    expect(mapHorizonErrorToStatus("unknown_code")).toBeNull();
  });

  it("should return null for null or undefined input", () => {
    expect(mapHorizonErrorToStatus(null)).toBeNull();
    expect(mapHorizonErrorToStatus(undefined)).toBeNull();
  });
});
