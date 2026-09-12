import crypto from 'node:crypto';

import {
    Prisma,
    type PrismaClient,
} from '@prisma/client';

import {
    getPromptMetadata,
    type PromptTemplateId,
} from '../../ai/prompts/registry';
import { loadNodeRuntimeConfig, serviceConfig } from '../../config/services';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type CircleDraftPromptScope = 'knowledge_draft' | 'governance_draft';
export type CircleDraftPromptMode = 'system_default' | 'circle_custom';

const PROMPT_SCOPE_CONTRACT: Record<CircleDraftPromptScope, {
    systemPromptAsset: PromptTemplateId;
    schemaRef: string;
}> = {
    knowledge_draft: {
        systemPromptAsset: 'discussion-initial-draft',
        schemaRef: 'schemas/discussion-initial-draft.schema.json',
    },
    governance_draft: {
        systemPromptAsset: 'accepted-issue-revision',
        schemaRef: 'schemas/accepted-issue-revision.schema.json',
    },
};

const SELECTION_EVENT_TYPES = ['custom_selected', 'system_default_selected'] as const;

export class CircleDraftPromptError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'CircleDraftPromptError';
    }
}

type PromptKey = {
    key: Buffer;
    keyVersion: string;
};

type StoredPromptVersion = {
    id: string;
    circleId: number;
    scope: string;
    version: number;
    promptCiphertext: string;
    promptNonce: string;
    promptAuthTag: string;
    keyVersion: string;
    promptDigest: string;
    schemaRef: string;
    systemPromptAsset: string;
    systemPromptVersion: string;
    approvalRef: string;
    approvedByUserId: number;
    approvedByPubkey: string;
    approvedAt: Date;
    createdAt: Date;
};

type StoredPromptEvent = {
    id: string;
    circleId: number;
    scope: string;
    eventType: 'custom_selected' | 'system_default_selected' | 'prompt_decrypted';
    selectionSequence: number | null;
    promptVersionId: string;
    approvalRef: string | null;
    actorUserId: number | null;
    actorPubkey: string | null;
    purpose: string;
    createdAt: Date;
};

export type CircleDraftPromptAccessContext = {
    actorUserId: number | null;
    actorPubkey?: string | null;
    purpose:
        | 'settings_preview'
        | 'update_response'
        | 'idempotent_readback'
        | 'selection_preflight'
        | 'knowledge_draft_generation'
        | 'governance_draft_generation';
};

export type CircleDraftPromptVersionReadback = {
    id: string;
    version: number;
    promptDigest: string;
    schemaRef: string;
    systemPromptAsset: string;
    systemPromptVersion: string;
    approvalRef: string;
    approvedByPubkey: string;
    approvedAt: string;
    keyVersion: string;
    selectionCount: number;
    lastSelectedAt: string | null;
};

export type CircleDraftPromptEventReadback = {
    id: string;
    eventType: StoredPromptEvent['eventType'];
    selectionSequence: number | null;
    promptVersionId: string;
    promptVersion: number | null;
    approvalRef: string | null;
    actorUserId: number | null;
    actorPubkey: string | null;
    purpose: string;
    createdAt: string;
};

export type CircleDraftPromptScopeReadback = {
    scope: CircleDraftPromptScope;
    mode: CircleDraftPromptMode;
    systemPromptAsset: string;
    systemPromptVersion: string;
    schemaRef: string;
    activeVersion: CircleDraftPromptVersionReadback | null;
    promptBody: string | null;
    history: CircleDraftPromptVersionReadback[];
    selectionSequence: number;
    selectionHistory: CircleDraftPromptEventReadback[];
    recentDecryptAudit: CircleDraftPromptEventReadback[];
    customRuntimeConnected: boolean;
    currentSelectionApprovalRef: string | null;
    currentSelectionApprovedByPubkey: string | null;
    providerBoundary: {
        mode: 'builtin' | 'external';
        externalPrivateContentMode: 'deny' | 'allow';
        runtimeRole: string;
        plaintextDuringAuthorizedRun: true;
    };
};

