import type {
    StyleAccessibilityCheck,
    StyleAdvisorProposal,
    StyleAdvisorScope,
    StyleLifeFeelInputs,
    StyleRiskLevel,
    StyleTokenChange,
    StyleTokenName,
    StyleTokenSelections,
    StyleValidationError,
} from './types';

export const STYLE_TOKEN_POLICY_VERSION = 'v1';

const TOKEN_VALUES: Record<StyleTokenName, string[]> = {
    surface: ['base', 'elevated', 'muted', 'accent_gold'],
    text: ['primary', 'secondary', 'inverse'],
    accent: ['gold', 'amber', 'teal', 'violet', 'slate'],
    motion: ['calm', 'standard', 'lively'],
};

const TOKEN_HEX: Partial<Record<StyleTokenName, Record<string, string>>> = {
    surface: {
        base: '#fffaf0',
        elevated: '#ffffff',
        muted: '#f1eee7',
        accent_gold: '#d9a227',
    },
    text: {
        primary: '#171717',
        secondary: '#8a6f38',
        inverse: '#fffaf0',
    },
    accent: {
        gold: '#c28b1a',
        amber: '#d97706',
        teal: '#0f766e',
        violet: '#7c3aed',
        slate: '#475569',
    },
};

const DEFAULT_SELECTIONS: StyleTokenSelections = {
    surface: 'base',
    text: 'primary',
    accent: 'gold',
    motion: 'calm',
};

const DEFAULT_LIFE_FEEL: StyleLifeFeelInputs = {
    colorTemperature: {
        zone: 'neutral',
    },
    emphasisLevel: 1,
    curiosityEvents: [],
};

