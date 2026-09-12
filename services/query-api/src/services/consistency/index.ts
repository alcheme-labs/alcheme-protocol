import type { PrismaClient } from '@prisma/client';
import { DISCUSSION_STREAM_KEY } from '../offchainDiscussion';
import { buildPublicOffchainPeerRef, resolveOffchainPeerSyncTargets } from '../offchainPeerSync';
import { buildSolanaSettlementCheckpoint } from '../settlement/solanaAdapter';
import type { SettlementCheckpoint } from '../settlement/types';
import { getConfiguredCollabStorageInfo } from '../../collab/persistence';
import {
    auditChainProjectionConsistency,
    toChainProjectionAuditAggregate,
    type ChainProjectionAuditAggregate,
} from './chainProjectionAudit';
import { loadNodeRuntimeConfig } from '../../config/services';
import { listQueryRuntimeTaskStates } from '../runtime/queryRuntimeTaskState';

export interface ConsistencyCheckpoint {
    programId: string;
    programName: string;
    lastProcessedSlot: number;
    lastSuccessfulSync: string | null;
}

export interface ProjectionCompleteness {
    state: 'complete' | 'degraded' | 'unknown';
    unresolvedFailedSlotCount: number;
    oldestUnresolvedFailedSlot: number | null;
    newestUnresolvedFailedSlot: number | null;
}

export interface ConsistencyStatus {
    indexerId: string;
    readCommitment: string;
    phase: string;
    streamConnected: boolean;
    projectedSlot: number;
    coverageSlot: number;
    confirmedCoverageSlot: number | null;
    finalizedCoverageSlot: number | null;
    indexedSlot: number;
    headSlot: number | null;
    slotLag: number | null;
    recoveryFromSlot: number | null;
    recoveryTargetSlot: number | null;
    filterGenerationHash: string | null;
    filterEffectiveFromSlot: number | null;
    discoveredExtensionProgramIds: string[];
    stale: boolean;
    generatedAt: string;
    checkpoints: ConsistencyCheckpoint[];
    offchain: {
        streamKey: string;
        lastLamport: number;
        lastEnvelopeId: string | null;
        lastIngestedAt: string | null;
        stale: boolean;
    } | null;
    offchainPeers: Array<{
        peerRef: string;
        lastRemoteLamport: number;
        lastSuccessAt: string | null;
        hasError: boolean;
        stale: boolean;
    }>;
    background: {
        mode: string;
        aiJobWorker: boolean;
        singletonSchedulers: boolean;
        tasks: Array<{
            taskKey: string;
            running: boolean;
            leaseUntil: string | null;
            lastStartedAt: string | null;
            lastHeartbeatAt: string | null;
            lastCompletedAt: string | null;
            lastSkippedAt: string | null;
            hasError: boolean;
        }>;
    };
    settlement: SettlementCheckpoint;
    collab: {
        transportMode: 'builtin' | 'external';
        storagePolicy: 'trusted_private' | 'ephemeral_public' | 'external_service';
        persistentPlaintext: boolean;
        persistenceBackend: 'leveldb' | 'runtime_memory' | 'external';
        shareableState: string[];
    };
    alerts: {
        indexerLagWarning: boolean;
        indexerLagCritical: boolean;
        failedSlotsPending: number | null;
        failedSlotsOldestAgeSec: number | null;
        failedSlotsWarning: boolean;
        failedSlotsCritical: boolean;
        pendingGhostSettings: number | null;
        pendingGhostSettingsOldestAgeSec: number | null;
        pendingGhostSettingsWarning: boolean;
        pendingGhostSettingsCritical: boolean;
    };
    projectionCompleteness: ProjectionCompleteness;
    chainProjectionAudit:
        | ({ enabled: true } & ChainProjectionAuditAggregate)
        | {
            enabled: false;
            reason: 'disabled' | 'audit_unavailable';
            message?: string;
        };
}

