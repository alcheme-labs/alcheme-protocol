'use client';

import { useRef, useState } from 'react';
import { Clock3, GitBranch, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';

import type {
    CircleGrowthProposalStatus,
    CircleGrowthProposalView,
} from '@/lib/api/circleGrowthAdvisor';
import type { ConfigurationFieldChange, ConfigurationRiskLevel } from '@/lib/api/configurationCopilot';
import {
    canClearCircleGrowthProposal,
    canConvertCircleGrowthProposal,
    isCircleGrowthActionDisabled,
    type CircleGrowthPanelAction,
} from './circleGrowthAdvisorPanelState';
import styles from './CircleGrowthAdvisorPanel.module.css';

export interface CircleGrowthAdvisorPanelProps {
    title: string;
    description?: string;
    circleId: number;
    canManage: boolean;
    locale: string;
    status: 'idle' | 'loading' | 'requesting' | 'disabled' | 'error';
    proposals: CircleGrowthProposalView[];
    errorMessage?: string | null;
    disabledReason?: string | null;
    labels: {
        request: string;
        refresh: string;
        loading: string;
        empty: string;
        noSignal: string;
        failed: string;
        reject: string;
        snooze: string;
        convert: string;
        evidence: string;
        cooldown: string;
        configurationProposal: string;
        currentSignals: string;
        counterSignals: string;
        missingSignals: string;
        valueUnset: string;
        valueBooleanOn: string;
        valueBooleanOff: string;
        unavailable: string;
        requestFailed: string;
        status: Record<CircleGrowthProposalStatus, string>;
        risk: Record<ConfigurationRiskLevel, string>;
    };
    onRequest(): void;
    onRefresh(): void;
    onReject(proposalId: string, reason: string): void | Promise<void>;
    onSnooze(proposalId: string, snoozeUntil: string): void | Promise<void>;
    onConvert(proposalId: string): void | Promise<void>;
}

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

function formatValue(value: unknown, labels: {
    unset: string;
    booleanOn: string;
    booleanOff: string;
}): string {
    if (value === null || value === undefined) return labels.unset;
    if (typeof value === 'boolean') return value ? labels.booleanOn : labels.booleanOff;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value);
}

function defaultRejectReason(proposal: CircleGrowthProposalView): string {
    return `Rejected ${proposal.id}`;
}

function defaultSnoozeUntil(): string {
    return new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
}

function maxRisk(changes: ConfigurationFieldChange[]): ConfigurationRiskLevel {
    if (changes.some((change) => change.riskLevel === 'high')) return 'high';
    if (changes.some((change) => change.riskLevel === 'medium')) return 'medium';
    return 'low';
}

function signalText(signal: { label?: string; key: string; value?: unknown }): string {
    const label = signal.label || signal.key;
    if (signal.value === null || signal.value === undefined || signal.value === '') return label;
    return `${label}: ${String(signal.value)}`;
}

