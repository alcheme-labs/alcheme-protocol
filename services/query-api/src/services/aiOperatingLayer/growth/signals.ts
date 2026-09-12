import crypto from 'crypto';

import type { EvidenceRef } from '../types';
import { loadCircleGrowthAdvisorConfig } from './config';
import type {
    CircleGrowthCognitiveMapProjection,
    CircleGrowthSignalItem,
    CircleGrowthSignalSnapshot,
    CircleGrowthTimeWindow,
    CircleGrowthTriggerSource,
} from './types';

interface CollectCircleGrowthSignalsInput {
    circleId: number;
    requestedByUserId?: number | null;
    triggerSource: CircleGrowthTriggerSource;
    now?: Date;
    lookbackDays?: number;
}

interface GrowthEvidenceInput {
    circleId: number;
    metricPath: string;
    artifactType: string;
    artifactId: string;
    digest?: string | null;
    capturedAt: Date;
    timeWindow: CircleGrowthTimeWindow;
    visibility?: EvidenceRef['visibility'];
}

const ZERO_DIGEST = '0'.repeat(64);

export async function collectCircleGrowthSignals(
    prisma: any,
    input: CollectCircleGrowthSignalsInput,
): Promise<CircleGrowthSignalSnapshot> {
    const now = input.now ?? new Date();
    const config = loadCircleGrowthAdvisorConfig();
    const lookbackDays = input.lookbackDays ?? config.lookbackDays;
    const lookbackStartedAt = new Date(now.getTime() - lookbackDays * 24 * 3_600_000);
    const timeWindow = {
        startedAt: lookbackStartedAt.toISOString(),
        endedAt: now.toISOString(),
    };

    const draftPostIds = await loadDraftPostIds(prisma, input.circleId, lookbackStartedAt);
    const [
        discussionMessages,
        draftThreads,
        draftApplications,
        crystallizationAttempts,
        sourceMaterials,
        summarySnapshot,
        members,
        governanceRequests,
        trendReceipts,
    ] = await Promise.all([
        loadDiscussionMessages(prisma, input.circleId, lookbackStartedAt, now),
        loadDraftThreads(prisma, draftPostIds, lookbackStartedAt),
        loadDraftApplications(prisma, draftPostIds, lookbackStartedAt),
        loadCrystallizationAttempts(prisma, draftPostIds, lookbackStartedAt),
        loadSourceMaterials(prisma, input.circleId, lookbackStartedAt),
        loadLatestSummarySnapshot(prisma, input.circleId),
        loadMembers(prisma, input.circleId),
        loadGovernanceRequests(prisma, input.circleId, lookbackStartedAt),
        loadTrendReceipts(prisma, lookbackStartedAt, now),
    ]);

    const discussion = summarizeDiscussion(discussionMessages);
    const drafts = summarizeDrafts(draftThreads, draftApplications);
    const crystallization = summarizeCrystallization(crystallizationAttempts);
    const sources = summarizeSources(sourceMaterials);
    const summary = summarizeSummarySnapshot(summarySnapshot);
    const membership = summarizeMembers(members);
    const governance = summarizeGovernance(governanceRequests);
    const trends = summarizeTrends(trendReceipts);
    const cognitiveMapProjection = buildCognitiveMapProjection(summarySnapshot);

    const metrics = {
        discussion,
        drafts,
        crystallization,
        sourceMaterials: sources,
        summary,
        membership,
        governance,
        trends,
    };

    const evidenceRefs = [
        createGrowthDomainEvidenceRef({
            circleId: input.circleId,
            metricPath: 'discussion.window',
            artifactType: 'circle_discussion_window',
            artifactId: `circle:${input.circleId}:discussion:${timeWindow.startedAt}:${timeWindow.endedAt}`,
            digest: digestJson(discussion),
            capturedAt: now,
            timeWindow,
        }),
        createGrowthDomainEvidenceRef({
            circleId: input.circleId,
            metricPath: 'draft.lifecycle',
            artifactType: 'draft_discussion_aggregate',
            artifactId: `circle:${input.circleId}:drafts:${timeWindow.startedAt}:${timeWindow.endedAt}`,
            digest: digestJson(drafts),
            capturedAt: now,
            timeWindow,
        }),
        createGrowthDomainEvidenceRef({
            circleId: input.circleId,
            metricPath: 'summary.cognitiveMapProjection',
            artifactType: 'circle_summary_snapshot',
            artifactId: summary.summaryId || `circle:${input.circleId}:summary:none`,
            digest: digestJson(cognitiveMapProjection),
            capturedAt: now,
            timeWindow,
        }),
        createGrowthDomainEvidenceRef({
            circleId: input.circleId,
            metricPath: 'member.roleParticipation',
            artifactType: 'circle_member_aggregate',
            artifactId: `circle:${input.circleId}:members`,
            digest: digestJson(membership),
            capturedAt: now,
            timeWindow,
        }),
        createGrowthDomainEvidenceRef({
            circleId: input.circleId,
            metricPath: 'governance.activity',
            artifactType: 'governance_request_aggregate',
            artifactId: `circle:${input.circleId}:governance:${timeWindow.startedAt}:${timeWindow.endedAt}`,
            digest: digestJson(governance),
            capturedAt: now,
            timeWindow,
        }),
    ];

    const missingSignals = [];
    if (discussion.messageCount <= 0) {
        missingSignals.push({
            key: 'discussion.activity',
            label: 'No recent discussion activity was available.',
            severity: 'critical' as const,
        });
    }
    if (!summary.summaryId) {
        missingSignals.push({
            key: 'summary.snapshot',
            label: 'No circle summary snapshot was available.',
            severity: 'critical' as const,
        });
    }

    const currentSignals: CircleGrowthSignalItem[] = [];
    const counterSignals: CircleGrowthSignalItem[] = [];

    if (missingSignals.length === 0) {
        if (discussion.focusedRatio >= 0.55 && discussion.spamRatio < 0.35 && discussion.participantCount >= 2) {
            currentSignals.push({
                key: 'discussion.focused',
                label: 'Discussion is active and focused.',
                value: round(discussion.focusedRatio),
                severity: 'positive',
            });
        }
        if (drafts.acceptedThreadCount > 0 || drafts.appliedThreadCount > 0) {
            currentSignals.push({
                key: 'draft.lifecycle_progress',
                label: 'Draft review has accepted or applied issues.',
                value: drafts.acceptedThreadCount + drafts.appliedThreadCount,
                severity: 'positive',
            });
        }
        if (sources.usedCount + sources.crystallizedCount > 0) {
            currentSignals.push({
                key: 'source_material.used',
                label: 'Source materials have been consumed by drafting or crystallization.',
                value: sources.usedCount + sources.crystallizedCount,
                severity: 'positive',
            });
        }
        if (membership.managerCount >= 1 && membership.activeMemberCount >= 3) {
            currentSignals.push({
                key: 'member.role_coverage',
                label: 'The circle has active members and manager coverage.',
                value: membership.activeMemberCount,
                severity: 'positive',
            });
        }
    }

    if (discussion.spamRatio >= 0.35) {
        counterSignals.push({
            key: 'discussion.spam_high',
            label: 'Spam ratio is too high for a growth recommendation.',
            value: round(discussion.spamRatio),
            severity: 'critical',
        });
    }
    if (summary.openQuestionCount > 0) {
        counterSignals.push({
            key: 'summary.open_questions',
            label: 'The latest summary still has open questions.',
            value: summary.openQuestionCount,
            severity: 'warning',
        });
    }
    if (summary.unboundBranchCount > 0) {
        counterSignals.push({
            key: 'summary.evidence_gaps',
            label: 'Some summary branches are not bound to evidence.',
            value: summary.unboundBranchCount,
            severity: 'warning',
        });
    }
    if (sources.totalCount > 0 && sources.usedCount + sources.crystallizedCount === 0) {
        counterSignals.push({
            key: 'source_material.low_usage',
            label: 'Source materials exist but have not been consumed.',
            value: sources.totalCount,
            severity: 'warning',
        });
    }
    if (membership.managerCount === 0) {
        counterSignals.push({
            key: 'member.no_manager',
            label: 'No active Owner/Admin manager was found.',
            value: 0,
            severity: 'critical',
        });
    }

    const status = missingSignals.length > 0 ? 'no_signal' : 'ready';
    const sourceDigest = digestJson({
        circleId: input.circleId,
        metrics,
        cognitiveMapProjection,
        missingSignals,
        timeWindow,
    });

    return {
        id: `growth_signal_${digestJson(`${input.circleId}:${sourceDigest}:${now.toISOString()}`).slice(0, 24)}`,
        circleId: input.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
        triggerSource: input.triggerSource,
        status,
        currentSignals: status === 'ready' ? currentSignals : [],
        counterSignals,
        missingSignals,
        metrics,
        cognitiveMapProjection,
        evidenceRefs,
        sourceDigest,
        lookbackStartedAt,
        lookbackEndedAt: now,
        createdAt: now,
    };
}

