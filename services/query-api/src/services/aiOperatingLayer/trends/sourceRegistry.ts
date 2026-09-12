import { readConfiguredTrendSources } from './config';
import { sha256 } from './normalization';
import type { TrendSourceBudgetPolicy, TrendSourceConfig, TrendSourceSnapshot, ValidatedTrendSource } from './types';

const DEFAULT_BUDGET_POLICY: TrendSourceBudgetPolicy = {
    ttlSeconds: 60 * 60,
    minFetchIntervalSeconds: 60,
    maxQueryChars: 160,
    maxReceiptsPerFetch: 3,
};

export type TrendSourceValidationError =
    | 'invalid_source_type'
    | 'missing_source_key'
    | 'missing_owner'
    | 'missing_license'
    | 'invalid_secret_scope'
    | 'invalid_privacy_profile'
    | 'invalid_logging_boundary'
    | 'invalid_visibility'
    | 'invalid_allowed_hosts';

export function validateTrendSourceConfig(
    value: unknown,
    bootstrapSource: 'env' | 'file' | 'database' = 'database',
): {
    ok: true;
    source: ValidatedTrendSource;
} | {
    ok: false;
    error: TrendSourceValidationError;
} {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const sourceKey = String(record.sourceKey ?? record.source_key ?? '').trim();
    if (!sourceKey) return { ok: false, error: 'missing_source_key' };
    if (String(record.sourceType ?? record.source_type ?? 'manual_snapshot') !== 'manual_snapshot') {
        return { ok: false, error: 'invalid_source_type' };
    }
    const owner = String(record.owner || '').trim();
    if (!owner) return { ok: false, error: 'missing_owner' };
    const licenseNote = String(record.licenseNote ?? record.license_note ?? '').trim();
    if (!licenseNote) return { ok: false, error: 'missing_license' };
    if (String(record.secretScope ?? record.secret_scope ?? 'none') !== 'none') {
        return { ok: false, error: 'invalid_secret_scope' };
    }
    if (String(record.privacyProfile ?? record.privacy_profile ?? 'public_aggregate') !== 'public_aggregate') {
        return { ok: false, error: 'invalid_privacy_profile' };
    }
    if (String(record.loggingBoundary ?? record.logging_boundary ?? 'summary_digest_only') !== 'summary_digest_only') {
        return { ok: false, error: 'invalid_logging_boundary' };
    }
    if (String(record.visibility ?? 'public') !== 'public') {
        return { ok: false, error: 'invalid_visibility' };
    }

    const rawAllowedHosts = record.allowedHosts ?? record.allowed_hosts;
    const allowedHosts = Array.isArray(rawAllowedHosts)
        ? rawAllowedHosts
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean)
        : [];
    if (!allowedHosts.every((host) => /^[a-z0-9.-]{1,253}$/.test(host) && !isPrivateHost(host))) {
        return { ok: false, error: 'invalid_allowed_hosts' };
    }

    const budgetPolicy = normalizeBudgetPolicy(record.budgetPolicy ?? record.budget_policy);
    const rawSnapshots = record.snapshots ?? (record.sourceConfig as any)?.snapshots;
    if (hasInvalidSourceUrl(record.sourceUrl ?? record.source_url) || hasInvalidSnapshotSourceUrl(rawSnapshots)) {
        return { ok: false, error: 'invalid_allowed_hosts' };
    }
    const snapshots = normalizeSnapshots(rawSnapshots);
    const sourceUrl = normalizeSourceUrl(record.sourceUrl ?? record.source_url);
    if (!sourceUrlsMatchAllowedHosts(sourceUrl, snapshots, allowedHosts)) {
        return { ok: false, error: 'invalid_allowed_hosts' };
    }
    const displayName = String(record.displayName ?? record.display_name ?? sourceKey).trim();
    const status = normalizeStatus(record.status);
    const source: ValidatedTrendSource = {
        id: String(record.id || `trend_source_${sha256(sourceKey).slice(0, 24)}`),
        sourceKey,
        displayName,
        sourceType: String(record.sourceType ?? record.source_type ?? 'manual_snapshot') as 'manual_snapshot',
        owner,
        sourceUrl,
        allowedHosts,
        secretScope: 'none',
        privacyProfile: 'public_aggregate',
        loggingBoundary: 'summary_digest_only',
        budgetPolicy,
        licenseNote,
        visibility: 'public',
        status,
        killSwitch: Boolean(record.killSwitch ?? record.kill_switch ?? false),
        bootstrapSource,
        snapshots,
    };
    return { ok: true, source };
}

export async function loadTrendSources(prisma: any): Promise<{
    sources: ValidatedTrendSource[];
    errors: TrendSourceValidationError[];
}> {
    const configured = readConfiguredTrendSources();
    const configSources = configured
        .map((item) => validateTrendSourceConfig(item, 'env'))
        .filter((result): result is { ok: true; source: ValidatedTrendSource } => result.ok)
        .map((result) => result.source);
    const configErrors = configured
        .map((item) => validateTrendSourceConfig(item, 'env'))
        .filter((result): result is { ok: false; error: TrendSourceValidationError } => !result.ok)
        .map((result) => result.error);

    for (const source of configSources) {
        await upsertTrendSource(prisma, source);
    }

    const rows = typeof prisma?.trendSource?.findMany === 'function'
        ? await prisma.trendSource.findMany({
            where: {
                status: { in: ['enabled', 'disabled', 'blocked'] },
            },
        })
        : [];
    const dbResults = (Array.isArray(rows) ? rows : [])
        .map((row) => validateTrendSourceConfig(rowToConfig(row), 'database'));
    return {
        sources: [
            ...configSources,
            ...dbResults
                .filter((result): result is { ok: true; source: ValidatedTrendSource } => result.ok)
                .map((result) => result.source),
        ].filter(uniqueBySourceKey()),
        errors: [
            ...configErrors,
            ...dbResults
                .filter((result): result is { ok: false; error: TrendSourceValidationError } => !result.ok)
                .map((result) => result.error),
        ],
    };
}

