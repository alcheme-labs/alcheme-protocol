import crypto from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { loadDraftVersionSnapshot } from './draftLifecycle/versionSnapshots';
import {
    canonicalGovernanceJson,
    hashCanonicalGovernanceValue,
} from './governance/canonicalCodec';
import { buildPrivateTextLocator, loadPrivateText } from './privateContentBridge';

type PrismaLike = PrismaClient | any;

const SNAPSHOT_DOMAIN = 'alcheme.knowledge.durability.snapshot.v1';
const MANIFEST_DOMAIN = 'alcheme.knowledge.durability.manifest.v1';
const POLICY_DOMAIN = 'alcheme.knowledge.durability.policy.v1';
const EVENT_DOMAIN = 'alcheme.knowledge.durability.event.v1';
const REPLICA_SCHEME = 'alcheme-knowledge-replica:';

export type KnowledgeDurabilityStatus = 'healthy' | 'corrupt' | 'unavailable' | 'repair_pending';
export type KnowledgeDurabilityVisibility = 'private' | 'members' | 'public';

export interface KnowledgeDurabilityPolicy {
    schemaVersion: 1;
    environment: 'local_development';
    tier: 'local_private' | 'local_members' | 'local_published';
    visibility: KnowledgeDurabilityVisibility;
    verificationIntervalSeconds: number;
    rpoSeconds: 0;
    rtoSeconds: number;
    repairOwner: 'target_circle_custodian';
    alerts: ['replica_unavailable', 'digest_mismatch', 'verification_overdue'];
    productionProviderStatus: 'not_configured';
}

export interface PreparedKnowledgeDurability {
    record: {
        id: string;
        knowledgeId: string;
        knowledgeVersion: number;
        sourceDraftPostId: number;
        sourceDraftVersion: number;
        visibility: KnowledgeDurabilityVisibility;
        tier: KnowledgeDurabilityPolicy['tier'];
        contentDigest: string;
        manifestJson: Record<string, unknown>;
        manifestDigest: string;
        policyJson: KnowledgeDurabilityPolicy;
        policyDigest: string;
        replicaProvider: 'local_fs_independent';
        replicaLocator: string;
        replicaDigest: string;
        replicaByteSize: number;
        status: 'healthy';
        lastVerifiedAt: Date;
        createdAt: Date;
    };
    initialEvent: ReturnType<typeof buildEvent>;
}

export class KnowledgeDurabilityError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'KnowledgeDurabilityError';
    }
}

function sha256(bytes: Uint8Array | string): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function requireDigest(value: unknown, code: string): string {
    const digest = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new KnowledgeDurabilityError(code, 409);
    return digest;
}

function requirePositiveInteger(value: unknown, code: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new KnowledgeDurabilityError(code, 409);
    return parsed;
}

function requireText(value: unknown, code: string): string {
    const text = String(value || '').trim();
    if (!text) throw new KnowledgeDurabilityError(code, 409);
    return text;
}

function resolveReplicaRoot(): string {
    const configured = String(process.env.KNOWLEDGE_REPLICA_STORE_ROOT || '').trim();
    return configured || join(tmpdir(), 'alcheme-knowledge-replica');
}

function replicaLocator(knowledgeId: string, version: number): string {
    return `${REPLICA_SCHEME}//local/${encodeURIComponent(knowledgeId)}/v${version}.json`;
}

function resolveReplicaPath(locator: string): string {
    try {
        const parsed = new URL(locator);
        if (parsed.protocol !== REPLICA_SCHEME || parsed.host !== 'local') throw new Error('invalid');
        const segments = parsed.pathname.split('/').filter(Boolean).map((value) => decodeURIComponent(value));
        if (
            segments.length !== 2
            || segments.some((value) => !value || value === '.' || value === '..' || value.includes('/'))
        ) throw new Error('invalid');
        return join(resolveReplicaRoot(), ...segments);
    } catch {
        throw new KnowledgeDurabilityError('knowledge_durability_replica_locator_invalid', 409);
    }
}

async function writeReplica(locator: string, bytes: Uint8Array): Promise<void> {
    const path = resolveReplicaPath(locator);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        await writeFile(temporaryPath, bytes, { mode: 0o600 });
        await rename(temporaryPath, path);
    } finally {
        await unlink(temporaryPath).catch(() => undefined);
    }
}