export function createGrowthDomainEvidenceRef(input: GrowthEvidenceInput): EvidenceRef {
    const digest = normalizeDigest(input.digest) || digestJson({
        circleId: input.circleId,
        metricPath: input.metricPath,
        artifactType: input.artifactType,
        artifactId: input.artifactId,
        timeWindow: input.timeWindow,
    });
    return {
        sourceType: 'domain_artifact',
        sourceId: input.artifactId,
        digest,
        visibility: input.visibility ?? 'member_visible',
        locator: {
            type: 'circle_growth_signal',
            ref: `${input.artifactId}#${input.metricPath}`,
        },
        permissionSnapshot: {
            growthSignal: {
                circleId: input.circleId,
                metricPath: input.metricPath,
                artifactType: input.artifactType,
                artifactId: input.artifactId,
                timeWindow: input.timeWindow,
                privacyProfile: input.visibility ?? 'member_visible',
                digest,
            },
        },
        capturedAt: input.capturedAt.toISOString(),
        expiresAt: null,
    };
}

function summarizeDiscussion(rows: any[]) {
    const messages = Array.isArray(rows) ? rows : [];
    const messageCount = messages.length;
    const focusedCount = messages.filter((row) => normalizeScore(row.focusScore ?? row.semanticScore ?? row.relevanceScore) >= 0.55).length;
    const spamCount = messages.filter((row) => normalizeScore(row.spamScore) >= 0.6).length;
    const questionCount = messages.filter((row) => normalizeFacets(row.semanticFacets).includes('question')).length;
    const participantCount = new Set(messages.map((row) => String(row.senderPubkey || '')).filter(Boolean)).size;
    return {
        messageCount,
        focusedCount,
        focusedRatio: round(focusedCount / Math.max(1, messageCount)),
        spamCount,
        spamRatio: round(spamCount / Math.max(1, messageCount)),
        questionCount,
        participantCount,
    };
}

