'use client';

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import {
    getNeutralEvaluation,
    listNeutralEvaluations,
    publishNeutralEvaluation,
    requestNeutralEvaluation,
    retractNeutralEvaluation,
    submitNeutralEvaluationAppeal,
    submitNeutralEvaluationReview,
    type NeutralEvaluationArtifactView,
    type NeutralEvaluationSubjectType,
} from '@/lib/api/neutralEvaluation';
import type { NodeRoutingSurface } from '@/lib/api/nodeRouting';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import { EvaluationPanel } from './EvaluationPanel';
import styles from './NeutralEvaluationWorkspacePanel.module.css';

export interface NeutralEvaluationWorkspacePanelProps {
    circleId: number;
    subjectType: NeutralEvaluationSubjectType;
    subjectId: string | number | null | undefined;
    locale?: string;
    compact?: boolean;
    title?: string;
}

const PENDING_POLL_INTERVAL_MS = 1400;
const MAX_PENDING_POLL_ATTEMPTS = 12;

function normalizeSubjectId(value: string | number | null | undefined): string {
    return String(value ?? '').trim();
}

function resolvePrivateEvaluationSurface(subjectType: NeutralEvaluationSubjectType): NodeRoutingSurface | null {
    if (subjectType === 'draft_post') return 'ghost_draft_private';
    if (subjectType === 'source_material') return 'source_materials';
    return null;
}

function formatEvaluationError(
    error: unknown,
    fallback: string,
    labels: { privateSidecarRequired: string; surfaceUnavailable: string },
): string {
    return formatNodeRoutingError(error, fallback, labels);
}

