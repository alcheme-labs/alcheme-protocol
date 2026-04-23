import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "@jest/globals";
import {
  IdentityModule,
  isEventBatchSeedConflictError,
  withEventBatchSeedRetry,
} from "../src/modules/identity";

describe("identity event batch retry", () => {
  const identityModulePath = path.join(__dirname, "..", "src/modules/identity.ts");
  const builtIdentityModulePath = path.join(__dirname, "..", "dist/modules/identity.js");

  function read(filePath: string): string {
    assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
    return fs.readFileSync(filePath, "utf8");
  }

  it("detects retryable event_batch seed conflicts", () => {
    const retryable = new Error(
      "AnchorError caused by account: event_batch. Error Code: ConstraintSeeds. Error Number: 2006.",
    );
    const nonRetryable = new Error(
      "AnchorError caused by account: user_identity. Error Code: ConstraintSeeds.",
    );

    assert.equal(isEventBatchSeedConflictError(retryable), true);
    assert.equal(isEventBatchSeedConflictError(nonRetryable), false);
  });

  it("retries retryable event_batch seed conflicts until success", async () => {
    let attempts = 0;
    const result = await withEventBatchSeedRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            "AnchorError caused by account: event_batch. Error Code: ConstraintSeeds.",
          );
        }
        return "ok";
      },
      { attempts: 4, delayMs: 0 },
    );

    assert.equal(result, "ok");
    assert.equal(attempts, 3);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        withEventBatchSeedRetry(
          async () => {
            attempts += 1;
            throw new Error("non retryable failure");
          },
          { attempts: 4, delayMs: 0 },
        ),
      /non retryable failure/,
    );

    assert.equal(attempts, 1);
  });

  it("routes identity event writes through the retry wrapper", () => {
    const source = read(identityModulePath);

    assert.match(source, /async registerIdentity[\s\S]*withResolvedEventAccountsRetry/);
    assert.match(source, /async updateIdentity[\s\S]*withResolvedEventAccountsRetry/);
    assert.match(source, /async addVerificationAttribute[\s\S]*withResolvedEventAccountsRetry/);
  });

  it("keeps updateIdentity payload normalization in the built sdk artifact", () => {
    const source = read(identityModulePath);
    const builtSource = read(builtIdentityModulePath);

    assert.match(source, /const normalizedUpdates = toIdentityUpdatePayload\(updates\);/);
    assert.match(source, /\.updateIdentity\(normalizedUpdates\)/);
    assert.match(source, /function toIdentityUpdatePayload\(updates: any\)/);
    assert.match(source, /displayName:\s*valueOrNull\("displayName", "display_name"\)/);
    assert.match(source, /avatarUri:\s*valueOrNull\("avatarUri", "avatar_uri"\)/);
    assert.match(source, /customAttributes:\s*valueOrNull\("customAttributes", "custom_attributes"\)/);
    assert.match(source, /return null;/);

    assert.match(builtSource, /const normalizedUpdates = toIdentityUpdatePayload\(updates\);/);
    assert.match(builtSource, /\.updateIdentity\(normalizedUpdates\)/);
    assert.match(builtSource, /function toIdentityUpdatePayload\(updates\)/);
    assert.match(builtSource, /displayName:\s*valueOrNull\("displayName", "display_name"\)/);
    assert.match(builtSource, /avatarUri:\s*valueOrNull\("avatarUri", "avatar_uri"\)/);
    assert.match(builtSource, /customAttributes:\s*valueOrNull\("customAttributes", "custom_attributes"\)/);
    assert.match(builtSource, /return null;/);
  });

  it("normalizes snake_case profile updates into Anchor JS method args", async () => {
    const { IdentityModule: BuiltIdentityModule } = require("../dist/modules/identity.js");

    async function assertNormalized(ModuleClass: typeof IdentityModule) {
      let capturedUpdates: Record<string, unknown> | null = null;

      const fakeModule = {
        pda: {
          findIdentityRegistryPda: () => "registry-pda",
          findUserIdentityPda: () => "identity-pda",
        },
        provider: {
          publicKey: "provider-public-key",
        },
        withResolvedEventAccountsRetry: async (
          operation: (accounts: {
            eventProgram: string;
            eventEmitter: string;
            eventBatch: string;
          }) => Promise<string>,
        ) => operation({
          eventProgram: "event-program",
          eventEmitter: "event-emitter",
          eventBatch: "event-batch",
        }),
        program: {
          methods: {
            updateIdentity: (updates: Record<string, unknown>) => {
              capturedUpdates = updates;
              return {
                accounts: () => ({
                  rpc: async () => "signature",
                }),
              };
            },
          },
        },
      };

      const signature = await ModuleClass.prototype.updateIdentity.call(
        fakeModule,
        "alchemist",
        {
          display_name: "Alchemist",
          bio: "Refines protocol state.",
        },
      );

      assert.equal(signature, "signature");
      assert.deepEqual(capturedUpdates, {
        displayName: "Alchemist",
        bio: "Refines protocol state.",
        avatarUri: null,
        bannerUri: null,
        website: null,
        location: null,
        metadataUri: null,
        customAttributes: null,
      });
    }

    await assertNormalized(IdentityModule);
    await assertNormalized(BuiltIdentityModule);
  });
});
