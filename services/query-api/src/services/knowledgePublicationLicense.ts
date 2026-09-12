import crypto from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import { readContributionAssessmentProofForDraft } from './contributionAssessment/runtime';
import { getDraftContributorProof, type DraftContributorProofRecord } from './contributorProof';
import { loadDraftVersionSnapshot } from './draftLifecycle/versionSnapshots';
import { hashCanonicalGovernanceValue } from './governance/canonicalCodec';
import { verifyEd25519SignatureBase64 } from './offchainDiscussion';
import { resolveKnowledgePublicationOrigin } from './crystallizationBinding';
import { loadPrivateText } from './privateContentBridge';
import {
    KnowledgeDurabilityError,
    persistPreparedKnowledgeDurability,
    prepareKnowledgeDurabilityForPublication,
    restrictKnowledgeDurabilityRecords,
} from './knowledgeDurability';

type PrismaLike = PrismaClient | any;

export const KNOWLEDGE_SAFE_DEFAULT_LICENSE = {
    ref: 'alcheme-knowledge-public-demo-nc-no-nft',
    version: '2026-07-22',
    jurisdictionScope: 'united_states_public_adult_demo',
    rightsRetainedByContributors: true,
    publicDisplayAuthorized: true,
    adaptationAuthorized: false,
    commercialUseAuthorized: false,
    nftUseAuthorized: false,
    mixedSourcePolicy: 'exact_source_license_and_contributor_acceptance_required',
    contributorExitPolicy: 'published_version_license_continues_until_source_withdrawal',
    withdrawalPolicy: 'restrict_publication_and_replicas_prospectively',
    mergeSuccessorPolicy: 'no_automatic_license_transfer_successor_must_reauthorize',
    dissolutionSuccessorPolicy: 'retention_successor_only_no_new_publication_authority',
    finalProductionLegalReview: 'required',
} as const;

export interface SourceMaterialLicenseFacts {
    schemaVersion: 1;
    basis: 'self_authored_safe_default' | 'external_license';
    rightsHolder: string;
    licenseRef: string;
    licenseVersion: string;
    publicDisplayAuthorized: boolean;
    commercialUseAuthorized: boolean;
    nftUseAuthorized: boolean;
}

export interface KnowledgePublicationAuthorization {
    schemaVersion: 1;
    kind: 'knowledge_public_release';
    chainId: 'solana:localnet' | 'solana:devnet';
    draftPostId: number;
    targetCircleId: number;
    draftVersion: number;
    draftSnapshotDigest: string;
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
    contributorPubkeys: string[];
    contentHash: string;
    title: string;
    description: string;
    sourceSnapshotDigest: string;
    publicationOriginDigest: string;
    aiDerivationDigest: string | null;
    license: typeof KNOWLEDGE_SAFE_DEFAULT_LICENSE;
}

export interface PreparedKnowledgePublicationAuthorization {
    authorization: KnowledgePublicationAuthorization;
    authorizationDigest: string;
    sourceSnapshot: Record<string, unknown>;
    contributors: DraftContributorProofRecord['contributors'];
    acceptedContributorPubkeys: string[];
    missingContributorPubkeys: string[];
    actorSigningEnvelope: {
        signedMessage: string;
        nonce: string;
        expiresAt: string;
    } | null;
}

export class KnowledgePublicationLicenseError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'KnowledgePublicationLicenseError';
    }
}

function normalizeDigest(value: unknown, code: string): string {
    const digest = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) {
        throw new KnowledgePublicationLicenseError(code, 400, code);
    }
    return digest;
}

function normalizeText(value: unknown, maxLength: number, code: string): string {
    const text = String(value || '').trim();
    if (!text || text.length > maxLength) {
        throw new KnowledgePublicationLicenseError(code, 400, code);
    }
    return text;
}

function normalizeSourceLicenseFacts(value: unknown): SourceMaterialLicenseFacts | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const facts = value as Record<string, unknown>;
    if (
        facts.schemaVersion !== 1
        || (facts.basis !== 'self_authored_safe_default' && facts.basis !== 'external_license')
        || typeof facts.rightsHolder !== 'string'
        || !facts.rightsHolder.trim()
        || typeof facts.licenseRef !== 'string'
        || !facts.licenseRef.trim()
        || typeof facts.licenseVersion !== 'string'
        || !facts.licenseVersion.trim()
        || typeof facts.publicDisplayAuthorized !== 'boolean'
        || typeof facts.commercialUseAuthorized !== 'boolean'
        || typeof facts.nftUseAuthorized !== 'boolean'
    ) return null;
    return {
        schemaVersion: 1,
        basis: facts.basis,
        rightsHolder: facts.rightsHolder.trim(),
        licenseRef: facts.licenseRef.trim(),
        licenseVersion: facts.licenseVersion.trim(),
        publicDisplayAuthorized: facts.publicDisplayAuthorized,
        commercialUseAuthorized: facts.commercialUseAuthorized,
        nftUseAuthorized: facts.nftUseAuthorized,
    };
}

export function buildSourceMaterialLicenseFacts(input: {
    basis: 'self_authored_safe_default' | 'external_license';
    rightsHolder: string;
    licenseRef?: string | null;
    licenseVersion?: string | null;
    publicDisplayAuthorized: boolean;
    commercialUseAuthorized?: boolean;
    nftUseAuthorized?: boolean;
}): { facts: SourceMaterialLicenseFacts; digest: string } {
    const rightsHolder = normalizeText(input.rightsHolder, 160, 'source_material_license_rights_holder_required');
    const licenseRef = input.basis === 'self_authored_safe_default'
        ? KNOWLEDGE_SAFE_DEFAULT_LICENSE.ref
        : normalizeText(input.licenseRef, 128, 'source_material_license_ref_required');
    const licenseVersion = input.basis === 'self_authored_safe_default'
        ? KNOWLEDGE_SAFE_DEFAULT_LICENSE.version
        : normalizeText(input.licenseVersion, 64, 'source_material_license_version_required');
    const facts: SourceMaterialLicenseFacts = {
        schemaVersion: 1,
        basis: input.basis,
        rightsHolder,
        licenseRef,
        licenseVersion,
        publicDisplayAuthorized: input.publicDisplayAuthorized === true,
        commercialUseAuthorized: input.commercialUseAuthorized === true,
        nftUseAuthorized: input.nftUseAuthorized === true,
    };
    return {
        facts,
        digest: hashCanonicalGovernanceValue('alcheme.source-material.license-facts.v1', facts),
    };
}

interface ResolvedPublicationSourceLicense {
    facts: SourceMaterialLicenseFacts;
    digest: string;
    evidencePrivacyClass: string;
    licenseAuthorizedAt: string | null;
}