async function readReplica(locator: string): Promise<Uint8Array | null> {
    try {
        return await readFile(resolveReplicaPath(locator));
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
    }
}

export function resolveKnowledgeDurabilityPolicy(
    visibility: KnowledgeDurabilityVisibility,
): KnowledgeDurabilityPolicy {
    const byVisibility = {
        private: { tier: 'local_private', verificationIntervalSeconds: 21_600, rtoSeconds: 3_600 },
        members: { tier: 'local_members', verificationIntervalSeconds: 43_200, rtoSeconds: 7_200 },
        public: { tier: 'local_published', verificationIntervalSeconds: 86_400, rtoSeconds: 14_400 },
    } as const;
    return {
        schemaVersion: 1,
        environment: 'local_development',
        visibility,
        ...byVisibility[visibility],
        rpoSeconds: 0,
        repairOwner: 'target_circle_custodian',
        alerts: ['replica_unavailable', 'digest_mismatch', 'verification_overdue'],
        productionProviderStatus: 'not_configured',
    };
}

function parseFinalDocument(value: string, input: {
    draftPostId: number;
    expectedDigest: string;
    expectedContent: string;
}): { title: string; content: string } {
    if (sha256(value) !== input.expectedDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_final_document_digest_mismatch', 409);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new KnowledgeDurabilityError('knowledge_durability_final_document_invalid', 409);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new KnowledgeDurabilityError('knowledge_durability_final_document_invalid', 409);
    }
    const document = parsed as Record<string, unknown>;
    if (
        document.version !== 1
        || document.kind !== 'alcheme.draft.crystallization'
        || Number(document.draftPostId) !== input.draftPostId
        || String(document.content || '').trim() !== input.expectedContent.trim()
    ) {
        throw new KnowledgeDurabilityError('knowledge_durability_final_document_invalid', 409);
    }
    return {
        title: requireText(document.title, 'knowledge_durability_final_document_title_required'),
        content: String(document.content || '').trim(),
    };
}

function buildFinalDocument(input: { draftPostId: number; title: string; content: string }): string {
    return JSON.stringify({
        version: 1,
        kind: 'alcheme.draft.crystallization',
        draftPostId: input.draftPostId,
        title: input.title.trim(),
        content: input.content.trim(),
    });
}

function buildSnapshot(input: {
    knowledge: any;
    knowledgeVersion: number;
    draftPostId: number;
    draftVersion: number;
    draftContent: string;
    draftContentDigest: string;
    finalDocument: string;
    finalContentDigest: string;
    sourceSnapshot: Record<string, unknown>;
    sourceSnapshotDigest: string;
    licenseRef: string;
    licenseVersion: string;
}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        knowledge: {
            knowledgeId: input.knowledge.knowledgeId,
            version: input.knowledgeVersion,
            targetCircleId: input.knowledge.circleId,
            title: input.knowledge.title,
            description: input.knowledge.description,
            publicationOrigin: input.knowledge.publicationOrigin,
            publicationOriginDigest: input.knowledge.publicationOriginDigest,
            licenseRef: input.licenseRef,
            licenseVersion: input.licenseVersion,
        },
        sourceDraft: {
            postId: input.draftPostId,
            version: input.draftVersion,
            content: input.draftContent,
            contentDigest: input.draftContentDigest,
        },
        finalDocument: {
            content: input.finalDocument,
            contentDigest: input.finalContentDigest,
        },
        sourceSnapshot: input.sourceSnapshot,
        sourceSnapshotDigest: input.sourceSnapshotDigest,
    };
}

function buildEvent(input: {
    recordId: string;
    eventType: 'replica_created' | 'verified' | 'corruption_detected' | 'replica_unavailable' | 'repair_started' | 'repair_completed' | 'visibility_restricted';
    status: KnowledgeDurabilityStatus;
    expectedDigest: string;
    observedDigest: string | null;
    actorPubkey?: string | null;
    occurredAt: Date;
}) {
    const evidenceJson = {
        schemaVersion: 1,
        recordId: input.recordId,
        eventType: input.eventType,
        status: input.status,
        expectedDigest: input.expectedDigest,
        observedDigest: input.observedDigest,
        actorPubkey: input.actorPubkey || null,
        occurredAt: input.occurredAt.toISOString(),
    };
    const evidenceDigest = hashCanonicalGovernanceValue(EVENT_DOMAIN, evidenceJson);
    return {
        id: `knowledge-durability-event:${evidenceDigest}`,
        recordId: input.recordId,
        eventType: input.eventType,
        status: input.status,
        expectedDigest: input.expectedDigest,
        observedDigest: input.observedDigest,
        actorPubkey: input.actorPubkey || null,
        evidenceJson,
        evidenceDigest,
        occurredAt: input.occurredAt,
    };
}

