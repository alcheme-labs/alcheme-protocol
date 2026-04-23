import { describe, expect, test } from "@jest/globals";
import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram } from "@solana/web3.js";

import { CirclesModule } from "../src/modules/circles";
import { PdaUtils } from "../src/utils/pda";

const PROGRAM_ID = new PublicKey("GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ");
const AUTHORITY = new PublicKey("11111111111111111111111111111111");
const EVENT_PROGRAM = new PublicKey("HRv5Fn4DLKfZ9pBBgHMknP9tAMXaN1bnuZyXfVE4sjkF");
const EVENT_EMITTER = new PublicKey("8ZiyjNgn5wYxgQjN5x1aM5q1Q12u3S7n9L8yb9o8FQ7r");
const EVENT_BATCH = new PublicKey("6m6J8y4e6u4Yv6Ew6D1jFJfM1Fh3h6gW5L2aR7x8q9pT");

function createPdaUtils(): PdaUtils {
  return new PdaUtils({
    identity: new PublicKey("AVM2fUczG78g3LmPG7qVwEz2EL4QDz1QW38iZLo6Vn78"),
    content: new PublicKey("4A4hbQW7xS5f7xdr2q72V5o3wQNd1rjMe6joMnHh4jtd"),
    access: new PublicKey("2vT8eQv9yEJxZkL1zV76QeP2S2f1pL1yF6zTWGac4Bqs"),
    event: EVENT_PROGRAM,
    factory: new PublicKey("5Ww8RgyjvA3p4Kp6Q83z1L6bqq6mPj6dTvSxVbG3fDNm"),
    circles: PROGRAM_ID,
  });
}