interface CommunicationSourceLicenseAuthorization {
    sourceMaterialId: number;
    contentDigest: string;
    licenseFacts: SourceMaterialLicenseFacts;
    licenseFactsDigest: string;
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readCommunicationSourceAuthorPubkey(material: any): string | null {
    const provenance = readPlainObject(material?.provenance);
    const pubkey = typeof provenance?.originMessageSenderPubkey === 'string'
        ? provenance.originMessageSenderPubkey.trim()
        : '';
    return pubkey || null;
}

function sourceMaterialHasAnyLicenseAuthority(material: any): boolean {
    return material?.licenseFacts != null
        || String(material?.licenseFactsDigest || '').trim() !== ''
        || String(material?.licenseAuthorizedByPubkey || '').trim() !== ''
        || material?.licenseAuthorizedAt != null;
}

function sourceLicenseFactsEqual(
    left: SourceMaterialLicenseFacts | null,
    right: SourceMaterialLicenseFacts,
): boolean {
    return Boolean(
        left
        && left.schemaVersion === right.schemaVersion
        && left.basis === right.basis
        && left.rightsHolder === right.rightsHolder
        && left.licenseRef === right.licenseRef
        && left.licenseVersion === right.licenseVersion
        && left.publicDisplayAuthorized === right.publicDisplayAuthorized
        && left.commercialUseAuthorized === right.commercialUseAuthorized
        && left.nftUseAuthorized === right.nftUseAuthorized,
    );
}

function throwSourceLicenseIncomplete(materialId: unknown): never {
    throw new KnowledgePublicationLicenseError(
        'knowledge_publication_source_license_incomplete',
        409,
        `Source material ${materialId} lacks authoritative public-display license facts`,
    );
}

function resolvePublicationSourceLicense(input: {
    material: any;
    contributorPubkeys: Set<string>;
    now: Date;
}): ResolvedPublicationSourceLicense {
    const { material, contributorPubkeys, now } = input;
    const expiresAt = material.expiresAt ? new Date(material.expiresAt) : null;
    if (
        (expiresAt && expiresAt.getTime() <= now.getTime())
        || material.visibilityScope === 'reviewers'
        || material.visibilityScope === 'sealed'
    ) {
        return throwSourceLicenseIncomplete(material.id);
    }

    const facts = normalizeSourceLicenseFacts(material.licenseFacts);
    const digest = String(material.licenseFactsDigest || '').trim().toLowerCase();
    const existingLicenseValid = Boolean(
        facts
        && /^[a-f0-9]{64}$/.test(digest)
        && hashCanonicalGovernanceValue('alcheme.source-material.license-facts.v1', facts) === digest
        && facts.publicDisplayAuthorized === true,
    );

    if (material.originType !== 'communication_message') {
        if (!existingLicenseValid || material.evidencePrivacyClass !== 'public' || !facts) {
            return throwSourceLicenseIncomplete(material.id);
        }
        return {
            facts,
            digest,
            evidencePrivacyClass: 'public',
            licenseAuthorizedAt: material.licenseAuthorizedAt
                ? new Date(material.licenseAuthorizedAt).toISOString()
                : null,
        };
    }

    const authorPubkey = readCommunicationSourceAuthorPubkey(material);
    if (!authorPubkey) {
        throw new KnowledgePublicationLicenseError(
            'knowledge_publication_source_author_provenance_missing',
            409,
            `Source material ${material.id} lacks its original message author`,
        );
    }
    if (!contributorPubkeys.has(authorPubkey)) {
        throw new KnowledgePublicationLicenseError(
            'knowledge_publication_source_author_not_contributor',
            409,
            `Source material ${material.id} author is not present in the contributor proof`,
        );
    }

    const expected = buildSourceMaterialLicenseFacts({
        basis: 'self_authored_safe_default',
        rightsHolder: authorPubkey,
        publicDisplayAuthorized: true,
        commercialUseAuthorized: false,
        nftUseAuthorized: false,
    });
    const existingTransitionLicenseValid = existingLicenseValid
        && sourceLicenseFactsEqual(facts, expected.facts)
        && digest === expected.digest
        && (material.evidencePrivacyClass === 'circle_only' || material.evidencePrivacyClass === 'public')
        && String(material.licenseAuthorizedByPubkey || '').trim() === authorPubkey
        && material.licenseAuthorizedAt != null;
    if (existingTransitionLicenseValid) {
        return {
            facts: expected.facts,
            digest: expected.digest,
            evidencePrivacyClass: 'public',
            // The contributor signature covers one stable snapshot before and after persistence.
            licenseAuthorizedAt: null,
        };
    }

    if (
        !sourceMaterialHasAnyLicenseAuthority(material)
        && (material.evidencePrivacyClass === 'circle_only' || material.evidencePrivacyClass === 'public')
    ) {
        return {
            facts: expected.facts,
            digest: expected.digest,
            evidencePrivacyClass: 'public',
            licenseAuthorizedAt: null,
        };
    }

    if (
        existingLicenseValid
        && material.evidencePrivacyClass === 'public'
        && facts?.basis === 'external_license'
    ) {
        return {
            facts,
            digest,
            evidencePrivacyClass: 'public',
            licenseAuthorizedAt: material.licenseAuthorizedAt
                ? new Date(material.licenseAuthorizedAt).toISOString()
                : null,
        };
    }

    return throwSourceLicenseIncomplete(material.id);
}

function readActorCommunicationSourceLicenseAuthorizations(
    sourceSnapshot: Record<string, unknown>,
    actorPubkey: string,
): CommunicationSourceLicenseAuthorization[] {
    const materials = Array.isArray(sourceSnapshot.sourceMaterials)
        ? sourceSnapshot.sourceMaterials
        : [];
    return materials.flatMap((value: any) => {
        const facts = normalizeSourceLicenseFacts(value?.licenseFacts);
        const digest = String(value?.licenseFactsDigest || '').trim().toLowerCase();
        const sourceMaterialId = Number(value?.id);
        const contentDigest = String(value?.contentDigest || '').trim().toLowerCase();
        if (
            value?.originType !== 'communication_message'
            || !facts
            || facts.basis !== 'self_authored_safe_default'
            || facts.rightsHolder !== actorPubkey
            || facts.publicDisplayAuthorized !== true
            || facts.commercialUseAuthorized !== false
            || facts.nftUseAuthorized !== false
            || !Number.isInteger(sourceMaterialId)
            || sourceMaterialId <= 0
            || !/^[a-f0-9]{64}$/.test(contentDigest)
            || !/^[a-f0-9]{64}$/.test(digest)
            || hashCanonicalGovernanceValue('alcheme.source-material.license-facts.v1', facts) !== digest
        ) return [];
        return [{
            sourceMaterialId,
            contentDigest,
            licenseFacts: facts,
            licenseFactsDigest: digest,
        }];
    });
}

export function resolveKnowledgePublicReleaseRuntime(env: NodeJS.ProcessEnv = process.env): {
    enabled: boolean;
    mode: 'disabled_pending_legal_review' | 'local_development' | 'devnet_demo_approved' | 'production_approved';
    chainId: 'solana:localnet' | 'solana:devnet';
} {
    const rawMode = String(env.KNOWLEDGE_PUBLIC_RELEASE_MODE || '').trim();
    const mode = rawMode === 'production_approved'
        || rawMode === 'devnet_demo_approved'
        || rawMode === 'local_development'
        ? rawMode
        : rawMode === 'disabled_pending_legal_review'
            ? rawMode
            : env.NODE_ENV === 'production'
                ? 'disabled_pending_legal_review'
                : 'local_development';
    const rawChain = String(
        env.KNOWLEDGE_PUBLICATION_CHAIN_ID
        || env.GOVERNANCE_SIGNAL_CHAIN_ID
        || 'solana:localnet',
    ).trim();
    const chainId = rawChain === 'solana:devnet' ? rawChain : 'solana:localnet';
    const enabled = mode === 'production_approved'
        || (mode === 'local_development' && chainId === 'solana:localnet')
        || (mode === 'devnet_demo_approved' && chainId === 'solana:devnet');
    return { enabled, mode, chainId };
}

function buildActorSigningMessage(input: {
    authorizationDigest: string;
    actorPubkey: string;
    chainId: string;
    nonce: string;
    expiresAt: string;
    sourceMaterialLicenseAuthorizations: Array<{
        sourceMaterialId: number;
        licenseFactsDigest: string;
    }>;
}): string {
    return JSON.stringify({
        domain: 'alcheme.knowledge.publication-license-acceptance',
        version: 2,
        network: input.chainId,
        authorizationDigest: input.authorizationDigest,
        actorPubkey: input.actorPubkey,
        sourceMaterialLicenseAuthorizations: input.sourceMaterialLicenseAuthorizations,
        nonce: input.nonce,
        expiresAt: input.expiresAt,
    });
}

async function loadCurrentProofPackage(
    prisma: PrismaLike,
    draftPostId: number,
    binding?: {
        proofPackageId: bigint;
        proofPackageHash: string;
    },
) {
    const proofPackage = await prisma.draftProofPackage.findFirst({
        where: binding
            ? {
                id: binding.proofPackageId,
                draftPostId,
                proofPackageHash: binding.proofPackageHash,
            }
            : { draftPostId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        select: {
            proofPackageHash: true,
            sourceAnchorId: true,
            contributorsRoot: true,
            contributorsCount: true,
        },
    });
    if (!proofPackage) {
        if (binding) {
            throw new KnowledgePublicationLicenseError(
                'knowledge_publication_proof_package_stale',
                409,
            );
        }
        throw new KnowledgePublicationLicenseError(
            'knowledge_publication_proof_package_required',
            409,
            'Knowledge publication requires the current proof package',
        );
    }
    return proofPackage;
}

async function loadPublicationProofState(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<{
    proof: DraftContributorProofRecord;
    proofPackage: Awaited<ReturnType<typeof loadCurrentProofPackage>>;
}> {
    const assessmentPreparation = await readContributionAssessmentProofForDraft({
        prisma: prisma as PrismaClient,
        draftPostId,
    });
    if (assessmentPreparation.rolloutMode === 'legacy') {
        const [proof, proofPackage] = await Promise.all([
            getDraftContributorProof(prisma as PrismaClient, draftPostId),
            loadCurrentProofPackage(prisma, draftPostId),
        ]);
        return { proof, proofPackage };
    }

    const assessment = assessmentPreparation.assessment;
    const proof = assessmentPreparation.contributorProof;
    const proofPackageHash = String(assessment?.proofPackageHash || '').trim().toLowerCase();
    if (
        !assessment?.proofPackageId
        || !/^[a-f0-9]{64}$/.test(proofPackageHash)
        || !proof
    ) {
        throw new KnowledgePublicationLicenseError(
            'knowledge_publication_proof_package_required',
            409,
            'Knowledge publication requires the current proof package',
        );
    }

    const proofPackage = await loadCurrentProofPackage(prisma, draftPostId, {
        proofPackageId: assessment.proofPackageId,
        proofPackageHash,
    });
    return { proof, proofPackage };
}

export async function prepareKnowledgePublicationAuthorization(input: {
    prisma: PrismaLike;
    draftPostId: number;
    actorPubkey?: string | null;
    title: string;
    description: string;
    contentHash: string;
    now?: Date;
}): Promise<PreparedKnowledgePublicationAuthorization> {
    const now = input.now ?? new Date();
    const runtime = resolveKnowledgePublicReleaseRuntime();
    if (!runtime.enabled) {
        throw new KnowledgePublicationLicenseError(
            'knowledge_public_release_disabled_pending_legal_review',
            409,
            'Public Knowledge release is disabled pending final legal text review',
        );
    }
    const draftPostId = Number(input.draftPostId);
    if (!Number.isInteger(draftPostId) || draftPostId <= 0) {
        throw new KnowledgePublicationLicenseError('invalid_draft_post_id', 400);
    }
    const [proofState, publicationOrigin, workflow, draft, sourceMaterials, generation] = await Promise.all([
        loadPublicationProofState(input.prisma, draftPostId),
        resolveKnowledgePublicationOrigin(input.prisma, draftPostId),
        input.prisma.draftWorkflowState.findUnique({
            where: { draftPostId },
            select: { currentSnapshotVersion: true },
        }),
        input.prisma.post.findUnique({
            where: { id: draftPostId },
            select: { id: true, circleId: true },
        }),
        input.prisma.sourceMaterial.findMany({
            where: {
                draftPostId,
                lifecycleStatus: { in: ['used_in_draft', 'crystallized'] },
            },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                name: true,
                contentDigest: true,
                originType: true,
                originRef: true,
                canonicalUrl: true,
                externalAuthorLabel: true,
                sourcePublishedAt: true,
                capturedAt: true,
                sourceVersion: true,
                lifecycleStatus: true,
                evidencePrivacyClass: true,
                visibilityScope: true,
                expiresAt: true,
                provenance: true,
                licenseFacts: true,
                licenseFactsDigest: true,
                licenseAuthorizedByPubkey: true,
                licenseAuthorizedAt: true,
                chunks: {
                    orderBy: { chunkIndex: 'asc' },
                    select: {
                        chunkIndex: true,
                        text: true,
                        textLocator: true,
                        textDigest: true,
                    },
                },
            },
        }),
        input.prisma.ghostDraftGeneration.findFirst({
            where: { draftPostId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
                origin: true,
                providerMode: true,
                model: true,
                promptAsset: true,
                promptVersion: true,
                sourceDigest: true,
                generationMetadata: true,
            },
        }),
    ]);
    const { proof, proofPackage } = proofState;
    if (!draft?.circleId || draft.circleId !== proof.circleId) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_circle_mismatch', 409);
    }
    if (
        proofPackage.sourceAnchorId !== proof.anchorId
        || proofPackage.contributorsRoot !== proof.rootHex
        || proofPackage.contributorsCount !== proof.count
    ) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_proof_package_stale', 409);
    }
    const snapshot = workflow
        ? await loadDraftVersionSnapshot(input.prisma as PrismaClient, {
            draftPostId,
            draftVersion: workflow.currentSnapshotVersion,
        })
        : null;
    if (!snapshot || snapshot.contentHash !== publicationOrigin.origin.snapshotDigest) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_snapshot_stale', 409);
    }

    const contributorPubkeys = new Set(proof.contributors.map((item) => item.pubkey));
    const sourceSnapshotMaterials = await Promise.all(sourceMaterials.map(async (material: any) => {
        const expiresAt = material.expiresAt ? new Date(material.expiresAt) : null;
        const sourceLicense = resolvePublicationSourceLicense({
            material,
            contributorPubkeys,
            now,
        });
        const chunks = Array.isArray(material.chunks)
            ? await Promise.all(material.chunks.map(async (chunk: any) => {
                const inlineText = String(chunk.text || '');
                const text = inlineText.length > 0
                    ? inlineText
                    : (await loadPrivateText(chunk.textLocator)) || '';
                const textDigest = normalizeDigest(
                    chunk.textDigest,
                    'source_material_chunk_digest_invalid',
                );
                if (crypto.createHash('sha256').update(text, 'utf8').digest('hex') !== textDigest) {
                    throw new KnowledgePublicationLicenseError(
                        'source_material_chunk_digest_mismatch',
                        409,
                    );
                }
                return {
                    chunkIndex: Number(chunk.chunkIndex),
                    text,
                    textDigest,
                };
            }))
            : [];
        return {
            id: Number(material.id),
            name: String(material.name || ''),
            contentDigest: normalizeDigest(material.contentDigest, 'source_material_content_digest_invalid'),
            originType: String(material.originType || ''),
            originRef: material.originRef ? String(material.originRef) : null,
            canonicalUrl: material.canonicalUrl ? String(material.canonicalUrl) : null,
            externalAuthorLabel: material.externalAuthorLabel ? String(material.externalAuthorLabel) : null,
            sourcePublishedAt: material.sourcePublishedAt
                ? new Date(material.sourcePublishedAt).toISOString()
                : null,
            capturedAt: material.capturedAt ? new Date(material.capturedAt).toISOString() : null,
            sourceVersion: material.sourceVersion == null ? null : Number(material.sourceVersion),
            lifecycleStatus: String(material.lifecycleStatus || ''),
            evidencePrivacyClass: sourceLicense.evidencePrivacyClass,
            visibilityScope: String(material.visibilityScope || ''),
            expiresAt: expiresAt?.toISOString() ?? null,
            licenseFactsDigest: sourceLicense.digest,
            licenseFacts: sourceLicense.facts,
            licenseAuthorizedAt: sourceLicense.licenseAuthorizedAt,
            chunks,
        };
    }));
    const aiDerivation = generation ? {
        origin: String(generation.origin || ''),
        providerMode: String(generation.providerMode || ''),
        model: String(generation.model || ''),
        promptAsset: String(generation.promptAsset || ''),
        promptVersion: String(generation.promptVersion || ''),
        sourceDigest: normalizeDigest(generation.sourceDigest, 'knowledge_publication_ai_source_digest_invalid'),
        generationMetadataDigest: hashCanonicalGovernanceValue(
            'alcheme.knowledge.ai-derivation-metadata.v1',
            generation.generationMetadata || {},
        ),
    } : null;
    const sourceSnapshot = {
        schemaVersion: 1,
        draftPostId,
        draftVersion: snapshot.draftVersion,
        draftSnapshotDigest: snapshot.contentHash,
        sourceAnchorId: proof.anchorId,
        sourceMessagesDigest: proof.messagesDigest,
        sourceMaterials: sourceSnapshotMaterials,
        aiDerivation,
    };
    const sourceSnapshotDigest = hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-source-snapshot.v1',
        sourceSnapshot,
    );
    const authorization: KnowledgePublicationAuthorization = {
        schemaVersion: 1,
        kind: 'knowledge_public_release',
        chainId: runtime.chainId,
        draftPostId,
        targetCircleId: draft.circleId,
        draftVersion: snapshot.draftVersion,
        draftSnapshotDigest: snapshot.contentHash,
        proofPackageHash: normalizeDigest(proofPackage.proofPackageHash, 'invalid_proof_package_hash'),
        contributorsRoot: proof.rootHex,
        contributorsCount: proof.count,
        contributorPubkeys: proof.contributors.map((item) => item.pubkey),
        contentHash: normalizeDigest(input.contentHash, 'knowledge_publication_content_hash_invalid'),
        title: normalizeText(input.title, 256, 'knowledge_publication_title_required'),
        description: normalizeText(input.description, 512, 'knowledge_publication_description_required'),
        sourceSnapshotDigest,
        publicationOriginDigest: publicationOrigin.digest,
        aiDerivationDigest: aiDerivation
            ? hashCanonicalGovernanceValue('alcheme.knowledge.ai-derivation.v1', aiDerivation)
            : null,
        license: KNOWLEDGE_SAFE_DEFAULT_LICENSE,
    };
    const authorizationDigest = hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-authorization.v1',
        authorization,
    );
    const acceptedRows = await input.prisma.knowledgeContributorLicenseAcceptance.findMany({
        where: {
            authorizationDigest,
            contributorPubkey: { in: proof.contributors.map((item) => item.pubkey) },
        },
        select: { contributorPubkey: true },
    });
    const accepted = new Set(acceptedRows.map((row: any) => String(row.contributorPubkey)));
    const acceptedContributorPubkeys = proof.contributors
        .map((item) => item.pubkey)
        .filter((pubkey) => accepted.has(pubkey));
    const missingContributorPubkeys = proof.contributors
        .map((item) => item.pubkey)
        .filter((pubkey) => !accepted.has(pubkey));
    const actorIsContributor = Boolean(
        input.actorPubkey
        && proof.contributors.some((item) => item.pubkey === input.actorPubkey),
    );
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const actorSourceLicenseAuthorizations = input.actorPubkey
        ? readActorCommunicationSourceLicenseAuthorizations(sourceSnapshot, input.actorPubkey)
        : [];
    return {
        authorization,
        authorizationDigest,
        sourceSnapshot,
        contributors: proof.contributors,
        acceptedContributorPubkeys,
        missingContributorPubkeys,
        actorSigningEnvelope: actorIsContributor && !accepted.has(String(input.actorPubkey))
            ? {
                signedMessage: buildActorSigningMessage({
                    authorizationDigest,
                    actorPubkey: String(input.actorPubkey),
                    chainId: runtime.chainId,
                    nonce,
                    expiresAt,
                    sourceMaterialLicenseAuthorizations: actorSourceLicenseAuthorizations.map((item) => ({
                        sourceMaterialId: item.sourceMaterialId,
                        licenseFactsDigest: item.licenseFactsDigest,
                    })),
                }),
                nonce,
                expiresAt,
            }
            : null,
    };
}