interface IndexerRuntimeSnapshot {
    indexerId: string;
    listenerMode: string;
    phase: string;
    currentSlot: number | null;
    observedHeadSlot: number | null;
    coverageSlot: number | null;
    confirmedCoverageSlot: number | null;
    finalizedCoverageSlot: number | null;
    recoveryFromSlot: number | null;
    recoveryTargetSlot: number | null;
    grpcConnected: boolean;
    filterGenerationHash: string | null;
    filterEffectiveFromSlot: number | null;
    discoveredExtensionProgramIds: string[];
    lastProgressAt: string;
    lastError: string | null;
}

function toMillis(value: Date | null | undefined): number | null {
    if (!value) return null;
    return value.getTime();
}

function toIso(value: Date | null | undefined): string | null {
    return value?.toISOString() || null;
}

async function loadFailedSlotAlertStats(prisma: PrismaClient): Promise<{
    pendingCount: number | null;
    oldestAgeSec: number | null;
    oldestUnresolvedFailedSlot: number | null;
    newestUnresolvedFailedSlot: number | null;
}> {
    try {
        const rows = await prisma.$queryRaw<Array<{
            pendingCount: bigint;
            oldestAgeSec: bigint | null;
            oldestUnresolvedFailedSlot: bigint | null;
            newestUnresolvedFailedSlot: bigint | null;
        }>>`
            SELECT
                COUNT(*)::bigint AS "pendingCount",
                EXTRACT(EPOCH FROM (NOW() - MIN(first_failed_at)))::bigint AS "oldestAgeSec",
                MIN(slot)::bigint AS "oldestUnresolvedFailedSlot",
                MAX(slot)::bigint AS "newestUnresolvedFailedSlot"
            FROM indexer_failed_slots
            WHERE resolved = FALSE
        `;
        const row = rows[0];
        if (!row) {
            return {
                pendingCount: 0,
                oldestAgeSec: null,
                oldestUnresolvedFailedSlot: null,
                newestUnresolvedFailedSlot: null,
            };
        }
        return {
            pendingCount: Number(row.pendingCount || 0),
            oldestAgeSec: row.oldestAgeSec === null ? null : Number(row.oldestAgeSec),
            oldestUnresolvedFailedSlot: row.oldestUnresolvedFailedSlot === null
                ? null
                : Number(row.oldestUnresolvedFailedSlot),
            newestUnresolvedFailedSlot: row.newestUnresolvedFailedSlot === null
                ? null
                : Number(row.newestUnresolvedFailedSlot),
        };
    } catch {
        return {
            pendingCount: null,
            oldestAgeSec: null,
            oldestUnresolvedFailedSlot: null,
            newestUnresolvedFailedSlot: null,
        };
    }
}

function buildProjectionCompleteness(input: {
    pendingCount: number | null;
    oldestUnresolvedFailedSlot: number | null;
    newestUnresolvedFailedSlot: number | null;
}): ProjectionCompleteness {
    if (input.pendingCount === null) {
        return {
            state: 'unknown',
            unresolvedFailedSlotCount: 0,
            oldestUnresolvedFailedSlot: null,
            newestUnresolvedFailedSlot: null,
        };
    }
    return {
        state: input.pendingCount > 0 ? 'degraded' : 'complete',
        unresolvedFailedSlotCount: input.pendingCount,
        oldestUnresolvedFailedSlot: input.oldestUnresolvedFailedSlot,
        newestUnresolvedFailedSlot: input.newestUnresolvedFailedSlot,
    };
}

async function loadPendingGhostSettingsAlertStats(prisma: PrismaClient): Promise<{
    pendingCount: number | null;
    oldestAgeSec: number | null;
}> {
    try {
        const rows = await prisma.$queryRaw<Array<{
            pendingCount: bigint;
            oldestAgeSec: bigint | null;
        }>>`
            SELECT
                COUNT(*)::bigint AS "pendingCount",
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::bigint AS "oldestAgeSec"
            FROM pending_circle_ghost_settings
            WHERE expires_at > NOW()
        `;
        const row = rows[0];
        if (!row) return { pendingCount: 0, oldestAgeSec: null };
        return {
            pendingCount: Number(row.pendingCount || 0),
            oldestAgeSec: row.oldestAgeSec === null ? null : Number(row.oldestAgeSec),
        };
    } catch {
        return { pendingCount: null, oldestAgeSec: null };
    }
}

