import { PublicKey } from '@solana/web3.js';

export const DEFAULT_DRAFT_KNOWLEDGE_BINDING_STRATEGY = 'explicit' as const;
export const DEFAULT_DRAFT_STRICT_BINDING_MODE = 'enforce' as const;
export const DRAFT_STRICT_BINDING_MODE_ENV_KEY = 'DRAFT_STRICT_BINDING_MODE' as const;

export type DraftKnowledgeBindingStrategy =
    typeof DEFAULT_DRAFT_KNOWLEDGE_BINDING_STRATEGY;
export type DraftStrictBindingMode = 'off' | 'warn' | 'enforce';

export interface DraftStrictBindingDiagnostic {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface DraftStrictBindingDecision {
    mode: DraftStrictBindingMode;
    blocked: boolean;
    statusCode: number | null;
    warning: DraftStrictBindingDiagnostic | null;
    error: DraftStrictBindingDiagnostic | null;
}

export interface DraftStrictBindingViolationInput {
    mode: DraftStrictBindingMode;
    code: string;
    message: string;
    enforceStatusCode?: number;
    details?: Record<string, unknown>;
}

export interface DraftCrystallizationRequest {
    draftPostId: number;
    circleId: number;
    bindingStrategy: DraftKnowledgeBindingStrategy;
    knowledgePda: string;
    storageUri: string;
    contentHash: string;
    title: string;
    description: string;
}

export interface DraftCrystallizationValidationResult {
    ok: boolean;
    errors: string[];
    value?: DraftCrystallizationRequest;
}

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isHex64(value: string): boolean {
    return /^[a-f0-9]{64}$/i.test(value);
}

function isValidPublicKey(value: string): boolean {
    try {
        void new PublicKey(value);
        return true;
    } catch {
        return false;
    }
}

export function parseDraftStrictBindingMode(value: unknown): DraftStrictBindingMode {
    const normalized = typeof value === 'string'
        ? value.trim().toLowerCase()
        : '';
    if (normalized === 'warn' || normalized === 'enforce' || normalized === 'off') {
        return normalized;
    }
    return DEFAULT_DRAFT_STRICT_BINDING_MODE;
}

export function resolveDraftStrictBindingMode(
    env: NodeJS.ProcessEnv = process.env,
): DraftStrictBindingMode {
    return parseDraftStrictBindingMode(env[DRAFT_STRICT_BINDING_MODE_ENV_KEY]);
}

export function evaluateDraftStrictBindingViolation(
    input: DraftStrictBindingViolationInput,
): DraftStrictBindingDecision {
    const statusCode = Number.isFinite(input.enforceStatusCode)
        ? Number(input.enforceStatusCode)
        : 409;
    const diagnostic: DraftStrictBindingDiagnostic = {
        code: input.code,
        message: input.message,
        ...(input.details ? { details: input.details } : {}),
    };

    if (input.mode === 'enforce') {
        return {
            mode: input.mode,
            blocked: true,
            statusCode,
            warning: null,
            error: diagnostic,
        };
    }

    return {
        mode: input.mode,
        blocked: false,
        statusCode: null,
        warning: diagnostic,
        error: null,
    };
}

export function validateDraftCrystallizationRequest(
    input: unknown,
): DraftCrystallizationValidationResult {
    const data = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
    const errors: string[] = [];

    const draftPostIdRaw = data.draftPostId;
    if (!isPositiveInt(draftPostIdRaw)) {
        errors.push('draftPostId is required');
    }

    const circleIdRaw = data.circleId;
    if (!isPositiveInt(circleIdRaw)) {
        errors.push('circleId is required');
    }

    const bindingStrategy = normalizeString(data.bindingStrategy);
    if (bindingStrategy !== DEFAULT_DRAFT_KNOWLEDGE_BINDING_STRATEGY) {
        errors.push('bindingStrategy must be explicit');
    }

    const knowledgePda = normalizeString(data.knowledgePda);
    if (!knowledgePda) {
        errors.push('knowledgePda is required');
    } else if (!isValidPublicKey(knowledgePda)) {
        errors.push('knowledgePda must be a valid public key');
    }

    const storageUri = normalizeString(data.storageUri);
    if (!storageUri) {
        errors.push('storageUri is required');
    }

    const contentHash = normalizeString(data.contentHash).toLowerCase();
    if (!contentHash) {
        errors.push('contentHash is required');
    } else if (!isHex64(contentHash)) {
        errors.push('contentHash must be a 32-byte hex string');
    }

    const title = normalizeString(data.title);
    if (!title) {
        errors.push('title is required');
    }

    const description = normalizeString(data.description);
    if (!description) {
        errors.push('description is required');
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    const draftPostId = draftPostIdRaw as number;
    const circleId = circleIdRaw as number;

    return {
        ok: true,
        errors: [],
        value: {
            draftPostId,
            circleId,
            bindingStrategy: DEFAULT_DRAFT_KNOWLEDGE_BINDING_STRATEGY,
            knowledgePda,
            storageUri,
            contentHash,
            title,
            description,
        },
    };
}
