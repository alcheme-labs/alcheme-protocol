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
const PARENT_CONTENT = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const ORIGINAL_CONTENT = new PublicKey("SysvarRent111111111111111111111111111111111");
const PARENT_AUTHOR = new PublicKey("Sysvar1111111111111111111111111111111111111");
const ORIGINAL_AUTHOR = new PublicKey("Stake11111111111111111111111111111111111111");
const QUOTED_AUTHOR = new PublicKey("SysvarRecentB1ockHashes11111111111111111111");

function buildCreateContentMock(signature: string, calls: Record<string, unknown[]>) {
  return (...args: unknown[]) => {
    calls.createContent.push(args);
    return {
      accounts(input: unknown) {
        calls.createContentAccounts.push(input);
        return {
          rpc: async () => signature,
        };
      },
    };
  };
}

function buildCreateContentV2Mock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createContentV2.push(args);
    return {
      accounts(input: unknown) {
        calls.createContentV2Accounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "v2_signature";
          },
        };
      },
    };
  };
}

function buildCreateContentV2WithAccessMock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createContentV2WithAccess.push(args);
    calls.createContentV2.push(args);
    return {
      accounts(input: unknown) {
        calls.createContentV2WithAccessAccounts.push(input);
        calls.createContentV2Accounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "v2_signature";
          },
        };
      },
    };
  };
}

function buildCreateReplyMock(signature: string, calls: Record<string, unknown[]>) {
  return (...args: unknown[]) => {
    calls.createReply.push(args);
    return {
      accounts(input: unknown) {
        calls.createReplyAccounts.push(input);
        return {
          rpc: async () => signature,
        };
      },
    };
  };
}

function buildCreateReplyV2Mock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createReplyV2.push(args);
    return {
      accounts(input: unknown) {
        calls.createReplyV2Accounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "reply_v2_signature";
          },
        };
      },
    };
  };
}

function buildCreateReplyV2ByIdMock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createReplyV2ById.push(args);
    return {
      accounts(input: unknown) {
        calls.createReplyV2ByIdAccounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "reply_v2_by_id_signature";
          },
        };
      },
    };
  };
}

function buildCreateRepostMock(signature: string, calls: Record<string, unknown[]>) {
  return (...args: unknown[]) => {
    calls.createRepost.push(args);
    return {
      accounts(input: unknown) {
        calls.createRepostAccounts.push(input);
        return {
          rpc: async () => signature,
        };
      },
    };
  };
}

function buildCreateRepostV2Mock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createRepostV2.push(args);
    return {
      accounts(input: unknown) {
        calls.createRepostV2Accounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "repost_v2_signature";
          },
        };
      },
    };
  };
}

function buildCreateRepostV2ByIdMock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createRepostV2ById.push(args);
    return {
      accounts(input: unknown) {
        calls.createRepostV2ByIdAccounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "repost_v2_by_id_signature";
          },
        };
      },
    };
  };
}

function buildCreateQuoteMock(signature: string, calls: Record<string, unknown[]>) {
  return (...args: unknown[]) => {
    calls.createQuote.push(args);
    return {
      accounts(input: unknown) {
        calls.createQuoteAccounts.push(input);
        return {
          rpc: async () => signature,
        };
      },
    };
  };
}

function buildCreateQuoteV2Mock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createQuoteV2.push(args);
    return {
      accounts(input: unknown) {
        calls.createQuoteV2Accounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "quote_v2_signature";
          },
        };
      },
    };
  };
}

function buildCreateQuoteV2ByIdMock(
  options: { signature?: string; error?: Error },
  calls: Record<string, unknown[]>
) {
  return (...args: unknown[]) => {
    calls.createQuoteV2ById.push(args);
    return {
      accounts(input: unknown) {
        calls.createQuoteV2ByIdAccounts.push(input);
        return {
          rpc: async () => {
            if (options.error) {
              throw options.error;
            }
            return options.signature || "quote_v2_by_id_signature";
          },
        };
      },
    };
  };
}