function summarizeDrafts(threads: any[], applications: any[]) {
    const rows = Array.isArray(threads) ? threads : [];
    const appliedThreadIds = new Set((Array.isArray(applications) ? applications : []).map((row) => String(row.threadId)));
    const acceptedThreadCount = rows.filter((row) => String(row.state) === 'accepted').length;
    const openThreadCount = rows.filter((row) => ['open', 'proposed'].includes(String(row.state))).length;
    return {
        totalThreadCount: rows.length,
        acceptedThreadCount,
        openThreadCount,
        appliedThreadCount: appliedThreadIds.size,
        applicationMismatchCount: Math.max(0, acceptedThreadCount - appliedThreadIds.size),
    };
}

function summarizeCrystallization(rows: any[]) {
    const attempts = Array.isArray(rows) ? rows : [];
    const successCount = attempts.filter((row) => ['finalized', 'succeeded', 'success', 'issued'].includes(String(row.status))).length;
    const failureCount = attempts.filter((row) => ['failed', 'error', 'rejected'].includes(String(row.status))).length;
    return {
        attemptCount: attempts.length,
        successCount,
        failureCount,
        successRate: round(successCount / Math.max(1, attempts.length)),
    };
}

function summarizeSources(rows: any[]) {
    const materials = Array.isArray(rows) ? rows : [];
    const usedCount = materials.filter((row) => String(row.lifecycleStatus) === 'used_in_draft').length;
    const crystallizedCount = materials.filter((row) => String(row.lifecycleStatus) === 'crystallized').length;
    return {
        totalCount: materials.length,
        usedCount,
        crystallizedCount,
        reviewPendingCount: materials.filter((row) => String(row.lifecycleStatus) === 'review_pending').length,
    };
}

