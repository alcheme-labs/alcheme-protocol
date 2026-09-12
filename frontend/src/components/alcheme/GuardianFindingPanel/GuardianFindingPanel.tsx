'use client';

import { Bell, Check, Clock3, Inbox, RefreshCw, ShieldAlert, X } from 'lucide-react';

import type {
    GuardianFindingLevel,
    GuardianFindingStatus,
    GuardianFindingView,
} from '@/lib/api/guardianFindings';
import styles from './GuardianFindingPanel.module.css';

export interface GuardianFindingPanelProps {
    title: string;
    description?: string;
    circleId: number;
    canManage: boolean;
    locale: string;
    findings: GuardianFindingView[];
    isLoading?: boolean;
    isDiagnosing?: boolean;
    errorMessage?: string | null;
    activeStatus?: GuardianFindingStatus | 'all';
    activeLevel?: GuardianFindingLevel | 'all';
    focusedFindingId?: string | null;
    labels: {
        diagnose: string;
        refresh: string;
        loading: string;
        empty: string;
        ack: string;
        dismiss: string;
        snooze: string;
        convert: string;
        evidence: string;
        notificationError: string;
        cooldown: string;
        status: Record<GuardianFindingStatus | 'all', string>;
        level: Record<GuardianFindingLevel | 'all', string>;
        risk: Record<'low' | 'medium' | 'high', string>;
        severity: Record<'info' | 'low' | 'medium' | 'high', string>;
    };
    onDiagnose(): void;
    onRefresh(): void;
    onFilterStatus?(status: GuardianFindingStatus | 'all'): void;
    onFilterLevel?(level: GuardianFindingLevel | 'all'): void;
    onAck(findingId: string): void;
    onDismiss(findingId: string, reason: string): void;
    onSnooze(findingId: string, snoozeUntil: string): void;
    onConvert(findingId: string): void;
}

const STATUS_FILTERS: Array<GuardianFindingStatus | 'all'> = ['all', 'open', 'acknowledged', 'snoozed', 'dismissed', 'converted'];
const LEVEL_FILTERS: Array<GuardianFindingLevel | 'all'> = ['all', 'observe', 'notify', 'propose'];

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

function defaultDismissReason(finding: GuardianFindingView): string {
    return `Dismissed ${finding.findingKind}`;
}

function defaultSnoozeUntil(): string {
    return new Date(Date.now() + 72 * 3_600_000).toISOString();
}

export default function GuardianFindingPanel({
    title,
    description,
    circleId,
    canManage,
    locale,
    findings,
    isLoading = false,
    isDiagnosing = false,
    errorMessage = null,
    activeStatus = 'all',
    activeLevel = 'all',
    focusedFindingId = null,
    labels,
    onDiagnose,
    onRefresh,
    onFilterStatus,
    onFilterLevel,
    onAck,
    onDismiss,
    onSnooze,
    onConvert,
}: GuardianFindingPanelProps) {
    if (!canManage || !circleId) return null;

    const focusedId = String(focusedFindingId || '').trim();
    const visibleFindings = findings.filter((finding) =>
        finding.id === focusedId
        || (
            (activeStatus === 'all' || finding.status === activeStatus)
            && (activeLevel === 'all' || finding.level === activeLevel)
        ),
    );

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div className={styles.titleBlock}>
                    <span className={styles.icon} aria-hidden="true">
                        <Inbox size={16} />
                    </span>
                    <div>
                        <h3 className={styles.title}>{title}</h3>
                        {description ? <p className={styles.description}>{description}</p> : null}
                    </div>
                </div>
                <div className={styles.headerActions}>
                    <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={isLoading}>
                        <RefreshCw size={14} />
                        <span>{labels.refresh}</span>
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={onDiagnose} disabled={isDiagnosing || isLoading}>
                        <ShieldAlert size={14} />
                        <span>{isDiagnosing ? labels.loading : labels.diagnose}</span>
                    </button>
                </div>
            </div>

            <div className={styles.filters} aria-label={labels.status.all}>
                {STATUS_FILTERS.map((status) => (
                    <button
                        key={status}
                        type="button"
                        className={joinClassNames(styles.filterButton, activeStatus === status && styles.filterButtonActive)}
                        onClick={() => onFilterStatus?.(status)}
                    >
                        {labels.status[status]}
                    </button>
                ))}
            </div>

            <div className={styles.filters} aria-label={labels.level.all}>
                {LEVEL_FILTERS.map((level) => (
                    <button
                        key={level}
                        type="button"
                        className={joinClassNames(styles.filterButton, activeLevel === level && styles.filterButtonActive)}
                        onClick={() => onFilterLevel?.(level)}
                    >
                        {labels.level[level]}
                    </button>
                ))}
            </div>

            <div role="status" aria-live="polite">
                {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
                {!errorMessage && isLoading ? <p className={styles.notice}>{labels.loading}</p> : null}
                {!errorMessage && !isLoading && visibleFindings.length === 0 ? <p className={styles.notice}>{labels.empty}</p> : null}
            </div>

            {visibleFindings.length > 0 ? (
                <div className={styles.list}>
                    {visibleFindings.map((finding) => {
                        const isFocused = finding.id === focusedId;
                        return (
                            <article
                                key={finding.id}
                                className={joinClassNames(styles.finding, isFocused && styles.findingFocused)}
                                aria-current={isFocused ? 'true' : undefined}
                            >
                                <div className={styles.findingTopline}>
                                    <div>
                                        <h4 className={styles.findingTitle}>{finding.title}</h4>
                                        <p className={styles.description}>{finding.summary}</p>
                                    </div>
                                    <div className={styles.badges}>
                                        <span className={styles.badge}>{labels.level[finding.level]}</span>
                                        <span className={styles.badge}>{labels.risk[finding.riskLevel]}</span>
                                        <span className={styles.badge}>{labels.severity[finding.severity]}</span>
                                    </div>
                                </div>
                                {finding.explanation ? <p className={styles.reason}>{finding.explanation}</p> : null}
                                <div className={styles.metaGrid}>
                                    <span><Bell size={13} /> {labels.status[finding.status]}</span>
                                    <span><ShieldAlert size={13} /> {labels.evidence}: {finding.evidenceRefs.length}</span>
                                    {finding.cooldownUntil ? (
                                        <span><Clock3 size={13} /> {labels.cooldown}: {formatDate(finding.cooldownUntil, locale)}</span>
                                    ) : null}
                                </div>
                                {finding.notificationError ? (
                                    <p className={styles.error}>{labels.notificationError}: {finding.notificationError}</p>
                                ) : null}
                                <div className={styles.footerActions}>
                                    <button type="button" className={styles.secondaryButton} disabled={finding.status !== 'open'} onClick={() => onAck(finding.id)}>
                                        <Check size={14} />
                                        <span>{labels.ack}</span>
                                    </button>
                                    <button type="button" className={styles.secondaryButton} disabled={finding.status !== 'open'} onClick={() => onSnooze(finding.id, defaultSnoozeUntil())}>
                                        <Clock3 size={14} />
                                        <span>{labels.snooze}</span>
                                    </button>
                                    <button type="button" className={styles.secondaryButton} disabled={finding.status !== 'open'} onClick={() => onDismiss(finding.id, defaultDismissReason(finding))}>
                                        <X size={14} />
                                        <span>{labels.dismiss}</span>
                                    </button>
                                    <button type="button" className={styles.primaryButton} disabled={finding.status !== 'open' || finding.level !== 'propose'} onClick={() => onConvert(finding.id)}>
                                        <ShieldAlert size={14} />
                                        <span>{labels.convert}</span>
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : null}
        </section>
    );
}
