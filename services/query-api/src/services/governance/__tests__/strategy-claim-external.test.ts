import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  createExternalGovernanceClaim,
  verifyExternalGovernanceClaim,
} from "../strategies/claimExternal";

const NOW = new Date("2026-05-08T12:00:00.000Z");

describe("claim.external governance strategy", () => {
  test("verifies a scoped external claim with expiry and nonce", () => {
    const keyPair = nacl.sign.keyPair();
    const payload = createExternalGovernanceClaim({
      issuerRef: "example-web3-game",
      claimType: "room_membership",
      actionType: "external_room.members.sync",
      scopeType: "communication_room",
      scopeRef: "external:example-web3-game:dungeon:run-8791",
      targetRef: "wallet-a",
      actorPubkey: "wallet-a",
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const signature = Buffer.from(
      nacl.sign.detached(Buffer.from(payload.payload), keyPair.secretKey),
    ).toString("base64");

    expect(
      verifyExternalGovernanceClaim({
        claim: { payload: payload.payload, signature },
        issuerPublicKey: bs58.encode(Buffer.from(keyPair.publicKey)),
        expected: {
          issuerRef: "example-web3-game",
          claimType: "room_membership",
          actionType: "external_room.members.sync",
          scopeType: "communication_room",
          scopeRef: "external:example-web3-game:dungeon:run-8791",
          targetRef: "wallet-a",
        },
        now: NOW,
      }),
    ).toMatchObject({
      issuerRef: "example-web3-game",
      nonce: "claim-1",
      actorPubkey: "wallet-a",
    });
  });

  test("rejects expired or mismatched claims", () => {
    const keyPair = nacl.sign.keyPair();
    const payload = createExternalGovernanceClaim({
      issuerRef: "example-web3-game",
      claimType: "room_end",
      actionType: "room.end",
      scopeType: "communication_room",
      scopeRef: "external:example-web3-game:dungeon:run-8791",
      targetRef: "external:example-web3-game:dungeon:run-8791",
      expiresAt: "2026-05-08T11:59:00.000Z",
      nonce: "claim-expired",
    });
    const signature = Buffer.from(
      nacl.sign.detached(Buffer.from(payload.payload), keyPair.secretKey),
    ).toString("base64");

    expect(() =>
      verifyExternalGovernanceClaim({
        claim: { payload: payload.payload, signature },
        issuerPublicKey: bs58.encode(Buffer.from(keyPair.publicKey)),
        expected: {
          issuerRef: "example-web3-game",
          claimType: "room_end",
          actionType: "room.end",
          scopeType: "communication_room",
          scopeRef: "external:example-web3-game:dungeon:run-8791",
          targetRef: "external:example-web3-game:dungeon:run-8791",
        },
        now: NOW,
      }),
    ).toThrow("external governance claim expired");
  });
});
