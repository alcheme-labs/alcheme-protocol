'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import { fetchDiscussionMessages, type DiscussionMessageDto } from '@/lib/discussion/api';
import {
    fetchDiscussionAnalysisDiagnostics,
    fetchDiscussionSummaryDiagnostics,
    fetchDiscussionTriggerDiagnostics,
    reanalyzeDiscussionMessage,
    type DiscussionAnalysisDiagnosticsResponse,
    type DiscussionSummaryDiagnosticsResponse,
    type DiscussionTriggerDiagnosticsResponse,
} from '@/lib/admin/discussionDiagnosticsClient';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';

type AnalysisDiagnostics = DiscussionAnalysisDiagnosticsResponse['diagnostics'];
type SummaryDiagnostics = DiscussionSummaryDiagnosticsResponse['diagnostics'];
type TriggerDiagnostics = DiscussionTriggerDiagnosticsResponse['diagnostics'];
type RecentMessage = Pick<
    DiscussionMessageDto,
    'envelopeId' | 'senderHandle' | 'senderPubkey' | 'text' | 'createdAt' | 'deleted' | 'focusLabel'
>;

type MetricTone = 'default' | 'good' | 'warn' | 'bad';

function toHumanReadableDiagnosticsError(raw: string, translate: (key: string) => string): string {
    const normalized = String(raw || '').trim();
    switch (normalized) {
    case 'authentication_required':
        return translate('errors.authentication_required');
    case 'private_sidecar_required':
        return translate('errors.private_sidecar_required');
    case 'discussion_message_not_found':
        return translate('errors.discussion_message_not_found');
    case 'discussion_trigger_not_found':
        return translate('errors.discussion_trigger_not_found');
    case 'discussion_analysis_diagnostics_failed':
        return translate('errors.discussion_analysis_diagnostics_failed');
    case 'discussion_summary_diagnostics_failed':
        return translate('errors.discussion_summary_diagnostics_failed');
    case 'discussion_trigger_diagnostics_failed':
        return translate('errors.discussion_trigger_diagnostics_failed');
    case 'discussion_analysis_reanalyze_failed':
        return translate('errors.discussion_analysis_reanalyze_failed');
    default:
        return normalized;
    }
}

