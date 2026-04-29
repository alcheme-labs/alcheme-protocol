'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import {
    fetchDraftContributorProof,
    fetchDraftProofPackage,
    fetchDraftPublishReadiness,
    registerDraftCrystallizationAttempt,
    submitDraftCrystallizationBinding,
} from '@/lib/api/discussion';
import {
    fetchDraftLifecycle,
    failDraftLifecycleCrystallization,
    repairDraftLifecycleCrystallizationEvidence,
} from '@/lib/api/draftWorkingCopy';
import { uploadFinalDraftDocument } from '@/lib/api/crystallization';
import { sanitizeCrystalReferenceMarkersForDisplay } from '@/lib/crystal/referenceMarkerText';
import { useAlchemeSDK } from './useAlchemeSDK';

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
}

const KNOWLEDGE_TITLE_MAX_BYTES = 128;
const KNOWLEDGE_DESCRIPTION_MAX_BYTES = 256;

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

const STRICT_DIAGNOSTIC_COPY: Record<CrystallizationDiagnosticCode, string> = {
    draft_anchor_not_final: '草稿锚定尚未完成，暂不可结晶。',
    draft_anchor_unverifiable: '草稿锚定证明不可验证，暂不可结晶。',
    contribution_sync_required: '贡献快照尚未同步，请稍后重试。',
    proof_binding_required: '贡献证明包未就绪，无法执行结晶绑定。',
    knowledge_circle_mismatch: '草稿与知识圈层不一致，已阻断本次结晶。',
    crystallization_attempt_conflict: '检测到已有结晶恢复记录，请重新执行以恢复同一个链上知识。',
};

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

function resolveStrictErrorMessage(error: unknown, fallback: string): {
    code: CrystallizationDiagnosticCode | 'unknown';
    message: string;
} {
    const code = resolveErrorCode(error);
    const originalMessage = error instanceof Error ? error.message.trim() : '';
    if (code) {
        return {
            code,
            message: STRICT_DIAGNOSTIC_COPY[code],
        };
    }
    return {
        code: 'unknown',
        message: originalMessage || fallback,
    };
}

async function sha256Hex(input: string): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw new Error('当前环境不支持 SHA-256 计算');
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
            '草稿尚未满足 strict 结晶条件（锚定未完成或不可验证）',
            response,
        );
    }
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
    const baseUrl = useMemo(() => getQueryApiBaseUrl(), []);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<CrystallizeNotice | null>(null);
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

    const crystallizeDraft = useCallback(async (): Promise<CrystallizeDraftResult | null> => {
        if (inFlightRef.current) return inFlightRef.current;

        const run = (async () => {
            if (!options.enabled) {
                showNotice('error', '当前身份无法发起结晶。');
                return null;
            }
            if (!sdk) {
                showNotice('error', '请先连接钱包。');
                return null;
            }

            const draftPostId = options.draftPostId;
            if (!draftPostId || !Number.isFinite(draftPostId)) {
                showNotice('error', '缺少草稿上下文，无法发起结晶。');
                return null;
            }

            const title = options.title.trim();
            const content = options.content.trim();
            if (!title) {
                showNotice('error', '草稿标题为空，无法发起结晶。');
                return null;
            }
            if (!content) {
                showNotice('error', '草稿正文为空，无法发起结晶。');
                return null;
            }

            setLoading(true);

            try {
                const loadStrictInputs = async () => {
                    const readiness = await fetchDraftPublishReadiness({
                        draftPostId,
                    });
                    assertStrictReadiness(readiness);

                    const proofResponse = await fetchDraftContributorProof({
                        draftPostId,
                    });
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
                        text: '正在准备草稿协作证据…',
                    });
                    await repairDraftLifecycleCrystallizationEvidence({ draftPostId });
                    showNotice('success', '草稿协作证据已准备好，请再次运行结晶。');
                    return null;
                }
                const { proof, proofPackage } = strictInputs;
                const lifecycleWithAttempt = await fetchDraftLifecycle({ draftPostId }).catch(() => null);
                const resumableAttempt = selectMatchingResumableCrystallizationAttempt(
                    lifecycleWithAttempt,
                    proofPackage.proofPackageHash,
                );

                const document = buildCrystallizedDraftDocument({
                    draftPostId,
                    title,
                    content,
                });
                const contentHash = await sha256Hex(document);

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

                let knowledgePdaBase58 = resumableAttempt?.knowledgeOnChainAddress || '';
                let knowledgeTxSignature = resumableAttempt ? 'resumed' : '';
                let contributorsTxSignature = resumableAttempt ? 'resumed' : '';
                let fullyIndexed = false;

                if (!resumableAttempt) {
                    const knowledgePda = await sdk.circles.predictNextKnowledgePda(upload.circleId);
                    knowledgePdaBase58 = knowledgePda.toBase58();
                    knowledgeTxSignature = await sdk.circles.submitKnowledge({
                        circleId: upload.circleId,
                        knowledgePda,
                        ipfsCid,
                        contentHash,
                        title: buildKnowledgeTitle(title),
                        description: buildKnowledgeDescription(content, title),
                    });

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

                    contributorsTxSignature = await sdk.circles.bindAndUpdateContributors({
                        circleId: upload.circleId,
                        knowledgePda,
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
                        waitForSignatureSlot(sdk.connection, knowledgeTxSignature),
                        waitForSignatureSlot(sdk.connection, contributorsTxSignature),
                    ]);

                    const targetSlot = Math.max(knowledgeSlot || 0, contributorsSlot || 0);
                    const indexWait = targetSlot > 0 ? await waitForIndexedSlot(targetSlot) : null;
                    fullyIndexed = indexWait?.ok ?? false;
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
                        ? '链上绑定 + contributors 更新均成功。'
                        : '链上绑定 + contributors 更新已完成，索引同步稍后完成。',
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
                if (draftPostId && Number.isFinite(draftPostId)) {
                    try {
                        await failDraftLifecycleCrystallization({ draftPostId });
                    } catch (lifecycleError) {
                        console.warn('[crystallize][fail_lifecycle_sync]', lifecycleError);
                    }
                }
                const normalized = resolveStrictErrorMessage(error, '结晶失败，请稍后重试。');
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
        options.circleId,
        options.content,
        options.draftPostId,
        options.enabled,
        options.title,
        sdk,
        showNotice,
    ]);

    return {
        crystallizeDraft,
        loading,
        notice,
    };
}
