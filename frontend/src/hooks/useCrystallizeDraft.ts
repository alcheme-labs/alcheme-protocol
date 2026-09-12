'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import {
    fetchDraftContributionAssessment,
    fetchDraftContributorProof,
    fetchDraftProofPackage,
    fetchDraftPublishReadiness,
    acceptKnowledgePublicationLicense,
    authorizeKnowledgePublicationAttempt,
    prepareKnowledgePublicationAuthorization,
    registerDraftCrystallizationAttempt,
    submitDraftCrystallizationBinding,
    type DraftContributionAssessmentResponse,
    type KnowledgePublicationAuthorizationResponse,
} from '@/lib/api/discussion';
import {
    fetchDraftLifecycle,
    failDraftLifecycleCrystallization,
    repairDraftLifecycleCrystallizationEvidence,
} from '@/lib/api/draftWorkingCopy';
import { uploadFinalDraftDocument } from '@/lib/api/crystallization';
import { sanitizeCrystalReferenceMarkersForDisplay } from '@/lib/crystal/referenceMarkerText';
import { useI18n } from '@/i18n/useI18n';
import { useAlchemeSDK } from './useAlchemeSDK';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';

type NoticeType = 'success' | 'error';

interface CrystallizeNotice {
    type: NoticeType;
    text: string;
}

export interface CrystallizeDraftResult {
    circleId: number;
    storageUri: string;
    knowledgePda: string;
    knowledgeTxSignature: string;
    contributorsTxSignature: string;
    indexed: boolean;
}

interface UseCrystallizeDraftOptions {
    draftPostId: number | null;
    circleId: number | null;
    title: string;
    content: string;
    enabled: boolean;
    onContributionAssessmentGate?: (
        assessment: DraftContributionAssessmentResponse,
    ) => Promise<ContributionAssessmentGateDecision> | ContributionAssessmentGateDecision;
}

interface CrystallizeDraftInput {
    title?: string;
    content?: string;
}

export type ContributionAssessmentGateDecision =
    | 'review_before_crystallize'
    | null;

const KNOWLEDGE_TITLE_MAX_BYTES = 128;
const KNOWLEDGE_DESCRIPTION_MAX_BYTES = 256;

class ContributionAssessmentGateInterrupted extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ContributionAssessmentGateInterrupted';
    }
}

class ContributionAssessmentUnavailableInterrupted extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ContributionAssessmentUnavailableInterrupted';
    }
}

function getQueryApiBaseUrl(): string {
    const graphqlEndpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://127.0.0.1:4000/graphql';
    try {
        return new URL(graphqlEndpoint).origin;
    } catch {
        return 'http://127.0.0.1:4000';
    }
}

function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function clampUtf8ToByteLimit(value: string, maxBytes: number): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';

    let result = '';
    let usedBytes = 0;
    const encoder = new TextEncoder();
    for (const char of trimmed) {
        const nextBytes = encoder.encode(char).byteLength;
        if (usedBytes + nextBytes > maxBytes) break;
        result += char;
        usedBytes += nextBytes;
    }
    return result;
}

export function buildCrystallizedDraftDocument(input: {
    draftPostId: number;
    title: string;
    content: string;
}): string {
    return JSON.stringify({
        version: 1,
        kind: 'alcheme.draft.crystallization',
        draftPostId: input.draftPostId,
        title: input.title.trim(),
        content: input.content.trim(),
    });
}

export function buildKnowledgeDescription(content: string, fallbackTitle: string): string {
    const normalized = collapseWhitespace(sanitizeCrystalReferenceMarkersForDisplay(content));
    if (!normalized) return clampUtf8ToByteLimit(fallbackTitle, KNOWLEDGE_DESCRIPTION_MAX_BYTES);
    return clampUtf8ToByteLimit(normalized, KNOWLEDGE_DESCRIPTION_MAX_BYTES);
}

export function buildKnowledgeTitle(title: string): string {
    return clampUtf8ToByteLimit(title, KNOWLEDGE_TITLE_MAX_BYTES);
}

type CrystallizationDiagnosticCode =
    | 'draft_anchor_not_final'
    | 'draft_anchor_unverifiable'
    | 'contribution_sync_required'
    | 'proof_binding_required'
    | 'knowledge_circle_mismatch'
    | 'crystallization_attempt_conflict';

