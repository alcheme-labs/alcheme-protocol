import type {
    ConfigurationCopilotEntrypoint,
    ConfigurationFieldChange,
    ConfigurationProposalDiff,
    ConfigurationRiskLevel,
} from './types';

export const CONFIGURATION_FIELD_POLICY_VERSION = 'v1';

type FieldValueType = 'string' | 'int' | 'boolean' | 'enum';

interface FieldPolicy {
    field: string;
    section: string;
    entrypoints: ConfigurationCopilotEntrypoint[];
    createRequiredPermission?: string;
    settingsRequiredPermission?: string;
    forkRequiredPermission?: string;
    createRisk?: ConfigurationRiskLevel;
    settingsRisk?: ConfigurationRiskLevel;
    forkRisk?: ConfigurationRiskLevel;
    valueType: FieldValueType;
    enumValues?: string[];
    enumValuesByEntrypoint?: Partial<Record<ConfigurationCopilotEntrypoint, string[]>>;
    min?: number;
    max?: number;
    maxLength?: number;
}

const COMMUNITY_TYPES = ['organization', 'program', 'guild', 'region', 'topic', 'creator', 'event', 'review', 'other'];
const ROLES = ['Initiate', 'Member', 'Elder', 'Moderator', 'Admin', 'Owner'];

const CREATE_LOCAL = 'create_circle_form_local_confirm';
const CREATE_SUBMIT = 'create_circle_form_local_confirm_then_create_submit';
const CREATE_POST_CREATE = 'create_circle_form_local_confirm_then_post_create_settings_signature';
const CREATE_GENESIS = 'create_circle_form_local_confirm_then_create_or_post_create_settings_signature';
const FORK_LOCAL = 'fork_create_form_local_confirm';
const FORK_SUBMIT = 'fork_create_form_local_confirm_then_create_submit';
const FORK_POST_CREATE = 'fork_create_form_local_confirm_then_post_create_settings_signature';
const MEMBERSHIP_POLICY = 'circle_manager_membership_policy_signature_governance_if_required';
const GHOST_SETTINGS = 'circle_manager_ghost_settings_signature_governance_if_required';
const POLICY_PROFILE = 'circle_manager_policy_profile_signature_governance_if_required';

