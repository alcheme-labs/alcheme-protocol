import { GraphQLScalarType, Kind } from 'graphql';
import bs58 from 'bs58';
import { MemberStatus, Prisma } from '@prisma/client';
import { Context } from './context';
import { localizeNotification } from '../notifications/localize';
import { resolveNotificationCanonicalUrl } from '../notifications/routing';
import { loadGovernanceNotificationStatuses } from '../notifications/governanceStatus';
import { FeedFilter, verifiedUserFilter } from '../utils/filters';
import {
    AuthActorError,
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
    resolveAuthenticatedActor,
    type AuthActor,
} from '../services/auth/actor';
import { authorizeDraftActionForActor } from '../services/auth/actorPermissions';
import { bumpPostHeat, DRAFT_HEAT_EVENTS } from '../services/heat/postHeat';
import { buildGhostDraftGenerationDedupeKey } from '../services/ghostDraft/requestKey';
import { buildAcceptedIssueRevisionDedupeKey } from '../services/draftAiAssist/requestKey';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { assertAiTaskAllowed } from '../ai/provider';
import { loadKnowledgeVersionDiff } from '../services/knowledgeVersionDiff';
import { normalizeCircleGenesisMode } from '../services/circleGenesisMode';
import { loadCircleAgentsByPubkeys } from '../services/agents/runtime';
import { resolveOwnedCrystalCount } from '../services/crystalEntitlements/runtime';
import { resolveProjectedCircleSettings } from '../services/policy/settingsEnvelope';
import { publishDiscussionRealtimeEvent } from '../services/discussion/realtime';
import { resolveCircleActorDisplays } from '../services/identity/circleActorDisplay';
import { localizeQueryApiCopy } from '../i18n/copy';
import { assertInternalApiRequest } from '../security/internalAuth';
import {
    loadCrystallizationOutputRecordsByKnowledgeIds,
    type CrystallizationOutputSummaryRecord,
} from '../services/crystallization/readModel';
import {
    formatSourceDraftVersionLabel,
    listKnowledgeRelationshipLabels,
    resolveKnowledgeRelationshipAssignment,
    resolveKnowledgeRelationshipAssignmentsForKnowledgeIds,
} from '../services/knowledgeRelationshipLabels';
import { hashCanonicalGovernanceValue } from '../services/governance/canonicalCodec';
import { isKnowledgePublicationPubliclyReadable } from '../services/knowledgePublicationLicense';
import { publicContentVisibilityDownrankState } from '../services/governance/contentVisibilityDownrank';
import { resolveDraftTitle } from '../services/draftLifecycle/draftTitle';

function verifiedKnowledgePublicationOrigin(knowledge: any): Record<string, unknown> | null {
    const origin = knowledge?.publicationOrigin;
    const digest = String(knowledge?.publicationOriginDigest || '').trim().toLowerCase();
    if (!origin || typeof origin !== 'object' || Array.isArray(origin) || !/^[a-f0-9]{64}$/.test(digest)) {
        return null;
    }
    if (hashCanonicalGovernanceValue('alcheme.knowledge.publication-origin.v1', origin) !== digest) {
        return null;
    }
    const record = origin as Record<string, any>;
    const targetCircleId = Number(record.targetCircleId);
    const committeeCircleId = record.committeeCircleId == null ? null : Number(record.committeeCircleId);
    if (
        record.schemaVersion !== 1
        || (record.kind !== 'ordinary_collaboration' && record.kind !== 'governance_case_outcome')
        || record.governanceHome?.type !== 'circle'
        || !Number.isInteger(targetCircleId)
        || targetCircleId <= 0
        || record.governanceHome.ref !== String(targetCircleId)
        || Number(knowledge?.circleId) !== targetCircleId
        || typeof record.submittedByPubkey !== 'string'
        || !record.submittedByPubkey.trim()
        || record.submittedByPubkey !== String(knowledge?.author?.pubkey || '').trim()
        || record.submitAuthoritySemantics !== 'legacy_author'
        || (record.kind === 'ordinary_collaboration' && committeeCircleId !== null)
        || (record.kind === 'governance_case_outcome'
            && (!Number.isInteger(committeeCircleId) || Number(committeeCircleId) <= 0))
    ) {
        return null;
    }
    return record;
}

async function resolveGraphqlActor({ req, prisma }: Context): Promise<AuthActor | null> {
    return resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
}

async function requireGraphqlActor(context: Context): Promise<AuthActor> {
    return requireAuthenticatedActor(context.req, context.prisma, { requireSessionCookie: true });
}

function serializeGraphqlActor(actor: AuthActor): Record<string, unknown> {
    return {
        userId: actor.userId,
        pubkey: actor.pubkey,
        handle: actor.handle,
        displayName: actor.displayName,
        sessionId: actor.sessionId,
        authSource: actor.authSource,
        identity: {
            handle: actor.identity.handle,
            identityPubkey: actor.identity.identityPubkey,
            accountAddress: actor.identity.accountAddress,
            presence: actor.identity.presence,
        },
    };
}

async function canAccessCircleForGraphqlActor(
    prisma: Context['prisma'],
    actor: AuthActor,
    circleId: number,
): Promise<boolean> {
    try {
        await requireCircleActorForAuthActor(actor, prisma, {
            circleId,
            action: 'public.read',
            requireMemberChainPresence: false,
        });
        return true;
    } catch (error) {
        if (error instanceof AuthActorError && error.code === 'circle_membership_required') {
            return false;
        }
        throw error;
    }
}

export async function canReadKnowledgeRecord(context: Context, knowledge: {
    publicationState?: string | null;
    knowledgeId: string;
    version: number;
    publicationLicenseRef?: string | null;
    publicationLicenseVersion?: string | null;
    publicationLicenseDigest?: string | null;
    publicationSourceSnapshotDigest?: string | null;
    stablePublicPath?: string | null;
    authorId: number;
    circleId: number;
}): Promise<boolean> {
    if (knowledge.publicationState === 'published' && await isKnowledgePublicationPubliclyReadable({
        prisma: context.prisma,
        knowledge,
    })) return true;
    if (context.userId && knowledge.authorId === context.userId) return true;
    const actor = await resolveGraphqlActor(context);
    if (!actor) return false;
    return canAccessCircleForGraphqlActor(context.prisma, actor, knowledge.circleId);
}

// DateTime Scalar
const dateTimeScalar = new GraphQLScalarType({
    name: 'DateTime',
    parseValue(value) {
        return new Date(value as string);
    },
    serialize(value) {
        return (value as Date).toISOString();
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING) {
            return new Date(ast.value);
        }
        return null;
    },
});

// BigInt Scalar
const bigIntScalar = new GraphQLScalarType({
    name: 'BigInt',
    parseValue(value) {
        return BigInt(value as string);
    },
    serialize(value) {
        if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
        }
        return String(value);
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING || ast.kind === Kind.INT) {
            return BigInt(ast.value);
        }
        return null;
    },
});

const jsonScalar = new GraphQLScalarType({
    name: 'JSON',
    serialize(value) {
        return value;
    },
    parseValue(value) {
        return value;
    },
    parseLiteral(ast): unknown {
        if (ast.kind === Kind.NULL) return null;
        if (ast.kind === Kind.STRING || ast.kind === Kind.BOOLEAN) return ast.value;
        if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) return Number(ast.value);
        if (ast.kind === Kind.LIST) return ast.values.map((value) => jsonScalar.parseLiteral(value, undefined));
        if (ast.kind === Kind.OBJECT) {
            return Object.fromEntries(
                ast.fields.map((field) => [field.name.value, jsonScalar.parseLiteral(field.value, undefined)]),
            );
        }
        return undefined;
    },
});

function hexToBase58(hex: string): string | null {
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
    try {
        return bs58.encode(Buffer.from(hex, 'hex'));
    } catch {
        return null;
    }
}

function buildCandidateCrystalIds(knowledge: any): string[] {
    const candidates = new Set<string>();

    if (typeof knowledge.knowledgeId === 'string' && knowledge.knowledgeId.length > 0) {
        candidates.add(knowledge.knowledgeId);
        const asBase58 = hexToBase58(knowledge.knowledgeId);
        if (asBase58) candidates.add(asBase58);
    }

    if (typeof knowledge.onChainAddress === 'string' && knowledge.onChainAddress.length > 0) {
        candidates.add(knowledge.onChainAddress);
    }

    if (typeof knowledge.sourceContentId === 'string' && knowledge.sourceContentId.length > 0) {
        candidates.add(knowledge.sourceContentId);
    }

    return Array.from(candidates);
}

function normalizeContributionRole(role: string | null | undefined): 'Author' | 'Discussant' | 'Reviewer' | 'Cited' | 'Unknown' {
    if (!role) return 'Unknown';
    const normalized = role.trim().toLowerCase();
    if (normalized === 'author') return 'Author';
    if (normalized === 'discussant') return 'Discussant';
    if (normalized === 'reviewer') return 'Reviewer';
    if (normalized === 'cited') return 'Cited';
    return 'Unknown';
}

type KnowledgeContributorAssessmentKind =
    | 'REAL'
    | 'MOCK'
    | 'HISTORICAL_FALLBACK'
    | 'UNKNOWN'
    | 'NOT_APPLICABLE';

interface KnowledgeContributionSnapshotRow {
    sourceDraftPostId: number | null;
    contributorsRoot?: string | null;
    contributorsCount?: number | null;
}

interface KnowledgeContributorAssessmentRow {
    draftPostId: number;
    proofPackageHash: string | null;
    algorithmVersion: string;
    status: string;
    highPenetrationState: string;
    canonicalContributorsRoot: string | null;
    canonicalContributorsCount: number | null;
}

interface KnowledgeContributorAssessmentProvenance {
    kind: KnowledgeContributorAssessmentKind;
    algorithmVersion: string | null;
    status: string | null;
}

const DEFAULT_UNKNOWN_ASSESSMENT_PROVENANCE: KnowledgeContributorAssessmentProvenance = {
    kind: 'UNKNOWN',
    algorithmVersion: null,
    status: null,
};

function knowledgeContributionSnapshotKey(row: KnowledgeContributionSnapshotRow): string {
    return [
        row.sourceDraftPostId ?? 'none',
        row.contributorsRoot ?? 'none',
        row.contributorsCount ?? 'none',
    ].join(':');
}

function classifyKnowledgeContributorAssessment(
    assessment: KnowledgeContributorAssessmentRow | null | undefined,
): KnowledgeContributorAssessmentProvenance {
    if (!assessment) return DEFAULT_UNKNOWN_ASSESSMENT_PROVENANCE;
    const algorithmVersion = String(assessment.algorithmVersion || '').trim();
    const normalizedAlgorithm = algorithmVersion.toLowerCase();
    const status = String(assessment.status || '').trim();
    const normalizedStatus = status.toLowerCase();
    const normalizedHighPenetrationState = String(assessment.highPenetrationState || '').trim().toLowerCase();

    if (
        normalizedAlgorithm.includes('deterministic-fallback')
        || normalizedAlgorithm.includes('fallback')
        || normalizedAlgorithm.includes('unavailable')
        || normalizedStatus === 'fallback_applied'
        || normalizedHighPenetrationState === 'fallback_applied'
    ) {
        return {
            kind: 'HISTORICAL_FALLBACK',
            algorithmVersion: algorithmVersion || null,
            status: status || null,
        };
    }

    if (normalizedAlgorithm.startsWith('mock:')) {
        return {
            kind: 'MOCK',
            algorithmVersion: algorithmVersion || null,
            status: status || null,
        };
    }

    if (
        normalizedAlgorithm.includes('review-required')
        || normalizedStatus === 'needs_review'
        || normalizedHighPenetrationState === 'needs_review'
    ) {
        return {
            kind: 'UNKNOWN',
            algorithmVersion: algorithmVersion || null,
            status: status || null,
        };
    }

    if (normalizedAlgorithm.startsWith('ai:')) {
        return {
            kind: 'REAL',
            algorithmVersion: algorithmVersion || null,
            status: status || null,
        };
    }

    return {
        kind: 'UNKNOWN',
        algorithmVersion: algorithmVersion || null,
        status: status || null,
    };
}

