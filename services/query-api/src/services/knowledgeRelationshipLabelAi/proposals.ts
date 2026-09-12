import crypto from 'crypto';

import { createAiProposalArtifact } from '../aiOperatingLayer/proposals';
import {
    parseOpsAlertEmails,
    sendGuardianOpsAlertEmail,
    type GuardianOpsAlertEmail,
} from '../aiOperatingLayer/guardian/notifications';
import type {
    KnowledgeRelationshipCoverageRecommendation,
    KnowledgeRelationshipLabelDecision,
} from './types';

export async function createKnowledgeRelationshipLabelCatalogProposal(
    prisma: any,
    input: {
        taskType: string;
        subjectType: 'knowledge' | 'knowledge_relationship_label_catalog';
        subjectId: string;
        idempotencyKey: string;
        sourceDigest: string;
        contextCapsuleId?: string | null;
        evidenceRefs?: unknown[] | null;
        modelProfile?: string | null;
        promptVersion?: string | null;
        explanation: string;
        decision?: KnowledgeRelationshipLabelDecision | null;
        recommendation?: KnowledgeRelationshipCoverageRecommendation | null;
        cooldownBucket: string;
        cooldownUntil: Date;
        expiresAt: Date;
    },
) {
    const proposalKind = input.recommendation?.action ?? (
        input.decision?.proposedNewLabel ? 'needs_new_label' : 'review_assignment'
    );
    const existing = await findExistingCatalogProposal(prisma, input.taskType, input.idempotencyKey);
    if (existing) {
        return {
            ...existing,
            deduped: true,
        };
    }
    return createAiProposalArtifact(prisma, {
        taskType: input.taskType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        idempotencyKey: input.idempotencyKey,
        sourceDigest: input.sourceDigest,
        evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
        contextCapsuleId: input.contextCapsuleId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: 'v1',
        riskLevel: 'medium',
        proposedAction: 'knowledge_relationship_label.propose_catalog_change',
        proposedDiff: {
            proposalKind,
            decision: sanitizeDecision(input.decision),
            recommendation: sanitizeRecommendation(input.recommendation),
            lifecycle: {
                status: 'proposal_ready',
                confirmationAuthority: 'application_operator',
                confirmationTokenHash: null,
                cooldownBucket: input.cooldownBucket,
                cooldownUntil: input.cooldownUntil.toISOString(),
                notification: {
                    status: 'pending',
                    recipientCount: 0,
                    error: null,
                },
                finalDecision: null,
            },
        },
        explanation: input.explanation,
        validationErrors: [],
        reviewRequired: true,
        domainArtifactType: 'knowledge_relationship_label_catalog_proposal',
        domainArtifactId: input.subjectId,
        domainStatus: 'operator_review_pending',
        applyTarget: {
            type: 'knowledge_relationship_label_catalog',
            owner: 'services/query-api/src/services/knowledgeRelationshipLabels.ts',
            requires: 'application_operator_confirmation',
        },
        expiresAt: input.expiresAt,
    });
}

export async function recordKnowledgeRelationshipLabelProposalDecision(
    prisma: any,
    input: {
        proposalId: string;
        decision: 'accepted' | 'rejected' | 'expired';
        decidedBy?: string | null;
        reason?: string | null;
        now?: Date;
    },
): Promise<{
    ok: true;
    proposal: any;
} | {
    ok: false;
    error: 'proposal_not_found' | 'not_label_catalog_proposal' | 'already_decided';
}> {
    if (
        typeof prisma?.aiProposalArtifact?.findUnique !== 'function'
        || typeof prisma?.aiProposalArtifact?.update !== 'function'
    ) {
        return { ok: false, error: 'proposal_not_found' };
    }
    const proposal = await prisma.aiProposalArtifact.findUnique({
        where: { id: input.proposalId },
    });
    if (!proposal) return { ok: false, error: 'proposal_not_found' };
    if (proposal.domainArtifactType !== 'knowledge_relationship_label_catalog_proposal') {
        return { ok: false, error: 'not_label_catalog_proposal' };
    }
    if (['operator_accepted', 'operator_rejected', 'expired'].includes(String(proposal.domainStatus || ''))) {
        return { ok: false, error: 'already_decided' };
    }
    const now = input.now ?? new Date();
    const proposedDiff = proposal.proposedDiff && typeof proposal.proposedDiff === 'object'
        ? proposal.proposedDiff as Record<string, unknown>
        : {};
    const lifecycle = proposedDiff.lifecycle && typeof proposedDiff.lifecycle === 'object'
        ? proposedDiff.lifecycle as Record<string, unknown>
        : {};
    const finalDecision = {
        decision: input.decision,
        decidedBy: input.decidedBy || 'application_operator',
        reason: input.reason || null,
        decidedAt: now.toISOString(),
    };
    const status = input.decision === 'accepted'
        ? 'accepted'
        : input.decision === 'rejected'
            ? 'rejected'
            : 'expired';
    const domainStatus = input.decision === 'accepted'
        ? 'operator_accepted'
        : input.decision === 'rejected'
            ? 'operator_rejected'
            : 'expired';
    const updated = await prisma.aiProposalArtifact.update({
        where: { id: input.proposalId },
        data: {
            status,
            domainStatus,
            proposedDiff: {
                ...proposedDiff,
                lifecycle: {
                    ...lifecycle,
                    status: domainStatus,
                    finalDecision,
                },
            },
        },
    });
    await recordProposalEvent(prisma, {
        proposalId: input.proposalId,
        eventType: `decision_${input.decision}`,
        eventPayload: {
            ...finalDecision,
            confirmationAuthority: 'application_operator',
            catalogMutationApplied: false,
        },
    });
    return {
        ok: true,
        proposal: updated,
    };
}