export const CONFIGURATION_FIELD_POLICIES: FieldPolicy[] = [
    stringField('name', 'basic', ['create_circle', 'fork_create'], CREATE_LOCAL, undefined, 'low', undefined, 80, FORK_LOCAL, 'low'),
    stringField('description', 'basic', ['create_circle', 'fork_create'], CREATE_LOCAL, undefined, 'low', undefined, 1200, FORK_LOCAL, 'low'),
    enumField('communityType', 'basic', ['create_circle'], COMMUNITY_TYPES, CREATE_LOCAL, undefined, 'low'),
    enumField('mode', 'basic', ['create_circle'], ['social', 'knowledge'], CREATE_LOCAL, undefined, 'low'),
    enumField('genesisMode', 'source', ['create_circle'], ['BLANK', 'SEEDED'], CREATE_GENESIS, undefined, 'high'),
    enumField('accessType', 'access', ['create_circle', 'circle_settings', 'fork_create'], ['free', 'crystal', 'invite'], CREATE_SUBMIT, MEMBERSHIP_POLICY, 'high', 'high', FORK_SUBMIT, 'high', {
        fork_create: ['free', 'crystal', 'invite', 'approval'],
    }),
    intField('minCrystals', 'access', ['create_circle', 'circle_settings', 'fork_create'], 0, 1_000_000, CREATE_SUBMIT, MEMBERSHIP_POLICY, 'high', 'high', FORK_SUBMIT, 'high'),
    booleanField('ghostSettings.summaryUseLLM', 'ghost', ['create_circle', 'circle_settings'], CREATE_POST_CREATE, GHOST_SETTINGS, 'medium', 'medium'),
    enumField('ghostSettings.draftTriggerMode', 'ghost', ['create_circle', 'circle_settings'], ['notify_only', 'auto_draft'], CREATE_POST_CREATE, GHOST_SETTINGS, 'medium', 'medium'),
    booleanField('ghostSettings.triggerSummaryUseLLM', 'ghost', ['create_circle', 'circle_settings'], CREATE_POST_CREATE, GHOST_SETTINGS, 'medium', 'medium'),
    enumField('draftLifecycleTemplate.reviewEntryMode', 'draftLifecycle', ['create_circle', 'circle_settings', 'fork_create'], ['auto_only', 'manual_only', 'auto_or_manual'], CREATE_POST_CREATE, POLICY_PROFILE, 'medium', 'medium', FORK_POST_CREATE, 'medium'),
    intField('draftLifecycleTemplate.draftingWindowMinutes', 'draftLifecycle', ['create_circle', 'circle_settings', 'fork_create'], 5, 30 * 24 * 60, CREATE_POST_CREATE, POLICY_PROFILE, 'medium', 'medium', FORK_POST_CREATE, 'medium'),
    intField('draftLifecycleTemplate.reviewWindowMinutes', 'draftLifecycle', ['create_circle', 'circle_settings', 'fork_create'], 5, 30 * 24 * 60, CREATE_POST_CREATE, POLICY_PROFILE, 'medium', 'medium', FORK_POST_CREATE, 'medium'),
    intField('draftLifecycleTemplate.maxRevisionRounds', 'draftLifecycle', ['create_circle', 'circle_settings', 'fork_create'], 1, 20, CREATE_POST_CREATE, POLICY_PROFILE, 'medium', 'medium', FORK_POST_CREATE, 'medium'),
    enumField('draftWorkflowPolicy.createIssueMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.followupIssueMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.reviewIssueMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.retagIssueMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.applyIssueMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.manualEndDraftingMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.advanceFromReviewMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    enumField('draftWorkflowPolicy.enterCrystallizationMinRole', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], ROLES, CREATE_POST_CREATE, POLICY_PROFILE, 'high', 'high', FORK_POST_CREATE, 'high'),
    booleanField('draftWorkflowPolicy.allowAuthorWithdrawBeforeReview', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], CREATE_POST_CREATE, POLICY_PROFILE, 'medium', 'medium', FORK_POST_CREATE, 'medium'),
    booleanField('draftWorkflowPolicy.allowModeratorRetagIssue', 'draftWorkflow', ['create_circle', 'circle_settings', 'fork_create'], CREATE_POST_CREATE, POLICY_PROFILE, 'medium', 'medium', FORK_POST_CREATE, 'medium'),
];

const POLICY_BY_FIELD = new Map(CONFIGURATION_FIELD_POLICIES.map((policy) => [policy.field, policy]));

export function listAllowedConfigurationFields(entrypoint: ConfigurationCopilotEntrypoint): string[] {
    return CONFIGURATION_FIELD_POLICIES
        .filter((policy) => policy.entrypoints.includes(entrypoint))
        .map((policy) => policy.field);
}

export function getConfigurationFieldPolicy(
    entrypoint: ConfigurationCopilotEntrypoint,
    field: string,
): (FieldPolicy & { requiredPermission: string; riskLevel: ConfigurationRiskLevel }) | null {
    const policy = POLICY_BY_FIELD.get(field) ?? null;
    if (!policy || !policy.entrypoints.includes(entrypoint)) return null;
    const requiredPermission = entrypoint === 'create_circle'
        ? policy.createRequiredPermission
        : entrypoint === 'fork_create'
            ? policy.forkRequiredPermission
            : policy.settingsRequiredPermission;
    const riskLevel = entrypoint === 'create_circle'
        ? policy.createRisk
        : entrypoint === 'fork_create'
            ? policy.forkRisk
            : policy.settingsRisk;
    if (!requiredPermission || !riskLevel) return null;
    return {
        ...policy,
        requiredPermission,
        riskLevel,
    };
}

export function normalizeConfigurationSnapshot(
    entrypoint: ConfigurationCopilotEntrypoint,
    snapshot: unknown,
): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return output;
    }
    for (const field of listAllowedConfigurationFields(entrypoint)) {
        const current = getByPath(snapshot as Record<string, unknown>, field);
        if (current === undefined) continue;
        const normalized = normalizeConfigurationFieldValue(entrypoint, field, current);
        if (normalized.ok) setByPath(output, field, normalized.value);
    }
    return output;
}

