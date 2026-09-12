import { createHash } from 'node:crypto';
import {
    CircleType,
    JoinRequirement,
    Prisma,
    type PrismaClient,
} from '@prisma/client';
import {
    normalizeCircleGeoAnchorSettingsPayload,
} from '../circleLocation/validation';
import type { CircleGeoAnchorSettingsPayload } from '../circleLocation/types';

export type CircleSettingsStoredSectionKind =
    | 'membership_policy'
    | 'policy_profile'
    | 'ghost_settings'
    | 'genesis_mode'
    | 'circle_metadata'
    | 'community_profile'
    | 'circle_geo_anchor';

export type CircleSettingsSigningKind =
    | CircleSettingsStoredSectionKind
    | 'post_create_settings'
    | 'draft_prompt';

export type CircleSettingsEnvelopeKind = CircleSettingsSigningKind;

export interface CircleSettingsMembershipPolicyPayload {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals?: number;
}

export interface CircleSettingsPolicyProfilePayload {
    draftLifecycleTemplate?: Record<string, unknown>;
    draftWorkflowPolicy?: Record<string, unknown>;
    forkPolicy?: Record<string, unknown>;
}

export interface CircleSettingsGhostPayload {
    summaryUseLLM?: boolean;
    draftTriggerMode?: 'notify_only' | 'auto_draft';
    triggerSummaryUseLLM?: boolean;
    triggerGenerateComment?: boolean;
}

export interface CircleSettingsGenesisPayload {
    genesisMode: 'BLANK' | 'SEEDED';
}

export interface CircleSettingsMetadataPayload {
    description?: string | null;
}

export interface CircleSettingsDraftPromptPayload {
    scope: 'knowledge_draft' | 'governance_draft';
    mode: 'system_default' | 'circle_custom';
    version: number | null;
    promptDigest: string | null;
    schemaRef: string;
    systemPromptVersion: string;
    promptBody?: string;
}

export type CircleCommunityType =
    | 'organization'
    | 'program'
    | 'guild'
    | 'region'
    | 'topic'
    | 'creator'
    | 'event'
    | 'review'
    | 'other';

export type CircleCommunityDisplayRole =
    | 'primary_program'
    | 'attached_community'
    | 'review_governance';

export interface CircleSettingsCommunityProfilePayload {
    communityType: CircleCommunityType;
    displayRole: CircleCommunityDisplayRole;
}

export type CirclePostCreateSettingsAccessType = 'free' | 'crystal' | 'invite' | 'approval';

export interface CirclePostCreateSettingsJoinPolicyPayload {
    accessType: CirclePostCreateSettingsAccessType;
    minCrystals?: number;
}

export interface CirclePostCreateSettingsPayload {
    description?: string | null;
    ghostSettings?: CircleSettingsGhostPayload;
    genesisMode?: CircleSettingsGenesisPayload['genesisMode'];
    joinPolicy?: CirclePostCreateSettingsJoinPolicyPayload;
    draftLifecycleTemplate?: NonNullable<CircleSettingsPolicyProfilePayload['draftLifecycleTemplate']>;
    draftWorkflowPolicy?: NonNullable<CircleSettingsPolicyProfilePayload['draftWorkflowPolicy']>;
}

export type CircleSettingsEnvelopePayload =
    | CircleSettingsMembershipPolicyPayload
    | CircleSettingsPolicyProfilePayload
    | CircleSettingsGhostPayload
    | CircleSettingsGenesisPayload
    | CircleSettingsMetadataPayload
    | CircleSettingsCommunityProfilePayload
    | CircleGeoAnchorSettingsPayload
    | CirclePostCreateSettingsPayload
    | CircleSettingsDraftPromptPayload;

export interface CircleSettingsEnvelopeSigningPayload {
    v: 1;
    action: 'circle_settings_publish';
    circleId: number;
    actorPubkey: string;
    settingKind: CircleSettingsSigningKind;
    payload: CircleSettingsEnvelopePayload;
    clientTimestamp: string;
    nonce: string;
    anchor?: Record<string, unknown> | null;
}

