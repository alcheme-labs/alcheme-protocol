import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { maybeTriggerGhostDraftFromDiscussion } from "../../ai/discussion-draft-trigger";
import { generateGhostDraft } from "../../ai/ghost-draft";
import { generateAcceptedIssueRevision } from "../draftAiAssist/acceptedIssueRevision";
import {
  createCrystalMintAdapter,
  type CrystalMintAdapter,
} from "../crystalAssets/mintAdapter";
import { issueCrystalAssetJob } from "../crystalAssets/jobs";
import { runDiscussionMessageAnalyzeJob } from "../discussion/analysis/enqueue";
import { runDiscussionCircleReanalyzeJob } from "../discussion/analysis/invalidation";
import { acceptGhostDraftIntoWorkingCopy } from "../ghostDraft/acceptance";
import {
  createProposalForAcceptedIssueRevisionGeneration,
  createProposalForGhostDraftGeneration,
} from "../aiOperatingLayer/proposals";
import {
  markTrendPromptFailed,
  processTrendPromptJob,
} from "../aiOperatingLayer/trends/generator";
import { processConfigurationCopilotJob } from "../aiOperatingLayer/configuration/generator";
import { processSettingsTextAssistJob } from "../aiOperatingLayer/settingsTextAssist/generator";
import { processStyleLifeFeelJob } from "../aiOperatingLayer/style/generator";
import { processAnchoredSuggestionJob } from "../aiOperatingLayer/anchoredSuggestions/judge";
import { processKnowledgeRelationshipLabelClassificationJob } from "../knowledgeRelationshipLabelAi/classifier";
import { processKnowledgeRelationshipCoverageAuditJob } from "../knowledgeRelationshipLabelAi/coverageAudit";
import { processCircleCognitiveMapExplanationJob } from "../aiOperatingLayer/cognitiveMap/explainer";
import { processGuardianFindingJob } from "../aiOperatingLayer/guardian/jobs";
import { processSourceGroundedAskJob } from "../aiOperatingLayer/sourceGroundedAsk/generator";
import { processCircleGrowthAdvisorJob } from "../aiOperatingLayer/growth/generator";
import { processNeutralEvaluationJob } from "../aiOperatingLayer/evaluation/generator";
import { generateVoiceRecap } from "../voice/recap";
import type { AiJobHandlerMap } from "./types";
import type { AuthActor } from "../auth/actor";

function normalizeJobActorSnapshot(
  value: unknown,
  fallbackUserId: number,
): AuthActor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const userId = Number(record.userId ?? fallbackUserId);
  const pubkey = String(record.pubkey || "").trim();
  if (!Number.isFinite(userId) || userId <= 0 || !pubkey) return null;
  const identity = record.identity && typeof record.identity === "object" && !Array.isArray(record.identity)
    ? record.identity as Record<string, unknown>
    : {};
  const authSource = record.authSource === "legacy_bearer" ? "legacy_bearer" : "session_cookie";
  return {
    userId,
    pubkey,
    handle: typeof record.handle === "string" ? record.handle : "",
    displayName: typeof record.displayName === "string" ? record.displayName : null,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
    authSource,
    identity: {
      handle: typeof identity.handle === "string" ? identity.handle : "",
      identityPubkey: typeof identity.identityPubkey === "string" ? identity.identityPubkey : pubkey,
      accountAddress: typeof identity.accountAddress === "string" ? identity.accountAddress : "",
      presence: "verified",
    },
  };
}

type AiOperatingLayerEnvelopeMode = "off" | "dry_run" | "write";

function resolveAiOperatingLayerEnvelopeMode(): AiOperatingLayerEnvelopeMode {
  const normalized = String(process.env.AI_OPERATING_LAYER_ENVELOPE_MODE || "write")
    .trim()
    .toLowerCase();
  if (normalized === "off" || normalized === "dry_run" || normalized === "write") {
    return normalized;
  }
  return "write";
}

function canWriteProposalEnvelope(prisma: any): boolean {
  return typeof prisma?.aiProposalArtifact?.upsert === "function";
}