export function normalizeConfigurationProposal(input: {
    entrypoint: ConfigurationCopilotEntrypoint;
    currentSnapshot: Record<string, unknown>;
    modelOutput: unknown;
    maxChanges: number;
    targetFields?: string[];
}): ConfigurationProposalDiff {
    const record = isRecord(input.modelOutput) ? input.modelOutput : {};
    const rawDiff = Array.isArray(record.configDiff) ? record.configDiff : [];
    const configDiff: ConfigurationFieldChange[] = [];
    const validationErrors: ConfigurationProposalDiff['validationErrors'] = [];
    const seen = new Set<string>();

    for (const rawChange of rawDiff.slice(0, Math.max(1, input.maxChanges))) {
        if (!isRecord(rawChange)) {
            validationErrors.push({
                field: null,
                reasonCode: 'invalid_change_shape',
                message: 'configuration change is not an object',
            });
            continue;
        }
        const field = typeof rawChange.field === 'string' ? rawChange.field.trim() : '';
        if (!field || seen.has(field)) continue;
        if (input.targetFields?.length && !input.targetFields.includes(field)) {
            validationErrors.push({
                field,
                reasonCode: 'field_outside_target',
                message: 'field is outside the requested target fields',
            });
            continue;
        }
        const policy = getConfigurationFieldPolicy(input.entrypoint, field);
        if (!policy) {
            validationErrors.push({
                field: field || null,
                reasonCode: 'field_not_allowed',
                message: 'field is not allowed for this configuration entrypoint',
            });
            continue;
        }
        const normalized = normalizeConfigurationFieldValue(input.entrypoint, field, rawChange.proposedValue);
        if (!normalized.ok) {
            validationErrors.push({
                field,
                reasonCode: normalized.reasonCode,
                message: normalized.message,
            });
            continue;
        }
        seen.add(field);
        const conflicts = Array.isArray(rawChange.conflicts)
            ? rawChange.conflicts.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
            : [];
        configDiff.push({
            field,
            previousValue: getByPath(input.currentSnapshot, field) ?? null,
            proposedValue: normalized.value,
            reason: normalizeReason(rawChange.reason),
            riskLevel: policy.riskLevel,
            requiredPermission: policy.requiredPermission,
            section: policy.section,
            conflicts,
        });
    }

    return {
        reason: normalizeReason(record.reason),
        riskLevel: maxRisk(configDiff.map((change) => change.riskLevel)),
        affectedFields: configDiff.map((change) => change.field),
        configDiff,
        validationErrors,
    };
}

export function validateConfigurationTargetFields(
    entrypoint: ConfigurationCopilotEntrypoint,
    value: unknown,
): { ok: true; targetFields: string[] } | { ok: false; errors: string[] } {
    if (value === undefined || value === null) return { ok: true, targetFields: [] };
    if (!Array.isArray(value)) return { ok: false, errors: ['target_fields_must_be_array'] };
    const errors: string[] = [];
    const targetFields: string[] = [];
    for (const item of value) {
        const field = String(item || '').trim();
        if (!field || targetFields.includes(field)) continue;
        if (!getConfigurationFieldPolicy(entrypoint, field)) {
            errors.push(field || 'empty');
            continue;
        }
        targetFields.push(field);
    }
    return errors.length > 0
        ? { ok: false, errors }
        : { ok: true, targetFields };
}

export function buildFallbackConfigurationProposal(reasonCode: string): ConfigurationProposalDiff {
    return {
        reason: `Configuration Copilot could not generate a proposal: ${reasonCode}`,
        riskLevel: 'low',
        affectedFields: [],
        configDiff: [],
        validationErrors: [{
            field: null,
            reasonCode,
            message: 'No configuration fields were proposed.',
        }],
    };
}

function normalizeConfigurationFieldValue(
    entrypoint: ConfigurationCopilotEntrypoint,
    field: string,
    value: unknown,
): { ok: true; value: unknown } | { ok: false; reasonCode: string; message: string } {
    const policy = getConfigurationFieldPolicy(entrypoint, field);
    if (!policy) {
        return {
            ok: false,
            reasonCode: 'field_not_allowed',
            message: 'field is not allowed for this configuration entrypoint',
        };
    }
    if (policy.valueType === 'boolean') {
        if (typeof value !== 'boolean') {
            return invalid('invalid_boolean', 'value must be boolean');
        }
        return { ok: true, value };
    }
    if (policy.valueType === 'int') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
            return invalid('invalid_integer', 'value must be an integer');
        }
        if ((policy.min !== undefined && parsed < policy.min) || (policy.max !== undefined && parsed > policy.max)) {
            return invalid('integer_out_of_range', 'value is outside the supported range');
        }
        return { ok: true, value: parsed };
    }
    if (policy.valueType === 'enum') {
        const normalized = String(value || '').trim();
        if (!getEnumValuesForEntrypoint(policy, entrypoint).includes(normalized)) {
            return invalid('invalid_enum_value', 'value is not supported for this field');
        }
        return { ok: true, value: normalized };
    }
    const text = String(value ?? '').trim();
    if (!text && field === 'name') {
        return invalid('invalid_string', 'name cannot be empty');
    }
    if (policy.maxLength && text.length > policy.maxLength) {
        return invalid('string_too_long', 'value exceeds the supported length');
    }
    return { ok: true, value: text };
}