export interface StoredCircleSettingsEnvelopeSection {
    settingKind: CircleSettingsStoredSectionKind;
    payload: Record<string, unknown>;
    actorPubkey: string;
    signedMessage: string;
    signature: string;
    digest: string;
    clientTimestamp: string;
    nonce: string;
    updatedAt: string;
    anchor?: Record<string, unknown> | null;
}

export interface CircleSettingsEnvelopeSnapshot {
    v: 1;
    sections: Partial<Record<CircleSettingsStoredSectionKind, StoredCircleSettingsEnvelopeSection>>;
    postCreateBootstrap?: StoredCirclePostCreateBootstrap | null;
}

export interface StoredCirclePostCreateBootstrap {
    actorPubkey: string;
    signedMessage: string;
    signature: string;
    digest: string;
    clientTimestamp: string;
    nonce: string;
    appliedAt: string;
    anchor?: Record<string, unknown> | null;
}

export interface ProjectedCircleSettingsState {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
    source: 'signed_envelope' | 'circle_row';
}

const CIRCLE_SETTINGS_SIGNING_PREFIX = 'alcheme-circle-settings:';
let ensureSettingsEnvelopeColumnPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return null;
}

function normalizePositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return null;
}

function normalizeNonNegativeInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.max(0, Math.min(0xffff, Math.floor(value)));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.max(0, Math.min(0xffff, Math.floor(parsed)));
        }
    }
    return null;
}

function normalizeGovernanceRole(value: unknown): string | null {
    const normalized = String(value || '').trim();
    if (
        normalized === 'Owner'
        || normalized === 'Admin'
        || normalized === 'Moderator'
        || normalized === 'Member'
        || normalized === 'Elder'
        || normalized === 'Initiate'
    ) {
        return normalized;
    }
    return null;
}

function normalizeMembershipPolicyPayload(raw: unknown): CircleSettingsMembershipPolicyPayload | null {
    if (!isRecord(raw)) return null;
    const joinRequirement = String(raw.joinRequirement || '').trim();
    const circleType = String(raw.circleType || '').trim();
    if (
        !Object.values(JoinRequirement).includes(joinRequirement as JoinRequirement)
        || !Object.values(CircleType).includes(circleType as CircleType)
    ) {
        return null;
    }
    const minCrystals = normalizeNonNegativeInt(raw.minCrystals);
    return {
        joinRequirement: joinRequirement as JoinRequirement,
        circleType: circleType as CircleType,
        ...(minCrystals !== null ? { minCrystals } : {}),
    };
}

function normalizePolicyProfilePayload(raw: unknown): CircleSettingsPolicyProfilePayload | null {
    if (!isRecord(raw)) return null;
    const payload: CircleSettingsPolicyProfilePayload = {};

    if (isRecord(raw.draftLifecycleTemplate)) {
        const nextTemplate: Record<string, unknown> = {};
        const reviewEntryMode = String(raw.draftLifecycleTemplate.reviewEntryMode || '').trim().toLowerCase();
        if (
            reviewEntryMode === 'auto_only'
            || reviewEntryMode === 'manual_only'
            || reviewEntryMode === 'auto_or_manual'
        ) {
            nextTemplate.reviewEntryMode = reviewEntryMode;
        }
        const draftingWindowMinutes = normalizePositiveInt(raw.draftLifecycleTemplate.draftingWindowMinutes);
        const reviewWindowMinutes = normalizePositiveInt(raw.draftLifecycleTemplate.reviewWindowMinutes);
        const maxRevisionRounds = normalizePositiveInt(raw.draftLifecycleTemplate.maxRevisionRounds);
        if (draftingWindowMinutes) nextTemplate.draftingWindowMinutes = draftingWindowMinutes;
        if (reviewWindowMinutes) nextTemplate.reviewWindowMinutes = reviewWindowMinutes;
        if (maxRevisionRounds) nextTemplate.maxRevisionRounds = maxRevisionRounds;
        if (Object.keys(nextTemplate).length > 0) {
            payload.draftLifecycleTemplate = nextTemplate;
        }
    }

    if (isRecord(raw.draftWorkflowPolicy)) {
        const nextPolicy: Record<string, unknown> = {};
        const roleFields = [
            'createIssueMinRole',
            'followupIssueMinRole',
            'reviewIssueMinRole',
            'retagIssueMinRole',
            'applyIssueMinRole',
            'manualEndDraftingMinRole',
            'advanceFromReviewMinRole',
            'enterCrystallizationMinRole',
        ];
        for (const field of roleFields) {
            if (!Object.prototype.hasOwnProperty.call(raw.draftWorkflowPolicy, field)) continue;
            const normalized = normalizeGovernanceRole(raw.draftWorkflowPolicy[field]);
            if (normalized) {
                nextPolicy[field] = normalized;
            }
        }
        const allowAuthorWithdrawBeforeReview = normalizeBoolean(raw.draftWorkflowPolicy.allowAuthorWithdrawBeforeReview);
        const allowModeratorRetagIssue = normalizeBoolean(raw.draftWorkflowPolicy.allowModeratorRetagIssue);
        if (allowAuthorWithdrawBeforeReview !== null) {
            nextPolicy.allowAuthorWithdrawBeforeReview = allowAuthorWithdrawBeforeReview;
        }
        if (allowModeratorRetagIssue !== null) {
            nextPolicy.allowModeratorRetagIssue = allowModeratorRetagIssue;
        }
        if (Object.keys(nextPolicy).length > 0) {
            payload.draftWorkflowPolicy = nextPolicy;
        }
    }

    if (isRecord(raw.forkPolicy)) {
        payload.forkPolicy = raw.forkPolicy;
    }

    return Object.keys(payload).length > 0 ? payload : null;
}