function communicationSourceLicenseMatchesAcceptance(input: {
    material: any;
    actorPubkey: string;
    authorization: CommunicationSourceLicenseAuthorization;
}): boolean {
    const facts = normalizeSourceLicenseFacts(input.material?.licenseFacts);
    return readCommunicationSourceAuthorPubkey(input.material) === input.actorPubkey
        && String(input.material?.contentDigest || '').trim().toLowerCase() === input.authorization.contentDigest
        && (input.material?.evidencePrivacyClass === 'circle_only'
            || input.material?.evidencePrivacyClass === 'public')
        && input.material?.visibilityScope !== 'reviewers'
        && input.material?.visibilityScope !== 'sealed'
        && sourceLicenseFactsEqual(facts, input.authorization.licenseFacts)
        && String(input.material?.licenseFactsDigest || '').trim().toLowerCase()
            === input.authorization.licenseFactsDigest
        && String(input.material?.licenseAuthorizedByPubkey || '').trim() === input.actorPubkey
        && input.material?.licenseAuthorizedAt != null;
}

async function publishAcceptedCommunicationSourceLicenses(input: {
    prisma: PrismaLike;
    draftPostId: number;
    sourceSnapshot: Record<string, unknown>;
    publishedAt: Date;
}): Promise<void> {
    const snapshotMaterials = Array.isArray(input.sourceSnapshot.sourceMaterials)
        ? input.sourceSnapshot.sourceMaterials
        : [];
    const authorizations = snapshotMaterials.flatMap((value: any) => {
        const facts = normalizeSourceLicenseFacts(value?.licenseFacts);
        const licenseFactsDigest = String(value?.licenseFactsDigest || '').trim().toLowerCase();
        const sourceMaterialId = Number(value?.id);
        const contentDigest = String(value?.contentDigest || '').trim().toLowerCase();
        if (value?.originType !== 'communication_message') return [];
        if (facts?.basis === 'external_license') return [];
        if (
            !facts
            || facts.basis !== 'self_authored_safe_default'
            || facts.publicDisplayAuthorized !== true
            || facts.commercialUseAuthorized !== false
            || facts.nftUseAuthorized !== false
            || !Number.isInteger(sourceMaterialId)
            || sourceMaterialId <= 0
            || !/^[a-f0-9]{64}$/.test(contentDigest)
            || !/^[a-f0-9]{64}$/.test(licenseFactsDigest)
            || hashCanonicalGovernanceValue('alcheme.source-material.license-facts.v1', facts)
                !== licenseFactsDigest
        ) {
            throw new KnowledgePublicationLicenseError(
                'knowledge_publication_source_license_transition_conflict',
                409,
            );
        }
        return [{
            sourceMaterialId,
            contentDigest,
            licenseFacts: facts,
            licenseFactsDigest,
            authorPubkey: facts.rightsHolder,
        }];
    });
    if (authorizations.length === 0) return;

    const sourceMaterialIds = authorizations.map((item) => item.sourceMaterialId);
    const readMaterials = () => input.prisma.sourceMaterial.findMany({
        where: {
            draftPostId: input.draftPostId,
            id: { in: sourceMaterialIds },
        },
        select: {
            id: true,
            draftPostId: true,
            contentDigest: true,
            originType: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            visibilityScope: true,
            expiresAt: true,
            provenance: true,
            licenseFacts: true,
            licenseFactsDigest: true,
            licenseAuthorizedByPubkey: true,
            licenseAuthorizedAt: true,
        },
    });
    const materials = await readMaterials();
    const byId = new Map<number, any>(materials.map((material: any) => [Number(material.id), material]));
    if (byId.size !== authorizations.length) {
        throw new KnowledgePublicationLicenseError(
            'knowledge_publication_source_license_transition_conflict',
            409,
        );
    }

    for (const authorization of authorizations) {
        const material = byId.get(authorization.sourceMaterialId);
        const expiresAt = material?.expiresAt ? new Date(material.expiresAt) : null;
        const acceptedLicenseMatches = communicationSourceLicenseMatchesAcceptance({
            material,
            actorPubkey: authorization.authorPubkey,
            authorization,
        });
        const hasLicenseAuthority = sourceMaterialHasAnyLicenseAuthority(material);
        if (
            !material
            || (material.lifecycleStatus !== 'used_in_draft' && material.lifecycleStatus !== 'crystallized')
            || (expiresAt && expiresAt.getTime() <= input.publishedAt.getTime())
            || material.visibilityScope === 'reviewers'
            || material.visibilityScope === 'sealed'
            || readCommunicationSourceAuthorPubkey(material) !== authorization.authorPubkey
            || String(material.contentDigest || '').trim().toLowerCase() !== authorization.contentDigest
            || (hasLicenseAuthority && !acceptedLicenseMatches)
            || (!hasLicenseAuthority
                && material.evidencePrivacyClass !== 'circle_only'
                && material.evidencePrivacyClass !== 'public')
        ) {
            throw new KnowledgePublicationLicenseError(
                'knowledge_publication_source_license_transition_conflict',
                409,
            );
        }
        if (acceptedLicenseMatches && material.evidencePrivacyClass === 'public') continue;

        const missingLicenseWhere = {
            licenseFacts: { equals: Prisma.DbNull },
            licenseFactsDigest: null,
            licenseAuthorizedByPubkey: null,
            licenseAuthorizedAt: null,
        };
        const acceptedLicenseWhere = {
            licenseFacts: { equals: authorization.licenseFacts },
            licenseFactsDigest: authorization.licenseFactsDigest,
            licenseAuthorizedByPubkey: authorization.authorPubkey,
            licenseAuthorizedAt: material.licenseAuthorizedAt,
        };

        const result = await input.prisma.sourceMaterial.updateMany({
            where: {
                id: authorization.sourceMaterialId,
                draftPostId: input.draftPostId,
                originType: 'communication_message',
                contentDigest: authorization.contentDigest,
                lifecycleStatus: material.lifecycleStatus,
                evidencePrivacyClass: 'circle_only',
                visibilityScope: material.visibilityScope,
                expiresAt: material.expiresAt ?? null,
                provenance: {
                    path: ['originMessageSenderPubkey'],
                    equals: authorization.authorPubkey,
                },
                ...(acceptedLicenseMatches ? acceptedLicenseWhere : missingLicenseWhere),
            },
            data: {
                evidencePrivacyClass: 'public',
                ...(!acceptedLicenseMatches
                    ? {
                        licenseFacts: authorization.licenseFacts,
                        licenseFactsDigest: authorization.licenseFactsDigest,
                        licenseAuthorizedByPubkey: authorization.authorPubkey,
                        licenseAuthorizedAt: input.publishedAt,
                    }
                    : {}),
            },
        });
        if (result.count === 1) continue;

        const currentMaterials = await readMaterials();
        const current = currentMaterials.find(
            (item: any) => Number(item.id) === authorization.sourceMaterialId,
        );
        if (
            current?.evidencePrivacyClass !== 'public'
            || !communicationSourceLicenseMatchesAcceptance({
                material: current,
                actorPubkey: authorization.authorPubkey,
                authorization,
            })
        ) {
            throw new KnowledgePublicationLicenseError(
                'knowledge_publication_source_license_transition_conflict',
                409,
            );
        }
    }
}