export async function prepareKnowledgeDurabilityForPublication(input: {
    prisma: PrismaLike;
    knowledgeId: string;
    knowledgeVersion: number;
    draftPostId: number;
    draftVersion: number;
    finalContentDigest: string;
    sourceSnapshot: Record<string, unknown>;
    sourceSnapshotDigest: string;
    licenseRef: string;
    licenseVersion: string;
    now?: Date;
}): Promise<PreparedKnowledgeDurability> {
    const now = input.now ?? new Date();
    const knowledgeId = requireText(input.knowledgeId, 'knowledge_durability_knowledge_id_required');
    const knowledgeVersion = requirePositiveInteger(input.knowledgeVersion, 'knowledge_durability_version_invalid');
    const draftPostId = requirePositiveInteger(input.draftPostId, 'knowledge_durability_draft_invalid');
    const draftVersion = requirePositiveInteger(input.draftVersion, 'knowledge_durability_draft_version_invalid');
    const finalContentDigest = requireDigest(input.finalContentDigest, 'knowledge_durability_content_digest_invalid');
    const sourceSnapshotDigest = requireDigest(input.sourceSnapshotDigest, 'knowledge_durability_source_digest_invalid');
    if (hashCanonicalGovernanceValue('alcheme.knowledge.publication-source-snapshot.v1', input.sourceSnapshot) !== sourceSnapshotDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_source_snapshot_mismatch', 409);
    }
    const [knowledge, draftSnapshot] = await Promise.all([
        input.prisma.knowledge.findUnique({
            where: { knowledgeId },
            select: {
                knowledgeId: true,
                circleId: true,
                title: true,
                description: true,
                publicationOrigin: true,
                publicationOriginDigest: true,
            },
        }),
        loadDraftVersionSnapshot(input.prisma as PrismaClient, { draftPostId, draftVersion }),
    ]);
    if (!knowledge || !draftSnapshot) {
        throw new KnowledgeDurabilityError('knowledge_durability_canonical_source_missing', 409);
    }
    const finalLocator = buildPrivateTextLocator(
        'draft-crystallization',
        'final-document',
        String(draftPostId),
        finalContentDigest,
    );
    const finalDocument = await loadPrivateText(finalLocator);
    if (!finalDocument) {
        throw new KnowledgeDurabilityError('knowledge_durability_local_document_missing', 409);
    }
    const parsedDocument = parseFinalDocument(finalDocument, {
        draftPostId,
        expectedDigest: finalContentDigest,
        expectedContent: draftSnapshot.contentSnapshot,
    });
    const snapshot = buildSnapshot({
        knowledge,
        knowledgeVersion,
        draftPostId,
        draftVersion,
        draftContent: draftSnapshot.contentSnapshot,
        draftContentDigest: draftSnapshot.contentHash,
        finalDocument,
        finalContentDigest,
        sourceSnapshot: input.sourceSnapshot,
        sourceSnapshotDigest,
        licenseRef: requireText(input.licenseRef, 'knowledge_durability_license_ref_required'),
        licenseVersion: requireText(input.licenseVersion, 'knowledge_durability_license_version_required'),
    });
    const bytes = Buffer.from(canonicalGovernanceJson(SNAPSHOT_DOMAIN, snapshot), 'utf8');
    const replicaDigest = sha256(bytes);
    const locator = replicaLocator(knowledgeId, knowledgeVersion);
    await writeReplica(locator, bytes);
    const readback = await readReplica(locator);
    if (!readback || sha256(readback) !== replicaDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_replica_readback_failed', 503);
    }
    const policy = resolveKnowledgeDurabilityPolicy('public');
    const policyDigest = hashCanonicalGovernanceValue(POLICY_DOMAIN, policy);
    const recordId = `knowledge-durability:${knowledgeId}:v${knowledgeVersion}`;
    const manifestJson = {
        schemaVersion: 1,
        recordId,
        knowledgeId,
        knowledgeVersion,
        targetCircleId: knowledge.circleId,
        sourceDraftPostId: draftPostId,
        sourceDraftVersion: draftVersion,
        draftContentDigest: draftSnapshot.contentHash,
        contentDigest: finalContentDigest,
        finalDocumentTitle: parsedDocument.title,
        sourceSnapshotDigest,
        publicationOriginDigest: knowledge.publicationOriginDigest,
        licenseRef: input.licenseRef,
        licenseVersion: input.licenseVersion,
        visibility: policy.visibility,
        tier: policy.tier,
        policyDigest,
        replicaProvider: 'local_fs_independent',
        replicaLocator: locator,
        replicaDigest,
        replicaByteSize: bytes.byteLength,
        recovery: {
            canonicalOwner: 'KnowledgePublicationVersion+DraftVersionSnapshot',
            repairOwner: policy.repairOwner,
            providerRuntime: 'not_configured',
        },
    };
    const manifestDigest = hashCanonicalGovernanceValue(MANIFEST_DOMAIN, manifestJson);
    const record = {
        id: recordId,
        knowledgeId,
        knowledgeVersion,
        sourceDraftPostId: draftPostId,
        sourceDraftVersion: draftVersion,
        visibility: policy.visibility,
        tier: policy.tier,
        contentDigest: finalContentDigest,
        manifestJson,
        manifestDigest,
        policyJson: policy,
        policyDigest,
        replicaProvider: 'local_fs_independent' as const,
        replicaLocator: locator,
        replicaDigest,
        replicaByteSize: bytes.byteLength,
        status: 'healthy' as const,
        lastVerifiedAt: now,
        createdAt: now,
    };
    return {
        record,
        initialEvent: buildEvent({
            recordId,
            eventType: 'replica_created',
            status: 'healthy',
            expectedDigest: replicaDigest,
            observedDigest: replicaDigest,
            occurredAt: now,
        }),
    };
}