function buildFakeModule(config: {
  v1Signature?: string;
  v2Signature?: string;
  v2Error?: Error;
  replyV1Signature?: string;
  replyV2Signature?: string;
  replyV2Error?: Error;
  repostV1Signature?: string;
  repostV2Signature?: string;
  repostV2Error?: Error;
  quoteV1Signature?: string;
  quoteV2Signature?: string;
  quoteV2Error?: Error;
}) {
  const calls: Record<string, unknown[]> = {
    createContent: [],
    createContentAccounts: [],
    createContentV2: [],
    createContentV2Accounts: [],
    createContentV2WithAccess: [],
    createContentV2WithAccessAccounts: [],
    createReply: [],
    createReplyAccounts: [],
    createReplyV2: [],
    createReplyV2Accounts: [],
    createReplyV2ById: [],
    createReplyV2ByIdAccounts: [],
    createRepost: [],
    createRepostAccounts: [],
    createRepostV2: [],
    createRepostV2Accounts: [],
    createRepostV2ById: [],
    createRepostV2ByIdAccounts: [],
    createQuote: [],
    createQuoteAccounts: [],
    createQuoteV2: [],
    createQuoteV2Accounts: [],
    createQuoteV2ById: [],
    createQuoteV2ByIdAccounts: [],
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
    queryApiBaseUrl: "http://127.0.0.1:4000",
    pda,
    program: {
      methods: {
        createContent: buildCreateContentMock(config.v1Signature || "v1_signature", calls),
        createContentV2: buildCreateContentV2Mock(
          { signature: config.v2Signature, error: config.v2Error },
          calls
        ),
        createContentV2WithAccess: buildCreateContentV2WithAccessMock(
          { signature: config.v2Signature, error: config.v2Error },
          calls
        ),
        createReply: buildCreateReplyMock(config.replyV1Signature || "reply_v1_signature", calls),
        createReplyV2: buildCreateReplyV2Mock(
          { signature: config.replyV2Signature, error: config.replyV2Error },
          calls
        ),
        createReplyV2ById: buildCreateReplyV2ByIdMock(
          { signature: "reply_v2_by_id_ok" },
          calls
        ),
        createRepost: buildCreateRepostMock(config.repostV1Signature || "repost_v1_signature", calls),
        createRepostV2: buildCreateRepostV2Mock(
          { signature: config.repostV2Signature, error: config.repostV2Error },
          calls
        ),
        createRepostV2ById: buildCreateRepostV2ByIdMock(
          { signature: "repost_v2_by_id_ok" },
          calls
        ),
        createQuote: buildCreateQuoteMock(config.quoteV1Signature || "quote_v1_signature", calls),
        createQuoteV2: buildCreateQuoteV2Mock(
          { signature: config.quoteV2Signature, error: config.quoteV2Error },
          calls
        ),
        createQuoteV2ById: buildCreateQuoteV2ByIdMock(
          { signature: "quote_v2_by_id_ok" },
          calls
        ),
      },
    },
    normalizeV1ExternalUri: (ContentModule.prototype as any).normalizeV1ExternalUri,
    randomBits: (ContentModule.prototype as any).randomBits,
    resolveCreateContentAccounts: async () => ({
      identityProgram: IDENTITY_PROGRAM,
      userIdentity: pda.findUserIdentityPda(pda.findIdentityRegistryPda("social_hub_identity"), "alice"),
      accessProgram: ACCESS_PROGRAM,
      accessControllerAccount: pda.findAccessControllerPda(),
      eventProgram: EVENT_PROGRAM,
      eventEmitterAccount: pda.findEventEmitterPda(),
      eventBatch: pda.findEventSubscriptionPda(AUTHOR),
    }),
    toContentTypeVariant: (ContentModule.prototype as any).toContentTypeVariant,
    buildVisibilitySettings: (ContentModule.prototype as any).buildVisibilitySettings,
    buildV2UriRef: (ContentModule.prototype as any).buildV2UriRef,
    buildV2ContentHash: (ContentModule.prototype as any).buildV2ContentHash,
    toAccessLevelVariant: (ContentModule.prototype as any).toAccessLevelVariant,
    toContentStatusVariant: (ContentModule.prototype as any).toContentStatusVariant,
    extractErrorMessage: (ContentModule.prototype as any).extractErrorMessage,
    requireRouteAuthorPubkey: (ContentModule.prototype as any).requireRouteAuthorPubkey,
    toOptionalInteger: (ContentModule.prototype as any).toOptionalInteger,
    normalizeQueryApiBaseUrl: (ContentModule.prototype as any).normalizeQueryApiBaseUrl,
    normalizeTargetPostMetadata: (ContentModule.prototype as any).normalizeTargetPostMetadata,
    normalizeAudienceKind: (ContentModule.prototype as any).normalizeAudienceKind,
    resolveQueryApiBaseUrl: (ContentModule.prototype as any).resolveQueryApiBaseUrl,
    resolveRouteAuthorPubkey: (ContentModule.prototype as any).resolveRouteAuthorPubkey,
    lookupTargetPostMetadataByContentId: async () => ({
      authorPubkey: PARENT_AUTHOR.toBase58(),
      visibility: "Public",
      status: "Published",
      v2AudienceKind: "Public",
      v2AudienceRef: null,
      protocolCircleId: null,
      circleOnChainAddress: null,
    }),
    resolveRelationProofAccounts: (ContentModule.prototype as any).resolveRelationProofAccounts,
    assertV2OnlyWriteRoute: (ContentModule.prototype as any).assertV2OnlyWriteRoute,
    toEventSequenceHint: (ContentModule.prototype as any).toEventSequenceHint,
    createContentV1: (ContentModule.prototype as any).createContentV1,
    createContentV2: (ContentModule.prototype as any).createContentV2,
    createReplyV1: (ContentModule.prototype as any).createReplyV1,
    createReplyV2: (ContentModule.prototype as any).createReplyV2,
    createReplyById: (ContentModule.prototype as any).createReplyById,
    createReplyV2ById: (ContentModule.prototype as any).createReplyV2ById,
    createRepostV1: (ContentModule.prototype as any).createRepostV1,
    createRepostV2: (ContentModule.prototype as any).createRepostV2,
    createRepostById: (ContentModule.prototype as any).createRepostById,
    createRepostV2ById: (ContentModule.prototype as any).createRepostV2ById,
    createQuote: (ContentModule.prototype as any).createQuote,
    createQuoteV2: (ContentModule.prototype as any).createQuoteV2,
    createQuoteById: (ContentModule.prototype as any).createQuoteById,
    createQuoteV2ById: (ContentModule.prototype as any).createQuoteV2ById,
  };

  return { fake, calls, pda };
}