export async function acceptKnowledgePublicationLicense(input: {
    prisma: PrismaLike;
    draftPostId: number;
    actorPubkey: string;
    title: string;
    description: string;
    contentHash: string;
    signedMessage: string;
    signature: string;
    nonce: string;
    expiresAt: string;
    now?: Date;
}): Promise<PreparedKnowledgePublicationAuthorization> {
    const now = input.now ?? new Date();
    const prepared = await prepareKnowledgePublicationAuthorization({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        actorPubkey: input.actorPubkey,
        title: input.title,
        description: input.description,
        contentHash: input.contentHash,
        now,
    });
    if (!prepared.contributors.some((item) => item.pubkey === input.actorPubkey)) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_actor_not_contributor', 403);
    }
    const expiresAt = new Date(input.expiresAt);
    if (
        Number.isNaN(expiresAt.getTime())
        || expiresAt.getTime() <= now.getTime()
        || expiresAt.getTime() > now.getTime() + 5 * 60_000 + 5_000
    ) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_signature_expired', 409);
    }
    const nonce = normalizeText(input.nonce, 64, 'knowledge_publication_nonce_required');
    const sourceLicenseAuthorizations = readActorCommunicationSourceLicenseAuthorizations(
        prepared.sourceSnapshot,
        input.actorPubkey,
    );
    const expectedMessage = buildActorSigningMessage({
        authorizationDigest: prepared.authorizationDigest,
        actorPubkey: input.actorPubkey,
        chainId: prepared.authorization.chainId,
        nonce,
        expiresAt: expiresAt.toISOString(),
        sourceMaterialLicenseAuthorizations: sourceLicenseAuthorizations.map((item) => ({
            sourceMaterialId: item.sourceMaterialId,
            licenseFactsDigest: item.licenseFactsDigest,
        })),
    });
    if (input.signedMessage !== expectedMessage) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_signed_message_mismatch', 409);
    }
    if (!verifyEd25519SignatureBase64({
        senderPubkey: input.actorPubkey,
        message: expectedMessage,
        signatureBase64: input.signature,
    })) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_signature_invalid', 401);
    }
    await input.prisma.knowledgeContributorLicenseAcceptance.upsert({
        where: {
            authorizationDigest_contributorPubkey: {
                authorizationDigest: prepared.authorizationDigest,
                contributorPubkey: input.actorPubkey,
            },
        },
        create: {
            draftPostId: input.draftPostId,
            proofPackageHash: prepared.authorization.proofPackageHash,
            contributorPubkey: input.actorPubkey,
            authorizationDigest: prepared.authorizationDigest,
            signedMessage: expectedMessage,
            signature: input.signature,
            chainId: prepared.authorization.chainId,
            nonce,
            expiresAt,
            acceptedAt: now,
        },
        update: {},
    });
    return prepareKnowledgePublicationAuthorization({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        actorPubkey: input.actorPubkey,
        title: input.title,
        description: input.description,
        contentHash: input.contentHash,
        now,
    });
}