export async function persistPreparedKnowledgeDurability(
    prisma: PrismaLike,
    prepared: PreparedKnowledgeDurability,
) {
    const existing = await prisma.knowledgeDurabilityRecord.findUnique({
        where: {
            knowledgeId_knowledgeVersion: {
                knowledgeId: prepared.record.knowledgeId,
                knowledgeVersion: prepared.record.knowledgeVersion,
            },
        },
    });
    if (existing) {
        if (
            existing.id !== prepared.record.id
            || existing.manifestDigest !== prepared.record.manifestDigest
            || existing.policyDigest !== prepared.record.policyDigest
            || existing.replicaDigest !== prepared.record.replicaDigest
        ) throw new KnowledgeDurabilityError('knowledge_durability_immutable_conflict', 409);
        return existing;
    }
    const record = await prisma.knowledgeDurabilityRecord.create({ data: prepared.record });
    await prisma.knowledgeDurabilityEvent.create({ data: prepared.initialEvent });
    return record;
}

export async function restrictKnowledgeDurabilityRecords(input: {
    prisma: PrismaLike;
    knowledgeIds: string[];
    now?: Date;
}): Promise<void> {
    const knowledgeIds = [...new Set(input.knowledgeIds.map((value) => String(value || '').trim()).filter(Boolean))];
    if (knowledgeIds.length === 0) return;
    const records = await input.prisma.knowledgeDurabilityRecord.findMany({
        where: { knowledgeId: { in: knowledgeIds }, visibility: 'public' },
    });
    const policy = resolveKnowledgeDurabilityPolicy('members');
    const policyDigest = hashCanonicalGovernanceValue(POLICY_DOMAIN, policy);
    const occurredAt = input.now ?? new Date();
    for (const record of records) {
        const manifestJson = {
            ...(record.manifestJson as Record<string, unknown>),
            visibility: policy.visibility,
            tier: policy.tier,
            policyDigest,
        };
        const manifestDigest = hashCanonicalGovernanceValue(MANIFEST_DOMAIN, manifestJson);
        const event = buildEvent({
            recordId: record.id,
            eventType: 'visibility_restricted',
            status: record.status,
            expectedDigest: record.replicaDigest,
            observedDigest: record.status === 'healthy' ? record.replicaDigest : null,
            occurredAt,
        });
        await input.prisma.knowledgeDurabilityRecord.update({
            where: { id: record.id },
            data: {
                visibility: policy.visibility,
                tier: policy.tier,
                policyJson: policy,
                policyDigest,
                manifestJson,
                manifestDigest,
            },
        });
        await appendEvent(input.prisma, event);
    }
}