function summarizeSummarySnapshot(snapshot: any) {
    if (!snapshot) {
        return {
            summaryId: null,
            openQuestionCount: 0,
            unboundBranchCount: 0,
            stableOutputCount: 0,
        };
    }
    const branches = Array.isArray(snapshot.viewpointBranches) ? snapshot.viewpointBranches : [];
    return {
        summaryId: String(snapshot.summaryId || ''),
        version: Number(snapshot.version || 0),
        openQuestionCount: Array.isArray(snapshot.openQuestions) ? snapshot.openQuestions.length : 0,
        unboundBranchCount: branches.filter((row: any) => String(row.sourceBindingKind) === 'unbound').length,
        stableOutputCount: branches.filter((row: any) => String(row.sourceBindingKind) !== 'unbound').length,
    };
}

function buildCognitiveMapProjection(snapshot: any): CircleGrowthCognitiveMapProjection {
    const conceptGraph = snapshot && typeof snapshot.conceptGraph === 'object' && !Array.isArray(snapshot.conceptGraph)
        ? snapshot.conceptGraph
        : {};
    const nodes = Array.isArray(conceptGraph.nodes) ? conceptGraph.nodes : [];
    const edges = Array.isArray(conceptGraph.edges) ? conceptGraph.edges : [];
    const branches = Array.isArray(snapshot?.viewpointBranches) ? snapshot.viewpointBranches : [];
    return {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        branchCount: branches.length,
        unboundBranchCount: branches.filter((row: any) => String(row.sourceBindingKind) === 'unbound').length,
        issueCount: Array.isArray(snapshot?.issueMap) ? snapshot.issueMap.length : 0,
        openQuestionCount: Array.isArray(snapshot?.openQuestions) ? snapshot.openQuestions.length : 0,
        timelineItemCount: Array.isArray(snapshot?.sedimentationTimeline) ? snapshot.sedimentationTimeline.length : 0,
    };
}

function summarizeMembers(rows: any[]) {
    const members = (Array.isArray(rows) ? rows : []).filter((row) => String(row.status) === 'Active');
    const managerCount = members.filter((row) => ['Owner', 'Admin'].includes(String(row.role))).length;
    return {
        activeMemberCount: members.length,
        managerCount,
        roleCounts: members.reduce((acc: Record<string, number>, row) => {
            const role = String(row.role || 'Member');
            acc[role] = (acc[role] ?? 0) + 1;
            return acc;
        }, {}),
    };
}

function summarizeGovernance(rows: any[]) {
    const requests = Array.isArray(rows) ? rows : [];
    return {
        requestCount: requests.length,
        activeCount: requests.filter((row) => String(row.state) === 'active').length,
        resolvedCount: requests.filter((row) => ['resolved', 'executed'].includes(String(row.state))).length,
    };
}

function summarizeTrends(rows: any[]) {
    const receipts = Array.isArray(rows) ? rows : [];
    return {
        freshCount: receipts.filter((row) => String(row.status) === 'fresh' && String(row.visibility || 'public') === 'public').length,
        totalCount: receipts.length,
    };
}