function contributionAssessmentMatchesSnapshot(input: {
    assessment: KnowledgeContributorAssessmentRow;
    snapshot: KnowledgeContributionSnapshotRow;
    bindingProofPackageHash: string | null;
}): boolean {
    if (input.assessment.draftPostId !== input.snapshot.sourceDraftPostId) return false;
    if (
        input.bindingProofPackageHash
        && input.assessment.proofPackageHash !== input.bindingProofPackageHash
    ) {
        return false;
    }
    if (
        input.snapshot.contributorsRoot
        && input.assessment.canonicalContributorsRoot !== input.snapshot.contributorsRoot
    ) {
        return false;
    }
    if (
        input.snapshot.contributorsCount !== null
        && input.snapshot.contributorsCount !== undefined
        && Number(input.assessment.canonicalContributorsCount) !== Number(input.snapshot.contributorsCount)
    ) {
        return false;
    }
    return true;
}

async function loadKnowledgeContributorAssessmentProvenance(input: {
    prisma: Context['prisma'];
    knowledgePublicId: string | null;
    snapshots: KnowledgeContributionSnapshotRow[];
}): Promise<Map<string, KnowledgeContributorAssessmentProvenance>> {
    const draftPostIds = Array.from(new Set(
        input.snapshots
            .map((row) => row.sourceDraftPostId)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    ));
    const result = new Map<string, KnowledgeContributorAssessmentProvenance>();
    if (draftPostIds.length === 0) return result;

    const prismaAny = input.prisma as any;
    if (typeof prismaAny.contributionAssessment?.findMany !== 'function') {
        return result;
    }

    const binding = input.knowledgePublicId && typeof prismaAny.knowledgeBinding?.findUnique === 'function'
        ? await prismaAny.knowledgeBinding.findUnique({
            where: { knowledgeId: input.knowledgePublicId },
            select: { proofPackageHash: true },
        })
        : null;
    const bindingProofPackageHash = typeof binding?.proofPackageHash === 'string'
        ? binding.proofPackageHash
        : null;

    const assessments = await prismaAny.contributionAssessment.findMany({
        where: { draftPostId: { in: draftPostIds } },
        orderBy: [
            { updatedAt: 'desc' },
            { createdAt: 'desc' },
        ],
        select: {
            draftPostId: true,
            proofPackageHash: true,
            algorithmVersion: true,
            status: true,
            highPenetrationState: true,
            canonicalContributorsRoot: true,
            canonicalContributorsCount: true,
        },
    }) as KnowledgeContributorAssessmentRow[];

    for (const snapshot of input.snapshots) {
        const key = knowledgeContributionSnapshotKey(snapshot);
        if (result.has(key)) continue;
        const assessment = assessments.find((candidate) =>
            contributionAssessmentMatchesSnapshot({
                assessment: candidate,
                snapshot,
                bindingProofPackageHash,
            }));
        result.set(key, classifyKnowledgeContributorAssessment(assessment));
    }

    return result;
}

async function resolveContributorDisplayByPubkey(input: {
    prisma: Context['prisma'];
    circleId: number | null;
    pubkeys: readonly string[];
    locale: Context['locale'];
}): Promise<Map<string, string>> {
    const pubkeys = Array.from(
        new Set(
            input.pubkeys
                .map((pubkey) => String(pubkey || '').trim())
                .filter(Boolean),
        ),
    );

    if (pubkeys.length === 0) return new Map();

    const displays = await resolveCircleActorDisplays({
        prisma: input.prisma,
        actors: pubkeys.map((pubkey) => ({
            displayKey: pubkey,
            pubkey,
            circleId: input.circleId,
        })),
        mode: 'current',
        locale: input.locale || 'en',
        includeTechnicalShortAddress: false,
    });
    const result = new Map<string, string>();

    for (const pubkey of pubkeys) {
        const display = displays.get(pubkey);
        if (!display || display.displaySource === 'generic_member') continue;
        result.set(pubkey, display.effectiveName);
    }

    return result;
}

function emptyCrystalReceiptStats(): {
    totalCount: number;
    mintedCount: number;
    pendingCount: number;
    failedCount: number;
    unknownCount: number;
} {
    return {
        totalCount: 0,
        mintedCount: 0,
        pendingCount: 0,
        failedCount: 0,
        unknownCount: 0,
    };
}

function legacyCrystalCutoverFields(
    row: any,
    kind: 'master' | 'receipt',
): {
    legacyDisposition: 'legacy_auto_issued' | 'legacy_claimed' | 'legacy_unsettled' | 'legacy_demo';
    cutoverReadOnly: true;
} {
    const address = kind === 'master' ? row?.masterAssetAddress : row?.receiptAssetAddress;
    const standard = String(row?.assetStandard || '').trim().toLowerCase();
    const normalizedAddress = String(address || '').trim().toLowerCase();
    const isDemo = standard.startsWith('mock_') || normalizedAddress.startsWith('mock_');
    const isMinted = String(row?.mintStatus || '').trim().toLowerCase() === 'minted'
        && normalizedAddress.length > 0;
    return {
        legacyDisposition: isDemo
            ? 'legacy_demo'
            : isMinted
                ? kind === 'master' ? 'legacy_auto_issued' : 'legacy_claimed'
                : 'legacy_unsettled',
        cutoverReadOnly: true,
    };
}

function projectLegacyCrystalAsset(row: any, kind: 'master' | 'receipt') {
    return row ? { ...row, ...legacyCrystalCutoverFields(row, kind) } : null;
}

function summarizeCrystalReceiptStatusBuckets(rows: Array<{
    mintStatus?: string | null;
    _count?: { _all?: number | null } | number | null;
}>): ReturnType<typeof emptyCrystalReceiptStats> {
    return rows.reduce(
        (acc, row) => {
            const count = typeof row._count === 'number'
                ? row._count
                : Number(row._count?._all ?? 0);
            if (!Number.isFinite(count) || count <= 0) return acc;
            acc.totalCount += count;
            const status = String(row.mintStatus || '').trim().toLowerCase();
            if (status === 'minted') {
                acc.mintedCount += count;
            } else if (status === 'pending') {
                acc.pendingCount += count;
            } else if (status === 'failed') {
                acc.failedCount += count;
            } else {
                acc.unknownCount += count;
            }
            return acc;
        },
        emptyCrystalReceiptStats(),
    );
}

async function loadAgentDirectoryByPubkey(
    prisma: Context['prisma'],
    input: {
        circleId?: number | null;
        pubkeys: string[];
    },
): Promise<Map<string, { handle: string | null }>> {
    const rows = await loadCircleAgentsByPubkeys(prisma as any, {
        circleId: input.circleId ?? null,
        pubkeys: input.pubkeys,
    });
    return new Map(
        rows.map((row: { agentPubkey: string; handle: string | null }) => [
            row.agentPubkey,
            { handle: row.handle ?? null },
        ]),
    );
}

function stringifyCachePayload(value: unknown): string {
    return JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue);
}

function buildMemberActivityText(input: { kind: 'post' | 'draft' | 'crystal'; locale: Context['locale'] }): string {
    if (input.kind === 'draft') return localizeQueryApiCopy('graphql.activity.draft', input.locale);
    if (input.kind === 'crystal') return localizeQueryApiCopy('graphql.activity.crystal', input.locale);
    return localizeQueryApiCopy('graphql.activity.post', input.locale);
}

function normalizeNumericScore(value: Prisma.Decimal | number | string | null | undefined, fallback = 0): number {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        const parsed = (value as { toNumber: () => number }).toNumber();
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}