const STRICT_DIAGNOSTIC_KEYS: Record<CrystallizationDiagnosticCode, string> = {
    draft_anchor_not_final: 'crystallization.errors.diagnostics.draftAnchorNotFinal',
    draft_anchor_unverifiable: 'crystallization.errors.diagnostics.draftAnchorUnverifiable',
    contribution_sync_required: 'crystallization.errors.diagnostics.contributionSyncRequired',
    proof_binding_required: 'crystallization.errors.diagnostics.proofBindingRequired',
    knowledge_circle_mismatch: 'crystallization.errors.diagnostics.knowledgeCircleMismatch',
    crystallization_attempt_conflict: 'crystallization.errors.diagnostics.crystallizationAttemptConflict',
};

type CrystallizeDraftTranslator = ReturnType<typeof useI18n>;

function createCrystallizationError(code: CrystallizationDiagnosticCode, message: string): Error & {
    code: CrystallizationDiagnosticCode;
} {
    const error = new Error(message) as Error & { code: CrystallizationDiagnosticCode };
    error.code = code;
    return error;
}

function resolveErrorCode(error: unknown): CrystallizationDiagnosticCode | null {
    if (error && typeof error === 'object') {
        const code = (error as { code?: unknown }).code;
        if (
            code === 'draft_anchor_not_final'
            || code === 'draft_anchor_unverifiable'
            || code === 'contribution_sync_required'
            || code === 'proof_binding_required'
            || code === 'knowledge_circle_mismatch'
            || code === 'crystallization_attempt_conflict'
        ) {
            return code;
        }
    }
    const message = error instanceof Error ? error.message : String(error || '');
    if (message === 'draft_anchor_not_final') return 'draft_anchor_not_final';
    if (message === 'draft_anchor_unverifiable') return 'draft_anchor_unverifiable';
    if (message === 'contribution_sync_required') return 'contribution_sync_required';
    if (message === 'proof_binding_required') return 'proof_binding_required';
    if (message === 'knowledge_circle_mismatch') return 'knowledge_circle_mismatch';
    if (message === 'crystallization_attempt_conflict') return 'crystallization_attempt_conflict';
    return null;
}

function shouldRepairCrystallizationEvidence(error: unknown): boolean {
    const code = resolveErrorCode(error);
    const rawCode = (
        error && typeof error === 'object'
            ? (error as { code?: unknown }).code
            : null
    );
    return code === 'draft_anchor_not_final'
        || code === 'draft_anchor_unverifiable'
        || rawCode === 'draft_anchor_not_found'
        || rawCode === 'draft_anchor_snapshot_mismatch';
}

function resolveStrictErrorMessage(error: unknown, fallback: string, t: CrystallizeDraftTranslator): {
    code: CrystallizationDiagnosticCode | 'unknown';
    message: string;
} {
    const code = resolveErrorCode(error);
    const originalMessage = error instanceof Error ? error.message.trim() : '';
    if (code) {
        return {
            code,
            message: t(STRICT_DIAGNOSTIC_KEYS[code]),
        };
    }
    return {
        code: 'unknown',
        message: originalMessage || fallback,
    };
}

async function sha256Hex(input: string): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw new Error('SHA-256 is not available in this browser environment');
    }
    const bytes = new TextEncoder().encode(input);
    const payload = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(payload).set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function extractIpfsCid(uri: string): string | null {
    const normalized = uri.trim();
    if (!normalized.startsWith('ipfs://')) return null;
    const cid = normalized.slice('ipfs://'.length).trim();
    return cid || null;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function isMissingKnowledgeAccountError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
    return message.includes('account does not exist')
        || message.includes('could not find account')
        || message.includes('account not found');
}

function normalizeOnChainContentHash(value: unknown): string {
    if (Array.isArray(value) || value instanceof Uint8Array) {
        return Array.from(value as ArrayLike<number>)
            .map((byte) => Number(byte).toString(16).padStart(2, '0'))
            .join('');
    }
    return '';
}