export default function CircleGrowthAdvisorPanel({
    title,
    description,
    circleId,
    canManage,
    locale,
    status,
    proposals,
    errorMessage = null,
    disabledReason = null,
    labels,
    onRequest,
    onRefresh,
    onReject,
    onSnooze,
    onConvert,
}: CircleGrowthAdvisorPanelProps) {
    const [pendingAction, setPendingAction] = useState<{
        proposalId: string;
        action: CircleGrowthPanelAction;
    } | null>(null);
    const pendingActionRef = useRef(false);
    if (!canManage || !circleId) return null;
    const isBusy = status === 'loading' || status === 'requesting';
    const hasPendingAction = Boolean(pendingAction);
    const visibleProposals = proposals.filter((proposal) =>
        ['ready', 'pending', 'failed', 'no_signal', 'snoozed'].includes(proposal.status),
    );

    const runProposalAction = async (
        proposalId: string,
        action: CircleGrowthPanelAction,
        callback: () => void | Promise<void>,
    ) => {
        if (pendingActionRef.current) return;
        pendingActionRef.current = true;
        setPendingAction({ proposalId, action });
        try {
            await callback();
        } finally {
            pendingActionRef.current = false;
            setPendingAction(null);
        }
    };

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div className={styles.titleBlock}>
                    <span className={styles.icon} aria-hidden="true">
                        <GitBranch size={16} />
                    </span>
                    <div>
                        <h3 className={styles.title}>{title}</h3>
                        {description ? <p className={styles.description}>{description}</p> : null}
                    </div>
                </div>
                <div className={styles.headerActions}>
                    <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={isBusy || hasPendingAction}>
                        <RefreshCw size={14} />
                        <span>{labels.refresh}</span>
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={onRequest} disabled={isBusy || hasPendingAction || status === 'disabled'}>
                        <Sparkles size={14} />
                        <span>{status === 'requesting' ? labels.loading : labels.request}</span>
                    </button>
                </div>
            </div>

            <div role="status" aria-live="polite">
                {status === 'disabled' ? <p className={styles.notice}>{disabledReason || labels.unavailable}</p> : null}
                {status === 'error' ? <p className={styles.error}>{errorMessage || labels.requestFailed}</p> : null}
                {isBusy ? <p className={styles.notice}>{labels.loading}</p> : null}
                {!isBusy && !errorMessage && visibleProposals.length === 0 ? <p className={styles.notice}>{labels.empty}</p> : null}
            </div>

            {visibleProposals.length > 0 ? (
                <div className={styles.list}>
                    {visibleProposals.map((proposal) => {
                        const risk = maxRisk(proposal.configDiff);
                        const canClear = canClearCircleGrowthProposal(proposal.status);
                        const canConvert = canConvertCircleGrowthProposal(proposal.status);
                        const clearDisabled = isCircleGrowthActionDisabled({
                            allowed: canClear,
                            panelBusy: isBusy,
                            hasPendingAction,
                        });
                        const convertDisabled = isCircleGrowthActionDisabled({
                            allowed: canConvert,
                            panelBusy: isBusy,
                            hasPendingAction,
                        });
                        return (
                            <article key={proposal.id} className={styles.proposal}>
                                <div className={styles.proposalTopline}>
                                    <div>
                                        <h4 className={styles.proposalTitle}>
                                            {proposal.recommendedStage || labels.status[proposal.status]}
                                        </h4>
                                        {proposal.explanation ? <p className={styles.description}>{proposal.explanation}</p> : null}
                                    </div>
                                    <div className={styles.badges}>
                                        <span className={styles.badge}>{labels.status[proposal.status]}</span>
                                        <span className={joinClassNames(styles.riskBadge, styles[`risk${risk}`])}>{labels.risk[risk]}</span>
                                    </div>
                                </div>

                                {proposal.status === 'no_signal' ? <p className={styles.notice}>{labels.noSignal}</p> : null}
                                {proposal.status === 'failed' ? <p className={styles.error}>{proposal.failureCode || labels.failed}</p> : null}

                                <div className={styles.metaGrid}>
                                    <span><ShieldCheck size={13} /> {labels.evidence}: {proposal.evidenceRefs.length}</span>
                                    {proposal.cooldownUntil ? (
                                        <span><Clock3 size={13} /> {labels.cooldown}: {formatDate(proposal.cooldownUntil, locale)}</span>
                                    ) : null}
                                    {proposal.configurationProposalId ? (
                                        <span><GitBranch size={13} /> {labels.configurationProposal}: {proposal.configurationProposalId}</span>
                                    ) : null}
                                </div>

                                {proposal.currentSignals.length > 0 ? (
                                    <div className={styles.signalGroup}>
                                        <span className={styles.signalLabel}>{labels.currentSignals}</span>
                                        <div className={styles.signalList}>
                                            {proposal.currentSignals.slice(0, 4).map((signal) => (
                                                <span key={signal.key}>{signalText(signal)}</span>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {proposal.counterSignals.length > 0 ? (
                                    <div className={styles.signalGroup}>
                                        <span className={styles.signalLabel}>{labels.counterSignals}</span>
                                        <div className={styles.signalList}>
                                            {proposal.counterSignals.slice(0, 4).map((signal) => (
                                                <span key={signal.key}>{signalText(signal)}</span>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {proposal.missingSignals.length > 0 ? (
                                    <div className={styles.signalGroup}>
                                        <span className={styles.signalLabel}>{labels.missingSignals}</span>
                                        <div className={styles.signalList}>
                                            {proposal.missingSignals.slice(0, 4).map((signal) => (
                                                <span key={signal.key}>{signal.label || signal.key}</span>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {proposal.configDiff.length > 0 ? (
                                    <div className={styles.diffList}>
                                        {proposal.configDiff.map((change) => (
                                            <div key={change.field} className={styles.diffItem}>
                                                <div className={styles.diffTopline}>
                                                    <div>
                                                        <div className={styles.fieldName}>{change.field}</div>
                                                        <p className={styles.reason}>{change.reason}</p>
                                                    </div>
                                                    <span className={joinClassNames(styles.riskBadge, styles[`risk${change.riskLevel}`])}>
                                                        {labels.risk[change.riskLevel]}
                                                    </span>
                                                </div>
                                                <div className={styles.valueGrid}>
                                                    <span>{formatValue(change.previousValue, {
                                                        unset: labels.valueUnset,
                                                        booleanOn: labels.valueBooleanOn,
                                                        booleanOff: labels.valueBooleanOff,
                                                    })}</span>
                                                    <span>{formatValue(change.proposedValue, {
                                                        unset: labels.valueUnset,
                                                        booleanOn: labels.valueBooleanOn,
                                                        booleanOff: labels.valueBooleanOff,
                                                    })}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

	                                <div className={styles.footerActions}>
	                                    <button
	                                        type="button"
	                                        className={styles.secondaryButton}
	                                        disabled={clearDisabled}
	                                        onClick={() => runProposalAction(
	                                            proposal.id,
	                                            'snooze',
	                                            () => onSnooze(proposal.id, defaultSnoozeUntil()),
	                                        )}
	                                    >
	                                        <Clock3 size={14} />
	                                        <span>{labels.snooze}</span>
	                                    </button>
	                                    <button
	                                        type="button"
	                                        className={styles.secondaryButton}
	                                        disabled={clearDisabled}
	                                        onClick={() => runProposalAction(
	                                            proposal.id,
	                                            'reject',
	                                            () => onReject(proposal.id, defaultRejectReason(proposal)),
	                                        )}
	                                    >
	                                        <X size={14} />
	                                        <span>{labels.reject}</span>
	                                    </button>
	                                    <button
	                                        type="button"
	                                        className={styles.primaryButton}
	                                        disabled={convertDisabled}
	                                        onClick={() => runProposalAction(
	                                            proposal.id,
	                                            'convert',
	                                            () => onConvert(proposal.id),
	                                        )}
	                                    >
	                                        <GitBranch size={14} />
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
