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

export interface CircleSettingsEnvelopeAuth {
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface CircleSettingsEnvelopeSigningPayload {
    v: 1;
    action: 'circle_settings_publish';
    circleId: number;
    actorPubkey: string;
    settingKind: CircleSettingsSigningKind;
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

export function normalizeDraftPromptEnvelopePayload(input: {
    scope: 'knowledge_draft' | 'governance_draft';
    mode: 'system_default' | 'circle_custom';
    version: number | null;
    promptDigest: string | null;
    schemaRef: string;
    systemPromptVersion: string;
    promptBody?: string;
}): Record<string, unknown> {
    const scope = String(input.scope || '').trim().toLowerCase();
    const mode = String(input.mode || '').trim().toLowerCase();
    if (scope !== 'knowledge_draft' && scope !== 'governance_draft') {
        throw new Error('invalid_circle_draft_prompt_scope');
    }
    if (mode !== 'system_default' && mode !== 'circle_custom') {
        throw new Error('invalid_circle_draft_prompt_mode');
    }
    const version = input.version === null ? null : Math.floor(Number(input.version));
    const promptDigest = input.promptDigest === null
        ? null
        : String(input.promptDigest || '').trim().toLowerCase();
    const schemaRef = String(input.schemaRef || '').trim();
    const systemPromptVersion = String(input.systemPromptVersion || '').trim();
    if (!schemaRef || !systemPromptVersion) throw new Error('invalid_circle_draft_prompt_contract');
    if (mode === 'system_default') {
        if ((version === null) !== (promptDigest === null)) {
            throw new Error('invalid_circle_draft_prompt_current_version');
        }
        return { scope, mode, version, promptDigest, schemaRef, systemPromptVersion };
    }
    if (!version || version <= 0 || !promptDigest || !/^[a-f0-9]{64}$/.test(promptDigest)) {
        throw new Error('invalid_circle_draft_prompt_version');
    }
    if (!Object.prototype.hasOwnProperty.call(input, 'promptBody')) {
        return { scope, mode, version, promptDigest, schemaRef, systemPromptVersion };
    }
    const promptBody = String(input.promptBody || '').replace(/\r\n?/g, '\n').trim();
    if (
        !promptBody
        || promptBody.length > 12000
    ) {
        throw new Error('invalid_circle_draft_prompt_body');
    }
    return { scope, mode, version, promptDigest, schemaRef, systemPromptVersion, promptBody };
}

export function normalizeCommunityProfileEnvelopePayload(input: {
    communityType: 'organization' | 'program' | 'guild' | 'region' | 'topic' | 'creator' | 'event' | 'review' | 'other';
    displayRole: 'primary_program' | 'attached_community' | 'review_governance';
}): Record<string, unknown> {
    const communityType = String(input.communityType || '').trim().toLowerCase();
    const displayRole = String(input.displayRole || '').trim().toLowerCase();
    return {
        communityType,
        displayRole,
    };
}

export function normalizeCircleGeoAnchorEnvelopePayload(input: {
    operation: 'upsert' | 'archive';
    label?: unknown;
    centerLat?: unknown;
    centerLng?: unknown;
    radiusMeters?: unknown;
    visibility?: unknown;
    anchorId?: unknown;
}): Record<string, unknown> {
    if (input.operation === 'archive') {
        const anchorId = typeof input.anchorId === 'string' ? input.anchorId.trim() : '';
        return {
            operation: 'archive',
            ...(anchorId ? { anchorId } : {}),
        };
    }
    const label = String(input.label || '').trim().replace(/\s+/g, ' ');
    const centerLat = Number(input.centerLat);
    const centerLng = Number(input.centerLng);
    const radiusMeters = Number(input.radiusMeters);
    const visibility = String(input.visibility || 'public_discovery').trim().toLowerCase();
    if (!label || !Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isInteger(radiusMeters)) {
        throw new Error('invalid_circle_geo_anchor_payload');
    }
    if (visibility !== 'public_discovery' && visibility !== 'members_only' && visibility !== 'managers_only') {
        throw new Error('invalid_circle_geo_anchor_visibility');
    }
    return {
        operation: 'upsert',
        label,
        centerLat,
        centerLng,
        radiusMeters,
        visibility,
    };
}

export function normalizePostCreateSettingsEnvelopePayload(input: {
    description?: string | null;
    ghostSettings?: {
        summaryUseLLM?: boolean;
        draftTriggerMode?: 'notify_only' | 'auto_draft';
        triggerSummaryUseLLM?: boolean;
        triggerGenerateComment?: boolean;
    };
    genesisMode?: 'BLANK' | 'SEEDED';
    joinPolicy?: {
        accessType: 'free' | 'crystal' | 'invite' | 'approval';
        minCrystals?: number;
    };
    draftLifecycleTemplate?: {
        reviewEntryMode: 'auto_only' | 'manual_only' | 'auto_or_manual';
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    };
    draftWorkflowPolicy?: Record<string, unknown>;
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
        payload.description = normalizeCircleMetadataEnvelopePayload({
            description: input.description ?? null,
        }).description ?? null;
    }
    if (input.ghostSettings) {
        const ghostSettings = normalizeGhostSettingsEnvelopePayload(input.ghostSettings);
        if (Object.keys(ghostSettings).length > 0) {
            payload.ghostSettings = ghostSettings;
        }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'genesisMode')) {
        payload.genesisMode = normalizeGenesisModeEnvelopePayload({
            genesisMode: input.genesisMode ?? 'BLANK',
        }).genesisMode;
    }
    if (input.joinPolicy) {
        payload.joinPolicy = {
            accessType: input.joinPolicy.accessType,
            ...(Object.prototype.hasOwnProperty.call(input.joinPolicy, 'minCrystals')
                ? {
                    minCrystals: Math.max(
                        0,
                        Math.min(0xffff, Math.floor(Number(input.joinPolicy.minCrystals || 0))),
                    ),
                }
                : {}),
        };
    }
    const policyProfilePayload = normalizePolicyProfileEnvelopePayload({
        ...(input.draftLifecycleTemplate
            ? { draftLifecycleTemplate: input.draftLifecycleTemplate }
            : {}),
        ...(input.draftWorkflowPolicy
            ? { draftWorkflowPolicy: input.draftWorkflowPolicy }
            : {}),
    });
    if (policyProfilePayload.draftLifecycleTemplate) {
        payload.draftLifecycleTemplate = policyProfilePayload.draftLifecycleTemplate;
    }
    if (policyProfilePayload.draftWorkflowPolicy) {
        payload.draftWorkflowPolicy = policyProfilePayload.draftWorkflowPolicy;
    }
    return payload;
}

export function buildCircleSettingsSigningPayload(input: {
    circleId: number;
    actorPubkey: string;
    settingKind: CircleSettingsSigningKind;
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
    settingKind: CircleSettingsSigningKind;
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