export async function destroyKnowledgeContent(input: {
    prisma: PrismaLike;
    knowledgeId: string;
    authorUserId: number;
    actorPubkey: string;
    now?: Date;
}) {
    const knowledgeId = requireText(input.knowledgeId, 'knowledge_id_required');
    const knowledge = await input.prisma.knowledge.findUnique({
        where: { knowledgeId },
        select: {
            authorId: true,
            publicationState: true,
        },
    });
    if (!knowledge) throw new KnowledgeDurabilityError('knowledge_not_found', 404);
    if (Number(knowledge.authorId) !== Number(input.authorUserId)) {
        throw new KnowledgeDurabilityError('knowledge_author_required', 403);
    }
    if (knowledge.publicationState === 'deleted') {
        return buildKnowledgeDeletionReceipt({
            knowledgeId,
            actorPubkey: input.actorPubkey,
            deletedAt: input.now ?? new Date(),
            deletedReplicaCount: 0,
            idempotent: true,
        });
    }

    const durabilityRecords = await input.prisma.knowledgeDurabilityRecord.findMany({
        where: { knowledgeId },
        select: {
            id: true,
            replicaLocator: true,
            sourceDraftPostId: true,
        },
    });
    const stagedReplicas: Array<{ locator: string; bytes: Uint8Array }> = [];
    for (const record of durabilityRecords) {
        const bytes = await readReplica(record.replicaLocator);
        if (!bytes) continue;
        await unlink(resolveReplicaPath(record.replicaLocator));
        if (await readReplica(record.replicaLocator)) {
            throw new KnowledgeDurabilityError('knowledge_durability_replica_delete_readback_failed', 503);
        }
        stagedReplicas.push({ locator: record.replicaLocator, bytes });
    }

    const deletedAt = input.now ?? new Date();
    const emptyDigest = sha256('');
    const draftPostIds = [...new Set<number>(
        durabilityRecords
            .map((record: any) => Number(record.sourceDraftPostId))
            .filter((value: number) => Number.isInteger(value) && value > 0),
    )];
    const ownedMaterials = draftPostIds.length > 0
        ? await input.prisma.sourceMaterial.findMany({
            where: {
                draftPostId: { in: draftPostIds },
                uploadedByUserId: input.authorUserId,
            },
            select: { id: true },
        })
        : [];
    const sourceMaterialIds = ownedMaterials.map((material: any) => Number(material.id));

    try {
        await input.prisma.$transaction(async (tx: any) => {
            if (sourceMaterialIds.length > 0) {
                await tx.sourceMaterialChunk.updateMany({
                    where: { sourceMaterialId: { in: sourceMaterialIds } },
                    data: {
                        text: '',
                        textLocator: null,
                        textDigest: emptyDigest,
                        locatorRef: 'deleted',
                    },
                });
                await tx.sourceMaterial.updateMany({
                    where: { id: { in: sourceMaterialIds } },
                    data: {
                        name: '[deleted by author]',
                        byteSize: 0,
                        rawText: null,
                        rawTextLocator: null,
                        contentDigest: emptyDigest,
                        canonicalUrl: null,
                        externalAuthorLabel: null,
                        summaryText: null,
                        lifecycleStatus: 'redacted',
                        evidencePrivacyClass: 'redacted',
                        visibilityScope: 'sealed',
                        licenseFacts: null,
                        licenseFactsDigest: null,
                        licenseAuthorizedByPubkey: null,
                        licenseAuthorizedAt: null,
                        provenance: {
                            schemaVersion: 1,
                            state: 'deleted_by_author',
                            deletedAt: deletedAt.toISOString(),
                        },
                    },
                });
            }
            if (draftPostIds.length > 0) {
                await tx.draftVersionSnapshot.updateMany({
                    where: { draftPostId: { in: draftPostIds } },
                    data: {
                        contentSnapshot: '',
                        contentHash: emptyDigest,
                        sourceSummaryHash: null,
                        sourceMessagesDigest: null,
                        crystallizationRoutingReceipt: null,
                    },
                });
                await tx.post.updateMany({
                    where: {
                        id: { in: draftPostIds },
                        authorId: input.authorUserId,
                    },
                    data: {
                        text: null,
                        storageUri: null,
                        storageProvider: null,
                    },
                });
            }
            await tx.knowledgePublicationVersion.updateMany({
                where: { knowledgeId },
                data: {
                    state: 'withdrawn',
                    sourceSnapshotJson: {
                        schemaVersion: 1,
                        state: 'deleted_by_author',
                    },
                    sourceSnapshotDigest: emptyDigest,
                    authorizationDigest: emptyDigest,
                    authorizedContributors: [],
                    withdrawnAt: deletedAt,
                },
            });
            await tx.knowledgeDurabilityEvent.deleteMany({
                where: { recordId: { in: durabilityRecords.map((record: any) => record.id) } },
            });
            await tx.knowledgeDurabilityRecord.deleteMany({ where: { knowledgeId } });
            await tx.knowledge.update({
                where: { knowledgeId },
                data: {
                    title: '[deleted by author]',
                    description: null,
                    ipfsCid: null,
                    contentHash: null,
                    sourceContentId: null,
                    publicationOrigin: null,
                    publicationOriginDigest: null,
                    publicationState: 'deleted',
                    publicationLicenseRef: null,
                    publicationLicenseVersion: null,
                    publicationLicenseDigest: null,
                    publicationSourceSnapshotDigest: null,
                    stablePublicPath: null,
                    publicReleaseAuthorizedAt: null,
                    crystalParams: null,
                },
            });
        });
    } catch (error) {
        await Promise.all(stagedReplicas.map((replica) => writeReplica(replica.locator, replica.bytes)));
        throw error;
    }

    return buildKnowledgeDeletionReceipt({
        knowledgeId,
        actorPubkey: input.actorPubkey,
        deletedAt,
        deletedReplicaCount: stagedReplicas.length,
        idempotent: false,
    });
}