async function loadDiscussionMessages(prisma: any, circleId: number, startedAt: Date, endedAt: Date): Promise<any[]> {
    if (typeof prisma?.circleDiscussionMessage?.findMany !== 'function') return [];
    return prisma.circleDiscussionMessage.findMany({
        where: {
            circleId,
            deleted: false,
            isEphemeral: false,
            createdAt: { gte: startedAt, lte: endedAt },
        },
        select: {
            senderPubkey: true,
            relevanceScore: true,
            semanticScore: true,
            spamScore: true,
            semanticFacets: true,
            focusScore: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
    });
}

async function loadDraftPostIds(prisma: any, circleId: number, startedAt: Date): Promise<number[]> {
    if (typeof prisma?.post?.findMany !== 'function') return [];
    const posts = await prisma.post.findMany({
        where: {
            circleId,
            contentType: 'draft',
            createdAt: { gte: startedAt },
        },
        select: { id: true },
        take: 500,
    });
    return (Array.isArray(posts) ? posts : [])
        .map((row) => Number(row.id))
        .filter((id) => Number.isInteger(id) && id > 0);
}

async function loadDraftThreads(prisma: any, draftPostIds: number[], startedAt: Date): Promise<any[]> {
    if (typeof prisma?.draftDiscussionThread?.findMany !== 'function') return [];
    if (draftPostIds.length === 0) return [];
    return prisma.draftDiscussionThread.findMany({
        where: {
            createdAt: { gte: startedAt },
            draftPostId: { in: draftPostIds },
        },
        select: {
            state: true,
        },
        take: 500,
    });
}

async function loadDraftApplications(prisma: any, draftPostIds: number[], startedAt: Date): Promise<any[]> {
    if (typeof prisma?.draftDiscussionApplication?.findMany !== 'function') return [];
    if (draftPostIds.length === 0) return [];
    return prisma.draftDiscussionApplication.findMany({
        where: {
            appliedAt: { gte: startedAt },
            draftPostId: { in: draftPostIds },
        },
        select: {
            threadId: true,
        },
        take: 500,
    });
}

async function loadCrystallizationAttempts(prisma: any, draftPostIds: number[], startedAt: Date): Promise<any[]> {
    if (typeof prisma?.draftCrystallizationAttempt?.findMany !== 'function') return [];
    if (draftPostIds.length === 0) return [];
    return prisma.draftCrystallizationAttempt.findMany({
        where: {
            createdAt: { gte: startedAt },
            draftPostId: { in: draftPostIds },
        },
        select: {
            status: true,
        },
        take: 500,
    });
}

async function loadSourceMaterials(prisma: any, circleId: number, startedAt: Date): Promise<any[]> {
    if (typeof prisma?.sourceMaterial?.findMany !== 'function') return [];
    return prisma.sourceMaterial.findMany({
        where: {
            circleId,
            createdAt: { gte: startedAt },
        },
        select: {
            lifecycleStatus: true,
        },
        take: 500,
    });
}

async function loadLatestSummarySnapshot(prisma: any, circleId: number): Promise<any | null> {
    if (typeof prisma?.circleSummarySnapshot?.findFirst !== 'function') return null;
    return prisma.circleSummarySnapshot.findFirst({
        where: { circleId },
        select: {
            summaryId: true,
            version: true,
            issueMap: true,
            conceptGraph: true,
            viewpointBranches: true,
            sedimentationTimeline: true,
            openQuestions: true,
        },
        orderBy: [
            { version: 'desc' },
            { generatedAt: 'desc' },
        ],
    });
}

async function loadMembers(prisma: any, circleId: number): Promise<any[]> {
    if (typeof prisma?.circleMember?.findMany !== 'function') return [];
    return prisma.circleMember.findMany({
        where: {
            circleId,
            status: 'Active',
        },
        select: {
            role: true,
            status: true,
        },
        take: 500,
    });
}

async function loadGovernanceRequests(prisma: any, circleId: number, startedAt: Date): Promise<any[]> {
    if (typeof prisma?.governanceRequest?.findMany !== 'function') return [];
    return prisma.governanceRequest.findMany({
        where: {
            OR: [
                { scopeType: 'circle', scopeRef: String(circleId) },
                { targetType: 'circle', targetRef: String(circleId) },
            ],
            createdAt: { gte: startedAt },
        },
        select: {
            state: true,
        },
        take: 500,
    });
}

async function loadTrendReceipts(prisma: any, startedAt: Date, now: Date): Promise<any[]> {
    if (typeof prisma?.trendReceipt?.findMany !== 'function') return [];
    return prisma.trendReceipt.findMany({
        where: {
            visibility: 'public',
            fetchedAt: { gte: startedAt, lte: now },
        },
        select: {
            status: true,
            visibility: true,
        },
        take: 100,
    });
}

function normalizeScore(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1, Math.max(0, parsed));
}

function normalizeFacets(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function normalizeDigest(value: unknown): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function digestJson(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value ?? null))
        .digest('hex');
}

function round(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1000) / 1000;
}

export function normalizeSourceDigest(value: unknown): string {
    return normalizeDigest(value) ?? ZERO_DIGEST;
}
