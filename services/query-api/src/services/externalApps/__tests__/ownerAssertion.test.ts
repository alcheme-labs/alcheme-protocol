import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  buildExternalAppOwnerAssertionPayload,
  encodeExternalAppOwnerAssertionPayload,
  extractSolanaOwnerPubkey,
  verifyExternalAppOwnerAssertion,
} from "../ownerAssertion";

describe("external app owner assertion", () => {
  it("verifies a wallet-signed production registration assertion", () => {
    const keyPair = nacl.sign.keyPair();
    const ownerPubkey = bs58.encode(Buffer.from(keyPair.publicKey));
    const ownerWallet = `solana:devnet:${ownerPubkey}`;
    const payload = buildExternalAppOwnerAssertionPayload({
      appId: "last-ignition",
      ownerWallet,
      manifestHash: "sha256:abc",
      audience: "alcheme:external-app-production-registration",
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    });
    const encoded = encodeExternalAppOwnerAssertionPayload(payload);
    const signature = Buffer.from(
      nacl.sign.detached(Buffer.from(encoded), keyPair.secretKey),
    ).toString("base64");

    expect(extractSolanaOwnerPubkey(ownerWallet)).toBe(ownerPubkey);
    expect(
      verifyExternalAppOwnerAssertion({
        assertion: { payload: encoded, signature },
        expected: {
          appId: "last-ignition",
          ownerWallet,
          manifestHash: "sha256:abc",
          audience: "alcheme:external-app-production-registration",
        },
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toMatchObject({ appId: "last-ignition", ownerWallet });
  });

  it("returns stable typed errors for malformed assertions", () => {
    expect(() =>
      verifyExternalAppOwnerAssertion({
        assertion: { payload: "not-json", signature: "bad" },
        expected: {
          appId: "last-ignition",
          ownerWallet: "solana:devnet:not-a-public-key",
          manifestHash: "sha256:abc",
          audience: "alcheme:external-app-production-registration",
        },
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toThrow("external_app_owner_assertion_public_key_invalid");
  });
});