export async function authorizeKnowledgePublicationAttempt(input: {
    prisma: PrismaLike;
    draftPostId: number;
    actorPubkey: string;
    title: string;
    description: string;
    contentHash: string;
    knowledgeOnChainAddress: string;
}): Promise<PreparedKnowledgePublicationAuthorization> {
    const prepared = await prepareKnowledgePublicationAuthorization({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        actorPubkey: input.actorPubkey,
        title: input.title,
        description: input.description,
        contentHash: input.contentHash,
    });
    if (prepared.missingContributorPubkeys.length > 0) {
        throw new KnowledgePublicationLicenseError(
            'knowledge_publication_contributor_acceptance_incomplete',
            409,
            'Every contributor must accept the exact publication license snapshot',
        );
    }
    const address = normalizeText(
        input.knowledgeOnChainAddress,
        44,
        'invalid_knowledge_on_chain_address',
    );
    const existingAttempt = await input.prisma.draftCrystallizationAttempt.findUnique({
        where: {
            draftPostId_proofPackageHash: {
                draftPostId: input.draftPostId,
                proofPackageHash: prepared.authorization.proofPackageHash,
            },
        },
    });
    if (existingAttempt) {
        if (existingAttempt.knowledgeOnChainAddress !== address) {
            throw new KnowledgePublicationLicenseError(
                'crystallization_attempt_conflict',
                409,
                'The current proof package is already bound to another publication attempt',
            );
        }
        const previousAuthorization = readKnowledgePublicationAuthorization(
            existingAttempt.publicationAuthorization,
        );
        const previousDigest = String(existingAttempt.publicationAuthorizationDigest || '');
        const previousDigestValid = previousAuthorization
            && hashCanonicalGovernanceValue(
                'alcheme.knowledge.publication-authorization.v1',
                previousAuthorization,
            ) === previousDigest;
        if (existingAttempt.publicationAuthorizationDigest === prepared.authorizationDigest) {
            if (!previousDigestValid) {
                throw new KnowledgePublicationLicenseError(
                    'crystallization_attempt_conflict',
                    409,
                    'The stored publication authorization does not match its digest',
                );
            }
            return prepared;
        }
        const maySupersede = previousDigestValid
            && existingAttempt.knowledgeId == null
            && ['authorization_ready', 'submitted', 'binding_pending'].includes(existingAttempt.status)
            && publicationAuthorizationMatchesExceptOrigin(
                previousAuthorization,
                prepared.authorization,
            );
        if (!maySupersede) {
            throw new KnowledgePublicationLicenseError(
                'crystallization_attempt_conflict',
                409,
                'The current proof package is already bound to another publication attempt',
            );
        }
        const updated = await input.prisma.draftCrystallizationAttempt.updateMany({
            where: {
                id: existingAttempt.id,
                knowledgeOnChainAddress: address,
                knowledgeId: null,
                status: { in: ['authorization_ready', 'submitted', 'binding_pending'] },
                publicationAuthorizationDigest: previousDigest,
            },
            data: {
                status: 'authorization_ready',
                failureCode: null,
                failureMessage: null,
                publicationAuthorization: prepared.authorization,
                publicationAuthorizationDigest: prepared.authorizationDigest,
                publicationContentHash: prepared.authorization.contentHash,
                publicationSourceSnapshotDigest: prepared.authorization.sourceSnapshotDigest,
                publicationLicenseRef: prepared.authorization.license.ref,
                publicationLicenseVersion: prepared.authorization.license.version,
                publicationAuthorizedAt: new Date(),
            },
        });
        if (updated.count !== 1) {
            throw new KnowledgePublicationLicenseError(
                'crystallization_attempt_conflict',
                409,
                'The publication attempt changed while its submit authority was being superseded',
            );
        }
        return prepared;
    }
    const attempt = await input.prisma.draftCrystallizationAttempt.upsert({
        where: {
            draftPostId_proofPackageHash: {
                draftPostId: input.draftPostId,
                proofPackageHash: prepared.authorization.proofPackageHash,
            },
        },
        create: {
            draftPostId: input.draftPostId,
            proofPackageHash: prepared.authorization.proofPackageHash,
            knowledgeOnChainAddress: address,
            status: 'authorization_ready',
            publicationAuthorization: prepared.authorization,
            publicationAuthorizationDigest: prepared.authorizationDigest,
            publicationContentHash: prepared.authorization.contentHash,
            publicationSourceSnapshotDigest: prepared.authorization.sourceSnapshotDigest,
            publicationLicenseRef: prepared.authorization.license.ref,
            publicationLicenseVersion: prepared.authorization.license.version,
            publicationAuthorizedAt: new Date(),
        },
        update: {},
    });
    if (
        attempt.knowledgeOnChainAddress !== address
        || attempt.publicationAuthorizationDigest !== prepared.authorizationDigest
    ) {
        throw new KnowledgePublicationLicenseError(
            'crystallization_attempt_conflict',
            409,
            'The current proof package is already bound to another publication attempt',
        );
    }
    return prepared;
}