function normalizeGhostPayload(raw: unknown): CircleSettingsGhostPayload | null {
    if (!isRecord(raw)) return null;
    const payload: CircleSettingsGhostPayload = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'summaryUseLLM')) {
        const parsed = normalizeBoolean(raw.summaryUseLLM);
        if (parsed !== null) payload.summaryUseLLM = parsed;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'draftTriggerMode')) {
        payload.draftTriggerMode = String(raw.draftTriggerMode || '').trim().toLowerCase() === 'auto_draft'
            ? 'auto_draft'
            : 'notify_only';
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'triggerSummaryUseLLM')) {
        const parsed = normalizeBoolean(raw.triggerSummaryUseLLM);
        if (parsed !== null) payload.triggerSummaryUseLLM = parsed;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'triggerGenerateComment')) {
        const parsed = normalizeBoolean(raw.triggerGenerateComment);
        if (parsed !== null) payload.triggerGenerateComment = parsed;
    }
    return Object.keys(payload).length > 0 ? payload : null;
}

function normalizeGenesisPayload(raw: unknown): CircleSettingsGenesisPayload | null {
    if (!isRecord(raw)) return null;
    const genesisMode = String(raw.genesisMode || '').trim().toUpperCase();
    if (genesisMode !== 'BLANK' && genesisMode !== 'SEEDED') return null;
    return {
        genesisMode: genesisMode as CircleSettingsGenesisPayload['genesisMode'],
    };
}

function normalizeMetadataPayload(raw: unknown): CircleSettingsMetadataPayload | null {
    if (!isRecord(raw)) return null;
    const payload: CircleSettingsMetadataPayload = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'description')) {
        const description = String(raw.description || '').trim();
        payload.description = description ? description.slice(0, 280) : null;
    }
    return Object.keys(payload).length > 0 ? payload : null;
}

function normalizeDraftPromptPayload(raw: unknown): CircleSettingsDraftPromptPayload | null {
    if (!isRecord(raw)) return null;
    const scope = String(raw.scope || '').trim().toLowerCase();
    const mode = String(raw.mode || '').trim().toLowerCase();
    if (scope !== 'knowledge_draft' && scope !== 'governance_draft') return null;
    if (mode !== 'system_default' && mode !== 'circle_custom') return null;
    const version = raw.version === null ? null : normalizePositiveInt(raw.version);
    const promptDigest = raw.promptDigest === null
        ? null
        : String(raw.promptDigest || '').trim().toLowerCase();
    const schemaRef = String(raw.schemaRef || '').trim();
    const systemPromptVersion = String(raw.systemPromptVersion || '').trim();
    if (
        !schemaRef
        || schemaRef.length > 128
        || !systemPromptVersion
        || systemPromptVersion.length > 32
    ) return null;
    if (mode === 'system_default') {
        if (Object.prototype.hasOwnProperty.call(raw, 'promptBody')) return null;
        if ((version === null) !== (promptDigest === null)) return null;
        if (promptDigest !== null && !/^[a-f0-9]{64}$/.test(promptDigest)) return null;
        return { scope, mode, version, promptDigest, schemaRef, systemPromptVersion };
    }
    if (!version || !promptDigest || !/^[a-f0-9]{64}$/.test(promptDigest)) return null;
    if (!Object.prototype.hasOwnProperty.call(raw, 'promptBody')) {
        return { scope, mode, version, promptDigest, schemaRef, systemPromptVersion };
    }
    const promptBody = typeof raw.promptBody === 'string'
        ? raw.promptBody.replace(/\r\n?/g, '\n').trim()
        : '';
    if (
        !promptBody
        || promptBody.length > 12000
        || createHash('sha256').update(promptBody).digest('hex') !== promptDigest
    ) return null;
    return { scope, mode, version, promptDigest, schemaRef, systemPromptVersion, promptBody };
}