export type ResolvedCircleDraftPrompt = {
    scope: CircleDraftPromptScope;
    mode: CircleDraftPromptMode;
    systemPromptAsset: PromptTemplateId;
    systemPromptVersion: string;
    schemaRef: string;
    promptVersion: string;
    customPromptBody: string | null;
    circlePromptVersionId: string | null;
    circlePromptVersion: number | null;
    circlePromptDigest: string | null;
    approvalRef: string | null;
    selectionApprovalRef: string | null;
};

function normalizePromptBody(value: unknown): string {
    const normalized = String(value || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized || normalized.length > 12000) {
        throw new CircleDraftPromptError(
            'circle_draft_prompt_body_invalid',
            400,
            'Circle Draft Prompt must contain between 1 and 12000 characters',
        );
    }
    return normalized;
}

export function parseCircleDraftPromptScope(value: unknown): CircleDraftPromptScope | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'knowledge_draft' || normalized === 'governance_draft') {
        return normalized;
    }
    return null;
}

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function decodePromptKey(encoded: string, keyVersion: string): PromptKey | null {
    const key = /^[A-Za-z0-9+/]{43}=$/.test(encoded)
        ? Buffer.from(encoded, 'base64')
        : Buffer.alloc(0);
    if (
        key.length !== 32
        || key.toString('base64') !== encoded
        || !keyVersion
        || keyVersion.length > 64
    ) return null;
    return { key, keyVersion };
}

function resolveEncryptionKey(): PromptKey {
    const encoded = String(process.env.CIRCLE_DRAFT_PROMPT_ENCRYPTION_KEY_BASE64 || '').trim();
    const keyVersion = String(process.env.CIRCLE_DRAFT_PROMPT_KEY_VERSION || '').trim();
    const key = decodePromptKey(encoded, keyVersion);
    if (!key) {
        throw new CircleDraftPromptError(
            'circle_draft_prompt_key_unavailable',
            503,
            'Circle Draft Prompt encryption key is unavailable',
        );
    }
    return key;
}

function resolveDecryptionKey(keyVersion: string): PromptKey {
    const currentVersion = String(process.env.CIRCLE_DRAFT_PROMPT_KEY_VERSION || '').trim();
    if (currentVersion === keyVersion) return resolveEncryptionKey();

    let keyRing: unknown;
    try {
        keyRing = JSON.parse(String(process.env.CIRCLE_DRAFT_PROMPT_DECRYPTION_KEYS_JSON || '{}'));
    } catch {
        keyRing = null;
    }
    const encoded = keyRing && typeof keyRing === 'object' && !Array.isArray(keyRing)
        ? String((keyRing as Record<string, unknown>)[keyVersion] || '').trim()
        : '';
    const key = decodePromptKey(encoded, keyVersion);
    if (!key) {
        throw new CircleDraftPromptError(
            'circle_draft_prompt_key_version_unavailable',
            503,
            'The selected Circle Draft Prompt key version is unavailable',
        );
    }
    return key;
}

function buildPromptAad(input: {
    circleId: number;
    scope: CircleDraftPromptScope;
    version: number;
    promptDigest: string;
    schemaRef: string;
    systemPromptAsset: string;
    systemPromptVersion: string;
    keyVersion: string;
}): Buffer {
    return Buffer.from(JSON.stringify({
        v: 1,
        circleId: input.circleId,
        scope: input.scope,
        version: input.version,
        promptDigest: input.promptDigest,
        schemaRef: input.schemaRef,
        systemPromptAsset: input.systemPromptAsset,
        systemPromptVersion: input.systemPromptVersion,
        keyVersion: input.keyVersion,
    }), 'utf8');
}

function encryptPromptBody(input: {
    body: string;
    circleId: number;
    scope: CircleDraftPromptScope;
    version: number;
    promptDigest: string;
    schemaRef: string;
    systemPromptAsset: string;
    systemPromptVersion: string;
}) {
    const { key, keyVersion } = resolveEncryptionKey();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(buildPromptAad({ ...input, keyVersion }));
    const ciphertext = Buffer.concat([cipher.update(input.body, 'utf8'), cipher.final()]);
    return {
        promptCiphertext: ciphertext.toString('base64'),
        promptNonce: nonce.toString('base64'),
        promptAuthTag: cipher.getAuthTag().toString('base64'),
        keyVersion,
    };
}

