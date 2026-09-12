import { Prisma, type PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

import { sqlTimestampWithoutTimeZone } from '../../utils/sqlTimestamp';
import {
    hashContributionEvidencePackage,
    sha256Hex,
    stableStringify,
} from './evidencePackage';
import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    type CanonicalContributionAllocation,
    type ContributionAssessmentStatus,
    type ContributionAssessmentSuggestion,
    type ContributionEvidencePackage,
    type ContributionHighPenetrationState,
} from './types';
import {
    issueDetachedDigestSignature,
    normalizeIsoDate,
    normalizeIssuerKeyId,
} from '../proofPackageIssuer';
import {
    logContributionAssessmentEvent,
} from './logging';
import {
    getContributionPolicySnapshot,
    hashContributionPolicySnapshot,
    type ContributionPolicyProfile,
} from './policy';

export const CONTRIBUTION_ASSESSMENT_ARTIFACT_DOMAIN = 'alcheme:contribution_assessment:v1';

const VALID_ASSESSMENT_STATUSES = new Set<ContributionAssessmentStatus>([
    'prepared',
    'needs_review',
    'fallback_applied',
    'confirmed',
    'bound',
    'superseded',
    'failed',
]);

const VALID_HIGH_PENETRATION_STATES = new Set<ContributionHighPenetrationState>([
    'none',
    'needs_review',
    'confirmed',
    'fallback_applied',
    'rejected',
]);

export interface ContributionAssessmentArtifactPayload {
    schema_version: typeof CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION;
    domain: typeof CONTRIBUTION_ASSESSMENT_ARTIFACT_DOMAIN;
    draft_post_id: number;
    circle_id: number;
    algorithm_version: string;
    frame_policy_version: string;
    contribution_policy_digest: string;
    input_hash: string;
    output_hash: string;
    canonical_allocation_hash: string;
    generated_at: string;
}

export interface SignedContributionAssessmentArtifact {
    payload: ContributionAssessmentArtifactPayload;
    contribution_policy: ContributionPolicyProfile;
    evidence: ContributionEvidencePackage;
    provider_output: ContributionAssessmentSuggestion;
    canonical_allocation: CanonicalContributionAllocation;
    canonical_message: string;
    digest: string;
    signer_key_id: string;
    signature: string;
    signed_at: string;
}

export interface SignContributionAssessmentArtifactInput {
    evidence: ContributionEvidencePackage;
    suggestion: ContributionAssessmentSuggestion;
    canonicalAllocation: CanonicalContributionAllocation;
    status?: ContributionAssessmentStatus;
    canonicalContributorsRoot?: string | null;
    canonicalContributorsCount?: number | null;
    generatedAt?: Date | string;
    signedAt?: Date | string;
    signerKeyId?: string;
    signerSecret?: string;
}

export interface ContributionAssessmentArtifactSnapshots {
    policy: ContributionPolicyProfile;
    policyDigest: string;
    evidence: ContributionEvidencePackage;
    suggestion: ContributionAssessmentSuggestion;
    canonicalAllocation: CanonicalContributionAllocation;
}

export interface ReadContributionAssessmentArtifactSnapshotsInput {
    signedArtifact: unknown;
    inputHash?: string | null;
    outputHash?: string | null;
    canonicalAllocationHash?: string | null;
    signerKeyId?: string | null;
    signature?: string | null;
}

export interface SignContributionAssessmentArtifactResult {
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    signedArtifact: SignedContributionAssessmentArtifact;
    signerKeyId: string;
    signature: string;
    signedAt: string;
}

export interface PersistContributionAssessmentInput {
    draftPostId: number;
    proofPackageId?: bigint | number | string | null;
    proofPackageHash?: string | null;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    canonicalContributorsRoot?: string | null;
    canonicalContributorsCount?: number | null;
    status: ContributionAssessmentStatus;
    highPenetrationState: ContributionHighPenetrationState;
    signedArtifact: Prisma.InputJsonValue;
    signerKeyId: string;
    signature: string;
}

