import { buildEvidenceRefFromTrendReceipt } from '../evidenceLedger';
import { buildReceiptCacheKey, sha256 } from './normalization';
import { loadTrendSources } from './sourceRegistry';
import type { TrendReceiptView, ValidatedTrendSource } from './types';

export interface CollectTrendReceiptsInput {
    query: string;
    queryDigest: string;
    now?: Date;
}

export type CollectTrendReceiptsResult =
    | {
        status: 'fresh';
        receipts: TrendReceiptView[];
        sourceDigest: string;
    }
    | {
        status: 'trend_disabled' | 'no_trend_source' | 'stale_trend_cache';
        receipts: TrendReceiptView[];
        sourceDigest: string;
    };

export async function collectTrendReceipts(
    prisma: any,
    input: CollectTrendReceiptsInput,
): Promise<CollectTrendReceiptsResult> {
    const now = input.now ?? new Date();
    const registry = await loadTrendSources(prisma);
    const sources = registry.sources;
    if (!sources.length) {
        return emptyResult('no_trend_source', input.queryDigest);
    }

    if (sources.every((source) => source.status !== 'enabled' || source.killSwitch)) {
        return emptyResult('trend_disabled', input.queryDigest);
    }

    const enabledSources = sources.filter((source) => source.status === 'enabled' && !source.killSwitch);
    const receipts: TrendReceiptView[] = [];
    let sawStale = false;

    for (const source of enabledSources) {
        const cacheKey = buildReceiptCacheKey({
            sourceKey: source.sourceKey,
            queryDigest: input.queryDigest,
        });
        const cached = await findCachedReceipt(prisma, {
            source,
            cacheKey,
            now,
        });
        if (cached?.status === 'fresh') {
            receipts.push(cached);
            continue;
        }
        if (cached?.status === 'stale') {
            sawStale = true;
        }

        const created = await createReceiptFromSnapshot(prisma, {
            source,
            cacheKey,
            query: input.query,
            now,
        });
        if (created) {
            receipts.push(created);
        }
    }

    if (receipts.length > 0) {
        return {
            status: 'fresh',
            receipts,
            sourceDigest: digestReceipts(receipts),
        };
    }
    return emptyResult(sawStale ? 'stale_trend_cache' : 'no_trend_source', input.queryDigest);
}

export function evidenceRefsFromTrendReceipts(receipts: TrendReceiptView[]) {
    return receipts.map((receipt) => buildEvidenceRefFromTrendReceipt({
        id: receipt.id,
        digest: receipt.digest,
        sourceKey: receipt.sourceKey,
        licenseNote: receipt.licenseNote,
        query: receipt.query,
        cacheKey: receipt.cacheKey,
        fetchedAt: receipt.fetchedAt,
        expiresAt: receipt.expiresAt,
    }));
}

function emptyResult(
    status: 'trend_disabled' | 'no_trend_source' | 'stale_trend_cache',
    seed: string,
): CollectTrendReceiptsResult {
    return {
        status,
        receipts: [],
        sourceDigest: sha256(`${status}:${seed}`),
    };
}

