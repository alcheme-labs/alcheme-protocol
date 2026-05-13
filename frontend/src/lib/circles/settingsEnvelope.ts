export type CircleSettingsEnvelopeKind =
    | 'membership_policy'
    | 'policy_profile'
    | 'ghost_settings'
    | 'genesis_mode'
    | 'circle_metadata';

export interface CircleSettingsEnvelopeAuth {
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface CircleSettingsEnvelopeSigningPayload {
    v: 1;
    action: 'circle_settings_publish';
    circleId: number;
    actorPubkey: string;
    settingKind: CircleSettingsEnvelopeKind;
    payload: Record<string, unknown>;
    clientTimestamp: string;
    nonce: string;
    anchor?: Record<string, unknown>;
}

const CIRCLE_SETTINGS_SIGNING_PREFIX = 'alcheme-circle-settings:';

function normalizeBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}

function randomNonce(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function normalizeMembershipPolicyEnvelopePayload(input: {
    joinRequirement: 'Free' | 'ApprovalRequired' | 'TokenGated' | 'InviteOnly';
    circleType: 'Open' | 'Closed' | 'Secret';
    minCrystals?: number;
}): Record<string, unknown> {
    return {
        joinRequirement: input.joinRequirement,
        circleType: input.circleType,
        minCrystals: Math.max(0, Math.min(0xffff, Math.floor(Number(input.minCrystals || 0)))),
    };
}

export function normalizePolicyProfileEnvelopePayload(input: {
    draftLifecycleTemplate?: {
        reviewEntryMode: 'auto_only' | 'manual_only' | 'auto_or_manual';
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    };
    draftWorkflowPolicy?: Record<string, unknown>;
    forkPolicy?: Record<string, unknown>;
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (input.draftLifecycleTemplate) {
        payload.draftLifecycleTemplate = {
            reviewEntryMode: input.draftLifecycleTemplate.reviewEntryMode,
            draftingWindowMinutes: normalizePositiveInt(input.draftLifecycleTemplate.draftingWindowMinutes, 30),
            reviewWindowMinutes: normalizePositiveInt(input.draftLifecycleTemplate.reviewWindowMinutes, 240),
            maxRevisionRounds: normalizePositiveInt(input.draftLifecycleTemplate.maxRevisionRounds, 1),
        };
    }
    if (input.draftWorkflowPolicy) {
        payload.draftWorkflowPolicy = {
            ...input.draftWorkflowPolicy,
        };
    }
    if (input.forkPolicy) {
        payload.forkPolicy = {
            ...input.forkPolicy,
        };
    }
    return payload;
}

export function normalizeGhostSettingsEnvelopePayload(input: {
    summaryUseLLM?: boolean;
    draftTriggerMode?: 'notify_only' | 'auto_draft';
    triggerSummaryUseLLM?: boolean;
    triggerGenerateComment?: boolean;
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(input, 'summaryUseLLM')) {
        payload.summaryUseLLM = normalizeBoolean(input.summaryUseLLM, false);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'draftTriggerMode')) {
        payload.draftTriggerMode = String(input.draftTriggerMode || '').toLowerCase() === 'auto_draft'
            ? 'auto_draft'
            : 'notify_only';
    }
    if (Object.prototype.hasOwnProperty.call(input, 'triggerSummaryUseLLM')) {
        payload.triggerSummaryUseLLM = normalizeBoolean(input.triggerSummaryUseLLM, false);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'triggerGenerateComment')) {
        payload.triggerGenerateComment = normalizeBoolean(input.triggerGenerateComment, true);
    }
    return payload;
}

export function normalizeGenesisModeEnvelopePayload(input: {
    genesisMode: 'BLANK' | 'SEEDED';
}): Record<string, unknown> {
    return {
        genesisMode: String(input.genesisMode || '').trim().toUpperCase() === 'SEEDED' ? 'SEEDED' : 'BLANK',
    };
}

export function normalizeCircleMetadataEnvelopePayload(input: {
    description?: string | null;
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
        const description = String(input.description || '').trim();
        payload.description = description ? description.slice(0, 280) : null;
    }
    return payload;
}

export function buildCircleSettingsSigningPayload(input: {
    circleId: number;
    actorPubkey: string;
    settingKind: CircleSettingsEnvelopeKind;
    payload: Record<string, unknown>;
    clientTimestamp?: string;
    nonce?: string;
    anchor?: Record<string, unknown> | null;
}): CircleSettingsEnvelopeSigningPayload {
    const anchor = input.anchor && Object.keys(input.anchor).length > 0 ? input.anchor : undefined;
    return {
        v: 1,
        action: 'circle_settings_publish',
        circleId: input.circleId,
        actorPubkey: input.actorPubkey,
        settingKind: input.settingKind,
        payload: input.payload,
        clientTimestamp: input.clientTimestamp || new Date().toISOString(),
        nonce: input.nonce || randomNonce(),
        ...(anchor ? { anchor } : {}),
    };
}

export function buildCircleSettingsSigningMessage(payload: CircleSettingsEnvelopeSigningPayload): string {
    return `${CIRCLE_SETTINGS_SIGNING_PREFIX}${JSON.stringify(payload)}`;
}

export async function signCircleSettingsEnvelope(input: {
    circleId: number;
    settingKind: CircleSettingsEnvelopeKind;
    payload: Record<string, unknown>;
    auth: CircleSettingsEnvelopeAuth;
    anchor?: Record<string, unknown> | null;
}): Promise<{
    signedMessage: string;
    signature: string;
}> {
    const signingPayload = buildCircleSettingsSigningPayload({
        circleId: input.circleId,
        actorPubkey: input.auth.actorPubkey,
        settingKind: input.settingKind,
        payload: input.payload,
        anchor: input.anchor ?? null,
    });
    const signedMessage = buildCircleSettingsSigningMessage(signingPayload);
    const signature = bytesToBase64(await input.auth.signMessage(new TextEncoder().encode(signedMessage)));
    return {
        signedMessage,
        signature,
    };
}
