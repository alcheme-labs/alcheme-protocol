import crypto from 'crypto';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    type ContributionEvidenceContributor,
    type ContributionEvidencePackage,
    type ContributionEvidenceRef,
    type ContributionActorRole,
    type ContributionFunction,
    type ContributionRoleFact,
    type ContributionWeightTreatment,
    type DraftContributionOrigin,
} from './types';

const MAX_FINAL_CONTENT_EXCERPT_CHARS = 4000;
const MAX_EVIDENCE_EXCERPT_CHARS = 1000;
const MAX_EVIDENCE_REFS = 200;

function stableSortValue(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(stableSortValue);
    if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        Object.keys(record).sort().forEach((key) => {
            const value = record[key];
            if (value !== undefined) sorted[key] = stableSortValue(value);
        });
        return sorted;
    }
    return input;
}

export function stableStringify(input: unknown): string {
    return JSON.stringify(stableSortValue(input));
}

export function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeString(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeNullableString(value: unknown): string | null {
    const normalized = normalizeString(value);
    return normalized.length > 0 ? normalized : null;
}

function normalizeHex64(value: unknown): string | null {
    const normalized = normalizeString(value).toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function chooseStableNullableString(a: string | null | undefined, b: string | null | undefined): string | null {
    const values = [normalizeNullableString(a), normalizeNullableString(b)]
        .filter((value): value is string => value !== null)
        .sort();
    return values[0] ?? null;
}

function chooseStableNullableNumber(a: number | null | undefined, b: number | null | undefined): number | null {
    const values = [a, b]
        .filter((value): value is number => {
            if (value === null || value === undefined) return false;
            return Number.isInteger(value) && value > 0;
        })
        .sort((left, right) => left - right);
    return values[0] ?? null;
}

function clampText(value: unknown, limit: number): string {
    const normalized = String(value ?? '').trim();
    if (normalized.length <= limit) return normalized;
    return normalized.slice(0, limit);
}

function hasPresentPositiveIntegerId(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return false;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0;
}

const CONTRIBUTION_FUNCTIONS = new Set<ContributionFunction>([
    'material', 'claim', 'edit', 'review', 'execution', 'outcome',
]);

const CONTRIBUTION_ACTOR_ROLES = new Set<ContributionActorRole>([
    'external_author', 'submitter', 'proposal_author', 'editor', 'reviewer',
    'voter', 'executor', 'outcome_reviewer', 'ai_worker', 'trigger',
]);

const CONTRIBUTION_WEIGHT_TREATMENTS = new Set<ContributionWeightTreatment>([
    'weighted', 'trace_only', 'excluded',
]);

function defaultRoleFactClassification(ref: ContributionEvidenceRef): {
    actorRole: ContributionActorRole;
    contributionFunction: ContributionFunction | null;
    proofContribution: boolean;
} {
    if (ref.refType === 'source_message') {
        return { actorRole: 'external_author', contributionFunction: 'material', proofContribution: true };
    }
    if (ref.refType === 'draft_snapshot') {
        return { actorRole: 'proposal_author', contributionFunction: 'material', proofContribution: true };
    }
    if (ref.refType === 'source_selection') {
        return { actorRole: 'submitter', contributionFunction: 'material', proofContribution: true };
    }
    if (ref.refType === 'collab_edit') {
        return { actorRole: 'editor', contributionFunction: 'edit', proofContribution: true };
    }
    if (ref.refType === 'review_issue' || ref.refType === 'review_application') {
        return { actorRole: 'reviewer', contributionFunction: 'review', proofContribution: true };
    }
    if (ref.refType === 'governance_claim') {
        return { actorRole: 'proposal_author', contributionFunction: 'claim', proofContribution: true };
    }
    if (ref.refType === 'governance_execution') {
        return { actorRole: 'executor', contributionFunction: 'execution', proofContribution: true };
    }
    if (ref.refType === 'governance_outcome') {
        return { actorRole: 'outcome_reviewer', contributionFunction: 'outcome', proofContribution: true };
    }
    if (ref.refType === 'governance_vote') {
        return { actorRole: 'voter', contributionFunction: null, proofContribution: false };
    }
    return {
        actorRole: ref.metadata?.automationKind === 'ai_worker' ? 'ai_worker' : 'trigger',
        contributionFunction: null,
        proofContribution: false,
    };
}

export function buildContributionRoleFacts(input: {
    circleId: number;
    evidenceRefs: ContributionEvidenceRef[];
}): ContributionRoleFact[] {
    return input.evidenceRefs.map((ref) => {
        const defaults = defaultRoleFactClassification(ref);
        const configuredActorRole = normalizeString(ref.metadata?.actorRole) as ContributionActorRole;
        const actorRole = CONTRIBUTION_ACTOR_ROLES.has(configuredActorRole)
            ? configuredActorRole
            : defaults.actorRole;
        const configuredFunction = normalizeString(ref.metadata?.contributionFunction) as ContributionFunction;
        const contributionFunction = CONTRIBUTION_FUNCTIONS.has(configuredFunction)
            ? configuredFunction
            : defaults.contributionFunction;
        const proofContribution = typeof ref.metadata?.proofContribution === 'boolean'
            ? ref.metadata.proofContribution
            : defaults.proofContribution;
        const configuredTreatment = normalizeString(ref.metadata?.weightTreatment) as ContributionWeightTreatment;
        const weightTreatment = CONTRIBUTION_WEIGHT_TREATMENTS.has(configuredTreatment)
            ? configuredTreatment
            : proofContribution && ref.retention === 'retained' && ref.stage !== null
                ? 'weighted'
                : proofContribution
                    ? 'trace_only'
                    : 'excluded';
        const defaultReasonCode = weightTreatment === 'weighted'
            ? 'weighted_by_current_contribution_policy'
            : weightTreatment === 'trace_only'
                ? 'proof_fact_without_current_weight_budget'
                : actorRole === 'voter'
                    ? 'vote_only_excluded'
                    : 'unproved_automation_excluded';
        const configuredInstitutionRole = normalizeString(ref.metadata?.institutionRole);
        const configuredInstitutionCircleId = Number(ref.metadata?.institutionCircleId);
        if (configuredInstitutionRole && configuredInstitutionRole !== 'target' && configuredInstitutionRole !== 'committee') {
            throw new Error('invalid_contribution_institution_role');
        }
        if (
            configuredInstitutionRole === 'committee'
            && (!Number.isInteger(configuredInstitutionCircleId) || configuredInstitutionCircleId <= 0)
        ) {
            throw new Error('invalid_contribution_committee_circle');
        }
        if (
            configuredInstitutionRole === 'target'
            && ref.metadata?.institutionCircleId !== undefined
            && configuredInstitutionCircleId !== input.circleId
        ) {
            throw new Error('invalid_contribution_target_circle');
        }
        const institutionRole: ContributionRoleFact['institutionRole'] = configuredInstitutionRole === 'committee'
            && Number.isInteger(configuredInstitutionCircleId)
            && configuredInstitutionCircleId > 0
            ? 'committee'
            : 'target';
        return {
            factId: ref.refId,
            actorPubkey: ref.contributorPubkey,
            actorRole,
            contributionFunction,
            proofContribution,
            weightTreatment,
            reasonCode: normalizeNullableString(ref.metadata?.reasonCode) ?? defaultReasonCode,
            evidenceRefs: [ref.refId],
            targetCircleId: input.circleId,
            institutionRole,
            institutionCircleId: institutionRole === 'committee'
                ? configuredInstitutionCircleId
                : input.circleId,
            governanceCaseId: normalizeNullableString(ref.metadata?.governanceCaseId),
            governanceRequestId: normalizeNullableString(ref.metadata?.governanceRequestId),
        };
    }).sort((left, right) => left.factId.localeCompare(right.factId));
}

export function inferDraftContributionOrigin(input: {
    postContentType?: string | null;
    candidateAcceptedByUserId?: number | null;
    candidateAttemptedByUserId?: number | null;
    sourceKind?: 'auto_draft' | 'manual_selection' | null;
}): DraftContributionOrigin {
    if (input.sourceKind === 'manual_selection') return 'manual_selection_ai';
    if (
        normalizeString(input.postContentType).toLowerCase() === 'ai/discussion-draft'
        || hasPresentPositiveIntegerId(input.candidateAcceptedByUserId)
        || hasPresentPositiveIntegerId(input.candidateAttemptedByUserId)
        || input.sourceKind === 'auto_draft'
    ) {
        return 'ai_discussion_candidate';
    }
    return 'direct_human';
}

export function normalizeEvidenceContributors(
    contributors: ContributionEvidenceContributor[],
): ContributionEvidenceContributor[] {
    const byPubkey = new Map<string, ContributionEvidenceContributor>();
    for (const contributor of contributors) {
        const pubkey = canonicalSolanaPublicKeyString(contributor.pubkey);
        if (!pubkey) {
            throw new Error('invalid_contribution_evidence_contributor_pubkey');
        }
        const existing = byPubkey.get(pubkey);
        const roles = Array.from(new Set([
            ...(existing?.evidenceRoles ?? []),
            ...(contributor.evidenceRoles ?? []),
        ])).sort();
        byPubkey.set(pubkey, {
            pubkey,
            userId: chooseStableNullableNumber(existing?.userId, contributor.userId),
            handle: chooseStableNullableString(existing?.handle, contributor.handle),
            evidenceRoles: roles,
        });
    }
    return [...byPubkey.values()].sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

export function normalizeEvidenceRefs(
    refs: ContributionEvidenceRef[],
    contributorPubkeys: Set<string>,
): ContributionEvidenceRef[] {
    const byRefId = new Map<string, ContributionEvidenceRef>();
    refs
        .slice(0, MAX_EVIDENCE_REFS)
        .map((ref) => {
            const contributorPubkey = ref.contributorPubkey === null
                ? null
                : canonicalSolanaPublicKeyString(ref.contributorPubkey);
            if (ref.contributorPubkey !== null && !contributorPubkey) {
                throw new Error('invalid_contribution_evidence_ref_pubkey');
            }
            return {
                refId: normalizeString(ref.refId),
                refType: ref.refType,
                contributorPubkey:
                    contributorPubkey && contributorPubkeys.has(contributorPubkey)
                        ? contributorPubkey
                        : null,
                hash: normalizeHex64(ref.hash),
                excerpt: ref.excerpt === null ? null : clampText(ref.excerpt, MAX_EVIDENCE_EXCERPT_CHARS),
                stage: ref.stage,
                retention: ref.retention,
                metadata: ref.metadata && typeof ref.metadata === 'object' ? ref.metadata : {},
            };
        })
        .filter((ref) => ref.refId.length > 0)
        .sort((a, b) => {
            if (a.refId !== b.refId) return a.refId.localeCompare(b.refId);
            return stableStringify(a).localeCompare(stableStringify(b));
        })
        .forEach((ref) => {
            if (!byRefId.has(ref.refId)) {
                byRefId.set(ref.refId, ref);
            }
        });
    return [...byRefId.values()].sort((a, b) => a.refId.localeCompare(b.refId));
}

export function createContributionEvidencePackage(input: {
    draftPostId: number;
    circleId: number;
    postContentType?: string | null;
    postAuthorUserId?: number | null;
    snapshotCreatedByUserId?: number | null;
    candidateAcceptedByUserId?: number | null;
    candidateAttemptedByUserId?: number | null;
    sourceKind?: 'auto_draft' | 'manual_selection' | null;
    sourceAnchor?: ContributionEvidencePackage['sourceAnchor'];
    stableSnapshot: ContributionEvidencePackage['stableSnapshot'];
    contributors: ContributionEvidenceContributor[];
    evidenceRefs: ContributionEvidenceRef[];
    finalContent: string;
}): ContributionEvidencePackage {
    const contributors = normalizeEvidenceContributors(input.contributors);
    const contributorPubkeys = new Set(contributors.map((contributor) => contributor.pubkey));
    const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, contributorPubkeys);
    const roleFacts = buildContributionRoleFacts({
        circleId: input.circleId,
        evidenceRefs,
    });
    const finalContentDigest = sha256Hex(String(input.finalContent ?? ''));
    return {
        schemaVersion: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        draftOrigin: inferDraftContributionOrigin(input),
        sourceAnchor: input.sourceAnchor
            ? {
                anchorId: normalizeHex64(input.sourceAnchor.anchorId) ?? input.sourceAnchor.anchorId,
                payloadHash: normalizeHex64(input.sourceAnchor.payloadHash) ?? input.sourceAnchor.payloadHash,
                summaryHash: normalizeHex64(input.sourceAnchor.summaryHash) ?? input.sourceAnchor.summaryHash,
                sourceMessagesDigest:
                    normalizeHex64(input.sourceAnchor.sourceMessagesDigest)
                    ?? input.sourceAnchor.sourceMessagesDigest,
            }
            : null,
        stableSnapshot: {
            draftVersion: Number(input.stableSnapshot.draftVersion || 0),
            contentHash: normalizeHex64(input.stableSnapshot.contentHash) ?? input.stableSnapshot.contentHash,
            sourceEditAnchorId: normalizeNullableString(input.stableSnapshot.sourceEditAnchorId),
            sourceSummaryHash: normalizeHex64(input.stableSnapshot.sourceSummaryHash),
            sourceMessagesDigest: normalizeHex64(input.stableSnapshot.sourceMessagesDigest),
        },
        contributors,
        evidenceRefs,
        roleFacts,
        finalContentDigest,
        boundedFinalContentExcerpt: clampText(input.finalContent, MAX_FINAL_CONTENT_EXCERPT_CHARS),
        inputContext: {
            postContentType: normalizeNullableString(input.postContentType),
            postAuthorUserId: input.postAuthorUserId ?? null,
            snapshotCreatedByUserId: input.snapshotCreatedByUserId ?? null,
            candidateAcceptedByUserId: input.candidateAcceptedByUserId ?? null,
            candidateAttemptedByUserId: input.candidateAttemptedByUserId ?? null,
            sourceKind: input.sourceKind ?? null,
        },
    };
}

function normalizeContributionEvidencePackageForHash(
    input: ContributionEvidencePackage,
): ContributionEvidencePackage {
    return {
        ...input,
        contributors: [...input.contributors]
            .map((contributor) => ({
                ...contributor,
                evidenceRoles: [...contributor.evidenceRoles].sort(),
            }))
            .sort((a, b) => a.pubkey.localeCompare(b.pubkey)),
        evidenceRefs: [...input.evidenceRefs]
            .sort((a, b) => a.refId.localeCompare(b.refId)),
        roleFacts: [...input.roleFacts]
            .sort((a, b) => a.factId.localeCompare(b.factId)),
    };
}

export function hashContributionEvidencePackage(input: ContributionEvidencePackage): string {
    return sha256Hex(stableStringify(normalizeContributionEvidencePackageForHash(input)));
}
