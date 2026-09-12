import { Prisma, type PrismaClient } from '@prisma/client';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import type {
    ContributionAssessmentDecisionType,
} from './types';
import {
    getHighPenetrationReviewPolicy,
    type HighPenetrationReviewPolicy,
} from './policy';
import {
    logContributionAssessmentEvent,
} from './logging';
import { readContributionAssessmentArtifactSnapshots } from './artifact';

const VALID_DECISION_TYPES = new Set<ContributionAssessmentDecisionType>([
    'review_before_crystallize',
    'continue_with_fallback',
    'confirm_high_penetration',
    'reject_high_penetration',
    'request_correction',
    'supersede_assessment',
]);

const MUTABLE_ASSESSMENT_STATUSES = new Set<string>([
    'prepared',
    'needs_review',
    'fallback_applied',
    'confirmed',
]);

export type ContributionAssessmentDecisionAuthority =
    | 'draft_reader'
    | 'circle_owner'
    | 'circle_manager'
    | 'system';

export type ContributionAssessmentActionAuthority =
    | ContributionAssessmentDecisionAuthority
    | 'crystallization_workflow';

export type ContributionAssessmentGateState =
    | 'not_prepared'
    | 'ready'
    | 'assessment_unavailable'
    | 'high_penetration_needs_review'
    | 'high_penetration_confirmed'
    | 'fallback_selected'
    | 'high_penetration_rejected'
    | 'assessment_superseded'
    | 'assessment_failed';

export interface ContributionAssessmentPublicRecord {
    id: string;
    draftPostId: number;
    proofPackageId: string | null;
    proofPackageHash: string | null;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    canonicalContributorsRoot: string | null;
    canonicalContributorsCount: number | null;
    status: string;
    highPenetrationState: string;
    signerKeyId: string;
    signature: string;
    createdAt: string;
    updatedAt: string;
}

export interface ContributionAssessmentDecisionPublicRecord {
    id: string;
    assessmentId: string;
    decisionType: ContributionAssessmentDecisionType;
    candidateId: string | null;
    actorUserId: number | null;
    actorPubkey: string | null;
    reason: string | null;
    affectedRefs: string[];
    createdAt: string;
}

export interface ContributionAssessmentGateAction {
    action: 'review_before_crystallize' | 'confirm_high_penetration' | 'reject_high_penetration';
    decisionType: ContributionAssessmentDecisionType;
    authority: ContributionAssessmentActionAuthority;
}

export interface ContributionAssessmentGate {
    required: boolean;
    state: ContributionAssessmentGateState;
    primaryAction: ContributionAssessmentGateAction['action'] | null;
    fallbackAction: ContributionAssessmentGateAction['action'] | null;
    availableActions: ContributionAssessmentGateAction[];
}

export interface PreparedContributionAssessment {
    draftPostId: number;
    assessment: ContributionAssessmentPublicRecord | null;
    decisions: ContributionAssessmentDecisionPublicRecord[];
    gate: ContributionAssessmentGate;
}

export interface ContributionAssessmentForProof extends PreparedContributionAssessment {
    proofBinding: {
        allowed: boolean;
        mode: 'assessment' | 'fallback' | 'none';
        blockedReason: string | null;
    };
}

export interface RecordContributionAssessmentDecisionInput {
    draftPostId: number;
    assessmentId?: bigint | number | string | null;
    decisionType: ContributionAssessmentDecisionType | string;
    candidateId?: string | null;
    actorUserId?: number | null;
    actorPubkey?: string | null;
    reason?: string | null;
    affectedRefs?: string[] | null;
    authority?: ContributionAssessmentDecisionAuthority | null;
    allowFallback?: boolean;
    allowManagerHighPenetrationConfirmation?: boolean;
}

interface ContributionAssessmentRow {
    id: bigint;
    draftPostId: number;
    proofPackageId: bigint | null;
    proofPackageHash: string | null;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    canonicalContributorsRoot: string | null;
    canonicalContributorsCount: number | null;
    status: string;
    highPenetrationState: string;
    signerKeyId: string;
    signature: string;
    createdAt: Date;
    updatedAt: Date;
}