function MetricCard(props: { label: string; value: string; tone?: MetricTone }) {
    const tones = {
        default: { border: '#e5e7eb', background: '#fff', color: '#111827' },
        good: { border: '#86efac', background: '#f0fdf4', color: '#166534' },
        warn: { border: '#fcd34d', background: '#fffbeb', color: '#92400e' },
        bad: { border: '#fca5a5', background: '#fef2f2', color: '#b91c1c' },
    } as const;
    const tone = tones[props.tone || 'default'];
    return (
        <div
            style={{
                display: 'grid',
                gap: 6,
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${tone.border}`,
                background: tone.background,
            }}
        >
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>{props.label}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: tone.color }}>{props.value}</span>
        </div>
    );
}

function ScopeBadge(props: { scope: string }) {
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                borderRadius: 999,
                background: '#eff6ff',
                color: '#1d4ed8',
                fontSize: 12,
                fontWeight: 700,
            }}
        >
            {props.scope}
        </span>
    );
}

function JsonLikeBlock(props: { title: string; value: unknown }) {
    const rendered = typeof props.value === 'string'
        ? props.value
        : JSON.stringify(props.value, null, 2);
    return (
        <section
            style={{
                display: 'grid',
                gap: 8,
                padding: 14,
                borderRadius: 14,
                border: '1px solid #e5e7eb',
                background: '#fff',
            }}
        >
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{props.title}</h3>
            <pre
                style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 12,
                    color: '#374151',
                }}
            >
                {rendered}
            </pre>
        </section>
    );
}

function CapabilitySection(props: {
    title: string;
    scope: string;
    metrics?: Array<{ label: string; value: string; tone?: MetricTone }>;
    input: unknown;
    runtime: unknown;
    output: unknown;
    decision: unknown;
    failure: unknown;
    rawJsonTitle?: string;
    rawJson?: unknown;
}) {
    const t = useI18n('DiscussionDiagnosticsPage');
    return (
        <section
            style={{
                display: 'grid',
                gap: 14,
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 16,
                background: '#f9fafb',
            }}
        >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{props.title}</h2>
                <ScopeBadge scope={props.scope} />
            </div>

            {props.metrics && props.metrics.length > 0 ? (
                <div
                    style={{
                        display: 'grid',
                        gap: 12,
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    }}
                >
                    {props.metrics.map((metric) => (
                        <MetricCard
                            key={`${props.title}-${metric.label}`}
                            label={metric.label}
                            value={metric.value}
                            tone={metric.tone}
                        />
                    ))}
                </div>
            ) : null}

            <div
                style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
            >
                <JsonLikeBlock title={t('blocks.input')} value={props.input} />
                <JsonLikeBlock title={t('blocks.runtime')} value={props.runtime} />
                <JsonLikeBlock title={t('blocks.output')} value={props.output} />
                <JsonLikeBlock title={t('blocks.decision')} value={props.decision} />
                <JsonLikeBlock title={t('blocks.failure')} value={props.failure} />
            </div>

            {props.rawJsonTitle && props.rawJson !== undefined ? (
                <details>
                    <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{props.rawJsonTitle}</summary>
                    <pre
                        style={{
                            margin: '12px 0 0',
                            padding: 12,
                            borderRadius: 12,
                            background: '#111827',
                            color: '#e5e7eb',
                            overflowX: 'auto',
                            fontSize: 12,
                        }}
                    >
                        {JSON.stringify(props.rawJson, null, 2)}
                    </pre>
                </details>
            ) : null}
        </section>
    );
}

function buildFailureObject(message: string | null) {
    return message
        ? { status: 'error', message }
        : { status: 'none', message: null };
}

export default function DiscussionDiagnosticsPage() {
    const t = useI18n('DiscussionDiagnosticsPage');
    const locale = useCurrentLocale();
    const [circleId, setCircleId] = useState('');
    const [envelopeId, setEnvelopeId] = useState('');
    const [analysisDiagnostics, setAnalysisDiagnostics] = useState<AnalysisDiagnostics | null>(null);
    const [summaryDiagnostics, setSummaryDiagnostics] = useState<SummaryDiagnostics | null>(null);
    const [triggerDiagnostics, setTriggerDiagnostics] = useState<TriggerDiagnostics | null>(null);
    const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [triggerError, setTriggerError] = useState<string | null>(null);
    const [lastReplayJob, setLastReplayJob] = useState<{ jobId: number; status: string } | null>(null);
    const [isPending, startTransition] = useTransition();
    const [isReanalyzing, startReanalyzeTransition] = useTransition();
    const [isLoadingMessages, startLoadMessagesTransition] = useTransition();
    const selectionRequestIdRef = useRef(0);
    const recentMessagesRequestIdRef = useRef(0);

    const hasCircleId = Number.isFinite(Number(circleId.trim())) && Number(circleId.trim()) > 0;
    const hasEnvelopeId = envelopeId.trim().length > 0;

    const keySignals = useMemo(() => {
        if (!analysisDiagnostics) return null;
        const status = analysisDiagnostics.analysis.relevanceStatus;
        const error = analysisDiagnostics.analysis.analysisErrorMessage || 'none';
        return {
            status,
            statusTone:
                status === 'ready'
                    ? 'good'
                    : status === 'failed'
                        ? 'bad'
                        : status === 'stale'
                            ? 'warn'
                            : 'default',
            actualMode: analysisDiagnostics.analysis.actualMode || 'unknown',
            focusLabel: analysisDiagnostics.analysis.focusLabel || 'unlabeled',
            semanticScore:
                analysisDiagnostics.analysis.semanticScore === null
                    ? 'n/a'
                    : analysisDiagnostics.analysis.semanticScore.toFixed(3),
            embeddingScore:
                analysisDiagnostics.analysis.embeddingScore === null
                    ? 'n/a'
                    : analysisDiagnostics.analysis.embeddingScore.toFixed(3),
            featured: analysisDiagnostics.analysis.isFeatured
                ? `yes${analysisDiagnostics.analysis.featureReason ? ` · ${analysisDiagnostics.analysis.featureReason}` : ''}`
                : 'no',
            error,
        };
    }, [analysisDiagnostics]);

    const analysisMetrics = useMemo<Array<{ label: string; value: string; tone?: MetricTone }>>(
        () =>
            keySignals
                ? [
                    {
                        label: t('metrics.status'),
                        value: keySignals.status,
                        tone: keySignals.statusTone as MetricTone,
                    },
                    { label: t('metrics.actualMode'), value: keySignals.actualMode },
                    { label: t('metrics.focusLabel'), value: keySignals.focusLabel },
                    { label: t('metrics.semanticScore'), value: keySignals.semanticScore },
                    { label: t('metrics.embedding'), value: keySignals.embeddingScore },
                    { label: t('metrics.featured'), value: keySignals.featured },
                ]
                : [],
        [keySignals, t],
    );

    const summaryMetrics = useMemo<Array<{ label: string; value: string; tone?: MetricTone }>>(
        () =>
            summaryDiagnostics
                ? [
                    {
                        label: t('summary.metrics.method'),
                        value: summaryDiagnostics.runtime.method,
                        tone: summaryDiagnostics.runtime.method === 'llm' ? 'good' : 'default',
                    },
                    {
                        label: t('summary.metrics.cache'),
                        value: summaryDiagnostics.runtime.fromCache ? t('summary.cacheHit') : t('summary.cacheMiss'),
                        tone: summaryDiagnostics.runtime.fromCache ? 'warn' : 'default',
                    },
                    {
                        label: t('summary.metrics.inputFidelity'),
                        value: summaryDiagnostics.input.inputFidelity,
                        tone: summaryDiagnostics.input.inputFidelity === 'exact_cached_window' ? 'good' : 'warn',
                    },
                    {
                        label: t('summary.metrics.model'),
                        value: summaryDiagnostics.runtime.generationMetadata?.model || t('summary.ruleBased'),
                    },
                ]
                : [],
        [summaryDiagnostics, t],
    );

    const triggerMetrics = useMemo<Array<{ label: string; value: string; tone?: MetricTone }>>(
        () =>
            triggerDiagnostics
                ? [
                    {
                        label: t('trigger.metrics.status'),
                        value: triggerDiagnostics.output.status,
                        tone:
                            triggerDiagnostics.output.status === 'triggered'
                                ? 'good'
                                : triggerDiagnostics.output.status === 'error'
                                    ? 'bad'
                                    : 'warn',
                    },
                    { label: t('trigger.metrics.reason'), value: triggerDiagnostics.output.reason },
                    {
                        label: t('trigger.metrics.summaryMethod'),
                        value: triggerDiagnostics.runtime.summaryMethod || 'n/a',
                    },
                    {
                        label: t('trigger.metrics.messageCount'),
                        value: String(triggerDiagnostics.input.messageCount ?? 0),
                    },
                ]
                : [],
        [triggerDiagnostics, t],
    );

    function resetCapabilityState() {
        setAnalysisDiagnostics(null);
        setSummaryDiagnostics(null);
        setTriggerDiagnostics(null);
        setAnalysisError(null);
        setSummaryError(null);
        setTriggerError(null);
    }

    function loadCapabilitySections(nextCircleId: number, requestId: number) {
        void Promise.allSettled([
            fetchDiscussionSummaryDiagnostics(nextCircleId),
            fetchDiscussionTriggerDiagnostics(nextCircleId),
        ]).then(([summaryResult, triggerResult]) => {
            if (requestId !== selectionRequestIdRef.current) return;

            if (summaryResult.status === 'fulfilled') {
                setSummaryDiagnostics(summaryResult.value);
                setSummaryError(null);
            } else {
                setSummaryDiagnostics(null);
                setSummaryError(
                    toHumanReadableDiagnosticsError(
                        summaryResult.reason instanceof Error
                            ? summaryResult.reason.message
                            : String(summaryResult.reason),
                        t,
                    ),
                );
            }

            if (triggerResult.status === 'fulfilled') {
                setTriggerDiagnostics(triggerResult.value);
                setTriggerError(null);
            } else {
                setTriggerDiagnostics(null);
                setTriggerError(
                    toHumanReadableDiagnosticsError(
                        triggerResult.reason instanceof Error
                            ? triggerResult.reason.message
                            : String(triggerResult.reason),
                        t,
                    ),
                );
            }
        });
    }

    function handleLoad(nextEnvelopeId?: string) {
        const targetEnvelopeId = String(nextEnvelopeId ?? envelopeId).trim();
        if (!targetEnvelopeId) return;
        startTransition(() => {
            const requestId = ++selectionRequestIdRef.current;
            resetCapabilityState();
            setLastReplayJob(null);
            setEnvelopeId(targetEnvelopeId);
            void fetchDiscussionAnalysisDiagnostics(targetEnvelopeId)
                .then((next) => {
                    if (requestId !== selectionRequestIdRef.current) return;
                    setAnalysisDiagnostics(next);
                    setAnalysisError(null);
                    setCircleId(String(next.circleId));
                    loadCapabilitySections(next.circleId, requestId);
                })
                .catch((nextError) => {
                    if (requestId !== selectionRequestIdRef.current) return;
                    setAnalysisDiagnostics(null);
                    setAnalysisError(
                        toHumanReadableDiagnosticsError(
                            nextError instanceof Error ? nextError.message : String(nextError),
                            t,
                        ),
                    );
                });
        });
    }

    function handleLoadRecentMessages() {
        const normalizedCircleId = Number(circleId.trim());
        if (!Number.isFinite(normalizedCircleId) || normalizedCircleId <= 0) {
            setAnalysisError(t('errors.invalidCircleId'));
            return;
        }

        startLoadMessagesTransition(() => {
            const requestId = ++recentMessagesRequestIdRef.current;
            selectionRequestIdRef.current += 1;
            resetCapabilityState();
            void fetchDiscussionMessages({
                circleId: normalizedCircleId,
                limit: 20,
                includeDeleted: true,
            })
                .then((response) => {
                    if (requestId !== recentMessagesRequestIdRef.current) return;
                    const nextMessages = response.messages.slice().reverse();
                    setRecentMessages(nextMessages);
                    if (nextMessages.length > 0) {
                        handleLoad(nextMessages[0].envelopeId);
                    } else {
                        setEnvelopeId('');
                    }
                })
                .catch((nextError) => {
                    if (requestId !== recentMessagesRequestIdRef.current) return;
                    setRecentMessages([]);
                    setAnalysisError(
                        toHumanReadableDiagnosticsError(
                            nextError instanceof Error ? nextError.message : String(nextError),
                            t,
                        ),
                    );
                });
        });
    }

    function handleReanalyze() {
        startReanalyzeTransition(() => {
            setAnalysisError(null);
            void reanalyzeDiscussionMessage(envelopeId)
                .then((job) => {
                    setLastReplayJob(job);
                })
                .catch((nextError) => {
                    setLastReplayJob(null);
                    setAnalysisError(
                        toHumanReadableDiagnosticsError(
                            nextError instanceof Error ? nextError.message : String(nextError),
                            t,
                        ),
                    );
                });
        });
    }

    return (
        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '40px 24px 80px', display: 'grid', gap: 24 }}>
            <header style={{ display: 'grid', gap: 8 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('title')}</h1>
                <p style={{ margin: 0, color: '#6b7280' }}>
                    {t('subtitle')}
                </p>
            </header>

            <section style={{ display: 'grid', gap: 12, padding: 16, border: '1px solid #e5e7eb', borderRadius: 16 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t('controls.circleId')}</span>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <input
                            value={circleId}
                            onChange={(event) => setCircleId(event.target.value)}
                            placeholder={t('controls.circlePlaceholder')}
                            style={{
                                flex: '1 1 260px',
                                padding: '12px 14px',
                                borderRadius: 12,
                                border: '1px solid #d1d5db',
                                fontSize: 14,
                            }}
                        />
                        <button
                            type="button"
                            onClick={handleLoadRecentMessages}
                            disabled={!hasCircleId || isLoadingMessages}
                            style={{
                                padding: '10px 14px',
                                borderRadius: 12,
                                border: '1px solid #d1d5db',
                                background: '#fff',
                                color: '#111827',
                                cursor: hasCircleId ? 'pointer' : 'not-allowed',
                            }}
                        >
                            {isLoadingMessages ? t('actions.loadingMessages') : t('actions.loadRecentMessages')}
                        </button>
                    </div>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t('controls.envelopeId')}</span>
                    <input
                        value={envelopeId}
                        onChange={(event) => setEnvelopeId(event.target.value)}
                        placeholder={t('controls.envelopePlaceholder')}
                        style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: 12,
                            border: '1px solid #d1d5db',
                            fontSize: 14,
                        }}
                    />
                </label>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        onClick={() => handleLoad()}
                        disabled={!hasEnvelopeId || isPending}
                        style={{
                            padding: '10px 14px',
                            borderRadius: 12,
                            border: 'none',
                            background: '#111827',
                            color: '#fff',
                            cursor: hasEnvelopeId ? 'pointer' : 'not-allowed',
                        }}
                    >
                        {isPending ? t('actions.loadingAnalysis') : t('actions.loadAnalysis')}
                    </button>
                    <button
                        type="button"
                        onClick={handleReanalyze}
                        disabled={!hasEnvelopeId || isReanalyzing}
                        style={{
                            padding: '10px 14px',
                            borderRadius: 12,
                            border: '1px solid #d1d5db',
                            background: '#fff',
                            color: '#111827',
                            cursor: hasEnvelopeId ? 'pointer' : 'not-allowed',
                        }}
                    >
                        {isReanalyzing ? t('actions.reanalyzing') : t('actions.reanalyze')}
                    </button>
                </div>

                {analysisError ? (
                    <p style={{ margin: 0, color: '#b91c1c', fontSize: 14 }}>{analysisError}</p>
                ) : null}
                {lastReplayJob ? (
                    <p style={{ margin: 0, color: '#065f46', fontSize: 14 }}>
                        {t('status.reanalyzeQueued', {jobId: lastReplayJob.jobId, status: lastReplayJob.status})}
                    </p>
                ) : null}

                {analysisDiagnostics ? (
                    <section
                        style={{
                            display: 'grid',
                            gap: 8,
                            padding: 14,
                            borderRadius: 14,
                            border: '1px solid #d1d5db',
                            background: '#f9fafb',
                        }}
                    >
                        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t('sample.title')}</h2>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#4b5563' }}>
                            <span>circle {analysisDiagnostics.circleId}</span>
                            <span>{analysisDiagnostics.senderHandle || analysisDiagnostics.senderPubkey}</span>
                            <span>{new Date(analysisDiagnostics.createdAt).toLocaleString(locale)}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 14, color: '#111827' }}>{analysisDiagnostics.payloadText || t('sample.emptyMessage')}</p>
                        <code style={{ fontSize: 11, color: '#6b7280' }}>{analysisDiagnostics.envelopeId}</code>
                    </section>
                ) : null}
            </section>

            {recentMessages.length > 0 ? (
                <section style={{ display: 'grid', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t('recentMessages.title')}</h2>
                    <div style={{ display: 'grid', gap: 8 }}>
                        {recentMessages.map((message) => {
                            const preview = message.text.trim().slice(0, 140) || t('sample.emptyMessage');
                            const selected = envelopeId.trim() === message.envelopeId;
                            return (
                                <button
                                    key={message.envelopeId}
                                    type="button"
                                    onClick={() => handleLoad(message.envelopeId)}
                                    style={{
                                        display: 'grid',
                                        gap: 6,
                                        textAlign: 'left',
                                        padding: 12,
                                        borderRadius: 12,
                                        border: selected ? '2px solid #2563eb' : '1px solid #e5e7eb',
                                        background: selected ? '#eff6ff' : '#fff',
                                        boxShadow: selected ? '0 0 0 1px rgba(37,99,235,0.08)' : 'none',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#4b5563' }}>
                                        <span>{message.senderHandle || message.senderPubkey}</span>
                                        <span>{new Date(message.createdAt).toLocaleString(locale)}</span>
                                        <span>{message.focusLabel || 'unlabeled'}</span>
                                        {selected ? <span style={{ color: '#2563eb', fontWeight: 700 }}>{t('sample.currentBadge')}</span> : null}
                                        {message.deleted ? <span style={{ color: '#b91c1c' }}>{t('recentMessages.deleted')}</span> : null}
                                    </div>
                                    <div style={{ fontSize: 13, color: '#111827' }}>{preview}</div>
                                    <code style={{ fontSize: 11, color: '#6b7280' }}>{message.envelopeId}</code>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {analysisDiagnostics ? (
                <section style={{ display: 'grid', gap: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t('keyDiagnosticsTitle')}</h2>
                    <div
                        style={{
                            display: 'grid',
                            gap: 12,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        }}
                    >
                        {analysisMetrics.map((metric) => (
                            <MetricCard
                                key={`key-${metric.label}`}
                                label={metric.label}
                                value={metric.value}
                                tone={metric.tone}
                            />
                        ))}
                    </div>
                </section>
            ) : null}

            {analysisDiagnostics ? (
                <CapabilitySection
                    title={t('sections.analysis.title')}
                    scope={t('sections.analysis.scope')}
                    metrics={analysisMetrics}
                    input={{
                        envelopeId: analysisDiagnostics.envelopeId,
                        payloadText: analysisDiagnostics.payloadText,
                        authorAnnotations: analysisDiagnostics.analysis.authorAnnotations,
                        topicProfileVersion: analysisDiagnostics.analysis.topicProfileVersion,
                        currentTopicProfileVersion: analysisDiagnostics.topicProfile.currentVersion,
                    }}
                    runtime={{
                        actualMode: analysisDiagnostics.analysis.actualMode,
                        relevanceMethod: analysisDiagnostics.analysis.relevanceMethod,
                        analysisVersion: analysisDiagnostics.analysis.analysisVersion,
                        analysisCompletedAt: analysisDiagnostics.analysis.analysisCompletedAt,
                        topicProfileLabel: t('analysis.topicProfileLabel'),
                        topicProfile: {
                            isStale: analysisDiagnostics.topicProfile.isStale,
                            embeddingAvailable: analysisDiagnostics.topicProfile.embeddingAvailable,
                            embeddingModel: analysisDiagnostics.topicProfile.embeddingModel,
                            embeddingProviderMode: analysisDiagnostics.topicProfile.embeddingProviderMode,
                        },
                    }}
                    output={{
                        semanticScore: analysisDiagnostics.analysis.semanticScore,
                        embeddingScore: analysisDiagnostics.analysis.embeddingScore,
                        qualityScore: analysisDiagnostics.analysis.qualityScore,
                        spamScore: analysisDiagnostics.analysis.spamScore,
                        decisionConfidence: analysisDiagnostics.analysis.decisionConfidence,
                        semanticFacets: analysisDiagnostics.analysis.semanticFacets,
                        focusScore: analysisDiagnostics.analysis.focusScore,
                        focusLabel: analysisDiagnostics.analysis.focusLabel,
                        isFeatured: analysisDiagnostics.analysis.isFeatured,
                        featureReason: analysisDiagnostics.analysis.featureReason,
                    }}
                    decision={{
                        why:
                            analysisDiagnostics.analysis.focusLabel === 'off_topic'
                                ? t('analysis.decision.offTopic')
                                : analysisDiagnostics.analysis.focusLabel === 'focused'
                                    ? t('analysis.decision.focused')
                                    : t('analysis.decision.contextual'),
                        topicProfileSnapshot: analysisDiagnostics.topicProfile.snapshotText,
                        errorLabel: t('analysis.errorLabel'),
                    }}
                    failure={buildFailureObject(analysisDiagnostics.analysis.analysisErrorMessage)}
                    rawJsonTitle={t('analysis.rawJsonTitle')}
                    rawJson={analysisDiagnostics}
                />
            ) : null}

            <CapabilitySection
                title={t('sections.summary.title')}
                scope={t('sections.summary.scope')}
                metrics={summaryMetrics}
                input={
                    summaryDiagnostics
                        ? summaryDiagnostics.input
                        : { status: 'unavailable', note: t('summary.notLoaded') }
                }
                runtime={
                    summaryDiagnostics
                        ? summaryDiagnostics.runtime
                        : { status: 'unavailable' }
                }
                output={
                    summaryDiagnostics
                        ? summaryDiagnostics.output
                        : { status: 'unavailable' }
                }
                decision={
                    summaryDiagnostics
                        ? {
                            method: summaryDiagnostics.runtime.method,
                            cacheMeaning: summaryDiagnostics.runtime.fromCache
                                ? t('summary.decision.cacheHit')
                                : t('summary.decision.cacheMiss'),
                            configMeaning:
                                summaryDiagnostics.input.summaryUseLLM === summaryDiagnostics.input.currentSummaryUseLLM
                                    ? t('summary.decision.currentConfig', {source: summaryDiagnostics.input.configSource})
                                    : t('summary.decision.cachedVsCurrentConfig', {
                                        cachedSource: summaryDiagnostics.input.configSource,
                                        currentSource: summaryDiagnostics.input.currentConfigSource,
                                    }),
                            fidelityMeaning:
                                summaryDiagnostics.input.inputFidelity === 'exact_cached_window'
                                    ? t('summary.decision.exactFidelity')
                                    : t('summary.decision.metadataOnlyFidelity'),
                            fallbackReason: summaryDiagnostics.runtime.fallback?.reason ?? null,
                            rawFinishReason: summaryDiagnostics.runtime.fallback?.rawFinishReason ?? null,
                            rawResponseSnippet: summaryDiagnostics.runtime.fallback?.rawResponseSnippet ?? null,
                        }
                        : { status: 'not_loaded' }
                }
                failure={buildFailureObject(summaryError || summaryDiagnostics?.failure.message || null)}
                rawJsonTitle={t('summary.rawJsonTitle')}
                rawJson={summaryDiagnostics}
            />

            <CapabilitySection
                title={t('sections.trigger.title')}
                scope={t('sections.trigger.scope')}
                metrics={triggerMetrics}
                input={
                    triggerDiagnostics
                        ? triggerDiagnostics.input
                        : { status: 'unavailable', note: t('trigger.notLoaded') }
                }
                runtime={
                    triggerDiagnostics
                        ? triggerDiagnostics.runtime
                        : { status: 'unavailable' }
                }
                output={
                    triggerDiagnostics
                        ? triggerDiagnostics.output
                        : { status: 'unavailable' }
                }
                decision={
                    triggerDiagnostics
                        ? {
                            reason: triggerDiagnostics.output.reason,
                            scopeNotice:
                                t('trigger.decision.scopeNotice'),
                            selectedEnvelopeInWindow:
                                triggerDiagnostics.input.windowEnvelopeIds.includes(envelopeId.trim()),
                        }
                        : { status: 'not_loaded' }
                }
                failure={buildFailureObject(triggerError || triggerDiagnostics?.failure.message || null)}
                rawJsonTitle={t('trigger.rawJsonTitle')}
                rawJson={triggerDiagnostics}
            />

            <CapabilitySection
                title={t('sections.ghostDraft.title')}
                scope={t('sections.ghostDraft.scope')}
                input={{ status: 'pending', note: t('ghostDraft.notConnected') }}
                runtime={{ status: 'pending' }}
                output={{ status: 'pending' }}
                decision={{ status: 'pending' }}
                failure={{ status: 'not_connected', message: t('ghostDraft.failure') }}
            />

            <CapabilitySection
                title={t('sections.humanOverrides.title')}
                scope={t('sections.humanOverrides.scope')}
                input={{ status: 'pending', note: t('humanOverrides.notConnected') }}
                runtime={{ status: 'pending' }}
                output={{ status: 'pending' }}
                decision={{
                    currentRule: t('humanOverrides.currentRule'),
                }}
                failure={{ status: 'not_connected', message: t('humanOverrides.failure') }}
            />
        </main>
    );
}