export async function upsertTrendSource(prisma: any, source: ValidatedTrendSource) {
    if (typeof prisma?.trendSource?.upsert !== 'function') return source;
    return prisma.trendSource.upsert({
        where: { sourceKey: source.sourceKey },
        create: sourceToData(source),
        update: sourceToData(source),
    });
}

function sourceToData(source: ValidatedTrendSource): Record<string, unknown> {
    return {
        id: source.id,
        sourceKey: source.sourceKey,
        displayName: source.displayName,
        sourceType: source.sourceType,
        owner: source.owner,
        sourceUrl: source.sourceUrl ?? null,
        allowedHosts: source.allowedHosts,
        secretScope: source.secretScope,
        privacyProfile: source.privacyProfile,
        loggingBoundary: source.loggingBoundary,
        budgetPolicy: source.budgetPolicy,
        sourceConfig: {
            snapshots: source.snapshots,
        },
        licenseNote: source.licenseNote,
        visibility: 'public',
        status: source.status,
        killSwitch: source.killSwitch,
        bootstrapSource: source.bootstrapSource,
    };
}

function rowToConfig(row: any): TrendSourceConfig {
    const sourceConfig = row.sourceConfig ?? row.source_config ?? {};
    return {
        id: String(row.id),
        sourceKey: String(row.sourceKey ?? row.source_key ?? ''),
        displayName: String(row.displayName ?? row.display_name ?? ''),
        sourceType: 'manual_snapshot',
        owner: String(row.owner || ''),
        sourceUrl: row.sourceUrl ?? row.source_url ?? null,
        allowedHosts: Array.isArray(row.allowedHosts ?? row.allowed_hosts)
            ? row.allowedHosts ?? row.allowed_hosts
            : [],
        secretScope: String(row.secretScope ?? row.secret_scope ?? 'none') as 'none',
        privacyProfile: String(row.privacyProfile ?? row.privacy_profile ?? 'public_aggregate') as 'public_aggregate',
        loggingBoundary: String(row.loggingBoundary ?? row.logging_boundary ?? 'summary_digest_only') as 'summary_digest_only',
        budgetPolicy: normalizeBudgetPolicy(row.budgetPolicy ?? row.budget_policy),
        licenseNote: String(row.licenseNote ?? row.license_note ?? ''),
        visibility: 'public',
        status: normalizeStatus(row.status),
        killSwitch: Boolean(row.killSwitch ?? row.kill_switch ?? false),
        bootstrapSource: 'database',
        snapshots: normalizeSnapshots(sourceConfig.snapshots),
    };
}

function normalizeBudgetPolicy(value: unknown): TrendSourceBudgetPolicy {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        ttlSeconds: positiveInt(record.ttlSeconds, DEFAULT_BUDGET_POLICY.ttlSeconds),
        minFetchIntervalSeconds: positiveInt(record.minFetchIntervalSeconds, DEFAULT_BUDGET_POLICY.minFetchIntervalSeconds),
        maxQueryChars: positiveInt(record.maxQueryChars, DEFAULT_BUDGET_POLICY.maxQueryChars),
        maxReceiptsPerFetch: positiveInt(record.maxReceiptsPerFetch, DEFAULT_BUDGET_POLICY.maxReceiptsPerFetch),
    };
}

function normalizeSnapshots(value: unknown): TrendSourceSnapshot[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
            query: String(item.query || '').trim(),
            summary: String(item.summary || '').trim(),
            confidence: clamp(Number(item.confidence ?? 0.5), 0, 1),
            sourceUrl: normalizeSourceUrl(item.sourceUrl),
            capturedAt: typeof item.capturedAt === 'string' ? item.capturedAt : null,
        }))
        .filter((item) => item.query && item.summary);
}

function normalizeSourceUrl(value: unknown): string | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function hasInvalidSourceUrl(value: unknown): boolean {
    const raw = String(value || '').trim();
    return Boolean(raw) && !normalizeSourceUrl(raw);
}

function hasInvalidSnapshotSourceUrl(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.some((item) => {
        const record = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {};
        return hasInvalidSourceUrl(record.sourceUrl);
    });
}

function sourceUrlsMatchAllowedHosts(
    sourceUrl: string | null,
    snapshots: TrendSourceSnapshot[],
    allowedHosts: string[],
): boolean {
    const urls = [
        sourceUrl,
        ...snapshots.map((snapshot) => snapshot.sourceUrl ?? null),
    ].filter((url): url is string => Boolean(url));
    if (!urls.length) return true;
    if (!allowedHosts.length) return false;
    return urls.every((url) => {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return allowedHosts.includes(host);
        } catch {
            return false;
        }
    });
}

function normalizeStatus(value: unknown): 'enabled' | 'disabled' | 'blocked' {
    return value === 'disabled' || value === 'blocked' ? value : 'enabled';
}

function positiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function isPrivateHost(host: string): boolean {
    return host === 'localhost'
        || host.endsWith('.local')
        || /^127\./.test(host)
        || /^10\./.test(host)
        || /^192\.168\./.test(host)
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function uniqueBySourceKey() {
    const seen = new Set<string>();
    return (source: ValidatedTrendSource) => {
        if (seen.has(source.sourceKey)) return false;
        seen.add(source.sourceKey);
        return true;
    };
}