interface ContributionAssessmentDecisionRow {
    id: bigint;
    assessmentId: bigint;
    decisionType: string;
    candidateId: string | null;
    actorUserId: number | null;
    actorPubkey: string | null;
    reason: string | null;
    affectedRefs: unknown;
    createdAt: Date;
}

export class ContributionAssessmentDecisionError extends Error {
    readonly code: string;
    readonly statusCode: number;

    constructor(code: string, message: string, statusCode = 400) {
        super(message);
        this.name = 'ContributionAssessmentDecisionError';
        this.code = code;
        this.statusCode = statusCode;
    }

    toResponseBody() {
        return {
            error: this.code,
            message: this.message,
        };
    }
}

function normalizePositiveInt(value: unknown, errorCode: string): number {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : NaN;
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
        throw new ContributionAssessmentDecisionError(errorCode, errorCode);
    }
    return numeric;
}

function normalizeOptionalPositiveInt(value: unknown, errorCode: string): number | null {
    if (value === null || value === undefined || value === '') return null;
    return normalizePositiveInt(value, errorCode);
}

function normalizeBigIntId(value: bigint | number | string | null | undefined, errorCode: string): bigint | null {
    if (value === null || value === undefined || value === '') return null;
    let id: bigint;
    if (typeof value === 'bigint') {
        id = value;
    } else if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new ContributionAssessmentDecisionError(errorCode, errorCode);
        }
        id = BigInt(value);
    } else {
        const normalized = String(value).trim();
        if (!/^[0-9]+$/.test(normalized)) {
            throw new ContributionAssessmentDecisionError(errorCode, errorCode);
        }
        id = BigInt(normalized);
    }
    if (id <= BigInt(0)) {
        throw new ContributionAssessmentDecisionError(errorCode, errorCode);
    }
    return id;
}

function normalizeDecisionType(value: string): ContributionAssessmentDecisionType {
    const normalized = String(value || '').trim() as ContributionAssessmentDecisionType;
    if (!VALID_DECISION_TYPES.has(normalized)) {
        throw new ContributionAssessmentDecisionError(
            'invalid_contribution_assessment_decision_type',
            'invalid contribution assessment decision type',
        );
    }
    return normalized;
}

function normalizeCandidateId(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).trim();
    if (!/^[A-Za-z0-9:_./-]{1,96}$/.test(normalized)) {
        throw new ContributionAssessmentDecisionError(
            'invalid_contribution_assessment_candidate_id',
            'invalid contribution assessment candidate id',
        );
    }
    return normalized;
}

function normalizeReason(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).trim();
    if (normalized.length > 2000) {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_decision_reason_too_long',
            'contribution assessment decision reason is too long',
        );
    }
    return normalized || null;
}

function normalizeActorPubkey(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    const normalized = canonicalSolanaPublicKeyString(value);
    if (!normalized) {
        throw new ContributionAssessmentDecisionError('invalid_actor_pubkey', 'invalid actor pubkey');
    }
    return normalized;
}

function normalizeAffectedRefs(value: string[] | null | undefined): string[] {
    if (!value) return [];
    if (!Array.isArray(value)) {
        throw new ContributionAssessmentDecisionError(
            'invalid_contribution_assessment_affected_refs',
            'invalid contribution assessment affected refs',
        );
    }
    const refs: string[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const ref = String(raw || '').trim();
        if (!ref || ref.length > 160) {
            throw new ContributionAssessmentDecisionError(
                'invalid_contribution_assessment_affected_ref',
                'invalid contribution assessment affected ref',
            );
        }
        if (seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
    }
    if (refs.length > 100) {
        throw new ContributionAssessmentDecisionError(
            'too_many_contribution_assessment_affected_refs',
            'too many contribution assessment affected refs',
        );
    }
    return refs;
}

function normalizeAffectedRefsFromRow(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item)).filter(Boolean);
}

