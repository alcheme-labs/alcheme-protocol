import {
  buildAppRoomClaimPayload,
  encodeAppRoomClaimPayload,
  signAppRoomClaim,
} from "../server";

describe("server runtime helpers", () => {
  it("builds normalized app room claim payload", () => {
    const payload = buildAppRoomClaimPayload({
      externalAppId: "Last-Ignition",
      roomType: "Party",
      externalRoomId: "coop-1",
      walletPubkeys: ["wallet-1"],
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    });
    expect(payload.externalAppId).toBe("last-ignition");
    expect(payload.roomType).toBe("party");
  });

  it("encodes and signs app room claims with host-provided signer", async () => {
    const input = {
      externalAppId: "last-ignition",
      roomType: "party",
      externalRoomId: "coop-1",
      walletPubkeys: ["wallet-1"],
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    };
    const claim = await signAppRoomClaim(input, async (payload) => `signed:${payload}`);
    expect(claim.payload).toBe(encodeAppRoomClaimPayload(buildAppRoomClaimPayload(input)));
    expect(claim.signature).toBe(`signed:${claim.payload}`);
  });
});
