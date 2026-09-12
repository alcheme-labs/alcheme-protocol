'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSearch, Quote, RefreshCw, Search, X } from 'lucide-react';

import {
    getSourceGroundedAnswer,
    listSourceGroundedAnswers,
    requestSourceGroundedAsk,
    resolveSourceGroundedAskSurface,
    type SourceGroundedAnswerView,
    type SourceGroundedAskScope,
    type SourceGroundedCitationView,
} from '@/lib/api/sourceGroundedAsk';
import type { NodeRoutingSurface } from '@/lib/api/nodeRouting';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './SourceGroundedAskPanel.module.css';

export interface SourceGroundedAskPanelProps {
    circleId: number;
    draftPostId?: number | null;
    title?: string;
    description?: string;
    locale?: string;
    compact?: boolean;
    initialQuestion?: string;
    placeholder?: string;
    showRefresh?: boolean;
    scopeLabel?: string;
    askLabel?: string;
    askingLabel?: string;
    refreshLabel?: string;
    refreshingLabel?: string;
    closeLabel?: string;
    onClose?: () => void;
    scopeLabels?: Partial<Record<SourceGroundedAskScope, string>>;
    defaultScopes?: SourceGroundedAskScope[];
    availableScopes?: SourceGroundedAskScope[];
}

const SCOPE_LABELS: Record<SourceGroundedAskScope, string> = {
    current_circle: 'Circle',
    current_draft: 'Draft',
    source_materials: 'Source materials',
    formal_references: 'Formal refs',
    trend_receipts: 'Trend receipts',
};
const DEFAULT_ACTIVE_SCOPES: SourceGroundedAskScope[] = ['current_circle'];
const DEFAULT_AVAILABLE_SCOPES: SourceGroundedAskScope[] = ['current_circle', 'formal_references', 'trend_receipts', 'source_materials'];
const PENDING_POLL_INTERVAL_MS = 1200;
const MAX_PENDING_POLL_ATTEMPTS = 10;
const POLL_FAILED_CODE = 'source_grounded_ask_poll_failed';
const POLL_TIMEOUT_CODE = 'source_grounded_ask_poll_timeout';

function joinClassNames(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
}