function assertExistingKnowledgeMatches(input: {
    account: any;
    circleId: number;
    ipfsCid: string;
    contentHash: string;
    title: string;
    description: string;
    authorPubkey: string;
}): void {
    const account = input.account || {};
    if (
        Number(account.circleId) !== input.circleId
        || String(account.ipfsCid || '') !== input.ipfsCid
        || normalizeOnChainContentHash(account.contentHash) !== input.contentHash
        || String(account.title || '') !== input.title
        || String(account.description || '') !== input.description
        || String(account.author?.toBase58?.() || account.author || '') !== input.authorPubkey
    ) {
        throw createCrystallizationError(
            'crystallization_attempt_conflict',
            'existing Knowledge account does not match the authorized publication snapshot',
        );
    }
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryCrystallizationBinding(
    errorCode: string,
    errorMessage: string,
    errorDetails?: unknown,
): boolean {
    if (
        errorCode === 'knowledge_not_indexed'
        || errorCode === 'knowledge_not_found'
        || errorCode === 'knowledge_not_bound'
        || errorCode === 'contribution_sync_required'
    ) {
        return true;
    }

    const detailSourceCode = (
        errorDetails
        && typeof errorDetails === 'object'
        && !Array.isArray(errorDetails)
        && 'sourceCode' in (errorDetails as Record<string, unknown>)
    )
        ? String((errorDetails as Record<string, unknown>).sourceCode || '')
        : '';
    if (
        detailSourceCode === 'knowledge_not_indexed'
        || detailSourceCode === 'knowledge_not_found'
        || detailSourceCode === 'knowledge_not_bound'
    ) {
        return true;
    }

    const normalizedMessage = String(errorMessage || '').toLowerCase();
    if (
        normalizedMessage.includes('knowledge_not_indexed')
        || normalizedMessage.includes('knowledge_not_found')
        || normalizedMessage.includes('knowledge_not_bound')
        || normalizedMessage.includes('contribution_sync_required')
    ) {
        return true;
    }

    if (errorCode === 'proof_binding_required' || detailSourceCode === 'proof_binding_required') {
        return normalizedMessage.includes('projection')
            || normalizedMessage.includes('indexed knowledge binding')
            || normalizedMessage.includes('source anchor')
            || normalizedMessage.includes('contributors root')
            || normalizedMessage.includes('contributors count');
    }

    return false;
}

async function bindCrystallizedKnowledge(input: {
    draftPostId: number;
    knowledgePda: string;
    proofPackageHash: string;
    sourceAnchorId: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    generatedAt: string;
    issuerKeyId: string;
    issuedSignature: string;
    proofPackage: Record<string, unknown>;
    attempts: number;
}): Promise<void> {
    for (let attempt = 0; attempt < input.attempts; attempt += 1) {
        try {
            await submitDraftCrystallizationBinding({
                draftPostId: input.draftPostId,
                knowledgePda: input.knowledgePda,
                proofPackageHash: input.proofPackageHash,
                sourceAnchorId: input.sourceAnchorId,
                contributorsRoot: input.contributorsRoot,
                contributorsCount: input.contributorsCount,
                bindingVersion: input.bindingVersion,
                generatedAt: input.generatedAt,
                issuerKeyId: input.issuerKeyId,
                issuedSignature: input.issuedSignature,
                proofPackage: input.proofPackage,
            });
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = error && typeof error === 'object'
                ? String((error as { code?: string }).code || '')
                : '';
            const details = error && typeof error === 'object'
                ? (error as { details?: unknown }).details
                : undefined;
            const canRetry = shouldRetryCrystallizationBinding(code, message, details)
                && attempt < input.attempts - 1;
            if (canRetry) {
                await sleep(1200);
                continue;
            }
            throw error;
        }
    }

    throw new Error('crystallization binding failed');
}

function shouldSubmitContributorBinding(attempt: {
    status: string;
} | null): boolean {
    if (!attempt) return true;
    return attempt.status === 'authorization_ready'
        || attempt.status === 'submitted'
        || attempt.status === 'binding_pending';
}

function isExistingKnowledgeBindingAccountError(error: unknown, expectedKnowledgeBindingPda: PublicKey): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    if (
        !normalized.includes('already in use')
        && !normalized.includes('already exists')
        && !normalized.includes('account already initialized')
    ) {
        return false;
    }
    return message.includes(expectedKnowledgeBindingPda.toBase58())
        || normalized.includes('knowledge_binding');
}

function extractWarning(input: {
    warning?: {
        code?: string;
        message?: string;
    } | null;
}): {
    code: string;
    message: string;
} | null {
    const warningCode = String(input.warning?.code || '').trim();
    const warningMessage = String(input.warning?.message || '').trim();
    if (!warningCode && !warningMessage) return null;
    return {
        code: warningCode,
        message: warningMessage,
    };
}

function resolveViolationCode(
    input: {
        warning?: {
            code?: string;
            message?: string;
        } | null;
        message?: string | null;
    },
    fallbackCode: CrystallizationDiagnosticCode,
): CrystallizationDiagnosticCode {
    const warning = extractWarning(input);
    if (warning) {
        const matchedCode = resolveErrorCode({ code: warning.code, message: warning.message });
        return matchedCode || fallbackCode;
    }
    const messageCode = resolveErrorCode({ message: input.message || '' });
    return messageCode || fallbackCode;
}