async function createGhostDraftProposalEnvelope(input: {
  prisma: any;
  jobId: number | string;
  generation: any;
  requestedByUserId: number;
  autoApplyRequested?: boolean;
}): Promise<string | null> {
  if (resolveAiOperatingLayerEnvelopeMode() !== "write") return null;
  if (input.autoApplyRequested) return null;
  if (!canWriteProposalEnvelope(input.prisma)) return null;

  try {
    const proposal = await createProposalForGhostDraftGeneration(input.prisma, {
      generation: {
        id: input.generation.generationId,
        draftPostId: input.generation.postId,
        requestedByUserId: input.requestedByUserId,
        promptAsset: input.generation.provenance?.promptAsset,
        promptVersion: input.generation.provenance?.promptVersion,
        sourceDigest: input.generation.provenance?.sourceDigest,
        providerMode: input.generation.provenance?.providerMode,
        model: input.generation.model,
        draftText: input.generation.draftText,
        suggestions: input.generation.suggestions,
      },
      aiJobId: Number(input.jobId),
    });
    return typeof proposal?.id === "string" ? proposal.id : null;
  } catch {
    return null;
  }
}

async function createAcceptedIssueRevisionProposalEnvelope(input: {
  prisma: any;
  jobId: number | string;
  generation: any;
  draftPostId: number;
  requestedByUserId: number;
}): Promise<string | null> {
  if (resolveAiOperatingLayerEnvelopeMode() !== "write") return null;
  if (!canWriteProposalEnvelope(input.prisma)) return null;

  try {
    const persistedGeneration = typeof input.prisma?.ghostDraftGeneration?.findUnique === "function"
      ? await input.prisma.ghostDraftGeneration.findUnique({
          where: {
            id: input.generation.generationId,
          },
          select: {
            id: true,
            draftPostId: true,
            requestedByUserId: true,
            promptAsset: true,
            promptVersion: true,
            sourceDigest: true,
            providerMode: true,
            model: true,
            draftText: true,
          },
        })
      : null;
    if (!persistedGeneration?.draftText || !persistedGeneration?.sourceDigest) {
      return null;
    }

    const proposal = await createProposalForAcceptedIssueRevisionGeneration(input.prisma, {
      generation: {
        id: persistedGeneration.id,
        draftPostId: persistedGeneration.draftPostId ?? input.draftPostId,
        requestedByUserId: persistedGeneration.requestedByUserId ?? input.requestedByUserId,
        promptAsset: persistedGeneration.promptAsset ?? input.generation.promptAsset,
        promptVersion: persistedGeneration.promptVersion ?? input.generation.promptVersion,
        sourceDigest: persistedGeneration.sourceDigest,
        providerMode: persistedGeneration.providerMode,
        model: persistedGeneration.model ?? input.generation.model,
        draftText: persistedGeneration.draftText,
      },
      aiJobId: Number(input.jobId),
    });
    return typeof proposal?.id === "string" ? proposal.id : null;
  } catch {
    return null;
  }
}