async function loadRuntimeSnapshot(
    prisma: PrismaClient,
    indexerId: string,
): Promise<IndexerRuntimeSnapshot | null> {
    try {
        const row = await prisma.indexerRuntimeState.findUnique({
            where: { indexerId },
            select: {
                indexerId: true,
                listenerMode: true,
                phase: true,
                currentSlot: true,
                observedHeadSlot: true,
                coverageSlot: true,
                confirmedCoverageSlot: true,
                finalizedCoverageSlot: true,
                recoveryFromSlot: true,
                recoveryTargetSlot: true,
                grpcConnected: true,
                filterGenerationHash: true,
                filterEffectiveFromSlot: true,
                discoveredExtensionProgramIds: true,
                lastProgressAt: true,
                lastError: true,
            },
        });

        if (!row) {
            return null;
        }

        return {
            indexerId: row.indexerId,
            listenerMode: row.listenerMode,
            phase: row.phase,
            currentSlot: row.currentSlot === null ? null : Number(row.currentSlot),
            observedHeadSlot: row.observedHeadSlot == null ? null : Number(row.observedHeadSlot),
            coverageSlot: row.coverageSlot == null ? null : Number(row.coverageSlot),
            confirmedCoverageSlot: row.confirmedCoverageSlot == null
                ? null
                : Number(row.confirmedCoverageSlot),
            finalizedCoverageSlot: row.finalizedCoverageSlot == null
                ? null
                : Number(row.finalizedCoverageSlot),
            recoveryFromSlot: row.recoveryFromSlot == null ? null : Number(row.recoveryFromSlot),
            recoveryTargetSlot: row.recoveryTargetSlot == null
                ? null
                : Number(row.recoveryTargetSlot),
            grpcConnected: row.grpcConnected || false,
            filterGenerationHash: row.filterGenerationHash || null,
            filterEffectiveFromSlot: row.filterEffectiveFromSlot == null
                ? null
                : Number(row.filterEffectiveFromSlot),
            discoveredExtensionProgramIds: row.discoveredExtensionProgramIds || [],
            lastProgressAt: row.lastProgressAt.toISOString(),
            lastError: row.lastError,
        };
    } catch {
        return null;
    }
}