describe("CirclesModule membership attestor routing", () => {
  test("findMembershipAttestorRegistryPda derives the membership registry seed on the circles program", () => {
    const pda = createPdaUtils();
    const expected = PublicKey.findProgramAddressSync(
      [Buffer.from("membership_attestor_registry")],
      PROGRAM_ID,
    )[0];

    expect(pda.findMembershipAttestorRegistryPda().toBase58()).toBe(expected.toBase58());
  });

  test("initializeMembershipAttestorRegistry binds initialization authority to circle_manager admin", async () => {
    const pda = createPdaUtils();
    const calls: any[] = [];
    const fakeModule = Object.assign(Object.create(CirclesModule.prototype), {
      provider: { publicKey: AUTHORITY },
      programId: PROGRAM_ID,
      pda,
      program: {
        methods: {
          initializeMembershipAttestorRegistry() {
            return {
              accounts(input: any) {
                calls.push(input);
                return {
                  rpc: async () => "init_membership_attestor_registry_signature",
                };
              },
            };
          },
        },
      },
    });

    const signature = await fakeModule.initializeMembershipAttestorRegistry();
    const expectedCircleManager = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      PROGRAM_ID,
    )[0];

    expect(signature).toBe("init_membership_attestor_registry_signature");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      membershipAttestorRegistry: pda.findMembershipAttestorRegistryPda(),
      circleManager: expectedCircleManager,
      admin: AUTHORITY,
      systemProgram: SystemProgram.programId,
    });
  });

  test("registerMembershipAttestor routes admin writes through the membership attestor registry PDA", async () => {
    const pda = createPdaUtils();
    const attestor = new PublicKey("7wQmK7xZQ5e8ngz8qQjJvLwF4n7Xh8y5p9x8Vn4xS2Rv");
    const calls: any[] = [];
    const fakeModule = Object.assign(Object.create(CirclesModule.prototype), {
      provider: { publicKey: AUTHORITY },
      programId: PROGRAM_ID,
      pda,
      async resolveEventAccounts() {
        return { eventProgram: EVENT_PROGRAM, eventEmitter: EVENT_EMITTER, eventBatch: EVENT_BATCH };
      },
      program: {
        methods: {
          registerMembershipAttestor(target: PublicKey) {
            calls.push({ target });
            return {
              accounts(input: any) {
                calls.push({ accounts: input });
                return {
                  rpc: async () => "register_membership_attestor_signature",
                };
              },
            };
          },
        },
      },
    });

    const signature = await fakeModule.registerMembershipAttestor(attestor);

    expect(signature).toBe("register_membership_attestor_signature");
    expect(calls[0].target.toBase58()).toBe(attestor.toBase58());
    expect(calls[1].accounts).toMatchObject({
      membershipAttestorRegistry: pda.findMembershipAttestorRegistryPda(),
      admin: AUTHORITY,
      eventProgram: EVENT_PROGRAM,
      eventEmitter: EVENT_EMITTER,
      eventBatch: EVENT_BATCH,
      systemProgram: SystemProgram.programId,
    });
  });

  test("revokeMembershipAttestor routes admin writes through the membership attestor registry PDA", async () => {
    const pda = createPdaUtils();
    const attestor = new PublicKey("7wQmK7xZQ5e8ngz8qQjJvLwF4n7Xh8y5p9x8Vn4xS2Rv");
    const calls: any[] = [];
    const fakeModule = Object.assign(Object.create(CirclesModule.prototype), {
      provider: { publicKey: AUTHORITY },
      programId: PROGRAM_ID,
      pda,
      async resolveEventAccounts() {
        return { eventProgram: EVENT_PROGRAM, eventEmitter: EVENT_EMITTER, eventBatch: EVENT_BATCH };
      },
      program: {
        methods: {
          revokeMembershipAttestor(target: PublicKey) {
            calls.push({ target });
            return {
              accounts(input: any) {
                calls.push({ accounts: input });
                return {
                  rpc: async () => "revoke_membership_attestor_signature",
                };
              },
            };
          },
        },
      },
    });

    const signature = await fakeModule.revokeMembershipAttestor(attestor);

    expect(signature).toBe("revoke_membership_attestor_signature");
    expect(calls[0].target.toBase58()).toBe(attestor.toBase58());
    expect(calls[1].accounts).toMatchObject({
      membershipAttestorRegistry: pda.findMembershipAttestorRegistryPda(),
      admin: AUTHORITY,
      eventProgram: EVENT_PROGRAM,
      eventEmitter: EVENT_EMITTER,
      eventBatch: EVENT_BATCH,
      systemProgram: SystemProgram.programId,
    });
  });

  test("claimCircleMembership appends the membership attestor registry PDA to the claim transaction", async () => {
    const pda = createPdaUtils();
    const sent: any[] = [];
    const fakeModule = Object.assign(Object.create(CirclesModule.prototype), {
      provider: {
        publicKey: AUTHORITY,
        async sendAndConfirm(transaction: any) {
          sent.push(transaction);
          return "claim_membership_signature";
        },
      },
      programId: PROGRAM_ID,
      pda,
      eventProgram: { programId: EVENT_PROGRAM },
      async resolveEventAccounts() {
        return { eventProgram: EVENT_PROGRAM, eventEmitter: EVENT_EMITTER, eventBatch: EVENT_BATCH };
      },
    });

    const signature = await fakeModule.claimCircleMembership({
      circleId: 7,
      role: "Member",
      kind: "Open",
      artifactId: 0,
      issuedAt: "2026-04-23T12:00:00.000Z",
      expiresAt: "2026-04-23T12:10:00.000Z",
      issuerKeyId: new PublicKey("4wBqpZM9xaGgkQ8WXVbwyodH4qzM7gc3KJ2YMBX1AHzm").toBase58(),
      issuedSignature: "44".repeat(64),
    });

    expect(signature).toBe("claim_membership_signature");
    expect(sent).toHaveLength(1);
    expect(sent[0].instructions).toHaveLength(2);
    expect(sent[0].instructions[1].keys.at(-1)?.pubkey.toBase58()).toBe(
      pda.findMembershipAttestorRegistryPda().toBase58(),
    );
    expect(sent[0].instructions[1].keys[4].pubkey.toBase58()).toBe(
      SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),
    );
  });
});