function decryptPromptBody(row: StoredPromptVersion): string {
    const { key } = resolveDecryptionKey(row.keyVersion);
    const scope = parseCircleDraftPromptScope(row.scope);
    if (!scope) throw new CircleDraftPromptError('circle_draft_prompt_scope_invalid', 409);
    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(row.promptNonce, 'base64'),
        );
        decipher.setAAD(buildPromptAad({
            circleId: row.circleId,
            scope,
            version: row.version,
            promptDigest: row.promptDigest,
            schemaRef: row.schemaRef,
            systemPromptAsset: row.systemPromptAsset,
            systemPromptVersion: row.systemPromptVersion,
            keyVersion: row.keyVersion,
        }));
        decipher.setAuthTag(Buffer.from(row.promptAuthTag, 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(row.promptCiphertext, 'base64')),
            decipher.final(),
        ]).toString('utf8');
        if (sha256Hex(plaintext) !== row.promptDigest) throw new Error('prompt_digest_mismatch');
        return plaintext;
    } catch (error) {
        if (error instanceof CircleDraftPromptError) throw error;
        throw new CircleDraftPromptError(
            'circle_draft_prompt_decrypt_failed',
            503,
            'The selected Circle Draft Prompt could not be decrypted',
        );
    }
}

function systemContract(scope: CircleDraftPromptScope) {
    const contract = PROMPT_SCOPE_CONTRACT[scope];
    return {
        ...contract,
        systemPromptVersion: getPromptMetadata(contract.systemPromptAsset).promptVersion,
    };
}

function toEventReadback(
    event: StoredPromptEvent,
    versionsById: Map<string, StoredPromptVersion>,
): CircleDraftPromptEventReadback {
    return {
        id: event.id,
        eventType: event.eventType,
        selectionSequence: event.selectionSequence,
        promptVersionId: event.promptVersionId,
        promptVersion: versionsById.get(event.promptVersionId)?.version ?? null,
        approvalRef: event.approvalRef,
        actorUserId: event.actorUserId,
        actorPubkey: event.actorPubkey,
        purpose: event.purpose,
        createdAt: event.createdAt.toISOString(),
    };
}

function toVersionReadback(
    row: StoredPromptVersion,
    selectionEvents: StoredPromptEvent[],
): CircleDraftPromptVersionReadback {
    const selections = selectionEvents.filter((event) => (
        event.eventType === 'custom_selected' && event.promptVersionId === row.id
    ));
    const lastSelected = selections.at(-1) ?? null;
    return {
        id: row.id,
        version: row.version,
        promptDigest: row.promptDigest,
        schemaRef: row.schemaRef,
        systemPromptAsset: row.systemPromptAsset,
        systemPromptVersion: row.systemPromptVersion,
        approvalRef: row.approvalRef,
        approvedByPubkey: row.approvedByPubkey,
        approvedAt: row.approvedAt.toISOString(),
        keyVersion: row.keyVersion,
        selectionCount: selections.length,
        lastSelectedAt: lastSelected?.createdAt.toISOString() ?? null,
    };
}

async function recordPromptDecrypt(
    prisma: PrismaLike,
    row: StoredPromptVersion,
    access: CircleDraftPromptAccessContext,
): Promise<StoredPromptEvent> {
    try {
        return await (prisma as any).circleDraftPromptEvent.create({
            data: {
                id: crypto.randomUUID(),
                circleId: row.circleId,
                scope: row.scope,
                eventType: 'prompt_decrypted',
                selectionSequence: null,
                promptVersionId: row.id,
                approvalRef: null,
                actorUserId: access.actorUserId,
                actorPubkey: access.actorPubkey ?? null,
                purpose: access.purpose,
            },
        }) as StoredPromptEvent;
    } catch {
        throw new CircleDraftPromptError(
            'circle_draft_prompt_decrypt_audit_failed',
            503,
            'Circle Draft Prompt access audit is unavailable',
        );
    }
}

async function decryptWithAudit(
    prisma: PrismaLike,
    row: StoredPromptVersion,
    access: CircleDraftPromptAccessContext,
): Promise<{ plaintext: string; audit: StoredPromptEvent }> {
    const plaintext = decryptPromptBody(row);
    const audit = await recordPromptDecrypt(prisma, row, access);
    return { plaintext, audit };
}

