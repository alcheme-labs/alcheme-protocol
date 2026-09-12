import crypto from 'crypto';

import type { TrendLocale, TrendPromptInput } from './types';

const SUPPORTED_LOCALES = new Set<TrendLocale>(['en', 'zh', 'fr', 'es']);
const PRIVATE_PATTERNS = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /https?:\/\/|www\./i,
    /\b(?:\+?\d[\d\s().-]{7,}\d)\b/,
    /\b0x[a-f0-9]{32,}\b/i,
    /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
];

export function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeLocale(value: unknown): TrendLocale {
    const normalized = String(value || '').trim().toLowerCase().split(/[-_]/)[0] as TrendLocale;
    return SUPPORTED_LOCALES.has(normalized) ? normalized : 'en';
}

export function normalizeCommunityType(value: unknown): string | null {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return normalized ? normalized.slice(0, 40) : null;
}

export function normalizeMode(value: unknown): 'social' | 'knowledge' | null {
    return value === 'knowledge' || value === 'social' ? value : null;
}

export function normalizePlaceSeed(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

export function sanitizePublicIntent(input: TrendPromptInput): {
    ok: true;
    intent: string;
    displayQuery: string;
    digest: string;
} | {
    ok: false;
    reason: 'empty' | 'private_plaintext_risk' | 'too_long';
    displayQuery: string;
    digest: string;
} {
    const placeSeed = normalizePlaceSeed(input.placeSeed);
    const communityType = normalizeCommunityType(input.communityType) ?? 'community';
    const mode = normalizeMode(input.mode) ?? 'social';
    const locale = normalizeLocale(input.locale);
    const displayQuery = [placeSeed, communityType, mode, locale].filter(Boolean).join(' | ');
    const redactedDisplayQuery = ['redacted_place_seed', communityType, mode, locale].join(' | ');
    const digest = sha256(displayQuery);

    if (!placeSeed) {
        return { ok: false, reason: 'empty', displayQuery, digest };
    }
    if (String(input.placeSeed || '').length > 240 || /\n{2,}/.test(String(input.placeSeed || ''))) {
        return { ok: false, reason: 'too_long', displayQuery: redactedDisplayQuery, digest };
    }
    if (PRIVATE_PATTERNS.some((pattern) => pattern.test(String(input.placeSeed || '')))) {
        return { ok: false, reason: 'private_plaintext_risk', displayQuery: redactedDisplayQuery, digest };
    }

    return {
        ok: true,
        intent: `${placeSeed} (${communityType}, ${mode}, ${locale})`,
        displayQuery,
        digest,
    };
}

export function buildPromptCacheKey(input: {
    requestedByUserId: number;
    sanitizedIntentDigest: string;
    locale: string;
    communityType: string | null;
    mode: string | null;
    sourceDigest: string;
}): string {
    return [
        'place_prompt',
        `user_${input.requestedByUserId}`,
        input.sanitizedIntentDigest.slice(0, 24),
        sha256(`${input.locale}:${input.communityType ?? ''}:${input.mode ?? ''}:${input.sourceDigest}`).slice(0, 24),
    ].join(':');
}

export function buildReceiptCacheKey(input: {
    sourceKey: string;
    queryDigest: string;
}): string {
    return `trend_receipt:${input.sourceKey}:${input.queryDigest.slice(0, 32)}`;
}

export function buildTrendPromptId(input: {
    requestedByUserId: number;
    cacheKey: string;
}): string {
    return `trend_prompt_${sha256(`${input.requestedByUserId}:${input.cacheKey}`).slice(0, 24)}`;
}