function buildKnowledgeDeletionReceipt(input: {
    knowledgeId: string;
    actorPubkey: string;
    deletedAt: Date;
    deletedReplicaCount: number;
    idempotent: boolean;
}) {
    return {
        schemaVersion: 1,
        status: 'deleted',
        knowledgeId: input.knowledgeId,
        actorPubkey: input.actorPubkey,
        deletedAt: input.deletedAt.toISOString(),
        databaseContent: 'deleted',
        localReplica: 'deleted',
        deletedReplicaCount: input.deletedReplicaCount,
        idempotent: input.idempotent,
        retainedTombstone: 'non_content_status_only',
        externalStores: {
            kms: 'not_configured_not_applicable',
            provider: 'not_configured_not_applicable',
            cache: 'not_configured_not_applicable',
            backup: 'not_configured_not_applicable',
        },
    } as const;
}

async function loadRecord(prisma: PrismaLike, knowledgeId: string) {
    const knowledge = await prisma.knowledge.findUnique({
        where: { knowledgeId },
        select: { version: true },
    });
    if (!knowledge) throw new KnowledgeDurabilityError('knowledge_not_found', 404);
    const record = await prisma.knowledgeDurabilityRecord.findUnique({
        where: {
            knowledgeId_knowledgeVersion: {
                knowledgeId,
                knowledgeVersion: Number(knowledge.version || 1),
            },
        },
    });
    if (!record) throw new KnowledgeDurabilityError('knowledge_durability_not_configured', 409);
    return record;
}

async function appendEvent(prisma: PrismaLike, event: ReturnType<typeof buildEvent>) {
    return prisma.knowledgeDurabilityEvent.upsert({
        where: { id: event.id },
        create: event,
        update: {},
    });
}

export async function verifyKnowledgeDurability(input: {
    prisma: PrismaLike;
    knowledgeId: string;
    actorPubkey: string;
    now?: Date;
}) {
    const record = await loadRecord(input.prisma, input.knowledgeId);
    const now = input.now ?? new Date();
    let bytes: Uint8Array | null = null;
    try {
        bytes = await readReplica(record.replicaLocator);
    } catch {
        bytes = null;
    }
    const observedDigest = bytes ? sha256(bytes) : null;
    const status: KnowledgeDurabilityStatus = !bytes
        ? 'unavailable'
        : observedDigest === record.replicaDigest
            ? 'healthy'
            : 'corrupt';
    const eventType = status === 'healthy'
        ? 'verified'
        : status === 'corrupt'
            ? 'corruption_detected'
            : 'replica_unavailable';
    const event = buildEvent({
        recordId: record.id,
        eventType,
        status,
        expectedDigest: record.replicaDigest,
        observedDigest,
        actorPubkey: input.actorPubkey,
        occurredAt: now,
    });
    await input.prisma.$transaction(async (tx: any) => {
        await tx.knowledgeDurabilityRecord.update({
            where: { id: record.id },
            data: { status, lastVerifiedAt: now },
        });
        await appendEvent(tx, event);
    });
    return loadKnowledgeDurabilityReadback({ prisma: input.prisma, knowledgeId: input.knowledgeId, now });
}