function readKnowledgePublicationAuthorization(
    value: unknown,
): KnowledgePublicationAuthorization | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const authorization = value as Partial<KnowledgePublicationAuthorization>;
    if (
        authorization.schemaVersion !== 1
        || authorization.kind !== 'knowledge_public_release'
        || typeof authorization.publicationOriginDigest !== 'string'
    ) return null;
    return authorization as KnowledgePublicationAuthorization;
}

function publicationAuthorizationMatchesExceptOrigin(
    previous: KnowledgePublicationAuthorization,
    next: KnowledgePublicationAuthorization,
): boolean {
    const {
        publicationOriginDigest: _previousPublicationOriginDigest,
        ...previousStableFields
    } = previous;
    const {
        publicationOriginDigest: _nextPublicationOriginDigest,
        ...nextStableFields
    } = next;
    return hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-authorization-stable-fields.v1',
        previousStableFields,
    ) === hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-authorization-stable-fields.v1',
        nextStableFields,
    );
}

export async function requireAuthorizedKnowledgePublicationAttempt(input: {
    prisma: PrismaLike;
    draftPostId: number;
    proofPackageHash: string;
    knowledgeOnChainAddress: string;
}) {
    const attempt = await input.prisma.draftCrystallizationAttempt.findUnique({
        where: {
            draftPostId_proofPackageHash: {
                draftPostId: input.draftPostId,
                proofPackageHash: input.proofPackageHash,
            },
        },
    });
    if (
        !attempt
        || !attempt.publicationAuthorization
        || !attempt.publicationAuthorizationDigest
        || attempt.knowledgeOnChainAddress !== input.knowledgeOnChainAddress
    ) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_authorization_required', 409);
    }
    const digest = hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-authorization.v1',
        attempt.publicationAuthorization,
    );
    if (digest !== attempt.publicationAuthorizationDigest) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_authorization_corrupt', 409);
    }
    return attempt;
}

