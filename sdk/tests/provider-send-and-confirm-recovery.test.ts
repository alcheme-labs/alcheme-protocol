import { strict as assert } from "node:assert";
import { describe, it } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";
import {
  installAlreadyProcessedSendAndConfirmRecovery,
} from "../src/utils/transactions";

describe("provider sendAndConfirm recovery", () => {
  it("patches provider.sendAndConfirm so rpc-style writes recover from already-processed retries", async () => {
    const calls: string[] = [];
    const provider: any = {
      publicKey: new PublicKey("5qyQxkF4v5oe4mYfP4Z9mZLxHjD7Q2W6AsVzTdDEr1xW"),
      opts: {
        preflightCommitment: "processed",
        commitment: "confirmed",
      },
      connection: {
        async getLatestBlockhash() {
          calls.push("getLatestBlockhash");
          return {
            blockhash: "blockhash-provider-123",
            lastValidBlockHeight: 42,
          };
        },
        async sendRawTransaction(_raw: Uint8Array, options: Record<string, unknown>) {
          calls.push(`sendRawTransaction:${String(options.maxRetries)}`);
          throw new Error("Transaction simulation failed: This transaction has already been processed");
        },
        async confirmTransaction(strategy: string | { signature: string }) {
          const signature = typeof strategy === "string" ? strategy : strategy.signature;
          calls.push(`confirmTransaction:${signature}`);
          return { value: { err: null } };
        },
      },
      wallet: {
        publicKey: new PublicKey("5qyQxkF4v5oe4mYfP4Z9mZLxHjD7Q2W6AsVzTdDEr1xW"),
        async signTransaction(transaction: any) {
          transaction.signature = Uint8Array.from([11, 12, 13, 14]);
          transaction.serialize = () => Uint8Array.from([9, 9, 9]);
          return transaction;
        },
      },
      async sendAndConfirm() {
        throw new Error("original sendAndConfirm should be replaced");
      },
    };

    installAlreadyProcessedSendAndConfirmRecovery(provider);

    const tx: any = {
      feePayer: null,
      recentBlockhash: null,
      signature: null,
      serialize: () => Uint8Array.from([]),
    };

    const signature = await provider.sendAndConfirm(tx);

    assert.equal(signature.length > 0, true);
    assert.deepEqual(calls, [
      "getLatestBlockhash",
      "sendRawTransaction:0",
      `confirmTransaction:${signature}`,
    ]);
  });
});