async function rebuildReplicaBytes(prisma: PrismaLike, record: any): Promise<Uint8Array> {
    const manifest = record.manifestJson as Record<string, any>;
    const [knowledge, publication, draftSnapshot] = await Promise.all([
        prisma.knowledge.findUnique({
            where: { knowledgeId: record.knowledgeId },
            select: {
                knowledgeId: true,
                circleId: true,
                title: true,
                description: true,
                publicationOrigin: true,
                publicationOriginDigest: true,
            },
        }),
        prisma.knowledgePublicationVersion.findUnique({
            where: {
                knowledgeId_version: {
                    knowledgeId: record.knowledgeId,
                    version: record.knowledgeVersion,
                },
            },
        }),
        loadDraftVersionSnapshot(prisma as PrismaClient, {
            draftPostId: record.sourceDraftPostId,
            draftVersion: record.sourceDraftVersion,
        }),
    ]);
    if (!knowledge || !publication || !draftSnapshot) {
        throw new KnowledgeDurabilityError('knowledge_durability_canonical_source_missing', 409);
    }
    const finalDocument = buildFinalDocument({
        draftPostId: record.sourceDraftPostId,
        title: requireText(manifest.finalDocumentTitle, 'knowledge_durability_final_document_title_required'),
        content: draftSnapshot.contentSnapshot,
    });
    if (sha256(finalDocument) !== record.contentDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_canonical_reconstruction_mismatch', 409);
    }
    const snapshot = buildSnapshot({
        knowledge,
        knowledgeVersion: record.knowledgeVersion,
        draftPostId: record.sourceDraftPostId,
        draftVersion: record.sourceDraftVersion,
        draftContent: draftSnapshot.contentSnapshot,
        draftContentDigest: draftSnapshot.contentHash,
        finalDocument,
        finalContentDigest: record.contentDigest,
        sourceSnapshot: publication.sourceSnapshotJson as Record<string, unknown>,
        sourceSnapshotDigest: publication.sourceSnapshotDigest,
        licenseRef: publication.licenseRef,
        licenseVersion: publication.licenseVersion,
    });
    const bytes = Buffer.from(canonicalGovernanceJson(SNAPSHOT_DOMAIN, snapshot), 'utf8');
    if (sha256(bytes) !== record.replicaDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_canonical_snapshot_drift', 409);
    }
    return bytes;
}

export async function repairKnowledgeDurability(input: {
    prisma: PrismaLike;
    knowledgeId: string;
    actorPubkey: string;
    now?: Date;
}) {
    const record = await loadRecord(input.prisma, input.knowledgeId);
    const now = input.now ?? new Date();
    const bytes = await rebuildReplicaBytes(input.prisma, record);
    const started = buildEvent({
        recordId: record.id,
        eventType: 'repair_started',
        status: 'repair_pending',
        expectedDigest: record.replicaDigest,
        observedDigest: null,
        actorPubkey: input.actorPubkey,
        occurredAt: now,
    });
    await input.prisma.$transaction(async (tx: any) => {
        await tx.knowledgeDurabilityRecord.update({
            where: { id: record.id },
            data: { status: 'repair_pending' },
        });
        await appendEvent(tx, started);
    });
    await writeReplica(record.replicaLocator, bytes);
    const readback = await readReplica(record.replicaLocator);
    const observedDigest = readback ? sha256(readback) : null;
    if (observedDigest !== record.replicaDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_repair_readback_failed', 503);
    }
    const completedAt = new Date(now.getTime() + 1);
    const completed = buildEvent({
        recordId: record.id,
        eventType: 'repair_completed',
        status: 'healthy',
        expectedDigest: record.replicaDigest,
        observedDigest,
        actorPubkey: input.actorPubkey,
        occurredAt: completedAt,
    });
    await input.prisma.$transaction(async (tx: any) => {
        await tx.knowledgeDurabilityRecord.update({
            where: { id: record.id },
            data: {
                status: 'healthy',
                lastVerifiedAt: completedAt,
                lastRepairedAt: completedAt,
                repairCount: { increment: 1 },
            },
        });
        await appendEvent(tx, completed);
    });
    return loadKnowledgeDurabilityReadback({ prisma: input.prisma, knowledgeId: input.knowledgeId, now: completedAt });
}