export async function publishAuthorizedKnowledgeVersion(input: {
    prisma: PrismaLike;
    draftPostId: number;
    proofPackageHash: string;
    knowledgeOnChainAddress: string;
    knowledgeId: string;
    sourceSnapshot: Record<string, unknown>;
}) {
    const attempt = await requireAuthorizedKnowledgePublicationAttempt(input);
    const authorization = attempt.publicationAuthorization as unknown as KnowledgePublicationAuthorization;
    if (authorization.sourceSnapshotDigest !== hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-source-snapshot.v1',
        input.sourceSnapshot,
    )) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_source_snapshot_mismatch', 409);
    }
    const accepted = await input.prisma.knowledgeContributorLicenseAcceptance.findMany({
        where: { authorizationDigest: attempt.publicationAuthorizationDigest },
        select: { contributorPubkey: true },
        orderBy: { contributorPubkey: 'asc' },
    });
    const acceptedPubkeys = accepted.map((row: any) => String(row.contributorPubkey)).sort();
    const expectedPubkeys = [...authorization.contributorPubkeys].sort();
    if (
        accepted.length !== authorization.contributorsCount
        || acceptedPubkeys.join(',') !== expectedPubkeys.join(',')
    ) {
        throw new KnowledgePublicationLicenseError('knowledge_publication_contributor_acceptance_incomplete', 409);
    }
    const stablePublicPath = `/knowledge/${encodeURIComponent(input.knowledgeId)}`;
    const publishedAt = new Date();
    const licenseDigest = hashCanonicalGovernanceValue(
        'alcheme.knowledge.publication-license.v1',
        authorization.license,
    );
    const currentKnowledge = await input.prisma.knowledge.findUnique({
        where: { knowledgeId: input.knowledgeId },
        select: { version: true },
    });
    if (!currentKnowledge) {
        throw new KnowledgePublicationLicenseError('knowledge_not_found', 404);
    }
    const knowledgeVersion = Number(currentKnowledge.version || 1);
    let durability;
    try {
        durability = await prepareKnowledgeDurabilityForPublication({
            prisma: input.prisma,
            knowledgeId: input.knowledgeId,
            knowledgeVersion,
            draftPostId: authorization.draftPostId,
            draftVersion: authorization.draftVersion,
            finalContentDigest: authorization.contentHash,
            sourceSnapshot: input.sourceSnapshot,
            sourceSnapshotDigest: authorization.sourceSnapshotDigest,
            licenseRef: authorization.license.ref,
            licenseVersion: authorization.license.version,
            now: publishedAt,
        });
    } catch (error) {
        if (error instanceof KnowledgeDurabilityError) {
            throw new KnowledgePublicationLicenseError(error.code, error.statusCode, error.message);
        }
        throw error;
    }
    return input.prisma.$transaction(async (tx: any) => {
        await publishAcceptedCommunicationSourceLicenses({
            prisma: tx,
            draftPostId: input.draftPostId,
            sourceSnapshot: input.sourceSnapshot,
            publishedAt,
        });
        const knowledge = await tx.knowledge.update({
            where: { knowledgeId: input.knowledgeId },
            data: {
                publicationState: 'published',
                publicationLicenseRef: authorization.license.ref,
                publicationLicenseVersion: authorization.license.version,
                publicationLicenseDigest: licenseDigest,
                publicationSourceSnapshotDigest: authorization.sourceSnapshotDigest,
                stablePublicPath,
                publicReleaseAuthorizedAt: publishedAt,
            },
        });
        await tx.knowledgePublicationVersion.upsert({
            where: {
                knowledgeId_version: {
                    knowledgeId: input.knowledgeId,
                    version: knowledgeVersion,
                },
            },
            create: {
                knowledgeId: input.knowledgeId,
                version: knowledgeVersion,
                state: 'published',
                targetCircleId: authorization.targetCircleId,
                stablePublicPath,
                licenseRef: authorization.license.ref,
                licenseVersion: authorization.license.version,
                licenseDigest,
                sourceSnapshotJson: input.sourceSnapshot,
                sourceSnapshotDigest: authorization.sourceSnapshotDigest,
                authorizationDigest: attempt.publicationAuthorizationDigest,
                authorizedContributors: acceptedPubkeys,
                publishedAt,
            },
            update: {},
        });
        await persistPreparedKnowledgeDurability(tx, durability);
        return knowledge;
    });
}