function normalizeCommunityProfilePayload(raw: unknown): CircleSettingsCommunityProfilePayload | null {
    if (!isRecord(raw)) return null;
    const communityType = String(raw.communityType || '').trim().toLowerCase();
    const displayRole = String(raw.displayRole || '').trim().toLowerCase();
    if (
        communityType !== 'organization'
        && communityType !== 'program'
        && communityType !== 'guild'
        && communityType !== 'region'
        && communityType !== 'topic'
        && communityType !== 'creator'
        && communityType !== 'event'
        && communityType !== 'review'
        && communityType !== 'other'
    ) {
        return null;
    }
    if (
        displayRole !== 'primary_program'
        && displayRole !== 'attached_community'
        && displayRole !== 'review_governance'
    ) {
        return null;
    }
    return {
        communityType: communityType as CircleCommunityType,
        displayRole: displayRole as CircleCommunityDisplayRole,
    };
}

function normalizePostCreateJoinPolicyPayload(raw: unknown): CirclePostCreateSettingsJoinPolicyPayload | null {
    if (!isRecord(raw)) return null;
    const accessType = String(raw.accessType || '').trim().toLowerCase();
    if (
        accessType !== 'free'
        && accessType !== 'crystal'
        && accessType !== 'invite'
        && accessType !== 'approval'
    ) {
        return null;
    }
    const minCrystals = normalizeNonNegativeInt(raw.minCrystals);
    return {
        accessType: accessType as CirclePostCreateSettingsAccessType,
        ...(minCrystals !== null ? { minCrystals } : {}),
    };
}

function normalizePostCreateSettingsPayload(raw: unknown): CirclePostCreateSettingsPayload | null {
    if (!isRecord(raw)) return null;
    const payload: CirclePostCreateSettingsPayload = {};

    if (Object.prototype.hasOwnProperty.call(raw, 'description')) {
        const normalized = normalizeMetadataPayload({ description: raw.description });
        if (normalized && Object.prototype.hasOwnProperty.call(normalized, 'description')) {
            payload.description = normalized.description ?? null;
        }
    }

    if (Object.prototype.hasOwnProperty.call(raw, 'ghostSettings')) {
        const normalized = normalizeGhostPayload(raw.ghostSettings);
        if (normalized) {
            payload.ghostSettings = normalized;
        }
    }

    if (Object.prototype.hasOwnProperty.call(raw, 'genesisMode')) {
        const normalized = normalizeGenesisPayload({ genesisMode: raw.genesisMode });
        if (normalized) {
            payload.genesisMode = normalized.genesisMode;
        }
    }

    if (Object.prototype.hasOwnProperty.call(raw, 'joinPolicy')) {
        const normalized = normalizePostCreateJoinPolicyPayload(raw.joinPolicy);
        if (normalized) {
            payload.joinPolicy = normalized;
        }
    }

    const policyProfilePayload = normalizePolicyProfilePayload({
        ...(Object.prototype.hasOwnProperty.call(raw, 'draftLifecycleTemplate')
            ? { draftLifecycleTemplate: raw.draftLifecycleTemplate }
            : {}),
        ...(Object.prototype.hasOwnProperty.call(raw, 'draftWorkflowPolicy')
            ? { draftWorkflowPolicy: raw.draftWorkflowPolicy }
            : {}),
    });
    if (policyProfilePayload?.draftLifecycleTemplate) {
        payload.draftLifecycleTemplate = policyProfilePayload.draftLifecycleTemplate;
    }
    if (policyProfilePayload?.draftWorkflowPolicy) {
        payload.draftWorkflowPolicy = policyProfilePayload.draftWorkflowPolicy;
    }

    return Object.keys(payload).length > 0 ? payload : null;
}