function toStrictError(
    fallbackCode: CrystallizationDiagnosticCode,
    fallbackMessage: string,
    response: {
        warning?: {
            code?: string;
            message?: string;
        } | null;
        message?: string | null;
    },
): Error & { code: CrystallizationDiagnosticCode } {
    const code = resolveViolationCode(response, fallbackCode);
    const warning = extractWarning(response);
    const message = warning?.message || String(response.message || '').trim() || fallbackMessage;
    return createCrystallizationError(code, message);
}

function assertStrictReadiness(response: {
    ready?: boolean;
    message?: string;
    warning?: {
        code?: string;
        message?: string;
    } | null;
}): void {
    if (!response.ready || extractWarning(response)) {
        throw toStrictError(
            'draft_anchor_not_final',
            'Draft is not ready for strict crystallization because its anchor is incomplete or unverifiable',
            response,
        );
    }
}

function isContributionAssessmentReviewRequiredError(error: unknown): boolean {
    const code = error && typeof error === 'object'
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'contribution_assessment_review_required') return true;
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes('contribution_assessment_review_required');
}

function isContributionAssessmentProofUnavailableError(error: unknown): boolean {
    const code = error && typeof error === 'object'
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (
        code === 'contribution_assessment_proof_unavailable'
        || code === 'contribution_assessment_unavailable'
    ) {
        return true;
    }
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes('contribution_assessment_proof_unavailable')
        || message.includes('contribution_assessment_unavailable');
}

function assertStrictContributorProof(response: {
    ok?: boolean;
    proof?: {
        circleId: number;
        rootHex: string;
        count: number;
    } | null;
    warning?: {
        code?: string;
        message?: string;
    } | null;
}): {
    circleId: number;
    rootHex: string;
    count: number;
} {
    if (!response.ok || !response.proof) {
        throw toStrictError(
            'proof_binding_required',
            'contributor proof is unavailable in strict crystallization flow',
            response as { warning?: { code?: string; message?: string } | null; message?: string | null },
        );
    }
    if (extractWarning(response)) {
        throw toStrictError(
            'proof_binding_required',
            'contributor proof has strict warning and cannot be used for crystallization',
            response as { warning?: { code?: string; message?: string } | null; message?: string | null },
        );
    }
    return response.proof;
}

function assertProofPackageReady(response: {
    root?: string;
    count?: number;
    proof_package_hash?: string;
    source_anchor_id?: string;
    binding_version?: number;
    generated_at?: string;
    issuer_key_id?: string;
    issued_signature?: string;
    proofPackage?: Record<string, unknown> | null;
    warning?: {
        code?: string;
        message?: string;
    } | null;
}): {
    root: string;
    count: number;
    proofPackageHash: string;
    sourceAnchorId: string;
    bindingVersion: number;
    generatedAt: string;
    issuerKeyId: string;
    issuedSignature: string;
    proofPackage: Record<string, unknown>;
} {
    if (extractWarning(response)) {
        throw toStrictError(
            'proof_binding_required',
            'proof package is not ready for strict crystallization',
            response,
        );
    }

    const root = String(response.root || '').trim().toLowerCase();
    const count = Number(response.count || 0);
    const proofPackageHash = String(response.proof_package_hash || '').trim().toLowerCase();
    const sourceAnchorId = String(response.source_anchor_id || '').trim().toLowerCase();
    const bindingVersion = Number(response.binding_version || 0);
    const generatedAt = String(response.generated_at || '').trim();
    const issuerKeyId = String(response.issuer_key_id || '').trim();
    const issuedSignature = String(response.issued_signature || '').trim().toLowerCase();
    const proofPackage = response.proofPackage;

    if (!root || !proofPackageHash || !sourceAnchorId || !generatedAt || !issuerKeyId || !issuedSignature) {
        throw createCrystallizationError(
            'proof_binding_required',
            'proof package payload is incomplete for strict crystallization',
        );
    }
    if (!proofPackage || typeof proofPackage !== 'object' || Array.isArray(proofPackage)) {
        throw createCrystallizationError(
            'proof_binding_required',
            'proof package canonical payload is missing',
        );
    }
    if (!Number.isFinite(count) || count <= 0) {
        throw createCrystallizationError(
            'proof_binding_required',
            'proof package contributors count is invalid',
        );
    }
    if (!Number.isFinite(bindingVersion) || bindingVersion <= 0) {
        throw createCrystallizationError(
            'proof_binding_required',
            'proof package binding version is invalid',
        );
    }

    return {
        root,
        count,
        proofPackageHash,
        sourceAnchorId,
        bindingVersion,
        generatedAt,
        issuerKeyId,
        issuedSignature,
        proofPackage,
    };
}