export async function notifyKnowledgeRelationshipLabelProposalOperators(
    prisma: any,
    input: {
        proposalId: string;
        title: string;
        summary: string;
        opsEmails?: string[];
        sendEmail?: (email: GuardianOpsAlertEmail) => Promise<void>;
        now?: Date;
    },
): Promise<{
    status: 'sent' | 'skipped' | 'failed';
    recipientCount: number;
    error?: string | null;
}> {
    const recipients = parseOpsAlertEmails(
        input.opsEmails?.join(',') ?? process.env.OPS_ALERT_EMAILS ?? '',
    );
    const proposal = await findProposalById(prisma, input.proposalId);
    if (proposal && hasNotificationAttempt(proposal)) {
        return {
            status: normalizeNotificationAttemptStatus(proposal),
            recipientCount: normalizeNotificationRecipientCount(proposal),
            error: normalizeNotificationError(proposal),
        };
    }
    if (recipients.length === 0) {
        await recordProposalEvent(prisma, {
            proposalId: input.proposalId,
            eventType: 'notify_skipped',
            eventPayload: {
                notificationStatus: 'skipped',
                reason: 'ops_alert_email_not_configured',
                confirmationAuthority: 'application_operator',
            },
        });
        await updateNotificationLifecycle(prisma, input.proposalId, {
            status: 'skipped',
            recipientCount: 0,
            error: 'ops_alert_email_not_configured',
        });
        return {
            status: 'skipped',
            recipientCount: 0,
            error: 'ops_alert_email_not_configured',
        };
    }

    try {
        const sendEmail = input.sendEmail ?? sendGuardianOpsAlertEmail;
        await Promise.all(recipients.map((to) => sendEmail({
            to,
            subject: `[Alcheme Knowledge Labels] ${input.title}`,
            body: [
                input.summary,
                '',
                `Proposal: ${input.proposalId}`,
                'Authority: application_operator',
                'Action: review proposed knowledge relationship label catalog change',
            ].join('\n'),
        })));
        await recordProposalEvent(prisma, {
            proposalId: input.proposalId,
            eventType: 'notify_sent',
            eventPayload: {
                notificationStatus: 'sent',
                recipientCount: recipients.length,
                confirmationAuthority: 'application_operator',
                notifiedAt: (input.now ?? new Date()).toISOString(),
            },
        });
        await updateNotificationLifecycle(prisma, input.proposalId, {
            status: 'sent',
            recipientCount: recipients.length,
            error: null,
        });
        return {
            status: 'sent',
            recipientCount: recipients.length,
            error: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordProposalEvent(prisma, {
            proposalId: input.proposalId,
            eventType: 'notify_failed',
            eventPayload: {
                notificationStatus: 'failed',
                recipientCount: recipients.length,
                error: message,
                confirmationAuthority: 'application_operator',
            },
        });
        await updateNotificationLifecycle(prisma, input.proposalId, {
            status: 'failed',
            recipientCount: recipients.length,
            error: message,
        });
        return {
            status: 'failed',
            recipientCount: recipients.length,
            error: message,
        };
    }
}

async function findExistingCatalogProposal(
    prisma: any,
    taskType: string,
    idempotencyKey: string,
): Promise<any | null> {
    if (typeof prisma?.aiProposalArtifact?.findUnique !== 'function') return null;
    return prisma.aiProposalArtifact.findUnique({
        where: {
            taskType_idempotencyKey: {
                taskType,
                idempotencyKey,
            },
        },
    });
}

async function findProposalById(prisma: any, proposalId: string): Promise<any | null> {
    if (typeof prisma?.aiProposalArtifact?.findUnique !== 'function') return null;
    return prisma.aiProposalArtifact.findUnique({
        where: { id: proposalId },
    });
}

function getNotificationLifecycle(proposal: any): Record<string, unknown> | null {
    const proposedDiff = proposal?.proposedDiff && typeof proposal.proposedDiff === 'object'
        ? proposal.proposedDiff as Record<string, unknown>
        : {};
    const lifecycle = proposedDiff.lifecycle && typeof proposedDiff.lifecycle === 'object'
        ? proposedDiff.lifecycle as Record<string, unknown>
        : {};
    const notification = lifecycle.notification && typeof lifecycle.notification === 'object'
        ? lifecycle.notification as Record<string, unknown>
        : null;
    return notification;
}

function hasNotificationAttempt(proposal: any): boolean {
    const notification = getNotificationLifecycle(proposal);
    const status = String(notification?.status || '');
    return status === 'sent' || status === 'skipped' || status === 'failed';
}

function normalizeNotificationAttemptStatus(proposal: any): 'sent' | 'skipped' | 'failed' {
    const status = String(getNotificationLifecycle(proposal)?.status || '');
    return status === 'sent' || status === 'failed' ? status : 'skipped';
}

function normalizeNotificationRecipientCount(proposal: any): number {
    const parsed = Number(getNotificationLifecycle(proposal)?.recipientCount ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeNotificationError(proposal: any): string | null {
    const error = getNotificationLifecycle(proposal)?.error;
    return typeof error === 'string' && error.trim() ? error.trim() : null;
}

export function buildKnowledgeRelationshipProposalIdempotency(input: {
    taskType: string;
    subjectId: string;
    sourceDigest: string;
    proposalKey: string;
    cooldownBucket: string;
}): string {
    return `${input.taskType}:${digest([
        input.subjectId,
        input.sourceDigest,
        input.proposalKey,
        input.cooldownBucket,
    ].join(':')).slice(0, 64)}`;
}

export function buildCooldownBucket(now: Date, scope: string): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${scope}:${year}-${month}`;
}

export function buildCooldownUntil(now: Date): Date {
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
}

export function buildProposalExpiry(now: Date): Date {
    return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
}

async function recordProposalEvent(
    prisma: any,
    input: {
        proposalId: string;
        eventType: string;
        eventPayload: Record<string, unknown>;
    },
): Promise<void> {
    if (typeof prisma?.aiProposalEvent?.create !== 'function') return;
    await prisma.aiProposalEvent.create({
        data: {
            proposalId: input.proposalId,
            eventType: input.eventType,
            actorUserId: null,
            eventPayload: input.eventPayload,
        },
    });
}

async function updateNotificationLifecycle(
    prisma: any,
    proposalId: string,
    notification: {
        status: 'sent' | 'skipped' | 'failed';
        recipientCount: number;
        error?: string | null;
    },
): Promise<void> {
    if (
        typeof prisma?.aiProposalArtifact?.findUnique !== 'function'
        || typeof prisma?.aiProposalArtifact?.update !== 'function'
    ) {
        return;
    }
    const proposal = await prisma.aiProposalArtifact.findUnique({
        where: { id: proposalId },
        select: { proposedDiff: true },
    });
    const proposedDiff = proposal?.proposedDiff && typeof proposal.proposedDiff === 'object'
        ? proposal.proposedDiff as Record<string, unknown>
        : {};
    const lifecycle = proposedDiff.lifecycle && typeof proposedDiff.lifecycle === 'object'
        ? proposedDiff.lifecycle as Record<string, unknown>
        : {};
    await prisma.aiProposalArtifact.update({
        where: { id: proposalId },
        data: {
            proposedDiff: {
                ...proposedDiff,
                lifecycle: {
                    ...lifecycle,
                    notification,
                },
            },
        },
    });
}

function sanitizeDecision(value: KnowledgeRelationshipLabelDecision | null | undefined): Record<string, unknown> | null {
    if (!value) return null;
    return {
        labelKey: value.labelKey,
        confidence: value.confidence,
        shortReason: value.shortReason,
        sourceKnowledgeIds: value.sourceKnowledgeIds,
        needsHumanReview: value.needsHumanReview,
        proposedNewLabel: value.proposedNewLabel ?? null,
    };
}

function sanitizeRecommendation(value: KnowledgeRelationshipCoverageRecommendation | null | undefined): Record<string, unknown> | null {
    if (!value) return null;
    return {
        action: value.action,
        labelKey: value.labelKey ?? null,
        proposedLabel: value.proposedLabel ?? null,
        reason: value.reason,
        confidence: value.confidence,
    };
}

function digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
