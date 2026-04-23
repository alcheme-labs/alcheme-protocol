// @ts-nocheck
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it, before } from "mocha";
import { BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Alcheme } from "../sdk/src/alcheme";

const LOCAL_RPC_URL = "http://127.0.0.1:8899";
const QUERY_API_BASE_URL = "http://127.0.0.1:4000";

type LocalnetConfig = {
  network: string;
  programIds: {
    identity: string;
    content: string;
    access: string;
    event: string;
    factory: string;
    messaging?: string;
    circles?: string;
    contributionEngine?: string;
  };
};

function loadLocalnetConfig(): LocalnetConfig {
  const configPath = path.resolve(process.cwd(), "sdk", "localnet-config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as LocalnetConfig;
}

function createSdk(connection: Connection, signer: Keypair, config: LocalnetConfig): Alcheme {
  const sdk = new Alcheme({
    connection,
    wallet: new Wallet(signer),
    programIds: config.programIds,
  });
  sdk.content.setQueryApiBaseUrl(QUERY_API_BASE_URL);
  return sdk;
}

function uniqueHandle(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff)
    .toString(36)
    .padStart(3, "0")}`.slice(0, 24);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function airdropAndConfirm(
  connection: Connection,
  recipient: PublicKey,
  sol = 2
): Promise<void> {
  const signature = await connection.requestAirdrop(recipient, sol * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );
}

async function waitForAccount(
  connection: Connection,
  address: PublicKey,
  label: string,
  timeoutMs = 45_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const account = await connection.getAccountInfo(address, "confirmed");
    if (account) {
      return;
    }
    await sleep(500);
  }

  throw new Error(`${label} was not created within ${timeoutMs}ms`);
}

async function waitForIndexedPost(
  contentId: BN,
  timeoutMs = 90_000
): Promise<any> {
  const startedAt = Date.now();
  let lastError = "";
  const query = `
    query IntegrationPost($contentId: String!) {
      post(contentId: $contentId) {
        contentId
        visibility
        status
        v2AudienceKind
        v2Status
        protocolCircleId
        circleOnChainAddress
        author {
          pubkey
        }
      }
    }
  `;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${QUERY_API_BASE_URL}/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          contentId: contentId.toString(),
        },
      }),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.data?.post) {
        return payload.data.post;
      }
      lastError = JSON.stringify(payload);
      await sleep(1_500);
      continue;
    }

    lastError = `${response.status} ${await response.text()}`;
    await sleep(1_500);
  }

  throw new Error(`post ${contentId.toString()} was not indexed within ${timeoutMs}ms; last=${lastError}`);
}

describe("Alcheme Protocol Integration Tests", function () {
  this.timeout(300_000);

  const connection = new Connection(LOCAL_RPC_URL, "confirmed");
  const config = loadLocalnetConfig();

  const alice = Keypair.generate();
  const bob = Keypair.generate();

  const aliceHandle = uniqueHandle("alice");
  const bobHandle = uniqueHandle("bob");

  const aliceSdk = createSdk(connection, alice, config);
  const bobSdk = createSdk(connection, bob, config);

  const alicePublicContentId = aliceSdk.content.createV2ContentId();
  const alicePrivateDraftContentId = aliceSdk.content.createV2ContentId();
  const aliceFollowersContentId = aliceSdk.content.createV2ContentId();
  const bobReplyContentId = bobSdk.content.createV2ContentId();
  const bobRepostContentId = bobSdk.content.createV2ContentId();
  const bobQuoteContentId = bobSdk.content.createV2ContentId();

  before(async () => {
    await airdropAndConfirm(connection, alice.publicKey, 3);
    await airdropAndConfirm(connection, bob.publicKey, 3);

    await aliceSdk.identity.registerIdentity(aliceHandle, aliceHandle);
    await bobSdk.identity.registerIdentity(bobHandle, bobHandle);
  });

  it("creates public/private/followers v2 content and indexes raw audience fields", async () => {
    await aliceSdk.content.createContent({
      contentId: alicePublicContentId,
      text: "integration public v2 post",
      contentType: "Text",
      identityHandle: aliceHandle,
      externalUri: `https://example.test/content/${alicePublicContentId.toString()}`,
    });

    await aliceSdk.content.createContent({
      contentId: alicePrivateDraftContentId,
      text: "integration private draft v2 post",
      contentType: "Text",
      identityHandle: aliceHandle,
      visibilityLevel: "Private",
      contentStatus: "Draft",
      externalUri: `https://example.test/private/${alicePrivateDraftContentId.toString()}`,
    });

    await aliceSdk.content.createContent({
      contentId: aliceFollowersContentId,
      text: "integration followers-only v2 post",
      contentType: "Text",
      identityHandle: aliceHandle,
      visibilityLevel: "Followers",
      externalUri: `https://example.test/followers/${aliceFollowersContentId.toString()}`,
    });

    await Promise.all([
      waitForAccount(
        connection,
        aliceSdk.pda.findContentV2AnchorPda(alice.publicKey, alicePublicContentId),
        "alice public v2 anchor"
      ),
      waitForAccount(
        connection,
        aliceSdk.pda.findContentV2AnchorPda(alice.publicKey, alicePrivateDraftContentId),
        "alice private draft v2 anchor"
      ),
      waitForAccount(
        connection,
        aliceSdk.pda.findContentV2AnchorPda(alice.publicKey, aliceFollowersContentId),
        "alice followers-only v2 anchor"
      ),
    ]);

    const [publicPost, privateDraftPost, followersPost] = await Promise.all([
      waitForIndexedPost(alicePublicContentId),
      waitForIndexedPost(alicePrivateDraftContentId),
      waitForIndexedPost(aliceFollowersContentId),
    ]);

    assert.equal(publicPost.author.pubkey, alice.publicKey.toBase58());
    assert.equal(publicPost.v2AudienceKind, "Public");
    assert.match(String(publicPost.v2Status || publicPost.status), /Published|Active/);

    assert.equal(privateDraftPost.author.pubkey, alice.publicKey.toBase58());
    assert.equal(privateDraftPost.v2AudienceKind, "Private");
    assert.equal(String(privateDraftPost.v2Status || privateDraftPost.status), "Draft");

    assert.equal(followersPost.author.pubkey, alice.publicKey.toBase58());
    assert.equal(followersPost.v2AudienceKind, "FollowersOnly");
    assert.match(String(followersPost.v2Status || followersPost.status), /Published|Active/);
  });

  it("enforces follow facts for by-id v2 reply and supports quote/repost auto-lookup", async () => {
    await assert.rejects(
      bobSdk.content.createReplyById(
        bobSdk.content.createV2ContentId(),
        aliceFollowersContentId,
        "this should fail before follow",
        "Text",
        undefined,
        {
          identityHandle: bobHandle,
          parentAuthorPubkey: alice.publicKey.toBase58(),
        }
      ),
      /follow|permission|access|relationship|visible|public/i
    );

    await bobSdk.identity.followUser(alice.publicKey);
    const followRelationshipPda = bobSdk.pda.findFollowRelationshipPda(
      bob.publicKey,
      alice.publicKey,
    );
    await waitForAccount(
      connection,
      followRelationshipPda,
      "follow relationship"
    );
    const followRelationshipAccount = await connection.getAccountInfo(
      followRelationshipPda,
      "confirmed",
    );
    assert.ok(followRelationshipAccount, "follow relationship account should exist after follow_user");
    assert.equal(
      followRelationshipAccount.owner.toBase58(),
      config.programIds.access,
      "follow relationship account owner should be access-controller",
    );
    assert.equal(
      new PublicKey(followRelationshipAccount.data.subarray(9, 41)).toBase58(),
      bob.publicKey.toBase58(),
      "follow relationship account should store follower wallet pubkey",
    );
    assert.equal(
      new PublicKey(followRelationshipAccount.data.subarray(41, 73)).toBase58(),
      alice.publicKey.toBase58(),
      "follow relationship account should store followed wallet pubkey",
    );
    const relationProofs = await (bobSdk.content as any).resolveRelationProofAccounts(
      aliceFollowersContentId.toString(),
      bob.publicKey,
      "integration createReplyById v2 route",
      alice.publicKey.toBase58(),
    );
    assert.equal(
      relationProofs.targetFollowRelationship.toBase58(),
      followRelationshipPda.toBase58(),
      "SDK should route FollowersOnly target reply through the live follow relationship PDA",
    );
    const replyAccountBundle = await (bobSdk.content as any).resolveCreateContentAccounts({
      identityHandle: bobHandle,
      identityRegistryName: "social_hub_identity",
    });
    const replyPreviewContentId = bobSdk.content.createV2ContentId();
    const replyPreviewHash = (bobSdk.content as any).buildV2ContentHash({
      contentId: replyPreviewContentId.toString(),
      parentContentId: aliceFollowersContentId.toString(),
      author: bob.publicKey.toBase58(),
      text: "reply after follow",
      contentType: { text: {} },
    });
    const replyPreviewUri = (bobSdk.content as any).buildV2UriRef(
      undefined,
      replyPreviewContentId,
      "reply",
    );
    const replyPreviewIx = await ((bobSdk.content as any).program.methods as any)
      .createReplyV2ById(
        replyPreviewContentId,
        aliceFollowersContentId,
        replyPreviewHash,
        replyPreviewUri,
      )
      .accounts({
        contentManager: bobSdk.pda.findContentManagerPda(),
        v2ContentAnchor: bobSdk.pda.findContentV2AnchorPda(bob.publicKey, replyPreviewContentId),
        parentAuthor: alice.publicKey,
        parentV2ContentAnchor: bobSdk.pda.findContentV2AnchorPda(
          alice.publicKey,
          aliceFollowersContentId,
        ),
        targetFollowRelationship: relationProofs.targetFollowRelationship,
        targetCircleMembership: relationProofs.targetCircleMembership,
        author: bob.publicKey,
        identityProgram: replyAccountBundle.identityProgram,
        userIdentity: replyAccountBundle.userIdentity,
        accessProgram: replyAccountBundle.accessProgram,
        accessControllerAccount: replyAccountBundle.accessControllerAccount,
        eventProgram: replyAccountBundle.eventProgram,
        eventEmitterAccount: replyAccountBundle.eventEmitterAccount,
        eventBatch: replyAccountBundle.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    assert.ok(
      replyPreviewIx.keys.some(({ pubkey }) => pubkey.toBase58() === followRelationshipPda.toBase58()),
      "reply instruction should include the live follow relationship PDA in account metas",
    );
    assert.equal(
      replyPreviewIx.keys[4]?.pubkey.toBase58(),
      followRelationshipPda.toBase58(),
      "reply instruction should place the live follow relationship PDA in the target_follow_relationship slot",
    );

    const replySignature = await bobSdk.content.createReplyById(
      bobReplyContentId,
      aliceFollowersContentId,
      "reply after follow",
      "Text",
      undefined,
      {
        identityHandle: bobHandle,
        parentAuthorPubkey: alice.publicKey.toBase58(),
      }
    );
    assert.ok(replySignature.length > 0);

    const repostSignature = await bobSdk.content.createRepostById(
      bobRepostContentId,
      alicePublicContentId,
      undefined,
      {
        identityHandle: bobHandle,
        originalAuthorPubkey: alice.publicKey.toBase58(),
      }
    );
    assert.ok(repostSignature.length > 0);

    const quoteSignature = await bobSdk.content.createQuoteById(
      bobQuoteContentId,
      alicePublicContentId,
      "quoting the public post",
      undefined,
      {
        identityHandle: bobHandle,
        quotedAuthorPubkey: alice.publicKey.toBase58(),
      }
    );
    assert.ok(quoteSignature.length > 0);

    await Promise.all([
      waitForAccount(
        connection,
        bobSdk.pda.findContentV2AnchorPda(bob.publicKey, bobReplyContentId),
        "bob reply v2 anchor"
      ),
      waitForAccount(
        connection,
        bobSdk.pda.findContentV2AnchorPda(bob.publicKey, bobRepostContentId),
        "bob repost v2 anchor"
      ),
      waitForAccount(
        connection,
        bobSdk.pda.findContentV2AnchorPda(bob.publicKey, bobQuoteContentId),
        "bob quote v2 anchor"
      ),
    ]);
  });

  it("rejects explicit v1 write route and fallback flags", async () => {
    await assert.rejects(
      aliceSdk.content.createContent({
        contentId: aliceSdk.content.createV2ContentId(),
        text: "v1 should stay disabled",
        contentType: "Text",
        identityHandle: aliceHandle,
        useV2: false,
      }),
      /v1 write path is disabled/i
    );

    await assert.rejects(
      aliceSdk.content.createContent({
        contentId: aliceSdk.content.createV2ContentId(),
        text: "v1 fallback should stay disabled",
        contentType: "Text",
        identityHandle: aliceHandle,
        enableV1FallbackOnV2Failure: true,
      }),
      /v1 fallback is disabled/i
    );
  });
});
