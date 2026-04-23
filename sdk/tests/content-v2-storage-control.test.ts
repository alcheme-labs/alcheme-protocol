import { strict as assert } from "node:assert";
import { describe, it } from "@jest/globals";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { ContentModule } from "../src/modules/content";
import { PdaUtils } from "../src/utils/pda";

const AUTHOR = new PublicKey("11111111111111111111111111111111");
const CONTENT_PROGRAM = new PublicKey("FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y");
const IDENTITY_PROGRAM = new PublicKey("4C7M8s1PhHqZ43tQm4YqfK8hdyLjJk6fH7rLx2eV5nQa");
const ACCESS_PROGRAM = new PublicKey("8kq7nWQBh5Y2zJ4vLfQw8EJ4QUPK4r9owQ8h2Vv5RAnf");
const EVENT_PROGRAM = new PublicKey("uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC");
const FACTORY_PROGRAM = new PublicKey("GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ");
const CIRCLES_PROGRAM = new PublicKey("4sisPMeR1uY1wd6XKazN9VsXpXB764WeYYh14EDsujJ5");

function buildUpdateContentAnchorV2Mock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.updateContentAnchorV2.push(args);
    return {
      accounts(input: unknown) {
        calls.updateContentAnchorV2Accounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "update_content_anchor_v2_signature";
          },
        };
      },
    };
  };
}

function buildFakeModule(config: { signature?: string; error?: Error }) {
  const calls: Record<string, unknown[]> = {
    updateContentAnchorV2: [],
    updateContentAnchorV2Accounts: [],
  };

  const pda = new PdaUtils({
    identity: IDENTITY_PROGRAM,
    content: CONTENT_PROGRAM,
    access: ACCESS_PROGRAM,
    event: EVENT_PROGRAM,
    factory: FACTORY_PROGRAM,
    circles: CIRCLES_PROGRAM,
  });

  const fake: any = {
    provider: { publicKey: AUTHOR },
    pda,
    program: {
      methods: {
        updateContentAnchorV2: buildUpdateContentAnchorV2Mock(config, calls),
      },
    },
    resolveCreateContentAccounts: async () => ({
      identityProgram: IDENTITY_PROGRAM,
      userIdentity: pda.findUserIdentityPda(pda.findIdentityRegistryPda("social_hub_identity"), "alice"),
      accessProgram: ACCESS_PROGRAM,
      accessControllerAccount: pda.findAccessControllerPda(),
      eventProgram: EVENT_PROGRAM,
      eventEmitterAccount: pda.findEventEmitterPda(),
      eventBatch: pda.findEventSubscriptionPda(AUTHOR),
    }),
    normalizeContentHash: (ContentModule.prototype as any).normalizeContentHash,
    updateContentV2Anchor: (ContentModule.prototype as any).updateContentV2Anchor,
  };

  return { fake, calls, pda };
}

describe("ContentModule v2 storage control", () => {
  it("routes storage anchor updates through updateContentAnchorV2", async () => {
    const { fake, calls, pda } = buildFakeModule({ signature: "update_v2_ok" });
    const contentId = new BN(9001);
    const contentHashHex = "ab".repeat(32);

    const tx = await (ContentModule.prototype as any).updateContentV2Anchor.call(fake, {
      contentId,
      contentHash: contentHashHex,
      externalUri: "https://storage.example.com/posts/9001.json",
      identityHandle: "alice",
      identityRegistryName: "social_hub_identity",
    });

    assert.equal(tx, "update_v2_ok");
    assert.equal(calls.updateContentAnchorV2.length, 1, "expected v2 update route to be used");
    assert.equal((calls.updateContentAnchorV2[0][0] as BN).toString(), contentId.toString());
    assert.deepEqual(calls.updateContentAnchorV2[0][1], Array.from(Buffer.from(contentHashHex, "hex")));
    assert.equal(calls.updateContentAnchorV2[0][2], "https://storage.example.com/posts/9001.json");

    const accounts = calls.updateContentAnchorV2Accounts[0] as Record<string, PublicKey>;
    assert.equal(accounts.author.toBase58(), AUTHOR.toBase58());
    assert.equal(accounts.v2ContentAnchor.toBase58(), pda.findContentV2AnchorPda(AUTHOR, contentId).toBase58());
    assert.equal(accounts.identityProgram.toBase58(), IDENTITY_PROGRAM.toBase58());
    assert.equal(accounts.accessProgram.toBase58(), ACCESS_PROGRAM.toBase58());
    assert.equal(accounts.eventProgram.toBase58(), EVENT_PROGRAM.toBase58());
  });

  it("normalizes hex string content hashes for v2 anchor updates", async () => {
    const { fake, calls } = buildFakeModule({ signature: "normalize_ok" });

    await (ContentModule.prototype as any).updateContentV2Anchor.call(fake, {
      contentId: new BN(9002),
      contentHash: "0x" + "cd".repeat(32),
      externalUri: "ipfs://bafybeigdyrzt4",
      identityHandle: "alice",
      identityRegistryName: "social_hub_identity",
    });

    assert.deepEqual(
      calls.updateContentAnchorV2[0][1],
      Array.from(Buffer.from("cd".repeat(32), "hex"))
    );
  });

  it("rejects malformed content hash input before building the rpc call", async () => {
    const { fake, calls } = buildFakeModule({ signature: "should_not_run" });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).updateContentV2Anchor.call(fake, {
          contentId: new BN(9003),
          contentHash: "1234",
          externalUri: "ipfs://bafybad",
          identityHandle: "alice",
          identityRegistryName: "social_hub_identity",
        }),
      /contentHash must be a 32-byte hex string/i
    );

    assert.equal(calls.updateContentAnchorV2.length, 0, "expected malformed hash to fail before rpc");
  });
});