function normalizePayloadByKind(
    settingKind: CircleSettingsSigningKind,
    payload: unknown,
): CircleSettingsEnvelopePayload | null {
    if (settingKind === 'membership_policy') return normalizeMembershipPolicyPayload(payload);
    if (settingKind === 'policy_profile') return normalizePolicyProfilePayload(payload);
    if (settingKind === 'ghost_settings') return normalizeGhostPayload(payload);
    if (settingKind === 'genesis_mode') return normalizeGenesisPayload(payload);
    if (settingKind === 'community_profile') return normalizeCommunityProfilePayload(payload);
    if (settingKind === 'circle_geo_anchor') return normalizeCircleGeoAnchorPayload(payload);
    if (settingKind === 'post_create_settings') return normalizePostCreateSettingsPayload(payload);
    if (settingKind === 'draft_prompt') return normalizeDraftPromptPayload(payload);
    return normalizeMetadataPayload(payload);
}

function normalizeCircleGeoAnchorPayload(raw: unknown): CircleGeoAnchorSettingsPayload | null {
    try {
        return normalizeCircleGeoAnchorSettingsPayload(raw);
    } catch {
        return null;
    }
}

function normalizeAnchor(anchor: unknown): Record<string, unknown> | null {
    if (!isRecord(anchor)) return null;
    const nextAnchor: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(anchor)) {
        if (
            typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
            || value === null
        ) {
            nextAnchor[key] = value;
        }
    }
    return Object.keys(nextAnchor).length > 0 ? nextAnchor : null;
}

function normalizeForDigest(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForDigest(entry));
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (isRecord(value)) {
        return Object.keys(value)
            .sort((left, right) => left.localeCompare(right))
            .reduce<Record<string, unknown>>((accumulator, key) => {
                accumulator[key] = normalizeForDigest(value[key]);
                return accumulator;
            }, {});
    }
    return value;
}

function parseSettingsEnvelopeSnapshot(raw: unknown): CircleSettingsEnvelopeSnapshot | null {
    if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.sections)) {
        return null;
    }
    const sections: CircleSettingsEnvelopeSnapshot['sections'] = {};
    for (const kind of ['membership_policy', 'policy_profile', 'ghost_settings', 'genesis_mode', 'circle_metadata', 'community_profile', 'circle_geo_anchor'] as const) {
        const section = raw.sections[kind];
        if (!isRecord(section)) continue;
        const normalizedPayload = isRecord(section.payload) ? section.payload : {};
        sections[kind] = {
            settingKind: kind,
            payload: normalizedPayload,
            actorPubkey: String(section.actorPubkey || ''),
            signedMessage: String(section.signedMessage || ''),
            signature: String(section.signature || ''),
            digest: String(section.digest || ''),
            clientTimestamp: String(section.clientTimestamp || ''),
            nonce: String(section.nonce || ''),
            updatedAt: String(section.updatedAt || ''),
            anchor: normalizeAnchor(section.anchor),
        };
    }
    const rawBootstrap = isRecord(raw.postCreateBootstrap)
        ? raw.postCreateBootstrap
        : null;
    const postCreateBootstrap = rawBootstrap
        ? {
            actorPubkey: String(rawBootstrap.actorPubkey || ''),
            signedMessage: String(rawBootstrap.signedMessage || ''),
            signature: String(rawBootstrap.signature || ''),
            digest: String(rawBootstrap.digest || ''),
            clientTimestamp: String(rawBootstrap.clientTimestamp || ''),
            nonce: String(rawBootstrap.nonce || ''),
            appliedAt: String(rawBootstrap.appliedAt || ''),
            anchor: normalizeAnchor(rawBootstrap.anchor),
        }
        : null;
    return {
        v: 1,
        sections,
        ...(postCreateBootstrap ? { postCreateBootstrap } : {}),
    };
}

