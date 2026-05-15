import { assertBondExposureAvailable, buildBondExposureState } from "../bondExposure";

describe("external app bond exposure", () => {
  it("blocks new locks when exposure is paused", () => {
    expect(() =>
      assertBondExposureAvailable({
        ownerBondRaw: "1000",
        activeLockedAmountRaw: "0",
        requestedAmountRaw: "100",
        pausedNewBondExposure: true,
      }),
    ).toThrow("external_app_new_bond_exposure_paused");
  });

  it("requires a positive requested amount and owner bond capacity", () => {
    expect(() =>
      assertBondExposureAvailable({
        ownerBondRaw: "1000",
        activeLockedAmountRaw: "0",
        requestedAmountRaw: "0",
      }),
    ).toThrow("external_app_bond_exposure_amount_required");

    expect(() =>
      assertBondExposureAvailable({
        ownerBondRaw: "1000",
        activeLockedAmountRaw: "900",
        requestedAmountRaw: "101",
      }),
    ).toThrow("external_app_bond_exposure_exceeds_owner_bond");
  });

  it("projects available owner bond from active locks", () => {
    expect(
      buildBondExposureState({
        ownerBondRaw: "1000",
        activeLockedAmountRaw: "375",
        totalRoutedAmountRaw: "25",
      }),
    ).toEqual({
      ownerBondRaw: "1000",
      activeLockedAmountRaw: "375",
      totalRoutedAmountRaw: "25",
      availableBondRaw: "625",
      pausedNewBondExposure: false,
    });
  });
});