type KnowledgePublicationReadRecord = {
    knowledgeId: string;
    version: number;
    publicationState?: string | null;
    publicationLicenseRef?: string | null;
    publicationLicenseVersion?: string | null;
    publicationLicenseDigest?: string | null;
    publicationSourceSnapshotDigest?: string | null;
    stablePublicPath?: string | null;
};

function readSourceSnapshotMaterials(snapshot: unknown): Array<Record<string, any>> | null {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const materials = (snapshot as Record<string, unknown>).sourceMaterials;
    if (!Array.isArray(materials)) return null;
    return materials.every((item) => item && typeof item === 'object' && !Array.isArray(item))
        ? materials as Array<Record<string, any>>
        : null;
}

export async function isKnowledgePublicationPubliclyReadable(input: {
    prisma: PrismaLike;
    knowledge: KnowledgePublicationReadRecord;
    now?: Date;
}): Promise<boolean> {
    if (input.knowledge.publicationState !== 'published') return false;
    const publication = await input.prisma.knowledgePublicationVersion.findUnique({
        where: {
            knowledgeId_version: {
                knowledgeId: input.knowledge.knowledgeId,
                version: Number(input.knowledge.version || 1),
            },
        },
    });
    if (
        !publication
        || publication.state !== 'published'
        || publication.licenseRef !== input.knowledge.publicationLicenseRef
        || publication.licenseVersion !== input.knowledge.publicationLicenseVersion
        || publication.licenseDigest !== input.knowledge.publicationLicenseDigest
        || publication.sourceSnapshotDigest !== input.knowledge.publicationSourceSnapshotDigest
        || publication.stablePublicPath !== input.knowledge.stablePublicPath
        || hashCanonicalGovernanceValue(
            'alcheme.knowledge.publication-source-snapshot.v1',
            publication.sourceSnapshotJson,
        ) !== publication.sourceSnapshotDigest
    ) return false;

    const snapshotMaterials = readSourceSnapshotMaterials(publication.sourceSnapshotJson);
    if (!snapshotMaterials) return false;
    if (snapshotMaterials.length === 0) return true;
    const sourceIds = snapshotMaterials.map((material) => Number(material.id));
    if (sourceIds.some((id) => !Number.isInteger(id) || id <= 0)) return false;
    const currentMaterials = await input.prisma.sourceMaterial.findMany({
        where: { id: { in: sourceIds } },
        select: {
            id: true,
            contentDigest: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            visibilityScope: true,
            expiresAt: true,
            licenseFacts: true,
            licenseFactsDigest: true,
            chunks: {
                orderBy: { chunkIndex: 'asc' },
                select: {
                    chunkIndex: true,
                    text: true,
                    textDigest: true,
                },
            },
        },
    });
    if (currentMaterials.length !== sourceIds.length) return false;
    const currentById = new Map<number, any>(
        currentMaterials.map((material: any) => [Number(material.id), material]),
    );
    const now = input.now ?? new Date();
    return snapshotMaterials.every((snapshotMaterial) => {
        const current = currentById.get(Number(snapshotMaterial.id));
        if (!current) return false;
        const currentFacts = normalizeSourceLicenseFacts(current.licenseFacts);
        const currentLicenseDigest = String(current.licenseFactsDigest || '').trim().toLowerCase();
        const currentExpiry = current.expiresAt ? new Date(current.expiresAt) : null;
        const snapshotChunks = Array.isArray(snapshotMaterial.chunks) ? snapshotMaterial.chunks : null;
        const currentChunks = Array.isArray(current.chunks) ? current.chunks : null;
        const chunksMatch = Boolean(
            snapshotChunks
            && currentChunks
            && snapshotChunks.length === currentChunks.length
            && snapshotChunks.every((snapshotChunk: any, index: number) => {
                const currentChunk = currentChunks[index];
                const currentText = String(currentChunk?.text || '');
                const currentDigest = String(currentChunk?.textDigest || '').trim().toLowerCase();
                return Number(currentChunk?.chunkIndex) === Number(snapshotChunk.chunkIndex)
                    && currentText === String(snapshotChunk.text || '')
                    && currentDigest === String(snapshotChunk.textDigest || '').trim().toLowerCase()
                    && crypto.createHash('sha256').update(currentText, 'utf8').digest('hex') === currentDigest;
            }),
        );
        return (
            (current.lifecycleStatus === 'used_in_draft' || current.lifecycleStatus === 'crystallized')
            && current.evidencePrivacyClass === 'public'
            && current.visibilityScope !== 'reviewers'
            && current.visibilityScope !== 'sealed'
            && (!currentExpiry || currentExpiry.getTime() > now.getTime())
            && String(current.contentDigest || '').trim().toLowerCase()
                === String(snapshotMaterial.contentDigest || '').trim().toLowerCase()
            && currentLicenseDigest === String(snapshotMaterial.licenseFactsDigest || '').trim().toLowerCase()
            && Boolean(currentFacts)
            && hashCanonicalGovernanceValue('alcheme.source-material.license-facts.v1', currentFacts)
                === currentLicenseDigest
            && currentFacts?.publicDisplayAuthorized === true
            && chunksMatch
        );
    });
}

export async function withdrawKnowledgePublicationsUsingSourceMaterial(input: {
    prisma: PrismaLike;
    sourceMaterialId: number;
    withdrawnAt?: Date;
}): Promise<{ withdrawnKnowledgeIds: string[] }> {
    const published = await input.prisma.knowledgePublicationVersion.findMany({
        where: { state: 'published' },
        select: {
            id: true,
            knowledgeId: true,
            sourceSnapshotJson: true,
        },
    });
    const affected = published.filter((publication: any) => {
        const materials = readSourceSnapshotMaterials(publication.sourceSnapshotJson);
        return materials?.some((material) => Number(material.id) === input.sourceMaterialId) === true;
    });
    if (affected.length === 0) return { withdrawnKnowledgeIds: [] };
    const withdrawnAt = input.withdrawnAt ?? new Date();
    const knowledgeIds = [
        ...new Set<string>(affected.map((publication: any) => String(publication.knowledgeId))),
    ];
    await input.prisma.$transaction(async (tx: any) => {
        await tx.knowledgePublicationVersion.updateMany({
            where: { id: { in: affected.map((publication: any) => publication.id) }, state: 'published' },
            data: { state: 'withdrawn', withdrawnAt },
        });
        await tx.knowledge.updateMany({
            where: { knowledgeId: { in: knowledgeIds }, publicationState: 'published' },
            data: {
                publicationState: 'restricted',
                publicationLicenseRef: null,
                publicationLicenseVersion: null,
                publicationLicenseDigest: null,
                publicationSourceSnapshotDigest: null,
                stablePublicPath: null,
                publicReleaseAuthorizedAt: null,
            },
        });
        await restrictKnowledgeDurabilityRecords({
            prisma: tx,
            knowledgeIds,
            now: withdrawnAt,
        });
    });
    return { withdrawnKnowledgeIds: knowledgeIds };
}