export async function loadConsistencyStatus(prisma: PrismaClient): Promise<ConsistencyStatus> {
    const staleAfterMs = Number(process.env.INDEXER_STALE_AFTER_MS || '120000');
    const runtimeProgressStaleAfterMs = Number(process.env.INDEXER_RUNTIME_PROGRESS_STALE_AFTER_MS || '15000');
    const offchainStaleAfterMs = Number(process.env.OFFCHAIN_STALE_AFTER_MS || '120000');
    const offchainRequired = process.env.OFFCHAIN_SYNC_REQUIRED === 'true';
    const peerStaleAfterMs = Number(process.env.OFFCHAIN_PEER_STALE_AFTER_MS || '300000');
    const readCommitment = process.env.INDEXER_READ_COMMITMENT || 'confirmed';
    const configuredIndexerId = process.env.INDEXER_ID?.trim() || 'local-indexer-1';
    const maxSlotLag = Number(process.env.INDEXER_MAX_SLOT_LAG || '2000');
    const collabTransportMode = (
        String(process.env.COLLAB_MODE || 'builtin').trim().toLowerCase() === 'external'
            ? 'external'
            : 'builtin'
    ) as 'builtin' | 'external';
    const collabStorage = getConfiguredCollabStorageInfo();
    const lagWarningThreshold = Number(process.env.INDEXER_SLOT_LAG_WARNING || '2000');
    const lagCriticalThreshold = Number(process.env.INDEXER_SLOT_LAG_CRITICAL || '10000');
    const failedSlotWarningCount = Number(process.env.INDEXER_FAILED_SLOT_WARNING_COUNT || '1');
    const failedSlotCriticalAgeSec = Number(process.env.INDEXER_FAILED_SLOT_CRITICAL_AGE_SEC || '300');
    const pendingGhostWarningCount = Number(process.env.PENDING_GHOST_SETTINGS_WARNING_COUNT || '10');
    const pendingGhostCriticalAgeSec = Number(process.env.PENDING_GHOST_SETTINGS_CRITICAL_AGE_SEC || '900');
    const runtimeSnapshot = await loadRuntimeSnapshot(prisma, configuredIndexerId);
    const indexerId = configuredIndexerId;

    const rows = await prisma.syncCheckpoint.findMany({
        orderBy: { lastProcessedSlot: 'desc' },
        select: {
            programId: true,
            programName: true,
            lastProcessedSlot: true,
            lastSuccessfulSync: true,
        },
    });

    const checkpoints: ConsistencyCheckpoint[] = rows.map((row) => ({
        programId: row.programId,
        programName: row.programName,
        lastProcessedSlot: Number(row.lastProcessedSlot),
        lastSuccessfulSync: row.lastSuccessfulSync?.toISOString() || null,
    }));

    const checkpointIndexedSlot = checkpoints.reduce(
        (maxSlot, cp) => (cp.lastProcessedSlot > maxSlot ? cp.lastProcessedSlot : maxSlot),
        0,
    );
    const now = Date.now();
    const runtimeLastProgressAt = runtimeSnapshot ? toMillis(new Date(runtimeSnapshot.lastProgressAt)) : null;
    const runtimeFresh = runtimeLastProgressAt !== null
        && now - runtimeLastProgressAt <= runtimeProgressStaleAfterMs;
    const runtimeHealthy = Boolean(
        runtimeSnapshot
        && runtimeFresh
        && runtimeSnapshot.phase !== 'error'
        && !runtimeSnapshot.lastError
        && (
            runtimeSnapshot.listenerMode !== 'yellowstone'
            || (runtimeSnapshot.grpcConnected && runtimeSnapshot.phase === 'live')
        )
    );
    const legacyLocalCoverageSlot = runtimeSnapshot
        && runtimeSnapshot.listenerMode !== 'yellowstone'
        && runtimeSnapshot.currentSlot !== null
        ? runtimeSnapshot.currentSlot
        : null;
    const runtimeCoverageSlot = runtimeHealthy && runtimeSnapshot
        ? (runtimeSnapshot.coverageSlot ?? legacyLocalCoverageSlot)
        : null;
    const indexedSlot = runtimeCoverageSlot !== null
        ? runtimeCoverageSlot
        : checkpointIndexedSlot;
    const headSlot = runtimeSnapshot?.observedHeadSlot
        ?? (runtimeSnapshot?.listenerMode !== 'yellowstone' ? runtimeSnapshot?.currentSlot ?? null : null);
    const slotLag = headSlot === null ? null : Math.max(0, headSlot - indexedSlot);
    // A filtered Yellowstone stream can remain fully healthy across thousands of
    // slots with no matching program transaction. Its durable coverage baseline
    // therefore must not be compared to the global head as if it were a full
    // block scanner. Stream/recovery health is authoritative for this mode.
    const applyGlobalSlotLag = runtimeSnapshot?.listenerMode !== 'yellowstone';
    const lagStale = applyGlobalSlotLag && slotLag !== null && slotLag > maxSlotLag;
    const failedSlotStats = await loadFailedSlotAlertStats(prisma);
    const projectionCompleteness = buildProjectionCompleteness(failedSlotStats);
    const pendingGhostStats = await loadPendingGhostSettingsAlertStats(prisma);
    const indexerLagWarning = applyGlobalSlotLag
        && slotLag !== null
        && slotLag > lagWarningThreshold;
    const indexerLagCritical = applyGlobalSlotLag
        && slotLag !== null
        && slotLag > lagCriticalThreshold;
    const failedSlotsWarning =
        failedSlotStats.pendingCount !== null && failedSlotStats.pendingCount >= failedSlotWarningCount;
    const failedSlotsCritical =
        failedSlotStats.oldestAgeSec !== null && failedSlotStats.oldestAgeSec >= failedSlotCriticalAgeSec;
    const pendingGhostSettingsWarning =
        pendingGhostStats.pendingCount !== null && pendingGhostStats.pendingCount >= pendingGhostWarningCount;
    const pendingGhostSettingsCritical =
        pendingGhostStats.oldestAgeSec !== null && pendingGhostStats.oldestAgeSec >= pendingGhostCriticalAgeSec;
    const runtime = loadNodeRuntimeConfig();
    const backgroundTaskRows = await listQueryRuntimeTaskStates(prisma);
    const background: ConsistencyStatus['background'] = {
        mode: runtime.backgroundMode,
        aiJobWorker: runtime.backgroundServices.aiJobWorker,
        singletonSchedulers: runtime.backgroundServices.singletonSchedulers,
        tasks: backgroundTaskRows.map((row) => ({
            taskKey: row.taskKey,
            running: Boolean(row.leaseUntil && row.leaseUntil.getTime() > now),
            leaseUntil: toIso(row.leaseUntil),
            lastStartedAt: toIso(row.lastStartedAt),
            lastHeartbeatAt: toIso(row.lastHeartbeatAt),
            lastCompletedAt: toIso(row.lastCompletedAt),
            lastSkippedAt: toIso(row.lastSkippedAt),
            hasError: !!row.lastError,
        })),
    };
    let chainProjectionAudit: ConsistencyStatus['chainProjectionAudit'] = {
        enabled: false,
        reason: 'disabled',
    };
    if (process.env.CHAIN_PROJECTION_AUDIT_ON_STATUS === 'true') {
        try {
            const audit = await auditChainProjectionConsistency(prisma, {
                limit: Number(process.env.CHAIN_PROJECTION_AUDIT_STATUS_LIMIT || '100'),
            });
            chainProjectionAudit = {
                enabled: true,
                ...toChainProjectionAuditAggregate(audit),
            };
        } catch (error) {
            chainProjectionAudit = {
                enabled: false,
                reason: 'audit_unavailable',
                message: error instanceof Error ? error.message : 'Unknown chain projection audit error',
            };
        }
    }

    const stale = checkpoints.some((cp) => {
        if (!cp.lastSuccessfulSync) return true;
        const lastSyncAt = toMillis(new Date(cp.lastSuccessfulSync));
        if (lastSyncAt === null) return true;
        return now - lastSyncAt > staleAfterMs;
    });

    let offchain: ConsistencyStatus['offchain'] = null;
    try {
        const rows = await prisma.$queryRaw<Array<{
            streamKey: string;
            lastLamport: bigint;
            lastEnvelopeId: string | null;
            lastIngestedAt: Date | null;
        }>>`
            SELECT
                stream_key AS "streamKey",
                last_lamport AS "lastLamport",
                last_envelope_id AS "lastEnvelopeId",
                last_ingested_at AS "lastIngestedAt"
            FROM offchain_sync_watermarks
            WHERE stream_key = ${DISCUSSION_STREAM_KEY}
            LIMIT 1
        `;

        if (rows[0]) {
            const row = rows[0];
            const lastIngestedAtMs = toMillis(row.lastIngestedAt);
            offchain = {
                streamKey: row.streamKey,
                lastLamport: Number(row.lastLamport),
                lastEnvelopeId: row.lastEnvelopeId,
                lastIngestedAt: row.lastIngestedAt?.toISOString() || null,
                stale: lastIngestedAtMs === null ? true : now - lastIngestedAtMs > offchainStaleAfterMs,
            };
        } else {
            offchain = {
                streamKey: DISCUSSION_STREAM_KEY,
                lastLamport: 0,
                lastEnvelopeId: null,
                lastIngestedAt: null,
                stale: true,
            };
        }
    } catch {
        // offchain table may not exist during rollout; keep null to avoid breaking /sync/status
        offchain = null;
    }

    let offchainPeers: ConsistencyStatus['offchainPeers'] = [];
    try {
        const rows = await prisma.$queryRaw<Array<{
            peerUrl: string;
            peerIdentity: string;
            lastRemoteLamport: bigint;
            lastSuccessAt: Date | null;
            lastError: string | null;
        }>>`
            SELECT
                peer_url AS "peerUrl",
                peer_identity AS "peerIdentity",
                last_remote_lamport AS "lastRemoteLamport",
                last_success_at AS "lastSuccessAt",
                last_error AS "lastError"
            FROM offchain_peer_sync_state
            ORDER BY peer_url ASC
        `;

        offchainPeers = rows.map((row) => {
            const lastSuccessAtMs = toMillis(row.lastSuccessAt);
            return {
                peerRef: buildPublicOffchainPeerRef(row.peerUrl, row.peerIdentity),
                lastRemoteLamport: Number(row.lastRemoteLamport),
                lastSuccessAt: row.lastSuccessAt?.toISOString() || null,
                hasError: !!row.lastError,
                stale: lastSuccessAtMs === null ? true : now - lastSuccessAtMs > peerStaleAfterMs,
            };
        });
    } catch {
        offchainPeers = [];
    }

    const configuredPeers = resolveOffchainPeerSyncTargets();
    const peerMap = new Map(offchainPeers.map((peer) => [peer.peerRef, peer]));
    const normalizedPeerStatuses = configuredPeers.map((peer) => {
        const peerRef = buildPublicOffchainPeerRef(peer.peerUrl, peer.peerIdentity);
        const existing = peerMap.get(peerRef);
        if (existing) return existing;
        return {
            peerRef,
            lastRemoteLamport: 0,
            lastSuccessAt: null,
            hasError: false,
            stale: true,
        };
    });
    offchainPeers = normalizedPeerStatuses;

    const peerSyncStale = offchainPeers.length > 0
        ? offchainPeers.some((peer) => peer.stale || peer.hasError)
        : false;

    const checkpointStale = runtimeSnapshot?.listenerMode === 'yellowstone'
        ? !runtimeHealthy
        : (runtimeHealthy ? false : stale);

    const finalStale = checkpoints.length === 0
        ? true
        : (checkpointStale || lagStale || (offchainRequired && ((offchain?.stale ?? true) || peerSyncStale)));

    const generatedAt = new Date().toISOString();
    const settlement = buildSolanaSettlementCheckpoint({
        readCommitment,
        indexedSlot,
        headSlot,
        slotLag,
        stale: finalStale,
        generatedAt,
    });

    return {
        indexerId,
        readCommitment,
        phase: runtimeSnapshot?.phase || 'starting',
        streamConnected: runtimeSnapshot?.grpcConnected || false,
        projectedSlot: checkpointIndexedSlot,
        coverageSlot: indexedSlot,
        confirmedCoverageSlot: runtimeSnapshot?.confirmedCoverageSlot ?? null,
        finalizedCoverageSlot: runtimeSnapshot?.finalizedCoverageSlot ?? null,
        indexedSlot,
        headSlot,
        slotLag,
        recoveryFromSlot: runtimeSnapshot?.recoveryFromSlot ?? null,
        recoveryTargetSlot: runtimeSnapshot?.recoveryTargetSlot ?? null,
        filterGenerationHash: runtimeSnapshot?.filterGenerationHash ?? null,
        filterEffectiveFromSlot: runtimeSnapshot?.filterEffectiveFromSlot ?? null,
        discoveredExtensionProgramIds: runtimeSnapshot?.discoveredExtensionProgramIds ?? [],
        stale: finalStale,
        generatedAt,
        checkpoints,
        offchain,
        offchainPeers,
        background,
        settlement,
        collab: {
            transportMode: collabTransportMode,
            storagePolicy: collabStorage.storagePolicy,
            persistentPlaintext: collabStorage.persistentPlaintext,
            persistenceBackend: collabStorage.persistenceBackend,
            shareableState: [
                'envelope_metadata',
                'batch_anchors',
                'snapshot_digests',
                'watermarks',
            ],
        },
        alerts: {
            indexerLagWarning,
            indexerLagCritical,
            failedSlotsPending: failedSlotStats.pendingCount,
            failedSlotsOldestAgeSec: failedSlotStats.oldestAgeSec,
            failedSlotsWarning,
            failedSlotsCritical,
            pendingGhostSettings: pendingGhostStats.pendingCount,
            pendingGhostSettingsOldestAgeSec: pendingGhostStats.oldestAgeSec,
            pendingGhostSettingsWarning,
            pendingGhostSettingsCritical,
        },
        projectionCompleteness,
        chainProjectionAudit,
    };
}
