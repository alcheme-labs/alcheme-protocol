import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { describe, it } from "@jest/globals";
import { CirclesModule } from "../src/modules/circles";

describe("circle create transaction recovery", () => {
  const circlesModulePath = path.join(__dirname, "..", "src/modules/circles.ts");

  function read(filePath: string): string {
    assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
    return fs.readFileSync(filePath, "utf8");
  }

  it("treats already-processed circle creation sends as success once the signature confirms", async () => {
    const calls: string[] = [];
    const fakeProvider = {
      publicKey: new PublicKey("5qyQxkF4v5oe4mYfP4Z9mZLxHjD7Q2W6AsVzTdDEr1xW"),
      opts: {
        preflightCommitment: "processed",
        commitment: "confirmed",
      },
      connection: {
        async getLatestBlockhash() {
          calls.push("getLatestBlockhash");
          return {
            blockhash: "blockhash-789",
            lastValidBlockHeight: 101,
          };
        },
        async sendRawTransaction(_raw: Uint8Array, options: Record<string, unknown>) {
          calls.push(`sendRawTransaction:${String(options.maxRetries)}`);
          throw new Error("Transaction simulation failed: This transaction has already been processed");
        },
        async confirmTransaction(strategy: Record<string, unknown>) {
          calls.push(`confirmTransaction:${String(strategy.signature)}`);
          return { value: { err: null } };
        },
      },
      wallet: {
        async signTransaction(transaction: any) {
          transaction.signature = Uint8Array.from([7, 8, 9, 10]);
          transaction.serialize = () => Uint8Array.from([1, 2, 3]);
          return transaction;
        },
      },
    };

    const fakeCircleModule = {
      provider: fakeProvider,
      programId: new PublicKey("CnRxBoM1S5Mzdg3NofM8JrjVNewc19hXtF87mpy4VbQ4"),
      encodeKnowledgeGovernance: () => ({ open: {} }),
      encodeDecisionEngine: () => ({ votingGovernance: {} }),
      resolveEventAccounts: async () => ({
        eventProgram: new PublicKey("8q1AqH2G9J2oDQQ7uUZ5EKeosFVJeGb3PcTJS3BM4tiT"),
        eventEmitter: new PublicKey("5iYVwBEmc6k9RdtqvYXvyfZ7Z84qxdjQbaAWkj2rW6zQ"),
        eventBatch: new PublicKey("Dcj6LjxnWjmBPtsyCJnH3UX77PGD6PEw24kTx5cHGNyE"),
      }),
      program: {
        methods: {
          createCircle: () => ({
            accounts: () => ({
              transaction: async () => ({
                feePayer: null,
                recentBlockhash: null,
                signature: null,
                serialize: () => Uint8Array.from([]),
              }),
            }),
          }),
        },
      },
    };

    const signature = await CirclesModule.prototype.createCircle.call(fakeCircleModule, {
      circleId: 7,
      name: "Knowledge Circle",
      level: 0,
      knowledgeGovernance: {
        minQualityScore: 50,
        minCuratorReputation: 10,
        transferCooldown: new BN(3600),
        maxTransfersPerDay: 10,
        requirePeerReview: false,
        peerReviewCount: 0,
        autoQualityCheck: true,
      },
      decisionEngine: {
        votingGovernance: {
          minVotes: new BN(1),
          voteDuration: new BN(86400),
          quorumPercentage: 50,
        },
      },
    });

    assert.equal(signature.length > 0, true);
    assert.deepEqual(calls, [
      "getLatestBlockhash",
      "sendRawTransaction:0",
      `confirmTransaction:${signature}`,
    ]);
  });

  it("routes circle creation through already-processed transaction recovery", () => {
    const source = read(circlesModulePath);

    assert.match(source, /async createCircle[\s\S]*sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(source, /\.accounts\([\s\S]*\)\s*\.transaction\(\)/);
  });

  it("routes circle flag updates through already-processed transaction recovery", () => {
    const source = read(circlesModulePath);

    assert.match(source, /async updateCircleFlags[\s\S]*sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(source, /updateCircleFlags\(circleId: number, flags: BN\): Promise<string>/);
  });
});