const SAFE_STYLE_INTENTS = new Set(['calm', 'warm', 'focused', 'playful', 'formal', 'neutral']);
const SAFE_TONES = new Set(['soft', 'balanced', 'crisp', 'quiet']);
const SAFE_CURIOSITY_EVENTS = new Set(['new_reference', 'active_discussion', 'quiet_period', 'milestone']);
const FORBIDDEN_FIELD_KEYS = new Set([
    'css',
    'selector',
    'style',
    'rawPrompt',
    'rawText',
    'privateText',
    'providerRawResponse',
    'providerTrace',
    'personalProfile',
    'privateProfile',
    'sourceExcerpt',
    'proofRoot',
    'signature',
    'receiptWeight',
]);
const FORBIDDEN_VALUE_PATTERN = /(?:https?:\/\/|data:|javascript:|url\s*\(|@import|<style|<\/style|[{}]|\b(?:color|background(?:-color)?|font(?:-size|-family|-weight)?|display|position|top|right|bottom|left|width|height|margin|padding|border|opacity|transform|transition|animation|box-shadow|filter|z-index)\s*:\s*[^;{}]+(?:;|$)|var\s*\(--)/i;

export function normalizeStyleAdvisorProposal(input: {
    scope: StyleAdvisorScope;
    currentPreference?: unknown;
    modelOutput: unknown;
    maxChanges?: number;
}): StyleAdvisorProposal {
    const record = isRecord(input.modelOutput) ? input.modelOutput : {};
    const validationErrors: StyleValidationError[] = [];
    const forbiddenFields = Array.from(collectForbiddenFields(record));
    forbiddenFields.forEach((field) => {
        validationErrors.push({
            field,
            reasonCode: 'forbidden_private_field',
            message: 'style proposal includes a forbidden raw, private, provider, proof, or CSS field',
        });
    });

    const current = normalizeStylePreferenceParts(input.currentPreference);
    const nextSelections: StyleTokenSelections = { ...current.tokenSelections };
    const tokenDiff: StyleTokenChange[] = [];
    const seen = new Set<StyleTokenName>();
    const rawDiff = Array.isArray(record.tokenDiff) ? record.tokenDiff : [];
    const maxChanges = Math.max(1, Number(input.maxChanges ?? 8));

    for (const rawChange of rawDiff.slice(0, maxChanges)) {
        if (!isRecord(rawChange)) {
            validationErrors.push(invalid(null, 'invalid_token_change', 'style token change must be an object'));
            continue;
        }
        const token = normalizeTokenName(rawChange.token);
        if (!token || seen.has(token)) {
            validationErrors.push(invalid(
                typeof rawChange.token === 'string' ? rawChange.token : null,
                'unknown_style_token',
                'style token is not supported',
            ));
            continue;
        }
        const proposedValue = String(rawChange.proposedValue ?? '').trim();
        if (isForbiddenStyleValue(proposedValue)) {
            validationErrors.push(invalid(token, 'forbidden_style_value', 'style token value cannot contain CSS, selectors, or remote resources'));
            continue;
        }
        if (!TOKEN_VALUES[token].includes(proposedValue)) {
            validationErrors.push(invalid(token, 'unknown_style_token_value', 'style token value is not allowlisted'));
            continue;
        }
        seen.add(token);
        tokenDiff.push({
            token,
            previousValue: current.tokenSelections[token],
            proposedValue,
            reason: normalizeSafeDisplayText(
                rawChange.reason,
                `${token}.reason`,
                validationErrors,
                'Style token change is based on the current token policy.',
            ),
        });
        nextSelections[token] = proposedValue;
    }

    const lifeFeelInputs = normalizeLifeFeelInputs({
        colorTemperaturePreference: record.colorTemperaturePreference,
        emphasisLevel: record.emphasisLevel,
        curiosityEvents: record.curiosityEvents,
    }, current.lifeFeelInputs);
    const accessibilityChecks = buildAccessibilityChecks(nextSelections, lifeFeelInputs);
    accessibilityChecks.forEach((check) => {
        if (!check.passed) {
            validationErrors.push(invalid(check.check, `${check.check}_failed`, check.message));
        }
    });

    const styleIntent = normalizeEnum(record.styleIntent, SAFE_STYLE_INTENTS, 'neutral');
    const tone = normalizeEnum(record.tone, SAFE_TONES, 'balanced');
    const reason = normalizeSafeDisplayText(
        record.reason,
        'reason',
        validationErrors,
        'Style proposal is based on the current token policy.',
    );
    const riskLevel = computeRiskLevel(validationErrors, tokenDiff, lifeFeelInputs);

    return {
        scope: input.scope,
        reason,
        riskLevel,
        tokenPolicyVersion: STYLE_TOKEN_POLICY_VERSION,
        styleIntent,
        tone,
        tokenSelections: nextSelections,
        tokenDiff,
        lifeFeelInputs,
        previewState: {
            scope: input.scope,
            tokenSelections: nextSelections,
            lifeFeelInputs,
            swatches: (Object.keys(nextSelections) as StyleTokenName[]).map((token) => ({
                token,
                value: nextSelections[token],
                hex: TOKEN_HEX[token]?.[nextSelections[token]] ?? null,
            })),
        },
        accessibilityChecks,
        validationErrors,
    };
}

export function validateStylePreferencePayload(value: unknown): {
    ok: true;
    preference: {
        scope: StyleAdvisorScope;
        tokenSelections: StyleTokenSelections;
        lifeFeelInputs: StyleLifeFeelInputs;
        tokenPolicyVersion: string;
    };
} | {
    ok: false;
    reasonCode: 'invalid_style_preference';
    validationErrors: StyleValidationError[];
} {
    const record = isRecord(value) ? value : {};
    const scope = normalizeScope(record.scope);
    const forbiddenFields = Array.from(collectForbiddenFields(record));
    const validationErrors: StyleValidationError[] = forbiddenFields.map((field) => ({
        field,
        reasonCode: 'forbidden_private_field',
        message: 'style preference includes a forbidden raw, private, provider, proof, or CSS field',
    }));
    const rawSelections = isRecord(record.tokenSelections) ? record.tokenSelections : record;
    (Object.keys(TOKEN_VALUES) as StyleTokenName[]).forEach((token) => {
        if (!Object.prototype.hasOwnProperty.call(rawSelections, token)) return;
        const selected = String(rawSelections[token] ?? '').trim();
        if (isForbiddenStyleValue(selected) || !TOKEN_VALUES[token].includes(selected)) {
            validationErrors.push(invalid(token, 'unknown_style_token_value', 'style token value is not allowlisted'));
        }
    });
    const normalized = normalizeStylePreferenceParts(record);
    buildAccessibilityChecks(normalized.tokenSelections, normalized.lifeFeelInputs).forEach((check) => {
        if (!check.passed) {
            validationErrors.push(invalid(check.check, `${check.check}_failed`, check.message));
        }
    });

    if (validationErrors.length > 0) {
        return {
            ok: false,
            reasonCode: 'invalid_style_preference',
            validationErrors,
        };
    }

    return {
        ok: true,
        preference: {
            scope,
            tokenPolicyVersion: STYLE_TOKEN_POLICY_VERSION,
            tokenSelections: normalized.tokenSelections,
            lifeFeelInputs: normalized.lifeFeelInputs,
        },
    };
}

export function buildFallbackStyleProposal(
    reasonCode: string,
    scope: StyleAdvisorScope,
): StyleAdvisorProposal {
    return {
        scope,
        reason: `Style Advisor could not generate a proposal: ${reasonCode}`,
        riskLevel: 'low',
        tokenPolicyVersion: STYLE_TOKEN_POLICY_VERSION,
        styleIntent: 'neutral',
        tone: 'balanced',
        tokenSelections: { ...DEFAULT_SELECTIONS },
        tokenDiff: [],
        lifeFeelInputs: { ...DEFAULT_LIFE_FEEL, colorTemperature: { ...DEFAULT_LIFE_FEEL.colorTemperature } },
        previewState: {
            scope,
            tokenSelections: { ...DEFAULT_SELECTIONS },
            lifeFeelInputs: { ...DEFAULT_LIFE_FEEL, colorTemperature: { ...DEFAULT_LIFE_FEEL.colorTemperature } },
            swatches: [],
        },
        accessibilityChecks: buildAccessibilityChecks(DEFAULT_SELECTIONS, DEFAULT_LIFE_FEEL),
        validationErrors: [{
            field: null,
            reasonCode,
            message: 'No style token changes were proposed.',
        }],
    };
}

export function listStyleTokenPolicy(): Record<StyleTokenName, string[]> {
    return {
        surface: [...TOKEN_VALUES.surface],
        text: [...TOKEN_VALUES.text],
        accent: [...TOKEN_VALUES.accent],
        motion: [...TOKEN_VALUES.motion],
    };
}

export function normalizeStylePreferenceParts(value: unknown): {
    tokenSelections: StyleTokenSelections;
    lifeFeelInputs: StyleLifeFeelInputs;
} {
    const record = isRecord(value) ? value : {};
    const rawSelections = isRecord(record.tokenSelections) ? record.tokenSelections : record;
    const tokenSelections: StyleTokenSelections = { ...DEFAULT_SELECTIONS };
    (Object.keys(TOKEN_VALUES) as StyleTokenName[]).forEach((token) => {
        const candidate = String(rawSelections[token] ?? '').trim();
        if (candidate && TOKEN_VALUES[token].includes(candidate) && !isForbiddenStyleValue(candidate)) {
            tokenSelections[token] = candidate;
        }
    });
    const lifeFeelInputs = normalizeLifeFeelInputs(
        isRecord(record.lifeFeelInputs) ? record.lifeFeelInputs : {},
        DEFAULT_LIFE_FEEL,
    );
    return {
        tokenSelections,
        lifeFeelInputs,
    };
}

function normalizeLifeFeelInputs(
    raw: Record<string, unknown>,
    fallback: StyleLifeFeelInputs,
): StyleLifeFeelInputs {
    const zoneCandidate = String(
        raw.colorTemperaturePreference
        ?? (isRecord(raw.colorTemperature) ? raw.colorTemperature.zone : undefined)
        ?? '',
    ).trim();
    const zone = zoneCandidate === 'cool' || zoneCandidate === 'warm' || zoneCandidate === 'neutral'
        ? zoneCandidate
        : fallback.colorTemperature.zone;
    const emphasis = Number(raw.emphasisLevel ?? fallback.emphasisLevel);
    const events = Array.isArray(raw.curiosityEvents)
        ? raw.curiosityEvents
            .map((item) => String(item || '').trim())
            .filter((item) => SAFE_CURIOSITY_EVENTS.has(item))
            .slice(0, 8)
        : [...fallback.curiosityEvents];
    return {
        colorTemperature: { zone },
        emphasisLevel: Number.isFinite(emphasis)
            ? Math.max(0, Math.min(4, Math.trunc(emphasis)))
            : fallback.emphasisLevel,
        curiosityEvents: events,
    };
}

function buildAccessibilityChecks(
    selections: StyleTokenSelections,
    lifeFeelInputs: StyleLifeFeelInputs,
): StyleAccessibilityCheck[] {
    const foreground = TOKEN_HEX.text?.[selections.text] ?? '#171717';
    const background = TOKEN_HEX.surface?.[selections.surface] ?? '#fffaf0';
    const ratio = contrastRatio(foreground, background);
    const minRatio = 4.5;
    const intensityPassed = lifeFeelInputs.emphasisLevel <= 3 || selections.motion !== 'lively';
    return [
        {
            check: 'contrast',
            passed: ratio >= minRatio,
            ratio: Number(ratio.toFixed(2)),
            minRatio,
            message: ratio >= minRatio
                ? 'foreground and surface contrast passed'
                : 'foreground and surface contrast is below AA threshold',
        },
        {
            check: 'intensity',
            passed: intensityPassed,
            message: intensityPassed
                ? 'visual intensity is bounded'
                : 'high emphasis cannot combine with lively motion',
        },
    ];
}

function contrastRatio(foregroundHex: string, backgroundHex: string): number {
    const foreground = relativeLuminance(foregroundHex);
    const background = relativeLuminance(backgroundHex);
    const lighter = Math.max(foreground, background);
    const darker = Math.min(foreground, background);
    return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
    const normalized = hex.replace('#', '').trim();
    const rgb = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255);
    const linear = rgb.map((channel) => channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function collectForbiddenFields(value: unknown, output = new Set<string>()): Set<string> {
    if (!value || typeof value !== 'object') return output;
    if (Array.isArray(value)) {
        value.forEach((item) => collectForbiddenFields(item, output));
        return output;
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
        if (FORBIDDEN_FIELD_KEYS.has(key)) output.add(key);
        collectForbiddenFields(nested, output);
    });
    return output;
}

function isForbiddenStyleValue(value: string): boolean {
    return FORBIDDEN_VALUE_PATTERN.test(value);
}

function normalizeTokenName(value: unknown): StyleTokenName | null {
    const token = String(value || '').trim();
    return (Object.keys(TOKEN_VALUES) as string[]).includes(token)
        ? token as StyleTokenName
        : null;
}

function normalizeScope(value: unknown): StyleAdvisorScope {
    return value === 'circle' || value === 'session_preview' ? value : 'personal';
}

function normalizeEnum(value: unknown, allowed: Set<string>, fallback: string): string {
    const normalized = String(value || '').trim();
    return allowed.has(normalized) ? normalized : fallback;
}

function normalizeSafeDisplayText(
    value: unknown,
    field: string,
    validationErrors: StyleValidationError[],
    fallback: string,
): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    const normalized = text.slice(0, 600);
    if (!normalized) return fallback;
    if (isForbiddenStyleValue(normalized)) {
        validationErrors.push(invalid(
            field,
            'forbidden_display_string',
            'style proposal display text cannot contain CSS, selectors, or remote resources',
        ));
        return fallback;
    }
    return normalized;
}

function computeRiskLevel(
    validationErrors: StyleValidationError[],
    tokenDiff: StyleTokenChange[],
    lifeFeelInputs: StyleLifeFeelInputs,
): StyleRiskLevel {
    if (validationErrors.length > 0) return 'high';
    if (lifeFeelInputs.emphasisLevel >= 3 || tokenDiff.length > 2) return 'medium';
    return 'low';
}

function invalid(field: string | null, reasonCode: string, message: string): StyleValidationError {
    return {
        field,
        reasonCode,
        message,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