function toJsonbSql(value: unknown): Prisma.Sql {
    if (value === null || value === undefined) {
        return Prisma.sql`NULL`;
    }
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function isMissingStorageError(error: unknown): boolean {
    const record = error as { code?: string; meta?: { code?: string } } | null;
    const code = record?.meta?.code ?? record?.code;
    if (code === '42P01' || code === '42703') return true;
    const message = error instanceof Error ? error.message : String(error ?? '');
    return (
        message.includes('circle_policy_profiles')
        && (
            message.includes('does not exist')
            || message.includes('settings_envelope')
            || message.includes('column')
        )
    );
}

async function ensureSettingsEnvelopeColumn(prisma: PrismaClient): Promise<void> {
    const rawExecutor = (prisma as unknown as { $executeRawUnsafe?: (...args: unknown[]) => Promise<unknown> }).$executeRawUnsafe;
    if (typeof rawExecutor !== 'function') return;
    if (!ensureSettingsEnvelopeColumnPromise) {
        ensureSettingsEnvelopeColumnPromise = rawExecutor.call(
            prisma,
            `
            ALTER TABLE circle_policy_profiles
            ADD COLUMN IF NOT EXISTS settings_envelope JSONB
            `,
        ).then(() => undefined).catch((error) => {
            ensureSettingsEnvelopeColumnPromise = null;
            if (!isMissingStorageError(error)) {
                throw error;
            }
        });
    }
    await ensureSettingsEnvelopeColumnPromise;
}

export async function ensureCircleSettingsEnvelopeStorage(prisma: PrismaClient): Promise<void> {
    await ensureSettingsEnvelopeColumn(prisma);
}

export function buildCircleSettingsSigningPayload(input: {
    circleId: number;
    actorPubkey: string;
    settingKind: CircleSettingsSigningKind;
    payload: CircleSettingsEnvelopePayload;
    clientTimestamp: string;
    nonce: string;
    anchor?: Record<string, unknown> | null;
}): CircleSettingsEnvelopeSigningPayload {
    const normalizedPayload = normalizePayloadByKind(input.settingKind, input.payload);
    if (!normalizedPayload) {
        throw new Error('invalid_circle_settings_payload');
    }
    const anchor = normalizeAnchor(input.anchor);
    return {
        v: 1,
        action: 'circle_settings_publish',
        circleId: input.circleId,
        actorPubkey: input.actorPubkey,
        settingKind: input.settingKind,
        payload: normalizedPayload,
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
        ...(anchor ? { anchor } : {}),
    };
}

export function buildCircleSettingsSigningMessage(payload: CircleSettingsEnvelopeSigningPayload): string {
    return `${CIRCLE_SETTINGS_SIGNING_PREFIX}${JSON.stringify(payload)}`;
}

export function parseCircleSettingsSignedMessage(raw: unknown): CircleSettingsEnvelopeSigningPayload | null {
    if (typeof raw !== 'string' || !raw.startsWith(CIRCLE_SETTINGS_SIGNING_PREFIX)) return null;
    try {
        const parsed = JSON.parse(raw.slice(CIRCLE_SETTINGS_SIGNING_PREFIX.length));
        if (!isRecord(parsed)) return null;
        if (parsed.v !== 1 || parsed.action !== 'circle_settings_publish') return null;
        const settingKind = String(parsed.settingKind || '').trim() as CircleSettingsSigningKind;
        if (
            settingKind !== 'membership_policy'
            && settingKind !== 'policy_profile'
            && settingKind !== 'ghost_settings'
            && settingKind !== 'genesis_mode'
            && settingKind !== 'circle_metadata'
            && settingKind !== 'community_profile'
            && settingKind !== 'circle_geo_anchor'
            && settingKind !== 'post_create_settings'
            && settingKind !== 'draft_prompt'
        ) {
            return null;
        }
        const payload = normalizePayloadByKind(settingKind, parsed.payload);
        if (!payload) return null;
        const circleId = Number(parsed.circleId);
        if (!Number.isFinite(circleId) || circleId <= 0) return null;
        const actorPubkey = String(parsed.actorPubkey || '').trim();
        const clientTimestamp = String(parsed.clientTimestamp || '').trim();
        const nonce = String(parsed.nonce || '').trim();
        if (!actorPubkey || !clientTimestamp || !nonce) return null;

        return {
            v: 1,
            action: 'circle_settings_publish',
            circleId,
            actorPubkey,
            settingKind,
            payload,
            clientTimestamp,
            nonce,
            anchor: normalizeAnchor(parsed.anchor) ?? null,
        };
    } catch {
        return null;
    }
}

export function buildStoredCircleSettingsEnvelopeSection(input: {
    settingKind: CircleSettingsStoredSectionKind;
    payload: Record<string, unknown>;
    actorPubkey: string;
    signedMessage: string;
    signature: string;
    clientTimestamp: string;
    nonce: string;
    anchor?: Record<string, unknown> | null;
}): StoredCircleSettingsEnvelopeSection {
    return {
        settingKind: input.settingKind,
        payload: normalizeForDigest(input.payload) as Record<string, unknown>,
        actorPubkey: input.actorPubkey,
        signedMessage: input.signedMessage,
        signature: input.signature,
        digest: createHash('sha256').update(input.signedMessage).digest('hex'),
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
        updatedAt: new Date().toISOString(),
        anchor: normalizeAnchor(input.anchor) ?? null,
    };
}

export async function loadCircleSettingsEnvelope(
    prisma: PrismaClient,
    circleId: number,
): Promise<CircleSettingsEnvelopeSnapshot | null> {
    const queryRaw = (prisma as unknown as { $queryRaw?: PrismaClient['$queryRaw'] }).$queryRaw;
    if (typeof queryRaw !== 'function') return null;
    try {
        const rows = await queryRaw.call(prisma, Prisma.sql`
            SELECT settings_envelope AS "settingsEnvelope"
            FROM circle_policy_profiles
            WHERE circle_id = ${circleId}
            LIMIT 1
        `) as Array<{ settingsEnvelope: unknown }>;
        return parseSettingsEnvelopeSnapshot(rows[0]?.settingsEnvelope ?? null);
    } catch (error) {
        if (isMissingStorageError(error)) {
            return null;
        }
        throw error;
    }
}

export async function persistCircleSettingsEnvelopeSection(
    prisma: PrismaClient,
    input: {
        circleId: number;
        actorUserId?: number | null;
        section: StoredCircleSettingsEnvelopeSection;
    },
): Promise<void> {
    const executeRaw = (prisma as unknown as { $executeRaw?: PrismaClient['$executeRaw'] }).$executeRaw;
    if (typeof executeRaw !== 'function') return;

    await ensureSettingsEnvelopeColumn(prisma);
    const baseEnvelope = {
        v: 1,
        sections: {},
    } satisfies CircleSettingsEnvelopeSnapshot;
    const sectionPath = Prisma.raw(`'{sections,${input.section.settingKind}}'::text[]`);

    try {
        await executeRaw.call(prisma, Prisma.sql`
            INSERT INTO circle_policy_profiles (
                circle_id,
                settings_envelope,
                updated_by,
                created_at,
                updated_at
            ) VALUES (
                ${input.circleId},
                jsonb_set(
                    ${toJsonbSql(baseEnvelope)},
                    ${sectionPath},
                    ${toJsonbSql(input.section)},
                    true
                ),
                ${input.actorUserId ?? null},
                NOW(),
                NOW()
            )
            ON CONFLICT (circle_id) DO UPDATE SET
                settings_envelope = jsonb_set(
                    CASE
                        WHEN jsonb_typeof(circle_policy_profiles.settings_envelope) = 'object'
                            AND jsonb_typeof(circle_policy_profiles.settings_envelope->'sections') = 'object'
                        THEN circle_policy_profiles.settings_envelope || '{"v":1}'::jsonb
                        ELSE ${toJsonbSql(baseEnvelope)}
                    END,
                    ${sectionPath},
                    ${toJsonbSql(input.section)},
                    true
                ),
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
        `);
    } catch (error) {
        if (isMissingStorageError(error)) {
            return;
        }
        throw error;
    }
}

export async function persistCirclePostCreateBootstrap(
    prisma: PrismaClient,
    input: {
        circleId: number;
        actorUserId?: number | null;
        audit: {
            actorPubkey: string;
            signedMessage: string;
            signature: string;
            clientTimestamp: string;
            nonce: string;
            anchor?: Record<string, unknown> | null;
        };
    },
): Promise<StoredCirclePostCreateBootstrap> {
    const executeRaw = (prisma as unknown as { $executeRaw?: PrismaClient['$executeRaw'] }).$executeRaw;
    if (typeof executeRaw !== 'function') {
        throw new Error('circle_post_create_bootstrap_storage_required');
    }
    await ensureSettingsEnvelopeColumn(prisma);
    const marker: StoredCirclePostCreateBootstrap = {
        actorPubkey: input.audit.actorPubkey,
        signedMessage: input.audit.signedMessage,
        signature: input.audit.signature,
        digest: createHash('sha256').update(input.audit.signedMessage).digest('hex'),
        clientTimestamp: input.audit.clientTimestamp,
        nonce: input.audit.nonce,
        appliedAt: new Date().toISOString(),
        anchor: normalizeAnchor(input.audit.anchor) ?? null,
    };
    const baseEnvelope = {
        v: 1,
        sections: {},
    } satisfies CircleSettingsEnvelopeSnapshot;
    await executeRaw.call(prisma, Prisma.sql`
        INSERT INTO circle_policy_profiles (
            circle_id,
            settings_envelope,
            updated_by,
            created_at,
            updated_at
        ) VALUES (
            ${input.circleId},
            jsonb_set(
                ${toJsonbSql(baseEnvelope)},
                '{postCreateBootstrap}'::text[],
                ${toJsonbSql(marker)},
                true
            ),
            ${input.actorUserId ?? null},
            NOW(),
            NOW()
        )
        ON CONFLICT (circle_id) DO UPDATE SET
            settings_envelope = jsonb_set(
                CASE
                    WHEN jsonb_typeof(circle_policy_profiles.settings_envelope) = 'object'
                        AND jsonb_typeof(circle_policy_profiles.settings_envelope->'sections') = 'object'
                    THEN circle_policy_profiles.settings_envelope || '{"v":1}'::jsonb
                    ELSE ${toJsonbSql(baseEnvelope)}
                END,
                '{postCreateBootstrap}'::text[],
                ${toJsonbSql(marker)},
                true
            ),
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
    `);
    return marker;
}

export async function resolveProjectedCircleSettings(
    prisma: PrismaClient,
    circle: {
        id: number;
        joinRequirement: JoinRequirement;
        circleType: CircleType;
        minCrystals: number;
    },
): Promise<ProjectedCircleSettingsState> {
    const snapshot = await loadCircleSettingsEnvelope(prisma, circle.id);
    const membershipSection = snapshot?.sections.membership_policy;
    const membershipPayload = normalizeMembershipPolicyPayload(membershipSection?.payload ?? null);
    if (!membershipPayload) {
        return {
            joinRequirement: circle.joinRequirement,
            circleType: circle.circleType,
            minCrystals: Math.max(0, Number(circle.minCrystals || 0)),
            source: 'circle_row',
        };
    }
    return {
        joinRequirement: membershipPayload.joinRequirement,
        circleType: membershipPayload.circleType,
        minCrystals: Math.max(0, Number(circle.minCrystals || 0)),
        source: 'signed_envelope',
    };
}

export async function resolveCircleSettingsActorUserId(
    prisma: PrismaClient,
    circleId: number,
    actorPubkey: string,
): Promise<number | null> {
    const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: {
            creatorId: true,
            creator: {
                select: {
                    pubkey: true,
                },
            },
        },
    });
    if (!circle) return null;
    if (circle.creator?.pubkey === actorPubkey) {
        return circle.creatorId;
    }
    const actor = await prisma.user.findUnique({
        where: { pubkey: actorPubkey },
        select: { id: true },
    });
    return actor?.id ?? null;
}

export function isCircleSettingsSignatureFresh(input: {
    clientTimestamp: string;
    windowMs?: number;
}): boolean {
    const parsed = new Date(input.clientTimestamp).getTime();
    if (!Number.isFinite(parsed)) return false;
    const windowMs = Math.max(60_000, Number(input.windowMs ?? 300_000));
    return Math.abs(Date.now() - parsed) <= windowMs;
}
