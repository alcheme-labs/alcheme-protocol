import { isIndependentExternalAppSupportSignal } from "../actorRelations";

describe("external app actor relations", () => {
  it("does not count related-party support as independent public endorsement", () => {
    for (const relationType of ["owner", "team", "affiliate", "sponsor"]) {
      expect(isIndependentExternalAppSupportSignal(relationType)).toBe(false);
    }
    expect(isIndependentExternalAppSupportSignal("unknown")).toBe(true);
  });
});