function stringField(
    field: string,
    section: string,
    entrypoints: ConfigurationCopilotEntrypoint[],
    createRequiredPermission?: string,
    settingsRequiredPermission?: string,
    createRisk?: ConfigurationRiskLevel,
    settingsRisk?: ConfigurationRiskLevel,
    maxLength = 400,
    forkRequiredPermission?: string,
    forkRisk?: ConfigurationRiskLevel,
): FieldPolicy {
    return {
        field,
        section,
        entrypoints,
        createRequiredPermission,
        settingsRequiredPermission,
        createRisk,
        settingsRisk,
        forkRequiredPermission,
        forkRisk,
        valueType: 'string',
        maxLength,
    };
}

function intField(
    field: string,
    section: string,
    entrypoints: ConfigurationCopilotEntrypoint[],
    min: number,
    max: number,
    createRequiredPermission?: string,
    settingsRequiredPermission?: string,
    createRisk?: ConfigurationRiskLevel,
    settingsRisk?: ConfigurationRiskLevel,
    forkRequiredPermission?: string,
    forkRisk?: ConfigurationRiskLevel,
): FieldPolicy {
    return {
        field,
        section,
        entrypoints,
        createRequiredPermission,
        settingsRequiredPermission,
        createRisk,
        settingsRisk,
        forkRequiredPermission,
        forkRisk,
        valueType: 'int',
        min,
        max,
    };
}

function enumField(
    field: string,
    section: string,
    entrypoints: ConfigurationCopilotEntrypoint[],
    enumValues: string[],
    createRequiredPermission?: string,
    settingsRequiredPermission?: string,
    createRisk?: ConfigurationRiskLevel,
    settingsRisk?: ConfigurationRiskLevel,
    forkRequiredPermission?: string,
    forkRisk?: ConfigurationRiskLevel,
    enumValuesByEntrypoint?: Partial<Record<ConfigurationCopilotEntrypoint, string[]>>,
): FieldPolicy {
    return {
        field,
        section,
        entrypoints,
        createRequiredPermission,
        settingsRequiredPermission,
        createRisk,
        settingsRisk,
        forkRequiredPermission,
        forkRisk,
        valueType: 'enum',
        enumValues,
        enumValuesByEntrypoint,
    };
}

function booleanField(
    field: string,
    section: string,
    entrypoints: ConfigurationCopilotEntrypoint[],
    createRequiredPermission?: string,
    settingsRequiredPermission?: string,
    createRisk?: ConfigurationRiskLevel,
    settingsRisk?: ConfigurationRiskLevel,
    forkRequiredPermission?: string,
    forkRisk?: ConfigurationRiskLevel,
): FieldPolicy {
    return {
        field,
        section,
        entrypoints,
        createRequiredPermission,
        settingsRequiredPermission,
        createRisk,
        settingsRisk,
        forkRequiredPermission,
        forkRisk,
        valueType: 'boolean',
    };
}

function invalid(reasonCode: string, message: string) {
    return {
        ok: false as const,
        reasonCode,
        message,
    };
}

function getEnumValuesForEntrypoint(
    policy: FieldPolicy,
    entrypoint: ConfigurationCopilotEntrypoint,
): string[] {
    return policy.enumValuesByEntrypoint?.[entrypoint] ?? policy.enumValues ?? [];
}

function maxRisk(risks: ConfigurationRiskLevel[]): ConfigurationRiskLevel {
    if (risks.includes('high')) return 'high';
    if (risks.includes('medium')) return 'medium';
    return 'low';
}

function normalizeReason(value: unknown): string {
    const text = String(value ?? '').trim();
    return text.slice(0, 600);
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[key];
    }, source);
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = target;
    parts.forEach((part, index) => {
        if (index === parts.length - 1) {
            current[part] = value;
            return;
        }
        if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