export default function NeutralEvaluationWorkspacePanel({
    circleId,
    subjectType,
    subjectId,
    locale = 'en',
    compact = false,
    title,
}: NeutralEvaluationWorkspacePanelProps) {
    const t = useI18n('NeutralEvaluation');
    const normalizedSubjectId = normalizeSubjectId(subjectId);
    const [artifact, setArtifact] = useState<NeutralEvaluationArtifactView | null>(null);
    const [busy, setBusy] = useState(false);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const contextKey = `${circleId}:${subjectType}:${normalizedSubjectId}`;
    const contextKeyRef = useRef(contextKey);
    const privateEvaluationSurface = resolvePrivateEvaluationSurface(subjectType);
    const routingErrorLabels = {
        privateSidecarRequired: t('errors.privateSidecarRequired'),
        surfaceUnavailable: t('errors.surfaceUnavailable'),
    };

    const refreshLatest = async () => {
        if (!circleId || !normalizedSubjectId) return;
        const refreshKey = contextKey;
        setBusy(true);
        try {
            const rows = await listNeutralEvaluations({
                circleId,
                subjectType,
                subjectId: normalizedSubjectId,
                limit: 1,
            });
            if (contextKeyRef.current !== refreshKey) return;
            setArtifact(rows[0] ?? null);
            setErrorMessage(null);
        } catch (error) {
            setErrorMessage(formatEvaluationError(error, t('errors.load'), routingErrorLabels));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        contextKeyRef.current = contextKey;
        setArtifact(null);
        setErrorMessage(null);
        void refreshLatest();
    }, [contextKey]);

    useEffect(() => {
        if (!artifact?.id || artifact.status !== 'pending') return undefined;
        let cancelled = false;
        const pendingId = artifact.id;
        const pendingKey = contextKey;

        const pollPending = async () => {
            for (let attempt = 0; attempt < MAX_PENDING_POLL_ATTEMPTS; attempt += 1) {
                await new Promise((resolve) => {
                    window.setTimeout(resolve, PENDING_POLL_INTERVAL_MS);
                });
                if (cancelled || contextKeyRef.current !== pendingKey) return;
                try {
                    const next = await getNeutralEvaluation(pendingId, { surface: privateEvaluationSurface });
                    if (cancelled || contextKeyRef.current !== pendingKey) return;
                    setArtifact(next);
                    setErrorMessage(null);
                    if (next.status !== 'pending') return;
                } catch (error) {
                    if (cancelled || contextKeyRef.current !== pendingKey) return;
                    setErrorMessage(formatEvaluationError(error, t('errors.load'), routingErrorLabels));
                    return;
                }
            }
        };

        void pollPending();
        return () => {
            cancelled = true;
        };
    }, [artifact?.id, artifact?.status, contextKey, privateEvaluationSurface]);

    const handleRequest = async () => {
        if (!circleId || !normalizedSubjectId || busy) return;
        setBusy(true);
        setErrorMessage(null);
        try {
            const response = await requestNeutralEvaluation({
                circleId,
                subjectType,
                subjectId: normalizedSubjectId,
                locale,
            });
            if (response.artifact) {
                setArtifact(response.artifact);
                return;
            }
            if (response.artifactId) {
                setArtifact({
                    id: response.artifactId,
                    circleId,
                    subjectType,
                    subjectId: normalizedSubjectId,
                    status: response.status === 'queued' ? 'pending' : response.status,
                    visibility: 'private',
                    reviewStatus: 'unreviewed',
                    appealStatus: 'none',
                    summary: '',
                    claims: [],
                    evidenceSummary: [],
                    evidenceRefs: [],
                    assumptions: [],
                    evidenceGaps: [],
                    counterpoints: [],
                    verifiableNextSteps: [],
                    neutralWordingSuggestion: '',
                    confidence: 'low',
                    limitations: [],
                    sourceDigest: '',
                    aiJobId: response.jobId ?? null,
                });
            }
        } catch (error) {
            setErrorMessage(formatEvaluationError(error, t('errors.request'), routingErrorLabels));
        } finally {
            setBusy(false);
        }
    };

    const runArtifactMutation = async (
        label: string,
        fn: (artifactId: string) => Promise<NeutralEvaluationArtifactView | void>,
    ) => {
        if (!artifact?.id || pendingAction) return;
        setPendingAction(label);
        setErrorMessage(null);
        try {
            const next = await fn(artifact.id);
            if (next) setArtifact(next);
            else await refreshLatest();
        } catch (error) {
            setErrorMessage(formatEvaluationError(error, t('errors.update'), routingErrorLabels));
        } finally {
            setPendingAction(null);
        }
    };

    if (!circleId || !normalizedSubjectId) return null;

    return (
        <div className={compact ? styles.compact : styles.wrapper} data-title={title || undefined}>
            <EvaluationPanel
                artifact={artifact}
                busy={busy}
                pendingAction={pendingAction}
                errorMessage={errorMessage}
                onRequest={handleRequest}
                onRefresh={() => { void refreshLatest(); }}
                onPublish={() => {
                    void runArtifactMutation('publish', (artifactId) =>
                        publishNeutralEvaluation({
                            artifactId,
                            confirmationText: 'publish evaluation',
                            surface: privateEvaluationSurface,
                        }),
                    );
                }}
                onRetract={() => {
                    void runArtifactMutation('retract', (artifactId) =>
                        retractNeutralEvaluation({
                            artifactId,
                            reason: 'retracted from evaluation panel',
                            surface: privateEvaluationSurface,
                        }),
                    );
                }}
                onAppeal={() => {
                    const appealText = window.prompt(t('prompts.appeal'))?.trim();
                    if (!appealText) return;
                    void runArtifactMutation('appeal', async (artifactId) => {
                        await submitNeutralEvaluationAppeal({ artifactId, appealText, surface: privateEvaluationSurface });
                    });
                }}
                onReview={() => {
                    void runArtifactMutation('review', async (artifactId) => {
                        await submitNeutralEvaluationReview({
                            artifactId,
                            reviewStatus: 'reviewed',
                            surface: privateEvaluationSurface,
                        });
                    });
                }}
            />
        </div>
    );
}