async function attachSourceDraftHeat<T extends { sourceContentId?: string | null }>(
    prisma: Context['prisma'],
    rows: T[],
): Promise<Array<T & { sourceDraftHeatScore: number }>> {
    const sourceContentIds = Array.from(
        new Set(
            rows
                .map((row) => row.sourceContentId)
                .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
    );

    if (sourceContentIds.length === 0) {
        return rows.map((row) => ({ ...row, sourceDraftHeatScore: 0 }));
    }

    const sourcePosts = await prisma.post.findMany({
        where: {
            contentId: { in: sourceContentIds },
        },
        select: {
            contentId: true,
            heatScore: true,
        },
    });
    const heatByContentId = new Map(
        sourcePosts.map((post) => [post.contentId, Number(post.heatScore ?? 0)]),
    );

    return rows.map((row) => ({
        ...row,
        sourceDraftHeatScore: heatByContentId.get(row.sourceContentId || '') ?? 0,
    }));
}

function buildCrystallizationOutputSummary(
    record: CrystallizationOutputSummaryRecord | null | undefined,
    locale: Context['locale'],
) {
    if (!record) return null;
    return {
        sourceDraftPostId: record.sourceDraftPostId,
        sourceDraftVersion: record.sourceDraftVersion,
        sourceDraftVersionLabel: formatSourceDraftVersionLabel(record.sourceDraftVersion, locale),
        sourceAnchorId: record.sourceAnchorId,
        sourceSummaryHash: record.sourceSummaryHash,
        sourceMessagesDigest: record.sourceMessagesDigest,
    };
}

async function attachKnowledgeListReadModelFields<T extends {
    knowledgeId?: string | null;
    sourceContentId?: string | null;
}>(
    prisma: Context['prisma'],
    rows: T[],
    locale: Context['locale'],
): Promise<Array<T & {
    sourceDraftHeatScore: number;
    relationshipAssignment: Awaited<ReturnType<typeof resolveKnowledgeRelationshipAssignment>>;
    crystallizationOutput: ReturnType<typeof buildCrystallizationOutputSummary>;
}>> {
    const withHeat = await attachSourceDraftHeat(prisma, rows);
    const knowledgeIds = Array.from(
        new Set(
            withHeat
                .map((row) => row.knowledgeId)
                .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
    );

    if (knowledgeIds.length === 0) {
        return withHeat.map((row) => ({
            ...row,
            relationshipAssignment: null as any,
            crystallizationOutput: null,
        }));
    }

    const [assignmentsByKnowledgeId, outputsByKnowledgeId] = await Promise.all([
        resolveKnowledgeRelationshipAssignmentsForKnowledgeIds(prisma, knowledgeIds, {
            locale,
            includeInactiveAssignedLabel: true,
        }),
        loadCrystallizationOutputRecordsByKnowledgeIds(prisma, knowledgeIds),
    ]);

    return withHeat.map((row) => ({
        ...row,
        relationshipAssignment: row.knowledgeId
            ? assignmentsByKnowledgeId.get(row.knowledgeId) ?? null as any
            : null as any,
        crystallizationOutput: row.knowledgeId
            ? buildCrystallizationOutputSummary(outputsByKnowledgeId.get(row.knowledgeId), locale)
            : null,
    }));
}

async function attachProjectedCircleSettings<T extends {
    id: number;
    joinRequirement: string;
    circleType: string;
    minCrystals: number;
}>(
    prisma: Context['prisma'],
    circles: T[],
): Promise<Array<T & { __projectedCircleSettings?: Awaited<ReturnType<typeof resolveProjectedCircleSettings>> }>> {
    return Promise.all(circles.map(async (circle) => ({
        ...circle,
        __projectedCircleSettings: await resolveProjectedCircleSettings(prisma as any, circle as any),
    })));
}

type KnowledgeLineageDirection = 'outbound' | 'inbound';

type KnowledgeLineageLink = {
    knowledgeId: string;
    onChainAddress: string;
    title: string;
    circleId: number;
    circleName: string;
    heatScore: number;
    citationCount: number;
    createdAt: Date;
};

type KnowledgeBindingProjectionRow = {
    knowledgeId: string;
    sourceAnchorId: string;
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    generatedAt: Date;
    boundAt: Date;
    boundBy: string;
    createdAt: Date;
    updatedAt: Date;
};

function mapKnowledgeBindingProjection(
    row: KnowledgeBindingProjectionRow | null | undefined,
): KnowledgeBindingProjectionRow | null {
    if (!row) return null;
    return {
        knowledgeId: row.knowledgeId,
        sourceAnchorId: row.sourceAnchorId,
        proofPackageHash: row.proofPackageHash,
        contributorsRoot: row.contributorsRoot,
        contributorsCount: Number(row.contributorsCount ?? 0),
        bindingVersion: Number(row.bindingVersion ?? 0),
        generatedAt: row.generatedAt,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

async function resolveKnowledgeBindingProjection(
    prisma: Context['prisma'],
    knowledgeId: string,
): Promise<KnowledgeBindingProjectionRow | null> {
    const normalizedKnowledgeId = String(knowledgeId || '').trim();
    if (!normalizedKnowledgeId) return null;

    const rows = await prisma.$queryRaw<KnowledgeBindingProjectionRow[]>(Prisma.sql`
        SELECT
            knowledge_id AS "knowledgeId",
            source_anchor_id AS "sourceAnchorId",
            proof_package_hash AS "proofPackageHash",
            contributors_root AS "contributorsRoot",
            contributors_count AS "contributorsCount",
            binding_version AS "bindingVersion",
            generated_at AS "generatedAt",
            bound_at AS "boundAt",
            bound_by AS "boundBy",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM knowledge_binding
        WHERE knowledge_id = ${normalizedKnowledgeId}
        LIMIT 1
    `);

    return mapKnowledgeBindingProjection(rows[0]);
}

async function resolveKnowledgeLineageLinks(
    prisma: Context['prisma'],
    knowledgeId: string,
    direction: KnowledgeLineageDirection,
    limit: number,
): Promise<KnowledgeLineageLink[]> {
    const resolvedLimit = Math.max(1, Math.min(limit ?? 8, 50));
    const references = await prisma.knowledgeReference.findMany({
        where: direction === 'outbound'
            ? { sourceKnowledgeId: knowledgeId }
            : { targetKnowledgeId: knowledgeId },
        orderBy: { createdAt: 'desc' },
        take: resolvedLimit,
    });
    if (references.length === 0) return [];

    const linkedKnowledgeIds = references.map((row) => (
        direction === 'outbound' ? row.targetKnowledgeId : row.sourceKnowledgeId
    ));
    const linkedKnowledgeRows = await prisma.knowledge.findMany({
        where: { knowledgeId: { in: linkedKnowledgeIds } },
        select: {
            knowledgeId: true,
            onChainAddress: true,
            title: true,
            createdAt: true,
            citationCount: true,
            heatScore: true,
            circle: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
    const rowByKnowledgeId = new Map(
        linkedKnowledgeRows.map((row) => [row.knowledgeId, row]),
    );

    const dedupedOrder = Array.from(new Set(linkedKnowledgeIds));
    return dedupedOrder
        .map((id) => rowByKnowledgeId.get(id))
        .filter((row): row is NonNullable<typeof row> => !!row)
        .map((row) => ({
            knowledgeId: row.knowledgeId,
            onChainAddress: row.onChainAddress,
            title: row.title,
            circleId: row.circle.id,
            circleName: row.circle.name,
            heatScore: Number(row.heatScore ?? 0),
            citationCount: row.citationCount,
            createdAt: row.createdAt,
        }));
}

interface PublicFlowRow {
    kind: 'Discussion' | 'Crystal';
    sourceId: string;
    title: string;
    excerpt: string;
    circleId: number;
    circleName: string;
    circleLevel: number;
    authorHandle: string | null;
    authorPubkey: string | null;
    score: Prisma.Decimal | number | string | null;
    featuredReason: string | null;
    createdAt: Date;
}

export const resolvers = {
    DateTime: dateTimeScalar,
    BigInt: bigIntScalar,
    JSON: jsonScalar,

    Query: {
        user: async (_: any, { handle }: { handle: string }, { prisma, cache }: Context) => {
            const cacheKey = `user:${handle}`;
            const cached = await cache.get(cacheKey);

            if (cached) {
                return JSON.parse(cached);
            }

            const user = await prisma.user.findUnique({
                where: { handle },
            });

            if (user) {
                await cache.setex(cacheKey, 300, stringifyCachePayload(user)); // 5分钟缓存
            }

            return user;
        },

        me: async (_: any, __: any, { prisma, userId }: Context) => {
            if (!userId) return null;
            return await prisma.user.findUnique({ where: { id: userId } });
        },

        users: async (_: any, { handles }: { handles: string[] }, { prisma }: Context) => {
            return await prisma.user.findMany({
                where: {
                    handle: { in: handles },
                },
            });
        },

        post: async (_: any, { contentId }: { contentId: string }, { prisma, cache }: Context) => {
            const cacheKey = `post:${contentId}`;
            const cached = await cache.get(cacheKey);

            if (cached) {
                return JSON.parse(cached);
            }

            const postByContentId = await prisma.post.findUnique({
                where: { contentId },
                include: {
                    author: true,
                },
            });
            const post = postByContentId || await prisma.post.findFirst({
                where: { onChainAddress: contentId },
                include: {
                    author: true,
                },
            });
            if (post?.safetyQuarantined === true) return null;

            if (post) {
                const cachePayload = stringifyCachePayload(post);
                const cacheKeys = Array.from(new Set([cacheKey, `post:${post.contentId}`]));
                await Promise.all(
                    cacheKeys.map((key) => cache.setex(key, 3600, cachePayload)),
                );
            }

            return post;
        },

        posts: async (_: any, { contentIds }: { contentIds: string[] }, { prisma }: Context) => {
            const normalizedContentIds = Array.from(
                new Set(
                    (contentIds || [])
                        .map((value) => String(value || '').trim())
                        .filter((value) => value.length > 0),
                ),
            );
            if (normalizedContentIds.length === 0) return [];

            return await prisma.post.findMany({
                where: {
                    safetyQuarantined: false,
                    OR: [
                        { contentId: { in: normalizedContentIds } },
                        { onChainAddress: { in: normalizedContentIds } },
                    ],
                },
                include: {
                    author: true,
                },
            });
        },

        feed: async (_: any, { limit, offset, filter }: { limit: number; offset: number; filter: FeedFilter }, { prisma }: Context) => {
            const where: any = {
                status: { in: ['Active', 'Published'] as any[] },
                visibility: 'Public',
                safetyQuarantined: false,
            };

            if (filter === FeedFilter.VERIFIED_ONLY) {
                Object.assign(where, verifiedUserFilter);
            }

            return await prisma.post.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: [{ downranked: 'asc' }, { createdAt: 'desc' }],
                include: {
                    author: true,
                },
            });
        },

        followingFlow: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId, locale }: Context,
        ) => {
            if (!userId) return [];
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            const resolvedOffset = Math.max(0, offset ?? 0);

            const follows = await prisma.follow.findMany({
                where: { followerId: userId },
                select: { followingId: true },
                take: 5000,
            });
            const followingIds = follows.map((f) => f.followingId);
            if (followingIds.length === 0) return [];

            return prisma.post.findMany({
                where: {
                    authorId: { in: followingIds },
                    status: { in: ['Active', 'Published'] as any[] },
                    safetyQuarantined: false,
                    OR: [
                        { visibility: 'Public' as any },
                        { visibility: 'FollowersOnly' as any },
                        {
                            visibility: 'CircleOnly' as any,
                            circle: {
                                members: {
                                    some: {
                                        userId,
                                        status: 'Active',
                                    },
                                },
                            },
                        },
                    ],
                },
                take: resolvedLimit,
                skip: resolvedOffset,
                orderBy: [{ downranked: 'asc' }, { createdAt: 'desc' }],
                include: {
                    author: true,
                },
            });
        },

        publicFlow: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, locale }: Context,
        ) => {
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 50));
            const resolvedOffset = Math.max(0, offset ?? 0);
            const rows = await prisma.$queryRaw<PublicFlowRow[]>(Prisma.sql`
                SELECT *
                FROM (
                    SELECT
                        'Discussion'::text AS "kind",
                        m.envelope_id AS "sourceId",
                        LEFT(m.payload_text, 72) AS "title",
                        LEFT(m.payload_text, 180) AS "excerpt",
                        c.id AS "circleId",
                        c.name AS "circleName",
                        c.level AS "circleLevel",
                        m.sender_handle AS "authorHandle",
                        m.sender_pubkey AS "authorPubkey",
                        COALESCE(m.semantic_score, m.relevance_score, 0.0) AS "score",
                        m.feature_reason AS "featuredReason",
                        COALESCE(m.featured_at, m.created_at) AS "createdAt"
                    FROM circle_discussion_messages m
                    INNER JOIN circles c ON c.id = m.circle_id
                    WHERE c.level = 0
                      AND c.kind = 'main'
                      AND m.deleted = FALSE
                      AND m.is_featured = TRUE

                    UNION ALL

                    SELECT
                        'Crystal'::text AS "kind",
                        k.knowledge_id AS "sourceId",
                        LEFT(k.title, 72) AS "title",
                        LEFT(COALESCE(k.description, k.title), 180) AS "excerpt",
                        c.id AS "circleId",
                        c.name AS "circleName",
                        c.level AS "circleLevel",
                        u.handle AS "authorHandle",
                        u.pubkey AS "authorPubkey",
                        k.quality_score AS "score",
                        'knowledge_crystal'::text AS "featuredReason",
                        k.created_at AS "createdAt"
                    FROM knowledge k
                    INNER JOIN circles c ON c.id = k.circle_id
                    INNER JOIN users u ON u.id = k.author_id
                    WHERE c.level = 0
                      AND c.kind = 'main'
                ) public_flow
                ORDER BY "createdAt" DESC, "kind" ASC, "sourceId" DESC
                OFFSET ${resolvedOffset}
                LIMIT ${resolvedLimit}
            `);
            const displays = await resolveCircleActorDisplays({
                prisma: prisma as any,
                actors: rows.map((row) => ({
                    displayKey: `public-flow:${row.kind}:${row.sourceId}:author`,
                    pubkey: row.authorPubkey,
                    circleId: row.circleId,
                })),
                mode: 'current',
                locale,
            });

            return rows.map((row) => ({
                id: `${row.kind.toLowerCase()}:${row.sourceId}`,
                kind: row.kind,
                sourceId: row.sourceId,
                title: row.title || (row.kind === 'Discussion'
                    ? localizeQueryApiCopy('graphql.publicFlow.discussionTitle', locale)
                    : localizeQueryApiCopy('graphql.publicFlow.crystalTitle', locale)),
                excerpt: row.excerpt || row.title || '',
                circleId: row.circleId,
                circleName: row.circleName,
                circleLevel: row.circleLevel,
                authorHandle: displays.get(`public-flow:${row.kind}:${row.sourceId}:author`)?.effectiveName
                    || row.authorHandle
                    || localizeQueryApiCopy('identity.genericMember', locale),
                authorPubkey: row.authorPubkey,
                score: Math.max(0, Math.min(1, normalizeNumericScore(row.score, row.kind === 'Discussion' ? 0.6 : 0.7))),
                featuredReason: row.featuredReason || (row.kind === 'Discussion' ? 'ai_discussion_featured' : 'knowledge_crystal'),
                createdAt: row.createdAt,
            }));
        },

        trending: async (
            _: any,
            { timeRange, limit }: { timeRange: string; limit: number },
            { prisma }: Context
        ) => {
            const now = new Date();
            const timeMap = {
                HOUR: 60 * 60 * 1000,
                DAY: 24 * 60 * 60 * 1000,
                WEEK: 7 * 24 * 60 * 60 * 1000,
                MONTH: 30 * 24 * 60 * 60 * 1000,
            };

            const since = new Date(now.getTime() - timeMap[timeRange as keyof typeof timeMap]);

            return await prisma.post.findMany({
                where: {
                    status: { in: ['Active', 'Published'] as any[] },
                    visibility: 'Public',
                    safetyQuarantined: false,
                    createdAt: { gte: since },
                },
                take: limit,
                orderBy: [
                    { likesCount: 'desc' },
                    { repostsCount: 'desc' },
                ],
                include: {
                    author: true,
                },
            });
        },

        circle: async (_: any, { id }: { id: number }, { prisma }: Context) => {
            const circle = await prisma.circle.findUnique({
                where: { id },
                include: {
                    creator: true,
                },
            });
            if (!circle) return null;
            const [projected] = await attachProjectedCircleSettings(prisma, [circle as any]);
            return projected;
        },

        circleDescendants: async (
            _: any,
            { rootId }: { rootId: number },
            { prisma }: Context,
        ) => {
            const descendants: any[] = [];
            const seen = new Set<number>([rootId]);
            let frontier = [rootId];

            while (frontier.length > 0) {
                const children = await prisma.circle.findMany({
                    where: {
                        parentCircleId: { in: frontier },
                        lifecycleStatus: 'Active',
                    },
                    orderBy: { createdAt: 'desc' },
                    include: { creator: true },
                });

                frontier = [];
                for (const child of children) {
                    if (seen.has(child.id)) {
                        continue;
                    }
                    seen.add(child.id);
                    descendants.push(child);
                    frontier.push(child.id);
                }
            }

            return descendants;
        },

        circles: async (_: any, { ids }: { ids: number[] }, { prisma }: Context) => {
            const circles = await prisma.circle.findMany({
                where: {
                    id: { in: ids },
                },
                include: {
                    creator: true,
                },
            });
            return attachProjectedCircleSettings(prisma, circles as any);
        },

        searchUsers: async (_: any, { query, limit }: { query: string; limit: number }, { prisma }: Context) => {
            return await prisma.user.findMany({
                where: {
                    OR: [
                        { handle: { contains: query, mode: 'insensitive' } },
                        { displayName: { contains: query, mode: 'insensitive' } },
                    ],
                },
                take: limit,
            });
        },

        searchPosts: async (
            _: any,
            { query, tags, limit }: { query: string; tags?: string[]; limit: number },
            { prisma }: Context
        ) => {
            const where: any = {
                status: { in: ['Active', 'Published'] as any[] },
                visibility: 'Public',
                safetyQuarantined: false,
            };

            if (query) {
                where.text = { contains: query, mode: 'insensitive' };
            }

            if (tags && tags.length > 0) {
                where.tags = { hasSome: tags };
            }

            return await prisma.post.findMany({
                where,
                take: limit,
                orderBy: [{ downranked: 'asc' }, { createdAt: 'desc' }],
                include: {
                    author: true,
                },
            });
        },

        allCircles: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma }: Context,
        ) => {
            const circles = await prisma.circle.findMany({
                where: {
                    lifecycleStatus: 'Active',
                },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: { creator: true },
            });
            return attachProjectedCircleSettings(prisma, circles as any);
        },

        searchCircles: async (
            _: any,
            { query, limit }: { query: string; limit: number },
            { prisma }: Context,
        ) => {
            const circles = await prisma.circle.findMany({
                where: {
                    lifecycleStatus: 'Active',
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { description: { contains: query, mode: 'insensitive' } },
                    ],
                },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { creator: true },
            });
            return attachProjectedCircleSettings(prisma, circles as any);
        },

        myDrafts: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId }: Context
        ) => {
            if (!userId) {
                throw new Error('Authentication required');
            }
            return await prisma.post.findMany({
                where: {
                    authorId: userId,
                    status: 'Draft' as any,
                },
                take: limit,
                skip: offset,
                orderBy: { updatedAt: 'desc' },
                include: {
                    author: true,
                },
            });
        },

        myCircles: async (
            _: any,
            __: any,
            { prisma, userId }: Context,
        ) => {
            if (!userId) return [];
            const memberships = await prisma.circleMember.findMany({
                where: {
                    userId,
                    status: 'Active',
                },
                include: { circle: true },
            });
            return attachProjectedCircleSettings(prisma, memberships.map(m => m.circle) as any);
        },

        knowledge: async (_: any, { knowledgeId }: { knowledgeId: string }, context: Context) => {
            const { prisma, locale } = context;
            const row = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                include: { author: true, circle: true, sourceCircle: true },
            });
            if (!row) return null;
            if (!await canReadKnowledgeRecord(context, row)) return null;
            const [decorated] = await attachKnowledgeListReadModelFields(prisma, [row], locale);
            return decorated;
        },

        knowledgeByOnChainAddress: async (
            _: any,
            { onChainAddress }: { onChainAddress: string },
            context: Context,
        ) => {
            const { prisma, locale } = context;
            const row = await prisma.knowledge.findUnique({
                where: { onChainAddress },
                include: { author: true, circle: true, sourceCircle: true },
            });
            if (!row) return null;
            if (!await canReadKnowledgeRecord(context, row)) return null;
            const [decorated] = await attachKnowledgeListReadModelFields(prisma, [row], locale);
            return decorated;
        },

        // ── 用户通知 ──
        myNotifications: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId, locale }: Context,
        ) => {
            if (!userId) return [];
            const notifications = await prisma.notification.findMany({
                where: { userId },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
            });

            const circleIds = Array.from(
                new Set(
                    notifications
                        .map((notification) => notification.circleId)
                        .filter((circleId): circleId is number => typeof circleId === 'number'),
                ),
            );

            const [circleNameById, governanceStatusByCaseId] = await Promise.all([
                circleIds.length > 0
                    ? prisma.circle.findMany({
                            where: { id: { in: circleIds } },
                            select: { id: true, name: true },
                        })
                    : Promise.resolve([]),
                loadGovernanceNotificationStatuses(prisma, notifications),
            ]).then(([circles, statuses]) => [
                new Map(circles.map((circle) => [circle.id, circle.name])),
                statuses,
            ] as const);

            return notifications.map((notification) => {
                const localized = localizeNotification(notification, {
                    locale,
                    circleName: notification.circleId ? circleNameById.get(notification.circleId) ?? null : null,
                });

                return {
                    ...notification,
                    displayTitle: localized.displayTitle,
                    displayBody: localized.displayBody,
                    canonicalUrl: resolveNotificationCanonicalUrl(notification),
                    decisionStatus: notification.sourceType === 'governance_case'
                        ? governanceStatusByCaseId.get(String(notification.sourceId))?.decisionStatus ?? null
                        : null,
                    executionStatus: notification.sourceType === 'governance_case'
                        ? governanceStatusByCaseId.get(String(notification.sourceId))?.executionStatus ?? null
                        : null,
                    governanceRecovery: notification.sourceType === 'governance_case'
                        ? governanceStatusByCaseId.get(String(notification.sourceId))?.governanceRecovery ?? null
                        : null,
                };
            });
        },

        // ── 草稿批注 ──
        draftComments: async (
            _: any,
            { postId, limit }: { postId: number; limit: number },
            context: Context,
        ) => {
            const { prisma } = context;
            const actor = await resolveGraphqlActor(context);
            if (!actor) return [];
            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId,
                action: 'read',
            });
            if (!access.allowed) return [];

            return await prisma.draftComment.findMany({
                where: { postId },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { user: true },
            });
        },

        // ── 圈层草稿概览 ──
        circleDrafts: async (
            _: any,
            { circleId, limit, offset }: { circleId: number; limit: number; offset: number },
            context: Context,
        ) => {
            const { prisma } = context;
            const actor = await resolveGraphqlActor(context);
            if (!actor) return [];
            const activeMember = await canAccessCircleForGraphqlActor(prisma, actor, circleId);
            if (!activeMember) return [];

            const drafts = await prisma.post.findMany({
                where: {
                    circleId,
                    status: 'Draft' as any,
                },
                take: limit,
                skip: offset,
                orderBy: { updatedAt: 'desc' },
                include: {
                    _count: { select: { draftComments: true } },
                },
            });
            const draftIds = drafts.map((draft: any) => draft.id);
            const workflowStates = draftIds.length > 0
                ? await prisma.draftWorkflowState.findMany({
                    where: { draftPostId: { in: draftIds } },
                    select: { draftPostId: true, documentStatus: true, updatedAt: true },
                })
                : [];
            const workflowStateByDraftId = new Map<number, {documentStatus: string; updatedAt: Date}>(
                workflowStates.map((state: any) => [
                    Number(state.draftPostId),
                    {
                        documentStatus: String(state.documentStatus || 'drafting'),
                        updatedAt: new Date(state.updatedAt),
                    },
                ]),
            );

            const now = Date.now();
            return drafts.map((d: any) => {
                const workflowState = workflowStateByDraftId.get(d.id);
                const documentStatus = workflowState?.documentStatus || 'drafting';
                const postUpdatedAt = new Date(d.updatedAt);
                const workflowUpdatedAt = workflowState?.updatedAt;
                const lastActivityAt = workflowUpdatedAt && workflowUpdatedAt.getTime() > postUpdatedAt.getTime()
                    ? workflowUpdatedAt
                    : postUpdatedAt;

                return {
                    postId: d.id,
                    title: resolveDraftTitle({
                        draftTitle: d.draftTitle,
                        text: d.text,
                        draftPostId: Number(d.id),
                    }),
                    excerpt: d.text?.slice(0, 200),
                    heatScore: Number(d.heatScore ?? 0),
                    status: d.status,
                    documentStatus,
                    publicBlockerCode: documentStatus === 'crystallization_failed'
                        ? 'crystallization_failed'
                        : null,
                    commentCount: d._count?.draftComments ?? 0,
                    ageDays: Math.floor((now - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
                    lastActivityAt,
                    createdAt: d.createdAt,
                    updatedAt: d.updatedAt,
                };
            });
        },

        // ── 圈层成员资料 ──
        memberProfile: async (
            _: any,
            { circleId, userId }: { circleId: number; userId: number },
            context: Context,
        ) => {
            const { prisma, locale } = context;
            const viewer = await resolveGraphqlActor(context);
            if (!viewer) return null;
            const viewerUserId = viewer.userId;

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: { creatorId: true },
            });
            if (!circle) return null;

            const allowed = await canAccessCircleForGraphqlActor(prisma, viewer, circleId);
            if (!allowed) return null;

            const membership = await prisma.circleMember.findFirst({
                where: {
                    circleId,
                    userId,
                    status: MemberStatus.Active,
                },
                include: { user: true },
            });
            if (!membership) return null;

            const isSelf = viewerUserId === userId;
            const followModel = (prisma as any).follow;
            const viewerFollowPromise = !isSelf && followModel?.findFirst
                ? followModel.findFirst({
                    where: {
                        followerId: viewerUserId,
                        followingId: userId,
                    },
                    select: { followerId: true },
                })
                : Promise.resolve(null);

            const [
                knowledgeStats,
                circleCount,
                viewerCircleMemberships,
                targetCircleMemberships,
                recentPosts,
                recentKnowledge,
                viewerFollow,
            ] = await Promise.all([
                prisma.knowledge.aggregate({
                    where: { authorId: userId, circleId },
                    _count: true,
                    _sum: { citationCount: true },
                }),
                prisma.circleMember.count({
                    where: {
                        userId,
                        status: MemberStatus.Active,
                    },
                }),
                prisma.circleMember.findMany({
                    where: {
                        userId: viewerUserId,
                        status: MemberStatus.Active,
                    },
                    select: { circleId: true },
                }),
                prisma.circleMember.findMany({
                    where: {
                        userId,
                        status: MemberStatus.Active,
                    },
                    select: { circleId: true },
                }),
                prisma.post.findMany({
                    where: {
                        authorId: userId,
                        circleId,
                        status: {
                            in: ['Active', 'Published', 'Draft'] as any,
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        status: true,
                        createdAt: true,
                    },
                }),
                prisma.knowledge.findMany({
                    where: {
                        authorId: userId,
                        circleId,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        createdAt: true,
                    },
                }),
                viewerFollowPromise,
            ]);

            const viewerCircleIds = new Set(viewerCircleMemberships.map((row: { circleId: number }) => row.circleId));
            if (circle.creatorId === viewerUserId) {
                viewerCircleIds.add(circleId);
            }
            const sharedCircleIds = targetCircleMemberships
                .map((row: { circleId: number }) => row.circleId)
                .filter((candidate: number) => viewerCircleIds.has(candidate));

            const sharedCircles = sharedCircleIds.length === 0
                ? []
                : await prisma.circle.findMany({
                    where: {
                        id: { in: sharedCircleIds },
                    },
                    orderBy: [
                        { level: 'asc' },
                        { name: 'asc' },
                    ],
                    take: 6,
                    select: {
                        id: true,
                        name: true,
                        kind: true,
                        level: true,
                    },
                });
            const ownedCrystalCount = await resolveOwnedCrystalCount(prisma as any, {
                ownerPubkey: membership.user.pubkey,
                circleId,
            });

            const recentActivity = [
                ...recentPosts.map((post: { status: string; createdAt: Date }) => ({
                    type: String(post.status) === 'Draft' ? 'draft' : 'post',
                    text: buildMemberActivityText({
                        kind: String(post.status) === 'Draft' ? 'draft' : 'post',
                        locale,
                    }),
                    createdAt: post.createdAt,
                })),
                ...recentKnowledge.map((knowledge: { createdAt: Date }) => ({
                    type: 'crystal',
                    text: buildMemberActivityText({ kind: 'crystal', locale }),
                    createdAt: knowledge.createdAt,
                })),
            ]
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, 5);

            return {
                user: membership.user,
                viewerFollows: Boolean(viewerFollow),
                isSelf,
                role: membership.role,
                joinedAt: membership.joinedAt,
                knowledgeCount: knowledgeStats._count,
                ownedCrystalCount,
                totalCitations: knowledgeStats._sum?.citationCount ?? 0,
                circleCount,
                sharedCircles,
                recentActivity,
            };
        },

        knowledgeByCircle: async (
            _: any,
            { circleId, limit, offset }: { circleId: number; limit: number; offset: number },
            context: Context,
        ) => {
            const { prisma, locale } = context;
            const actor = await resolveGraphqlActor(context);
            const canReadRestricted = actor
                ? await canAccessCircleForGraphqlActor(prisma, actor, circleId)
                : false;
            const candidateRows = await prisma.knowledge.findMany({
                where: {
                    circleId,
                    ...(canReadRestricted ? {} : { publicationState: 'published' }),
                },
                ...(canReadRestricted ? { take: limit, skip: offset } : {}),
                orderBy: { qualityScore: 'desc' },
                include: { author: true, circle: true },
            });
            const rows = canReadRestricted
                ? candidateRows
                : (await Promise.all(candidateRows.map(async (knowledge) => ({
                    knowledge,
                    readable: await isKnowledgePublicationPubliclyReadable({ prisma, knowledge }),
                }))))
                    .filter((entry) => entry.readable)
                    .map((entry) => entry.knowledge)
                    .slice(offset, offset + limit);
            return await attachKnowledgeListReadModelFields(prisma, rows, locale);
        },

        myKnowledge: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId, locale }: Context,
        ) => {
            if (!userId) return [];
            const rows = await prisma.knowledge.findMany({
                where: { authorId: userId },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: { author: true, circle: true },
            });
            return await attachKnowledgeListReadModelFields(prisma, rows, locale);
        },

        knowledgeRelationshipLabels: async (
            _: any,
            { status }: { status?: string | null },
            { prisma, locale }: Context,
        ) => listKnowledgeRelationshipLabels(prisma, { status, locale }),

        knowledgeBinding: async (
            _: any,
            { knowledgeId }: { knowledgeId: string },
            context: Context,
        ) => {
            const { prisma } = context;
            const knowledge = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                select: {
                    knowledgeId: true,
                    version: true,
                    publicationState: true,
                    publicationLicenseRef: true,
                    publicationLicenseVersion: true,
                    publicationLicenseDigest: true,
                    publicationSourceSnapshotDigest: true,
                    stablePublicPath: true,
                    authorId: true,
                    circleId: true,
                },
            });
            if (!knowledge || !await canReadKnowledgeRecord(context, knowledge)) return null;
            return resolveKnowledgeBindingProjection(prisma, knowledgeId);
        },
    },

    User: {
        stats: (user: any) => ({
            followers: user.followersCount,
            following: user.followingCount,
            posts: user.postsCount,
            circles: user.circlesCount,
        }),

        totem: async (user: any, _: any, { prisma }: Context) => {
            const row = await prisma.userTotem.findUnique({
                where: { userId: user.id },
            });
            if (!row) {
                return {
                    stage: 'seed',
                    crystalCount: 0,
                    citationCount: 0,
                    circleCount: 0,
                    dustFactor: 0,
                    lastActiveAt: user.createdAt,
                };
            }
            const daysSinceActive = (Date.now() - new Date(row.lastActiveAt).getTime()) / 86400000;
            return {
                stage: row.stage,
                crystalCount: row.crystalCount,
                citationCount: row.citationCount,
                circleCount: row.circleCount,
                dustFactor: Math.min(1, daysSinceActive / 90),
                lastActiveAt: row.lastActiveAt,
            };
        },

        posts: async (user: any, { limit, offset }: any, { prisma }: Context) => {
            return await prisma.post.findMany({
                where: { authorId: user.id, safetyQuarantined: false },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
            });
        },

        followers: async (user: any, { limit }: any, { prisma }: Context) => {
            const follows = await prisma.follow.findMany({
                where: { followingId: user.id },
                take: limit,
                include: { follower: true },
            });
            return follows.map((f: any) => f.follower);
        },

        following: async (user: any, { limit }: any, { prisma }: Context) => {
            const follows = await prisma.follow.findMany({
                where: { followerId: user.id },
                take: limit,
                include: { following: true },
            });
            return follows.map((f: any) => f.following);
        },

        profile: async (user: any, _: any, { prisma, userId }: Context) => {
            const knowledge = await prisma.knowledge.aggregate({
                where: { authorId: user.id },
                _count: true,
                _sum: { citationCount: true, viewCount: true },
                _avg: { qualityScore: true },
            });

            const recentActivity = await prisma.post.count({
                where: {
                    authorId: user.id,
                    createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
            });

            const unreadNotifications = userId === user.id
                ? await prisma.notification.count({
                    where: { userId: user.id, read: false },
                })
                : 0;

            return {
                knowledgeCount: knowledge._count,
                totalCitations: knowledge._sum?.citationCount ?? 0,
                totalViews: knowledge._sum?.viewCount ?? 0,
                averageQuality: parseFloat(String(knowledge._avg?.qualityScore ?? 0)),
                recentActivity,
                unreadNotifications,
            };
        },
    },

    Post: {
        v2VisibilityLevel: (post: any) => {
            const raw = String(post?.v2VisibilityLevel || '').trim();
            if (raw) return raw;
            const normalized = String(post?.visibility || '').trim();
            return normalized || 'Public';
        },

        v2AudienceKind: (post: any) => {
            const raw = String(post?.v2AudienceKind || '').trim();
            if (raw) return raw;
            const normalized = String(post?.v2VisibilityLevel || post?.visibility || '').trim();
            return normalized || null;
        },

        v2AudienceRef: (post: any) => {
            if (Number.isFinite(post?.v2AudienceRef)) {
                return post.v2AudienceRef;
            }
            if (Number.isFinite(post?.protocolCircleId)) {
                return post.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.protocolCircleId)) {
                return post.circle.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.id)) {
                return post.circle.id;
            }
            return null;
        },

        v2Status: (post: any) => {
            const raw = String(post?.v2Status || '').trim();
            if (raw) return raw;
            const normalized = String(post?.status || '').trim();
            return normalized || 'Published';
        },

        isV2Private: (post: any) => {
            if (typeof post?.isV2Private === 'boolean') {
                return post.isV2Private;
            }
            const visibility = String(post?.v2VisibilityLevel || post?.visibility || '').trim();
            return visibility === 'Private';
        },

        isV2Draft: (post: any) => {
            if (typeof post?.isV2Draft === 'boolean') {
                return post.isV2Draft;
            }
            const status = String(post?.v2Status || post?.status || '').trim();
            return status === 'Draft';
        },

        protocolCircleId: (post: any) => {
            if (Number.isFinite(post?.protocolCircleId)) {
                return post.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.protocolCircleId)) {
                return post.circle.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.id)) {
                return post.circle.id;
            }
            if (Number.isFinite(post?.circleId)) {
                return post.circleId;
            }
            if (Number.isFinite(post?.v2AudienceRef) && String(post?.v2AudienceKind || '').trim() === 'CircleOnly') {
                return post.v2AudienceRef;
            }
            return null;
        },

        circleOnChainAddress: async (post: any, _: any, { prisma }: Context) => {
            const preloaded = String(
                post?.circleOnChainAddress
                || post?.circle?.onChainAddress
                || ''
            ).trim();
            if (preloaded) return preloaded;
            if (!post?.circleId) return null;

            const circle = await prisma.circle.findUnique({
                where: { id: post.circleId },
                select: { onChainAddress: true },
            });
            return circle?.onChainAddress ?? null;
        },

        stats: (post: any) => ({
            likes: post.likesCount,
            reposts: post.repostsCount,
            replies: post.repliesCount,
            comments: post.commentsCount ?? 0,
            shares: post.sharesCount ?? 0,
            views: post.viewsCount,
            heatScore: Number(post.heatScore ?? 0),
        }),

        rankingAdjustmentState: (post: any) => (
            publicContentVisibilityDownrankState(post).state
        ),
        rankingAdjustmentFactorBps: (post: any) => (
            publicContentVisibilityDownrankState(post).factorBps
        ),
        rankingAdjustmentExpiresAt: (post: any) => (
            publicContentVisibilityDownrankState(post).expiresAt
        ),

        repostOf: async (post: any, _: any, { prisma }: Context) => {
            if (post.repostOfPostId) {
                return await prisma.post.findUnique({
                    where: { id: post.repostOfPostId, safetyQuarantined: false },
                    include: { author: true },
                });
            }
            const repostOfAddress = String(post.repostOfAddress || '').trim();
            if (!repostOfAddress) return null;
            return await prisma.post.findFirst({
                where: {
                    safetyQuarantined: false,
                    OR: [
                        { contentId: repostOfAddress },
                        { onChainAddress: repostOfAddress },
                    ],
                },
                include: { author: true },
            });
        },

        author: async (post: any, _: any, { prisma }: Context) => {
            return await prisma.user.findUnique({
                where: { id: post.authorId },
            });
        },

        replies: async (post: any, { limit }: any, { prisma }: Context) => {
            return await prisma.post.findMany({
                where: { parentPostId: post.id, safetyQuarantined: false },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { author: true },
            });
        },

        circle: async (post: any, _: any, { prisma }: Context) => {
            if (!post.circleId) return null;
            return await prisma.circle.findUnique({
                where: { id: post.circleId },
            });
        },

        liked: async (post: any, _: any, { prisma, userId }: Context) => {
            if (!userId) return false;
            const like = await prisma.like.findFirst({
                where: { postId: post.id, userId },
            });
            return !!like;
        },
    },

    Circle: {
        protocolCircleId: (circle: any) => circle.id,
        onChainAddress: (circle: any) => circle.onChainAddress,
        knowledgeCount: async (circle: any, _: any, { prisma }: Context) => {
            if (!Number.isFinite(Number(circle?.id)) || Number(circle.id) <= 0) {
                return Math.max(0, Number(circle?.knowledgeCount ?? 0));
            }
            return Math.max(0, await prisma.knowledge.count({
                where: {
                    circleId: Number(circle.id),
                },
            }));
        },
        circleType: async (circle: any, _: any, { prisma }: Context) => {
            if (circle.__projectedCircleSettings?.circleType) {
                return circle.__projectedCircleSettings.circleType;
            }
            if (
                typeof circle.id === 'number'
                && typeof circle.joinRequirement === 'string'
                && typeof circle.circleType === 'string'
            ) {
                const projected = await resolveProjectedCircleSettings(prisma as any, circle);
                return projected.circleType;
            }
            return circle.circleType;
        },
        joinRequirement: async (circle: any, _: any, { prisma }: Context) => {
            if (circle.__projectedCircleSettings?.joinRequirement) {
                return circle.__projectedCircleSettings.joinRequirement;
            }
            if (
                typeof circle.id === 'number'
                && typeof circle.joinRequirement === 'string'
                && typeof circle.circleType === 'string'
            ) {
                const projected = await resolveProjectedCircleSettings(prisma as any, circle);
                return projected.joinRequirement;
            }
            return circle.joinRequirement || 'Free';
        },
        genesisMode: (circle: any) => normalizeCircleGenesisMode(circle.genesisMode),
        minCrystals: async (circle: any, _: any, { prisma }: Context) => {
            if (typeof circle.__projectedCircleSettings?.minCrystals === 'number') {
                return circle.__projectedCircleSettings.minCrystals;
            }
            if (
                typeof circle.id === 'number'
                && typeof circle.joinRequirement === 'string'
                && typeof circle.circleType === 'string'
            ) {
                const projected = await resolveProjectedCircleSettings(prisma as any, circle);
                return projected.minCrystals;
            }
            return Number(circle.minCrystals ?? 0);
        },
        stats: async (circle: any, _: any, { prisma }: Context) => {
            if (!Number.isFinite(Number(circle?.id)) || Number(circle.id) <= 0) {
                return {
                    members: Math.max(0, Number(circle?.membersCount ?? 0)),
                    posts: Math.max(0, Number(circle?.postsCount ?? 0)),
                };
            }

            const circleId = Number(circle.id);
            const [members, posts] = await Promise.all([
                prisma.circleMember.count({
                    where: {
                        circleId,
                        status: MemberStatus.Active,
                    },
                }),
                prisma.post.count({
                    where: {
                        circleId,
                    },
                }),
            ]);

            return {
                members: Math.max(0, members),
                posts: Math.max(0, posts),
            };
        },

        creator: async (circle: any, _: any, { prisma }: Context) => {
            if (circle.creator) return circle.creator;
            return await prisma.user.findUnique({
                where: { id: circle.creatorId },
            });
        },

        parentCircle: async (circle: any, _: any, { prisma }: Context) => {
            if (!circle.parentCircleId) return null;
            return await prisma.circle.findUnique({
                where: { id: circle.parentCircleId },
            });
        },

        childCircles: async (circle: any, _: any, { prisma }: Context) => {
            return await prisma.circle.findMany({
                where: { parentCircleId: circle.id },
                orderBy: { createdAt: 'desc' },
            });
        },

        members: async (circle: any, { limit }: any, context: Context) => {
            const { prisma, locale } = context;
            const actor = await resolveGraphqlActor(context);
            const allowed = actor
                ? await canAccessCircleForGraphqlActor(prisma, actor, circle.id)
                : false;
            if (!allowed) return [];

            const members = await prisma.circleMember.findMany({
                where: {
                    circleId: circle.id,
                    status: MemberStatus.Active,
                },
                take: limit,
                include: { user: true },
            });
            const displays = await resolveCircleActorDisplays({
                prisma: prisma as any,
                actors: members.map((member: any, index: number) => ({
                    displayKey: `circle-member:${member.userId}:${index}`,
                    pubkey: member.user?.pubkey ?? null,
                    circleId: circle.id,
                })),
                mode: 'current',
                locale: locale ?? 'en',
            });

            return members.map((member: any, index: number) => {
                const display = displays.get(`circle-member:${member.userId}:${index}`);
                return {
                    ...member,
                    circleAlias: display?.circleAlias ?? null,
                    effectiveDisplayName: display?.effectiveName ?? null,
                    displaySource: display?.displaySource ?? null,
                    displayCircleId: display?.displayCircleId ?? circle.id,
                    inheritedFromCircleId: display?.inheritedFromCircleId ?? null,
                    globalHandle: display?.globalHandle ?? member.user?.handle ?? null,
                    globalDisplayName: display?.globalDisplayName ?? member.user?.displayName ?? null,
                };
            });
        },

        posts: async (circle: any, { limit }: any, { prisma }: Context) => {
            return await prisma.post.findMany({
                where: {
                    circleId: circle.id,
                    parentPostId: null,
                    safetyQuarantined: false,
                    status: { not: 'Draft' as any },
                },
                take: limit ?? 20,
                orderBy: [{ downranked: 'asc' }, { createdAt: 'desc' }],
                include: { author: true },
            });
        },
    },

    CircleMember: {
        user: async (member: any, _: any, { prisma }: Context) => {
            if (member.user) return member.user;
            return await prisma.user.findUnique({
                where: { id: member.userId },
            });
        },
        circleAlias: (member: any) => member.circleAlias ?? null,
        effectiveDisplayName: (member: any) => member.effectiveDisplayName ?? null,
        displaySource: (member: any) => member.displaySource ?? null,
        displayCircleId: (member: any) => member.displayCircleId ?? null,
        inheritedFromCircleId: (member: any) => member.inheritedFromCircleId ?? null,
        globalHandle: (member: any) => member.globalHandle ?? member.user?.handle ?? null,
        globalDisplayName: (member: any) => member.globalDisplayName ?? member.user?.displayName ?? null,
    },

    Knowledge: {
        publicationOrigin: (knowledge: any) => {
            const origin = verifiedKnowledgePublicationOrigin(knowledge) as Record<string, any> | null;
            return origin ? {
                ...origin,
                governanceHomeType: origin.governanceHome.type,
                governanceHomeRef: origin.governanceHome.ref,
            } : null;
        },
        publicationVersions: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => prisma.knowledgePublicationVersion.findMany({
            where: { knowledgeId: knowledge.knowledgeId },
            take: Math.max(1, Math.min(Number(limit || 20), 100)),
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        }),
        publicationOriginDigest: (knowledge: any) => (
            verifiedKnowledgePublicationOrigin(knowledge)
                ? String(knowledge.publicationOriginDigest).toLowerCase()
                : null
        ),
        stats: (knowledge: any) => {
            const hasStoredHeatScore = knowledge.heatScore !== undefined && knowledge.heatScore !== null;

            return {
                qualityScore: parseFloat(knowledge.qualityScore) || 0,
                citationCount: knowledge.citationCount,
                viewCount: knowledge.viewCount,
                heatScore: hasStoredHeatScore
                    ? Number(knowledge.heatScore ?? 0)
                    : Number(knowledge.sourceDraftHeatScore ?? 0),
            };
        },

        crystalParams: (knowledge: any) => {
            // Return frozen crystal visual params if stored, null otherwise
            const cp = knowledge.crystalParams;
            if (!cp || typeof cp !== 'object') return null;
            return {
                seed: cp.seed ?? '0x0',
                hue: cp.hue ?? 42,
                facets: cp.facets ?? 6,
            };
        },

        relationshipAssignment: async (
            knowledge: any,
            _: any,
            { prisma, locale }: Context,
        ) => {
            if (knowledge.relationshipAssignment) return knowledge.relationshipAssignment;
            return resolveKnowledgeRelationshipAssignment(prisma, knowledge.knowledgeId, {
                locale,
                includeInactiveAssignedLabel: true,
            });
        },

        crystallizationOutput: async (
            knowledge: any,
            _: any,
            { prisma, locale }: Context,
        ) => {
            if (knowledge.crystallizationOutput !== undefined) {
                return knowledge.crystallizationOutput;
            }
            const records = await loadCrystallizationOutputRecordsByKnowledgeIds(
                prisma,
                [knowledge.knowledgeId],
            );
            return buildCrystallizationOutputSummary(records.get(knowledge.knowledgeId), locale);
        },

        crystalAsset: async (
            knowledge: any,
            _: any,
            { prisma }: Context,
        ) => {
            if (knowledge.crystalAsset !== undefined) {
                return projectLegacyCrystalAsset(knowledge.crystalAsset, 'master');
            }
            const knowledgeRowId = Number(knowledge.id ?? 0);
            if (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) return null;

            const asset = await prisma.crystalAsset.findUnique({
                where: {
                    knowledgeRowId,
                },
            });
            return projectLegacyCrystalAsset(asset, 'master');
        },

        crystalReceiptStats: async (
            knowledge: any,
            _: any,
            { prisma }: Context,
        ) => {
            if (
                knowledge.crystalReceiptStats
                && typeof knowledge.crystalReceiptStats === 'object'
                && !Array.isArray(knowledge.crystalReceiptStats)
            ) {
                return knowledge.crystalReceiptStats;
            }

            const knowledgeRowId = Number(knowledge.id ?? 0);
            if (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) {
                return emptyCrystalReceiptStats();
            }

            const receiptStatusBuckets = await prisma.crystalReceipt.groupBy({
                where: {
                    knowledgeRowId,
                },
                by: ['mintStatus'],
                _count: {
                    _all: true,
                },
            });

            return summarizeCrystalReceiptStatusBuckets(receiptStatusBuckets);
        },

        crystalReceipts: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma, locale }: Context,
        ) => {
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            const receipts = Array.isArray(knowledge.crystalReceipts)
                ? knowledge.crystalReceipts.slice(0, resolvedLimit)
                : await (async () => {
                    const knowledgeRowId = Number(knowledge.id ?? 0);
                    if (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) return [];

                    return prisma.crystalReceipt.findMany({
                        where: {
                            knowledgeRowId,
                        },
                        orderBy: [
                            { contributionWeightBps: 'desc' },
                            { updatedAt: 'desc' },
                        ],
                        take: resolvedLimit,
                    });
                })();

            const sourceCircleId = Number(
                knowledge.sourceCircleId
                ?? knowledge.circleId
                ?? knowledge.sourceCircle?.id
                ?? knowledge.circle?.id
                ?? 0,
            );
            const displayCircleId = Number.isFinite(sourceCircleId) && sourceCircleId > 0 ? sourceCircleId : null;
            const displays = await resolveCircleActorDisplays({
                prisma: prisma as any,
                actors: receipts.map((receipt: any) => ({
                    displayKey: `receipt-owner:${receipt.id}`,
                    pubkey: receipt.ownerPubkey ?? null,
                    circleId: displayCircleId,
                })),
                mode: 'current',
                locale,
            });

            return receipts.map((receipt: any) => {
                const display = displays.get(`receipt-owner:${receipt.id}`);
                return {
                    ...receipt,
                    ...legacyCrystalCutoverFields(receipt, 'receipt'),
                    ownerEffectiveDisplayName: display?.effectiveName ?? null,
                    ownerDisplaySource: display?.displaySource ?? null,
                    ownerCircleAlias: display?.circleAlias ?? null,
                    ownerNeedsDisplayDisambiguation: Boolean(display?.needsDisplayDisambiguation),
                };
            });
        },

        binding: async (
            knowledge: any,
            _: any,
            { prisma }: Context,
        ) => {
            const preloaded = mapKnowledgeBindingProjection(knowledge.binding ?? null);
            if (preloaded) return preloaded;

            const knowledgeId = typeof knowledge.knowledgeId === 'string'
                ? knowledge.knowledgeId.trim()
                : '';
            if (!knowledgeId) return null;
            return resolveKnowledgeBindingProjection(prisma, knowledgeId);
        },

        contributors: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma, locale }: Context,
        ) => {
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            const knowledgeCircleId = typeof knowledge.circleId === 'number' ? knowledge.circleId : null;
            if (typeof knowledge.id === 'number' && Number.isFinite(knowledge.id)) {
                const rows = await prisma.knowledgeContribution.findMany({
                    where: { knowledgeId: knowledge.id },
                    orderBy: [
                        { contributionWeight: 'desc' },
                        { updatedAt: 'desc' },
                    ],
                    take: resolvedLimit,
                });

                if (rows.length > 0) {
                    const displayByPubkey = await resolveContributorDisplayByPubkey({
                        prisma,
                        circleId: knowledgeCircleId,
                        pubkeys: rows.map((row) => row.contributorPubkey),
                        locale,
                    });
                    const agentDirectoryByPubkey = await loadAgentDirectoryByPubkey(prisma, {
                        circleId: knowledgeCircleId,
                        pubkeys: rows.map((row) => row.contributorPubkey),
                    });
                    const assessmentProvenanceBySnapshot = await loadKnowledgeContributorAssessmentProvenance({
                        prisma,
                        knowledgePublicId: typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId : null,
                        snapshots: rows.map((row) => ({
                            sourceDraftPostId: row.sourceDraftPostId,
                            contributorsRoot: row.contributorsRoot,
                            contributorsCount: row.contributorsCount,
                        })),
                    });

                    return rows.map((row) => {
                        const assessmentProvenance = assessmentProvenanceBySnapshot.get(
                            knowledgeContributionSnapshotKey({
                                sourceDraftPostId: row.sourceDraftPostId,
                                contributorsRoot: row.contributorsRoot,
                                contributorsCount: row.contributorsCount,
                            }),
                        ) ?? DEFAULT_UNKNOWN_ASSESSMENT_PROVENANCE;
                        return {
                            handle: displayByPubkey.get(row.contributorPubkey)
                                || row.contributorHandle
                                || agentDirectoryByPubkey.get(row.contributorPubkey)?.handle
                                || localizeQueryApiCopy('identity.genericMember', 'en'),
                            pubkey: row.contributorPubkey,
                            role: normalizeContributionRole(row.contributionRole),
                            weight: normalizeNumericScore(row.contributionWeight, 0),
                            authorType: agentDirectoryByPubkey.has(row.contributorPubkey) ? 'AGENT' : 'HUMAN',
                            authorityScore: 0,
                            reputationDelta: 0,
                            settledAt: row.updatedAt,
                            sourceType: 'SNAPSHOT',
                            assessmentKind: assessmentProvenance.kind,
                            assessmentAlgorithmVersion: assessmentProvenance.algorithmVersion,
                            assessmentStatus: assessmentProvenance.status,
                            sourceDraftPostId: row.sourceDraftPostId,
                            sourceAnchorId: row.sourceAnchorId,
                            sourcePayloadHash: row.sourcePayloadHash,
                            sourceSummaryHash: row.sourceSummaryHash,
                            sourceMessagesDigest: row.sourceMessagesDigest,
                        };
                    });
                }
            }

            const candidateCrystalIds = buildCandidateCrystalIds(knowledge);

            if (candidateCrystalIds.length === 0) {
                return [];
            }

            const settlements = await prisma.settlementHistory.findMany({
                where: {
                    crystalId: { in: candidateCrystalIds },
                },
                orderBy: { settledAt: 'desc' },
                take: resolvedLimit * 8,
            });

            if (settlements.length === 0) {
                return [];
            }

            type Aggregate = {
                pubkey: string;
                role: 'Author' | 'Discussant' | 'Reviewer' | 'Cited' | 'Unknown';
                authorityScore: number;
                reputationDelta: number;
                weight: number;
                settledAt: Date;
            };

            const aggregates = new Map<string, Aggregate>();

            for (const row of settlements) {
                const pubkey = row.contributorPubkey;
                const authorityScore = Number(row.authorityScore ?? 0);
                const reputationDelta = Number(row.reputationDelta ?? 0);
                const weightFromRow = row.contributionWeight !== null && row.contributionWeight !== undefined
                    ? Number(row.contributionWeight)
                    : null;
                const weight = weightFromRow ?? (authorityScore > 0 ? reputationDelta / authorityScore : 0);
                const role = normalizeContributionRole(row.contributionRole);

                const current = aggregates.get(pubkey);
                if (!current || row.settledAt > current.settledAt) {
                    aggregates.set(pubkey, {
                        pubkey,
                        role,
                        authorityScore,
                        reputationDelta,
                        weight,
                        settledAt: row.settledAt,
                    });
                }
            }

            const sorted = Array.from(aggregates.values())
                .sort((a, b) => b.reputationDelta - a.reputationDelta)
                .slice(0, resolvedLimit);

            const displayByPubkey = await resolveContributorDisplayByPubkey({
                prisma,
                circleId: knowledgeCircleId,
                pubkeys: sorted.map((item) => item.pubkey),
                locale,
            });
            const agentDirectoryByPubkey = await loadAgentDirectoryByPubkey(prisma, {
                circleId: knowledgeCircleId,
                pubkeys: sorted.map((item) => item.pubkey),
            });

            return sorted.map((item) => ({
                handle: displayByPubkey.get(item.pubkey)
                    || agentDirectoryByPubkey.get(item.pubkey)?.handle
                    || localizeQueryApiCopy('identity.genericMember', 'en'),
                pubkey: item.pubkey,
                role: item.role,
                weight: item.weight,
                authorType: agentDirectoryByPubkey.has(item.pubkey) ? 'AGENT' : 'HUMAN',
                authorityScore: item.authorityScore,
                reputationDelta: item.reputationDelta,
                settledAt: item.settledAt,
                sourceType: 'SETTLEMENT',
                assessmentKind: 'NOT_APPLICABLE',
                assessmentAlgorithmVersion: null,
                assessmentStatus: null,
                sourceDraftPostId: null,
                sourceAnchorId: null,
                sourcePayloadHash: null,
                sourceSummaryHash: null,
                sourceMessagesDigest: null,
            }));
        },

        versionTimeline: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma, locale }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId.trim() : '';
            if (!knowledgeId) return [];

            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            type VersionEventRow = {
                id: bigint;
                eventType: string;
                version: number;
                actorPubkey: string | null;
                contributorsCount: number | null;
                contributorsRoot: string | null;
                sourceEventTimestamp: bigint;
                eventAt: Date;
                createdAt: Date;
            };

            const rows = await prisma.$queryRaw<VersionEventRow[]>(Prisma.sql`
                SELECT
                    id,
                    event_type AS "eventType",
                    version,
                    actor_pubkey AS "actorPubkey",
                    contributors_count AS "contributorsCount",
                    contributors_root AS "contributorsRoot",
                    source_event_timestamp AS "sourceEventTimestamp",
                    event_at AS "eventAt",
                    created_at AS "createdAt"
                FROM knowledge_version_events
                WHERE knowledge_id = ${knowledgeId}
                ORDER BY event_at DESC, id DESC
                LIMIT ${resolvedLimit}
            `);

            if (rows.length === 0) {
                return [];
            }

            const displays = await resolveCircleActorDisplays({
                prisma: prisma as any,
                actors: rows.map((row) => ({
                    displayKey: `knowledge-version-timeline:${row.id}:actor`,
                    pubkey: row.actorPubkey,
                    circleId: typeof knowledge.circleId === 'number' ? knowledge.circleId : null,
                })),
                mode: 'current',
                locale: locale ?? 'en',
            });

            return rows.map((row) => ({
                id: String(row.id),
                eventType: row.eventType,
                version: row.version,
                actorPubkey: row.actorPubkey,
                actorHandle: displays.get(`knowledge-version-timeline:${row.id}:actor`)?.effectiveName ?? null,
                contributorsCount: row.contributorsCount,
                contributorsRoot: row.contributorsRoot,
                sourceEventTimestamp: String(row.sourceEventTimestamp),
                eventAt: row.eventAt,
                createdAt: row.createdAt,
            }));
        },

        versionDiff: async (
            knowledge: any,
            { fromVersion, toVersion }: { fromVersion: number; toVersion: number },
            { prisma, locale }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId.trim() : '';
            if (!knowledgeId) return null;
            return await loadKnowledgeVersionDiff(prisma as any, {
                knowledgeId,
                fromVersion,
                toVersion,
                locale,
            });
        },

        references: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId : '';
            if (!knowledgeId) return [];
            return resolveKnowledgeLineageLinks(prisma, knowledgeId, 'outbound', limit ?? 8);
        },

        citedBy: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId : '';
            if (!knowledgeId) return [];
            return resolveKnowledgeLineageLinks(prisma, knowledgeId, 'inbound', limit ?? 8);
        },

        author: async (knowledge: any, _: any, { prisma }: Context) => {
            if (knowledge.author) return knowledge.author;
            return await prisma.user.findUnique({ where: { id: knowledge.authorId } });
        },

        circle: async (knowledge: any, _: any, { prisma }: Context) => {
            if (knowledge.circle) return knowledge.circle;
            return await prisma.circle.findUnique({ where: { id: knowledge.circleId } });
        },

        sourceCircle: async (knowledge: any, _: any, { prisma }: Context) => {
            if (knowledge.sourceCircle) return knowledge.sourceCircle;
            if (!knowledge.sourceCircleId) return null;
            return await prisma.circle.findUnique({ where: { id: knowledge.sourceCircleId } });
        },
    },

    // ══════════════════════════════════════
    // Mutations
    // ══════════════════════════════════════
    Mutation: {
        // ── createPost / deletePost removed ──
        // 内容创建和删除走链上 SDK (content-manager.create_content / delete_content)
        // indexer 监听 ContentCreated / ContentStatusChanged 事件后入库

        // ── updateUser ──
        async updateUser(
            _: any,
            { input }: { input: { displayName?: string; bio?: string; avatarUri?: string; bannerUri?: string; website?: string; location?: string } },
            { prisma, userId }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');
            const requestedProtocolFields = [
                input.displayName,
                input.bio,
                input.avatarUri,
                input.bannerUri,
                input.website,
                input.location,
            ].filter((value) => value !== undefined);

            if (requestedProtocolFields.length > 0) {
                throw new Error('Protocol-owned profile fields must be updated via wallet-signed identity transaction');
            }

            return await prisma.user.findUnique({
                where: { id: userId },
            });
        },

        // ── evaluateIdentity ──
        async evaluateIdentity(
            _: any,
            { circleId, userId: targetUserId }: { circleId: number; userId: number },
            { prisma, req }: Context,
        ) {
            assertInternalApiRequest({ headers: req.headers });
            const { evaluateAndUpdate } = await import('../identity/machine');
            const result = await evaluateAndUpdate(prisma, targetUserId, circleId);

            return {
                previousLevel: result.previousLevel,
                currentLevel: result.newLevel,
                changed: result.changed,
            };
        },

        // ── generateGhostDraft ──
        async generateGhostDraft(
            _: any,
            {
                input,
            }: {
                input: {
                    postId: number;
                    preferAutoApply?: boolean | null;
                    workingCopyHash?: string | null;
                    workingCopyUpdatedAt?: string | Date | null;
                    seededReference?: {
                        path: string;
                        line: number;
                    } | null;
                    sourceMaterialIds?: number[] | null;
                };
            },
            context: Context,
        ) {
            const { prisma } = context;
            const actor = await requireGraphqlActor(context);
            const userId = actor.userId;
            const postId = Number(input.postId);
            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId,
                action: 'read',
            });
            if (!access.allowed) throw new Error(access.error);

            const editAccess = input.preferAutoApply
                ? await authorizeDraftActionForActor(prisma, {
                    actor,
                    postId,
                    action: 'edit',
                })
                : null;
            assertAiTaskAllowed({
                task: 'ghost-draft',
                dataBoundary: 'private_plaintext',
            });
            const autoApplyRequested = Boolean(input.preferAutoApply && editAccess?.allowed);
            const seededReference = input.seededReference
                && typeof input.seededReference.path === 'string'
                && Number.isFinite(Number(input.seededReference.line))
                && Number(input.seededReference.line) > 0
                ? {
                    path: String(input.seededReference.path).trim(),
                    line: Number(input.seededReference.line),
                }
                : null;
            const sourceMaterialIds = Array.isArray(input.sourceMaterialIds)
                ? input.sourceMaterialIds
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0)
                : [];
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'ghost_draft_generate',
                dedupeKey: buildGhostDraftGenerationDedupeKey({
                    postId,
                    requestedByUserId: userId,
                    autoApplyRequested,
                    workingCopyHash: input.workingCopyHash || null,
                    workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
                    seededReference,
                    sourceMaterialIds,
                }),
                scopeType: 'draft',
                scopeDraftPostId: postId,
                scopeCircleId: access.post?.circleId ?? null,
                requestedByUserId: userId,
                payload: {
                    postId,
                    autoApplyRequested,
                    actorPubkey: actor.pubkey,
                    autoApplyAuthorizedAt: autoApplyRequested ? new Date().toISOString() : null,
                    workingCopyHash: input.workingCopyHash || null,
                    workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
                    seededReference,
                    sourceMaterialIds,
                },
            });

            return {
                jobId: job.id,
                status: job.status,
                postId,
                autoApplyRequested,
            };
        },

        async acceptGhostDraft(
            _: any,
            {
                input,
            }: {
                input: {
                    postId: number;
                    generationId: number;
                    mode: 'AUTO_FILL' | 'ACCEPT_REPLACE' | 'ACCEPT_SUGGESTION';
                    suggestionId?: string | null;
                    workingCopyHash?: string | null;
                    workingCopyUpdatedAt?: string | Date | null;
                };
            },
            context: Context,
        ) {
            const { prisma, locale } = context;
            const actor = await requireGraphqlActor(context);

            const {
                acceptGhostDraftIntoWorkingCopy,
                normalizeGhostDraftAcceptanceMode,
            } = await import('../services/ghostDraft/acceptance');
            const mode = normalizeGhostDraftAcceptanceMode(input.mode);
            if (!mode) {
                throw new Error('invalid_ghost_draft_acceptance_mode');
            }

            return acceptGhostDraftIntoWorkingCopy(prisma as any, {
                draftPostId: input.postId,
                generationId: input.generationId,
                suggestionId: input.suggestionId || null,
                actor,
                mode,
                locale,
                workingCopyHash: input.workingCopyHash || null,
                workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
            });
        },

        async reviewDraftIssue(
            _: any,
            {
                input,
            }: {
                input: {
                    draftPostId: number;
                    threadId: string | number;
                };
            },
            context: Context,
        ) {
            const { prisma, locale } = context;
            const actor = await requireGraphqlActor(context);
            const { buildIssueReviewAssist } = await import('../services/draftAiAssist/issueReviewAssist');

            return buildIssueReviewAssist(prisma as any, {
                draftPostId: Number(input.draftPostId),
                threadId: input.threadId,
                actor,
                locale,
            });
        },

        async generateAcceptedIssueRevision(
            _: any,
            {
                input,
            }: {
                input: {
                    postId: number;
                    threadIds?: Array<string | number> | null;
                    targetRef?: string | null;
                    workingCopyHash?: string | null;
                    workingCopyUpdatedAt?: string | Date | null;
                    seededReference?: {
                        path: string;
                        line: number;
                    } | null;
                    sourceMaterialIds?: number[] | null;
                };
            },
            context: Context,
        ) {
            const { prisma } = context;
            const actor = await requireGraphqlActor(context);
            const userId = actor.userId;
            const postId = Number(input.postId);
            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId,
                action: 'read',
            });
            if (!access.allowed) throw new Error(access.error);

            assertAiTaskAllowed({
                task: 'accepted-issue-revision',
                dataBoundary: 'private_plaintext',
            });
            const seededReference = input.seededReference
                && typeof input.seededReference.path === 'string'
                && Number.isFinite(Number(input.seededReference.line))
                && Number(input.seededReference.line) > 0
                ? {
                    path: String(input.seededReference.path).trim(),
                    line: Number(input.seededReference.line),
                }
                : null;
            const sourceMaterialIds = Array.isArray(input.sourceMaterialIds)
                ? input.sourceMaterialIds
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0)
                : [];
            const threadIds = Array.isArray(input.threadIds)
                ? input.threadIds
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                : [];
            const targetRef = typeof input.targetRef === 'string' && input.targetRef.trim()
                ? input.targetRef.trim()
                : null;
            const targetParagraphMatch = targetRef?.match(/^paragraph:(\d+)$/i) ?? null;
            const targetParagraphIndex = targetParagraphMatch
                ? Number.parseInt(targetParagraphMatch[1], 10)
                : null;
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'accepted_issue_revision_generate',
                dedupeKey: buildAcceptedIssueRevisionDedupeKey({
                    postId,
                    requestedByUserId: userId,
                    acceptedThreadIds: threadIds,
                    targetParagraphIndex,
                    workingCopyHash: input.workingCopyHash || null,
                    workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
                    seededReference,
                    sourceMaterialIds,
                }),
                scopeType: 'draft',
                scopeDraftPostId: postId,
                scopeCircleId: access.post?.circleId ?? null,
                requestedByUserId: userId,
                payload: {
                    postId,
                    actor: serializeGraphqlActor(actor),
                    threadIds,
                    targetRef,
                    workingCopyHash: input.workingCopyHash || null,
                    workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
                    seededReference,
                    sourceMaterialIds,
                },
            });

            return {
                jobId: job.id,
                status: job.status,
                postId,
                autoApplyRequested: false,
            };
        },

        async applyAcceptedIssueRevision(
            _: any,
            {
                input,
            }: {
                input: {
                    postId: number;
                    generationId: number;
                    suggestionId: string;
                    workingCopyHash?: string | null;
                    workingCopyUpdatedAt?: string | Date | null;
                };
            },
            context: Context,
        ) {
            const { prisma, locale } = context;
            const actor = await requireGraphqlActor(context);
            const { applyAcceptedIssueRevision } = await import('../services/draftAiAssist/acceptedIssueRevisionApply');

            return applyAcceptedIssueRevision(prisma as any, {
                draftPostId: Number(input.postId),
                generationId: Number(input.generationId),
                suggestionId: String(input.suggestionId || ''),
                actor,
                locale,
                workingCopyHash: input.workingCopyHash || null,
                workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
            });
        },

        // ── Message useful mark ──
        async markMessageUseful(
            _: any,
            { circleId, envelopeId }: { circleId: number; envelopeId: string },
            context: Context,
        ) {
            const { prisma, cache } = context;
            const actor = await requireGraphqlActor(context);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'discussion.write',
            });
            const userId = actor.userId;

            const membership = await prisma.circleMember.findFirst({
                where: { circleId, userId, status: 'Active' },
            });
            if (!membership) throw new Error('Not a circle member');

            const msg = await prisma.circleDiscussionMessage.findUnique({
                where: { envelopeId },
                select: {
                    senderPubkey: true,
                    circleId: true,
                    deleted: true,
                    isEphemeral: true,
                    isFeatured: true,
                    featureReason: true,
                    featuredAt: true,
                },
            });
            if (!msg || msg.circleId !== circleId || msg.deleted) throw new Error('Message not found');
            if (msg.isEphemeral) throw new Error('Cannot mark ephemeral message useful');

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { pubkey: true },
            });
            if (user?.pubkey === msg.senderPubkey) throw new Error('Cannot mark own message useful');

            const targetUser = await prisma.user.findFirst({
                where: { pubkey: msg.senderPubkey },
                select: { id: true },
            });

            const result = await prisma.$transaction(async (tx) => {
                const inserted = await tx.discussionMessageHighlight.createMany({
                    data: [{ envelopeId, userId }],
                    skipDuplicates: true,
                });
                const usefulCount = await tx.discussionMessageHighlight.count({
                    where: { envelopeId },
                });
                const nextIsFeatured = msg.isFeatured || usefulCount > 0;
                const nextFeatureReason =
                    usefulCount > 0
                        ? 'member_useful'
                        : msg.featureReason;
                const nextFeaturedAt =
                    nextIsFeatured
                        ? (msg.featuredAt ?? new Date())
                        : null;

                await tx.circleDiscussionMessage.update({
                    where: { envelopeId },
                    data: {
                        isFeatured: nextIsFeatured,
                        featuredAt: nextFeaturedAt,
                        featureReason: nextFeatureReason,
                    },
                });

                if (inserted.count > 0 && targetUser) {
                    await tx.$executeRaw`
                        INSERT INTO notifications (user_id, type, title, body, source_type, source_id, circle_id, read, created_at, metadata)
                        SELECT ${targetUser.id}, 'useful', 'discussion.markedUseful', NULL,
                               'discussion', ${envelopeId}, ${circleId}, false, NOW(),
                               jsonb_build_object('messageKey', 'discussion.markedUseful', 'params', jsonb_build_object())
                        WHERE NOT EXISTS (
                            SELECT 1 FROM notifications WHERE user_id = ${targetUser.id}
                              AND type = 'useful' AND source_id = ${envelopeId}
                        )`;
                }

                return {
                    ok: true,
                    usefulCount,
                    isFeatured: nextIsFeatured,
                    viewerHasMarkedUseful: true,
                    changed: inserted.count > 0,
                };
            });

            if (cache && typeof (cache as { publish?: unknown }).publish === 'function') {
                try {
                    await publishDiscussionRealtimeEvent(cache, {
                        circleId,
                        envelopeId,
                        reason: 'message_refresh_required',
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`discussion realtime publish failed for useful mark ${envelopeId}: ${message}`);
                }
            }

            return result;
        },

        async unmarkMessageUseful(
            _: any,
            { circleId, envelopeId }: { circleId: number; envelopeId: string },
            context: Context,
        ) {
            const { prisma, cache } = context;
            const actor = await requireGraphqlActor(context);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'discussion.write',
            });
            const userId = actor.userId;

            const membership = await prisma.circleMember.findFirst({
                where: { circleId, userId, status: 'Active' },
            });
            if (!membership) throw new Error('Not a circle member');

            const msg = await prisma.circleDiscussionMessage.findUnique({
                where: { envelopeId },
                select: {
                    senderPubkey: true,
                    circleId: true,
                    deleted: true,
                    isEphemeral: true,
                    isFeatured: true,
                    featureReason: true,
                    featuredAt: true,
                },
            });
            if (!msg || msg.circleId !== circleId || msg.deleted) throw new Error('Message not found');
            if (msg.isEphemeral) throw new Error('Cannot unmark ephemeral message useful');

            const result = await prisma.$transaction(async (tx) => {
                const deleted = await tx.discussionMessageHighlight.deleteMany({
                    where: { envelopeId, userId },
                });
                const usefulCount = await tx.discussionMessageHighlight.count({
                    where: { envelopeId },
                });
                const usefulFeatureReason = msg.featureReason === 'member_useful';
                const nextIsFeatured = usefulCount > 0
                    ? true
                    : usefulFeatureReason
                        ? false
                        : msg.isFeatured;
                const nextFeatureReason = usefulCount > 0
                    ? 'member_useful'
                    : usefulFeatureReason
                        ? null
                        : msg.featureReason;
                const nextFeaturedAt = nextIsFeatured
                    ? (msg.featuredAt ?? new Date())
                    : null;

                await tx.circleDiscussionMessage.update({
                    where: { envelopeId },
                    data: {
                        isFeatured: nextIsFeatured,
                        featuredAt: nextFeaturedAt,
                        featureReason: nextFeatureReason,
                    },
                });

                return {
                    ok: true,
                    usefulCount,
                    isFeatured: nextIsFeatured,
                    viewerHasMarkedUseful: false,
                    changed: deleted.count > 0,
                };
            });

            if (cache && typeof (cache as { publish?: unknown }).publish === 'function') {
                try {
                    await publishDiscussionRealtimeEvent(cache, {
                        circleId,
                        envelopeId,
                        reason: 'message_refresh_required',
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`discussion realtime publish failed for useful unmark ${envelopeId}: ${message}`);
                }
            }

            return result;
        },

        // ── markNotificationsRead ──
        async markNotificationsRead(
            _: any,
            { ids }: { ids: number[] },
            { prisma, userId }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');
            await prisma.notification.updateMany({
                where: { id: { in: ids }, userId },
                data: { read: true },
            });
            return true;
        },

        // ── addDraftComment ──
        async addDraftComment(
            _: any,
            { postId, content, lineRef }: { postId: number; content: string; lineRef?: string },
            context: Context,
        ) {
            const { prisma } = context;
            const actor = await requireGraphqlActor(context);
            const userId = actor.userId;
            const trimmed = String(content || '').trim();
            if (!trimmed) throw new Error('empty_comment_content');

            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId,
                action: 'comment',
            });
            if (!access.allowed) {
                throw new Error(access.error);
            }

            return await prisma.$transaction(async (tx) => {
                const comment = await tx.draftComment.create({
                    data: {
                        postId,
                        userId,
                        content: trimmed,
                        lineRef: lineRef || null,
                    },
                    include: { user: true },
                });
                await bumpPostHeat(tx, {
                    postId,
                    delta: DRAFT_HEAT_EVENTS.comment,
                });
                return comment;
            });
        },
    },

    DraftComment: {
        user: async (comment: any, _: any, { prisma }: Context) => {
            if (comment.user) return comment.user;
            return await prisma.user.findUnique({ where: { id: comment.userId } });
        },
    },
};
