import { randomBytes } from "node:crypto";

import { requireCircleActorForAuthActor } from "../auth/actor";
import { digestJson } from "./digest";

export interface HostedAppNativeActionActor {
  userId: number;
  userPubkey: string;
  pubkey?: string;
  [key: string]: unknown;
}

export interface HostedAppNativeActionInput {
  actionId: string;
  payload: Record<string, unknown>;
  circleId?: number;
  actor: HostedAppNativeActionActor;
  confirmedPreviewDigest?: string | null;
  expectedPreviewDigest?: string | null;
}

export interface HostedAppNativeActionDependencies {
  requireCircleActorForAuthActor: (
    actor: any,
    prisma: any,
    input: { circleId: number; action: "draft.write" },
  ) => Promise<unknown>;
  createHostedAppDraftPost: (input: {
    circleId: number;
    title: string;
    body: string;
    actorUserId: number;
  }) => Promise<{ id: number }>;
}

export interface HostedAppNativeActionResult {
  executionTargetRef: string;
  nativeResultRef: string;
  preview: unknown;
  previewDigest: string;
}

export function assertNativeActionExecutionAllowed(input: {
  actionId: string;
  executionTargetRef: string;
  nodeEnv: string;
}): void {
  if (input.nodeEnv === "production" && input.executionTargetRef.startsWith("dry_run:")) {
    throw new Error("hosted_app_native_action_dry_run_disabled");
  }
}

export function buildNativeDraftCreatePreview(input: {
  title: string;
  body: string;
  circleId: number;
  authorPubkey: string;
}) {
  const preview = {
    actionId: "create_draft_intent",
    title: input.title,
    bodyPreview: input.body.slice(0, 240),
    circleId: input.circleId,
    authorPubkey: input.authorPubkey,
  };
  return { preview, previewDigest: digestJson(preview) };
}

export function createHostedAppNativeActionDependencies(
  prisma: any,
): HostedAppNativeActionDependencies {
  return {
    requireCircleActorForAuthActor,
    createHostedAppDraftPost: (input) => createHostedAppDraftPost(prisma, input),
  };
}

export async function executeHostedAppNativeAction(
  prisma: any,
  input: HostedAppNativeActionInput,
  dependencies: HostedAppNativeActionDependencies = createHostedAppNativeActionDependencies(prisma),
): Promise<HostedAppNativeActionResult> {
  if (input.actionId !== "create_draft_intent") {
    throw new Error("hosted_app_native_action_not_registered");
  }

  const title = String(input.payload.title || "").trim();
  const body = String(input.payload.body || "");
  const circleId = parsePositiveInteger(input.circleId ?? input.payload.circleId);
  if (!circleId) throw new Error("hosted_app_native_action_circle_required");

  const { preview, previewDigest } = buildNativeDraftCreatePreview({
    title,
    body,
    circleId,
    authorPubkey: input.actor.userPubkey,
  });
  const expectedPreviewDigest = input.expectedPreviewDigest ?? previewDigest;
  if (!input.confirmedPreviewDigest) {
    throw new Error("hosted_app_action_preview_confirmation_required");
  }
  if (input.confirmedPreviewDigest && input.confirmedPreviewDigest !== expectedPreviewDigest) {
    throw new Error("hosted_app_action_preview_mismatch");
  }

  await dependencies.requireCircleActorForAuthActor(
    {
      ...input.actor,
      pubkey: input.actor.pubkey ?? input.actor.userPubkey,
    },
    prisma,
    {
      circleId,
      action: "draft.write",
    },
  );
  const created = await dependencies.createHostedAppDraftPost({
    circleId,
    title,
    body,
    actorUserId: input.actor.userId,
  });

  return {
    executionTargetRef: "alcheme_native:create_draft_intent",
    nativeResultRef: `post:${created.id}`,
    preview,
    previewDigest,
  };
}

// Existing candidate/manual draft services bind to discussion-source lifecycles.
// This adapter is the narrow hosted-app create_draft_intent write boundary and
// must only be called after requireCircleActorForAuthActor(... action: "draft.write").
export async function createHostedAppDraftPost(
  prisma: any,
  input: {
    circleId: number;
    title: string;
    body: string;
    actorUserId: number;
  },
): Promise<{ id: number }> {
  const posts = prisma?.post;
  if (!posts?.create) {
    throw new Error("hosted_app_native_action_adapter_unavailable");
  }
  const text = input.title ? `# ${input.title}\n\n${input.body}` : input.body;
  const created = await posts.create({
    data: {
      contentId: `hosted-app-draft:${input.circleId}:${Date.now()}:${randomBytes(6).toString("hex")}`,
      authorId: input.actorUserId,
      text,
      contentType: "hosted-app/draft",
      circleId: input.circleId,
      status: "Draft",
      visibility: "CircleOnly",
      onChainAddress: `offchain_hosted_${randomBytes(16).toString("hex")}`.slice(0, 44),
      lastSyncedSlot: BigInt(0),
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}