export function createAiJobHandlers(input: {
  prisma: PrismaClient;
  redis: Redis;
  crystalMintAdapter?: CrystalMintAdapter;
}): AiJobHandlerMap {
  const prismaAny = input.prisma as any;

  return {
    async ghost_draft_generate({ job }) {
      const postId = Number(job.payload?.postId ?? job.scopeDraftPostId ?? 0);
      const userId = Number(job.requestedByUserId ?? job.payload?.userId ?? 0);
      if (
        !Number.isFinite(postId) ||
        postId <= 0 ||
        !Number.isFinite(userId) ||
        userId <= 0
      ) {
        throw new Error("invalid_ghost_draft_job_payload");
      }

      const selectedSeededReference =
        typeof job.payload?.seededReference === "object" &&
        job.payload?.seededReference &&
        !Array.isArray(job.payload.seededReference)
          ? (job.payload.seededReference as Record<string, unknown>)
          : null;
      const result = await generateGhostDraft(input.prisma, postId, userId, {
        seededReference:
          selectedSeededReference &&
          typeof selectedSeededReference.path === "string" &&
          Number.isFinite(Number(selectedSeededReference.line))
            ? {
                path: selectedSeededReference.path,
                line: Number(selectedSeededReference.line),
              }
            : null,
        sourceMaterialIds: Array.isArray(job.payload?.sourceMaterialIds)
          ? job.payload.sourceMaterialIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
          : null,
      });
      let acceptanceResult: Awaited<
        ReturnType<typeof acceptGhostDraftIntoWorkingCopy>
      > | null = null;
      let skippedAcceptanceMode: string | null = null;
      if (typeof prismaAny.ghostDraftGeneration?.updateMany === "function") {
        await prismaAny.ghostDraftGeneration.updateMany({
          where: {
            id: result.generationId,
            aiJobId: null,
          },
          data: {
            aiJobId: job.id,
          },
        });
      }
      const proposalArtifactId = await createGhostDraftProposalEnvelope({
        prisma: prismaAny,
        jobId: job.id,
        generation: result,
        requestedByUserId: userId,
        autoApplyRequested: Boolean(job.payload?.autoApplyRequested),
      });

      if (job.payload?.autoApplyRequested) {
        const actorPubkey =
          typeof job.payload?.actorPubkey === "string"
            ? job.payload.actorPubkey.trim()
            : "";
        const autoApplyAuthorizedAt =
          typeof job.payload?.autoApplyAuthorizedAt === "string" ||
          job.payload?.autoApplyAuthorizedAt instanceof Date
            ? job.payload.autoApplyAuthorizedAt
            : null;
        const scopeDraftPostId = Number(job.scopeDraftPostId ?? 0);
        const hasAuthorizedJobSnapshot =
          actorPubkey.length > 0 &&
          Boolean(autoApplyAuthorizedAt) &&
          Number.isFinite(scopeDraftPostId) &&
          scopeDraftPostId === postId &&
          Number.isFinite(userId) &&
          userId > 0;

        if (!hasAuthorizedJobSnapshot) {
          skippedAcceptanceMode = "actor_context_missing";
        } else {
          acceptanceResult = await acceptGhostDraftIntoWorkingCopy(
            input.prisma as any,
            {
              draftPostId: postId,
              generationId: result.generationId,
              authorizedJob: {
                draftPostId: postId,
                userId,
                actorPubkey,
                autoApplyAuthorizedAt: autoApplyAuthorizedAt as string | Date,
              },
              mode: "auto_fill",
              workingCopyHash:
                typeof job.payload?.workingCopyHash === "string"
                  ? job.payload.workingCopyHash
                  : null,
              workingCopyUpdatedAt:
                typeof job.payload?.workingCopyUpdatedAt === "string"
                  ? job.payload.workingCopyUpdatedAt
                  : null,
            },
          );
        }
      }

      return {
        generationId: result.generationId,
        postId: result.postId,
        model: result.model,
        autoApplied: Boolean(acceptanceResult?.applied),
        acceptanceId: acceptanceResult?.acceptanceId ?? null,
        changed: acceptanceResult?.changed ?? false,
        acceptanceMode: acceptanceResult?.acceptanceMode ?? skippedAcceptanceMode,
        workingCopyHash: acceptanceResult?.workingCopyHash ?? null,
        updatedAt: acceptanceResult?.updatedAt?.toISOString?.() ?? null,
        heatScore: acceptanceResult?.heatScore ?? null,
        ...(proposalArtifactId ? { proposalArtifactId } : {}),
      };
    },

    async accepted_issue_revision_generate({ job }) {
      const postId = Number(job.payload?.postId ?? job.scopeDraftPostId ?? 0);
      const userId = Number(job.requestedByUserId ?? job.payload?.userId ?? 0);
      if (
        !Number.isFinite(postId) ||
        postId <= 0 ||
        !Number.isFinite(userId) ||
        userId <= 0
      ) {
        throw new Error("invalid_accepted_issue_revision_job_payload");
      }
      const actor = normalizeJobActorSnapshot(job.payload?.actor, userId);
      if (!actor) {
        throw new Error("invalid_accepted_issue_revision_actor_payload");
      }
      const selectedSeededReference =
        typeof job.payload?.seededReference === "object" &&
        job.payload?.seededReference &&
        !Array.isArray(job.payload.seededReference)
          ? (job.payload.seededReference as Record<string, unknown>)
          : null;
      const result = await generateAcceptedIssueRevision(input.prisma as any, {
        draftPostId: postId,
        requestedByUserId: userId,
        actor,
        targetRef:
          typeof job.payload?.targetRef === "string"
            ? job.payload.targetRef
            : null,
        threadIds: Array.isArray(job.payload?.threadIds)
          ? job.payload.threadIds.map((value) => String(value))
          : null,
        workingCopyHash:
          typeof job.payload?.workingCopyHash === "string"
            ? job.payload.workingCopyHash
            : null,
        workingCopyUpdatedAt:
          typeof job.payload?.workingCopyUpdatedAt === "string" ||
          job.payload?.workingCopyUpdatedAt instanceof Date
            ? job.payload.workingCopyUpdatedAt
            : null,
        seededReference:
          selectedSeededReference &&
          typeof selectedSeededReference.path === "string" &&
          Number.isFinite(Number(selectedSeededReference.line))
            ? {
                path: selectedSeededReference.path,
                line: Number(selectedSeededReference.line),
              }
            : null,
        sourceMaterialIds: Array.isArray(job.payload?.sourceMaterialIds)
          ? job.payload.sourceMaterialIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
          : null,
      });

      if (
        result.status === "generated" &&
        typeof prismaAny.ghostDraftGeneration?.updateMany === "function"
      ) {
        await prismaAny.ghostDraftGeneration.updateMany({
          where: {
            id: result.generationId,
            aiJobId: null,
          },
          data: {
            aiJobId: job.id,
          },
        });
      }
      const proposalArtifactId = result.status === "generated"
        ? await createAcceptedIssueRevisionProposalEnvelope({
            prisma: prismaAny,
            jobId: job.id,
            generation: result,
            draftPostId: postId,
            requestedByUserId: userId,
          })
        : null;

      return {
        postId,
        autoApplied: false,
        ...result,
        ...(proposalArtifactId ? { proposalArtifactId } : {}),
      };
    },

    async discussion_trigger_evaluate({ job }) {
      const circleId = Number(job.payload?.circleId ?? job.scopeCircleId ?? 0);
      if (!Number.isFinite(circleId) || circleId <= 0) {
        throw new Error("invalid_discussion_trigger_job_payload");
      }

      const result = await maybeTriggerGhostDraftFromDiscussion({
        prisma: input.prisma,
        redis: input.redis,
        circleId,
        aiJob: {
          id: job.id,
          attempt: job.attempts,
          requestedByUserId: job.requestedByUserId,
        },
      });
      return {
        circleId,
        ...result,
      };
    },

    async discussion_message_analyze({ job }) {
      const circleId = Number(job.payload?.circleId ?? job.scopeCircleId ?? 0);
      const envelopeId =
        typeof job.payload?.envelopeId === "string"
          ? job.payload.envelopeId
          : "";
      if (!Number.isFinite(circleId) || circleId <= 0 || !envelopeId.trim()) {
        throw new Error("invalid_discussion_message_analyze_job_payload");
      }

      return runDiscussionMessageAnalyzeJob({
        prisma: input.prisma,
        redis: input.redis,
        circleId,
        envelopeId: envelopeId.trim(),
        requestedByUserId: job.requestedByUserId ?? null,
      });
    },

    async discussion_circle_reanalyze({ job }) {
      const circleId = Number(job.payload?.circleId ?? job.scopeCircleId ?? 0);
      if (!Number.isFinite(circleId) || circleId <= 0) {
        throw new Error("invalid_discussion_circle_reanalyze_payload");
      }

      return runDiscussionCircleReanalyzeJob({
        prisma: input.prisma,
        redis: input.redis,
        circleId,
        requestedByUserId: job.requestedByUserId ?? null,
      });
    },

    async voice_recap_generate({ job }) {
      const voiceSessionId =
        typeof job.payload?.voiceSessionId === "string"
          ? job.payload.voiceSessionId.trim()
          : "";
      if (!voiceSessionId) {
        throw new Error("invalid_voice_recap_job_payload");
      }

      const transcriptSegments = Array.isArray(job.payload?.transcriptSegments)
        ? (job.payload.transcriptSegments as any[])
        : [];

      const result = await generateVoiceRecap(input.prisma as any, {
        voiceSessionId,
        transcriptSegments,
        requestedByUserId: Number.isFinite(
          Number(job.payload?.requestedByUserId),
        )
          ? Number(job.payload?.requestedByUserId)
          : job.requestedByUserId,
        createDraftSource: Boolean(job.payload?.createDraftSource),
      });
      return { ...result };
    },

    async crystal_asset_issue({ job }) {
      const knowledgeRowId = Number(job.payload?.knowledgeRowId ?? 0);
      const knowledgePublicId =
        typeof job.payload?.knowledgePublicId === "string"
          ? job.payload.knowledgePublicId.trim()
          : "";
      if (
        (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) &&
        !knowledgePublicId
      ) {
        throw new Error("invalid_crystal_asset_issue_payload");
      }
      const crystalMintAdapter =
        input.crystalMintAdapter !== undefined
          ? input.crystalMintAdapter
          : createCrystalMintAdapter();

      return issueCrystalAssetJob(input.prisma as any, {
        knowledgeRowId:
          Number.isFinite(knowledgeRowId) && knowledgeRowId > 0
            ? knowledgeRowId
            : undefined,
        knowledgePublicId: knowledgePublicId || undefined,
        mintAdapter: crystalMintAdapter,
      });
    },

    async trend_prompt_generate({ job }) {
      const promptId =
        typeof job.payload?.promptId === "string"
          ? job.payload.promptId.trim()
          : "";
      const placeSeed =
        typeof job.payload?.placeSeed === "string"
          ? job.payload.placeSeed.trim()
          : "";
      const requestedByUserId = Number(job.payload?.requestedByUserId ?? job.requestedByUserId ?? 0);
      const locale =
        job.payload?.locale === "zh" ||
        job.payload?.locale === "fr" ||
        job.payload?.locale === "es"
          ? job.payload.locale
          : "en";
      const communityType =
        typeof job.payload?.communityType === "string"
          ? job.payload.communityType
          : null;
      const mode =
        job.payload?.mode === "knowledge" || job.payload?.mode === "social"
          ? job.payload.mode
          : null;

      if (!promptId || !placeSeed || !Number.isFinite(requestedByUserId) || requestedByUserId <= 0) {
        if (promptId && Number.isFinite(requestedByUserId) && requestedByUserId > 0) {
          await markTrendPromptFailed(prismaAny, {
            promptId,
            requestedByUserId,
            aiJobId: job.id,
            failureCode: "provider_failed",
          });
        }
        throw new Error("invalid_trend_prompt_job_payload");
      }

      return processTrendPromptJob(prismaAny, {
        promptId,
        placeSeed,
        locale,
        communityType,
        mode,
        requestedByUserId,
        aiJobId: job.id,
      });
    },

    async configuration_copilot_generate({ job }) {
      return processConfigurationCopilotJob(prismaAny, { job });
    },

    async settings_text_assist_generate({ job }) {
      return processSettingsTextAssistJob(prismaAny, { job });
    },

    async style_life_feel_generate({ job }) {
      return processStyleLifeFeelJob(prismaAny, { job });
    },

    async anchored_interaction_suggestion_judge({ job }) {
      return processAnchoredSuggestionJob(prismaAny, { job });
    },

    async knowledge_relationship_label_classify({ job }) {
      return processKnowledgeRelationshipLabelClassificationJob(prismaAny, { job });
    },

    async knowledge_relationship_label_coverage_audit({ job }) {
      return processKnowledgeRelationshipCoverageAuditJob(prismaAny, { job });
    },

    async circle_cognitive_map_explain({ job }) {
      return processCircleCognitiveMapExplanationJob(prismaAny, { job });
    },

    async guardian_finding_generate({ job }) {
      return processGuardianFindingJob(prismaAny, { job });
    },

    async source_grounded_ask_generate({ job }) {
      return processSourceGroundedAskJob(prismaAny, { job });
    },

    async neutral_evaluation_generate({ job }) {
      return processNeutralEvaluationJob(prismaAny, { job });
    },

    async circle_growth_advisor_generate({ job }) {
      return processCircleGrowthAdvisorJob(prismaAny, { job });
    },
  };
}