describe("ContentModule v2 routing", () => {
  it("defaults createContent route to v2 when useV2 is omitted", async () => {
    const { fake, calls } = buildFakeModule({ v1Signature: "v1_should_not_run", v2Signature: "v2_default_ok" });

    const tx = await (ContentModule.prototype as any).createContent.call(fake, {
      contentId: new BN(100),
      text: "default route",
      contentType: "Post",
      identityHandle: "alice",
    });

    assert.equal(tx, "v2_default_ok");
    assert.equal(calls.createContentV2.length, 1, "expected default route to call v2");
    assert.equal(calls.createContent.length, 0, "expected default route to skip v1");
  });

  it("rejects explicit useV2=false because v1 write path is disabled", async () => {
    const { fake, calls } = buildFakeModule({ v1Signature: "v1_should_not_run", v2Signature: "v2_should_not_run" });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createContent.call(fake, {
          contentId: new BN(101),
          text: "explicit v1 route",
          contentType: "Post",
          identityHandle: "alice",
          useV2: false,
        }),
      /v1 write path is disabled/i
    );

    assert.equal(calls.createContent.length, 0, "expected explicit useV2=false not to call v1");
    assert.equal(calls.createContentV2.length, 0, "expected explicit useV2=false not to call v2");
  });

  it("keeps non-public visibility on v2 route when useV2 is omitted", async () => {
    const { fake, calls } = buildFakeModule({ v1Signature: "v1_should_not_run", v2Signature: "v2_private_ok" });

    const tx = await (ContentModule.prototype as any).createContent.call(fake, {
      contentId: new BN(102),
      text: "private default route",
      contentType: "Post",
      identityHandle: "alice",
      visibilityLevel: "Private",
    });

    assert.equal(tx, "v2_private_ok");
    assert.equal(calls.createContent.length, 0, "expected non-public default route to skip v1");
    assert.equal(calls.createContentV2.length, 1, "expected non-public default route to keep v2");
  });

  it("Batch9 RED->GREEN: default route should keep private writes on v2 private path", async () => {
    const { fake, calls } = buildFakeModule({ v1Signature: "v1_should_not_run", v2Signature: "v2_private_future_ok" });

    const tx = await (ContentModule.prototype as any).createContent.call(fake, {
      contentId: new BN(103),
      text: "private default route should stay v2",
      contentType: "Post",
      identityHandle: "alice",
      visibilityLevel: "Private",
    });

    assert.equal(tx, "v2_private_future_ok");
    assert.equal(calls.createContentV2.length, 1, "expected default private route to call future v2 private path");
    assert.equal(calls.createContent.length, 0, "expected default private route not to fallback to v1");
  });

  it("uses v2 path when feature flag is enabled", async () => {
    const { fake, calls } = buildFakeModule({ v1Signature: "v1_should_not_run", v2Signature: "v2_ok" });

    const tx = await (ContentModule.prototype as any).createContent.call(fake, {
      contentId: new BN(101),
      text: "hello v2",
      contentType: "Post",
      identityHandle: "alice",
      useV2: true,
      enableV1FallbackOnV2Failure: false,
    });

    assert.equal(tx, "v2_ok");
    assert.equal(calls.createContentV2.length, 1, "expected v2 createContent to be called once");
    assert.equal(calls.createContent.length, 0, "expected v1 createContent not to be called");

    const accounts = calls.createContentV2Accounts[0] as Record<string, PublicKey>;
    assert.ok(accounts.v2ContentAnchor, "expected v2ContentAnchor account to be provided");
  });

  it("supports non-public and draft createContent on v2 route via explicit access/status args", async () => {
    const { fake, calls } = buildFakeModule({});
    const tx = await (ContentModule.prototype as any).createContent.call(fake, {
      contentId: new BN(151),
      text: "private v2",
      contentType: "Post",
      visibilityLevel: "Private",
      contentStatus: "Draft",
      identityHandle: "alice",
      useV2: true,
      enableV1FallbackOnV2Failure: false,
    });

    assert.equal(tx, "v2_signature");
    assert.equal(calls.createContent.length, 0, "expected no v1 fallback");
    assert.equal(calls.createContentV2WithAccess.length, 1, "expected explicit v2-with-access method call");
    const methodArgs = calls.createContentV2WithAccess[0] as any[];
    assert.deepEqual(methodArgs[3], { private: {} });
    assert.deepEqual(methodArgs[4], { draft: {} });
  });

  it("throws explicit upgrade error when non-public/draft v2 write lacks createContentV2WithAccess binding", async () => {
    const { fake, calls } = buildFakeModule({});
    delete fake.program.methods.createContentV2WithAccess;

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createContent.call(fake, {
          contentId: new BN(152),
          text: "private v2 without upgraded idl",
          contentType: "Post",
          visibilityLevel: "Private",
          contentStatus: "Draft",
          identityHandle: "alice",
          useV2: true,
          enableV1FallbackOnV2Failure: false,
        }),
      /createContentV2WithAccess is unavailable/i
    );

    assert.equal(calls.createContentV2.length, 0, "expected no legacy v2 call with unsupported non-public/draft args");
    assert.equal(calls.createContent.length, 0, "expected no v1 fallback call");
  });

  it("rejects v1 fallback flag for createContent when v2 fails", async () => {
    const { fake, calls } = buildFakeModule({
      v1Signature: "v1_fallback_ok",
      v2Error: new Error("v2 unavailable"),
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createContent.call(fake, {
          contentId: new BN(202),
          text: "fallback test",
          contentType: "Post",
          identityHandle: "alice",
          useV2: true,
          enableV1FallbackOnV2Failure: true,
        }),
      /v1 fallback is disabled/i
    );

    assert.equal(calls.createContentV2.length, 0, "expected fallback flag to fail fast");
    assert.equal(calls.createContent.length, 0, "expected no v1 fallback call");
  });

  it("throws explicit error when v2 fails and fallback is disabled", async () => {
    const { fake, calls } = buildFakeModule({
      v1Signature: "v1_should_not_run",
      v2Error: new Error("v2 rpc failure"),
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createContent.call(fake, {
          contentId: new BN(303),
          text: "no fallback",
          contentType: "Post",
          identityHandle: "alice",
          useV2: true,
          enableV1FallbackOnV2Failure: false,
        }),
      /createContent v2 failed/i
    );

    assert.equal(calls.createContentV2.length, 1, "expected v2 path to be attempted");
    assert.equal(calls.createContent.length, 0, "expected no fallback call when disabled");
  });

  it("keeps contentId semantics as string PDA", () => {
    const pda = new PdaUtils({
      identity: IDENTITY_PROGRAM,
      content: CONTENT_PROGRAM,
      access: ACCESS_PROGRAM,
      event: EVENT_PROGRAM,
      factory: FACTORY_PROGRAM,
      circles: CIRCLES_PROGRAM,
    }) as any;

    const contentId = pda.findContentId(AUTHOR, new BN(404));
    assert.equal(typeof contentId, "string");
    assert.equal(contentId.length > 0, true);
  });

  it("generates non-zero high-entropy v2 content ids without chain-sequence dependency", () => {
    const { fake } = buildFakeModule({});
    const first = (ContentModule.prototype as any).createV2ContentId.call(fake);
    const second = (ContentModule.prototype as any).createV2ContentId.call(fake);

    assert.equal(BN.isBN(first), true);
    assert.equal(BN.isBN(second), true);
    assert.equal(first.gt(new BN(0)), true);
    assert.equal(second.gt(new BN(0)), true);
    assert.notEqual(first.toString(), second.toString());
  });

  it("uses v2 path for createReply when feature flag is enabled", async () => {
    const { fake, calls } = buildFakeModule({
      replyV1Signature: "reply_v1_should_not_run",
      replyV2Signature: "reply_v2_ok",
    });

    const tx = await (ContentModule.prototype as any).createReply.call(
      fake,
      new BN(505),
      PARENT_CONTENT,
      "reply text",
      "Text",
      undefined,
      {
        useV2: true,
        enableV1FallbackOnV2Failure: false,
        identityHandle: "alice",
      }
    );

    assert.equal(tx, "reply_v2_ok");
    assert.equal(calls.createReplyV2.length, 1, "expected v2 createReply to be called once");
    assert.equal(calls.createReply.length, 0, "expected v1 createReply not to be called");
  });

  it("defaults createReply route to v2 when useV2 is omitted", async () => {
    const { fake, calls } = buildFakeModule({
      replyV1Signature: "reply_v1_should_not_run",
      replyV2Signature: "reply_v2_default_ok",
    });

    const tx = await (ContentModule.prototype as any).createReply.call(
      fake,
      new BN(550),
      PARENT_CONTENT,
      "default reply route",
      "Text",
      undefined,
      {
        identityHandle: "alice",
      }
    );

    assert.equal(tx, "reply_v2_default_ok");
    assert.equal(calls.createReplyV2.length, 1, "expected default route to call v2 reply");
    assert.equal(calls.createReply.length, 0, "expected default route to skip v1 reply");
  });

  it("rejects v1 fallback flag for createReply when v2 fails", async () => {
    const { fake, calls } = buildFakeModule({
      replyV1Signature: "reply_v1_fallback_ok",
      replyV2Error: new Error("reply v2 unavailable"),
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createReply.call(
          fake,
          new BN(606),
          PARENT_CONTENT,
          "reply fallback",
          "Text",
          undefined,
          {
            useV2: true,
            enableV1FallbackOnV2Failure: true,
            identityHandle: "alice",
          }
        ),
      /v1 fallback is disabled/i
    );

    assert.equal(calls.createReplyV2.length, 0, "expected fallback flag to fail fast for reply");
    assert.equal(calls.createReply.length, 0, "expected no v1 fallback call for reply");
  });

  it("throws explicit error when createReply v2 fails and fallback is disabled", async () => {
    const { fake, calls } = buildFakeModule({
      replyV1Signature: "reply_v1_should_not_run",
      replyV2Error: new Error("reply v2 rpc failure"),
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createReply.call(
          fake,
          new BN(707),
          PARENT_CONTENT,
          "reply no fallback",
          "Text",
          undefined,
          {
            useV2: true,
            enableV1FallbackOnV2Failure: false,
            identityHandle: "alice",
          }
        ),
      /createReply v2 failed/i
    );

    assert.equal(calls.createReplyV2.length, 1, "expected v2 reply path to be attempted");
    assert.equal(calls.createReply.length, 0, "expected no reply fallback call when disabled");
  });

  it("uses v2 path for createRepost when feature flag is enabled", async () => {
    const { fake, calls } = buildFakeModule({
      repostV1Signature: "repost_v1_should_not_run",
      repostV2Signature: "repost_v2_ok",
    });

    const tx = await (ContentModule.prototype as any).createRepost.call(
      fake,
      new BN(808),
      ORIGINAL_CONTENT,
      "repost comment",
      {
        useV2: true,
        enableV1FallbackOnV2Failure: false,
        identityHandle: "alice",
      }
    );

    assert.equal(tx, "repost_v2_ok");
    assert.equal(calls.createRepostV2.length, 1, "expected v2 createRepost to be called once");
    assert.equal(calls.createRepost.length, 0, "expected v1 createRepost not to be called");
  });

  it("defaults createRepost route to v2 when useV2 is omitted", async () => {
    const { fake, calls } = buildFakeModule({
      repostV1Signature: "repost_v1_should_not_run",
      repostV2Signature: "repost_v2_default_ok",
    });

    const tx = await (ContentModule.prototype as any).createRepost.call(
      fake,
      new BN(850),
      ORIGINAL_CONTENT,
      "default repost route",
      {
        identityHandle: "alice",
      }
    );

    assert.equal(tx, "repost_v2_default_ok");
    assert.equal(calls.createRepostV2.length, 1, "expected default route to call v2 repost");
    assert.equal(calls.createRepost.length, 0, "expected default route to skip v1 repost");
  });

  it("rejects v1 fallback flag for createRepost when v2 fails", async () => {
    const { fake, calls } = buildFakeModule({
      repostV1Signature: "repost_v1_fallback_ok",
      repostV2Error: new Error("repost v2 unavailable"),
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createRepost.call(
          fake,
          new BN(909),
          ORIGINAL_CONTENT,
          undefined,
          {
            useV2: true,
            enableV1FallbackOnV2Failure: true,
            identityHandle: "alice",
          }
        ),
      /v1 fallback is disabled/i
    );

    assert.equal(calls.createRepostV2.length, 0, "expected fallback flag to fail fast for repost");
    assert.equal(calls.createRepost.length, 0, "expected no v1 fallback call for repost");
  });

  it("throws explicit error when createRepost v2 fails and fallback is disabled", async () => {
    const { fake, calls } = buildFakeModule({
      repostV1Signature: "repost_v1_should_not_run",
      repostV2Error: new Error("repost v2 rpc failure"),
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createRepost.call(
          fake,
          new BN(1001),
          ORIGINAL_CONTENT,
          undefined,
          {
            useV2: true,
            enableV1FallbackOnV2Failure: false,
            identityHandle: "alice",
          }
        ),
      /createRepost v2 failed/i
    );

    assert.equal(calls.createRepostV2.length, 1, "expected v2 repost path to be attempted");
    assert.equal(calls.createRepost.length, 0, "expected no repost fallback call when disabled");
  });

  it("uses v2 path for createQuote and skips v1 quote route", async () => {
    const { fake, calls } = buildFakeModule({
      quoteV1Signature: "quote_v1_should_not_run",
      quoteV2Signature: "quote_v2_ok",
    });

    const tx = await (ContentModule.prototype as any).createQuote.call(
      fake,
      new BN(1002),
      ORIGINAL_CONTENT,
      "quote body",
      undefined,
      {
        identityHandle: "alice",
      }
    );

    assert.equal(tx, "quote_v2_ok");
    assert.equal(calls.createQuoteV2.length, 1, "expected v2 createQuote to be called once");
    assert.equal(calls.createQuote.length, 0, "expected v1 createQuote not to be called");
  });

  it("rejects explicit useV2=false for createQuote", async () => {
    const { fake, calls } = buildFakeModule({
      quoteV1Signature: "quote_v1_should_not_run",
      quoteV2Signature: "quote_v2_should_not_run",
    });

    await assert.rejects(
      () =>
        (ContentModule.prototype as any).createQuote.call(
          fake,
          new BN(1003),
          ORIGINAL_CONTENT,
          "quote body",
          undefined,
          {
            useV2: false,
            identityHandle: "alice",
          }
        ),
      /v1 write path is disabled/i
    );

    assert.equal(calls.createQuoteV2.length, 0, "expected no v2 call when route is invalid");
    assert.equal(calls.createQuote.length, 0, "expected no v1 quote call when disabled");
  });

  it("routes numeric target quote through createQuoteV2ById", async () => {
    const { fake, calls, pda } = buildFakeModule({});
    const quotedContentId = new BN(1004);
    const tx = await (ContentModule.prototype as any).createQuoteById.call(
      fake,
      new BN(1005),
      quotedContentId,
      "quote by id",
      undefined,
      {
        useV2: true,
        identityHandle: "alice",
        quotedAuthorPubkey: QUOTED_AUTHOR.toBase58(),
      }
    );

    assert.equal(tx, "quote_v2_by_id_ok");
    assert.equal(calls.createQuoteV2ById.length, 1);
    assert.equal(calls.createQuote.length, 0);
    assert.equal(calls.createQuoteV2.length, 0);

    const accounts = calls.createQuoteV2ByIdAccounts[0] as Record<string, PublicKey>;
    assert.equal(
      accounts.quotedV2ContentAnchor.toBase58(),
      pda.findContentV2AnchorPda(QUOTED_AUTHOR, quotedContentId).toBase58()
    );
  });

  it("routes numeric target reply through createReplyV2ById", async () => {
    const { fake, calls, pda } = buildFakeModule({});
    const parentContentId = new BN(999);
    const tx = await (ContentModule.prototype as any).createReplyById.call(
      fake,
      new BN(1111),
      parentContentId,
      "reply by id",
      "Text",
      undefined,
      {
        useV2: true,
        enableV1FallbackOnV2Failure: false,
        identityHandle: "alice",
        parentAuthorPubkey: PARENT_AUTHOR.toBase58(),
      }
    );

    assert.equal(tx, "reply_v2_by_id_ok");
    assert.equal(calls.createReplyV2ById.length, 1);
    assert.equal(calls.createReply.length, 0);
    assert.equal(calls.createReplyV2.length, 0);

    const accounts = calls.createReplyV2ByIdAccounts[0] as Record<string, PublicKey>;
    assert.equal(
      accounts.parentV2ContentAnchor.toBase58(),
      pda.findContentV2AnchorPda(PARENT_AUTHOR, parentContentId).toBase58()
    );
  });

  it("routes numeric target repost through createRepostV2ById", async () => {
    const { fake, calls, pda } = buildFakeModule({});
    const originalContentId = new BN(1000);
    const tx = await (ContentModule.prototype as any).createRepostById.call(
      fake,
      new BN(2222),
      originalContentId,
      undefined,
      {
        useV2: true,
        enableV1FallbackOnV2Failure: false,
        identityHandle: "alice",
        originalAuthorPubkey: ORIGINAL_AUTHOR.toBase58(),
      }
    );

    assert.equal(tx, "repost_v2_by_id_ok");
    assert.equal(calls.createRepostV2ById.length, 1);
    assert.equal(calls.createRepost.length, 0);
    assert.equal(calls.createRepostV2.length, 0);

    const accounts = calls.createRepostV2ByIdAccounts[0] as Record<string, PublicKey>;
    assert.equal(
      accounts.originalV2ContentAnchor.toBase58(),
      pda.findContentV2AnchorPda(ORIGINAL_AUTHOR, originalContentId).toBase58()
    );
  });

  it("auto-resolves parent author for createReplyById when legacy caller omits it", async () => {
    const { fake, calls, pda } = buildFakeModule({});
    const parentContentId = new BN(4444);
    const originalFetch = globalThis.fetch;
    fake.lookupTargetPostMetadataByContentId = (ContentModule.prototype as any).lookupTargetPostMetadataByContentId;

    globalThis.fetch = (async (input: any) => {
      assert.equal(input, "http://127.0.0.1:4000/api/v1/posts/4444");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          author: {
            pubkey: PARENT_AUTHOR.toBase58(),
          },
          visibility: "Public",
          status: "Published",
        }),
      } as any;
    }) as any;

    try {
      const tx = await (ContentModule.prototype as any).createReplyById.call(
        fake,
        new BN(5555),
        parentContentId,
        "reply by id",
        "Text",
        undefined,
        {
          useV2: true,
          identityHandle: "alice",
        }
      );

      assert.equal(tx, "reply_v2_by_id_ok");
      const accounts = calls.createReplyV2ByIdAccounts[0] as Record<string, PublicKey>;
      assert.equal(accounts.parentAuthor.toBase58(), PARENT_AUTHOR.toBase58());
      assert.equal(
        accounts.parentV2ContentAnchor.toBase58(),
        pda.findContentV2AnchorPda(PARENT_AUTHOR, parentContentId).toBase58()
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("auto-resolves quoted author for createQuoteById when legacy caller omits it", async () => {
    const { fake, calls, pda } = buildFakeModule({});
    const quotedContentId = new BN(6666);
    const originalFetch = globalThis.fetch;
    fake.lookupTargetPostMetadataByContentId = (ContentModule.prototype as any).lookupTargetPostMetadataByContentId;

    globalThis.fetch = (async (input: any) => {
      assert.equal(input, "http://127.0.0.1:4000/api/v1/posts/6666");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          author: {
            pubkey: QUOTED_AUTHOR.toBase58(),
          },
          visibility: "Public",
          status: "Published",
        }),
      } as any;
    }) as any;

    try {
      const tx = await (ContentModule.prototype as any).createQuoteById.call(
        fake,
        new BN(7777),
        quotedContentId,
        "quote by id",
        undefined,
        {
          useV2: true,
          identityHandle: "alice",
        }
      );

      assert.equal(tx, "quote_v2_by_id_ok");
      const accounts = calls.createQuoteV2ByIdAccounts[0] as Record<string, PublicKey>;
      assert.equal(accounts.quotedAuthor.toBase58(), QUOTED_AUTHOR.toBase58());
      assert.equal(
        accounts.quotedV2ContentAnchor.toBase58(),
        pda.findContentV2AnchorPda(QUOTED_AUTHOR, quotedContentId).toBase58()
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("auto-resolves original author for createRepostById when legacy caller omits it", async () => {
    const { fake, calls, pda } = buildFakeModule({});
    const originalContentId = new BN(8888);
    const originalFetch = globalThis.fetch;
    fake.lookupTargetPostMetadataByContentId = (ContentModule.prototype as any).lookupTargetPostMetadataByContentId;

    globalThis.fetch = (async (input: any) => {
      assert.equal(input, "http://127.0.0.1:4000/api/v1/posts/8888");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          author: {
            pubkey: ORIGINAL_AUTHOR.toBase58(),
          },
          visibility: "Public",
          status: "Published",
        }),
      } as any;
    }) as any;

    try {
      const tx = await (ContentModule.prototype as any).createRepostById.call(
        fake,
        new BN(9999),
        originalContentId,
        undefined,
        {
          useV2: true,
          identityHandle: "alice",
        }
      );

      assert.equal(tx, "repost_v2_by_id_ok");
      const accounts = calls.createRepostV2ByIdAccounts[0] as Record<string, PublicKey>;
      assert.equal(accounts.originalAuthor.toBase58(), ORIGINAL_AUTHOR.toBase58());
      assert.equal(
        accounts.originalV2ContentAnchor.toBase58(),
        pda.findContentV2AnchorPda(ORIGINAL_AUTHOR, originalContentId).toBase58()
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails clearly when by-id author lookup cannot resolve a pubkey", async () => {
    const { fake } = buildFakeModule({});
    const originalFetch = globalThis.fetch;
    fake.lookupTargetPostMetadataByContentId = (ContentModule.prototype as any).lookupTargetPostMetadataByContentId;

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        author: {
          handle: "alice",
        },
      }),
    })) as any;

    try {
      await assert.rejects(
        () =>
          (ContentModule.prototype as any).createReplyById.call(
            fake,
            new BN(1112),
            new BN(1111),
            "reply by id",
            "Text",
            undefined,
            {
              useV2: true,
              identityHandle: "alice",
            }
          ),
        /createReplyById v2 route; auto-lookup did not return author\.pubkey/i
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