function formatDate(value: string | null | undefined, locale: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function normalizeInitialScopes(
    availableScopes: SourceGroundedAskScope[],
    defaultScopes: SourceGroundedAskScope[],
    draftPostId: number | null | undefined,
): SourceGroundedAskScope[] {
    const enabled = availableScopes.filter((scope) => scope !== 'current_draft' || Boolean(draftPostId));
    const defaults = defaultScopes.filter((scope) => enabled.includes(scope));
    return defaults.length > 0 ? defaults : enabled.slice(0, 1);
}

export default function SourceGroundedAskPanel({
    circleId,
    draftPostId = null,
    title = 'Ask sources',
    description = 'Evidence and references',
    locale = 'en',
    compact = false,
    initialQuestion = '',
    placeholder = 'Ask a source-grounded question',
    showRefresh = true,
    scopeLabel = 'Source scopes',
    askLabel = 'Ask',
    askingLabel = 'Asking',
    refreshLabel = 'Refresh',
    refreshingLabel = 'Refreshing',
    closeLabel = 'Close',
    onClose,
    scopeLabels,
    defaultScopes = DEFAULT_ACTIVE_SCOPES,
    availableScopes = DEFAULT_AVAILABLE_SCOPES,
}: SourceGroundedAskPanelProps) {
    const [question, setQuestion] = useState(initialQuestion);
    const [activeScopes, setActiveScopes] = useState<SourceGroundedAskScope[]>(
        () => normalizeInitialScopes(availableScopes, defaultScopes, draftPostId),
    );
    const [answer, setAnswer] = useState<SourceGroundedAnswerView | null>(null);
    const [answerReadSurface, setAnswerReadSurface] = useState<NodeRoutingSurface | null>(null);
    const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const defaultScopeKey = defaultScopes.join('|');
    const availableScopeKey = availableScopes.join('|');
    const contextKey = `${circleId}:${draftPostId ?? 'circle'}`;
    const contextKeyRef = useRef(contextKey);
    const selectedAskSurface = resolveSourceGroundedAskSurface({
        draftPostId,
        scopes: activeScopes,
    });

    useEffect(() => {
        contextKeyRef.current = contextKey;
        setActiveScopes(normalizeInitialScopes(availableScopes, defaultScopes, draftPostId));
        setQuestion(initialQuestion);
        setAnswer(null);
        setAnswerReadSurface(null);
        setSelectedCitationId(null);
        setErrorMessage(null);
    }, [availableScopeKey, contextKey, defaultScopeKey, draftPostId, initialQuestion]);

    useEffect(() => {
        if (!answer?.id || answer.status !== 'pending') return undefined;
        let cancelled = false;
        const pendingAnswerId = answer.id;
        const pendingContextKey = contextKey;
        const pendingReadSurface = answerReadSurface ?? selectedAskSurface;

        const failPendingAnswer = (failureCode: string, message: string) => {
            setAnswer((current) => {
                if (!current || current.id !== pendingAnswerId || current.status !== 'pending') {
                    return current;
                }
                return {
                    ...current,
                    status: 'failed',
                    failureCode,
                    answerText: message,
                    limitations: [...current.limitations, message],
                };
            });
            setErrorMessage(message);
        };

        const pollQueuedAnswer = async () => {
            for (let attempt = 0; attempt < MAX_PENDING_POLL_ATTEMPTS; attempt += 1) {
                await new Promise((resolve) => {
                    window.setTimeout(resolve, PENDING_POLL_INTERVAL_MS);
                });
                if (cancelled || contextKeyRef.current !== pendingContextKey) return;
                try {
                    const next = await getSourceGroundedAnswer(pendingAnswerId, { surface: pendingReadSurface });
                    if (cancelled || contextKeyRef.current !== pendingContextKey) return;
                    setAnswer(next);
                    setSelectedCitationId(next.citations[0]?.refId ?? null);
                    setErrorMessage(null);
                    if (next.status !== 'pending') return;
                } catch (error) {
                    if (cancelled || contextKeyRef.current !== pendingContextKey) return;
                    failPendingAnswer(POLL_FAILED_CODE, formatNodeRoutingError(
                        error,
                        'Unable to load the prepared answer. Try asking again.',
                        {
                            privateSidecarRequired: 'Private source answers require a private sidecar node.',
                            surfaceUnavailable: 'This source answer route is not available from the connected node.',
                        },
                    ));
                    return;
                }
            }
            if (cancelled || contextKeyRef.current !== pendingContextKey) return;
            failPendingAnswer(POLL_TIMEOUT_CODE, 'The answer is still preparing. Try asking again in a moment.');
        };

        void pollQueuedAnswer();
        return () => {
            cancelled = true;
        };
    }, [answer?.id, answer?.status, answerReadSurface, contextKey, selectedAskSurface]);

    const selectedCitation = useMemo(
        () => answer?.citations.find((citation) => citation.refId === selectedCitationId) ?? answer?.citations[0] ?? null,
        [answer?.citations, selectedCitationId],
    );
    const shouldRenderHeaderActions = showRefresh || Boolean(onClose);

    const refreshLatestAnswer = async () => {
        if (!circleId) return;
        const refreshContextKey = contextKey;
        setIsRefreshing(true);
        const refreshSurface = answerReadSurface ?? selectedAskSurface;
        try {
            const rows = await listSourceGroundedAnswers({
                circleId,
                draftPostId: draftPostId ?? null,
                limit: 1,
                surface: refreshSurface,
            });
            if (contextKeyRef.current !== refreshContextKey) return;
            if (rows[0]) {
                setAnswer(rows[0]);
                setAnswerReadSurface(refreshSurface);
                setSelectedCitationId(rows[0].citations[0]?.refId ?? null);
            }
            setErrorMessage(null);
        } catch (error) {
            setErrorMessage(formatNodeRoutingError(error, 'Unable to load answer.', {
                privateSidecarRequired: 'Private source answers require a private sidecar node.',
                surfaceUnavailable: 'This source answer route is not available from the connected node.',
            }));
        } finally {
            setIsRefreshing(false);
        }
    };

    const toggleScope = (scope: SourceGroundedAskScope) => {
        if (scope === 'current_draft' && !draftPostId) return;
        setActiveScopes((current) => {
            if (current.includes(scope)) {
                const next = current.filter((item) => item !== scope);
                return next.length > 0 ? next : current;
            }
            return [...current, scope];
        });
    };

    const handleSubmit = async () => {
        const trimmedQuestion = question.trim();
        if (!trimmedQuestion || !circleId || isSubmitting) return;
        setIsSubmitting(true);
        setErrorMessage(null);
        const requestSurface = resolveSourceGroundedAskSurface({
            draftPostId: draftPostId ?? null,
            scopes: activeScopes,
        });
        try {
            const response = await requestSourceGroundedAsk({
                circleId,
                draftPostId: draftPostId ?? null,
                question: trimmedQuestion,
                scopes: activeScopes,
                locale,
            });
            setAnswerReadSurface(requestSurface);
            if (response.answer) {
                setAnswer(response.answer);
                setSelectedCitationId(response.answer.citations[0]?.refId ?? null);
                return;
            }
            if (response.answerId) {
                const pending: SourceGroundedAnswerView = {
                    id: response.answerId,
                    circleId,
                    draftPostId: draftPostId ?? null,
                    question: trimmedQuestion,
                    locale,
                    status: response.status === 'queued' ? 'pending' : response.status,
                    answerText: '',
                    limitations: [],
                    citations: [],
                    evidenceRefs: [],
                    sourceDigest: '',
                    aiJobId: response.jobId ?? null,
                };
                setAnswer(pending);
            }
        } catch (error) {
            setErrorMessage(formatNodeRoutingError(error, 'Unable to ask sources.', {
                privateSidecarRequired: 'Private source answers require a private sidecar node.',
                surfaceUnavailable: 'This source answer route is not available from the connected node.',
            }));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!circleId) return null;

    return (
        <section className={joinClassNames(styles.panel, compact && styles.compact)} aria-label={title}>
            <div className={styles.header}>
                <div className={styles.titleBlock}>
                    <span className={styles.icon} aria-hidden="true">
                        <FileSearch size={16} />
                    </span>
                    <div>
                        <h3 className={styles.title}>{title}</h3>
                        {description ? <p className={styles.description}>{description}</p> : null}
                    </div>
                </div>
                {shouldRenderHeaderActions ? (
                    <div className={styles.headerActions}>
                        {showRefresh ? (
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={refreshLatestAnswer}
                                disabled={isRefreshing}
                            >
                                <RefreshCw size={14} />
                                <span>{isRefreshing ? refreshingLabel : refreshLabel}</span>
                            </button>
                        ) : null}
                        {onClose ? (
                            <button
                                type="button"
                                className={styles.iconButton}
                                aria-label={closeLabel}
                                onClick={onClose}
                            >
                                <X size={14} />
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className={styles.askForm}>
                <textarea
                    className={styles.textarea}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={placeholder}
                    disabled={isSubmitting}
                />
                <div className={styles.scopeGrid} aria-label={scopeLabel}>
                    {availableScopes.map((scope) => {
                        const disabled = scope === 'current_draft' && !draftPostId;
                        return (
                            <label
                                key={scope}
                                className={joinClassNames(styles.scopeOption, disabled && styles.scopeOptionDisabled)}
                            >
                                <input
                                    type="checkbox"
                                    checked={activeScopes.includes(scope)}
                                    disabled={disabled || isSubmitting}
                                    onChange={() => toggleScope(scope)}
                                />
                                <span>{scopeLabels?.[scope] ?? SCOPE_LABELS[scope]}</span>
                            </label>
                        );
                    })}
                </div>
                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleSubmit}
                    disabled={isSubmitting || !question.trim() || activeScopes.length === 0}
                >
                    <Search size={14} />
                    <span>{isSubmitting ? askingLabel : askLabel}</span>
                </button>
                    {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
                </div>
            </div>

            {answer ? (
                <EvidenceAnswerCard
                    answer={answer}
                    locale={locale}
                    selectedCitation={selectedCitation}
                    onSelectCitation={setSelectedCitationId}
                />
            ) : null}
        </section>
    );
}

function EvidenceAnswerCard({
    answer,
    locale,
    selectedCitation,
    onSelectCitation,
}: {
    answer: SourceGroundedAnswerView;
    locale: string;
    selectedCitation: SourceGroundedCitationView | null;
    onSelectCitation(refId: string): void;
}) {
    const isPending = answer.status === 'pending';
    const isNoSource = answer.status === 'no_source';
    const answerText = isPending
        ? 'Answer is being prepared from accessible sources.'
        : isNoSource
            ? (answer.answerText || 'No available source was found for this question.')
            : answer.answerText;

    return (
        <article className={styles.answerCard}>
            <div className={styles.badges}>
                <span className={styles.badge}>{answer.status}</span>
                {answer.failureCode ? (
                    <span className={styles.staleBadge}>
                        <AlertTriangle size={12} />
                        {answer.failureCode}
                    </span>
                ) : null}
            </div>
            <p className={styles.answerText}>{answerText}</p>
            {answer.limitations.length > 0 ? (
                <div>
                    {answer.limitations.map((item) => (
                        <p key={item} className={styles.limitation}>{item}</p>
                    ))}
                </div>
            ) : null}
            {answer.citations.length > 0 ? (
                <>
                    <div className={styles.citationList} aria-label="Citations">
                        {answer.citations.map((citation) => (
                            <button
                                key={citation.refId}
                                type="button"
                                className={styles.citationButton}
                                onClick={() => onSelectCitation(citation.refId)}
                            >
                                <Quote size={13} />
                                <span>{citation.title}</span>
                                {citation.stale ? <span className={styles.staleBadge}>stale</span> : null}
                            </button>
                        ))}
                    </div>
                    {selectedCitation ? (
                        <CitationDrawer citation={selectedCitation} locale={locale} />
                    ) : null}
                </>
            ) : null}
        </article>
    );
}

function CitationDrawer({
    citation,
    locale,
}: {
    citation: SourceGroundedCitationView;
    locale: string;
}) {
    return (
        <div className={styles.citationDrawer}>
            <div className={styles.badges}>
                <span className={styles.badge}>{citation.sourceType}</span>
                <span className={styles.badge}>{citation.visibility}</span>
                {citation.stale ? <span className={styles.staleBadge}>stale</span> : null}
            </div>
            <p className={styles.citationTitle}>{citation.title}</p>
            <p className={styles.citationMeta}>
                {citation.locator?.type || 'locator'}: {citation.locator?.ref || citation.sourceId}
            </p>
            {citation.capturedAt ? (
                <p className={styles.citationMeta}>Captured: {formatDate(citation.capturedAt, locale)}</p>
            ) : null}
            {citation.fetchedAt ? (
                <p className={styles.citationMeta}>Fetched: {formatDate(citation.fetchedAt, locale)}</p>
            ) : null}
            {citation.expiresAt ? (
                <p className={styles.citationMeta}>Expires: {formatDate(citation.expiresAt, locale)}</p>
            ) : null}
            {citation.note ? <p className={styles.meta}>{citation.note}</p> : null}
        </div>
    );
}
