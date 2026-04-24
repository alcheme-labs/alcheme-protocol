import { describe, expect, jest, test } from "@jest/globals";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { CirclesModule } from "../src/modules/circles";
import { PdaUtils } from "../src/utils/pda";

jest.mock("../src/utils/transactions", () => ({
  sendTransactionWithAlreadyProcessedRecovery: async (_provider: any, buildTransaction: () => Promise<any>) => {
    const transaction = await buildTransaction();
    if (transaction?.label === "restore_circle_tx") return "restore_circle_signature";
    if (transaction?.label === "migrate_circle_lifecycle_tx") return "migrate_circle_lifecycle_signature";
    return "archive_circle_signature";
  },
}));

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

describe("CirclesModule lifecycle routing", () => {
  test("archiveCircle routes owner/admin writes through circle_manager and event accounts", async () => {
    const pda = createPdaUtils();
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
          archiveCircle(reason: string) {
            calls.push({ reason });
            return {
              accounts(input: any) {
                calls.push({ accounts: input });
                return {
                  transaction: async () => ({ label: "archive_circle_tx" }),
                };
              },
            };
          },
        },
      },
      findCirclePda(circleId: number) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from("circle"), Buffer.from([circleId & 0xff])],
          PROGRAM_ID,
        )[0];
      },
    });

    const signature = await fakeModule.archiveCircle(7, "demo cleanup");
    const expectedCircleManager = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      PROGRAM_ID,
    )[0];

    expect(signature).toBe("archive_circle_signature");
    expect(calls[0]).toEqual({ reason: "demo cleanup" });
    expect(calls[1].accounts).toMatchObject({
      circleManager: expectedCircleManager,
      authority: AUTHORITY,
      eventProgram: EVENT_PROGRAM,
      eventEmitter: EVENT_EMITTER,
      eventBatch: EVENT_BATCH,
      systemProgram: SystemProgram.programId,
    });
  });

  test("restoreCircle routes owner/admin writes through circle_manager and event accounts", async () => {
    const pda = createPdaUtils();
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
          restoreCircle() {
            calls.push({ invoked: true });
            return {
              accounts(input: any) {
                calls.push({ accounts: input });
                return {
                  transaction: async () => ({ label: "restore_circle_tx" }),
                };
              },
            };
          },
        },
      },
      findCirclePda(circleId: number) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from("circle"), Buffer.from([circleId & 0xff])],
          PROGRAM_ID,
        )[0];
      },
    });

    const signature = await fakeModule.restoreCircle(7);
    const expectedCircleManager = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      PROGRAM_ID,
    )[0];

    expect(signature).toBe("restore_circle_signature");
    expect(calls[0]).toEqual({ invoked: true });
    expect(calls[1].accounts).toMatchObject({
      circleManager: expectedCircleManager,
      authority: AUTHORITY,
      eventProgram: EVENT_PROGRAM,
      eventEmitter: EVENT_EMITTER,
      eventBatch: EVENT_BATCH,
      systemProgram: SystemProgram.programId,
    });
  });

  test("migrateCircleLifecycle expands legacy accounts without event-emitter dependencies", async () => {
    const pda = createPdaUtils();
    const calls: any[] = [];
    const fakeModule = Object.assign(Object.create(CirclesModule.prototype), {
      provider: { publicKey: AUTHORITY },
      programId: PROGRAM_ID,
      pda,
      program: {
        methods: {
          migrateCircleLifecycle(circleId: number) {
            calls.push({ circleId });
            return {
              accounts(input: any) {
                calls.push({ accounts: input });
                return {
                  transaction: async () => ({ label: "migrate_circle_lifecycle_tx" }),
                };
              },
            };
          },
        },
      },
      findCirclePda(circleId: number) {
        return PublicKey.findProgramAddressSync(
          [Buffer.from("circle"), Buffer.from([circleId & 0xff])],
          PROGRAM_ID,
        )[0];
      },
    });

    const signature = await fakeModule.migrateCircleLifecycle(7);

    expect(signature).toBe("migrate_circle_lifecycle_signature");
    expect(calls[0]).toEqual({ circleId: 7 });
    expect(calls[1].accounts).toMatchObject({
      circle: fakeModule.findCirclePda(7),
      payer: AUTHORITY,
      systemProgram: SystemProgram.programId,
    });
  });
});