function mapAssessmentRow(row: ContributionAssessmentRow): ContributionAssessmentPublicRecord {
    return {
        id: row.id.toString(),
        draftPostId: row.draftPostId,
        proofPackageId: row.proofPackageId ? row.proofPackageId.toString() : null,
        proofPackageHash: row.proofPackageHash,
        algorithmVersion: row.algorithmVersion,
        framePolicyVersion: row.framePolicyVersion,
        inputHash: row.inputHash,
        outputHash: row.outputHash,
        canonicalAllocationHash: row.canonicalAllocationHash,
        canonicalContributorsRoot: row.canonicalContributorsRoot,
        canonicalContributorsCount: row.canonicalContributorsCount,
        status: row.status,
        highPenetrationState: row.highPenetrationState,
        signerKeyId: row.signerKeyId,
        signature: row.signature,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function mapDecisionRow(row: ContributionAssessmentDecisionRow): ContributionAssessmentDecisionPublicRecord {
    return {
        id: row.id.toString(),
        assessmentId: row.assessmentId.toString(),
        decisionType: normalizeDecisionType(row.decisionType),
        candidateId: row.candidateId,
        actorUserId: row.actorUserId,
        actorPubkey: row.actorPubkey,
        reason: row.reason,
        affectedRefs: normalizeAffectedRefsFromRow(row.affectedRefs),
        createdAt: row.createdAt.toISOString(),
    };
}

function isPendingHighPenetrationReview(assessment: ContributionAssessmentPublicRecord): boolean {
    if (assessment.status === 'bound') return false;
    return assessment.status === 'needs_review'
        || assessment.highPenetrationState === 'needs_review'
        || assessment.highPenetrationState === 'fallback_applied';
}

function hasAssessmentLevelDecision(
    decisions: ContributionAssessmentDecisionPublicRecord[],
    decisionType: ContributionAssessmentDecisionType,
): boolean {
    return decisions.some((decision) => decision.decisionType === decisionType && !decision.candidateId);
}

function isProofLinkedAssessment(assessment: ContributionAssessmentPublicRecord): boolean {
    return Boolean(assessment.proofPackageHash)
        && Boolean(assessment.canonicalContributorsRoot)
        && Number(assessment.canonicalContributorsCount ?? 0) > 0;
}

function isUnavailableAssessmentAlgorithm(algorithmVersion: string | null | undefined): boolean {
    const normalized = String(algorithmVersion ?? '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized.endsWith(':assessment-unavailable:v1')
        || normalized.endsWith(':fallback-decision-unavailable:v1')
        || normalized.endsWith(':empty-unavailable:v1')
        || normalized.includes('fallback')
        || normalized === 'disabled:assessment-unavailable:v1'
        || normalized === 'disabled:deterministic-fallback:v1';
}

export function isContributionAssessmentUnavailable(
    assessment: ContributionAssessmentPublicRecord | null,
): boolean {
    if (!assessment) return false;
    if (isProofLinkedAssessment(assessment)) return false;
    return isUnavailableAssessmentAlgorithm(assessment.algorithmVersion);
}

export function resolveContributionAssessmentGate(input: {
    assessment: ContributionAssessmentPublicRecord | null;
    decisions?: ContributionAssessmentDecisionPublicRecord[];
    reviewPolicy?: HighPenetrationReviewPolicy;
}): ContributionAssessmentGate {
    const decisions = input.decisions ?? [];
    const reviewPolicy = input.reviewPolicy ?? getHighPenetrationReviewPolicy();
    if (!input.assessment) {
        return {
            required: false,
            state: 'not_prepared',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (input.assessment.status === 'superseded') {
        return {
            required: false,
            state: 'assessment_superseded',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (input.assessment.status === 'failed') {
        return {
            required: false,
            state: 'assessment_failed',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (hasAssessmentLevelDecision(decisions, 'supersede_assessment')) {
        return {
            required: false,
            state: 'assessment_superseded',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    const hasBoundFallback =
        hasAssessmentLevelDecision(decisions, 'continue_with_fallback')
        && isProofLinkedAssessment(input.assessment)
        && (
            input.assessment.status === 'bound'
            || input.assessment.status === 'confirmed'
            || input.assessment.status === 'fallback_applied'
        );
    if (hasBoundFallback) {
        return {
            required: false,
            state: 'fallback_selected',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (isContributionAssessmentUnavailable(input.assessment)) {
        return {
            required: false,
            state: 'assessment_unavailable',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (
        input.assessment.highPenetrationState === 'confirmed'
        || hasAssessmentLevelDecision(decisions, 'confirm_high_penetration')
    ) {
        return {
            required: false,
            state: 'high_penetration_confirmed',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (
        input.assessment.highPenetrationState === 'rejected'
        || hasAssessmentLevelDecision(decisions, 'reject_high_penetration')
    ) {
        return {
            required: false,
            state: 'high_penetration_rejected',
            primaryAction: null,
            fallbackAction: null,
            availableActions: [],
        };
    }
    if (isPendingHighPenetrationReview(input.assessment)) {
        const availableActions: ContributionAssessmentGateAction[] = [
            {
                action: 'review_before_crystallize',
                decisionType: 'review_before_crystallize',
                authority: 'draft_reader',
            },
        ];
        availableActions.push({
            action: 'confirm_high_penetration',
            decisionType: 'confirm_high_penetration',
            authority: reviewPolicy.confirmationAuthority,
        });
        availableActions.push({
            action: 'reject_high_penetration',
            decisionType: 'reject_high_penetration',
            authority: reviewPolicy.confirmationAuthority,
        });
        return {
            required: true,
            state: 'high_penetration_needs_review',
            primaryAction: 'review_before_crystallize',
            fallbackAction: null,
            availableActions,
        };
    }
    return {
        required: false,
        state: 'ready',
        primaryAction: null,
        fallbackAction: null,
        availableActions: [],
    };
}

async function loadContributionAssessmentRows(
    prisma: PrismaClient | Prisma.TransactionClient,
    input: { draftPostId: number; assessmentId?: bigint | null; lockForUpdate?: boolean },
): Promise<ContributionAssessmentRow[]> {
    if (input.assessmentId) {
        if (input.lockForUpdate) {
            return prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
                SELECT
                    id,
                    draft_post_id AS "draftPostId",
                    proof_package_id AS "proofPackageId",
                    proof_package_hash AS "proofPackageHash",
                    algorithm_version AS "algorithmVersion",
                    frame_policy_version AS "framePolicyVersion",
                    input_hash AS "inputHash",
                    output_hash AS "outputHash",
                    canonical_allocation_hash AS "canonicalAllocationHash",
                    canonical_contributors_root AS "canonicalContributorsRoot",
                    canonical_contributors_count AS "canonicalContributorsCount",
                    status,
                    high_penetration_state AS "highPenetrationState",
                    signer_key_id AS "signerKeyId",
                    signature,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM contribution_assessments
                WHERE draft_post_id = ${input.draftPostId}
                  AND id = ${input.assessmentId}
                LIMIT 1
                FOR UPDATE
            `);
        }
        return prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
            SELECT
                id,
                draft_post_id AS "draftPostId",
                proof_package_id AS "proofPackageId",
                proof_package_hash AS "proofPackageHash",
                algorithm_version AS "algorithmVersion",
                frame_policy_version AS "framePolicyVersion",
                input_hash AS "inputHash",
                output_hash AS "outputHash",
                canonical_allocation_hash AS "canonicalAllocationHash",
                canonical_contributors_root AS "canonicalContributorsRoot",
                canonical_contributors_count AS "canonicalContributorsCount",
                status,
                high_penetration_state AS "highPenetrationState",
                signer_key_id AS "signerKeyId",
                signature,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM contribution_assessments
            WHERE draft_post_id = ${input.draftPostId}
              AND id = ${input.assessmentId}
            LIMIT 1
        `);
    }
    if (input.lockForUpdate) {
        return prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
            SELECT
                id,
                draft_post_id AS "draftPostId",
                proof_package_id AS "proofPackageId",
                proof_package_hash AS "proofPackageHash",
                algorithm_version AS "algorithmVersion",
                frame_policy_version AS "framePolicyVersion",
                input_hash AS "inputHash",
                output_hash AS "outputHash",
                canonical_allocation_hash AS "canonicalAllocationHash",
                canonical_contributors_root AS "canonicalContributorsRoot",
                canonical_contributors_count AS "canonicalContributorsCount",
                status,
                high_penetration_state AS "highPenetrationState",
                signer_key_id AS "signerKeyId",
                signature,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM contribution_assessments
            WHERE draft_post_id = ${input.draftPostId}
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            FOR UPDATE
        `);
    }
    return prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
        SELECT
            id,
            draft_post_id AS "draftPostId",
            proof_package_id AS "proofPackageId",
            proof_package_hash AS "proofPackageHash",
            algorithm_version AS "algorithmVersion",
            frame_policy_version AS "framePolicyVersion",
            input_hash AS "inputHash",
            output_hash AS "outputHash",
            canonical_allocation_hash AS "canonicalAllocationHash",
            canonical_contributors_root AS "canonicalContributorsRoot",
            canonical_contributors_count AS "canonicalContributorsCount",
            status,
            high_penetration_state AS "highPenetrationState",
            signer_key_id AS "signerKeyId",
            signature,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM contribution_assessments
        WHERE draft_post_id = ${input.draftPostId}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `);
}

async function loadContributionAssessment(
    prisma: PrismaClient | Prisma.TransactionClient,
    input: { draftPostId: number; assessmentId?: bigint | null; lockForUpdate?: boolean },
): Promise<ContributionAssessmentPublicRecord | null> {
    const rows = await loadContributionAssessmentRows(prisma, input);
    const row = rows[0] || null;
    return row ? mapAssessmentRow(row) : null;
}

async function loadContributionAssessmentDecisions(
    prisma: PrismaClient | Prisma.TransactionClient,
    assessmentId: bigint,
): Promise<ContributionAssessmentDecisionPublicRecord[]> {
    const rows = await prisma.$queryRaw<ContributionAssessmentDecisionRow[]>(Prisma.sql`
        SELECT
            id,
            assessment_id AS "assessmentId",
            decision_type AS "decisionType",
            candidate_id AS "candidateId",
            actor_user_id AS "actorUserId",
            actor_pubkey AS "actorPubkey",
            reason,
            affected_refs AS "affectedRefs",
            created_at AS "createdAt"
        FROM contribution_assessment_decisions
        WHERE assessment_id = ${assessmentId}
        ORDER BY created_at ASC, id ASC
    `);
    return rows.map(mapDecisionRow);
}

function normalizeAssessmentIdFromRecord(assessment: ContributionAssessmentPublicRecord): bigint {
    return normalizeBigIntId(assessment.id, 'invalid_assessment_id')!;
}

export async function prepareDraftContributionAssessment(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        assessmentId?: bigint | number | string | null;
    },
): Promise<PreparedContributionAssessment> {
    const draftPostId = normalizePositiveInt(input.draftPostId, 'invalid_draft_post_id');
    const assessmentId = normalizeBigIntId(input.assessmentId, 'invalid_assessment_id');
    const assessment = await loadContributionAssessment(prisma, { draftPostId, assessmentId });
    if (!assessment) {
        return {
            draftPostId,
            assessment: null,
            decisions: [],
            gate: resolveContributionAssessmentGate({ assessment: null }),
        };
    }
    const decisions = await loadContributionAssessmentDecisions(prisma, normalizeAssessmentIdFromRecord(assessment));
    return {
        draftPostId,
        assessment,
        decisions,
        gate: resolveContributionAssessmentGate({ assessment, decisions }),
    };
}

function assertAssessmentMutableForDecision(
    assessment: ContributionAssessmentPublicRecord,
    decisionType: ContributionAssessmentDecisionType,
    decisions: ContributionAssessmentDecisionPublicRecord[],
): void {
    if (decisionType === 'request_correction') {
        if (assessment.status === 'failed') {
            throw new ContributionAssessmentDecisionError(
                'contribution_assessment_failed',
                'failed contribution assessment cannot receive a correction request',
                409,
            );
        }
        return;
    }
    if (assessment.status === 'bound') {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_already_bound',
            'contribution assessment is already bound to a proof package',
            409,
        );
    }
    if (assessment.status === 'superseded') {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_superseded',
            'contribution assessment is superseded',
            409,
        );
    }
    if (assessment.status === 'failed') {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_failed',
            'contribution assessment has failed and cannot receive public decisions',
            409,
        );
    }
    if (!MUTABLE_ASSESSMENT_STATUSES.has(assessment.status)) {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_status_not_mutable',
            'contribution assessment status is not mutable',
            409,
        );
    }
    if (decisionType === 'supersede_assessment') return;
    const gate = resolveContributionAssessmentGate({ assessment, decisions });
    if (gate.state === 'assessment_unavailable') {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_unavailable_not_reviewable',
            'contribution assessment is unavailable and cannot be reviewed',
            409,
        );
    }
    if (!gate.required) {
        throw new ContributionAssessmentDecisionError(
            gate.state === 'high_penetration_confirmed'
                || gate.state === 'fallback_selected'
                || gate.state === 'high_penetration_rejected'
                ? 'contribution_assessment_review_already_resolved'
                : 'contribution_assessment_no_pending_high_penetration_review',
            'contribution assessment has no pending high-penetration review',
            409,
        );
    }
    if (
        (decisionType === 'confirm_high_penetration'
            || decisionType === 'reject_high_penetration'
            || decisionType === 'continue_with_fallback'
            || decisionType === 'review_before_crystallize')
        && !isPendingHighPenetrationReview(assessment)
    ) {
        throw new ContributionAssessmentDecisionError(
            assessment.highPenetrationState === 'confirmed'
                || assessment.highPenetrationState === 'rejected'
                ? 'contribution_assessment_review_already_resolved'
                : 'contribution_assessment_no_pending_high_penetration_review',
            'contribution assessment has no pending high-penetration review',
            409,
        );
    }
}

function assertDecisionAuthority(input: {
    decisionType: ContributionAssessmentDecisionType;
    authority: ContributionAssessmentDecisionAuthority | null;
    allowFallback: boolean;
    allowManagerHighPenetrationConfirmation: boolean;
}): void {
    if (input.decisionType === 'continue_with_fallback') {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_fallback_continuation_removed',
            'fallback contribution allocation cannot be used for proof binding',
            409,
        );
    }
    if (
        input.decisionType === 'confirm_high_penetration'
        || input.decisionType === 'reject_high_penetration'
        || input.decisionType === 'supersede_assessment'
    ) {
        const ownerAuthorized = input.authority === 'circle_owner' || input.authority === 'system';
        const managerAuthorized =
            input.allowManagerHighPenetrationConfirmation
            && input.authority === 'circle_manager';
        if (!ownerAuthorized && !managerAuthorized) {
            throw new ContributionAssessmentDecisionError(
                'contribution_assessment_decision_unauthorized',
                'high-penetration contribution assessment decisions require circle owner authority',
                403,
            );
        }
    }
}

function assertDecisionCandidateScope(input: {
    decisionType: ContributionAssessmentDecisionType;
    candidateId: string | null;
}): void {
    if (
        input.candidateId
        && (
            input.decisionType === 'confirm_high_penetration'
            || input.decisionType === 'reject_high_penetration'
            || input.decisionType === 'continue_with_fallback'
            || input.decisionType === 'request_correction'
        )
    ) {
        throw new ContributionAssessmentDecisionError(
            'contribution_assessment_candidate_scoped_decision_not_supported',
            'public contribution assessment decisions are assessment-level in this workflow',
            400,
        );
    }
}

export async function recordContributionAssessmentDecision(
    prisma: PrismaClient,
    input: RecordContributionAssessmentDecisionInput,
): Promise<PreparedContributionAssessment & {
    decision: ContributionAssessmentDecisionPublicRecord;
}> {
    const draftPostId = normalizePositiveInt(input.draftPostId, 'invalid_draft_post_id');
    const assessmentId = normalizeBigIntId(input.assessmentId, 'invalid_assessment_id');
    const decisionType = normalizeDecisionType(String(input.decisionType || ''));
    const candidateId = normalizeCandidateId(input.candidateId);
    const actorUserId = normalizeOptionalPositiveInt(input.actorUserId, 'invalid_actor_user_id');
    const actorPubkey = normalizeActorPubkey(input.actorPubkey);
    const reason = normalizeReason(input.reason);
    const affectedRefs = normalizeAffectedRefs(input.affectedRefs);
    const canonicalAffectedRefs = decisionType === 'request_correction'
        ? [...affectedRefs].sort()
        : affectedRefs;
    const authority = input.authority ?? 'draft_reader';
    const reviewPolicy = getHighPenetrationReviewPolicy();
    assertDecisionCandidateScope({ decisionType, candidateId });

    if (decisionType === 'request_correction') {
        if (!actorUserId || !actorPubkey) {
            throw new ContributionAssessmentDecisionError(
                'contribution_correction_actor_required',
                'authenticated actor is required for a contribution correction request',
                401,
            );
        }
        if (!reason) {
            throw new ContributionAssessmentDecisionError(
                'contribution_correction_reason_required',
                'contribution correction reason is required',
            );
        }
        if (canonicalAffectedRefs.length === 0) {
            throw new ContributionAssessmentDecisionError(
                'contribution_correction_evidence_refs_required',
                'contribution correction must identify at least one evidence ref',
            );
        }
    }

    assertDecisionAuthority({
        decisionType,
        authority,
        allowFallback: input.allowFallback ?? reviewPolicy.allowFallbackContinuation,
        allowManagerHighPenetrationConfirmation:
            input.allowManagerHighPenetrationConfirmation
            ?? reviewPolicy.confirmationAuthority === 'circle_manager',
    });

    const result = await prisma.$transaction(async (tx) => {
        const assessment = await loadContributionAssessment(tx, {
            draftPostId,
            assessmentId,
            lockForUpdate: true,
        });
        if (!assessment) {
            throw new ContributionAssessmentDecisionError(
                'contribution_assessment_not_found',
                'contribution assessment is not found',
                404,
            );
        }
        const existingDecisions = await loadContributionAssessmentDecisions(
            tx,
            normalizeAssessmentIdFromRecord(assessment),
        );
        assertAssessmentMutableForDecision(assessment, decisionType, existingDecisions);

        if (decisionType === 'request_correction') {
            const artifactRow = await tx.contributionAssessment.findUnique({
                where: { id: normalizeAssessmentIdFromRecord(assessment) },
                select: {
                    signedArtifact: true,
                    inputHash: true,
                    outputHash: true,
                    canonicalAllocationHash: true,
                    signerKeyId: true,
                    signature: true,
                },
            });
            const snapshots = artifactRow
                ? readContributionAssessmentArtifactSnapshots({
                    signedArtifact: artifactRow.signedArtifact,
                    inputHash: artifactRow.inputHash,
                    outputHash: artifactRow.outputHash,
                    canonicalAllocationHash: artifactRow.canonicalAllocationHash,
                    signerKeyId: artifactRow.signerKeyId,
                    signature: artifactRow.signature,
                })
                : null;
            if (!snapshots) {
                throw new ContributionAssessmentDecisionError(
                    'contribution_correction_snapshot_unavailable',
                    'contribution correction requires a verified assessment snapshot',
                    409,
                );
            }
            const evidenceRefs = new Set(snapshots.evidence.evidenceRefs.map((ref) => ref.refId));
            if (canonicalAffectedRefs.some((ref) => !evidenceRefs.has(ref))) {
                throw new ContributionAssessmentDecisionError(
                    'contribution_correction_evidence_ref_invalid',
                    'contribution correction evidence ref is not part of the frozen assessment',
                    409,
                );
            }
            const existingCorrection = existingDecisions.find((decision) =>
                decision.decisionType === decisionType
                && decision.actorUserId === actorUserId
                && decision.actorPubkey === actorPubkey
                && decision.reason === reason
                && JSON.stringify([...decision.affectedRefs].sort()) === JSON.stringify(canonicalAffectedRefs)
            );
            if (existingCorrection) {
                return {
                    draftPostId,
                    assessment,
                    decisions: existingDecisions,
                    gate: resolveContributionAssessmentGate({ assessment, decisions: existingDecisions }),
                    decision: existingCorrection,
                };
            }
        }

        const rows = await tx.$queryRaw<ContributionAssessmentDecisionRow[]>(Prisma.sql`
            INSERT INTO contribution_assessment_decisions (
                assessment_id,
                decision_type,
                candidate_id,
                actor_user_id,
                actor_pubkey,
                reason,
                affected_refs,
                created_at
            )
            VALUES (
                ${normalizeAssessmentIdFromRecord(assessment)},
                ${decisionType},
                ${candidateId},
                ${actorUserId},
                ${actorPubkey},
                ${reason},
                ${JSON.stringify(canonicalAffectedRefs)}::jsonb,
                NOW()
            )
            RETURNING
                id,
                assessment_id AS "assessmentId",
                decision_type AS "decisionType",
                candidate_id AS "candidateId",
                actor_user_id AS "actorUserId",
                actor_pubkey AS "actorPubkey",
                reason,
                affected_refs AS "affectedRefs",
                created_at AS "createdAt"
        `);
        const decision = rows[0] ? mapDecisionRow(rows[0]) : null;
        if (!decision) {
            throw new ContributionAssessmentDecisionError(
                'contribution_assessment_decision_persist_failed',
                'failed to persist contribution assessment decision',
                500,
            );
        }
        const decisions = await loadContributionAssessmentDecisions(tx, normalizeAssessmentIdFromRecord(assessment));
        return {
            draftPostId,
            assessment,
            decisions,
            gate: resolveContributionAssessmentGate({
                assessment,
                decisions,
            }),
            decision,
        };
    });
    if (
        decisionType === 'continue_with_fallback'
        || decisionType === 'confirm_high_penetration'
        || decisionType === 'reject_high_penetration'
    ) {
        logContributionAssessmentEvent('info', 'high_penetration_decision_recorded', {
            draftPostId,
            assessmentId: result.assessment.id,
            decisionId: result.decision.id,
            decisionType,
            decisionAuthority: authority,
            requiredAuthorization: decisionType === 'continue_with_fallback'
                ? 'crystallization_workflow'
                : authority,
            actorUserId,
            actorPubkey: actorPubkey ? 'present' : null,
            affectedRefsCount: canonicalAffectedRefs.length,
            gateState: result.gate.state,
            gateRequired: result.gate.required,
        });
    }
    return result;
}

export async function resolveContributionAssessmentForProof(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        assessmentId?: bigint | number | string | null;
    },
): Promise<ContributionAssessmentForProof> {
    const prepared = await prepareDraftContributionAssessment(prisma, input);
    if (!prepared.assessment) {
        return {
            ...prepared,
            proofBinding: {
                allowed: false,
                mode: 'none',
                blockedReason: 'contribution_assessment_missing',
            },
        };
    }
    if (prepared.gate.required) {
        return {
            ...prepared,
            proofBinding: {
                allowed: false,
                mode: 'none',
                blockedReason: 'high_penetration_review_required',
            },
        };
    }
    if (prepared.gate.state === 'assessment_unavailable') {
        return {
            ...prepared,
            proofBinding: {
                allowed: false,
                mode: 'none',
                blockedReason: 'contribution_assessment_unavailable',
            },
        };
    }
    if (prepared.assessment.status === 'superseded' || prepared.assessment.status === 'failed') {
        return {
            ...prepared,
            proofBinding: {
                allowed: false,
                mode: 'none',
                blockedReason: `contribution_assessment_${prepared.assessment.status}`,
            },
        };
    }
    if (!isProofLinkedAssessment(prepared.assessment)) {
        return {
            ...prepared,
            proofBinding: {
                allowed: false,
                mode: 'none',
                blockedReason: 'contribution_assessment_proof_unavailable',
            },
        };
    }
    return {
        ...prepared,
        proofBinding: {
            allowed: true,
            mode: prepared.gate.state === 'fallback_selected' ? 'fallback' : 'assessment',
            blockedReason: null,
        },
    };
}