export interface UpdateContributionAssessmentSignedArtifactInput {
    assessmentId: bigint | number | string;
    draftPostId: number;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    canonicalContributorsRoot?: string | null;
    canonicalContributorsCount?: number | null;
    status: ContributionAssessmentStatus;
    highPenetrationState: ContributionHighPenetrationState;
    signedArtifact: Prisma.InputJsonValue;
    signerKeyId: string;
    signature: string;
}

export interface LinkContributionAssessmentToProofPackageInput {
    assessmentId: bigint | number | string;
    proofPackageId: bigint | number | string;
    proofPackageHash: string;
    canonicalContributorsRoot: string;
    canonicalContributorsCount: number;
    status?: Extract<ContributionAssessmentStatus, 'bound' | 'confirmed' | 'fallback_applied'>;
}

export interface PersistedContributionAssessmentRecord {
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
    createdAt: string;
    updatedAt: string;
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

function normalizeHex64(value: string, errorCode = 'invalid_hex_64'): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error(errorCode);
    }
    return normalized;
}

function normalizeOptionalHex64(value: string | null | undefined, errorCode = 'invalid_hex_64'): string | null {
    if (value === null || value === undefined || value === '') return null;
    return normalizeHex64(value, errorCode);
}

function normalizePositiveInt(value: number, errorCode: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(errorCode);
    }
    return value;
}

function normalizeOptionalPositiveInt(value: number | null | undefined, errorCode: string): number | null {
    if (value === null || value === undefined) return null;
    return normalizePositiveInt(value, errorCode);
}

function normalizeBigIntId(value: bigint | number | string | null | undefined, errorCode: string): bigint | null {
    if (value === null || value === undefined || value === '') return null;
    let id: bigint;
    if (typeof value === 'bigint') {
        id = value;
    } else if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new Error(errorCode);
        }
        id = BigInt(value);
    } else if (typeof value === 'string') {
        const normalized = value.trim();
        if (!/^[0-9]+$/.test(normalized)) {
            throw new Error(errorCode);
        }
        id = BigInt(normalized);
    } else {
        throw new Error(errorCode);
    }
    if (id <= BigInt(0)) {
        throw new Error(errorCode);
    }
    return id;
}

function normalizeStatus(value: ContributionAssessmentStatus, errorCode = 'invalid_contribution_assessment_status') {
    if (!VALID_ASSESSMENT_STATUSES.has(value)) {
        throw new Error(errorCode);
    }
    return value;
}

function normalizeHighPenetrationState(value: ContributionHighPenetrationState) {
    if (!VALID_HIGH_PENETRATION_STATES.has(value)) {
        throw new Error('invalid_high_penetration_state');
    }
    return value;
}

function normalizeNonEmptyString(value: string, errorCode: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error(errorCode);
    }
    return normalized;
}