async function findCachedReceipt(
    prisma: any,
    input: {
        source: ValidatedTrendSource;
        cacheKey: string;
        now: Date;
    },
): Promise<TrendReceiptView | null> {
    if (typeof prisma?.trendReceipt?.findMany !== 'function') return null;
    const rows = await prisma.trendReceipt.findMany({
        where: {
            sourceId: input.source.id,
            cacheKey: input.cacheKey,
        },
        orderBy: {
            fetchedAt: 'desc',
        },
        take: 1,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const receipt = rowToReceipt(row, input.source);
    if (receipt.expiresAt && new Date(receipt.expiresAt).getTime() <= input.now.getTime()) {
        await markReceiptStale(prisma, receipt.id);
        return {
            ...receipt,
            status: 'stale',
        };
    }
    return receipt;
}

async function createReceiptFromSnapshot(
    prisma: any,
    input: {
        source: ValidatedTrendSource;
        cacheKey: string;
        query: string;
        now: Date;
    },
): Promise<TrendReceiptView | null> {
    const snapshot = selectSnapshot(input.source, input.query);
    if (!snapshot) return null;
    const ttlSeconds = input.source.budgetPolicy.ttlSeconds;
    const expiresAt = new Date(input.now.getTime() + ttlSeconds * 1000);
    const digest = sha256(JSON.stringify({
        sourceKey: input.source.sourceKey,
        query: input.query,
        summary: snapshot.summary,
        licenseNote: input.source.licenseNote,
    }));
    const row = {
        id: `trend_receipt_${sha256(`${input.source.id}:${input.cacheKey}`).slice(0, 24)}`,
        sourceId: input.source.id,
        sourceUrl: snapshot.sourceUrl ?? input.source.sourceUrl ?? null,
        query: input.query.slice(0, input.source.budgetPolicy.maxQueryChars),
        fetchedAt: input.now,
        expiresAt,
        summary: snapshot.summary.slice(0, 1200),
        digest,
        licenseNote: input.source.licenseNote,
        confidence: normalizeConfidence(snapshot.confidence),
        visibility: 'public',
        cacheKey: input.cacheKey,
        status: 'fresh',
        metadata: {
            connector: 'manual_snapshot',
            sourceKey: input.source.sourceKey,
        },
    };

    const persisted = typeof prisma?.trendReceipt?.upsert === 'function'
        ? await prisma.trendReceipt.upsert({
            where: {
                sourceId_cacheKey: {
                    sourceId: input.source.id,
                    cacheKey: input.cacheKey,
                },
            },
            create: row,
            update: {
                ...row,
                id: undefined,
                sourceId: undefined,
                cacheKey: undefined,
            },
        })
        : row;
    return rowToReceipt(persisted, input.source);
}

async function markReceiptStale(prisma: any, receiptId: string): Promise<void> {
    if (typeof prisma?.trendReceipt?.updateMany !== 'function') return;
    await prisma.trendReceipt.updateMany({
        where: { id: receiptId },
        data: { status: 'stale' },
    });
}

function selectSnapshot(source: ValidatedTrendSource, query: string) {
    const normalizedQuery = query.toLowerCase();
    return source.snapshots.find((snapshot) =>
        normalizedQuery.includes(snapshot.query.toLowerCase())
        || snapshot.query.toLowerCase().includes(normalizedQuery),
    ) ?? source.snapshots[0] ?? null;
}

function rowToReceipt(row: any, source: ValidatedTrendSource): TrendReceiptView {
    return {
        id: String(row.id),
        sourceId: String(row.sourceId ?? row.source_id ?? source.id),
        sourceKey: source.sourceKey,
        sourceUrl: row.sourceUrl ?? row.source_url ?? null,
        query: String(row.query || ''),
        fetchedAt: serializeDate(row.fetchedAt ?? row.fetched_at) ?? new Date().toISOString(),
        expiresAt: serializeDate(row.expiresAt ?? row.expires_at) ?? new Date().toISOString(),
        summary: String(row.summary || ''),
        digest: String(row.digest || ''),
        licenseNote: String(row.licenseNote ?? row.license_note ?? source.licenseNote),
        confidence: normalizeConfidence(row.confidence),
        visibility: 'public',
        cacheKey: String(row.cacheKey ?? row.cache_key ?? ''),
        status: row.status === 'stale' || row.status === 'blocked' || row.status === 'failed'
            ? row.status
            : 'fresh',
    };
}

function digestReceipts(receipts: TrendReceiptView[]): string {
    return sha256(JSON.stringify(receipts.map((receipt) => ({
        id: receipt.id,
        digest: receipt.digest,
        expiresAt: receipt.expiresAt,
    }))));
}

function normalizeConfidence(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0.5;
    return Math.max(0, Math.min(1, parsed));
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    return null;
}
