import os from 'os';
import type { PrismaClient } from '@prisma/client';
import { DISCUSSION_STREAM_KEY } from './offchainDiscussion';
import { parseOffchainPeerUrls } from './offchainPeerSync';
import { getConfiguredCollabStorageInfo } from '../collab/persistence';

export interface ConsistencyCheckpoint {
    programId: string;
    programName: string;
    lastProcessedSlot: number;
    lastSuccessfulSync: string | null;
}

export interface ConsistencyStatus {
    indexerId: string;
    readCommitment: string;
    indexedSlot: number;
    headSlot: number | null;
    slotLag: number | null;
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
        peerUrl: string;
        lastRemoteLamport: number;
        lastSuccessAt: string | null;
        lastError: string | null;
        stale: boolean;
    }>;
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
}

interface IndexerRuntimeSnapshot {
    indexerId: string;
    listenerMode: string;
    phase: string;
    currentSlot: number | null;
    lastProgressAt: string;
    lastError: string | null;
}

function toMillis(value: Date | null | undefined): number | null {
    if (!value) return null;
    return value.getTime();
}

async function loadHeadSlot(readCommitment: string): Promise<number | null> {
    const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL;
    if (!rpcUrl) return null;

    const timeoutMs = Number(process.env.INDEXER_HEAD_SLOT_TIMEOUT_MS || '1500');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getSlot',
                params: [{ commitment: readCommitment }],
            }),
            signal: controller.signal,
        });

        if (!response.ok) return null;
        const payload = await response.json() as { result?: unknown };
        return typeof payload.result === 'number' ? payload.result : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function loadFailedSlotAlertStats(prisma: PrismaClient): Promise<{
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
                EXTRACT(EPOCH FROM (NOW() - MIN(first_failed_at)))::bigint AS "oldestAgeSec"
            FROM indexer_failed_slots
            WHERE resolved = FALSE
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

async function loadRuntimeSnapshot(prisma: PrismaClient): Promise<IndexerRuntimeSnapshot | null> {
    try {
        const row = await prisma.indexerRuntimeState.findFirst({
            orderBy: { updatedAt: 'desc' },
            select: {
                indexerId: true,
                listenerMode: true,
                phase: true,
                currentSlot: true,
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
    const fallbackIndexerId = process.env.INDEXER_ID || os.hostname();
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
    const runtimeSnapshot = await loadRuntimeSnapshot(prisma);
    const indexerId = runtimeSnapshot?.indexerId || fallbackIndexerId;

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
    );
    const runtimeCoverageSlot = runtimeHealthy && runtimeSnapshot && runtimeSnapshot.currentSlot !== null
        ? runtimeSnapshot.currentSlot
        : null;
    const indexedSlot = runtimeCoverageSlot !== null
        ? Math.max(checkpointIndexedSlot, runtimeCoverageSlot)
        : checkpointIndexedSlot;
    const headSlot = await loadHeadSlot(readCommitment);
    const slotLag = headSlot === null ? null : Math.max(0, headSlot - indexedSlot);
    const lagStale = slotLag === null ? false : slotLag > maxSlotLag;
    const failedSlotStats = await loadFailedSlotAlertStats(prisma);
    const pendingGhostStats = await loadPendingGhostSettingsAlertStats(prisma);
    const indexerLagWarning = slotLag !== null && slotLag > lagWarningThreshold;
    const indexerLagCritical = slotLag !== null && slotLag > lagCriticalThreshold;
    const failedSlotsWarning =
        failedSlotStats.pendingCount !== null && failedSlotStats.pendingCount >= failedSlotWarningCount;
    const failedSlotsCritical =
        failedSlotStats.oldestAgeSec !== null && failedSlotStats.oldestAgeSec >= failedSlotCriticalAgeSec;
    const pendingGhostSettingsWarning =
        pendingGhostStats.pendingCount !== null && pendingGhostStats.pendingCount >= pendingGhostWarningCount;
    const pendingGhostSettingsCritical =
        pendingGhostStats.oldestAgeSec !== null && pendingGhostStats.oldestAgeSec >= pendingGhostCriticalAgeSec;

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
            lastRemoteLamport: bigint;
            lastSuccessAt: Date | null;
            lastError: string | null;
        }>>`
            SELECT
                peer_url AS "peerUrl",
                last_remote_lamport AS "lastRemoteLamport",
                last_success_at AS "lastSuccessAt",
                last_error AS "lastError"
            FROM offchain_peer_sync_state
            ORDER BY peer_url ASC
        `;

        offchainPeers = rows.map((row) => {
            const lastSuccessAtMs = toMillis(row.lastSuccessAt);
            return {
                peerUrl: row.peerUrl,
                lastRemoteLamport: Number(row.lastRemoteLamport),
                lastSuccessAt: row.lastSuccessAt?.toISOString() || null,
                lastError: row.lastError,
                stale: lastSuccessAtMs === null ? true : now - lastSuccessAtMs > peerStaleAfterMs,
            };
        });
    } catch {
        offchainPeers = [];
    }

    const configuredPeers = parseOffchainPeerUrls();
    const peerMap = new Map(offchainPeers.map((peer) => [peer.peerUrl, peer]));
    const normalizedPeerStatuses = configuredPeers.map((peerUrl) => {
        const existing = peerMap.get(peerUrl);
        if (existing) return existing;
        return {
            peerUrl,
            lastRemoteLamport: 0,
            lastSuccessAt: null,
            lastError: null,
            stale: true,
        };
    });
    offchainPeers = normalizedPeerStatuses;

    const peerSyncStale = offchainPeers.length > 0
        ? offchainPeers.some((peer) => peer.stale || !!peer.lastError)
        : false;

    const checkpointStale = runtimeHealthy ? false : stale;

    const finalStale = checkpoints.length === 0
        ? true
        : (checkpointStale || lagStale || (offchainRequired && ((offchain?.stale ?? true) || peerSyncStale)));

    return {
        indexerId,
        readCommitment,
        indexedSlot,
        headSlot,
        slotLag,
        stale: finalStale,
        generatedAt: new Date().toISOString(),
        checkpoints,
        offchain,
        offchainPeers,
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
    };
}
