// @ts-nocheck
import { BN } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import crypto from "crypto";

const {
  DEFAULT_PERCENTILE,
  DEFAULT_SAMPLE_COUNT,
  CostSample,
  V2CostResult,
  assertMeasurementBalance,
  buildMeasurementHandle,
  buildSampleContentId,
  confirmSignature,
  createMeasurementContext,
  ensureAuthorIdentity,
  failedSnapshot,
  resolveMeasurementAccounts,
  summarizeSamples,
} = require("./v2-cost-helpers.ts");

export const CREATE_REPOST_V2_THRESHOLD_LAMPORTS = 1_000_000;

async function takeSample(params: {
  connection: any;
  sdk: any;
  author: any;
  identityHandle: string;
  index: number;
}): Promise<CostSample> {
  const { connection, sdk, author, identityHandle, index } = params;
  let stage = "create_target";
  let lastError = "unknown error";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const originalContentId = buildSampleContentId(index, attempt, 30_000);
      const repostContentId = buildSampleContentId(index, attempt, 40_000);

      const originalSignature = await sdk.content.createContent({
        contentId: new BN(originalContentId),
        text: `repost-cost target ${index}`,
        contentType: "Text",
        identityHandle,
        identityRegistryName: "social_hub_identity",
        useV2: true,
        visibilityLevel: "Public",
        contentStatus: "Published",
      });
      await confirmSignature(connection, originalSignature);

      stage = "resolve_accounts";
      const accounts = await resolveMeasurementAccounts({
        connection,
        sdk,
        identityHandle,
      });

      const beforeAuthor = await connection.getBalance(author.publicKey, "confirmed");
      const beforeBatch = await connection.getBalance(accounts.eventBatch, "confirmed");

      stage = "send_repost";
      const contentHash = Array.from(
        crypto.createHash("sha256")
          .update(`repost:${repostContentId}:${originalContentId}:${index}:${attempt}`)
          .digest(),
      );
      const uriRef = `ipfs://measure-repost-${Date.now()}-${index}-${attempt}`;

      const signature = await sdk.content.program.methods
        .createRepostV2ById(new BN(repostContentId), new BN(originalContentId), contentHash, uriRef)
        .accounts({
          contentManager: accounts.contentManager,
          v2ContentAnchor: sdk.pda.findContentV2AnchorPda(author.publicKey, new BN(repostContentId)),
          originalAuthor: author.publicKey,
          originalV2ContentAnchor: sdk.pda.findContentV2AnchorPda(author.publicKey, new BN(originalContentId)),
          targetFollowRelationship: SystemProgram.programId,
          targetCircleMembership: SystemProgram.programId,
          author: author.publicKey,
          identityProgram: accounts.identityProgram,
          userIdentity: accounts.userIdentity,
          accessProgram: accounts.accessProgram,
          accessControllerAccount: accounts.accessControllerAccount,
          eventProgram: accounts.eventProgram,
          eventEmitterAccount: accounts.eventEmitterAccount,
          eventBatch: accounts.eventBatch,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      stage = "confirm_repost";
      await confirmSignature(connection, signature);

      const txMeta = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const txFee = txMeta?.meta?.fee ?? 0;
      const afterAuthor = await connection.getBalance(author.publicKey, "confirmed");
      const afterBatch = await connection.getBalance(accounts.eventBatch, "confirmed");
      const eventDelta = Math.max(0, afterBatch - beforeBatch);
      const rentDelta = Math.max(0, beforeAuthor - afterAuthor - txFee);
      const total = txFee + rentDelta;

      return {
        index,
        signature,
        tx_fee: txFee,
        rent_delta: rentDelta,
        event_delta: eventDelta,
        total,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = `${stage}: ${message}`;
      if (attempt === 2) {
        return {
          ...failedSnapshot(),
          index,
          signature: null,
          error: lastError,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }

  return {
    ...failedSnapshot(),
    index,
    signature: null,
    error: lastError,
  };
}

export async function measureCreateRepostV2Cost(options?: {
  percentile?: number;
  sampleCount?: number;
}): Promise<V2CostResult> {
  const percentile = options?.percentile ?? DEFAULT_PERCENTILE;
  const sampleCount = options?.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const baseResult = {
    percentile,
    sample_count: sampleCount,
    threshold_lamports: CREATE_REPOST_V2_THRESHOLD_LAMPORTS,
    method: "create_repost_v2",
    measurement_mode: "onchain_sampling" as const,
    timestamp: new Date().toISOString(),
  };

  let stage = "bootstrap";
  try {
    const { connection, author, sdk } = await createMeasurementContext();
    await assertMeasurementBalance(connection, author.publicKey);

    stage = "register_identity";
    const identityHandle = buildMeasurementHandle();
    await ensureAuthorIdentity(sdk, identityHandle, connection);

    stage = "run_samples";
    const samples: CostSample[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await takeSample({ connection, sdk, author, identityHandle, index }));
    }

    return summarizeSamples({
      method: baseResult.method,
      percentile,
      sampleCount,
      thresholdLamports: CREATE_REPOST_V2_THRESHOLD_LAMPORTS,
      samples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stagedMessage = `${stage}: ${message}`;
    return {
      ...failedSnapshot(),
      ...baseResult,
      successful_samples: 0,
      failed_samples: sampleCount,
      observed_samples: sampleCount,
      errors: [stagedMessage],
      sample_errors: Array(sampleCount).fill(stagedMessage),
      sample_signatures: [],
    };
  }
}

async function main() {
  const result = await measureCreateRepostV2Cost();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[create-repost-v2-cost] unexpected failure:", error);
    process.exit(1);
  });
}