export async function loadKnowledgeDurabilityReadback(input: {
    prisma: PrismaLike;
    knowledgeId: string;
    now?: Date;
}) {
    const record = await loadRecord(input.prisma, input.knowledgeId);
    const policy = record.policyJson as unknown as KnowledgeDurabilityPolicy;
    if (hashCanonicalGovernanceValue(POLICY_DOMAIN, policy) !== record.policyDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_policy_corrupt', 409);
    }
    if (hashCanonicalGovernanceValue(MANIFEST_DOMAIN, record.manifestJson) !== record.manifestDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_manifest_corrupt', 409);
    }
    const events = await input.prisma.knowledgeDurabilityEvent.findMany({
        where: { recordId: record.id },
        orderBy: { occurredAt: 'desc' },
        take: 20,
        select: {
            id: true,
            eventType: true,
            status: true,
            expectedDigest: true,
            observedDigest: true,
            evidenceDigest: true,
            occurredAt: true,
        },
    });
    const verificationDueAt = new Date(
        new Date(record.lastVerifiedAt).getTime() + policy.verificationIntervalSeconds * 1_000,
    );
    const now = input.now ?? new Date();
    return {
        schemaVersion: 1,
        knowledgeId: record.knowledgeId,
        knowledgeVersion: record.knowledgeVersion,
        sourceDraftPostId: record.sourceDraftPostId,
        sourceDraftVersion: record.sourceDraftVersion,
        visibility: record.visibility,
        tier: record.tier,
        contentDigest: record.contentDigest,
        manifestDigest: record.manifestDigest,
        policy,
        policyDigest: record.policyDigest,
        replicaProvider: record.replicaProvider,
        replicaDigest: record.replicaDigest,
        replicaByteSize: record.replicaByteSize,
        status: record.status,
        lastVerifiedAt: new Date(record.lastVerifiedAt).toISOString(),
        verificationDueAt: verificationDueAt.toISOString(),
        verificationOverdue: verificationDueAt.getTime() <= now.getTime(),
        lastRepairedAt: record.lastRepairedAt ? new Date(record.lastRepairedAt).toISOString() : null,
        repairCount: record.repairCount,
        events: events.map((event: any) => ({
            ...event,
            occurredAt: new Date(event.occurredAt).toISOString(),
        })),
    };
}

export async function exportKnowledgeDurability(input: {
    prisma: PrismaLike;
    knowledgeId: string;
}) {
    const record = await loadRecord(input.prisma, input.knowledgeId);
    const bytes = await readReplica(record.replicaLocator);
    if (!bytes || sha256(bytes) !== record.replicaDigest) {
        throw new KnowledgeDurabilityError('knowledge_durability_export_replica_unhealthy', 409);
    }
    let wrapper: any;
    try {
        wrapper = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
        throw new KnowledgeDurabilityError('knowledge_durability_export_replica_corrupt', 409);
    }
    if (wrapper?.domain !== SNAPSHOT_DOMAIN || wrapper?.version !== 1 || !wrapper?.payload) {
        throw new KnowledgeDurabilityError('knowledge_durability_export_replica_corrupt', 409);
    }
    return {
        schemaVersion: 1,
        manifest: record.manifestJson,
        manifestDigest: record.manifestDigest,
        policy: record.policyJson,
        policyDigest: record.policyDigest,
        replicaDigest: record.replicaDigest,
        snapshot: wrapper.payload,
        recoveryInstructions: {
            canonicalOwner: 'KnowledgePublicationVersion+DraftVersionSnapshot',
            repairEndpoint: `/api/v1/crystals/${encodeURIComponent(record.knowledgeId)}/durability/repair`,
            productionProviderStatus: 'not_configured',
        },
    };
}