function selectMatchingResumableCrystallizationAttempt(
    lifecycle: Awaited<ReturnType<typeof fetchDraftLifecycle>> | null,
    proofPackageHash: string,
): {
    knowledgeOnChainAddress: string;
    status: string;
} | null {
    const attempt = lifecycle?.resumableCrystallizationAttempt || null;
    if (!attempt) return null;
    if (attempt.proofPackageHash !== proofPackageHash) return null;
    if (!attempt.knowledgeOnChainAddress) return null;
    return {
        knowledgeOnChainAddress: attempt.knowledgeOnChainAddress,
        status: attempt.status,
    };
}

export function useCrystallizeDraft(options: UseCrystallizeDraftOptions) {
    const sdk = useAlchemeSDK();
    const wallet = useWallet();
    const { signMessageForAction } = useWalletActionRunner();
    const t = useI18n('CrucibleTab');
    const baseUrl = useMemo(() => getQueryApiBaseUrl(), []);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<CrystallizeNotice | null>(null);
    const [publicationLicense, setPublicationLicense] = useState<KnowledgePublicationAuthorizationResponse | null>(null);
    const [publicationLicenseLoading, setPublicationLicenseLoading] = useState(false);
    const inFlightRef = useRef<Promise<CrystallizeDraftResult | null> | null>(null);
    const noticeTimerRef = useRef<number | null>(null);

    const clearNoticeTimer = useCallback(() => {
        if (noticeTimerRef.current !== null) {
            window.clearTimeout(noticeTimerRef.current);
            noticeTimerRef.current = null;
        }
    }, []);

    const showNotice = useCallback((type: NoticeType, text: string) => {
        setNotice({ type, text });
        clearNoticeTimer();
        noticeTimerRef.current = window.setTimeout(() => {
            setNotice(null);
            noticeTimerRef.current = null;
        }, 4600);
    }, [clearNoticeTimer]);

    useEffect(() => {
        return () => {
            clearNoticeTimer();
        };
    }, [clearNoticeTimer]);

    const buildPublicationLicenseInput = useCallback(async (input: CrystallizeDraftInput = {}) => {
        const draftPostId = options.draftPostId;
        if (!draftPostId || !Number.isFinite(draftPostId)) {
            throw new Error(t('crystallization.errors.missingDraftContext'));
        }
        const title = (input.title ?? options.title).trim();
        const content = (input.content ?? options.content).trim();
        if (!title) throw new Error(t('crystallization.errors.missingTitle'));
        if (!content) throw new Error(t('crystallization.errors.missingContent'));
        const document = buildCrystallizedDraftDocument({ draftPostId, title, content });
        return {
            draftPostId,
            title: buildKnowledgeTitle(title),
            description: buildKnowledgeDescription(content, title),
            contentHash: await sha256Hex(document),
        };
    }, [options.content, options.draftPostId, options.title, t]);

    const preparePublicationLicense = useCallback(async (
        input: CrystallizeDraftInput = {},
    ): Promise<KnowledgePublicationAuthorizationResponse | null> => {
        setPublicationLicenseLoading(true);
        try {
            const publicationInput = await buildPublicationLicenseInput(input);
            const assessment = await fetchDraftContributionAssessment({
                draftPostId: publicationInput.draftPostId,
            });
            if (!assessment.assessment?.proofPackageHash) {
                setPublicationLicense(null);
                return null;
            }
            const publication = await prepareKnowledgePublicationAuthorization(publicationInput);
            setPublicationLicense(publication);
            return publication;
        } catch (error) {
            showNotice(
                'error',
                error instanceof Error
                    ? error.message
                    : t('crystallization.publicationLicense.loadFailed'),
            );
            return null;
        } finally {
            setPublicationLicenseLoading(false);
        }
    }, [buildPublicationLicenseInput, showNotice, t]);

    const acceptPublicationLicense = useCallback(async (
        input: CrystallizeDraftInput = {},
    ): Promise<KnowledgePublicationAuthorizationResponse | null> => {
        setPublicationLicenseLoading(true);
        try {
            const publicationInput = await buildPublicationLicenseInput(input);
            let publication = await prepareKnowledgePublicationAuthorization(publicationInput);
            const acceptedActorAuthorization = Boolean(publication.actorSigningEnvelope);
            if (publication.actorSigningEnvelope) {
                if (!wallet.publicKey || !wallet.signMessage) {
                    throw new Error(t('crystallization.publicationLicense.walletRequired'));
                }
                const envelope = publication.actorSigningEnvelope;
                const signatureBytes = await signMessageForAction({
                    kind: 'crystallization',
                    source: 'knowledge_publication_license',
                    key: `knowledge-publication-license:${publicationInput.draftPostId}:${publication.authorizationDigest}`,
                    message: envelope.signedMessage,
                });
                publication = await acceptKnowledgePublicationLicense({
                    ...publicationInput,
                    signedMessage: envelope.signedMessage,
                    signature: bytesToBase64(signatureBytes),
                    nonce: envelope.nonce,
                    expiresAt: envelope.expiresAt,
                });
            }
            setPublicationLicense(publication);
            showNotice(
                'success',
                t(acceptedActorAuthorization
                    ? 'crystallization.publicationLicense.accepted'
                    : 'crystallization.publicationLicense.statusRefreshed'),
            );
            return publication;
        } catch (error) {
            showNotice(
                'error',
                error instanceof Error
                    ? error.message
                    : t('crystallization.publicationLicense.acceptFailed'),
            );
            return null;
        } finally {
            setPublicationLicenseLoading(false);
        }
    }, [buildPublicationLicenseInput, showNotice, signMessageForAction, t, wallet.publicKey, wallet.signMessage]);

    const crystallizeDraft = useCallback(async (input: CrystallizeDraftInput = {}): Promise<CrystallizeDraftResult | null> => {
        if (inFlightRef.current) return inFlightRef.current;

        const run = (async () => {
            if (!options.enabled) {
                showNotice('error', t('crystallization.errors.permission'));
                return null;
            }
            if (!sdk) {
                showNotice('error', t('crystallization.errors.walletRequired'));
                return null;
            }

            const draftPostId = options.draftPostId;
            if (!draftPostId || !Number.isFinite(draftPostId)) {
                showNotice('error', t('crystallization.errors.missingDraftContext'));
                return null;
            }

            const title = (input.title ?? options.title).trim();
            const content = (input.content ?? options.content).trim();
            if (!title) {
                showNotice('error', t('crystallization.errors.missingTitle'));
                return null;
            }
            if (!content) {
                showNotice('error', t('crystallization.errors.missingContent'));
                return null;
            }

            setLoading(true);

            try {
                const resolveContributionAssessmentGateBeforeProof = async (
                    assessment: DraftContributionAssessmentResponse,
                ) => {
                    if (assessment.gate?.state !== 'high_penetration_needs_review') return;
                    await options.onContributionAssessmentGate?.(assessment);
                    throw new ContributionAssessmentGateInterrupted(
                        t('crystallization.notices.contributionAssessmentReviewRequired'),
                    );
                };

                const loadStrictInputs = async () => {
                    const readiness = await fetchDraftPublishReadiness({
                        draftPostId,
                    });
                    assertStrictReadiness(readiness);

                    const assessment = await fetchDraftContributionAssessment({
                        draftPostId,
                    });
                    await resolveContributionAssessmentGateBeforeProof(assessment);

                    let proofResponse;
                    try {
                        proofResponse = await fetchDraftContributorProof({
                            draftPostId,
                        });
                    } catch (error) {
                        if (isContributionAssessmentProofUnavailableError(error)) {
                            throw new ContributionAssessmentUnavailableInterrupted(
                                t('crystallization.notices.contributionAssessmentUnavailable'),
                            );
                        }
                        if (!isContributionAssessmentReviewRequiredError(error)) {
                            throw error;
                        }
                        const refreshedAssessment = await fetchDraftContributionAssessment({
                            draftPostId,
                        });
                        await resolveContributionAssessmentGateBeforeProof(refreshedAssessment);
                        proofResponse = await fetchDraftContributorProof({
                            draftPostId,
                        });
                    }
                    const proof = assertStrictContributorProof(proofResponse);

                    const proofPackageResponse = await fetchDraftProofPackage({
                        draftPostId,
                    });
                    const proofPackage = assertProofPackageReady(proofPackageResponse);

                    return { proof, proofPackage };
                };
                let strictInputs;
                try {
                    strictInputs = await loadStrictInputs();
                } catch (error) {
                    if (!shouldRepairCrystallizationEvidence(error)) {
                        throw error;
                    }
                    clearNoticeTimer();
                    setNotice({
                        type: 'success',
                        text: t('crystallization.notices.evidencePreparing'),
                    });
                    await repairDraftLifecycleCrystallizationEvidence({ draftPostId });
                    showNotice('success', t('crystallization.notices.evidenceReady'));
                    return null;
                }
                const { proof, proofPackage } = strictInputs;
                const lifecycleWithAttempt = await fetchDraftLifecycle({ draftPostId }).catch(() => null);
                let resumableAttempt = selectMatchingResumableCrystallizationAttempt(
                    lifecycleWithAttempt,
                    proofPackage.proofPackageHash,
                );

                const document = buildCrystallizedDraftDocument({
                    draftPostId,
                    title,
                    content,
                });
                const contentHash = await sha256Hex(document);
                const knowledgeTitle = buildKnowledgeTitle(title);
                const knowledgeDescription = buildKnowledgeDescription(content, title);

                const publication = await acceptPublicationLicense({ title, content });
                if (!publication) return null;
                if (publication.missingContributorPubkeys.length > 0) {
                    showNotice(
                        'error',
                        t('crystallization.publicationLicense.pending', {
                            count: publication.missingContributorPubkeys.length,
                        }),
                    );
                    return null;
                }

                let knowledgePdaForBinding = resumableAttempt
                    ? new PublicKey(resumableAttempt.knowledgeOnChainAddress)
                    : await sdk.circles.predictNextKnowledgePda(proof.circleId);
                let knowledgePdaBase58 = knowledgePdaForBinding.toBase58();
                await authorizeKnowledgePublicationAttempt({
                    draftPostId,
                    title: knowledgeTitle,
                    description: knowledgeDescription,
                    contentHash,
                    knowledgePda: knowledgePdaBase58,
                });
                if (!resumableAttempt) {
                    resumableAttempt = {
                        knowledgeOnChainAddress: knowledgePdaBase58,
                        status: 'authorization_ready',
                    };
                }

                const upload = await uploadFinalDraftDocument({
                    draftPostId,
                    title,
                    document,
                });

                if (upload.circleId !== proof.circleId) {
                    throw createCrystallizationError(
                        'knowledge_circle_mismatch',
                        'draft circle mismatch between contributor proof and storage upload',
                    );
                }

                if (options.circleId && options.circleId > 0 && options.circleId !== upload.circleId) {
                    throw createCrystallizationError(
                        'knowledge_circle_mismatch',
                        'draft circle mismatch with frontend context',
                    );
                }

                if (proofPackage.root !== proof.rootHex.toLowerCase() || proofPackage.count !== proof.count) {
                    throw createCrystallizationError(
                        'proof_binding_required',
                        'proof package snapshot does not match contributor proof snapshot',
                    );
                }

                const ipfsCid = extractIpfsCid(upload.uri);
                if (!ipfsCid) {
                    throw new Error('storage bridge must return ipfs:// URI for submitKnowledge');
                }

                let knowledgeTxSignature = resumableAttempt.status === 'authorization_ready' ? '' : 'resumed';
                let contributorsTxSignature = resumableAttempt.status === 'authorization_ready' ? '' : 'resumed';
                let fullyIndexed = false;

                if (resumableAttempt.status === 'authorization_ready') {
                    let existingKnowledge: any = null;
                    try {
                        existingKnowledge = await sdk.circles.getKnowledge(knowledgePdaForBinding);
                    } catch (error) {
                        if (!isMissingKnowledgeAccountError(error)) throw error;
                    }
                    if (existingKnowledge) {
                        assertExistingKnowledgeMatches({
                            account: existingKnowledge,
                            circleId: upload.circleId,
                            ipfsCid,
                            contentHash,
                            title: knowledgeTitle,
                            description: knowledgeDescription,
                            authorPubkey: wallet.publicKey?.toBase58() || '',
                        });
                        knowledgeTxSignature = 'authoritative_readback';
                    } else {
                        knowledgeTxSignature = await sdk.circles.submitKnowledge({
                            circleId: upload.circleId,
                            knowledgePda: knowledgePdaForBinding,
                            ipfsCid,
                            contentHash,
                            title: knowledgeTitle,
                            description: knowledgeDescription,
                        });
                    }
                    const registeredAttempt = await registerDraftCrystallizationAttempt({
                        draftPostId,
                        knowledgePda: knowledgePdaBase58,
                        proofPackageHash: proofPackage.proofPackageHash,
                    });
                    const registeredKnowledgePda = registeredAttempt.attempt?.knowledgeOnChainAddress || knowledgePdaBase58;
                    if (registeredKnowledgePda !== knowledgePdaBase58) {
                        throw createCrystallizationError(
                            'crystallization_attempt_conflict',
                            'crystallization attempt already exists for a different knowledge address',
                        );
                    }
                }

                if (shouldSubmitContributorBinding(resumableAttempt)) {
                    const expectedKnowledgeBindingPda = sdk.pda.findKnowledgeBindingPda(knowledgePdaForBinding);
                    try {
                        contributorsTxSignature = await sdk.circles.bindAndUpdateContributors({
                            circleId: upload.circleId,
                            knowledgePda: knowledgePdaForBinding,
                            sourceAnchorId: proofPackage.sourceAnchorId,
                            proofPackageHash: proofPackage.proofPackageHash,
                            contributorsRoot: proofPackage.root,
                            contributorsCount: proofPackage.count,
                            bindingVersion: proofPackage.bindingVersion,
                            generatedAt: proofPackage.generatedAt,
                            issuerKeyId: proofPackage.issuerKeyId,
                            issuedSignature: proofPackage.issuedSignature,
                        });

                        const [knowledgeSlot, contributorsSlot] = await Promise.all([
                            knowledgeTxSignature === 'resumed'
                                ? Promise.resolve(null)
                                : waitForSignatureSlot(sdk.connection, knowledgeTxSignature),
                            waitForSignatureSlot(sdk.connection, contributorsTxSignature),
                        ]);

                        const targetSlot = Math.max(knowledgeSlot || 0, contributorsSlot || 0);
                        const indexWait = targetSlot > 0 ? await waitForIndexedSlot(targetSlot) : null;
                        fullyIndexed = indexWait?.ok ?? false;
                    } catch (error) {
                        if (!isExistingKnowledgeBindingAccountError(error, expectedKnowledgeBindingPda)) {
                            throw error;
                        }
                        contributorsTxSignature = 'existing_binding';
                        fullyIndexed = false;
                    }
                } else {
                    fullyIndexed = true;
                }

                await bindCrystallizedKnowledge({
                    draftPostId,
                    knowledgePda: knowledgePdaBase58,
                    proofPackageHash: proofPackage.proofPackageHash,
                    sourceAnchorId: proofPackage.sourceAnchorId,
                    contributorsRoot: proofPackage.root,
                    contributorsCount: proofPackage.count,
                    bindingVersion: proofPackage.bindingVersion,
                    generatedAt: proofPackage.generatedAt,
                    issuerKeyId: proofPackage.issuerKeyId,
                    issuedSignature: proofPackage.issuedSignature,
                    proofPackage: proofPackage.proofPackage,
                    attempts: fullyIndexed && !resumableAttempt ? 1 : 8,
                });

                showNotice(
                    'success',
                    fullyIndexed
                        ? t('crystallization.notices.successIndexed')
                        : t('crystallization.notices.successIndexPending'),
                );

                return {
                    circleId: upload.circleId,
                    storageUri: upload.uri,
                    knowledgePda: knowledgePdaBase58,
                    knowledgeTxSignature,
                    contributorsTxSignature,
                    indexed: fullyIndexed,
                };
            } catch (error) {
                if (
                    error instanceof ContributionAssessmentGateInterrupted
                    || error instanceof ContributionAssessmentUnavailableInterrupted
                    || isContributionAssessmentProofUnavailableError(error)
                ) {
                    showNotice(
                        'error',
                        error instanceof Error
                            && !isContributionAssessmentProofUnavailableError(error)
                            ? error.message
                            : t('crystallization.notices.contributionAssessmentUnavailable'),
                    );
                    return null;
                }
                if (draftPostId && Number.isFinite(draftPostId)) {
                    try {
                        await failDraftLifecycleCrystallization({ draftPostId });
                    } catch (lifecycleError) {
                        console.warn('[crystallize][fail_lifecycle_sync]', lifecycleError);
                    }
                }
                const normalized = resolveStrictErrorMessage(error, t('crystallization.errors.strictFallback'), t);
                console.warn('[crystallize][strict_failure]', {
                    draftPostId: options.draftPostId,
                    code: normalized.code,
                    message: normalized.message,
                });
                showNotice('error', normalized.message);
                return null;
            } finally {
                setLoading(false);
            }
        })();

        inFlightRef.current = run.finally(() => {
            inFlightRef.current = null;
        });
        return inFlightRef.current;
    }, [
        baseUrl,
        clearNoticeTimer,
        options.onContributionAssessmentGate,
        options.circleId,
        options.content,
        options.draftPostId,
        options.enabled,
        options.title,
        acceptPublicationLicense,
        sdk,
        showNotice,
        t,
    ]);

    return {
        crystallizeDraft,
        loading,
        notice,
        publicationLicense,
        publicationLicenseLoading,
        preparePublicationLicense,
        acceptPublicationLicense,
    };
}