async function loadSelectionEvents(
    prisma: PrismaLike,
    circleId: number,
): Promise<StoredPromptEvent[]> {
    return await (prisma as any).circleDraftPromptEvent.findMany({
        where: {
            circleId,
            eventType: { in: [...SELECTION_EVENT_TYPES] },
        },
        orderBy: [{ selectionSequence: 'asc' }],
    }) as StoredPromptEvent[];
}

export async function listCircleDraftPromptSettings(
    prisma: PrismaLike,
    circleId: number,
    access: CircleDraftPromptAccessContext,
    scopeFilter?: CircleDraftPromptScope,
): Promise<CircleDraftPromptScopeReadback[]> {
    const rows = await prisma.circleDraftPromptVersion.findMany({
        where: { circleId },
        orderBy: [{ scope: 'asc' }, { version: 'desc' }],
    }) as StoredPromptVersion[];
    const selectionEvents = await loadSelectionEvents(prisma, circleId);
    const recentAudit = await (prisma as any).circleDraftPromptEvent.findMany({
        where: { circleId, eventType: 'prompt_decrypted' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
    }) as StoredPromptEvent[];
    const versionsById = new Map(rows.map((row) => [row.id, row]));
    const runtime = loadNodeRuntimeConfig();
    const providerBoundary = {
        mode: serviceConfig.ai.mode,
        externalPrivateContentMode: serviceConfig.ai.externalPrivateContentMode,
        runtimeRole: runtime.runtimeRole,
        plaintextDuringAuthorizedRun: true as const,
    };

    const result: CircleDraftPromptScopeReadback[] = [];
    const scopes = scopeFilter
        ? [scopeFilter]
        : ['knowledge_draft', 'governance_draft'] as CircleDraftPromptScope[];
    for (const scope of scopes) {
        const contract = systemContract(scope);
        const history = rows.filter((row) => row.scope === scope);
        const scopeSelections = selectionEvents.filter((event) => event.scope === scope);
        const currentSelection = scopeSelections.at(-1) ?? null;
        const active = currentSelection?.eventType === 'custom_selected'
            ? versionsById.get(currentSelection.promptVersionId) ?? null
            : null;
        const decrypted = active ? await decryptWithAudit(prisma, active, access) : null;
        const scopeAudit = recentAudit.filter((event) => event.scope === scope);
        if (decrypted) scopeAudit.unshift(decrypted.audit);
        result.push({
            scope,
            mode: active ? 'circle_custom' : 'system_default',
            systemPromptAsset: contract.systemPromptAsset,
            systemPromptVersion: contract.systemPromptVersion,
            schemaRef: contract.schemaRef,
            activeVersion: active ? toVersionReadback(active, scopeSelections) : null,
            promptBody: decrypted?.plaintext ?? null,
            history: history.map((row) => toVersionReadback(row, scopeSelections)),
            selectionSequence: currentSelection?.selectionSequence ?? 0,
            selectionHistory: scopeSelections
                .slice()
                .reverse()
                .map((event) => toEventReadback(event, versionsById)),
            recentDecryptAudit: scopeAudit
                .slice(0, 10)
                .map((event) => toEventReadback(event, versionsById)),
            customRuntimeConnected: true,
            currentSelectionApprovalRef: currentSelection?.approvalRef ?? null,
            currentSelectionApprovedByPubkey: currentSelection?.actorPubkey ?? null,
            providerBoundary,
        });
    }
    return result;
}

export async function resolveCircleDraftPromptForGeneration(
    prisma: PrismaLike,
    input: {
        circleId: number;
        scope: CircleDraftPromptScope;
        access: CircleDraftPromptAccessContext;
    },
): Promise<ResolvedCircleDraftPrompt> {
    const contract = systemContract(input.scope);
    const selection = await (prisma as any).circleDraftPromptEvent.findFirst({
        where: {
            circleId: input.circleId,
            scope: input.scope,
            eventType: { in: [...SELECTION_EVENT_TYPES] },
        },
        orderBy: [{ selectionSequence: 'desc' }],
    }) as StoredPromptEvent | null;
    if (!selection || selection.eventType === 'system_default_selected') {
        return {
            scope: input.scope,
            mode: 'system_default',
            systemPromptAsset: contract.systemPromptAsset,
            systemPromptVersion: contract.systemPromptVersion,
            schemaRef: contract.schemaRef,
            promptVersion: contract.systemPromptVersion,
            customPromptBody: null,
            circlePromptVersionId: null,
            circlePromptVersion: null,
            circlePromptDigest: null,
            approvalRef: null,
            selectionApprovalRef: selection?.approvalRef ?? null,
        };
    }
    const active = await prisma.circleDraftPromptVersion.findUnique({
        where: { id: selection.promptVersionId },
    }) as StoredPromptVersion | null;
    if (!active || active.circleId !== input.circleId || active.scope !== input.scope) {
        throw new CircleDraftPromptError('circle_draft_prompt_selection_invalid', 409);
    }
    if (
        active.schemaRef !== contract.schemaRef
        || active.systemPromptAsset !== contract.systemPromptAsset
        || active.systemPromptVersion !== contract.systemPromptVersion
    ) {
        throw new CircleDraftPromptError('circle_draft_prompt_schema_incompatible', 409);
    }
    const { plaintext } = await decryptWithAudit(prisma, active, input.access);
    return {
        scope: input.scope,
        mode: 'circle_custom',
        systemPromptAsset: contract.systemPromptAsset,
        systemPromptVersion: contract.systemPromptVersion,
        schemaRef: contract.schemaRef,
        promptVersion: `circle-${active.version}`,
        customPromptBody: plaintext,
        circlePromptVersionId: active.id,
        circlePromptVersion: active.version,
        circlePromptDigest: active.promptDigest,
        approvalRef: active.approvalRef,
        selectionApprovalRef: selection.approvalRef,
    };
}

async function nextSelectionSequence(tx: Prisma.TransactionClient, circleId: number, scope: CircleDraftPromptScope) {
    const latest = await (tx as any).circleDraftPromptEvent.findFirst({
        where: {
            circleId,
            scope,
            eventType: { in: [...SELECTION_EVENT_TYPES] },
        },
        orderBy: { selectionSequence: 'desc' },
        select: { selectionSequence: true },
    });
    return Number(latest?.selectionSequence ?? 0) + 1;
}

async function lockPromptScope(tx: Prisma.TransactionClient, circleId: number, scope: CircleDraftPromptScope) {
    await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
            CAST(${circleId} AS integer),
            hashtext(${`circle_draft_prompt:${scope}`})::integer
        )
    `;
}

export async function readIdempotentCircleDraftPromptUpdate(
    prisma: PrismaLike,
    input: {
        circleId: number;
        scope: CircleDraftPromptScope;
        mode: CircleDraftPromptMode;
        version: number | null;
        promptDigest: string | null;
        schemaRef: string;
        systemPromptVersion: string;
        approvalRef: string;
        access: CircleDraftPromptAccessContext;
    },
): Promise<CircleDraftPromptScopeReadback | null> {
    const event = await (prisma as any).circleDraftPromptEvent.findFirst({
        where: {
            circleId: input.circleId,
            scope: input.scope,
            approvalRef: input.approvalRef,
            eventType: input.mode === 'circle_custom' ? 'custom_selected' : 'system_default_selected',
        },
    }) as StoredPromptEvent | null;
    if (!event) return null;
    const version = await prisma.circleDraftPromptVersion.findUnique({
        where: { id: event.promptVersionId },
    }) as StoredPromptVersion | null;
    if (
        !version
        || version.circleId !== input.circleId
        || version.scope !== input.scope
        || version.version !== input.version
        || version.promptDigest !== input.promptDigest
        || version.schemaRef !== input.schemaRef
        || version.systemPromptVersion !== input.systemPromptVersion
    ) return null;
    const scopes = await listCircleDraftPromptSettings(prisma, input.circleId, input.access, input.scope);
    return scopes.find((entry) => entry.scope === input.scope) ?? null;
}

export async function createAndActivateCircleDraftPromptVersion(
    prisma: PrismaClient,
    input: {
        circleId: number;
        scope: CircleDraftPromptScope;
        promptBody: string;
        approvedByUserId: number;
        approvedByPubkey: string;
        approvalRef: string;
        expectedVersion: number;
        expectedPromptDigest: string;
        expectedSchemaRef: string;
        expectedSystemPromptVersion: string;
        now?: Date;
    },
): Promise<CircleDraftPromptScopeReadback> {
    const body = normalizePromptBody(input.promptBody);
    const promptDigest = sha256Hex(body);
    const contract = systemContract(input.scope);
    if (
        input.expectedPromptDigest !== promptDigest
        || input.expectedSchemaRef !== contract.schemaRef
        || input.expectedSystemPromptVersion !== contract.systemPromptVersion
    ) throw new CircleDraftPromptError('circle_draft_prompt_signed_contract_mismatch', 409);
    const now = input.now ?? new Date();

    await prisma.$transaction(async (tx) => {
        await lockPromptScope(tx, input.circleId, input.scope);
        const latest = await tx.circleDraftPromptVersion.findFirst({
            where: { circleId: input.circleId, scope: input.scope },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        const version = (latest?.version ?? 0) + 1;
        if (input.expectedVersion !== version) {
            throw new CircleDraftPromptError('circle_draft_prompt_version_stale', 409);
        }
        const versionId = crypto.randomUUID();
        await tx.circleDraftPromptVersion.create({
            data: {
                id: versionId,
                circleId: input.circleId,
                scope: input.scope,
                version,
                ...encryptPromptBody({
                    body,
                    circleId: input.circleId,
                    scope: input.scope,
                    version,
                    promptDigest,
                    schemaRef: contract.schemaRef,
                    systemPromptAsset: contract.systemPromptAsset,
                    systemPromptVersion: contract.systemPromptVersion,
                }),
                promptDigest,
                schemaRef: contract.schemaRef,
                systemPromptAsset: contract.systemPromptAsset,
                systemPromptVersion: contract.systemPromptVersion,
                approvalRef: input.approvalRef,
                approvedByUserId: input.approvedByUserId,
                approvedByPubkey: input.approvedByPubkey,
                approvedAt: now,
            },
        });
        await (tx as any).circleDraftPromptEvent.create({
            data: {
                id: crypto.randomUUID(),
                circleId: input.circleId,
                scope: input.scope,
                eventType: 'custom_selected',
                selectionSequence: await nextSelectionSequence(tx, input.circleId, input.scope),
                promptVersionId: versionId,
                approvalRef: input.approvalRef,
                actorUserId: input.approvedByUserId,
                actorPubkey: input.approvedByPubkey,
                purpose: 'create_and_activate',
                createdAt: now,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const scopes = await listCircleDraftPromptSettings(prisma, input.circleId, {
        actorUserId: input.approvedByUserId,
        actorPubkey: input.approvedByPubkey,
        purpose: 'update_response',
    }, input.scope);
    return scopes.find((entry) => entry.scope === input.scope)!;
}

export async function activateApprovedCircleDraftPromptVersion(
    prisma: PrismaClient,
    input: {
        circleId: number;
        scope: CircleDraftPromptScope;
        version: number;
        promptDigest: string;
        selectedByUserId: number;
        selectedByPubkey: string;
        selectionApprovalRef: string;
        expectedSchemaRef: string;
        expectedSystemPromptVersion: string;
        now?: Date;
    },
): Promise<CircleDraftPromptScopeReadback> {
    const contract = systemContract(input.scope);
    if (
        input.expectedSchemaRef !== contract.schemaRef
        || input.expectedSystemPromptVersion !== contract.systemPromptVersion
    ) throw new CircleDraftPromptError('circle_draft_prompt_signed_contract_mismatch', 409);
    const now = input.now ?? new Date();

    await prisma.$transaction(async (tx) => {
        await lockPromptScope(tx, input.circleId, input.scope);
        const version = await tx.circleDraftPromptVersion.findFirst({
            where: {
                circleId: input.circleId,
                scope: input.scope,
                version: input.version,
                promptDigest: input.promptDigest,
            },
        }) as StoredPromptVersion | null;
        if (!version) throw new CircleDraftPromptError('circle_draft_prompt_version_not_approved', 404);
        if (
            version.schemaRef !== contract.schemaRef
            || version.systemPromptAsset !== contract.systemPromptAsset
            || version.systemPromptVersion !== contract.systemPromptVersion
        ) throw new CircleDraftPromptError('circle_draft_prompt_schema_incompatible', 409);
        decryptPromptBody(version);
        await recordPromptDecrypt(tx, version, {
            actorUserId: input.selectedByUserId,
            actorPubkey: input.selectedByPubkey,
            purpose: 'selection_preflight',
        });
        const current = await (tx as any).circleDraftPromptEvent.findFirst({
            where: {
                circleId: input.circleId,
                scope: input.scope,
                eventType: { in: [...SELECTION_EVENT_TYPES] },
            },
            orderBy: { selectionSequence: 'desc' },
        }) as StoredPromptEvent | null;
        if (current?.eventType === 'custom_selected' && current.promptVersionId === version.id) {
            throw new CircleDraftPromptError('circle_draft_prompt_version_already_active', 409);
        }
        await (tx as any).circleDraftPromptEvent.create({
            data: {
                id: crypto.randomUUID(),
                circleId: input.circleId,
                scope: input.scope,
                eventType: 'custom_selected',
                selectionSequence: await nextSelectionSequence(tx, input.circleId, input.scope),
                promptVersionId: version.id,
                approvalRef: input.selectionApprovalRef,
                actorUserId: input.selectedByUserId,
                actorPubkey: input.selectedByPubkey,
                purpose: 'activate_approved_version',
                createdAt: now,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const scopes = await listCircleDraftPromptSettings(prisma, input.circleId, {
        actorUserId: input.selectedByUserId,
        actorPubkey: input.selectedByPubkey,
        purpose: 'update_response',
    }, input.scope);
    return scopes.find((entry) => entry.scope === input.scope)!;
}

export async function restoreSystemDefaultCircleDraftPrompt(
    prisma: PrismaClient,
    input: {
        circleId: number;
        scope: CircleDraftPromptScope;
        selectedByUserId: number;
        selectedByPubkey: string;
        selectionApprovalRef: string;
        expectedActiveVersion: number;
        expectedActivePromptDigest: string;
        expectedSchemaRef: string;
        expectedSystemPromptVersion: string;
        now?: Date;
    },
): Promise<CircleDraftPromptScopeReadback> {
    const contract = systemContract(input.scope);
    if (
        input.expectedSchemaRef !== contract.schemaRef
        || input.expectedSystemPromptVersion !== contract.systemPromptVersion
    ) throw new CircleDraftPromptError('circle_draft_prompt_signed_contract_mismatch', 409);
    const now = input.now ?? new Date();

    await prisma.$transaction(async (tx) => {
        await lockPromptScope(tx, input.circleId, input.scope);
        const current = await (tx as any).circleDraftPromptEvent.findFirst({
            where: {
                circleId: input.circleId,
                scope: input.scope,
                eventType: { in: [...SELECTION_EVENT_TYPES] },
            },
            orderBy: { selectionSequence: 'desc' },
        }) as StoredPromptEvent | null;
        if (!current || current.eventType === 'system_default_selected') {
            throw new CircleDraftPromptError('circle_draft_prompt_default_already_active', 409);
        }
        const active = await tx.circleDraftPromptVersion.findUnique({
            where: { id: current.promptVersionId },
            select: { id: true, version: true, promptDigest: true },
        });
        if (
            !active
            || active.version !== input.expectedActiveVersion
            || active.promptDigest !== input.expectedActivePromptDigest
        ) throw new CircleDraftPromptError('circle_draft_prompt_version_stale', 409);
        await (tx as any).circleDraftPromptEvent.create({
            data: {
                id: crypto.randomUUID(),
                circleId: input.circleId,
                scope: input.scope,
                eventType: 'system_default_selected',
                selectionSequence: await nextSelectionSequence(tx, input.circleId, input.scope),
                promptVersionId: active.id,
                approvalRef: input.selectionApprovalRef,
                actorUserId: input.selectedByUserId,
                actorPubkey: input.selectedByPubkey,
                purpose: 'restore_system_default',
                createdAt: now,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const scopes = await listCircleDraftPromptSettings(prisma, input.circleId, {
        actorUserId: input.selectedByUserId,
        actorPubkey: input.selectedByPubkey,
        purpose: 'update_response',
    }, input.scope);
    return scopes.find((entry) => entry.scope === input.scope)!;
}