function mapContributionAssessmentRow(row: ContributionAssessmentRow): PersistedContributionAssessmentRecord {
    return {
        id: row.id,
        draftPostId: row.draftPostId,
        proofPackageId: row.proofPackageId,
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

export function hashContributionAssessmentInput(evidence: ContributionEvidencePackage): string {
    return hashContributionEvidencePackage(evidence);
}

export function hashContributionAssessmentOutput(suggestion: ContributionAssessmentSuggestion): string {
    return sha256Hex(stableStringify(suggestion));
}

export function hashCanonicalAllocation(allocation: CanonicalContributionAllocation): string {
    const { allocationHash: _allocationHash, ...allocationWithoutSelfHash } = allocation;
    return sha256Hex(stableStringify(allocationWithoutSelfHash));
}

export function buildContributionAssessmentArtifactMessage(payload: ContributionAssessmentArtifactPayload): string {
    return stableStringify(payload);
}

export function signContributionAssessmentArtifact(
    input: SignContributionAssessmentArtifactInput,
): SignContributionAssessmentArtifactResult {
    const generatedAt = normalizeIsoDate(input.generatedAt);
    const signedAt = normalizeIsoDate(input.signedAt ?? generatedAt);
    const inputHash = hashContributionAssessmentInput(input.evidence);
    const outputHash = hashContributionAssessmentOutput(input.suggestion);
    const canonicalAllocationHash = hashCanonicalAllocation(input.canonicalAllocation);
    const contributionPolicy = getContributionPolicySnapshot();
    if (input.canonicalAllocation.framePolicyVersion !== contributionPolicy.version) {
        throw new Error('contribution_assessment_policy_version_mismatch');
    }
    const contributionPolicyDigest = hashContributionPolicySnapshot(contributionPolicy);
    const payload: ContributionAssessmentArtifactPayload = {
        schema_version: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        domain: CONTRIBUTION_ASSESSMENT_ARTIFACT_DOMAIN,
        draft_post_id: normalizePositiveInt(input.evidence.draftPostId, 'invalid_draft_post_id'),
        circle_id: normalizePositiveInt(input.evidence.circleId, 'invalid_circle_id'),
        algorithm_version: normalizeNonEmptyString(input.canonicalAllocation.algorithmVersion, 'missing_algorithm_version'),
        frame_policy_version: normalizeNonEmptyString(
            input.canonicalAllocation.framePolicyVersion,
            'missing_frame_policy_version',
        ),
        contribution_policy_digest: contributionPolicyDigest,
        input_hash: inputHash,
        output_hash: outputHash,
        canonical_allocation_hash: canonicalAllocationHash,
        generated_at: generatedAt,
    };
    normalizeOptionalHex64(input.canonicalContributorsRoot ?? null, 'invalid_canonical_contributors_root');
    normalizeOptionalPositiveInt(input.canonicalContributorsCount ?? null, 'invalid_canonical_contributors_count');
    normalizeStatus(input.status ?? 'prepared');
    normalizeHighPenetrationState(input.canonicalAllocation.highPenetrationState);
    const canonicalMessage = buildContributionAssessmentArtifactMessage(payload);
    const digest = sha256Hex(canonicalMessage);
    const issued = issueDetachedDigestSignature({
        digestHex: digest,
        issuerKeyId: input.signerKeyId,
        issuerSecret: input.signerSecret,
        issuedAt: signedAt,
    });
    const signedArtifact: SignedContributionAssessmentArtifact = {
        payload,
        contribution_policy: contributionPolicy,
        evidence: input.evidence,
        provider_output: input.suggestion,
        canonical_allocation: input.canonicalAllocation,
        canonical_message: canonicalMessage,
        digest,
        signer_key_id: issued.issuer_key_id,
        signature: issued.issued_signature,
        signed_at: issued.issued_at,
    };

    return {
        inputHash,
        outputHash,
        canonicalAllocationHash,
        signedArtifact,
        signerKeyId: issued.issuer_key_id,
        signature: issued.issued_signature,
        signedAt: issued.issued_at,
    };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readContributionAssessmentArtifactSnapshots(
    artifactOrInput: unknown | ReadContributionAssessmentArtifactSnapshotsInput,
): ContributionAssessmentArtifactSnapshots | null {
    const hasExpectedRowMetadata =
        isPlainRecord(artifactOrInput)
        && Object.prototype.hasOwnProperty.call(artifactOrInput, 'signedArtifact');
    const artifact = hasExpectedRowMetadata
        ? (artifactOrInput as unknown as ReadContributionAssessmentArtifactSnapshotsInput).signedArtifact
        : artifactOrInput;
    if (!isPlainRecord(artifact) || !isPlainRecord(artifact.payload)) {
        return null;
    }
    const expected: Partial<ReadContributionAssessmentArtifactSnapshotsInput> = hasExpectedRowMetadata
        ? artifactOrInput as unknown as ReadContributionAssessmentArtifactSnapshotsInput
        : {};
    const evidence = artifact.evidence as ContributionEvidencePackage | undefined;
    const suggestion = artifact.provider_output as ContributionAssessmentSuggestion | undefined;
    const canonicalAllocation = artifact.canonical_allocation as CanonicalContributionAllocation | undefined;
    const policy = artifact.contribution_policy as ContributionPolicyProfile | undefined;
    if (!evidence || !suggestion || !canonicalAllocation || !policy) {
        return null;
    }
    if (
        !Array.isArray(evidence.roleFacts)
        || evidence.roleFacts.some((fact) => (
            (fact.institutionRole !== 'target' && fact.institutionRole !== 'committee')
            || !Number.isInteger(fact.institutionCircleId)
            || fact.institutionCircleId <= 0
            || !Number.isInteger(fact.targetCircleId)
            || fact.targetCircleId <= 0
            || (fact.institutionRole === 'target' && fact.institutionCircleId !== fact.targetCircleId)
        ))
    ) {
        throw new Error('invalid_contribution_assessment_institution_facts');
    }
    const payload = artifact.payload as unknown as ContributionAssessmentArtifactPayload;
    if (
        hashContributionAssessmentInput(evidence) !== payload.input_hash
        || hashContributionAssessmentOutput(suggestion) !== payload.output_hash
        || hashCanonicalAllocation(canonicalAllocation) !== payload.canonical_allocation_hash
        || hashContributionPolicySnapshot(policy) !== payload.contribution_policy_digest
        || policy.version !== payload.frame_policy_version
        || canonicalAllocation.framePolicyVersion !== policy.version
    ) {
        throw new Error('invalid_contribution_assessment_artifact_snapshot');
    }
    if (
        payload.schema_version !== CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION
        || payload.domain !== CONTRIBUTION_ASSESSMENT_ARTIFACT_DOMAIN
    ) {
        throw new Error('invalid_contribution_assessment_artifact_snapshot');
    }
    const canonicalMessage = buildContributionAssessmentArtifactMessage(payload);
    const digest = sha256Hex(canonicalMessage);
    if (
        artifact.canonical_message !== canonicalMessage
        || artifact.digest !== digest
    ) {
        throw new Error('invalid_contribution_assessment_artifact_signature');
    }
    if (
        expected.inputHash !== undefined
        && payload.input_hash !== normalizeHex64(expected.inputHash || '', 'invalid_input_hash')
    ) {
        throw new Error('contribution_assessment_artifact_row_mismatch');
    }
    if (
        expected.outputHash !== undefined
        && payload.output_hash !== normalizeHex64(expected.outputHash || '', 'invalid_output_hash')
    ) {
        throw new Error('contribution_assessment_artifact_row_mismatch');
    }
    if (
        expected.canonicalAllocationHash !== undefined
        && payload.canonical_allocation_hash !== normalizeHex64(
            expected.canonicalAllocationHash || '',
            'invalid_canonical_allocation_hash',
        )
    ) {
        throw new Error('contribution_assessment_artifact_row_mismatch');
    }
    if (
        expected.signerKeyId !== undefined
        && artifact.signer_key_id !== normalizeIssuerKeyId(expected.signerKeyId || '')
    ) {
        throw new Error('contribution_assessment_artifact_row_mismatch');
    }
    if (
        expected.signature !== undefined
        && artifact.signature !== String(expected.signature || '').trim().toLowerCase()
    ) {
        throw new Error('contribution_assessment_artifact_row_mismatch');
    }
    if (
        typeof artifact.signer_key_id !== 'string'
        || typeof artifact.signature !== 'string'
        || !/^[a-f0-9]{128}$/.test(artifact.signature)
    ) {
        throw new Error('invalid_contribution_assessment_artifact_signature');
    }
    const signerPublicKey = new PublicKey(normalizeIssuerKeyId(artifact.signer_key_id)).toBytes();
    const verified = nacl.sign.detached.verify(
        Buffer.from(digest, 'hex'),
        Buffer.from(artifact.signature, 'hex'),
        signerPublicKey,
    );
    if (!verified) {
        throw new Error('invalid_contribution_assessment_artifact_signature');
    }
    return {
        policy,
        policyDigest: payload.contribution_policy_digest,
        evidence,
        suggestion,
        canonicalAllocation,
    };
}

export async function persistContributionAssessment(
    prisma: PrismaClient,
    input: PersistContributionAssessmentInput,
): Promise<PersistedContributionAssessmentRecord> {
    const draftPostId = normalizePositiveInt(input.draftPostId, 'invalid_draft_post_id');
    const proofPackageId = normalizeBigIntId(input.proofPackageId, 'invalid_proof_package_id');
    const proofPackageHash = normalizeOptionalHex64(input.proofPackageHash, 'invalid_proof_package_hash');
    const canonicalContributorsRoot = normalizeOptionalHex64(
        input.canonicalContributorsRoot,
        'invalid_canonical_contributors_root',
    );
    const canonicalContributorsCount = normalizeOptionalPositiveInt(
        input.canonicalContributorsCount,
        'invalid_canonical_contributors_count',
    );
    const signerKeyId = normalizeIssuerKeyId(input.signerKeyId);
    const status = normalizeStatus(input.status);
    const highPenetrationState = normalizeHighPenetrationState(input.highPenetrationState);

    const rows = await prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
        INSERT INTO contribution_assessments (
            draft_post_id,
            proof_package_id,
            proof_package_hash,
            algorithm_version,
            frame_policy_version,
            input_hash,
            output_hash,
            canonical_allocation_hash,
            canonical_contributors_root,
            canonical_contributors_count,
            status,
            high_penetration_state,
            signed_artifact,
            signer_key_id,
            signature,
            created_at,
            updated_at
        )
        VALUES (
            ${draftPostId},
            ${proofPackageId},
            ${proofPackageHash},
            ${normalizeNonEmptyString(input.algorithmVersion, 'missing_algorithm_version')},
            ${normalizeNonEmptyString(input.framePolicyVersion, 'missing_frame_policy_version')},
            ${normalizeHex64(input.inputHash, 'invalid_input_hash')},
            ${normalizeHex64(input.outputHash, 'invalid_output_hash')},
            ${normalizeHex64(input.canonicalAllocationHash, 'invalid_canonical_allocation_hash')},
            ${canonicalContributorsRoot},
            ${canonicalContributorsCount},
            ${status},
            ${highPenetrationState},
            ${JSON.stringify(input.signedArtifact)}::jsonb,
            ${signerKeyId},
            ${input.signature},
            NOW(),
            NOW()
        )
        RETURNING
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
    `);
    const row = rows[0] || null;
    if (!row) {
        throw new Error('contribution_assessment_persist_failed');
    }
    return mapContributionAssessmentRow(row);
}

export async function updateContributionAssessmentSignedArtifact(
    prisma: PrismaClient,
    input: UpdateContributionAssessmentSignedArtifactInput,
): Promise<PersistedContributionAssessmentRecord> {
    const assessmentId = normalizeBigIntId(input.assessmentId, 'invalid_assessment_id');
    if (!assessmentId) throw new Error('invalid_assessment_id');
    const draftPostId = normalizePositiveInt(input.draftPostId, 'invalid_draft_post_id');
    const canonicalContributorsRoot = normalizeOptionalHex64(
        input.canonicalContributorsRoot ?? null,
        'invalid_canonical_contributors_root',
    );
    const canonicalContributorsCount = normalizeOptionalPositiveInt(
        input.canonicalContributorsCount ?? null,
        'invalid_canonical_contributors_count',
    );
    const status = normalizeStatus(input.status);
    const highPenetrationState = normalizeHighPenetrationState(input.highPenetrationState);
    const now = new Date();
    const rows = await prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
        UPDATE contribution_assessments
        SET
            algorithm_version = ${normalizeNonEmptyString(input.algorithmVersion, 'missing_algorithm_version')},
            frame_policy_version = ${normalizeNonEmptyString(input.framePolicyVersion, 'missing_frame_policy_version')},
            input_hash = ${normalizeHex64(input.inputHash, 'invalid_input_hash')},
            output_hash = ${normalizeHex64(input.outputHash, 'invalid_output_hash')},
            canonical_allocation_hash = ${normalizeHex64(input.canonicalAllocationHash, 'invalid_canonical_allocation_hash')},
            canonical_contributors_root = ${canonicalContributorsRoot},
            canonical_contributors_count = ${canonicalContributorsCount},
            status = ${status},
            high_penetration_state = ${highPenetrationState},
            signed_artifact = ${JSON.stringify(input.signedArtifact)}::jsonb,
            signer_key_id = ${normalizeNonEmptyString(input.signerKeyId, 'missing_signer_key_id')},
            signature = ${normalizeNonEmptyString(input.signature, 'missing_signature')},
            updated_at = ${sqlTimestampWithoutTimeZone(now)}
        WHERE id = ${assessmentId}
          AND draft_post_id = ${draftPostId}
          AND proof_package_id IS NULL
          AND proof_package_hash IS NULL
        RETURNING
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
    `);
    const row = rows[0] || null;
    if (!row) {
        throw new Error('contribution_assessment_signed_artifact_update_failed');
    }
    return mapContributionAssessmentRow(row);
}

export async function linkContributionAssessmentToProofPackage(
    prisma: PrismaClient,
    input: LinkContributionAssessmentToProofPackageInput,
): Promise<PersistedContributionAssessmentRecord> {
    const assessmentId = normalizeBigIntId(input.assessmentId, 'invalid_assessment_id');
    const proofPackageId = normalizeBigIntId(input.proofPackageId, 'invalid_proof_package_id');
    if (!assessmentId || !proofPackageId) {
        throw new Error('invalid_assessment_link_id');
    }
    const status = normalizeStatus(input.status ?? 'bound');
    const now = new Date();
    const rows = await prisma.$queryRaw<ContributionAssessmentRow[]>(Prisma.sql`
        UPDATE contribution_assessments
        SET
            proof_package_id = proof_package.id,
            proof_package_hash = proof_package.proof_package_hash,
            canonical_contributors_root = proof_package.contributors_root,
            canonical_contributors_count = proof_package.contributors_count,
            status = ${status},
            updated_at = ${sqlTimestampWithoutTimeZone(now)}
        FROM (
            SELECT id, draft_post_id, proof_package_hash, contributors_root, contributors_count
            FROM draft_proof_packages
            WHERE id = ${proofPackageId}
              AND proof_package_hash = ${normalizeHex64(input.proofPackageHash, 'invalid_proof_package_hash')}
              AND contributors_root = ${normalizeHex64(
                input.canonicalContributorsRoot,
                'invalid_canonical_contributors_root',
            )}
              AND contributors_count = ${normalizePositiveInt(
                input.canonicalContributorsCount,
                'invalid_canonical_contributors_count',
            )}
            LIMIT 1
        ) AS proof_package
        WHERE contribution_assessments.id = ${assessmentId}
          AND contribution_assessments.draft_post_id = proof_package.draft_post_id
          AND (
            contribution_assessments.proof_package_id IS NULL
            OR contribution_assessments.proof_package_id = proof_package.id
          )
          AND (
            contribution_assessments.proof_package_hash IS NULL
            OR contribution_assessments.proof_package_hash = proof_package.proof_package_hash
          )
          AND (
            contribution_assessments.canonical_contributors_root IS NULL
            OR contribution_assessments.canonical_contributors_root = proof_package.contributors_root
          )
          AND (
            contribution_assessments.canonical_contributors_count IS NULL
            OR contribution_assessments.canonical_contributors_count = proof_package.contributors_count
          )
        RETURNING
            contribution_assessments.id,
            contribution_assessments.draft_post_id AS "draftPostId",
            contribution_assessments.proof_package_id AS "proofPackageId",
            contribution_assessments.proof_package_hash AS "proofPackageHash",
            contribution_assessments.algorithm_version AS "algorithmVersion",
            contribution_assessments.frame_policy_version AS "framePolicyVersion",
            contribution_assessments.input_hash AS "inputHash",
            contribution_assessments.output_hash AS "outputHash",
            contribution_assessments.canonical_allocation_hash AS "canonicalAllocationHash",
            contribution_assessments.canonical_contributors_root AS "canonicalContributorsRoot",
            contribution_assessments.canonical_contributors_count AS "canonicalContributorsCount",
            contribution_assessments.status,
            contribution_assessments.high_penetration_state AS "highPenetrationState",
            contribution_assessments.signer_key_id AS "signerKeyId",
            contribution_assessments.signature,
            contribution_assessments.created_at AS "createdAt",
            contribution_assessments.updated_at AS "updatedAt"
    `);
    const row = rows[0] || null;
    if (!row) {
        throw new Error('contribution_assessment_link_failed');
    }
    const linked = mapContributionAssessmentRow(row);
    logContributionAssessmentEvent('info', 'proof_package_bound', {
        draftPostId: linked.draftPostId,
        assessmentId: linked.id,
        proofPackageId: linked.proofPackageId,
        proofPackageHash: linked.proofPackageHash,
        canonicalContributorsRoot: linked.canonicalContributorsRoot,
        canonicalContributorsCount: linked.canonicalContributorsCount,
        status: linked.status,
    });
    return linked;
}
